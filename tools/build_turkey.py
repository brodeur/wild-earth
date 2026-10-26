# Build client/assets/turkey.glb, the wild turkey (Meleagris gallopavo, the Rio Grande / Merriam's mix of the Sierra
# foothills), from two Meshy text-to-3D jobs.
#
# Sources (Meshy, meshy.ai; job records in library/animals/jobs/meleagris_gallopavo/<task>/job.json):
#   body  refine 01a179c6-3c31-7276-8720-4254f8651097 (2K base-colour texture, 30,664 triangles) of preview
#         01a179c3-b065-7483-b2b3-012571102311 (ai_model latest, triangle remesh to 30,000): a walking tom with the tail
#         folded shut and the wings folded on the back, but the head hunched into the breast and no neck, legs mid-run.
#   head  preview 01a179be-b056-7695-a6dd-a7aa6d1cda04 (ai_model latest, no remesh, 2,662,902 triangles, untextured):
#         an upright tom with a long S-necked head, snood, wattles and caruncles, but a strut fan and drooping wings.
#   2026-10-26 UTC, prompts in the job records and library/animals/meleagris_gallopavo.json. 50 credits in all.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; these files carried none (asset.generator only: "pygltflib@v1.16.5" and
#   "xpostprocessing", kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_turkey.py -- \
#       library/animals/jobs/meleagris_gallopavo/01a179c6-3c31-7276-8720-4254f8651097/model.glb \
#       library/animals/jobs/meleagris_gallopavo/01a179be-b056-7695-a6dd-a7aa6d1cda04/model.glb \
#       client/assets/turkey.glb [--preview <prefix>]
#
# What it does (brief: library/animals/drafts/meleagris_gallopavo.md): takes the body, folded wings and folded tail of
# the refined job and deletes its hunched head, beard and running legs; grafts on the head and neck of the first
# preview (cut above the breast, the neck stretched to the alert walk, the base sunk into the breast and the parts
# inside the body removed); adds a procedural beard on the breast, eyes, and long pink-grey procedural legs (a
# feathered drumstick to the intertarsal joint, a bare tarsus with a spur, three long forward toes and a hind toe);
# scales to 1.10 m bill tip to tail tip measured along the spine and stands it so the top of the head is 0.95 m up.
# Colour: the body faces take the refine's texture (sampled per face) graded from its near-black to bronze, so the
# white-barred secondaries and the scaled breast keep the generated pattern; the head and legs are coloured per region
# from the brief's sRGB field marks (pale blue-white crown, blue-grey face, red wattles, snood and caruncles, horn
# bill). A second colour set (_COLORB) draws a hen: duller lighter brown, grey-brown feathered-looking head and neck
# with a small pink wattle, the beard in breast colour. Wing cards for the flush (an arm and a hand per side, barred
# black and white over bronze coverts, grey-brown below) collapse into the shoulder on the ground.
# Decimates (Blender collapse, X symmetry) to three tiers, body and head separately: lod0 ~3,000, lod1 ~900,
# lod2 ~300 triangles including legs, beard, wing cards and eyes (eyes in lod0 only); lod2 draws a procedural neck and
# head (the graft falls apart below ~100 triangles). Faces on non-manifold edges are deleted and filled first, or the
# collapse stalls at ~800 triangles.
# Each vertex carries the bird rig template's part (animalModels.js PART: BODY, LEG_A/B, TAIL, WING_L/R, HEAD,
# HAND_L/R), the part's weight and its pivot (_PART, _PARTW, _PIVOT); the rig's pivots are in extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (tom and hen; workbench, vertex colour) to <prefix>_*.png. --rawtex (debug): the
# body's texture colours ungraded.
import bpy, bmesh, sys, json, struct, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

argv = sys.argv[sys.argv.index('--') + 1:]
SRC_BODY, SRC_HEAD, OUT = argv[0], argv[1], argv[2]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
RAWTEX = '--rawtex' in argv              # debug: the texture's colours ungraded
JOB_BODY, JOB_BODY_PREVIEW, JOB_HEAD = '01a179c6-3c31-7276-8720-4254f8651097', '01a179c3-b065-7483-b2b3-012571102311', '01a179be-b056-7695-a6dd-a7aa6d1cda04'
LENGTH = 1.10                          # bill tip to tail tip along the spine (m)
HEIGHT = 0.95                          # ground to the top of the head, alert walk (m)
BODY_SQ = 1.12                         # vertical scale of the generated body about the belly: a deeper tom's body
TAIL_ROOT, TAIL_STRETCH = -0.47, 1.8    # the folded tail is short (0.2 m): stretch it behind the rump toward 0.3 m
PITCH = math.radians(10)               # walking posture: the body tilted nose-up about the hip, back sloping to the tail
PIVOT_FZ = (0.10, -0.05)               # (f, z) of the hip in the body job
TAIL_LIFT = math.radians(14)           # the tail raised back toward the line of the back
TAIL_ROOT_Z = 0.13
TIERS = [('lod0', 3000), ('lod1', 900), ('lod2', 300)]
HEAD_SHARE = [0.20, 0.20, 0.28]        # share of each tier's mesh budget given to the head and neck
# head graft, in the head job's raw frame (x left, f forward = -y, z up; 1.9 units tall)
H_CUT = 0.37                           # keep the head job above this z ...
H_NECK = (0.47, 0.70)                  # ... and stretch the neck between these z
NECK_STRETCH = 2.7
H_BASE = Vector((0.0, 0.47, 0.42))     # (x, f, z) of the neck's base in the head job
G_SCALE = 0.85                         # head job units -> body job units
NECK_TILT = math.radians(-6)           # lean the neck forward (about x)
B_BASE = Vector((0.0, 0.60, 0.72))     # where the neck's base lands in the body job's frame

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
def lin2hex(c):
    def g(x):
        x = max(0.0, min(1.0, x)); x = x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
        return int(round(x * 255))
    r, gg, b = (g(x) for x in c); return (r << 16) | (gg << 8) | b
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# brief section 1 (sRGB). Tom, then hen.
CROWN, FACE, WATTLE, SNOOD, BILL, EYEC, BEARD = 0xc9d3dc, 0x8ea4bc, 0xb3322b, 0xa8383a, 0xc4b096, 0x1a120e, 0x17130f
NECKF, LEGC, CLAW, THIGH = 0x3a2c20, 0xa48c86, 0x4a403a, 0x4a3828
H_HEAD, H_FACE, H_WATTLE, H_NECKF, H_THIGH = 0x8c8a86, 0x7f8a94, 0xa06a62, 0x5b4a3a, 0x4e3f31
WING_COV, WING_DARK, WING_BAR, WING_UNDER, WING_UNDER_BAR = 0x4a3826, 0x2a231d, 0xd9d2c3, 0x8a7f72, 0xb8afa2
H_WING_COV = 0x5e4a36
# body grade: the texture's body is near black; its mean is taken to these (the tom's bronze, the hen's brown)
BODY_TARGET, HEN_TARGET = 0x56432f, 0x6e5a43

# ---- load ------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.data.objects if o not in before and o != ob]: bpy.data.objects.remove(o)
    return ob
def glb_asset(path):
    b = open(path, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n])
    return j.get('asset', {}), j.get('extras')
src_meta = {'body_asset': glb_asset(SRC_BODY)[0], 'head_asset': glb_asset(SRC_HEAD)[0]}

body = load(SRC_BODY)
# texture lookup on the untouched refine mesh: BVH, per-triangle positions and UVs, the base-colour image
me0 = body.data
img = None
for m in me0.materials:
    if m and m.use_nodes:
        for nd in m.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image: img = nd.image
assert img is not None, 'refine job has no base-colour texture'
TW, TH = img.size
PX = np.empty(TW * TH * 4, dtype=np.float32); img.pixels.foreach_get(PX); PX = PX.reshape(TH, TW, 4)   # sRGB-encoded
uvl = me0.uv_layers.active.data
TRI = [(tuple(me0.vertices[me0.loops[li].vertex_index].co.copy() for li in p.loop_indices), tuple(uvl[li].uv.copy() for li in p.loop_indices)) for p in me0.polygons]
BVH_TEX = BVHTree.FromPolygons([v.co.copy() for v in me0.vertices], [tuple(p.vertices) for p in me0.polygons])
def tex_srgb(p):
    """Mean sRGB (0-1) of the texture around raw point p (a few samples on the nearest triangle)."""
    loc, _, i, _ = BVH_TEX.find_nearest(p)
    (a, b, c), (ua, ub, uc) = TRI[i]
    uv = barycentric_transform(loc, a, b, c, ua.to_3d(), ub.to_3d(), uc.to_3d())
    if not (math.isfinite(uv.x) and math.isfinite(uv.y)):   # degenerate triangle: the first corner with a finite UV
        uv = next((u for u in (ua, ub, uc) if math.isfinite(u.x) and math.isfinite(u.y)), Vector((0.5, 0.5)))
    px = PX[min(TH - 1, max(0, int(uv.y * TH))), min(TW - 1, max(0, int(uv.x * TW)))]
    return px[:3]

# ---- body: delete the hunched head, the beard and the legs -----------------------------------------------
F = lambda v: -v.co.y
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
def clean_nonmanifold(bm):
    """Delete faces on edges shared by more than two faces (collapse decimation stalls on them), fill the holes."""
    for _ in range(4):
        fs = {f for e in bm.edges if len(e.link_faces) > 2 for f in e.link_faces}
        if not fs: break
        bmesh.ops.delete(bm, geom=list(fs), context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0); bmesh.ops.triangulate(bm, faces=bm.faces)
clean_nonmanifold(bm)
dele = [v for v in bm.verts if (F(v) > 0.77 and v.co.z > -0.30) or v.co.z < -0.19]
bmesh.ops.delete(bm, geom=dele, context='VERTS')
for f in [f for f in bm.faces if all(len(e.link_faces) == 1 for e in f.edges)]: bm.faces.remove(f)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
# keep only the largest piece (beard strands and toe tips cut loose)
seen = set(); pieces = []
for v in bm.verts:
    if v in seen: continue
    st = [v]; comp = []; seen.add(v)
    while st:
        u = st.pop(); comp.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w not in seen: seen.add(w); st.append(w)
    pieces.append(comp)
pieces.sort(key=len, reverse=True)
for comp in pieces[1:]: bmesh.ops.delete(bm, geom=comp, context='VERTS')
print('body pieces dropped', [len(c) for c in pieces[1:]][:10])
holes = bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
# round the flat caps a little (the neck junction and the belly under the legs)
capv = {v for f in holes['faces'] for v in f.verts}
for it in range(6):
    new = {}
    for v in capv:
        nb = [e.other_vert(v).co for e in v.link_edges]
        new[v] = v.co * 0.5 + sum(nb, Vector()) / len(nb) * 0.5
    for v, c in new.items():
        if all(len(e.link_faces) == 2 for e in v.link_edges) and v.co.z > -0.185: v.co = c
ZB = min(v.co.z for v in bm.verts)
ZSQ = ZB
def rot(f, z, c, a):
    df, dz = f - c[0], z - c[1]; ca, sa = math.cos(a), math.sin(a)
    return c[0] + df * ca - dz * sa, c[1] + df * sa + dz * ca
for v in bm.verts:
    f, z = -v.co.y, ZSQ + (v.co.z - ZSQ) * BODY_SQ
    if f < TAIL_ROOT:
        f = TAIL_ROOT + (f - TAIL_ROOT) * TAIL_STRETCH
        f, z = rot(f, z, (TAIL_ROOT, TAIL_ROOT_Z), -TAIL_LIFT * smooth(TAIL_ROOT, TAIL_ROOT - 0.1, f))
    f, z = rot(f, z, PIVOT_FZ, PITCH)
    v.co.y, v.co.z = -f, z
ZB = min(v.co.z for v in bm.verts if abs(-v.co.y - PIVOT_FZ[0]) < 0.3)   # the belly over the legs
bm.to_mesh(body.data); bm.free(); body.data.update()
print('body belly z', ZB, 'tris', len(body.data.polygons))

# ---- head graft ----------------------------------------------------------------------------------------
head_src = load(SRC_HEAD)
hm = head_src.data
nv = len(hm.vertices); co = np.empty(nv * 3); hm.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
x, f, z = co[:, 0], -co[:, 1], co[:, 2]
keep = (z > H_CUT) & (f > 0.30) & (np.abs(x) < 0.25) & ~((z < 0.47) & (f < 0.38))
npoly = len(hm.polygons); pv = np.empty(npoly * 3, dtype=np.int64); hm.polygons.foreach_get('vertices', pv); pv = pv.reshape(-1, 3)
fk = keep[pv].all(axis=1); pv = pv[fk]
used = np.unique(pv); remap = -np.ones(nv, dtype=np.int64); remap[used] = np.arange(len(used))
# neck stretch and placement into the body job's frame (x, f, z) -> Blender (x, -f, z)
hx, hf, hz = x[used], f[used], z[used]
lo, hi = H_NECK
hz2 = np.where(hz < lo, hz, np.where(hz < hi, lo + (hz - lo) * NECK_STRETCH, hz + (hi - lo) * (NECK_STRETCH - 1)))
ct, st = math.cos(NECK_TILT), math.sin(NECK_TILT)
dfz = np.c_[hf - H_BASE.y, hz2 - H_BASE.z] * G_SCALE
gf = B_BASE.y + dfz[:, 0] * ct - dfz[:, 1] * st
gz = B_BASE.z + dfz[:, 0] * st + dfz[:, 1] * ct
gx = hx * G_SCALE
gm = bpy.data.meshes.new('graft')
gm.from_pydata(np.c_[gx, -gf, gz].tolist(), [], remap[pv].tolist())
graft = bpy.data.objects.new('graft', gm); sc.collection.objects.link(graft)
bpy.data.objects.remove(head_src)
# drop graft vertices inside the body (the base of the neck sunk into the breast)
bvh_body = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
bm = bmesh.new(); bm.from_mesh(gm)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
clean_nonmanifold(bm)
inside = []
for v in bm.verts:
    loc, n, _, d = bvh_body.find_nearest(v.co)
    if loc is not None and (v.co - loc).dot(n) < -0.004: inside.append(v)
bmesh.ops.delete(bm, geom=inside, context='VERTS')
bm.to_mesh(gm); bm.free(); gm.update()
print('graft tris', len(gm.polygons), 'removed inside', len(inside))
def pre_decimate(ob, n):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    if len(ob.data.polygons) > n:
        d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = n / len(ob.data.polygons)
        d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
pre_decimate(graft, 24000)

# ---- landmarks, the spine and the scale ---------------------------------------------------------------------
GV = [v.co.copy() for v in graft.data.vertices]; BV = [v.co.copy() for v in body.data.vertices]
gfz = [(-c.y, c.z) for c in GV]
bill = max(GV, key=lambda c: -c.y); bill = (-bill.y, bill.z)
head_top_z = max(c.z for c in GV)
hc = [c for c in GV if c.z > head_top_z - 0.20 * G_SCALE * 1.0]
headc = (sum(-c.y for c in hc) / len(hc), sum(c.z for c in hc) / len(hc))
def bin_back(f0, w=0.04, k=0.7):            # the line of the vertebrae: 70% of the way from belly to back
    zs = [c.z for c in BV if abs(-c.y - f0) < w]
    return min(zs) + (max(zs) - min(zs)) * k if zs else None
tail_tip = min(BV, key=lambda c: c.y * -1); tail_tip = (-tail_tip.y, tail_tip.z)
tr = rot(TAIL_ROOT, ZSQ + (TAIL_ROOT_Z - ZSQ) * BODY_SQ, PIVOT_FZ, PITCH)   # the tail root through the body's edits
spine = [bill, headc, (B_BASE.y, B_BASE.z)]
for f0 in [0.4, 0.2, 0.0, -0.2, -0.4]:
    zm = bin_back(f0)
    if zm is not None: spine.append((f0, zm))
spine += [tr, tail_tip]
print('spine', [(round(p[0], 2), round(p[1], 2)) for p in spine])
SPINE = sum(math.hypot(spine[i + 1][0] - spine[i][0], spine[i + 1][1] - spine[i][1]) for i in range(len(spine) - 1))
S = LENGTH / SPINE
LEGH = HEIGHT - (head_top_z - ZB) * S        # belly to ground (m)
F_HIP = 0.10                                  # raw f of the hips: feet under the body's balance
BACK_Z = max(c.z for c in BV)
print('back top m', round((BACK_Z - ZB) * S + HEIGHT - (head_top_z - ZB) * S, 3), 'tail behind the rump m', round((TAIL_ROOT - tail_tip[0]) * S, 3), 'head bill-to-nape m', round((bill[0] - min(-c.y for c in GV if c.z > head_top_z - 0.15)) * S, 3))
print('spine units', round(SPINE, 3), 'scale m/unit', round(S, 4), 'belly height m', round(LEGH, 3), 'straight length m', round((bill[0] - tail_tip[0]) * S, 3))
def M(x, f, z): return Vector((x * S, (z - ZB) * S + LEGH, (f - F_HIP) * S))
def RAWv(p): return Vector((p.x / S, p.z / S + F_HIP, (p.y - LEGH) / S + ZB))   # three.js -> (x, f, z)
def to3(c): return M(c.x, -c.y, c.z)

bvh_b = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
bvh_g = BVHTree.FromObject(graft, bpy.context.evaluated_depsgraph_get())
def hit(bvh, o3, d3):
    """Ray in three.js metres against a raw-frame BVH; returns the hit in three.js metres."""
    o = RAWv(o3); o = Vector((o.x, -o.y, o.z)); d = Vector((d3.x, -d3.z, d3.y))
    h = bvh.ray_cast(o, d)[0]
    return to3(h) if h else None

NECK_PIV = M(0, B_BASE.y - 0.03, B_BASE.z + 0.02)
ra = M(0, tr[0], tr[1]); TAIL_PIV = Vector((0, ra.y, ra.z))
sh = M(0.0, 0.48, 0.58); SHOULDER = Vector((0.0, sh.y, sh.z))
w = hit(bvh_b, SHOULDER + Vector((1, 0, 0)), Vector((-1, 0, 0))); SHOULDER.x = (w.x if w else 0.2) - 0.02
HIP = M(0.0, F_HIP, ZB + 0.06)
w = hit(bvh_b, Vector((1, LEGH + 0.02, HIP.z)), Vector((-1, 0, 0)))
HIPX = max(0.055, min(0.08, (w.x if w else 0.15) * 0.45))
HIP = Vector((HIPX, HIP.y, HIP.z))
ez = 0.885                                    # the eye in the head job (f 0.505, z 0.885), through the graft transform
ez2 = ez if ez < H_NECK[0] else (H_NECK[0] + (min(ez, H_NECK[1]) - H_NECK[0]) * NECK_STRETCH + max(0, ez - H_NECK[1]))
dfe, dze = (0.505 - H_BASE.y) * G_SCALE, (ez2 - H_BASE.z) * G_SCALE
EYE = M(0, B_BASE.y + dfe * ct - dze * st, B_BASE.z + dfe * st + dze * ct)
w = hit(bvh_g, Vector((0.3, EYE.y, EYE.z)), Vector((-1, 0, 0))); EYE_X = w.x if w else 0.02
# beard: from the breast below the neck
bo = hit(bvh_b, Vector((0, M(0, 0, 0.30).y, 2.0)), Vector((0, 0, -1)))
BEARD_AT = bo if bo else M(0, 0.76, 0.18)
print('pivots: neck', tuple(round(c, 3) for c in NECK_PIV), 'tail', tuple(round(c, 3) for c in TAIL_PIV), 'hip', tuple(round(c, 3) for c in HIP),
      'shoulder', tuple(round(c, 3) for c in SHOULDER), 'eye', tuple(round(c, 3) for c in EYE), round(EYE_X, 3), 'beard', tuple(round(c, 3) for c in BEARD_AT))

HEADC3 = M(0, headc[0], headc[1]); BILL3 = M(0, bill[0], bill[1])

# ---- weights and colours -------------------------------------------------------------------------------
NECK_AX = Vector((0, math.cos(NECK_TILT) * 1.0, -math.sin(NECK_TILT))).normalized()   # up the neck (three.js y, z)
def head_w(p):
    return smooth(0.0, 0.07, (p - NECK_PIV).dot(Vector((0, NECK_AX.y, NECK_AX.z))))
def tail_w(p):
    return smooth(0.0, 0.08, TAIL_PIV.z - p.z)

# texture grade: per-channel gain from the body's mean texture colour to the targets
def grade_gains(target):
    t = srgb2lin(target)
    return [t[k] / max(1e-4, MEAN_LIN[k]) for k in range(3)]
def unsq(x, f, z):                     # the edited body frame -> the refine mesh (undo pitch, tail lift and stretch, squash)
    f, z = rot(f, z, PIVOT_FZ, -PITCH)
    if f < TAIL_ROOT:
        for _ in range(3):             # the lift's angle depends on the unlifted f: iterate
            f0 = f if _ == 0 else f1
            f1, z1 = rot(f, z, (TAIL_ROOT, TAIL_ROOT_Z), TAIL_LIFT * smooth(TAIL_ROOT, TAIL_ROOT - 0.1, f0))
        f, z = f1, z1
        f = TAIL_ROOT + (f - TAIL_ROOT) / TAIL_STRETCH
    return Vector((x, -f, ZSQ + (z - ZSQ) / BODY_SQ))
samp = [tex_srgb(unsq(BV[i].x, -BV[i].y, BV[i].z)) for i in range(0, len(BV), 7)]
def s2l(c): return [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
lins = [s2l(c) for c in samp]
MEAN_LIN = [float(np.median([c[k] for c in lins])) for k in range(3)]
GAIN_TOM, GAIN_HEN = grade_gains(BODY_TARGET), grade_gains(HEN_TARGET)
print('texture body median sRGB', hex(lin2hex(MEAN_LIN)), 'gains tom', [round(g, 2) for g in GAIN_TOM])
def body_color(c3):
    """(tom, hen) linear colour of a body face at three.js point c3, from the graded texture."""
    r = RAWv(c3)
    lin = s2l(tex_srgb(unsq(r.x, r.y, r.z)))
    if RAWTEX: return tuple(lin), tuple(lin)
    if r.z < ZB + 0.08 and lin[0] > 1.6 * lin[1]: lin = list(srgb2lin(0x2a201a))   # the legs' pink where they were cut
    # pale low-saturation pixels are the white wing bars and buff tips: grade them gently so they stay pale
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    pale = smooth(0.08, 0.25, lum)
    tom = [min(1.0, lin[k] * (GAIN_TOM[k] * (1 - pale) + 1.25 * pale)) for k in range(3)]
    hen = [min(1.0, lin[k] * (GAIN_HEN[k] * (1 - pale) + 1.3 * pale)) for k in range(3)]
    # the hen is less iridescent: pull toward grey-brown
    hl = 0.2126 * hen[0] + 0.7152 * hen[1] + 0.0722 * hen[2]; hb = srgb2lin(HEN_TARGET); hbl = 0.2126 * hb[0] + 0.7152 * hb[1] + 0.0722 * hb[2]
    hen = [0.5 * hen[k] + 0.5 * hb[k] * hl / hbl for k in range(3)]
    return tuple(tom), tuple(hen)
def head_color(c3, n3):
    """(tom, hen) sRGB hex for a head-graft face (three.js point and normal), by region."""
    r = RAWv(c3)
    # back to the head job's frame for the region rules
    dfe_, dze_ = r.y - B_BASE.y, r.z - B_BASE.z
    hf_ = (dfe_ * ct + dze_ * st) / G_SCALE + H_BASE.y
    hz2_ = (-dfe_ * st + dze_ * ct) / G_SCALE + H_BASE.z
    lo, hi = H_NECK
    hz_ = hz2_ if hz2_ < lo else (lo + (hz2_ - lo) / NECK_STRETCH if hz2_ < lo + (hi - lo) * NECK_STRETCH else hz2_ - (hi - lo) * (NECK_STRETCH - 1))
    X = abs(r.x / G_SCALE)
    if hf_ > 0.585 and hz_ > 0.74: return BILL, BILL                                   # bill
    if hz_ < 0.50: return NECKF, H_NECKF                                                # feathered base of the neck
    if hf_ > 0.50 and hz_ > 0.66 and hz_ < 0.80 and X < 0.03 and n3.y > -0.2: return SNOOD, H_FACE   # snood over the bill
    if hz_ < 0.74 and hf_ > 0.47 - (0.74 - hz_) * 0.35: return WATTLE, (H_WATTLE if hz_ > 0.62 else H_NECKF)   # wattle, caruncles
    if hz_ < 0.58: return (WATTLE if hf_ > 0.45 else FACE), H_NECKF                       # caruncled neck
    if hz_ > 0.86 or (hz_ > 0.80 and hf_ < 0.44): return CROWN, H_HEAD
    return FACE, H_FACE

class Extra:
    def __init__(self): self.tris = []        # (p0, p1, p2, (tom, hen) hex, part, weight, pivot)
    def tri(self, a, b, c, col, part, w, piv, away=None):
        a, b, c = Vector(a), Vector(b), Vector(c)
        if away is not None and (b - a).cross(c - a).dot((a + b + c) / 3 - away) < 0: b, c = c, b
        self.tris.append((a, b, c, col, part, w, Vector(piv)))
    def tube(self, pts, radii, col, part, w, piv, sides=3, cols=None):
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = t.cross(a).normalized(); v = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        for i in range(len(pts) - 1):
            cc = cols[i] if cols else col
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                m = (pts[i] + pts[i + 1]) / 2
                if radii[i + 1] == 0: self.tri(a, b, pts[i + 1], cc, part, w, piv, m)
                else: self.tri(a, b, d, cc, part, w, piv, m); self.tri(a, d, c2, cc, part, w, piv, m)
    def card(self, poly, col_top, col_bot, part, piv, thick=0.003):
        n = len(poly); off = Vector((0, thick, 0))
        for i in range(1, n - 1):
            c = (poly[0] + poly[i] + poly[i + 1]) / 3
            self.tri(poly[0] + off, poly[i] + off, poly[i + 1] + off, col_top, part, 1.0, piv, c - Vector((0, 1, 0)))
            self.tri(poly[0], poly[i], poly[i + 1], col_bot, part, 1.0, piv, c + Vector((0, 1, 0)))
    def ellipsoid(self, c, r, col, part, w, piv):
        P = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            self.tri(P[a], P[b], P[4], col, part, w, piv, c); self.tri(P[b], P[a], P[5], col, part, w, piv, c)

# leg geometry (metres, three.js): drumstick from inside the belly down and back to the intertarsal joint, bare
# tarsus down and forward to the foot; feet under the hip
TARSUS = 0.165
def legs(ex, level):
    sides = [6, 4, 3][level]
    for s in (1, -1):
        part = LEG_A if s > 0 else LEG_B
        H = Vector((s * HIP.x, HIP.y, HIP.z))
        J = Vector((s * (HIP.x + 0.005), 0.17, HIP.z - 0.055))            # intertarsal joint ("knee" seen from outside)
        A = Vector((s * (HIP.x + 0.008), 0.028, HIP.z + 0.0))              # foot (ball)
        thigh = (THIGH, H_THIGH); leg = (LEGC, LEGC); claw = (CLAW, CLAW)
        if level == 2:
            ex.tube([H + Vector((0, 0.03, 0)), J], [0.04, 0.014], thigh, part, 1.0, H, sides=3)
            ex.tube([J, A, A + Vector((0, -0.026, 0.08))], [0.012, 0.010, 0], leg, part, 1.0, H, sides=3)
            continue
        mid = H.lerp(J, 0.45) + Vector((0, 0, -0.008))
        ex.tube([H, mid, J + Vector((0, 0.03, 0.004))], [0.042, 0.028, 0.016], thigh, part, 1.0, H, sides=sides)
        ex.tube([J + Vector((0, 0.035, 0.003)), J, A], [0.016, 0.0125, 0.0105], leg, part, 1.0, H, sides=sides)
        toes = [(-0.42, 0.075), (0.0, 0.088), (0.42, 0.075), (math.pi, 0.035)]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.9, 0, math.cos(ang)))
            if level == 0:
                p1 = A + d * (ln * 0.55) + Vector((0, -0.017, 0)); p2 = A + d * ln + Vector((0, -0.024, 0))
                ex.tube([A, p1, p2], [0.008, 0.0055, 0], leg, part, 1.0, H, sides=4, cols=[leg, claw])
            else:
                ex.tube([A, A + d * ln + Vector((0, -0.024, 0))], [0.0075, 0], leg, part, 1.0, H, sides=3)
        if level == 0:   # the tom's spur, on the back of the tarsus (the hen's is coloured as the leg and is tiny anyway)
            sp = J.lerp(A, 0.62); ex.tube([sp, sp + Vector((s * 0.004, -0.004, -0.024))], [0.004, 0], (CLAW, LEGC), part, 1.0, H, sides=3)

def clip_band(poly, lo, hi):
    """The part of a 2D polygon [(dx, dz)] with lo <= dz <= hi (Sutherland-Hodgman against two lines)."""
    def clip(pts, keep, cut):
        out = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            ka, kb = keep(a), keep(b)
            if ka: out.append(a)
            if ka != kb:
                t = (cut - a[1]) / (b[1] - a[1]); out.append((a[0] + (b[0] - a[0]) * t, cut))
        return out
    pts = clip(poly, lambda p: p[1] >= lo, lo)
    return clip(pts, lambda p: p[1] <= hi, hi) if pts else []

def wings(ex, level):
    """Flush wing cards: arm (WING, pivot at the shoulder) and hand (HAND, pivot at the wrist). Bronze coverts along the
    leading edge; the flight feathers dark with white bars, which line up across the spread wing as bands parallel to
    the trailing edge; grey-brown below with paler bars. Span about 1.3 m."""
    W = SHOULDER; WR = 0.27
    arm = [(0.0, 0.05), (WR, 0.045), (WR, -0.27), (0.0, -0.30)]
    hand = [(0.0, 0.045), (0.10, 0.04), (0.20, 0.005), (0.27, -0.05), (0.29, -0.12), (0.25, -0.20), (0.15, -0.255), (0.0, -0.27)]
    cov, dark, bar = (WING_COV, H_WING_COV), (WING_DARK, WING_DARK), (WING_BAR, WING_BAR)
    und, undb = (WING_UNDER, WING_UNDER), (WING_UNDER_BAR, WING_UNDER_BAR)
    if level == 0:
        bands = [(-0.06, 0.06, cov, und)] + [(z - 0.03, z, dark, und) if i % 2 == 0 else (z - 0.02, z, bar, undb)
                 for i, z in enumerate([-0.06, -0.09, -0.11, -0.14, -0.16, -0.19, -0.21, -0.24])] + [(-0.31, -0.255, dark, und)]
        bands = [b for b in bands]
        # contiguous: rebuild the edges so the strips tile with no gaps
        edges = [0.06, -0.06, -0.09, -0.11, -0.14, -0.16, -0.19, -0.21, -0.24, -0.255, -0.31]
        cols = [(cov, und), (dark, und), (bar, undb), (dark, und), (bar, undb), (dark, und), (bar, undb), (dark, und), (bar, undb), (dark, und)]
    elif level == 1:
        edges = [0.06, -0.07, -0.13, -0.16, -0.20, -0.23, -0.31]
        cols = [(cov, und), (dark, und), (bar, undb), (dark, und), (bar, undb), (dark, und)]
    else:
        edges = [0.06, -0.31]
        cols = [(dark, und)]
        arm = [(0.0, 0.05), (WR, 0.045), (WR, -0.27), (0.0, -0.30)]
        hand = [(0.0, 0.045), (0.20, 0.005), (0.29, -0.12), (0.15, -0.255), (0.0, -0.27)]
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + WR), W.y, W.z))
        wp, hp = (WING_L, HAND_L) if s > 0 else (WING_R, HAND_R)
        for poly, part, pv, x0 in ((arm, wp, piv, 0.0), (hand, hp, wrist, WR)):
            for i in range(len(edges) - 1):
                band = clip_band(poly, edges[i + 1], edges[i])
                if len(band) < 3: continue
                ex.card([Vector((s * (W.x + x0 + dx), W.y, W.z + dz)) for dx, dz in band], cols[i][0], cols[i][1], part, pv)

def beard(ex, level):
    B0 = BEARD_AT + Vector((0, 0.005, -0.012))
    B1 = B0 + Vector((0, -0.13, 0.025)); B2 = B0 + Vector((0, -0.17, 0.035))
    if level == 2: ex.tube([B0, B2], [0.012, 0], (BEARD, 'body'), BODY, 0.0, Vector(), sides=3); return
    ex.tube([B0, B1, B2], [0.011, 0.008, 0], (BEARD, 'body'), BODY, 0.0, Vector(), sides=3 if level else 4)

def head_far(ex):
    """lod2: a procedural neck and head (the decimated graft falls apart into a slab below ~100 triangles)."""
    top = HEADC3 + Vector((0, -0.035, -0.012))
    base = NECK_PIV + Vector((0, -0.02, -0.02))
    mid = base.lerp(top, 0.55) + Vector((0, 0, 0.012))
    ex.tube([base, mid, top], [0.034, 0.02, 0.018], (WATTLE, H_NECKF), HEAD, 1.0, NECK_PIV, sides=4)
    ex.ellipsoid(HEADC3, Vector((0.026, 0.032, 0.042)), (FACE, H_HEAD), HEAD, 1.0, NECK_PIV)
    tip = BILL3; root = HEADC3 + Vector((0, 0.0, 0.03))
    ex.tube([root, tip], [0.011, 0], (BILL, BILL), HEAD, 1.0, NECK_PIV, sides=3)
    w0 = HEADC3 + Vector((0, -0.02, 0.03)); w1 = w0 + Vector((0, -0.06, -0.012))
    for sx in (1, -1):
        ex.tri(w0, w1, w0 + Vector((sx * 0.012, -0.03, -0.012)), (WATTLE, H_WATTLE), HEAD, 1.0, NECK_PIV, w0 + Vector((-sx, 0, 0)))

def eyes(ex):
    for s in (1, -1):
        c = Vector((s * (abs(EYE_X) - 0.0015), EYE.y, EYE.z))
        ex.ellipsoid(c, Vector((0.004, 0.0065, 0.0065)), (EYEC, EYEC), HEAD, 1.0, NECK_PIV)

# ---- tiers ---------------------------------------------------------------------------------------------
def decimated(src, target):
    ob = src.copy(); ob.data = src.data.copy(); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    for sym in (True, False):      # the symmetric collapse can stall short of a small target; finish without it
        if len(ob.data.polygons) <= target * 1.04: break
        d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = min(1.0, target / len(ob.data.polygons))
        d.use_symmetry = sym; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return ob

def build(level, target):
    ex = Extra(); legs(ex, level); wings(ex, level); beard(ex, level)
    if level == 0: eyes(ex)
    if level == 2: head_far(ex)
    mesh_target = target - len(ex.tris)
    ht = int(mesh_target * HEAD_SHARE[level]) if level < 2 else 0; bt = mesh_target - ht
    pos = []; col = []; colb = []; part = []; partw = []; piv = []; idx = []
    nb_ = {}
    for which, src, tgt in (('body', body, bt), ('head', graft, ht))[:2 if ht else 1]:
        ob = decimated(src, tgt); m = ob.data
        P3 = [to3(v.co) for v in m.vertices]; key2i = {}
        for p in m.polygons:
            c = sum((P3[i] for i in p.vertices), Vector()) / 3
            nb = p.normal; n = Vector((nb.x, nb.z, -nb.y))
            if which == 'body': fc, fb = body_color(c)
            else:
                hm_, hf_ = head_color(c, n); fc, fb = srgb2lin(hm_), srgb2lin(hf_)
            for vi in p.vertices:
                k = (vi, fc, fb)
                if k not in key2i:
                    key2i[k] = len(pos); q = P3[vi]; pos.append(q); col.append(fc); colb.append(fb)
                    if which == 'head':
                        w = head_w(q); part.append(float(HEAD)); partw.append(w); piv.append(NECK_PIV)
                    else:
                        tw = tail_w(q)
                        if tw > 0: part.append(float(TAIL)); partw.append(tw); piv.append(TAIL_PIV)
                        else: part.append(float(BODY)); partw.append(0.0); piv.append(Vector())
                idx.append(key2i[k])
        nb_[which] = len(m.polygons)
        bpy.data.objects.remove(ob)
    for a, b, c, h, pt, w, pv in ex.tris:
        if h[1] == 'body':             # the beard: black on the tom, breast colour on the hen
            fc = srgb2lin(h[0]); fb = body_color((a + b + c) / 3 + Vector((0, 0, -0.02)))[1]
        else:
            fc, fb = srgb2lin(h[0]), srgb2lin(h[1])
        for p in (a, b, c):
            idx.append(len(pos)); pos.append(p); col.append(fc); colb.append(fb); part.append(float(pt)); partw.append(w); piv.append(pv)
    print('TIER', level, 'tris', len(idx) // 3, f"(body {nb_['body']}, head and neck {nb_.get('head', 'procedural')}, legs/wings/beard/eyes{'/head' if level == 2 else ''} {len(ex.tris)})", 'verts', len(pos))
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
print('extent x', [round(v, 3) for v in ext[0]], 'y', [round(v, 3) for v in ext[1]], 'z', [round(v, 3) for v in ext[2]])
RIG = {'kind': 'bird', 'wing': list(SHOULDER), 'tail': list(TAIL_PIV), 'head': list(NECK_PIV), 'hip': list(HIP),
       'length_m': LENGTH, 'height_m': HEIGHT, 'variant': 'hen in _COLORB'}

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
    attrs = {'POSITION': acc_f([tuple(p) for p in t['pos']], 3), 'COLOR_0': acc_f([tuple(c) for c in t['col']], 3),
             '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f([tuple(p) for p in t['piv']], 3), '_COLORB': acc_f([tuple(c) for c in t['colb']], 3)}
    meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
while len(buf) % 4: buf.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_turkey.py (Blender)',
                  'copyright': f'Wild turkey: generated with Meshy (meshy.ai), tasks {JOB_BODY} (refine of {JOB_BODY_PREVIEW}) and {JOB_HEAD}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (grafted, recoloured, decimated) by wild-earth tools/build_turkey.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'species': 'meleagris_gallopavo', 'rig': RIG,
                   'source': {'kind': 'meshy', 'job_ids': [JOB_BODY, JOB_BODY_PREVIEW, JOB_HEAD], 'ai_model': 'latest (meshy-7.1)',
                              'mode': 'text-to-3d preview + refine (body), preview (head and neck)', **src_meta,
                              'ai_generated': True, 'meshy_metadata': 'none embedded in the source GLBs'}}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb))

# ---- optional preview: each tier with its vertex colours, workbench ----
if PREVIEW:
    body.hide_render = True; graft.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 800
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for (name, t), key in [(nt, k) for nt in tiers for k in ('col', 'colb')]:
        name = name + ('' if key == 'col' else 'h')
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t[key]): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, scale in [('side', (0, 0, 0.48), (1, 0, 0.0), 1.25), ('front', (0, 0, 0.48), (0.0, -1, 0.1), 1.25),
                                    ('q', (0, 0, 0.48), (0.8, -0.7, 0.35), 1.3), ('head', (0, -0.3, 0.8), (1, -0.5, 0.1), 0.35)]:
            if key == 'colb' and view in ('front',): continue
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 6
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
