# Build client/assets/raven_ground.glb, the common raven on the ground (walking, perched), from a Meshy preview and its
# texture refine.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a171a4-7814-7301-b140-133459562f9f, ai_model latest (meshy-7.1),
#   triangle remesh to 20,000 faces (20,310 triangles), 2026-10-25 UTC (prompt: an adult raven standing, wings folded
#   tight, heavy bill with a bristle tuft, shaggy throat hackles, flat crown, wedge tail, scaled legs); and its refine,
#   task 01a171a8-2db4-7256-9b99-ae6f617dea98 (same geometry and UVs plus a 2048 px base-colour texture, no PBR). Job
#   records with both prompts: library/animals/jobs/corvus_corax/<task>/job.json.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; these files carried none beyond asset.generator, which is kept in extras.source.
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_raven_ground.py -- \
#       library/animals/jobs/corvus_corax/01a171a8-2db4-7256-9b99-ae6f617dea98/model.glb client/assets/raven_ground.glb \
#       [--texture library/animals/jobs/corvus_corax/01a171a8-2db4-7256-9b99-ae6f617dea98/texture_base_color.png] \
#       [--preview /tmp/raven_ground/raven_ground]
#
# What it does (brief: library/animals/drafts/corvus_corax.md; review notes in library/animals/corvus_corax.json):
# drops the remesher shards and the non-manifold fins (holes closed); scales bill tip to tail tip to 0.62 m; shortens
# the legs 15% (toe tops to belly), lowering the body onto them; squares the stance (the source walks mid-stride: the
# leading tarsus swings back about the intertarsal joint until its foot is level with the other, toes unchanged) and
# puts the origin on the ground between the feet. Grades the refine's texture to the brief's palette: it has no baked
# light but is about 3x too light and blue (plumage mean sRGB about 33, 40, 50); keeps 30% of its chroma, then a
# per-channel gain puts the plumage mean on #0e0f13 (the blue cast goes with it), and a gloss band (mantle, scapulars,
# folded coverts and secondaries) tints its lighter feather edges toward the blue-violet sheen #3a3f66; tarsi, toes and
# bill are repainted matte #141416 keeping the scale detail; the pale orange iris becomes dark brown #2a1c14 and its
# pale ring plumage-dark. Decimates (Blender collapse, X symmetry) to lod0 ~1,500, lod1 ~500 and lod2 ~150 triangles;
# bakes the graded texture onto lod0's own UV layout at 1024 px (fewer, larger charts than Meshy's atlas, so mips bleed
# less). Every tier also carries the graded colour as COLOR_0 (lod0 per vertex from its texture, lod1 and lod2 per face
# from the nearest full-mesh faces), so only lod0 needs the texture. Each vertex carries the bird rig template's part
# (animalModels.js PART: BODY 0, LEG_A 1 (left), LEG_B 2, TAIL 3, WING_L/R 4/5 (folded wing: coverts, secondaries,
# tertials; pivot at the shoulder), HEAD 6 (head and neck, pivot at the base of the neck), HAND_L/R 9/10 (folded
# primaries; pivot at the wrist)), the part's weight and its pivot as _PART, _PARTW, _PIVOT; the rig's pivots are in
# the GLB's extras.rig. The folded wings are tagged (extras.rig.folded_wings) so a ground rig can flick or droop them;
# a rig that collapses flight cards on pose must not collapse these (collapse 0).
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, NORMAL, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices; lod0
# also TEXCOORD_0 and material 0 with the 1K base-colour JPEG, lod1 and lod2 material 1, vertex colour only); metres,
# +y up, bill toward +z, +x the bird's left, origin on the ground between the feet.
# --preview <prefix>: renders <prefix>_montage.jpg (six views; rows textured lod0, vertex-colour lod1 and lod2, lod0's
# part map) and <prefix>_head.jpg (textured lod0 head close-up).
import bpy, bmesh, sys, json, struct, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
TEX = opt('--texture', os.path.join(os.path.dirname(SRC), 'texture_base_color.png'))
PREVIEW = opt('--preview', None)
JOB_GEO, JOB_TEX = '01a171a4-7814-7301-b140-133459562f9f', '01a171a8-2db4-7256-9b99-ae6f617dea98'
LENGTH = 0.62
LEG_SHORTEN = 0.15
TIERS = [('lod0', 1500), ('lod1', 500), ('lod2', 150)]
TEX_SIZE = 1024
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
PLUMAGE, SHEEN, BARE, IRIS = 0x0e0f13, 0x3a3f66, 0x141416, 0x2a1c14
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
    if len(ob.data.polygons) > 1.3 * target:   # still stalled: rebuild the far tier from a voxel remesh (closed, clean)
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
baked = bpy.data.images.new('raven_ground_basecolor', TEX_SIZE, TEX_SIZE, alpha=False)
baked.colorspace_settings.name = 'sRGB'
bake_mat = bpy.data.materials.new('raven_ground'); bake_mat.use_nodes = True
bn = bake_mat.node_tree.nodes; bt = bn.new('ShaderNodeTexImage'); bt.image = baked; bn.active = bt
lod0.data.materials.clear(); lod0.data.materials.append(bake_mat)
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
bpy.ops.object.select_all(action='DESELECT'); base.select_set(True); lod0.select_set(True); bpy.context.view_layer.objects.active = lod0
bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=0.006, max_ray_distance=0.03, margin=8,
                    margin_type='EXTEND', use_clear=True)
tex_path = os.path.join(bpy.app.tempdir, 'raven_ground_basecolor.jpg')
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

def to3(p): return Vector((p.x - SHIFT.x, p.z, -(p.y - SHIFT.y)))   # positions: glTF axes, origin between the feet
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
RIG = {'kind': 'bird', 'length_m': LENGTH, 'folded_wings': True,
       'parts': {'BODY': BODY, 'LEG_A': LEG_A, 'LEG_B': LEG_B, 'TAIL': TAIL, 'WING_L': WING_L, 'WING_R': WING_R, 'HEAD': HEAD, 'HAND_L': HAND_L, 'HAND_R': HAND_R},
       'wing': L3(SHOULDER), 'wrist': L3(WRIST), 'head': L3(NECK), 'tail': L3(TAIL_BASE), 'hip_l': L3(hip(1)), 'hip_r': L3(hip(-1)),
       'note': f'LEG_A is the left leg, LEG_B the right; the stance is squared (feet level) but the {"left" if HIP_Y[1][0] < HIP_Y[-1][0] else "right"} '
               f'hip sits {abs(HIP_Y[1][0] - HIP_Y[-1][0]) * 100:.1f} cm ahead of the other, left from the source stride; '
               'wing (shoulder) and wrist are the left side (mirror x); HAND pivots at the wrist, WING at the shoulder'}
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_raven_ground.py (Blender)',
                  'copyright': 'Common raven (ground): generated with Meshy (meshy.ai), tasks 01a171a4-7814-7301-b140-133459562f9f '
                               '(mesh) and 01a171a8-2db4-7256-9b99-ae6f617dea98 (texture), for the Wild Earth project; rescaled, '
                               'legs shortened, regraded, decimated and tagged by tools/build_raven_ground.py. CC BY-SA 4.0'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'materials': [{'name': 'raven_ground', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.8}},
                      {'name': 'raven_ground_vc', 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.8}}],
        'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': img_view, 'mimeType': 'image/jpeg', 'name': 'raven_ground_basecolor'}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'rig': RIG, 'species': 'corvus_corax', 'role': 'ground (standing, walking, perched)',
                   'tiers': {n: len(t['idx']) // 3 for n, t in tiers}, 'texture_px': TEX_SIZE, 'textured_tiers': ['lod0'], 'leg_shorten': LEG_SHORTEN,
                   'stance_squared_m': round(STEP, 4),
                   'source': {'kind': 'meshy', 'job_id': JOB_GEO, 'texture_job_id': JOB_TEX, 'ai_model': 'latest (meshy-7.1)',
                              'mode': 'text-to-3d preview + refine (2K base colour)', 'credit': 'generated with Meshy (meshy.ai)',
                              'meshy_asset': SRC_META['asset'], 'meshy_extras': SRC_META['extras'],
                              'meshy_asset_mesh_job': GEO_META['asset'] if GEO_META else None},
                   'license': 'CC BY-SA 4.0', 'built_by': 'tools/build_raven_ground.py'}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb), 'texture', len(JPEG))

# ---- optional preview: a 6-view montage (rows: textured lod0, vertex-colour lod1 and lod2, lod0's part map) and a
# head close-up of the textured lod0; Eevee, one sun, orthographic, every tile at the same scale ----
if PREVIEW:
    os.makedirs(os.path.dirname(os.path.abspath(PREVIEW)), exist_ok=True)
    for o in list(sc.objects): bpy.data.objects.remove(o)
    lam = bpy.data.materials.new('lam'); lam.use_nodes = True
    pn = lam.node_tree.nodes; pb = pn['Principled BSDF']; pb.inputs['Roughness'].default_value = 0.8
    tx = pn.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(tex_path)
    lam.node_tree.links.new(tx.outputs['Color'], pb.inputs['Base Color'])
    vcm = bpy.data.materials.new('vc'); vcm.use_nodes = True
    vpb = vcm.node_tree.nodes['Principled BSDF']; vpb.inputs['Roughness'].default_value = 0.8
    va = vcm.node_tree.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    vcm.node_tree.links.new(va.outputs['Color'], vpb.inputs['Base Color'])
    PARTCOL = {BODY: (0.5, 0.5, 0.5), LEG_A: (0.9, 0.2, 0.2), LEG_B: (0.2, 0.2, 0.9), TAIL: (0.9, 0.8, 0.1), WING_L: (0.1, 0.8, 0.3),
               WING_R: (0.1, 0.5, 0.2), HEAD: (0.9, 0.4, 0.9), HAND_L: (0.1, 0.9, 0.9), HAND_R: (0.1, 0.6, 0.6)}
    def mk(name, t, mode):
        P = [Vector((p.x, -p.z, p.y)) for p in t['pos']]
        me = bpy.data.meshes.new(name); me.from_pydata(P, [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)]); me.update()
        for p in me.polygons: p.use_smooth = mode == 'tex'
        if mode == 'tex':
            uvl2 = me.uv_layers.new(name='UVMap')
            for l in me.loops: u, v = t['uv'][l.vertex_index]; uvl2.data[l.index].uv = (u, 1 - v)
            me.materials.append(lam)
        else:
            ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            for i in range(len(P)):
                c = t['col'][i] if mode == 'vc' else PARTCOL[int(t['part'][i])] if t['partw'][i] > 0.5 or int(t['part'][i]) == 0 else (0.7, 0.7, 0.7)
                ca.data[i].color = (*c, 1.0)
            me.materials.append(vcm)
        ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob); ob.hide_render = True; return ob
    sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.exposure = 0.5
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.55, 0.6, 0.66, 1); bg.inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(45), 0, math.radians(35))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    sc.render.use_stamp = True; sc.render.stamp_font_size = 13
    for k in ('date', 'time', 'render_time', 'frame', 'frame_range', 'memory', 'hostname', 'camera', 'lens', 'scene', 'marker',
              'filename', 'sequencer_strip'):
        if hasattr(sc.render, 'use_stamp_' + k): setattr(sc.render, 'use_stamp_' + k, False)
    sc.render.use_stamp_note = True
    def shot(path, d, ctr, scale, note):
        cv = Vector(ctr); cam.data.ortho_scale = scale; cam.location = cv + Vector(d).normalized() * 6
        cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y' if abs(Vector(d).normalized().z) < 0.99 else 'X').to_euler()
        sc.render.stamp_note_text = note; sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    def save_jpeg(arr, path):
        h, w = arr.shape[:2]
        im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
        im.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), dtype=np.float32)], axis=2).ravel())
        sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = 0.0
        sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 85
        im.save_render(path, scene=sc)
    rows = [(f'{tiers[0][0]} textured', mk('r0', tiers[0][1], 'tex')), (f'{tiers[1][0]} vertex colour', mk('r1', tiers[1][1], 'vc')),
            (f'{tiers[2][0]} vertex colour', mk('r2', tiers[2][1], 'vc')), ('lod0 parts', mk('r3', tiers[0][1], 'parts'))]
    P0 = [Vector((p.x, -p.z, p.y)) for p in tiers[0][1]['pos']]
    ctr = Vector([(min(p[k] for p in P0) + max(p[k] for p in P0)) / 2 for k in range(3)])
    VIEWS = [('left', (1, 0, 0.08)), ('right', (-1, 0, 0.08)), ('front', (0.0, -1, 0.1)), ('back', (0.0, 1, 0.12)),
             ('top', (0.0, 0.0001, 1)), ('three-quarter', (0.75, -0.6, 0.45))]
    TILE = 300; sc.render.resolution_x = sc.render.resolution_y = TILE; sc.render.resolution_percentage = 100
    tmp = os.path.join(bpy.app.tempdir, 'tile.png')
    sc.render.image_settings.file_format = 'PNG'
    grid = np.zeros((TILE * len(rows), TILE * len(VIEWS), 3), dtype=np.float32)
    for ri, (rname, ob) in enumerate(rows):
        ob.hide_render = False
        for vi_, (vname, d) in enumerate(VIEWS):
            shot(tmp, d, ctr, 0.72, f'{rname}, {vname}  ({len(tiers[min(ri, 2) if ri < 3 else 0][1]["idx"]) // 3} tris)')
            im = bpy.data.images.load(tmp, check_existing=False); a = np.empty(TILE * TILE * 4, dtype=np.float32)
            im.pixels.foreach_get(a); bpy.data.images.remove(im)
            r0 = (len(rows) - 1 - ri) * TILE   # image rows run bottom-up
            grid[r0:r0 + TILE, vi_ * TILE:(vi_ + 1) * TILE] = a.reshape(TILE, TILE, 4)[:, :, :3]
        ob.hide_render = True
    save_jpeg(grid, f'{PREVIEW}_montage.jpg')
    # head close-up: textured lod0, from the left and a little ahead
    sc.render.image_settings.file_format = 'PNG'; sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = 0.5
    sc.render.resolution_x, sc.render.resolution_y = 720, 540
    rows[0][1].hide_render = False
    head_c = Vector((0, BILL_BASE_Y + 0.005, NECK.z + 0.035)) - SHIFT
    shot(tmp, (1, -0.45, 0.15), head_c, 0.25, 'lod0 textured, head')
    im = bpy.data.images.load(tmp, check_existing=False); a = np.empty(720 * 540 * 4, dtype=np.float32)
    im.pixels.foreach_get(a); bpy.data.images.remove(im)
    save_jpeg(a.reshape(540, 720, 4)[:, :, :3].copy(), f'{PREVIEW}_head.jpg')
    print('PREVIEW', f'{PREVIEW}_montage.jpg', f'{PREVIEW}_head.jpg')
