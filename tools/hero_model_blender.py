# The Blender half of tools/hero_model.py (the hero tier of an animal: the Meshy source's surface and texture on a clean
# mesh that carries the game's skeleton). Run by tools/hero_model.py, not by hand:
#
#   Blender -b --factory-startup --python tools/hero_model_blender.py -- build  <job.json>
#   Blender -b --factory-startup --python tools/hero_model_blender.py -- render <job.json>
#
# The job file (written by hero_model.py) names the source GLB and texture, the 4x4 similarity that takes the source's
# glTF coordinates into the game's frame (+z forward, +y up, feet on y = 0, metres), the game's rigged GLB and the work
# directory.
#
# build: imports the source, welds it, drops loose shards and interior faces, fills small holes, smooth normals; the
#   cleaned dense copy keeps its own UVs and texture and is the bake source. The hero is that mesh decimated (collapse)
#   to the target triangle count. Its UVs are a new unwrap: the surface is split into the skeleton's regions (trunk,
#   head with neck, tail, each leg below the elbow or stifle: the game model's dominant joint under each face), each
#   region cut open along its least visible line (the belly's midline, the inside back of each leg, under the tail,
#   under the throat and chin; a shortest path whose edge cost grows with how much the edge faces the viewer), unwrapped
#   angle-based, the head's islands given 1.4 times the texel density, packed. Bakes (Cycles, selected to active):
#   base colour and a tangent-space normal map (MikkTSpace, Blender's tangents, which the exporter writes) from the
#   dense source as imported (welded only, its own UVs); ambient occlusion on a smoothed copy of the hero. Two lighter tiers by collapse (a third, a tenth) keep the UVs.
#   Each tier is written as an .npz of split vertices in glTF axes (POSITION, NORMAL, TANGENT with the bitangent sign,
#   TEXCOORD_0 with v flipped as glTF has it) with each vertex's welded id, its local thickness (a ray inward) and the
#   source surface's roughness round it (fur clumps the generator modelled), for the fur factor.
# render: the verification renders, one PNG per model and view, under one sun and sky: the source, the game model
#   (lod0, its vertex colours, faceted), the hero (read back from the written GLB and maps, so the file is what is
#   checked), and the pose test (an armature built from extras.skin, a fore leg, a hind leg and the head turned).
import bpy, bmesh, sys, os, json, math, struct, heapq
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
MODE, JOBF = argv[0], argv[1]
JOB = json.load(open(JOBF))
WORK = JOB['work']

# glTF (x, y, z) -> Blender (x, -z, y)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
def g2b(a): a = np.asarray(a, np.float64); return np.stack([a[..., 0], -a[..., 2], a[..., 1]], -1)
def b2g(a): a = np.asarray(a, np.float64); return np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)

# ---- a minimal GLB reader (the game's file and our own) -----------------------------------------------------------------
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def load_glb(path):
    b = open(path, 'rb').read()
    ln, = struct.unpack_from('<I', b, 12); js = json.loads(b[20:20 + ln]); off = 20 + ln
    bl, = struct.unpack_from('<I', b, off)
    return js, b[off + 8:off + 8 + bl]
def accessor(js, bin, i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]; ct = CT[a['componentType']]; n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    x = np.frombuffer(bin, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n).astype(np.float64)
    if a.get('normalized'): x /= float(np.iinfo(ct).max)
    return x
def glb_mesh(path, name='lod0'):
    js, bin = load_glb(path)
    node = next(n for n in js['nodes'] if n.get('name') == name)
    pr = js['meshes'][node['mesh']]['primitives'][0]
    out = {k: accessor(js, bin, v) for k, v in pr['attributes'].items()}
    out['indices'] = accessor(js, bin, pr['indices']).reshape(-1, 3).astype(np.int64)
    return js, out, pr

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def select_only(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]

def import_source():
    """The source GLB as one object in the game's frame (Blender axes), its material reading the job's PNG texture."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=JOB['source_glb'])
    new = [o for o in bpy.context.scene.objects if o not in before]
    obs = [o for o in new if o.type == 'MESH']
    select_only(*obs)
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o is not ob and o.name in bpy.data.objects: bpy.data.objects.remove(o)
    M = Matrix(JOB['matrix'])   # glTF source -> glTF game
    ob.data.transform(C @ M @ C.inverted())
    ob.data.update()
    ob.name = 'source'
    tex = bpy.data.images.load(JOB['source_tex'])
    mat = ob.data.materials[0]
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE': n.image = tex
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Roughness'].default_value = 0.85; n.inputs['Metallic'].default_value = 0.0
    mat.use_backface_culling = False
    return ob

def clear_custom_normals(ob):
    select_only(ob)
    if ob.data.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for p in ob.data.polygons: p.use_smooth = True

def boundary_loops(bm):
    adj = {}
    for e in bm.edges:
        if e.is_boundary:
            x, y = e.verts; adj.setdefault(x, []).append(y); adj.setdefault(y, []).append(x)
    seen = set(); loops = []
    for v in adj:
        if v in seen: continue
        st = [v]; seen.add(v); lp = []
        while st:
            x = st.pop(); lp.append(x)
            for y in adj[x]:
                if y not in seen: seen.add(y); st.append(y)
        loops.append(lp)
    return loops

def make_manifold(bm, sides=60):
    """Delete the faces round non-manifold edges and vertices (fins, bow-ties) and fill the holes that leaves, until
    none is left (an unwrap needs a 2-manifold); a small hole the fill cannot close (a sliver: its edges in a line) is
    merged to its centre. Returns the faces deleted."""
    gone = 0
    for _ in range(10):
        bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
        bad = {f for e in bm.edges if not e.is_boundary and len(e.link_faces) != 2 for f in e.link_faces}
        bad |= {f for v in bm.verts if v.link_faces and not v.is_manifold and not v.is_boundary for f in v.link_faces}
        if bad:
            gone += len(bad)
            bmesh.ops.delete(bm, geom=list(bad), context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=sides)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        small = [lp for lp in boundary_loops(bm) if len(lp) <= 12]
        for lp in small:
            c = sum((v.co for v in lp), Vector()) / len(lp)
            if all(v.is_valid for v in lp): bmesh.ops.pointmerge(bm, verts=lp, merge_co=c)
        if not bad and not small: break
    # pieces the repair split off (a pair of faces closed on each other) go
    seen = set(); isl = []
    for f in bm.faces:
        if f in seen: continue
        st = [f]; seen.add(f); n = []
        while st:
            g = st.pop(); n.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen: seen.add(h); st.append(h)
        isl.append(n)
    tiny = [f for n in isl if len(n) < 0.005 * len(bm.faces) for f in n]
    if tiny: bmesh.ops.delete(bm, geom=tiny, context='FACES'); gone += len(tiny)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return gone

def clean_source(ob):
    """Weld, drop shards under 2% of the faces and interior faces, fill holes up to 40 edges, consistent outward
    winding. Returns stats."""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me)
    st = {'source_tris_raw': len(bm.faces)}
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # islands
    seen = set(); isl = []
    for f in bm.faces:
        if f in seen: continue
        stack = [f]; seen.add(f); n = []
        while stack:
            g = stack.pop(); n.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen: seen.add(h); stack.append(h)
        isl.append(n)
    drop = [f for n in isl if len(n) < 0.02 * len(bm.faces) for f in n]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    # interior faces: every edge shared by more than two faces
    inner = [f for f in bm.faces if all(len(e.link_faces) > 2 for e in f.edges)]
    bmesh.ops.delete(bm, geom=inner, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    st['boundary_edges_before_fill'] = sum(1 for e in bm.edges if e.is_boundary)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=40)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    st['nonmanifold_faces_replaced'] = make_manifold(bm)
    st['boundary_edges'] = sum(1 for e in bm.edges if e.is_boundary)
    st['nonmanifold_edges'] = sum(1 for e in bm.edges if not e.is_manifold)
    st['islands_dropped_faces'] = len(drop); st['interior_faces'] = len(inner)
    bm.to_mesh(me); bm.free(); me.update()
    clear_custom_normals(ob)
    st['source_tris'] = len(me.polygons)
    return st

def duplicate(ob, name):
    o = ob.copy(); o.data = ob.data.copy(); o.name = name; bpy.context.scene.collection.objects.link(o); return o

def decimate(ob, tris):
    m = ob.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'
    m.ratio = min(1.0, tris / max(1, len(ob.data.polygons))); m.use_collapse_triangulate = True
    select_only(ob); bpy.ops.object.modifier_apply(modifier=m.name)
    for p in ob.data.polygons: p.use_smooth = True

# ---- regions from the game's skin and seams along hidden lines -----------------------------------------------------
def game_skin():
    js, g, _ = glb_mesh(JOB['game_glb'], 'lod0')
    sk = js['extras']['skin']
    P = g2b(g['POSITION']); T = g['indices']
    nj = len(sk['joints'])
    W = np.zeros((len(P), nj))
    ji = g['JOINTS_0'].astype(int); wv = g['WEIGHTS_0']
    for k in range(4): np.add.at(W, (np.arange(len(P)), ji[:, k]), wv[:, k])
    return sk, P, T, W

def regions(ob, sk, GP, GT, GW):
    """A label per hero face: 0 trunk, 1 head (Head, Neck), 2 tail, 3-6 legs FL FR HL HR (below the elbow or stifle)."""
    names = sk['joints']; J = {n: i for i, n in enumerate(names)}
    bvh = BVHTree.FromPolygons([Vector(p) for p in GP], [tuple(int(i) for i in t) for t in GT])
    me = ob.data
    lab = np.zeros(len(me.polygons), np.int64)
    rest = g2b(np.array(sk['joint_rest']))
    legs = ['FL', 'FR', 'HL', 'HR']
    groups = {1: [J[n] for n in ('Head', 'Neck') if n in J], 2: [J[n] for n in names if n.startswith(('Tail', 'Scut'))]}
    for k, L in enumerate(legs):
        groups[3 + k] = [J[f'{b}.{L}'] for b in ('UpperLeg', 'LowerLeg', 'Foot')]
    for f in me.polygons:
        c = f.center
        loc, nrm, ti, d = bvh.find_nearest(c)
        t = GT[ti]; a, b, cc = (Vector(GP[i]) for i in t)
        # barycentric
        v0, v1, v2 = b - a, cc - a, loc - a
        d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        v = (d11 * d20 - d01 * d21) / den; w = (d00 * d21 - d01 * d20) / den; u = 1 - v - w
        wt = GW[t[0]] * u + GW[t[1]] * v + GW[t[2]] * w
        sc = {0: 1.0 - sum(wt[groups[g]].sum() for g in groups)}
        for g, js_ in groups.items(): sc[g] = float(wt[js_].sum())
        best = max(sc, key=sc.get)
        if best >= 3:   # a leg's region starts a little above the elbow / stifle
            L = legs[best - 3]
            if c.z > rest[J[f'LowerLeg.{L}']][2] * 1.12: best = 0
        lab[f.index] = best
    return lab

def face_adjacency(bm):
    return [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]

def tidy_labels(bm, lab):
    adj = face_adjacency(bm)
    for _ in range(3):   # majority filter
        new = lab.copy()
        for i, nb in enumerate(adj):
            if not nb: continue
            vals, cnt = np.unique(lab[nb], return_counts=True)
            if cnt.max() >= 2 and vals[cnt.argmax()] != lab[i] and (lab[nb] == lab[i]).sum() <= 1: new[i] = vals[cnt.argmax()]
        lab = new
    for _ in range(6):   # each label one connected piece: the smaller pieces go to their neighbours
        changed = False
        for L in np.unique(lab):
            idx = np.where(lab == L)[0]; seen = set(); comps = []
            for s in idx:
                if s in seen: continue
                stack = [s]; seen.add(s); comp = []
                while stack:
                    x = stack.pop(); comp.append(x)
                    for y in adj[x]:
                        if lab[y] == L and y not in seen: seen.add(y); stack.append(y)
                comps.append(comp)
            comps.sort(key=len, reverse=True)
            for comp in comps[1:]:
                cs = set(comp); nbl = [lab[y] for x in comp for y in adj[x] if y not in cs]
                if nbl:
                    vals, cnt = np.unique(nbl, return_counts=True); lab[comp] = vals[cnt.argmax()]; changed = True
        if not changed: break
    return lab

def cut_path(bm, lab, region, start, target_fn, hidden):
    """Shortest path over the region's vertices from any of `start` to the vertex target_fn picks, each edge costing its
    length times (1 + 12 * how much it faces away from the hidden direction). Returns the path's edges."""
    verts = {v for f in bm.faces if lab[f.index] == region for v in f.verts}
    if not verts or not start: return []
    target = target_fn(verts)
    if target is None: return []
    hid = Vector(hidden).normalized()
    dist = {v: 0.0 for v in start}; prev = {}
    h = [(0.0, v.index, v) for v in start]; heapq.heapify(h)
    while h:
        d, _, v = heapq.heappop(h)
        if v is target: break
        if d > dist.get(v, 1e18): continue
        for e in v.link_edges:
            if not any(lab[f.index] == region for f in e.link_faces): continue
            u = e.other_vert(v)
            if u not in verts: continue
            n = (v.normal + u.normal).normalized()
            vis = (1 - n.dot(hid)) / 2
            nd = d + e.calc_length() * (1 + 12 * vis * vis)
            if nd < dist.get(u, 1e18): dist[u] = nd; prev[u] = (v, e); heapq.heappush(h, (nd, u.index, u))
    if target not in prev: return []
    out = []; v = target
    while v in prev: v, e = prev[v]; out.append(e)
    return out

def charts_of(bm):
    seen = set(); out = []
    for f in bm.faces:
        if f in seen: continue
        stack = [f]; seen.add(f); fs = []
        while stack:
            g = stack.pop(); fs.append(g)
            for e in g.edges:
                if e.seam: continue
                for h2 in e.link_faces:
                    if h2 not in seen: seen.add(h2); stack.append(h2)
        out.append(fs)
    return out

def join_holes(bm, lab, rest, J):
    """Make every chart a disc: while a chart's boundary (seams and mesh boundary) is in more than one piece (a hole
    where a leg leaves the trunk, a mesh hole), cut the least visible path from the largest piece to the nearest other."""
    cuts = 0
    hips_x = rest[J['Hips']][0]
    for _ in range(40):
        changed = False
        for fs in charts_of(bm):
            fset = set(fs)
            bedges = [e for g in fs for e in g.edges if e.seam or e.is_boundary]
            if not bedges: continue
            # boundary pieces: connected components of the boundary edges' vertices
            adj = {}
            for e in set(bedges):
                a, b = e.verts; adj.setdefault(a, set()).add(b); adj.setdefault(b, set()).add(a)
            comp = {}; pieces = []
            for v in adj:
                if v in comp: continue
                stack = [v]; comp[v] = len(pieces); pc = [v]
                while stack:
                    x = stack.pop()
                    for y in adj[x]:
                        if y not in comp: comp[y] = len(pieces); stack.append(y); pc.append(y)
                pieces.append(pc)
            if len(pieces) < 2: continue
            main = max(range(len(pieces)), key=lambda i: len(pieces[i]))
            L = int(lab[fs[0].index])
            if 3 <= L <= 6:
                c = sum((g.calc_center_median() for g in fs), Vector()) / len(fs)
                hid = Vector((-1.0 if c.x > hips_x else 1.0, 0.7, -0.2)).normalized()
            else: hid = Vector((0, 0, -1))
            dist = {v: 0.0 for v in pieces[main]}; prev = {}
            h = [(0.0, v.index, v) for v in pieces[main]]; heapq.heapify(h); hit = None
            while h:
                d, _, v = heapq.heappop(h)
                if d > dist.get(v, 1e18): continue
                if v in comp and comp[v] != main: hit = v; break
                for e in v.link_edges:
                    if e.seam or e.is_boundary or not all(f2 in fset for f2 in e.link_faces): continue
                    u = e.other_vert(v)
                    n = (v.normal + u.normal).normalized(); vis = (1 - n.dot(hid)) / 2
                    nd = d + e.calc_length() * (1 + 12 * vis * vis)
                    if nd < dist.get(u, 1e18): dist[u] = nd; prev[u] = (v, e); heapq.heappush(h, (nd, u.index, u))
            if hit is None: continue
            v = hit
            while v in prev: v, e = prev[v]; e.seam = True; cuts += 1
            changed = True
            break   # the charts changed: recompute
        if not changed: break
    return cuts

def unwrap(ob, sk, GP, GT, GW, stats):
    me = ob.data
    lab = regions(ob, sk, GP, GT, GW)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.normal_update()
    lab = tidy_labels(bm, lab)
    for e in bm.edges: e.seam = False
    border = {}
    for e in bm.edges:
        ls = {int(lab[f.index]) for f in e.link_faces}
        if len(ls) > 1 or e.is_boundary:
            e.seam = True
            for L in ls:
                border.setdefault(L, set()).update(e.verts)
    J = {n: i for i, n in enumerate(sk['joints'])}
    rest = g2b(np.array(sk['joint_rest']))
    def farthest_from(points):
        c = sum((v.co for v in points), Vector()) / max(1, len(points))
        return lambda vs: max(vs, key=lambda v: (v.co - c).length)
    cuts = 0
    # trunk: the belly's midline from the neck's ring to the tail's ring (or to the rear-most point near the midline)
    tb = border.get(0, set())
    start = [v for v in tb if any(lab[f.index] == 1 for f in v.link_faces)]
    tail_ring = [v for v in tb if any(lab[f.index] == 2 for f in v.link_faces)]
    if tail_ring:
        ts = set(tail_ring); tf = lambda vs: min((v for v in vs if v in ts), key=lambda v: v.co.z, default=None)
    else:
        tf = lambda vs: max((v for v in vs if abs(v.co.x) < 0.04 * JOB['length_m']), key=lambda v: v.co.y - 0.3 * v.co.z, default=None)
    for e in cut_path(bm, lab, 0, start, tf, (0, 0, -1)): e.seam = True; cuts += 1
    # head: under the throat and chin to the nose
    hb = [v for v in border.get(1, set())]
    for e in cut_path(bm, lab, 1, hb, lambda vs: min(vs, key=lambda v: v.co.y + 0.5 * v.co.z), (0, 0, -1)): e.seam = True; cuts += 1
    # tail: underneath, root to tip
    tb2 = list(border.get(2, set()))
    if tb2:
        for e in cut_path(bm, lab, 2, tb2, farthest_from(tb2), (0, 0, -1)): e.seam = True; cuts += 1
    # legs: the inside back, from the ring to the sole
    for k, L in enumerate(['FL', 'FR', 'HL', 'HR']):
        R = 3 + k; lb = list(border.get(R, set()))
        sx = 1.0 if rest[J[f'Foot.{L}']][0] > rest[J['Hips']][0] else -1.0
        hidden = (-sx, 0.7, -0.2)   # toward the midline and back (Blender +y is the animal's rear)
        def sole(vs, hid=Vector(hidden)):
            zmin = min(v.co.z for v in vs)
            low = [v for v in vs if v.co.z < zmin + 0.01 * JOB['withers_m']] or list(vs)
            return max(low, key=lambda v: v.co.dot(hid))
        for e in cut_path(bm, lab, R, lb, sole, hidden): e.seam = True; cuts += 1
    cuts += join_holes(bm, lab, rest, J)
    # each chart's Euler characteristic (a disc is 1; a handle makes it lower and the unwrap folds)
    seen = set(); charts = []
    for f in bm.faces:
        if f in seen: continue
        stack = [f]; seen.add(f); fs = []
        while stack:
            g = stack.pop(); fs.append(g)
            for e in g.edges:
                if e.seam: continue
                for h2 in e.link_faces:
                    if h2 not in seen: seen.add(h2); stack.append(h2)
        vs = {v for g in fs for v in g.verts}; es = {e for g in fs for e in g.edges}
        charts.append((int(lab[fs[0].index]), len(fs), len(vs) - len(es) + len(fs)))
    stats['charts_label_faces_euler'] = charts
    bm.to_mesh(me); bm.free(); me.update()
    stats['region_faces'] = {str(k): int((lab == k).sum()) for k in range(7)}
    stats['cut_edges'] = cuts
    # unwrap along the seams, equal texel density, the head denser, pack
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', fill_holes=True, correct_aspect=True, margin=0.0)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.minimize_stretch(fill_holes=True, blend=0.0, iterations=60)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # the head's islands 1.4x (it is the part seen close)
    uv = np.zeros(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    head_loops = np.array([li for p in me.polygons if lab[p.index] == 1 for li in p.loop_indices], np.int64)
    if len(head_loops):
        c = uv[head_loops].mean(0); uv[head_loops] = c + (uv[head_loops] - c) * 1.4
    me.uv_layers[0].data.foreach_set('uv', uv.reshape(-1))
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, scale=True, margin_method='FRACTION', margin=0.006, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    # island count and density spread
    bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    seen = set(); nisl = 0
    for f in bm.faces:
        if f in seen: continue
        nisl += 1; stack = [f]; seen.add(f)
        while stack:
            g = stack.pop()
            for e in g.edges:
                if e.seam: continue
                for h in e.link_faces:
                    if h not in seen: seen.add(h); stack.append(h)
    ratios = []; flips = 0
    for f in bm.faces:
        a3 = f.calc_area()
        l = [lp[uvl].uv for lp in f.loops]
        a2 = ((l[1] - l[0]).x * (l[2] - l[0]).y - (l[1] - l[0]).y * (l[2] - l[0]).x) / 2
        if a2 < 0: flips += 1
        if a3 > 0: ratios.append(math.sqrt(abs(a2) / a3) * (1.0 / (1.4 if lab[f.index] == 1 else 1.0)))
    r = np.array(ratios); bm.free()
    stats['uv_islands'] = nisl; stats['uv_flipped_faces'] = flips
    stats['uv_density_cv'] = round(float(r.std() / r.mean()), 3)
    stats['uv_density_p5_p95'] = [round(float(np.percentile(r, 5) / np.median(r)), 3), round(float(np.percentile(r, 95) / np.median(r)), 3)]
    uv = np.zeros(len(me.loops) * 2); me.uv_layers[0].data.foreach_get('uv', uv)
    tri_uv_area = 0.0
    for p in me.polygons:
        l = uv.reshape(-1, 2)[list(p.loop_indices)]
        tri_uv_area += abs((l[1, 0] - l[0, 0]) * (l[2, 1] - l[0, 1]) - (l[1, 1] - l[0, 1]) * (l[2, 0] - l[0, 0])) / 2
    stats['uv_coverage'] = round(tri_uv_area, 3)
    return lab

# ---- baking ---------------------------------------------------------------------------------------------------------
def cycles(samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e: print('WARN no GPU:', e)
    sc.cycles.samples = samples; sc.cycles.use_denoising = False
    sc.cycles.seed = 0

def bake_target(ob, name, size, noncolor):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    mat = ob.data.materials[0] if ob.data.materials else None
    if mat is None:
        mat = bpy.data.materials.new('hero'); mat.use_nodes = True; ob.data.materials.append(mat)
    nt = mat.node_tree
    node = nt.nodes.get('bake') or nt.nodes.new('ShaderNodeTexImage'); node.name = 'bake'
    node.image = img; nt.nodes.active = node; node.select = True
    return img

def save(img, path):
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()

def bake_all(src, hero, stats):
    sc = bpy.context.scene; bk = sc.render.bake
    L = JOB['length_m']
    # hero material: a plain principled (the bake target node only)
    hero.data.materials.clear(); m = bpy.data.materials.new('hero'); m.use_nodes = True; hero.data.materials.append(m)
    bk.margin = 16; bk.margin_type = 'EXTEND'
    bk.use_selected_to_active = True; bk.use_cage = False
    bk.cage_extrusion = 0.002 * L; bk.max_ray_distance = 0.012 * L
    size = JOB['bake_px']
    cycles(4)
    select_only(src, hero, active=hero)
    img = bake_target(hero, 'color', size, False)
    bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True)
    save(img, os.path.join(WORK, 'color.png'))
    img = bake_target(hero, 'normal', size, True)
    bk.normal_space = 'TANGENT'
    bpy.ops.object.bake(type='NORMAL', use_selected_to_active=True)
    save(img, os.path.join(WORK, 'normal.png'))
    # AO: the body's large-scale occlusion (under the belly, between the legs, inside the ears), baked on a smoothed copy
    # of the hero with the same UVs: the generator's sculpted fur tufts would print sharp dark wedges, and their small
    # shading is already in the colour
    src.hide_render = True; hero.hide_render = True
    prox = duplicate(hero, 'ao_proxy'); prox.hide_render = False
    sm = prox.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.5; sm.iterations = 12
    select_only(prox); bpy.ops.object.modifier_apply(modifier=sm.name)
    w = bpy.data.worlds.new('w'); sc.world = w; w.light_settings.distance = 0.35 * JOB['withers_m']
    cycles(128)
    img = bake_target(prox, 'ao', JOB['ao_px'], True)
    bpy.ops.object.bake(type='AO', use_selected_to_active=False)
    save(img, os.path.join(WORK, 'ao.png'))
    bpy.data.objects.remove(prox)
    src.hide_render = False; hero.hide_render = False

# ---- per-vertex geometry for the fur factor --------------------------------------------------------------------------
def fur_geometry(hero, src):
    """thickness: the distance inward along -normal to the opposite surface (metres); rough: 1 - |mean normal| of the dense
    source's vertex normals within 1.5% of the body length (the generator's fur clumps), per hero vertex."""
    me = hero.data; me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
    bvh = BVHTree.FromObject(hero, bpy.context.evaluated_depsgraph_get())
    sm = src.data
    kd = KDTree(len(sm.vertices))
    for v in sm.vertices: kd.insert(v.co, v.index)
    kd.balance()
    sn = [v.normal.copy() for v in sm.vertices]
    r = 0.015 * JOB['length_m']; far = JOB['withers_m']
    th = np.zeros(len(me.vertices)); ro = np.zeros(len(me.vertices))
    for v in me.vertices:
        n = v.normal
        hit = bvh.ray_cast(v.co - n * 1e-4, -n, far)
        th[v.index] = hit[3] if hit[0] is not None else far
        acc = Vector(); k = 0
        for (co, i, d) in kd.find_range(v.co, r): acc += sn[i]; k += 1
        ro[v.index] = 1 - acc.length / max(k, 1)
    return th, ro

# ---- writing a tier ---------------------------------------------------------------------------------------------------
def export_tier(ob, path, th=None, ro=None, lab=None):
    me = ob.data
    me.calc_tangents(uvmap='UVMap')
    nl = len(me.loops)
    lv = np.zeros(nl, np.int64); me.loops.foreach_get('vertex_index', lv)
    uv = np.zeros(nl * 2); me.uv_layers['UVMap'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    tg = np.zeros(nl * 3); me.loops.foreach_get('tangent', tg); tg = tg.reshape(-1, 3)
    sg = np.zeros(nl); me.loops.foreach_get('bitangent_sign', sg)
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    vn = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('normal', vn); vn = vn.reshape(-1, 3)
    # split vertices: one per (vertex, uv, bitangent sign)
    key = np.stack([lv, np.round(uv[:, 0] * 1e6), np.round(uv[:, 1] * 1e6), sg], 1)
    uk, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
    n = len(uk)
    T = np.zeros((n, 3)); np.add.at(T, inv, tg); T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    vid = uk[:, 0].astype(np.int64)
    first = np.zeros(n, np.int64); first[inv[::-1]] = np.arange(nl)[::-1]
    U = uv[first]
    tris = []
    for p in me.polygons:
        li = list(p.loop_indices)
        for k in range(1, len(li) - 1): tris.append((inv[li[0]], inv[li[k]], inv[li[k + 1]]))
    out = dict(POSITION=b2g(co[vid]).astype(np.float32), NORMAL=b2g(vn[vid]).astype(np.float32),
               TANGENT=np.concatenate([b2g(T), sg[first][:, None]], 1).astype(np.float32),
               TEXCOORD_0=np.stack([U[:, 0], 1 - U[:, 1]], 1).astype(np.float32),
               indices=np.array(tris, np.uint32), vid=vid)
    if th is not None: out['thickness'] = th[vid].astype(np.float32); out['rough'] = ro[vid].astype(np.float32)
    np.savez_compressed(path, **out)
    return len(tris)

def build():
    reset()
    stats = {}
    src = import_source()
    # the bake source: the source welded and nothing else (its UVs and texture untouched: the cleaning's hole fills
    # have no texture of their own and would print dark marks)
    raw = duplicate(src, 'bake_source')
    bm = bmesh.new(); bm.from_mesh(raw.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.to_mesh(raw.data); bm.free()
    clear_custom_normals(raw)
    stats.update(clean_source(src))
    hero = duplicate(src, 'hero')
    decimate(hero, JOB['tris'])
    bm = bmesh.new(); bm.from_mesh(hero.data)
    stats['hero_nonmanifold_faces_replaced'] = make_manifold(bm)
    stats['hero_boundary_edges'] = sum(1 for e in bm.edges if e.is_boundary)
    stats['hero_nonmanifold_edges'] = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    bm.to_mesh(hero.data); bm.free(); hero.data.update()
    clear_custom_normals(hero)
    sk, GP, GT, GW = game_skin()
    lab = unwrap(hero, sk, GP, GT, GW, stats)
    src.hide_render = True
    bake_all(raw, hero, stats)
    th, ro = fur_geometry(hero, src)
    stats['tris'] = [export_tier(hero, os.path.join(WORK, 'tier0.npz'), th, ro)]
    for k, frac in ((1, 1 / 3), (2, 1 / 10)):
        t = duplicate(hero, f'hero{k}'); decimate(t, len(hero.data.polygons) * frac)
        clear_custom_normals(t)
        stats['tris'].append(export_tier(t, os.path.join(WORK, f'tier{k}.npz')))
    json.dump(stats, open(os.path.join(WORK, 'build_stats.json'), 'w'), indent=1)
    print('BUILD', json.dumps(stats))

# ---- render ---------------------------------------------------------------------------------------------------------
def mesh_from(name, P, T, uv=None, normals=None, colors=None):
    me = bpy.data.meshes.new(name)
    Pb = g2b(P)
    me.vertices.add(len(Pb)); me.vertices.foreach_set('co', Pb.reshape(-1).astype(np.float32))
    nt = len(T)
    me.loops.add(nt * 3); me.loops.foreach_set('vertex_index', T.reshape(-1).astype(np.int32))
    me.polygons.add(nt); me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32)); me.polygons.foreach_set('loop_total', np.full(nt, 3, np.int32))
    me.update(); me.validate()
    if uv is not None:
        l = me.uv_layers.new(name='UVMap'); u = uv[T.reshape(-1)].copy(); u[:, 1] = 1 - u[:, 1]
        l.data.foreach_set('uv', u.reshape(-1).astype(np.float32))
    if colors is not None:
        a = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        c = np.ones((len(P), 4)); c[:, :3] = colors[:, :3]; a.data.foreach_set('color', c.reshape(-1).astype(np.float32))
    for p in me.polygons: p.use_smooth = normals is not None
    if normals is not None:
        me.normals_split_custom_set_from_vertices([Vector(n) for n in g2b(normals)])
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob

def principled(name, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
    return m, b

def hero_object(path):
    js, g, pr = glb_mesh(path, 'lod0')
    ob = mesh_from('hero', g['POSITION'], g['indices'], uv=g['TEXCOORD_0'], normals=g['NORMAL'])
    m, b = principled('heromat'); nt = m.node_tree
    base = os.path.dirname(path)
    mat = js['materials'][pr['material']]
    def img(texinfo, noncolor):
        t = js['textures'][texinfo['index']]
        src = t.get('source', t.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
        im = bpy.data.images.load(os.path.join(base, js['images'][src]['uri'])); im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = im; return n
    col = img(mat['pbrMetallicRoughness']['baseColorTexture'], False)
    ao = img(mat['occlusionTexture'], True)
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 0.5
    nt.links.new(col.outputs['Color'], mix.inputs['A']); nt.links.new(ao.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    nm = img(mat['normalTexture'], True)
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.space = 'TANGENT'; nmap.uv_map = 'UVMap'
    nt.links.new(nm.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    ob.data.materials.append(m)
    return ob, g, js

def game_object():
    js, g, _ = glb_mesh(JOB['game_glb'], 'lod0')
    ob = mesh_from('game', g['POSITION'], g['indices'], colors=g['COLOR_0'])
    m, b = principled('gamemat', 0.9); nt = m.node_tree
    a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'col'
    nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    ob.data.materials.append(m)
    return ob, g, js

# ---- heat: Blender's automatic weights (bone heat) on the welded hero ------------------------------------------------
def heat():
    """The welded hero lod0 (heat.npz: P, T in glTF axes) and the skeleton (JOB['skeleton']: names, heads, tails, parents);
    an armature of those bones, the mesh parented to it with automatic weights (the bone-heat solve), the weights read
    back per joint into heat_out.npz (W, n x joints). The mesh is scaled to about 10 m for the solve (bone heat fails on
    small meshes)."""
    reset()
    d = np.load(os.path.join(WORK, 'heat.npz')); sk = JOB['skeleton']
    k = 10.0 / max(JOB['length_m'], 1e-3)
    ob = mesh_from('heat', d['P'] * k, d['T'].astype(np.int64))
    arm = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new('rig', arm); bpy.context.scene.collection.objects.link(ao)
    select_only(ao); bpy.ops.object.mode_set(mode='EDIT')
    H = g2b(np.array(sk['heads']) * k); Tl = g2b(np.array(sk['tails']) * k)
    for i, n in enumerate(sk['names']):
        b = arm.edit_bones.new(n); b.head = Vector(H[i]); b.tail = Vector(Tl[i])
    for i, n in enumerate(sk['names']):
        pn = sk['parents'][i]
        if pn is not None: arm.edit_bones[n].parent = arm.edit_bones[sk['names'][pn]]; arm.edit_bones[n].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    select_only(ob, ao, active=ao)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    W = np.zeros((len(ob.data.vertices), len(sk['names'])))
    gi = {g.index: sk['names'].index(g.name) for g in ob.vertex_groups if g.name in sk['names']}
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group in gi: W[v.index, gi[g.group]] = g.weight
    np.savez_compressed(os.path.join(WORK, 'heat_out.npz'), W=W)
    print('HEAT zero-weight vertices', int((W.sum(1) <= 1e-6).sum()), 'of', len(W))

# ---- render ---------------------------------------------------------------------------------------------------------
def stage():
    sc = bpy.context.scene
    cycles(48); sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = JOB['cell']
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'None'
    w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.7, 0.95, 1); bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))   # from the front left, above
    bpy.ops.mesh.primitive_plane_add(size=60); gp = bpy.context.active_object
    gm, gb = principled('ground', 0.95); gb.inputs['Base Color'].default_value = (0.42, 0.40, 0.36, 1); gp.data.materials.append(gm)
    cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    return co

def aim(co, eye, target, lens):
    co.location = Vector(eye); d = Vector(target) - Vector(eye)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); co.data.lens = lens

def frame(P, az, el, pad=1.55, target=None):
    """A camera on the box of P (Blender axes): azimuth from the animal's left side (+x) toward its front (-y)."""
    lo, hi = P.min(0), P.max(0); c = (lo + hi) / 2 if target is None else target
    span = max(hi[1] - lo[1], hi[0] - lo[0], (hi[2] - lo[2]) * 1.3); d = span * pad
    a, e = math.radians(az), math.radians(el)
    return (c + np.array([math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e)]) * d, c, 50)

def views():
    """side (the animal's left), three-quarter front, close on the head. Blender axes."""
    sk = load_glb(JOB['game_glb'])[0]['extras']['skin']
    H = JOB['withers_m']
    js, g, _ = glb_mesh(JOB['game_glb'], 'lod0'); P = g2b(g['POSITION'])
    c = (P.min(0) + P.max(0)) / 2
    head = g2b(np.array(sk['joint_rest'][sk['joints'].index('Head')])); nose = g2b(np.array(sk['nose']))
    hc = (head + nose) / 2; hs = np.linalg.norm(nose - head)
    span = max(P[:, 1].max() - P[:, 1].min(), (P[:, 2].max()) * 1.3)
    d = span * 1.55
    V = {}
    V['side'] = (c + np.array([d, 0, 0.12 * H]), c, 50)
    a = math.radians(40)
    V['threequarter'] = (c + np.array([math.sin(a) * d, -math.cos(a) * d, 0.35 * H]), c + np.array([0, 0, -0.05 * H]), 50)
    a = math.radians(35)
    V['head'] = (hc + np.array([math.sin(a), -math.cos(a), 0.25]) * hs * 5.0, hc, 50)
    V['head_up'] = (hc + np.array([math.sin(a) * 0.8, -math.cos(a) * 0.8, 0.6]) * hs * 5.0, hc + np.array([0, 0, 0.2 * hs]), 50)
    return V, P

def shoot(co, view, path):
    eye, tgt, lens = view; aim(co, eye, tgt, lens)
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

def render():
    reset()
    co = stage(); V, GP = views()
    out = JOB['cells']
    src = import_source(); clear_custom_normals(src)
    game, gg, gjs = game_object()
    hero, hg, hjs = hero_object(JOB['hero_glb'])
    models = {'source': src, 'game': game, 'hero': hero}
    def show(only):
        for k, o in models.items(): o.hide_render = (k != only)
    for name in ('source', 'game', 'hero'):
        show(name)
        for v in ('side', 'threequarter', 'head'):
            shoot(co, V[v], os.path.join(out, f'{name}_{v}.png'))
    # the posed hero (hero_model.py poses the welded lod0 by each weight set; here each pose's positions and normals go
    # onto the lod0 split vertices, lifted onto the ground)
    show('hero'); me = hero.data
    d = np.load(JOB['poses_npz']); inv = d['inv']
    rest = np.array([v.co[:] for v in me.vertices])
    for spec in JOB['pose_shots']:
        key, view = spec['key'], spec['view']
        P = d[key + '_P'][inv]; N = d[key + '_N'][inv]
        Pb = g2b(P)
        me.vertices.foreach_set('co', Pb.reshape(-1).astype(np.float32)); me.update()
        me.normals_split_custom_set_from_vertices([Vector(n) for n in g2b(N)])
        if view == 'head': vw = V['head']
        elif view == 'head_up': vw = V['head_up']
        else: vw = frame(Pb, *spec['angle'])
        shoot(co, vw, os.path.join(out, f'{spec["name"]}.png'))
    me.vertices.foreach_set('co', rest.reshape(-1).astype(np.float32)); me.update()

if MODE == 'build': build()
elif MODE == 'render': render()
elif MODE == 'heat': heat()
else: raise SystemExit(f'unknown mode {MODE}')
