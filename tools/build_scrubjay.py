# Build client/assets/scrubjay.glb, the ambient California scrub-jay, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1719c-58de-73ad-9406-f115724514ac, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (20,862 triangles, untextured, one closed piece), 2026-10-25 UTC; job record in
#   library/animals/jobs/aphelocoma_californica/01a1719c-58de-73ad-9406-f115724514ac/job.json. Prompt:
#   "A California scrub-jay (Aphelocoma californica), one adult bird perched with its wings folded tight against the
#   body, side-on pose. Realistic proportions, about 29 cm long with a long tail half the body length. Crestless flat
#   crown. Bright blue head, wings and tail; grey-brown patch on the back; dark grey cheek with a thin white eyebrow;
#   white streaked throat bordered by a partial blue breast band; pale grey-white belly. Stout straight black bill,
#   long black legs, three toes forward and one back. No base, no perch. Game-ready, clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_scrubjay.py -- \
#       library/animals/jobs/aphelocoma_californica/01a1719c-58de-73ad-9406-f115724514ac/model.glb \
#       client/assets/scrubjay.glb [--preview /tmp/jay_preview]
#
# What it does (brief: library/animals/drafts/aphelocoma_californica.md): scales to 0.29 m bill to tail; thickens the
# bill base (1.45x at the gape tapering to 1.1x at the tip) so it reads stout rather than thrasher-thin; sands the
# nape nub; widens the tail toward its tip (1.25x) and blends it free of the folded wingtips (its own part, weighted
# over its base); deletes the generated legs and flat feet and adds black procedural legs with three forward toes
# and a hind toe that curl down at the tips; adds a small dark eye; recolours by region from the brief's sRGB field
# marks (blue head, wings, rump and tail, grey-brown mantle, dark ear patch with a white brow, white streaked throat
# edged by the blue necklace, pale grey-white underparts, pale undertail, black bill and legs); adds flight wing cards
# (an arm and a hand per side, blue above and grey below) that the client collapses into the shoulder when the bird
# is perched (pose 1). Decimates (Blender collapse, X symmetry) to three tiers: lod0 ~1,000, lod1 ~400, lod2 ~120
# triangles including legs and wing cards (no eyes beyond lod0). Each vertex carries the bird rig template's part
# (animalModels.js PART: BODY, LEG_A/B, TAIL, WING_L/R, HEAD, HAND_L/R), the part's weight and its pivot as custom
# attributes _PART, _PARTW, _PIVOT; the rig's parent pivots (wing shoulder) are in the GLB's extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (side, top, front, three-quarter; workbench, vertex colour) to <prefix>_*.png.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1719c-58de-73ad-9406-f115724514ac'
LENGTH = 0.29                          # bill tip to tail tip (m)
TIERS = [('lod0', 1000), ('lod1', 400), ('lod2', 120)]

# Part ids (animalModels.js PART)
BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# brief section 1 (sRGB)
BLUE, TAILB, MANTLE, UNDER, THROAT, NECKL, EAR, BLACK = 0x2f5fae, 0x24498a, 0x8a8074, 0xd9d6cf, 0xeeece6, 0x3a64a8, 0x4a4e58, 0x1b1b1f
STREAK, UNDERTAIL, PRIMARY, WINGUNDER, EYEC = 0xc6c6c2, 0xb4bfcd, 0x27508f, 0x8a8f99, 0x0d0d0f

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
bird = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = bird.data
# Raw frame after import: x the bird's left, -y forward (f = -y), +z up; about 1.9 units long.
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
F = lambda v: -v.co.y

# legs and feet: everything under the belly forward of the tail; the procedural legs replace them
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.205 and F(v) > 0.0], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)

# bill: thicker at the base, tapering to the tip, about the bill's own axis
BILL0, BILL1, BZ0, BZ1 = 0.775, 0.946, 0.398, 0.376
for v in bm.verts:
    f = F(v)
    if f < 0.735: continue
    t = max(0.0, min(1.0, (f - BILL0) / (BILL1 - BILL0)))
    k = 1.45 - 0.35 * t if f >= BILL0 else 1 + 0.45 * smooth(0.735, BILL0, f)
    zc = BZ0 + (BZ1 - BZ0) * t
    v.co.x *= k; v.co.z = zc + (v.co.z - zc) * k
# nape nub: relax the crown behind the eye
nape = [v for v in bm.verts if v.co.z > 0.43 and 0.49 < F(v) < 0.63]
for _ in range(12): bmesh.ops.smooth_vert(bm, verts=nape, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# tail: wider toward the tip (it is narrow in plan)
for v in bm.verts:
    f = F(v)
    if f < -0.30: v.co.x *= 1 + 0.25 * min(1.0, (-0.30 - f) / 0.5)
bm.to_mesh(me); bm.free(); me.update()

# ---- to metres, three.js axes ---------------------------------------------------------------------
fs = [-v.co.y for v in me.vertices]
S = LENGTH / (max(fs) - min(fs))
GROUND = -0.479                        # the generated toes' underside
for v in me.vertices: v.co = Vector((v.co.x * S, v.co.y * S, (v.co.z - GROUND) * S))
def M(f, z, x=0.0): return Vector((x * S, (z - GROUND) * S, f * S))     # raw (f, z) -> three.js (x, y, z)
def to3(p): return Vector((p.x, p.z, -p.y))                            # blender (scaled) -> three.js

# landmarks (raw, measured on side and front renders of the candidate) in three.js metres
EYE = M(0.720, 0.4256)
BILLBASE = M(0.775, 0.40)
NECK_PIV = M(0.55, 0.22)
TAIL_PIV = M(-0.24, -0.03)
SHOULDER = Vector((0.026, M(0.35, 0.2).y, M(0.35, 0.2).z))
KNEE = Vector((0.018, 0.046, 0.034))   # procedural leg: hip/knee hidden in the belly feathers
ANKLE = Vector((0.019, 0.007, 0.052))
def wing_line(z3):                     # lower edge of the folded wing, three.js y at forward z3
    f = z3 / S
    zr = 0.036 + (0.155 * f if f > 0 else 0.35 * f)
    return (zr - GROUND) * S

# eye placement on the surface (ray from outside)
bvh = BVHTree.FromObject(bird, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(Vector((0.2, -EYE.z, EYE.y)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.0085
print('eye surface x', EYE_X)

def head_w(p):     # head weight from the neck axis (p: three.js)
    d = Vector((0, 0.8, 0.6)); t = (p - NECK_PIV).dot(d) / S
    return smooth(0.08, 0.18, t)
def tail_w(p): return smooth(-0.22, -0.36, p.z / S) if p.z < 0 else 0.0

def face_color(c, n, hw, tw):
    X, Y, Z = abs(c.x), c.y, c.z
    if hw > 0.12:
        if Z > BILLBASE.z - 0.001 and Y > BILLBASE.y - 0.009: return BLACK
        side = abs(n.x) > 0.45
        if side and EYE.z - 0.015 < Z < EYE.z + 0.0015 and EYE.y - 0.009 < Y < EYE.y + 0.0015: return EAR
        if side and EYE.z - 0.014 < Z < EYE.z + 0.008 and EYE.y + 0.0015 <= Y < EYE.y + 0.0055: return THROAT   # brow
        if Y < EYE.y - 0.009 and (n.y < -0.25 or (n.z > 0.4 and abs(n.x) < 0.6)) and Z > EYE.z - 0.022:
            return STREAK if (int(c.x * 900) + int(Y * 700)) % 5 == 0 else THROAT
        return BLUE
    if tw > 0.5:
        return TAILB if n.y > -0.25 else UNDERTAIL
    neck_y = 0.098
    if n.z > 0.15 and abs(n.x) < 0.6 and Z > 0.06 and Y > neck_y - 0.006:
        if Y < neck_y + 0.004 and X > 0.003: return NECKL                         # the partial breast band
        if Y >= neck_y + 0.004: return STREAK if (int(c.x * 900) + int(Y * 700)) % 6 == 0 else THROAT
    if n.y > 0.45 and -0.03 < Z < 0.072 and X < 0.0125: return MANTLE
    if Y > wing_line(Z) and (abs(n.x) > 0.2 or n.y > 0.2):
        return PRIMARY if Z < -0.02 else BLUE
    if Z < -0.025 and n.y > 0.2: return BLUE                                         # rump
    if Z < -0.02 and n.y < -0.2: return UNDERTAIL
    return UNDER

# ---- procedural parts (three.js metres) -------------------------------------------------------------
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

def legs(ex, level):
    for s in (1, -1):
        part = LEG_A if s > 0 else LEG_B
        K = Vector((s * KNEE.x, KNEE.y, KNEE.z)); A = Vector((s * ANKLE.x, ANKLE.y, ANKLE.z))
        if level == 2:
            ex.tube([K, A + Vector((0, -0.006, 0.004))], [0.0016, 0], BLACK, part, 1.0, K); continue
        ex.tube([K, A], [0.0017, 0.0013], BLACK, part, 1.0, K, cap=False)
        toes = [(-0.42, 0.021), (0.0, 0.024), (0.42, 0.021), (math.pi, 0.013)]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.8, 0, math.cos(ang)))
            if level == 0:   # two segments, the tip curled down
                p1 = A + d * (ln * 0.55) + Vector((0, -0.0045, 0)); p2 = A + d * ln + Vector((0, -0.0075, 0))
                ex.tube([A, p1, p2], [0.0011, 0.0009, 0], BLACK, part, 1.0, K)
            else:
                ex.tube([A, A + d * ln + Vector((0, -0.0065, 0))], [0.001, 0], BLACK, part, 1.0, K)

def wings(ex, level):
    W = SHOULDER
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + 0.07), W.y, W.z))
        P = lambda dx, dz: Vector((s * (W.x + dx), W.y, W.z + dz))
        arm = [P(0, 0.016), P(0.07, 0.013), P(0.07, -0.058), P(0, -0.062)]
        hand = [P(0.07, 0.013), P(0.128, 0.009), P(0.163, -0.006), P(0.168, -0.028), P(0.142, -0.05), P(0.07, -0.058)]
        if level == 2:
            full = [P(0, 0.016), P(0.15, 0.006), P(0.165, -0.03), P(0, -0.062)]
            ex.card(full, BLUE, WINGUNDER, WING_L if s > 0 else WING_R, piv)
            continue
        ex.card(arm, BLUE, WINGUNDER, WING_L if s > 0 else WING_R, piv)
        ex.card(hand, PRIMARY, WINGUNDER, HAND_L if s > 0 else HAND_R, wrist)

def eyes(ex):
    for s in (1, -1):
        c = Vector((s * (EYE_X - 0.0006), EYE.y, EYE.z))
        ex.ellipsoid(c, Vector((0.0016, 0.0026, 0.0028)), EYEC, HEAD, 1.0, NECK_PIV)

# ---- tiers ---------------------------------------------------------------------------------------------
def build(level, target):
    ex = Extra(); legs(ex, level); wings(ex, level)
    if level == 0: eyes(ex)
    body_target = target - len(ex.tris)
    ob = bird.copy(); ob.data = bird.data.copy(); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    m = ob.data; n0 = len(m.polygons)
    d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = body_target / n0
    d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m); bm.free(); m.update()
    pos = []; col = []; part = []; partw = []; piv = []; idx = []; key2i = {}
    P3 = [to3(v.co) for v in m.vertices]
    def tag(p):
        hw, tw = head_w(p), tail_w(p)
        if hw > 0: return HEAD, hw, NECK_PIV
        if tw > 0: return TAIL, tw, TAIL_PIV
        return BODY, 0.0, Vector()
    for p in m.polygons:
        c = sum((P3[i] for i in p.vertices), Vector()) / 3
        nb = p.normal; n = Vector((nb.x, nb.z, -nb.y))
        fc = srgb2lin(face_color(c, n, head_w(c), tail_w(c)))
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
    bpy.data.objects.remove(ob)
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, legs/wings/eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
RIG = {'kind': 'bird', 'wing': list(SHOULDER), 'tail': list(TAIL_PIV), 'head': list(NECK_PIV), 'length_m': LENGTH}

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
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_scrubjay.py (Blender)',
                  'copyright': f'California scrub-jay: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (scaled, fixed, recoloured, decimated) by wild-earth tools/build_scrubjay.py'},
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
    bird.hide_render = True
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
        for view, ctr, d, scale in [('side', (0, 0, 0.08), (1, 0, 0.0), 0.36), ('top', (0, 0, 0.08), (0.001, 0, 1), 0.42),
                                    ('front', (0, -0.08, 0.1), (0.0, -1, 0.1), 0.2), ('q', (0, -0.02, 0.08), (0.8, -0.7, 0.45), 0.36),
                                    ('head', (0, -0.11, 0.125), (1, -0.25, 0.1), 0.09)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 3
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
