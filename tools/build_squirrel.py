# Build client/assets/squirrel.glb, the ambient western gray squirrel, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1719c-5a96-7616-b1c1-cc04ae57786c, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (20,850 triangles, untextured), 2026-10-25 UTC; job record in
#   library/animals/jobs/sciurus_griseus/01a1719c-5a96-7616-b1c1-cc04ae57786c/job.json. Prompt:
#   "A western gray squirrel (Sciurus griseus), single adult standing on all fours, side-on neutral pose, legs straight
#   under the body, head level, tail held straight out behind and slightly raised, fully fluffed. Realistic
#   proportions: 55 cm long, half of it tail; slim body; large rounded ears with no ear tufts. Silver gunmetal-grey
#   back and flanks, pure white belly and chin with a sharp flank line, no brown or orange anywhere. Very long broad
#   flat bushy tail, grey with a black inner band and a white fringe. Dark eye with a thin pale eye ring. No base, no
#   ground. Game-ready, symmetric."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_squirrel.py -- \
#       library/animals/jobs/sciurus_griseus/01a1719c-5a96-7616-b1c1-cc04ae57786c/model.glb \
#       client/assets/squirrel.glb [--preview /tmp/squirrel_preview]
#
# What it does (brief: library/animals/drafts/sciurus_griseus.md): removes the whisker strands; removes the generated
# tail, a round sausage curled in an S whose rising third is fused to the rump along a seam (it cannot be straightened
# without tearing the rump), and lofts a new one along a spline from the same root: straight back and gently rising,
# 0.27 m long, a broad flat plume 2.2 times wider than deep past its base (2.5 read as a stick from the side), with a lumpy outline, a grey core, a dark
# band and a white fringe ring of faces; slims the pear-shaped haunches (0.85x across); opens the eyes (the generator
# modelled closed lids) with a dark eye and a pale ring; scales head and body to 0.27 m (0.55 m with the tail);
# recolours by region from the brief's sRGB field marks (silver-grey back, crown and outer legs, darker flanks, pure
# white chin, throat, chest, belly and inner legs with a sharp flank line, dark nose; no brown anywhere).
# Decimates (Blender collapse, X symmetry) to three tiers: lod0 ~1,500, lod1 ~600, lod2 ~200 triangles, about a
# quarter of each in the tail (eyes in lod0 only). Each vertex carries the rodent rig template's part
# (animalModels.js PART: BODY hindquarters, LEG_A fore pair, LEG_B hind pair, TAIL, HEAD, CHEST, TAIL_TIP), the
# part's weight and its pivot (_PART, _PARTW, _PIVOT); the one-level parent chain (head and fore legs follow the
# chest, the tail tip follows the tail) reads the parent pivots from extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (workbench, vertex colour) to <prefix>_*.png.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1719c-5a96-7616-b1c1-cc04ae57786c'
HEADBODY = 0.27                        # nose to rump (m)
TAIL_LEN = 0.27                        # tail along its curve (m)
TIERS = [('lod0', 1500, 12, 16), ('lod1', 600, 8, 10), ('lod2', 200, 4, 5)]   # name, triangles, tail sides, tail rings

BODY, LEG_A, LEG_B, TAIL, HEAD, CHEST, TAIL_TIP = 0, 1, 2, 3, 6, 7, 8

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# brief section 1 (sRGB), the greys and whites about 10% darker than the brief's (#8a8d92 back, #eeeeea belly,
# #e4e4e2 fringe), which read near-white under the client's midday sun; no brown: the winter ear backs are left grey
BACK, FLANK, WHITE, CORE, BAND, FRINGE, EYEC, RING = 0x7c7f84, 0x63666b, 0xe6e6e2, 0x64676c, 0x26272a, 0xd8d8d6, 0x141414, 0xe6e2da
NOSE, EARIN, TOES = 0x4a4a4e, 0x9c9c9a, 0x7a7c80

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# ---- load and weld --------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
obs = [o for o in sc.objects if o.type == 'MESH']
src_meta = {'generator': 'Khronos glTF Blender I/O (Meshy export)', 'mesh': obs[0].name}
bpy.ops.object.select_all(action='DESELECT')
for o in obs: o.select_set(True)
bpy.context.view_layer.objects.active = obs[0]
if len(obs) > 1: bpy.ops.object.join()
sq = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = sq.data
# Raw frame after import: x the squirrel's left, -y forward (f = -y), +z up; about 1.9 units long.
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
F = lambda v: -v.co.y

# whiskers: thin strands on the muzzle, found by their thickness (a ray cast inward from each vertex hits the far
# side of a strand within a few millimetres; the muzzle is centimetres thick)
bm.normal_update()
tbvh = BVHTree.FromBMesh(bm)
dele = set()
for v in bm.verts:
    if F(v) > 0.74 and 0.08 < v.co.z < 0.40:
        n = v.normal
        h = tbvh.ray_cast(v.co - n * 1e-4, -n, 0.05)
        if h[0] is not None and h[3] < 0.012: dele.add(v)
print('whisker vertices', len(dele))
# tail: everything behind the seam where it meets the rump (a polyline in the side view)
SEAM = [(0.60, -0.194), (0.1375, -0.194), (-0.1125, -0.3125), (-0.35, -0.275)]   # (z, f) top to bottom
def seam_f(z):
    if z >= SEAM[1][0]: return SEAM[1][1]
    for (z0, f0), (z1, f1) in zip(SEAM[1:], SEAM[2:]):
        if z1 <= z <= z0: return f0 + (f1 - f0) * (z0 - z) / (z0 - z1)
    return -9.0
dele |= {v for v in bm.verts if F(v) < seam_f(v.co.z)}
print('deleting', len(dele), 'of', len(bm.verts))
bmesh.ops.delete(bm, geom=list(dele), context='VERTS')
# small loose pieces (whisker tips)
bm.verts.ensure_lookup_table()
seen = set()
for v in list(bm.verts):
    if v in seen: continue
    comp = []; st = [v]; seen.add(v)
    while st:
        x = st.pop(); comp.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y not in seen: seen.add(y); st.append(y)
    if len(comp) < 200: bmesh.ops.delete(bm, geom=comp, context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
# relax the patch where the tail was
patch = [v for v in bm.verts if F(v) < seam_f(v.co.z) + 0.06 and v.co.z > -0.38]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=patch, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# slimmer haunches
for v in bm.verts:
    f, z = F(v), v.co.z
    w = smooth(-0.40, -0.30, z) * max(0.0, 1 - abs(f + 0.05) / 0.36)
    v.co.x *= 1 - 0.15 * w
bm.to_mesh(me); bm.free(); me.update()

# ---- to metres, three.js axes ---------------------------------------------------------------------
fs = [-v.co.y for v in me.vertices]
S = HEADBODY / (max(fs) - min(fs))
GROUND = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co = Vector((v.co.x * S, v.co.y * S, (v.co.z - GROUND) * S))
def M(f, z, x=0.0): return Vector((x * S, (z - GROUND) * S, f * S))
def RAW(p): return p.x / S, p.z / S, p.y / S + GROUND        # three.js -> raw (x, f, z)
def to3(p): return Vector((p.x, p.z, -p.y))
print('scale', S, 'ground', GROUND)
bvh = BVHTree.FromObject(sq, bpy.context.evaluated_depsgraph_get())
def surface(o3, d3):
    h = bvh.ray_cast(Vector((o3.x, -o3.z, o3.y)), Vector((d3.x, -d3.z, d3.y)))[0]
    return to3(h) if h else None

EYE = M(0.7725, 0.321)
EYE_X = (surface(Vector((0.1, EYE.y, EYE.z)), Vector((-1, 0, 0))) or Vector((0.02, 0, 0))).x
NECK_PIV = M(0.50, 0.08)
CHEST_PIV = M(0.08, 0.0)
FORE_PIV = M(0.43, -0.02, 0.10)
HIND_PIV = M(0.0, -0.20, 0.17)
TAIL_ROOT = M(-0.255, -0.03)
print('eye x', EYE_X)

def head_w(p):
    _, f, z = RAW(p); t = (f - 0.50) * 0.8 + (z - 0.08) * 0.6
    return smooth(0.04, 0.14, t)
def chest_w(p): return smooth(0.0, 0.22, RAW(p)[1])
def fore_w(p):
    _, f, z = RAW(p)
    return smooth(-0.10, -0.22, z) if 0.28 < f < 0.72 else 0.0
def hind_w(p):
    _, f, z = RAW(p)
    return smooth(-0.30, -0.40, z) if -0.25 < f < 0.25 else 0.0

def face_color(c, n):
    x, f, z = RAW(c); X = abs(x)
    hw = head_w(c)
    e = c - EYE; er = math.hypot((e.z) / 0.0105, (e.y) / 0.0085)
    if hw > 0.3:
        if er < 1.0 and abs(n.x) > 0.3: return RING
        if f > 0.915 and 0.19 < z < 0.30: return NOSE
        if z > 0.34 and 0.53 < f < 0.72:                       # ears
            return EARIN if n.z > 0.35 else BACK
        if n.y < -0.3 or (f > 0.62 and z < 0.17 and n.y < 0.2): return WHITE      # chin and throat
        return BACK
    if z < -0.44: return TOES
    fw, hdw = fore_w(c), hind_w(c)
    if (fw > 0.5 or hdw > 0.5) and abs(n.x) > 0.3 and (n.x > 0) != (c.x > 0): return WHITE   # inner legs
    if n.y < -0.35: return WHITE                                                            # belly
    if f > 0.33 and n.z > 0.45 and z < 0.05: return WHITE                                   # chest
    if z < -0.30 and abs(n.x) > 0.4 and fw < 0.5 and hdw < 0.5: return WHITE                # below the flank line
    if abs(n.x) > 0.5 and -0.30 <= z < -0.02: return FLANK
    return BACK

# ---- the tail: a plume lofted along a spline ---------------------------------------------------------
def tail_frame(u):
    """Centre, tangent and the in-plane normal at u in [0, 1] along the tail."""
    th0, th1 = math.radians(20), math.radians(48)
    n = 64; p = Vector(TAIL_ROOT); out = None
    for i in range(n + 1):
        uu = i / n
        th = th0 + (th1 - th0) * uu ** 1.4
        T = Vector((0, math.sin(th), -math.cos(th)))
        if out is None and uu >= u - 1e-9: out = (p.copy(), T, Vector((0, math.cos(th), math.sin(th))))
        p += T * (TAIL_LEN / n)
    return out
def tail_width(u):
    hw = 0.018 + 0.042 * smooth(0.0, 0.5, u)
    if u > 0.82: hw *= math.sqrt(max(0.0, 1 - ((u - 0.82) / 0.18) ** 2))
    hd = hw * (1 - 0.55 * smooth(0.0, 0.35, u))   # 2.2:1 past the base
    return hw, hd
TIP_U = 0.42
TIP_PIV = tail_frame(TIP_U)[0]
def tail_tag(u):
    tw = smooth(0.35, 0.5, u)
    if tw > 0: return TAIL_TIP, tw, TIP_PIV
    return TAIL, smooth(-0.02, 0.1, u), TAIL_ROOT

def plume(sides, rings):
    tris = []
    us = [math.sin(0.5 * math.pi * i / (rings - 1)) for i in range(rings)]
    R = []
    for u in us:
        C, T, N = tail_frame(u); hw, hd = tail_width(u)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            lump = 1 + 0.07 * math.sin(5 * a + 6.0 * u) * math.sin(math.pi * u)
            ring.append((C + Vector((hw * math.cos(a) * lump, 0, 0)) + N * (hd * math.sin(a) * lump), a, u))
        R.append((C, ring))
    def col(a_mid, u):
        ca = abs(math.cos(a_mid))
        if u < 0.12: return CORE
        if ca > (0.86 if sides > 8 else 0.8): return FRINGE
        if ca > 0.6: return BAND
        return CORE
    for i in range(rings - 1):
        (c0, r0), (c1, r1) = R[i], R[i + 1]
        m = (c0 + c1) / 2
        for k in range(sides):
            a, b = r0[k], r0[(k + 1) % sides]; c, d = r1[k], r1[(k + 1) % sides]
            am = (a[1] + b[1]) / 2 if k < sides - 1 else a[1] + math.pi / sides
            h = col(am, (a[2] + c[2]) / 2)
            tris.append((a[0], b[0], d[0], h, m, ((a[2], b[2], d[2])))); tris.append((a[0], d[0], c[0], h, m, (a[2], d[2], c[2])))
    C, T, _ = tail_frame(1.0)
    tipc = R[-1][0] + T * 0.004
    for k in range(sides):
        a, b = R[-1][1][k], R[-1][1][(k + 1) % sides]
        tris.append((a[0], b[0], tipc, FRINGE, R[-1][0], (a[2], b[2], 1.0)))
    # root cap (inside the rump)
    for k in range(sides):
        a, b = R[0][1][k], R[0][1][(k + 1) % sides]
        tris.append((b[0], a[0], R[0][0], CORE, R[0][0] + tail_frame(0.0)[1] * 0.01, (0.0, 0.0, 0.0)))
    return tris

def eyes(ex):
    for s in (1, -1):
        c = Vector((s * (abs(EYE_X) + 0.0004), EYE.y, EYE.z))
        ex.ellipsoid(c, Vector((0.0028, 0.0045, 0.0056)), EYEC, HEAD, 1.0, NECK_PIV)
class Extra:
    def __init__(self): self.tris = []        # (p0, p1, p2, colour hex, part, weight, pivot)
    def tri(self, a, b, c, col, part, w, piv, away=None):
        a, b, c = Vector(a), Vector(b), Vector(c)
        if away is not None and (b - a).cross(c - a).dot((a + b + c) / 3 - away) < 0: b, c = c, b   # face away from `away`
        self.tris.append((a, b, c, col, part, w, Vector(piv)))
    def tube(self, pts, radii, col, part, w, piv, sides=3, cap=True):
        """Tapered tube along pts; the last radius may be 0 (a point)."""
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = t.cross(a).normalized(); v = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        for i in range(len(pts) - 1):
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                m = (pts[i] + pts[i + 1]) / 2
                if radii[i + 1] == 0: self.tri(a, b, pts[i + 1], col, part, w, piv, m)
                else: self.tri(a, b, d, col, part, w, piv, m); self.tri(a, d, c2, col, part, w, piv, m)
    def card(self, poly, col_top, col_bot, part, piv, thick=0.0012):
        """A flat polygon (list of three.js points, wound so its normal is +y when seen from above), two-sided."""
        n = len(poly); off = Vector((0, thick, 0))
        for i in range(1, n - 1):
            c = (poly[0] + poly[i] + poly[i + 1]) / 3
            self.tri(poly[0] + off, poly[i] + off, poly[i + 1] + off, col_top, part, 1.0, piv, c - Vector((0, 1, 0)))
            self.tri(poly[0], poly[i], poly[i + 1], col_bot, part, 1.0, piv, c + Vector((0, 1, 0)))
    def ellipsoid(self, c, r, col, part, w, piv):
        """An octahedron (8 triangles) scaled to radii r."""
        P = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            self.tri(P[a], P[b], P[4], col, part, w, piv, c); self.tri(P[b], P[a], P[5], col, part, w, piv, c)


# ---- tiers ---------------------------------------------------------------------------------------------
def build(level, target, sides, rings):
    ex = Extra()
    if level == 0: eyes(ex)
    ptris = plume(sides, rings)
    body_target = target - len(ex.tris) - len(ptris)
    ob = sq.copy(); ob.data = sq.data.copy(); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    m = ob.data; n0 = len(m.polygons)
    d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = body_target / n0
    d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m); bm.free(); m.update()
    pos = []; col = []; part = []; partw = []; piv = []; idx = []; key2i = {}
    P3 = [to3(v.co) for v in m.vertices]
    def tag(p):
        hw = head_w(p)
        if hw > 0: return HEAD, hw, NECK_PIV
        fw = fore_w(p)
        if fw > 0: return LEG_A, fw, Vector((math.copysign(FORE_PIV.x, p.x), FORE_PIV.y, FORE_PIV.z))
        hdw = hind_w(p)
        if hdw > 0: return LEG_B, hdw, Vector((math.copysign(HIND_PIV.x, p.x), HIND_PIV.y, HIND_PIV.z))
        cw = chest_w(p)
        if cw > 0: return CHEST, cw, CHEST_PIV
        return BODY, 0.0, Vector()
    for p in m.polygons:
        c = sum((P3[i] for i in p.vertices), Vector()) / 3
        nb = p.normal; n = Vector((nb.x, nb.z, -nb.y))
        fc = srgb2lin(face_color(c, n))
        for vi in p.vertices:
            k = (vi, fc)
            if k not in key2i:
                key2i[k] = len(pos); pos.append(P3[vi]); col.append(fc)
                pt, w, pv = tag(P3[vi]); part.append(float(pt)); partw.append(w); piv.append(pv)
            idx.append(key2i[k])
    nbody = len(idx) // 3
    for a, b, c, h, pt, w, pv in ex.tris:
        fc = srgb2lin(h)
        for p in (a, b, c):
            idx.append(len(pos)); pos.append(p); col.append(fc); part.append(float(pt)); partw.append(w); piv.append(pv)
    for a, b, c, h, mid_, us in ptris:
        if (b - a).cross(c - a).dot((a + b + c) / 3 - mid_) < 0: b, c = c, b; us = (us[0], us[2], us[1])
        fc = srgb2lin(h)
        for p, u in zip((a, b, c), us):
            pt, w, pv = tail_tag(u)
            idx.append(len(pos)); pos.append(p); col.append(fc); part.append(float(pt)); partw.append(w); piv.append(pv)
    bpy.data.objects.remove(ob)
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, tail {len(ptris)}, eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t, s, r)) for i, (name, t, s, r) in enumerate(TIERS)]
RIG = {'kind': 'rodent', 'chest': list(CHEST_PIV), 'tail': list(TAIL_ROOT), 'tail_tip': list(TIP_PIV), 'head': list(NECK_PIV),
       'fore': list(FORE_PIV), 'hind': list(HIND_PIV), 'length_m': HEADBODY + TAIL_LEN}

# ---- minimal GLB writer: one buffer, one mesh per tier, custom attributes _PART, _PARTW, _PIVOT ----
buf = bytearray(); views = []; accs = []
def add(data_bytes, target=None):
    while len(buf) % 4: buf.append(0)
    off = len(buf); buf.extend(data_bytes)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data_bytes)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def acc_f(vals, n):
    flat = [x for v in vals for x in (v[:] if n > 1 else [v])]
    a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3'}[n]}
    if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
    accs.append(a); return len(accs) - 1
def acc_i(vals):
    big = max(vals) > 65535
    accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
    return len(accs) - 1
meshes = []; nodes = []
for name, t in tiers:
    attrs = {'POSITION': acc_f([tuple(p) for p in t['pos']], 3), 'COLOR_0': acc_f(t['col'], 3),
             '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f([tuple(p) for p in t['piv']], 3)}
    meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
while len(buf) % 4: buf.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_squirrel.py (Blender)',
                  'copyright': f'Western gray squirrel: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (new tail, fixed, recoloured, decimated) by wild-earth tools/build_squirrel.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'rig': RIG, 'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview', **src_meta,
                                          'ai_generated': True, 'meshy_metadata': 'none embedded in the source GLB'}}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb))

# ---- optional preview: each tier with its vertex colours, workbench ----
if PREVIEW:
    sq.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for name, t in tiers:
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t['col']): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, scale in [('side', (0, 0.05, 0.12), (1, 0, 0.0), 0.6), ('top', (0, 0.05, 0.1), (0.001, 0, 1), 0.62),
                                    ('front', (0, -0.1, 0.1), (0.0, -1, 0.1), 0.3), ('q', (0, 0.03, 0.1), (0.8, -0.7, 0.45), 0.6),
                                    ('head', (0, -0.15, 0.13), (1, -0.4, 0.15), 0.14), ('rear', (0, 0.1, 0.12), (0.5, 1, 0.4), 0.5)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 3
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
