# Shared helpers for the animal build scripts (tools/build_<name>.py), run inside Blender 4.1:
# bake a skinned Quaternius model to its rest pose, decimate to a tier, emit per-vertex colour and the
# procedural rig attributes, and write the GLB the client loads (meshes lod0, lod1, lod2; POSITION,
# COLOR_0 linear, indices, and the custom attributes _PART, _PARTW, _PIVOT plus any extras).
# tools/build_deer.py predates this module and keeps its own copy of the writer.
#
# Axes: the scripts work in Blender axes, metres, feet at z = 0, the animal facing -y, +x its left.
# to3() maps to glTF / three.js: +y up, +z forward, +x the animal's left.
import bpy, bmesh, json, struct, math
from mathutils import Vector

PART = dict(BODY=0, LEG_A=1, LEG_B=2, TAIL=3, HEAD=6)


def to3(p):
    return Vector((p.x, p.z, -p.y))


def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))


def mix(a, b, t):
    """Mix two sRGB hex colours in sRGB, return a hex colour."""
    ca = [(a >> s) & 255 for s in (16, 8, 0)]; cb = [(b >> s) & 255 for s in (16, 8, 0)]
    c = [round(x + (y - x) * t) for x, y in zip(ca, cb)]
    return (c[0] << 16) | (c[1] << 8) | c[2]


def hash01(*v):
    """Deterministic pseudo-random 0-1 from numbers (quantised); used for grizzle noise per face."""
    h = 2166136261
    for x in v:
        h = ((h ^ (int(round(x * 1000)) & 0xffffffff)) * 16777619) & 0xffffffff
    h ^= h >> 13; h = (h * 0x5bd1e995) & 0xffffffff; h ^= h >> 15
    return h / 0xffffffff


def grizzle(hexcol, c, amount=0.12, cell=0.02):
    """Linear colour of hexcol with per-face brightness noise, symmetric in x (hash of |x|)."""
    k = 1 + amount * (2 * hash01(abs(c.x) // cell, c.y // cell, c.z // cell) - 1)
    return tuple(min(1.0, x * k) for x in srgb2lin(hexcol))


def seg_t(p, a, b):
    ab = b - a
    return max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))


def seg_dist(p, a, b):
    t = seg_t(p, a, b)
    return (p - (a + (b - a) * t)).length


def poly_nearest(p, pts):
    """Nearest point on a polyline: (distance, arc-length fraction 0-1, point)."""
    lens = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]; tot = sum(lens)
    best = (1e9, 0.0, pts[0]); acc = 0.0
    for i in range(len(pts) - 1):
        t = seg_t(p, pts[i], pts[i + 1]); q = pts[i] + (pts[i + 1] - pts[i]) * t
        d = (p - q).length
        if d < best[0]: best = (d, (acc + lens[i] * t) / tot, q)
        acc += lens[i]
    return best


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def bake_skinned(src, mesh_name=None, drop=()):
    """Import a skinned GLB, bake its rest pose and transforms into the mesh, drop the armature.
    Returns (mesh object, {bone name: world head position}). Other meshes (IK helper spheres) are removed."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == 'MESH']
    ob = next(o for o in meshes if o.name == mesh_name) if mesh_name else max(meshes, key=lambda o: len(o.data.polygons))
    for o in meshes:
        if o is not ob: bpy.data.objects.remove(o)
    arm = next(o for o in sc.objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'REST'
    if arm.animation_data: arm.animation_data.action = None
    bpy.context.view_layer.update()
    J = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.data.objects.remove(arm)
    for o in list(sc.objects):
        if o.type == 'EMPTY': bpy.data.objects.remove(o)
    return ob, J


def weld(me, dist=1e-4):
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(me); bm.free(); me.update()


def triangulate(me):
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(me); bm.free(); me.update()


def tier_copy(ob, target, symmetry=True, protect=None, drop_faces=None, protect_factor=1.0):
    """A triangulated copy of ob decimated (collapse) to about `target` triangles (None: as is).
    protect: a vertex group name whose weight keeps detail (decimated last); drop_faces(bm_face) -> True deletes
    the face before decimating (e.g. eyes on the far tier). Caller removes the returned object."""
    sc = bpy.context.scene
    o = ob.copy(); o.data = ob.data.copy(); sc.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    m = o.data
    if drop_faces:
        bm = bmesh.new(); bm.from_mesh(m)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if drop_faces(f)], context='FACES')
        bm.to_mesh(m); bm.free()
    triangulate(m)
    n0 = len(m.polygons)
    if target is not None and target < n0:
        d = o.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = target / n0
        d.use_symmetry = symmetry; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        if protect and protect in o.vertex_groups:
            d.vertex_group = protect; d.invert_vertex_group = True; d.vertex_group_factor = protect_factor
        bpy.ops.object.modifier_apply(modifier='dec')
    triangulate(m)
    return o, n0


def emit(m, face_color, vert_rig, extra_names=()):
    """Flatten a triangulated mesh into vertex arrays. face_color(poly) -> linear rgb; vert_rig(vertex index)
    -> dict(part=, partw=, pivot= Blender Vector, plus each name in extra_names). Vertices are split where
    face colours differ (flat colour per face)."""
    key2i = {}; out = dict(pos=[], col=[], part=[], partw=[], piv=[], idx=[], **{n: [] for n in extra_names})
    rig = {}
    for p in m.polygons:
        fc = tuple(face_color(p))
        for vi in p.vertices:
            k = (vi, fc)
            if k not in key2i:
                key2i[k] = len(out['pos'])
                if vi not in rig: rig[vi] = vert_rig(vi)
                r = rig[vi]
                out['pos'].append(to3(m.vertices[vi].co)); out['col'].append(fc)
                out['part'].append(float(r['part'])); out['partw'].append(float(r['partw'])); out['piv'].append(to3(r['pivot']))
                for n in extra_names: out[n].append(float(r.get(n, 0.0)))
            out['idx'].append(key2i[k])
    return out


def write_glb(path, tiers, generator, copyright, extras=None, extra_names=()):
    """tiers: [(name, emit() dict)]. Writes one mesh per tier with POSITION, COLOR_0 and _PART, _PARTW, _PIVOT
    (plus `_<NAME>` for each extra scalar attribute)."""
    buf = bytearray(); views = []; accs = []
    def add(data, target):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}); return len(views) - 1
    def acc_f(vals, n):
        flat = [x for v in vals for x in (tuple(v) if n > 1 else (v,))]
        a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3'}[n]}
        if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
        accs.append(a); return len(accs) - 1
    def acc_i(vals):
        big = max(vals) > 65535
        accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
        return len(accs) - 1
    meshes = []; nodes = []
    for name, t in tiers:
        attrs = {'POSITION': acc_f(t['pos'], 3), 'COLOR_0': acc_f(t['col'], 3), '_PART': acc_f(t['part'], 1),
                 '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f(t['piv'], 3)}
        for n in extra_names: attrs['_' + n.upper()] = acc_f(t[n], 1)
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
    while len(buf) % 4: buf.append(0)
    g = {'asset': {'version': '2.0', 'generator': generator, 'copyright': copyright},
         'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
         'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}], 'extras': extras or {}}
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
    open(path, 'wb').write(glb)
    print('WROTE', path, len(glb), 'bytes;', ', '.join(f'{n} {len(t["idx"]) // 3} tris' for n, t in tiers))
    return len(glb)


# ---- the quadruped template on a Quaternius skeleton (Ultimate Animated Animal Pack bone names) ----
# PART: BODY 0, LEG_A 1 (left fore + right hind), LEG_B 2 (right fore + left hind), TAIL 3, HEAD 6.
# The thigh (BackLeg) stays with the body, so hind legs pivot at the stifle (BackUpperLeg head) and fore legs
# at FrontUpperLeg, as tools/build_deer.py. The head part pivots at Neck1 and carries neck, head and ears.
def quaternius_cats(tail_bones, ear_bones):
    return {
        # the paws are skinned to the IK foot bones (FF, FFB), so they go with their leg
        'fl': (1, 'FrontUpperLeg.L', ('FrontUpperLeg.L', 'FrontLowerLeg.L', 'IKFrontLeg.L', 'FF.L')),
        'hr': (1, 'BackUpperLeg.R', ('BackUpperLeg.R', 'BackLowerLeg.R', 'IKBackLeg.R', 'FFB.R')),
        'fr': (2, 'FrontUpperLeg.R', ('FrontUpperLeg.R', 'FrontLowerLeg.R', 'IKFrontLeg.R', 'FF.R')),
        'hl': (2, 'BackUpperLeg.L', ('BackUpperLeg.L', 'BackLowerLeg.L', 'IKBackLeg.L', 'FFB.L')),
        'tail': (3, 'Tail1', tuple(tail_bones)),
        'head': (6, 'Neck1', ('Neck1', 'Neck2', 'Neck3', 'Head') + tuple(ear_bones)),
    }


def skin_reader(ob, cats):
    """vweights(v) -> ({category: normalised weight}, dominant bone name) from the mesh's vertex groups."""
    groups = {g.index: g.name for g in ob.vertex_groups}
    bone2cat = {b: c for c, (_, _, bs) in cats.items() for b in bs}
    all_bones = set(groups.values()) - {'protect'}
    def vweights(v):
        w = {}; tot = 0; best = (0, None)
        for g in v.groups:
            n = groups.get(g.group)
            if n is None or n not in all_bones: continue        # helper groups (e.g. 'protect')
            tot += g.weight
            if g.weight > best[0]: best = (g.weight, n)
            c = bone2cat.get(n)
            if c: w[c] = w.get(c, 0) + g.weight
        if tot > 0: w = {k: x / tot for k, x in w.items()}
        return w, best[1]
    return vweights


def skin_rig(m, cats, JS, vweights):
    """vert_rig for emit(): the dominant category's part id, its weight and its joint as pivot."""
    def rig(i):
        w, _ = vweights(m.vertices[i])
        if not w: return dict(part=0, partw=0.0, pivot=Vector((0, 0, 0)))
        c = max(w, key=w.get); pid, joint, _ = cats[c]
        return dict(part=pid, partw=min(1.0, w[c]), pivot=JS[joint])
    return rig


def remap_along(points, new_points, p, w=1.0, radial=1.0):
    """Move p from a tube around the polyline `points` to the same place around `new_points` (same count): the
    nearest arc fraction is kept, the offset from the axis is rotated with its segment and scaled by `radial`.
    w (0-1) blends from p (unmoved) to the remapped point. Used to lower, shorten and thin tails."""
    lens = [(points[i + 1] - points[i]).length for i in range(len(points) - 1)]; tot = sum(lens)
    nl = [(new_points[i + 1] - new_points[i]).length for i in range(len(new_points) - 1)]; ntot = sum(nl)
    d, t, q = poly_nearest(p, points)
    # which segment, and how far along it
    acc = 0.0; i = len(lens) - 1; u = 1.0
    for k, L in enumerate(lens):
        if acc + L >= t * tot - 1e-9: i = k; u = (t * tot - acc) / L if L else 0.0; break
        acc += L
    a, b = points[i], points[i + 1]; na, nb = new_points[i], new_points[i + 1]
    rot = (b - a).normalized().rotation_difference((nb - na).normalized())
    q_new = na + (nb - na) * u
    off = p - (a + (b - a) * u)
    p_new = q_new + rot @ (off * radial)
    return p.lerp(p_new, w)


def bent_axis(points, droop_deg, length_scale=1.0):
    """A new polyline from points[0]: each segment scaled by length_scale and turned down (about x) by
    droop_deg[i] degrees (a list, one per segment, or one number)."""
    from mathutils import Matrix
    n = len(points) - 1
    if not isinstance(droop_deg, (list, tuple)): droop_deg = [droop_deg] * n
    out = [points[0].copy()]
    for i in range(n):
        d = (points[i + 1] - points[i]) * length_scale
        d = Matrix.Rotation(-math.radians(droop_deg[i]), 3, 'X') @ d
        out.append(out[-1] + d)
    return out


# ---- helpers for generated (Meshy) meshes: no skeleton, so parts come from geometry ----
def import_glb_mesh(src, keep_fraction=0.02):
    """Import a GLB as one welded mesh object in Blender axes; drop loose islands smaller than keep_fraction
    of the faces (whisker strands, shards). Returns the object."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    sc = bpy.context.scene
    obs = [o for o in sc.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(sc.objects):
        if o is not ob: bpy.data.objects.remove(o)
    me = ob.data
    weld(me, 1e-5)
    bm = bmesh.new(); bm.from_mesh(me)
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
    tot = len(bm.faces); drop = [f for n in isl if len(n) < keep_fraction * tot for f in n]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    print('INFO islands', len(isl), 'dropped faces', len(drop), 'kept', len(me.polygons))
    return ob


def adjacency(me):
    adj = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices; adj[a].append(b); adj[b].append(a)
    return adj


def components(adj, members):
    """Connected components of the vertex set `members` (edges inside the set only)."""
    members = set(members); seen = set(); out = []
    for s in members:
        if s in seen: continue
        st = [s]; seen.add(s); c = []
        while st:
            v = st.pop(); c.append(v)
            for u in adj[v]:
                if u in members and u not in seen: seen.add(u); st.append(u)
        out.append(c)
    return sorted(out, key=len, reverse=True)


def tube_axis(me, adj, comp, roots, bins=24):
    """Axis polyline of a tube-like vertex set (a tail): edge-path distance from the root vertices, binned, the
    centroid of each bin. Returns (points, {vertex: arc fraction 0-1})."""
    comp = set(comp); dist = {r: 0.0 for r in roots if r in comp}
    import heapq
    h = [(0.0, r) for r in dist]; heapq.heapify(h)
    while h:
        d, v = heapq.heappop(h)
        if d > dist.get(v, 1e9): continue
        for u in adj[v]:
            if u in comp:
                nd = d + (me.vertices[u].co - me.vertices[v].co).length
                if nd < dist.get(u, 1e9): dist[u] = nd; heapq.heappush(h, (nd, u))
    dmax = max(dist.values())
    groups = [[] for _ in range(bins)]
    for v, d in dist.items(): groups[min(bins - 1, int(d / dmax * bins))].append(me.vertices[v].co)
    pts = [sum(g, Vector()) / len(g) for g in groups if g]
    return pts, {v: d / dmax for v, d in dist.items()}


def drop_thin(ob, max_thickness, region=None):
    """Delete modelled whisker strands: vertices where a ray cast inward along the normal leaves the surface again
    within max_thickness (a strand is a thin tube; the body is far thicker), optionally only where region(co) is
    true; then any loose bits. Returns the number of vertices removed."""
    from mathutils.bvhtree import BVHTree
    me = ob.data
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    bad = []
    for v in me.vertices:
        if region and not region(v.co): continue
        hit = bvh.ray_cast(v.co - v.normal * 1e-4, -v.normal, max_thickness)
        if hit[0] is not None: bad.append(v.index)
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in bad], context='VERTS')
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
    big = max(len(n) for n in isl)
    bmesh.ops.delete(bm, geom=[f for n in isl if len(n) < 0.01 * big for f in n], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    print('INFO thin (whisker) vertices removed', len(bad), 'pieces', len(isl))
    return len(bad)
