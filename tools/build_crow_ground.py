# Build client/assets/crow_ground.glb, the American crow on the ground (walking, perched), as a variant of the common
# raven's Meshy mesh and its texture refine. No credits.
#
# Source: variant of corvus_corax built from its Meshy (meshy.ai) text-to-3D preview, task
#   01a171a4-7814-7301-b140-133459562f9f, ai_model latest (meshy-7.1), triangle remesh to 20,000 faces (20,310
#   triangles), 2026-10-25 UTC, and its refine, task 01a171a8-2db4-7256-9b99-ae6f617dea98 (same geometry and UVs plus a
#   2048 px base-colour texture). Prompts (for the raven): "A common raven (Corvus corax), one adult standing on flat
#   ground, side-on neutral pose. Wings folded tight and flat against the flanks, folded primaries reaching nearly to the
#   tail tip; body slim, about one third as wide as long. Heavy deep black bill about as long as the head, strongly
#   curved culmen, a tuft of bristle feathers covering the nostrils on the base of the upper bill. Shaggy, pointed,
#   bearded throat hackles. Flat crown sloping straight into the bill (Roman-nose profile), thick neck. Long graduated
#   wedge-shaped tail, central feathers longest, pointed tip, no notch. Black scaled legs, four toes: three forward, one
#   back, flat on the ground. All-black glossy plumage with visible feather edges. No base, no perch, no rock. Realistic,
#   game-ready, closed, symmetric." and (refine) "Common raven, all-black plumage with a subtle blue-violet gloss on the
#   back, scapulars and folded wings, each feather edge a slightly lighter black so the feather tracts read; matte black
#   bill and nasal bristles, matte black scaled legs and toes, dark brown eye. Even, flat, unlit albedo: no baked
#   shadows, no highlights, no ambient occlusion." Job records: library/animals/jobs/corvus_corax/<task>/job.json. No new
#   Meshy job for the crow.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; these files carried none beyond asset.generator, which is kept in extras.source.
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_crow_ground.py -- \
#       library/animals/jobs/corvus_corax/01a171a8-2db4-7256-9b99-ae6f617dea98/model.glb client/assets/crow_ground.glb \
#       [--texture library/animals/jobs/corvus_corax/01a171a8-2db4-7256-9b99-ae6f617dea98/texture_base_color.png]
#
# What it does: tools/build_raven_ground.py's clean-up, leg shortening, squared stance, texture grade and rig on the same
# mesh (worked in the raven's frame, 0.62 m, so its landmarks hold), then the crow's differences from a raven: a smaller,
# rounder head (0.9x about the base of the neck, the flat crown domed 5 mm); a smaller, straighter, less deep bill (0.85x
# long and across, 0.75x deep about its axis, the decurved tip straightened by 0.6); no shaggy throat hackles (the
# throat smoothed and drawn in 15% toward the neck's axis); a squarish, slightly rounded tail instead of the wedge
# (everything behind the tail base shortened 0.85x, and the central feathers' last 30% compressed to 0.3x, so the tip
# is nearly square; the folded primaries move with it). Then scales the whole bird to 0.44 m bill tip to tail tip
# (origin on the ground between the feet). The raven's graded texture suits the crow (all black, a faint blue-purple
# gloss on the mantle, scapulars and folded wings, black bill and legs, dark eye): the gloss is tinted a little more
# purple (#3c3a68) and the iris darker (#1e1612). Decimates (Blender collapse, X symmetry) to lod0 ~1,200, and lod1 ~400
# and lod2 ~120 triangles from an 8 mm voxel remesh (a direct collapse drew the feet into the belly and lost the bill); bakes the graded texture onto lod0's own UV layout at 512 px; every tier also carries the
# graded colour as COLOR_0 (lod1 and lod2 per face), so only lod0 needs the texture. Each vertex carries the bird rig
# template's ground variant (as raven_ground.glb; animalModels.js PART: BODY 0, LEG_A 1 (left), LEG_B 2, TAIL 3,
# WING_L/R 4/5 (folded wing, pivot at the shoulder), HEAD 6 (head and neck, pivot at the base of the neck), HAND_L/R
# 9/10 (folded primaries, pivot at the wrist)) as _PART, _PARTW, _PIVOT; the pivots are in extras.rig (the raven ground
# model's keys) and the RAVEN_GROUND-like points (bodyY, head, bill) in extras.ground.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, NORMAL, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices; lod0
# also TEXCOORD_0 and material 0 with the base-colour JPEG, lod1 and lod2 material 1, vertex colour only); metres, +y
# up, bill toward +z, +x the bird's left, origin on the ground between the feet.
import bpy, bmesh, sys, json, struct, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
TEX = opt('--texture', os.path.join(os.path.dirname(SRC), 'texture_base_color.png'))
JOB_GEO, JOB_TEX = '01a171a4-7814-7301-b140-133459562f9f', '01a171a8-2db4-7256-9b99-ae6f617dea98'
LENGTH = 0.62                          # the raven's frame, in which the landmarks below were picked
CROW_LENGTH = 0.44                     # bill tip to tail tip, the crow (m)
HEAD_S, CROWN_DOME = 0.90, 0.005
BILL_LEN, BILL_DEPTH, BILL_STRAIGHT = 0.85, 0.75, 0.6
THROAT_IN = 0.15
TAIL_SQ, TAIL_ROUND = 0.86, 0.06                 # the squared tail's tip: fraction of the raven's central length; less at the edge
RAVEN_BODY_Y = 0.21                    # RAVEN_GROUND.bodyY (animalModels.js), the raven's body above its feet
LEG_SHORTEN = 0.15
TIERS = [('lod0', 1200), ('lod1', 400), ('lod2', 120)]
TEX_SIZE = 512
# Part ids: the client's bird template (animalModels.js PART). The brief's draft numbered the hands 7/8; the client
# settled on 9/10 (7/8 are the rodent's CHEST and TAIL_TIP).
BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# Landmarks in the scaled frame before the legs are shortened (Blender axes: metres, bill toward -y, +z up, +x the
# bird's left; picked from a 5 cm grid render of the source at 0.62 m). Everything above TOE_TOP drops with the body.
TOE_TOP, BELLY = 0.033, 0.150          # top of the toes, where the legs enter the belly feathers
TROUSER = 0.104                        # bottom of the feathered tibia: bare tarsus below
BILL_BASE_Y = -0.196                   # forehead / bill base (culmen about 7.6 cm)
NECK = Vector((0, -0.108, 0.256))      # base of the neck (HEAD pivot)
SHOULDER = Vector((0.060, -0.055, 0.280))
WRIST = Vector((0.085, -0.072, 0.248))  # bend of the folded wing
TAIL_BASE = Vector((0, 0.112, 0.176))
HAND_Y = 0.085                         # folded wing: primaries behind this (HAND), coverts and secondaries ahead (WING)
# side view outline of the folded wing (y, z), clockwise from the shoulder
WING_OUTLINE = [(-0.064, 0.306), (0.016, 0.328), (0.112, 0.310), (0.160, 0.284), (0.232, 0.244), (0.280, 0.186),
                (0.208, 0.198), (0.120, 0.182), (0.048, 0.166), (-0.024, 0.190), (-0.078, 0.240), (-0.082, 0.282)]

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
def enc2lin(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
# brief section 1 (sRGB)
PLUMAGE, SHEEN, BARE, IRIS = 0x0e0f13, 0x3c3a68, 0x141416, 0x1e1612
hx = lambda h: np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], dtype=np.float32) / 255

# ---- source metadata (Meshy Terms 2.4) ----
def glb_json(path):
    raw = open(path, 'rb').read(); n = struct.unpack('<I', raw[12:16])[0]; return json.loads(raw[20:20 + n])
SRC_META = {'asset': glb_json(SRC).get('asset', {}), 'extras': glb_json(SRC).get('extras')}
geo_path = os.path.join(os.path.dirname(os.path.dirname(SRC)), JOB_GEO, 'model.glb')
GEO_META = {'asset': glb_json(geo_path).get('asset', {}), 'extras': glb_json(geo_path).get('extras')} if os.path.exists(geo_path) else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
src = next(o for o in sc.objects if o.type == 'MESH')
bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.mesh.customdata_custom_splitnormals_clear()
src.data.materials.clear()

# ---- clean, scale, origin at the feet, shorten the legs ----
bm = bmesh.new(); bm.from_mesh(src.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.faces.ensure_lookup_table()
seen = set(); islands = []
for f in bm.faces:
    if f.index in seen: continue
    stack = [f]; seen.add(f.index); comp = []
    while stack:
        g = stack.pop(); comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen: seen.add(h.index); stack.append(h)
    islands.append(comp)
islands.sort(key=len, reverse=True)
bmesh.ops.delete(bm, geom=[f for c in islands[1:] for f in c], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
for _ in range(2):   # remesher fins: drop faces on non-manifold edges and close the holes, or the collapse stalls ~700
    bmesh.ops.delete(bm, geom=list({f for e in bm.edges if len(e.link_faces) > 2 for f in e.link_faces}), context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
ys = [v.co.y for v in bm.verts]; S = LENGTH / (max(ys) - min(ys))
zmin = min(v.co.z for v in bm.verts)
feet = [v.co for v in bm.verts if v.co.z < zmin + 0.06]
O = Vector(((min(c.x for c in feet) + max(c.x for c in feet)) / 2, (min(c.y for c in feet) + max(c.y for c in feet)) / 2, zmin))
for v in bm.verts: v.co = (v.co - O) * S
# the legs' span between toe tops and belly shrinks; everything above drops by the difference
DROP = LEG_SHORTEN * (BELLY - TOE_TOP)
legbox = lambda c: abs(c.x) < 0.11 and -0.17 < c.y < 0.13
for v in bm.verts:
    c = v.co
    if c.z <= TOE_TOP: continue
    if c.z < BELLY and legbox(c): c.z = TOE_TOP + (c.z - TOE_TOP) * (1 - LEG_SHORTEN)
    else: c.z -= DROP * smooth(TOE_TOP, BELLY, c.z) if legbox(c) else DROP
TROUSER_D = TOE_TOP + (TROUSER - TOE_TOP) * (1 - LEG_SHORTEN)
BELLY_D = TOE_TOP + (BELLY - TOE_TOP) * (1 - LEG_SHORTEN)
# square the stance: the source walks mid-stride, one foot ahead; the leading tarsus swings back about its top (the
# intertarsal joint, at the bottom of the feathered tibia) until its foot is level with the other, toes unchanged
foot = {s: [v.co for v in bm.verts if v.co.z < TOE_TOP and legbox(v.co) and v.co.x * s > 0] for s in (1, -1)}
foot_y = {s: (min(c.y for c in foot[s]) + max(c.y for c in foot[s])) / 2 for s in foot}
LEAD = min(foot_y, key=foot_y.get)                 # bill toward -y: the leading foot has the smaller y
STEP = foot_y[-LEAD] - foot_y[LEAD]
for v in bm.verts:
    c = v.co
    if c.x * LEAD > 0 and legbox(c) and c.z < TROUSER_D:
        c.y += STEP * min(1.0, (TROUSER_D - c.z) / (TROUSER_D - TOE_TOP))
# origin: on the ground between the feet as they now stand (applied at export, in to3, so every landmark below keeps
# the source frame it was picked in)
fp = [v.co for v in bm.verts if v.co.z < TOE_TOP and legbox(v.co)]
SHIFT = Vector(((min(c.x for c in fp) + max(c.x for c in fp)) / 2, (min(c.y for c in fp) + max(c.y for c in fp)) / 2, 0))
print('STANCE lead', 'left' if LEAD > 0 else 'right', 'step', round(STEP, 4), 'origin shift', SHIFT.to_tuple(4))
bmesh.ops.triangulate(bm, faces=bm.faces)
for f in bm.faces: f.smooth = True
base_me = bpy.data.meshes.new('base'); bm.to_mesh(base_me); bm.free()
base = bpy.data.objects.new('base', base_me); sc.collection.objects.link(base)
bpy.data.objects.remove(src)
def dropped(p): return Vector((p.x, p.y, p.z - DROP))
NECK, SHOULDER, WRIST, TAIL_BASE = map(dropped, (NECK, SHOULDER, WRIST, TAIL_BASE))
WING_OUTLINE = [(y, z - DROP) for y, z in WING_OUTLINE]
print('SCALE', S, 'drop', DROP, 'height', max(v.co.z for v in base_me.vertices))

# ---- the crow's head, bill, throat and tail (raven frame, metres) ----
bm = bmesh.new(); bm.from_mesh(base_me); bm.verts.ensure_lookup_table()
# bill: its axis (the mid-height of the bill's vertices by section), then shorter, narrower, shallower and straighter
bill = [v for v in bm.verts if v.co.y < BILL_BASE_Y + 0.004 and v.co.z > 0.15]
BTIP_Y = min(v.co.y for v in bill)
sec = {}
for v in bill: sec.setdefault(int((v.co.y - BTIP_Y) / 0.006), []).append(v.co.z)
AX = {k: (min(z) + max(z)) / 2 for k, z in sec.items()}
def bill_axis(y):
    k = int((y - BTIP_Y) / 0.006); ks = sorted(AX)
    k = min(max(k, ks[0]), ks[-1])
    while k not in AX: k += 1
    return AX[k]
BASE_Z = bill_axis(BILL_BASE_Y)
for v in bill:
    p = v.co.copy(); w = smooth(BILL_BASE_Y + 0.004, BILL_BASE_Y - 0.008, p.y)
    if w <= 0: continue
    az = bill_axis(p.y)
    az2 = BASE_Z + (az - BASE_Z) * (1 - BILL_STRAIGHT)            # the decurved tip raised toward a straight line
    q = Vector((p.x * BILL_LEN, BILL_BASE_Y + (p.y - BILL_BASE_Y) * BILL_LEN, az2 + (p.z - az) * BILL_DEPTH))
    v.co = p.lerp(q, w)
# throat hackles: the faces under the head and the upper neck, smoothed hard and drawn in toward the neck's axis
CHIN_Z = BASE_Z - 0.012
throat = [v for v in bm.verts if BILL_BASE_Y - 0.004 < v.co.y < NECK.y + 0.04 and NECK.z - 0.09 < v.co.z < CHIN_Z and abs(v.co.x) < 0.05]
for _ in range(12): bmesh.ops.smooth_vert(bm, verts=throat, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in throat:
    w = smooth(CHIN_Z, CHIN_Z - 0.03, v.co.z) * smooth(NECK.y + 0.04, NECK.y, v.co.y)
    axis = Vector((0, v.co.y, NECK.z + 0.01))
    v.co = v.co.lerp(axis + (v.co - axis) * (1 - THROAT_IN), w)
# head: smaller about the base of the neck, the flat crown domed
crown_y0, crown_y1 = NECK.y + (BILL_BASE_Y + 0.005 - NECK.y) * HEAD_S, NECK.y + 0.01
for v in bm.verts:
    wh = smooth(NECK.y + 0.012, NECK.y - 0.03, v.co.y)
    if wh <= 0: continue
    v.co = v.co.lerp(NECK + (v.co - NECK) * HEAD_S, wh)
    if crown_y0 < v.co.y < crown_y1 and v.co.z > NECK.z + 0.01:
        t = (v.co.y - crown_y0) / (crown_y1 - crown_y0)
        v.co.z += CROWN_DOME * math.sin(math.pi * t) * smooth(NECK.z + 0.01, NECK.z + 0.04, v.co.z) * smooth(0.04, 0.01, abs(v.co.x))
BILL_BASE_Y = NECK.y + (BILL_BASE_Y - NECK.y) * HEAD_S
# tail: the raven's graduated wedge (each feather's tip farther back toward the middle) redrawn squarish and slightly
# rounded: each tail vertex keeps its fraction of the way from the tail base to the tip at its |x|, and the tip outline
# becomes TAIL_SQ of the central length in the middle, TAIL_ROUND less at the outer edge (the outer feathers lengthen,
# the central ones shorten). The folded wings over the tail are left as they are.
def is_tail(c): return c.y > TAIL_BASE.y and c.z < TAIL_BASE.z - (c.y - TAIL_BASE.y) * 0.33 + 0.012
tv = [v for v in bm.verts if is_tail(v.co)]
tip = {}
for v in tv:
    k = int(abs(v.co.x) / 0.006); tip[k] = max(tip.get(k, TAIL_BASE.y), v.co.y)
for k in sorted(tip, reverse=True):          # an outline that never grows toward the edge (monotone)
    if k + 1 in tip: tip[k] = max(tip[k], tip[k + 1])
TL = tip[0] - TAIL_BASE.y
# the tail feathers proper: as far out as the outline reaches half the central length (beyond: the flanks' edges)
XMAX = 0.006 * (max(k for k in tip if tip[k] - TAIL_BASE.y > 0.5 * TL) + 1)
tv = [v for v in tv if abs(v.co.x) < XMAX + 0.003]
def tip_at(ax):
    k = int(ax / 0.006); ks = [j for j in tip if j <= k]
    return tip[max(ks)] if ks else tip[0]
for v in tv:
    ax = abs(v.co.x); t0 = tip_at(ax)
    u = min(1.0, (v.co.y - TAIL_BASE.y) / max(1e-6, t0 - TAIL_BASE.y))
    target = TAIL_BASE.y + TL * (TAIL_SQ - TAIL_ROUND * min(1.0, ax / XMAX) ** 2)
    w = smooth(TAIL_BASE.y, TAIL_BASE.y + 0.03, v.co.y)
    v.co.y = v.co.y + (TAIL_BASE.y + u * (target - TAIL_BASE.y) - v.co.y) * w
TAIL_TIP_Y = max(v.co.y for v in tv)
bm.normal_update(); bm.to_mesh(base_me); bm.free(); base_me.update()
ys = [v.co.y for v in base_me.vertices]
K = CROW_LENGTH / (max(ys) - min(ys))
BILL_TIP = min(base_me.vertices, key=lambda v: v.co.y).co.copy()
print('CROW bill tip y', round(BTIP_Y, 4), '->', round(BILL_TIP.y, 4), 'throat verts', len(throat), 'tail vertices', len(tv), 'half-width', round(XMAX, 3), 'central length', round(TL, 4), '->',
      round(TAIL_TIP_Y - TAIL_BASE.y, 4), 'outline', {k: round(t - TAIL_BASE.y, 3) for k, t in sorted(tip.items())},
      'length (raven frame)', round(max(ys) - min(ys), 4), 'scale to the crow', round(K, 4))

# ---- regions on the full mesh: bare legs and toes, bill, eye ----
uvl = base_me.uv_layers.active.data
TEXIMG = bpy.data.images.load(TEX); TEXIMG.colorspace_settings.name = 'sRGB'
W0, H0 = TEXIMG.size
pix = np.empty(W0 * H0 * 4, dtype=np.float32); TEXIMG.pixels.foreach_get(pix)
pix = pix.reshape(H0, W0, 4)[:, :, :3]          # rows bottom-up, sRGB-encoded values
def sample(u, v):
    return pix[min(H0 - 1, max(0, int(v * H0))), min(W0 - 1, max(0, int(u * W0)))]
LEG_R, BILL_R, EYE_R = 1, 2, 3
face_region = {}
cent = {}
for p in base_me.polygons:
    c = p.center; cent[p.index] = c
    if c.z < TROUSER_D and c.y < 0.16: face_region[p.index] = LEG_R
    elif c.y < BILL_BASE_Y and c.z > 0.15: face_region[p.index] = BILL_R
# eye: orange-tinted or pale faces on the side of the head, plus two rings around them (pupil and the light ring);
# never over the bill or the legs
eye = set()
for p in base_me.polygons:
    c = cent[p.index]
    if not (BILL_BASE_Y < c.y < BILL_BASE_Y + 0.06 and c.z > NECK.z - 0.01 and abs(c.x) > 0.015): continue
    s = np.mean([sample(*uvl[li].uv) for li in p.loop_indices], axis=0)
    if s[0] - s[2] > 0.05 or s.mean() > 0.32: eye.add(p.index)
vert_faces = {}
for p in base_me.polygons:
    for vi in p.vertices: vert_faces.setdefault(vi, []).append(p.index)
for _ in range(2):
    eye |= {f for e in list(eye) for vi in base_me.polygons[e].vertices for f in vert_faces[vi]}
for e in eye: face_region.setdefault(e, EYE_R)
print('REGIONS', {r: sum(1 for x in face_region.values() if x == r) for r in (LEG_R, BILL_R, EYE_R)})

def in_poly(y, z, poly):
    inside = False
    for i in range(len(poly)):
        (y1, z1), (y2, z2) = poly[i], poly[(i + 1) % len(poly)]
        if (z1 > z) != (z2 > z) and y < y1 + (z - z1) * (y2 - y1) / (z2 - z1): inside = not inside
    return inside
def poly_dist(y, z, poly):
    best = 1e9
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)]); p = Vector((y, z)); ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)); best = min(best, (p - (a + ab * t)).length)
    return best if in_poly(y, z, poly) else -best
# gloss band: mantle, scapulars and the folded wing's coverts and secondaries (not the primaries, breast or belly)
gloss = {}
for p in base_me.polygons:
    c = cent[p.index]; n = p.normal
    if p.index in face_region or c.z < BELLY_D + 0.03 or c.y < NECK.y - 0.01: continue
    wing = abs(c.x) > 0.04 and n.z > -0.3 and c.y < HAND_Y + 0.03 and poly_dist(c.y, c.z, WING_OUTLINE) > 0.004
    back = n.z > 0.25 and c.y < TAIL_BASE.y + 0.03
    w = max(0.8 if wing else 0.0, smooth(0.25, 0.7, n.z) if back else 0.0)
    if w > 0.02: gloss[p.index] = w

def raster(values, arr):
    """Write each face's value into the texels its UV triangle covers."""
    for fi, r in values.items():
        p = base_me.polygons[fi]
        uv = np.array([uvl[li].uv[:] for li in p.loop_indices], dtype=np.float64) * [W0, H0]
        x0, y0 = np.floor(uv.min(0)).astype(int); x1, y1 = np.ceil(uv.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, W0 - 1), min(y1 + 1, H0 - 1)
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = uv[0], uv[1], uv[2]
        d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(d) < 1e-9: continue
        l1 = ((b[0] - gx) * (c[1] - gy) - (b[1] - gy) * (c[0] - gx)) / d
        l2 = ((c[0] - gx) * (a[1] - gy) - (c[1] - gy) * (a[0] - gx)) / d
        m = (l1 >= -0.02) & (l2 >= -0.02) & (l1 + l2 <= 1.02)
        sub = arr[y0:y1 + 1, x0:x1 + 1]; sub[m] = r
# rasterise the non-plumage faces into a texel label map (UV space), and the gloss weight into a float map
label = np.zeros((H0, W0), dtype=np.uint8); raster(face_region, label)
for _ in range(3):   # grow each region over the chart margin so bilinear taps stay inside it
    grown = label.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(label, (dy, dx), axis=(0, 1)); grown = np.where((grown == 0) & (sh > 0), sh, grown)
    label = grown
gmap = np.zeros((H0, W0), dtype=np.float32); raster(gloss, gmap)
for _ in range(3):   # soften the band's face edges
    gmap = (gmap + np.roll(gmap, 1, 0) + np.roll(gmap, -1, 0) + np.roll(gmap, 1, 1) + np.roll(gmap, -1, 1)) / 5

# ---- grade the texture ----
# The refine's albedo has no baked light but is about 3x too light and blue (plumage mean sRGB 38, 44, 53). Keep 30%
# of its chroma, then a per-channel gain puts the plumage mean on #0e0f13 (the blue cast goes with it); the gloss band
# tints its lighter feather edges toward the blue-violet sheen #3a3f66; legs, toes and bill become matte #141416 and
# the iris dark brown, each keeping the source's own value detail (scales, feather edges).
lum = pix @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
plum = label == 0
# plumage mean over the UV-covered texels only (the atlas background is not plumage)
covered = np.zeros((H0, W0), dtype=bool)
for p in list(base_me.polygons)[::7]:
    u, v = uvl[p.loop_indices[0]].uv; covered[min(H0 - 1, int(v * H0)), min(W0 - 1, int(u * W0))] = True
DESAT = 0.3
d = lum[..., None] + (pix - lum[..., None]) * DESAT
mask = plum & covered
SRC_MEAN = pix[mask].mean(0)
gain = hx(PLUMAGE) / d[mask].mean(0)
meanL = lum[mask].mean()
t = np.clip((lum - meanL) / 0.2, 0, 1)[..., None]           # lighter feather edges
g = (gmap * plum)[..., None]
sheen = hx(SHEEN) / hx(SHEEN).mean()
out = d * gain * (1 + g * (0.35 + 0.65 * t) * 0.7 * (sheen - 1)) * (1 + 0.3 * g * t)
for r, col in ((LEG_R, BARE), (BILL_R, BARE)):
    m = label == r
    if m.any(): out[m] = hx(col) * np.clip((lum[m] / lum[m].mean()) ** 0.8, 0.6, 1.5)[:, None]
m = label == EYE_R
if m.any():
    pm, lm = pix[m], lum[m]
    iris_w = np.clip((pm[:, 0] - pm[:, 2] - 0.03) / 0.07, 0, 1) * np.clip((lm - 0.08) / 0.08, 0, 1)
    ref = lm[iris_w > 0.5].mean() if (iris_w > 0.5).any() else 0.3
    iris = hx(IRIS) * np.clip(lm / ref, 0.6, 1.3)[:, None]
    dark = np.minimum(out[m], hx(PLUMAGE) * 1.4)        # the pale eye-ring and the pupil: plumage-dark, no light ring
    out[m] = dark * (1 - iris_w[:, None]) + iris * iris_w[:, None]
    print('EYE texels', int(m.sum()), 'iris texels', int((iris_w > 0.5).sum()))
out = np.clip(out, 0, 1)
nog = mask & (gmap < 0.1); ing = mask & (gmap > 0.5)
print('GRADE plumage outside the gloss band sRGB', (out[nog].mean(0) * 255).round(1), 'in it', (out[ing].mean(0) * 255).round(1))
print('GRADE source plumage mean sRGB', (SRC_MEAN * 255).round(1), 'gain', gain.round(3), 'gloss texels', int((gmap > 0.3).sum()), 'plumage mean sRGB', (out[mask].mean(0) * 255).round(1),
      'legs', (out[label == LEG_R].mean(0) * 255).round(1) if (label == LEG_R).any() else None,
      'bill', (out[label == BILL_R].mean(0) * 255).round(1) if (label == BILL_R).any() else None)
graded = bpy.data.images.new('graded', W0, H0, alpha=False)
graded.colorspace_settings.name = 'sRGB'
graded.pixels.foreach_set(np.concatenate([out, np.ones((H0, W0, 1), dtype=np.float32)], axis=2).ravel())
src_mat = bpy.data.materials.new('graded_src'); src_mat.use_nodes = True
nt = src_mat.node_tree; nt.nodes.clear()
ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = graded; ti.interpolation = 'Linear'
em = nt.nodes.new('ShaderNodeEmission'); mo = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(ti.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs['Emission'], mo.inputs['Surface'])
base_me.materials.append(src_mat)

# ---- parts ----
HIP_Y = {}
legv = [v.co for v in base_me.vertices if TROUSER_D - 0.01 < v.co.z < TROUSER_D + 0.01 and abs(v.co.x) < 0.11 and v.co.y < 0.16]
for s in (1, -1):
    side = [c for c in legv if c.x * s > 0]
    HIP_Y[s] = (sum(c.y for c in side) / len(side), sum(c.x for c in side) / len(side)) if side else (0.0, 0.04 * s)
def hip(s): return Vector((HIP_Y[s][1], HIP_Y[s][0], BELLY_D + 0.03))
def tail_top(y): return TAIL_BASE.z - (y - TAIL_BASE.y) * 0.33
def part_of(c):
    """(part, weight, pivot) for a rest position (scaled Blender frame)."""
    s = 1 if c.x > 0 else -1
    if c.z < BELLY_D and abs(c.x) < 0.11 and -0.17 < c.y < 0.13:
        return (LEG_A if s > 0 else LEG_B), 1 - smooth(TROUSER_D, BELLY_D + 0.005, c.z), hip(s)
    wh = smooth(NECK.y + 0.018, NECK.y - 0.018, c.y)
    if wh > 0: return HEAD, wh, NECK
    inw = smooth(-0.004, 0.012, poly_dist(c.y, c.z, WING_OUTLINE))
    lat = smooth(0.035, 0.065, abs(c.x))
    over_tail = c.y > TAIL_BASE.y + 0.02 and c.z > tail_top(c.y) + 0.012
    ww = inw * max(lat, 1.0 if over_tail else 0.0)
    wt = smooth(TAIL_BASE.y - 0.025, TAIL_BASE.y + 0.02, c.y) * (0.0 if over_tail else 1.0)
    if ww > 0.05 and ww >= wt:
        if c.y > HAND_Y: return (HAND_L if s > 0 else HAND_R), ww * smooth(HAND_Y - 0.01, HAND_Y + 0.03, c.y), Vector((s * WRIST.x, WRIST.y, WRIST.z))
        return (WING_L if s > 0 else WING_R), ww, Vector((s * SHOULDER.x, SHOULDER.y, SHOULDER.z))
    if wt > 0: return TAIL, wt, TAIL_BASE
    return BODY, 0.0, SHIFT.copy()

# ---- tiers ----
def decimated(name, target):
    ob = base.copy(); ob.data = base_me.copy(); ob.name = name; ob.data.name = name; sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    for uv in list(ob.data.uv_layers): ob.data.uv_layers.remove(uv)   # Meshy's atlas seams would stall the collapse
    dm = ob.modifiers.new('dec', 'DECIMATE'); dm.decimate_type = 'COLLAPSE'; dm.ratio = target / len(ob.data.polygons)
    dm.use_symmetry = True; dm.symmetry_axis = 'X'; dm.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    # still stalled, or a lower tier (the crow's direct collapse to ~400 drew the feet up into the belly and flattened the
    # head and bill): rebuild it from a voxel remesh (closed, clean)
    if len(ob.data.polygons) > 1.3 * target or target < 1000:
        bpy.data.objects.remove(ob)
        ob = base.copy(); ob.data = base_me.copy(); ob.name = name; ob.data.name = name; sc.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        for uv in list(ob.data.uv_layers): ob.data.uv_layers.remove(uv)
        rm = ob.modifiers.new('vox', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.008   # 5 mm leaves slivers the collapse then wrecks; 8 mm keeps bill, legs and tail
        bpy.ops.object.modifier_apply(modifier='vox')
        dm = ob.modifiers.new('dec', 'DECIMATE'); dm.decimate_type = 'COLLAPSE'
        dm.ratio = target / sum(len(p.vertices) - 2 for p in ob.data.polygons)   # the remesh is quads
        dm.use_symmetry = True; dm.symmetry_axis = 'X'; dm.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    b = bmesh.new(); b.from_mesh(ob.data); bmesh.ops.triangulate(b, faces=b.faces); b.to_mesh(ob.data); b.free()
    ob.data.validate()
    return ob
tier_obs = [decimated(n, t) for n, t in TIERS]

# lod0: own UV layout, bake the graded texture onto it
lod0 = tier_obs[0]
lod0.data.uv_layers.new(name='UVMap')
bpy.ops.object.select_all(action='DESELECT'); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.012, area_weight=0.0, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')
baked = bpy.data.images.new('crow_ground_basecolor', TEX_SIZE, TEX_SIZE, alpha=False)
baked.colorspace_settings.name = 'sRGB'
bake_mat = bpy.data.materials.new('crow_ground'); bake_mat.use_nodes = True
bn = bake_mat.node_tree.nodes; bt = bn.new('ShaderNodeTexImage'); bt.image = baked; bn.active = bt
lod0.data.materials.clear(); lod0.data.materials.append(bake_mat)
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
bpy.ops.object.select_all(action='DESELECT'); base.select_set(True); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=0.006, max_ray_distance=0.03, margin=8,
                    margin_type='EXTEND', use_clear=True)
tex_path = os.path.join(bpy.app.tempdir, 'crow_ground_basecolor.jpg')
baked.filepath_raw = tex_path; baked.file_format = 'JPEG'
try: baked.save(filepath=tex_path, quality=90)
except TypeError: baked.save()
JPEG = open(tex_path, 'rb').read()
bpix = np.empty(TEX_SIZE * TEX_SIZE * 4, dtype=np.float32); baked.pixels.foreach_get(bpix)
bpix = bpix.reshape(TEX_SIZE, TEX_SIZE, 4)[:, :, :3]
print('BAKED mean sRGB', (bpix.reshape(-1, 3).mean(0) * 255).round(1), 'jpeg bytes', len(JPEG))

# per-face colour for the lower tiers: the graded texture averaged over the nearest full-mesh face
bvh = BVHTree.FromObject(base, bpy.context.evaluated_depsgraph_get())
face_col = {}
def full_face_colour(fi):
    if fi not in face_col:
        p = base_me.polygons[fi]; uvs = [uvl[li].uv for li in p.loop_indices]
        pts = [uvs[0], uvs[1], uvs[2], (uvs[0] + uvs[1] + uvs[2]) / 3]
        acc = np.zeros(3)
        for u, v in pts: acc += out[min(H0 - 1, int(v * H0)), min(W0 - 1, int(u * W0))]
        face_col[fi] = acc / len(pts)
    return face_col[fi]

def to3(p): return Vector(((p.x - SHIFT.x) * K, p.z * K, -(p.y - SHIFT.y) * K))   # glTF axes, origin between the feet, crow size
def dir3(n): return Vector((n.x, n.z, -n.y))                          # directions
def tier_data(ob, textured):
    m = ob.data; m.calc_loop_triangles()
    key2i = {}; pos = []; nrm = []; col = []; part = []; partw = []; piv = []; uvs = []; idx = []
    uvd = m.uv_layers.active.data if textured else None
    vtag = {v.index: part_of(v.co) for v in m.vertices}
    for p in m.polygons:
        if not textured:
            hit = bvh.find_nearest(p.center)
            # the nearest few full-mesh faces around the centre, so a decimated face is not one feather edge
            cols = [full_face_colour(hit[2])]
            for off in (Vector((0.004, 0, 0)), Vector((-0.004, 0, 0)), Vector((0, 0.004, 0)), Vector((0, -0.004, 0))):
                h2 = bvh.find_nearest(p.center + off)
                if h2[2] is not None: cols.append(full_face_colour(h2[2]))
            fc = enc2lin(np.mean(cols, axis=0))
        for li in p.loop_indices:
            vi = m.loops[li].vertex_index
            if textured:
                u, v = uvd[li].uv
                k = (vi, round(u, 5), round(v, 5))
            else:
                k = (vi, fc)
            if k not in key2i:
                key2i[k] = len(pos)
                co = m.vertices[vi].co
                pos.append(to3(co)); nrm.append(dir3(m.vertices[vi].normal))
                if textured:
                    c = bpix[min(TEX_SIZE - 1, int(v * TEX_SIZE)), min(TEX_SIZE - 1, int(u * TEX_SIZE))]
                    col.append(enc2lin(c)); uvs.append((u, 1 - v))
                else: col.append(fc)
                pt, w, pv = vtag[vi]
                part.append(float(pt)); partw.append(float(w)); piv.append(to3(pv))
            idx.append(key2i[k])
    print('TIER', ob.name, 'tris', len(idx) // 3, 'verts', len(pos))
    return dict(pos=pos, nrm=nrm, col=col, part=part, partw=partw, piv=piv, uv=uvs if textured else None, idx=idx)
tiers = [(ob.name, tier_data(ob, ob is lod0)) for ob in tier_obs]

# ---- GLB writer: one buffer, one mesh per tier, custom attributes _PART, _PARTW, _PIVOT; lod0 textured ----
buf = bytearray(); views = []; accs = []
def add(data_bytes, target=None):
    while len(buf) % 4: buf.append(0)
    off = len(buf); buf.extend(data_bytes)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data_bytes)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def acc_f(vals, n):
    flat = [float(x) for v in vals for x in (v[:] if n > 1 else [v])]
    a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[n]}
    if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
    accs.append(a); return len(accs) - 1
def acc_i(vals):
    big = max(vals) > 65535
    accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
    return len(accs) - 1
meshes = []; nodes = []
for name, t in tiers:
    attrs = {'POSITION': acc_f([tuple(p) for p in t['pos']], 3), 'NORMAL': acc_f([tuple(n.normalized()) for n in t['nrm']], 3),
             'COLOR_0': acc_f([tuple(c) for c in t['col']], 3),
             '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f([tuple(p) for p in t['piv']], 3)}
    prim = {'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}
    if t['uv']: attrs['TEXCOORD_0'] = acc_f(t['uv'], 2); prim['material'] = 0
    else: prim['material'] = 1
    meshes.append({'name': name, 'primitives': [prim]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
img_view = add(JPEG)
while len(buf) % 4: buf.append(0)
L3 = lambda p: [round(x, 5) for x in to3(p)]
RIG = {'kind': 'bird', 'length_m': CROW_LENGTH, 'folded_wings': True,
       'parts': {'BODY': BODY, 'LEG_A': LEG_A, 'LEG_B': LEG_B, 'TAIL': TAIL, 'WING_L': WING_L, 'WING_R': WING_R, 'HEAD': HEAD, 'HAND_L': HAND_L, 'HAND_R': HAND_R},
       'wing': L3(SHOULDER), 'wrist': L3(WRIST), 'head': L3(NECK), 'tail': L3(TAIL_BASE), 'hip_l': L3(hip(1)), 'hip_r': L3(hip(-1)),
       'note': f'LEG_A is the left leg, LEG_B the right; the stance is squared (feet level) but the {"left" if HIP_Y[1][0] < HIP_Y[-1][0] else "right"} '
               f'hip sits {abs(HIP_Y[1][0] - HIP_Y[-1][0]) * K * 100:.1f} cm ahead of the other, left from the source stride; '
               'wing (shoulder) and wrist are the left side (mirror x); HAND pivots at the wrist, WING at the shoulder'}
# the RAVEN_GROUND-like points for the client (animalModels.js): the body above the feet (the raven's, scaled), the HEAD
# part's pivot (base of the neck) and the bill tip, in the model's frame (+y up, +z forward)
GROUND = {'bodyY': round(RAVEN_BODY_Y * K, 4), 'head': [0.0] + L3(NECK)[1:], 'bill': [0.0] + L3(BILL_TIP)[1:]}
print('GROUND', GROUND, 'RIG', RIG)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_crow_ground.py (Blender)',
                  'copyright': 'American crow (ground): a variant of the common raven generated with Meshy (meshy.ai), tasks '
                               '01a171a4-7814-7301-b140-133459562f9f (mesh) and 01a171a8-2db4-7256-9b99-ae6f617dea98 (texture), owned by '
                               'the account holder (Aaron Brodeur), for the Wild Earth project; reshaped (head, bill, throat, tail), '
                               'rescaled, legs shortened, regraded, decimated and tagged by tools/build_crow_ground.py. CC BY-SA 4.0'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'materials': [{'name': 'crow_ground', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.8}},
                      {'name': 'crow_ground_vc', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.8}}],
        'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': img_view, 'mimeType': 'image/jpeg', 'name': 'crow_ground_basecolor'}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'rig': RIG, 'ground': GROUND, 'species': 'corvus_brachyrhynchos', 'role': 'ground (standing, walking, perched)',
                   'crow': {'head_scale': HEAD_S, 'crown_dome_m': round(CROWN_DOME * K, 4), 'bill': [BILL_LEN, BILL_DEPTH, BILL_STRAIGHT],
                            'throat_in': THROAT_IN, 'tail_square': [TAIL_SQ, TAIL_ROUND], 'scale_from_raven_frame': round(K, 5)},
                   'tiers': {n: len(t['idx']) // 3 for n, t in tiers}, 'texture_px': TEX_SIZE, 'textured_tiers': ['lod0'], 'leg_shorten': LEG_SHORTEN,
                   'stance_squared_m': round(STEP, 4),
                   'source': {'kind': 'variant', 'variant_of': 'corvus_corax', 'credits': 0, 'job_id': JOB_GEO, 'texture_job_id': JOB_TEX, 'ai_model': 'latest (meshy-7.1)',
                              'mode': 'text-to-3d preview + refine (2K base colour)', 'credit': 'generated with Meshy (meshy.ai)',
                              'meshy_asset': SRC_META['asset'], 'meshy_extras': SRC_META['extras'],
                              'meshy_asset_mesh_job': GEO_META['asset'] if GEO_META else None},
                   'license': 'CC BY-SA 4.0', 'built_by': 'tools/build_crow_ground.py'}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb), 'texture', len(JPEG))
