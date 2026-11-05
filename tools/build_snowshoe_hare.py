# Build client/assets/snowshoe_hare.glb, the ambient snowshoe hare (Lepus americanus; the Olympic lowland form,
# L. a. washingtoni), a variant of the brush rabbit, from the same CC0 model.
#
# Source: variant of sylvilagus_bachmani built from its CC0 source, no credits: "Rabbit" by Čestmír Dammer (OpenGameArt
#   user CDmir; made for Kelgar, www.kelgar.org), CC0 1.0 (page https://opengameart.org/content/rabbit-0, "License(s):
#   CC0"; the archive's License.txt: "CC0 - Public Domain"). File: https://opengameart.org/sites/default/files/rabbit-FBX.7z
#   (the archive the brush rabbit and the jackrabbit are built from), extracted to rabbit.fbx and texture/. Download
#   record: library/animals/jobs/sylvilagus_bachmani/download-opengameart/job.json. The adopted tiers are released with
#   the project's assets under CC BY-SA 4.0 (CC0 places no conditions); the credit is kept anyway.
#
# Rebuild (Blender 4.1, from the repo root; extract the archive first, e.g. tar -xf rabbit-FBX.7z -C extracted), then skin
# it (the lagomorph path of the rigger, chosen by the species' order) and bake its clips:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_snowshoe_hare.py -- \
#       library/animals/jobs/sylvilagus_bachmani/download-opengameart/extracted/rabbit.fbx client/assets/snowshoe_hare.glb
#   arch -arm64 .venv/bin/python tools/rig_quadruped.py client/assets/snowshoe_hare.glb
#   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs client/assets/snowshoe_hare.glb --tile utm10n_429_5293
#
# What it does (as tools/build_jackrabbit.py, the hare from the same model): drops the fur cards and whisker strands;
# bakes the resting crouch (frame 1 of the source's "Sitting.000" clip: hind legs folded under, long hind feet flat,
# forelegs planted, ears up), symmetrised in x; makes it a snowshoe hare: the forearms a little longer (the fore body
# lifted 5 %, fading along the spine to the hips), the ears shorter and a little broader about their base (about 7 cm
# from where they leave the head: between the brush rabbit's and the jackrabbit's), the tail shortened to about 4 cm,
# and the hind feet made the "snowshoes": the whole foot from the heel 1.45x longer and 1.6x broader across, 1.15x deeper
# (about 13 cm heel to toe tip, visibly longer and wider than the brush rabbit's); origin centred between the feet;
# scales head and body (nose to tail root, measured along the spine since the crouch tilts the body) to 0.42 m.
# Colour: the diffuse texture is sampled per face (its ticking and the eye) and multiplied onto the palette by region.
# COLOR_0, the summer coat (on the Olympic lowlands these hares stay brown all winter): rusty grey-brown back finely
# ticked dark, a darker dorsal line, paler grey-buff flanks, buff nape, white belly, chin and inner legs, the big hind
# feet pale buff-white on the soles and edges, ears brown with black-edged tips and a pale rim, the tail dark above and
# white below, a dark eye with a pale ring. _COLORB (as tools/build_turkey.py writes the hen's; the client mixes to it by
# aAnim2.w), the winter white of the montane population: all white (faintly shaded by the texture) except the black
# ear tips (the last 1.5 cm of the ear's edge) and the dark eye. Decimates (collapse, X symmetry; ears, eyes and feet
# protected on lod0; lod2 keeps the ear tips) to lod0 ~1,000, lod1 ~350, lod2 ~80 triangles (no eye on lod1 and lod2).
# Rig, template R (rodent and lagomorph, animalModels.js), as tools/build_rabbit.py: BODY 0 (hindquarters and thighs),
# CHEST 7 (fore body, pivot at the lumbar joint), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head and ears; pivot at
# the neck base), both children of the chest, LEG_B 2 (hind pair with the long hind feet, stifles), TAIL 3; from the
# skin weights. Parent pivots in extras.rig (kind 'rodent': chest, tail, head, fore, hind, length_m). Then
# tools/rig_quadruped.py gives it the lagomorph skeleton (the species is in Lagomorpha).
import bpy, bmesh, sys, os, math, json, struct
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 1000, 1.0), ('lod1', 350, 0.0), ('lod2', 80, 0.0)]   # (name, triangles, protect ears, eyes and feet)
HEAD_BODY = 0.42        # m, nose to tail root
EAR, EAR_WIDE = 0.66, 1.15    # ear length about its base; ear breadth across the ear
FORE = 0.05             # forearm lengthened by this fraction (elbow to paw), lifting the fore body
TAIL = 0.7
FOOT_L, FOOT_W, FOOT_H = 1.55, 1.6, 1.15    # the hind foot from the heel: length, breadth across, depth
POSE = ('Armature|Armature|Sitting.000', 1)   # the resting crouch; symmetric

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == 'MESH' and o.name != 'Rabbit': bpy.data.objects.remove(o)      # the alpha fur cards
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
ob = sc.objects['Rabbit']
arm.animation_data_create(); arm.animation_data.action = bpy.data.actions[POSE[0]]
sc.frame_set(POSE[1]); bpy.context.view_layer.update()
J = {pb.name: arm.matrix_world @ pb.head for pb in arm.pose.bones}
JT = {pb.name: arm.matrix_world @ pb.tail for pb in arm.pose.bones}
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(arm)
me = ob.data
A.weld(me, 1e-4)

# drop whisker strands: loose 8-face ribbons (the eyes are 18-face islands)
bm = bmesh.new(); bm.from_mesh(me)
seen = set(); drop = []
for f in bm.faces:
    if f in seen: continue
    stack = [f]; isl = []
    seen.add(f)
    while stack:
        g = stack.pop(); isl.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h not in seen: seen.add(h); stack.append(h)
    if len(isl) <= 12: drop.extend(isl)
bmesh.ops.delete(bm, geom=drop, context='FACES')
bm.to_mesh(me); bm.free(); me.update()
print('INFO dropped whisker faces', len(drop))

groups = {g.index: g.name for g in ob.vertex_groups}
def bw(v, names): return sum(g.weight for g in v.groups if groups.get(g.group) in names)

ground = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= ground
J = {k: Vector((p.x, p.y, p.z - ground)) for k, p in J.items()}
JT = {k: Vector((p.x, p.y, p.z - ground)) for k, p in JT.items()}
for D in (J, JT):
    for k in list(D):
        if k.endswith('_L') or '_L.' in k:
            r = k.replace('_L', '_R'); a, b = D[k], D[r]
            D[k] = Vector(((a.x - b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)); D[r] = Vector((-D[k].x, D[k].y, D[k].z))
        elif not (k.endswith('_R') or '_R.' in k):
            D[k].x = 0.0
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.symmetrize(direction='POSITIVE_X', threshold=0.02)
bpy.ops.object.mode_set(mode='OBJECT'); me = ob.data
A.weld(me, 1e-4)

# ---- snowshoe hare proportions ----
EARS = {'Ear_L', 'Ear_R', 'Ear_L.001', 'Ear_R.001'}
LOWFORE = {'FrontLeg_L', 'FrontLeg_R', 'FrontPaw_L', 'FrontPaw_R'}
HIND = {'Hips', 'BackUpLeg_L', 'BackUpLeg_R', 'BackLeg_L', 'BackLeg_R', 'BackLeg_L.001', 'BackLeg_R.001', 'BackPaw_L', 'BackPaw_R', 'Tail'}
FOOT = {'BackLeg_L.001', 'BackLeg_R.001', 'BackPaw_L', 'BackPaw_R'}
elbow_z, paw_z = J['FrontLeg_L'].z, J['FrontPaw_L'].z
LIFT = FORE * (elbow_z - paw_z)
y_hip, y_lum = J['Spine'].y, J['Spine.001'].y       # lift fades from the chest (Spine.001) back to the hips
def lift_f(v):
    """0 (hindquarters) to 1 (chest, head, upper forelegs) by skin weight; the lower forelegs ramp from the paw."""
    tot = sum(g.weight for g in v.groups if groups.get(g.group)) or 1.0
    f = 0.0
    for g in v.groups:
        n = groups.get(g.group)
        if n is None: continue
        if n in HIND: k = 0.0
        elif n in LOWFORE: k = max(0.0, min(1.0, (v.co.z - paw_z) / (elbow_z - paw_z)))
        elif n == 'Spine': k = A.smooth(y_hip, y_lum, v.co.y)
        else: k = 1.0
        f += g.weight * k
    return f / tot
F = [lift_f(v) for v in me.vertices]
for v, f in zip(me.vertices, F): v.co.z += LIFT * f
for k in list(J):
    if k.startswith(('Spine.001', 'Neck', 'Head', 'Ear', 'FrontUpLeg', 'FrontLeg')) and not k.startswith('IK'):
        J[k] = J[k] + Vector((0, 0, LIFT))

# ears: shorter about their base, a little broader across; tail shorter about its root. By side (x sign): symmetrize
# copies the left groups' names to the right half
EARB = {'L': J['Ear_L'], 'R': J['Ear_R']}
EARD = {}
for s in 'LR':
    vs = [v.co for v in me.vertices if bw(v, EARS) > 0.5 and (v.co.x > 0) == (s == 'L')]
    tip = max(vs, key=lambda c: (c - EARB[s]).length)
    EARD[s] = (tip - EARB[s]).normalized()
for v in me.vertices:
    s = 'L' if v.co.x > 0 else 'R'
    w = bw(v, EARS)
    if w > 0:
        d = v.co - EARB[s]; a = d.dot(EARD[s]); r = d - EARD[s] * a
        ax = Vector((0, 1, 0)).cross(EARD[s]).normalized()          # across the ear, roughly x
        r = r + ax * (r.dot(ax) * (EAR_WIDE - 1)) * min(1.0, max(0.0, a / 0.5))
        v.co = v.co.lerp(EARB[s] + EARD[s] * (a * EAR) + r, min(1.0, w))
    w = bw(v, {'Tail'})
    if w > 0: v.co = v.co.lerp(J['Tail'] + (v.co - J['Tail']) * TAIL, min(1.0, w))
for s in 'LR':
    J[f'Ear_{s}.001'] = EARB[s] + (J[f'Ear_{s}.001'] - EARB[s]) * EAR

# the snowshoes: each hind foot (the metatarsus and the toes) scaled from the heel along its length, across and in depth
for s in 'LR':
    heel = J[f'BackLeg_{s}.001']; toe = JT[f'BackPaw_{s}']
    fd = toe - heel; fd.z = 0; fd.normalize()
    across = Vector((0, 0, 1)).cross(fd).normalized()
    for v in me.vertices:
        if (v.co.x > 0) != (s == 'L'): continue
        w = min(1.0, bw(v, FOOT))
        if w <= 0: continue
        d = v.co - heel
        a = d.dot(fd); c = d.dot(across); h = d.z
        k = A.smooth(-0.02, 0.06, a) if a < 0.06 else 1.0     # the heel's back end stays with the shank
        q = heel + fd * (a * (1 + (FOOT_L - 1) * k)) + across * (c * (1 + (FOOT_W - 1) * k))
        q.z = v.co.z * (1 + (FOOT_H - 1) * k)          # deeper from the sole up (the sole stays on the ground)
        v.co = v.co.lerp(q, w)
    JT[f'BackPaw_{s}'] = heel + (toe - heel) * FOOT_L
ground = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= ground
J = {k: Vector((p.x, p.y, p.z - ground)) for k, p in J.items()}
JT = {k: Vector((p.x, p.y, p.z - ground)) for k, p in JT.items()}

# scale: head and body along the spine (nose, head, neck, spine, hips, tail root) = HEAD_BODY; origin between the feet
nosev = min(me.vertices, key=lambda v: v.co.y - 0.3 * v.co.z).co.copy()
spine = [nosev, J['Head'], J['Neck'], J['Spine.001'], J['Spine'], J['Hips'], J['Tail']]
S = HEAD_BODY / sum((spine[i + 1] - spine[i]).length for i in range(len(spine) - 1))
y0 = (J['FrontPaw_L'].y + J['BackPaw_L'].y) / 2
def sc_(p): return Vector((p.x * S, (p.y - y0) * S, p.z * S))
for v in me.vertices: v.co = sc_(v.co)
JS = {k: sc_(p) for k, p in J.items()}
JTS = {k: sc_(p) for k, p in JT.items()}
EARBS = {s: sc_(p) for s, p in EARB.items()}
me.update()
zmax_body = max(v.co.z for v in me.vertices if bw(v, {'Spine', 'Spine.001', 'Hips'}) > 0.5)
ear_vs = [v.co for v in me.vertices if bw(v, EARS) > 0.5 and v.co.x > 0]
ear_tip = max(ear_vs, key=lambda c: (c - EARBS['L']).length)
EARDS = (sc_(EARB['L'] + EARD['L']) - EARBS['L']).normalized()
# visible ear (about the length from the notch): from the lowest vertex skinned wholly to the ear, along the ear axis
ear_root = min((v.co for v in me.vertices if v.co.x > 0 and bw(v, EARS) > 0.97), key=lambda c: (c - EARBS['L']).dot(EARDS))
EAR_LEN = (ear_tip - EARBS['L']).length
EAR_VIS = (ear_tip - EARBS['L']).dot(EARDS) - (ear_root - EARBS['L']).dot(EARDS)
foot = [v.co for v in me.vertices if v.co.x > 0 and bw(v, FOOT) > 0.5]
foot_len = max(c.y for c in foot) - min(c.y for c in foot)
foot_w = max(c.x for c in foot) - min(c.x for c in foot)
tailv = [v.co for v in me.vertices if bw(v, {'Tail'}) > 0.5]
tail_len = max((c - JS['Tail']).length for c in tailv)
print('LANDMARKS head-body', HEAD_BODY, 'back height', round(zmax_body, 3), 'ear root->tip', round(EAR_VIS, 3),
      'ear base joint->tip', round(EAR_LEN, 3), 'hind foot length (sole extent)', round(foot_len, 3), 'hind foot breadth', round(foot_w, 3),
      'tail (root joint to tip)', round(tail_len, 3), 'total height', round(max(v.co.z for v in me.vertices), 3),
      'length', round(max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices), 3),
      'width', round(2 * max(v.co.x for v in me.vertices), 3), 'elbow', round(JS['FrontLeg_L'].z, 3))

# ---- texture: sampled per face from the diffuse map (sRGB values) ----
img = next(i for i in bpy.data.images if 'skinn' in i.name)
W_, H_ = img.size; px = np.empty(W_ * H_ * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)
def tex(m, p):
    uvl = m.uv_layers.active.data
    uvs = [uvl[li].uv for li in p.loop_indices]
    c = sum((Vector(u) for u in uvs), Vector((0, 0))) / len(uvs)
    acc = np.zeros(3)
    for u in uvs + [c, c]:
        x = int((u.x % 1) * (W_ - 1)); y = int((u.y % 1) * (H_ - 1)); acc += px[y, x, :3]
    return acc / (len(uvs) + 2)
def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

head_f = [p for p in me.polygons if all(bw(me.vertices[i], {'Head'}) > 0.6 for i in p.vertices) and p.center.x > 0]
dark = sorted(head_f, key=lambda p: lum(tex(me, p)))[:6]
EYEC = sum((p.center for p in dark), Vector()) / len(dark)
REF = np.median([lum(tex(me, p)) for p in me.polygons])
print('LANDMARKS eye', [round(x, 3) for x in EYEC], 'texture median luminance', round(float(REF), 3))

# ---- palette (sRGB) ----
# summer (COLOR_0)
BACK, FLANK, NAPE, CHEST, BELLY = 0x7b5a3e, 0x8e7860, 0x8d643f, 0x9c8468, 0xe6e1d6
DORSAL, LEG, FOOTC, EARBACK, EARTIP, EARRIM = 0x4a3626, 0x98846a, 0xd6cbb6, 0x7a5d44, 0x1a1512, 0xcfc4ae
EARIN, MUZZLE, TAILTOP, TAILUNDER, EYE, RING = 0xb8a68c, 0x8e7a62, 0x3e3128, 0xe2ddd2, 0x1c140d, 0xd2c6b0
# winter (_COLORB)
SNOW, SNOW_SHADE = 0xf2f1ec, 0xe4e3de
pg = ob.vertex_groups.new(name='protect')
for v in me.vertices:
    if bw(v, EARS) > 0.5 or ((Vector((abs(v.co.x), v.co.y, v.co.z)) - EYEC).length < 0.02) or bw(v, FOOT) > 0.5: pg.add([v.index], 1.0, 'REPLACE')
EAR_TIP = max(v.co.z for v in me.vertices)
tg = ob.vertex_groups.new(name='eartips')     # lod2 keeps each ear's top 4 mm (else the collapse takes them to stubs)
for v in me.vertices:
    if bw(v, EARS) > 0.5 and v.co.z > EAR_TIP - 0.004: tg.add([v.index], 1.0, 'REPLACE')
SC = HEAD_BODY / 0.33                   # sizes below were set on the 0.33 m rabbit
TIP_K = 1 - 0.015 / EAR_LEN             # the last 1.5 cm of the ear: black tip (both coats)

def face_color(m, p, wts):
    """(summer, winter) linear colours of a face."""
    c = p.center; n = p.normal; t = tex(m, p); L = lum(t)
    k = max(0.75, min(1.25, (L / REF) ** 0.6)) if REF > 0 else 1.0
    def col(h, kk=k): return tuple(min(1.0, x * kk) for x in A.srgb2lin(h))
    kw = 0.94 + 0.06 * min(1.0, k)                       # the winter coat: faintly shaded by the texture
    snow = col(SNOW, kw)
    w = lambda names: sum(wts[i].get(nm, 0) for i in p.vertices for nm in names) / len(p.vertices)
    q = Vector((abs(c.x), c.y, c.z))
    de = (q - EYEC).length
    if de < 0.0065 * SC and L < REF * 0.6: return A.srgb2lin(EYE), A.srgb2lin(EYE)
    if de < 0.0095 * SC and w(['Head']) > 0.5: return col(RING, 1.0), snow
    if w(list(EARS)) > 0.5:
        s = 'L' if c.x >= 0 else 'R'
        a = (c - EARBS[s]).dot(EARD[s]) / EAR_LEN
        inner = n.y < -0.3
        if a > TIP_K: return col(EARTIP, 1.0), col(EARTIP, 1.0)                 # the black-edged tip, both coats
        if a > TIP_K - 0.08 and not inner: return col(EARRIM, 1.0), snow       # the pale rim below the black
        return col(EARIN if inner else EARBACK), snow
    if w(['Tail']) > 0.5: return (col(TAILTOP, 1.0) if (n.z > -0.1 and n.y > -0.2) else col(TAILUNDER)), snow
    footw = w(list(FOOT))
    if footw > 0.5: return col(FOOTC, min(1.05, k)), snow                       # the big hind feet, pale buff-white
    legw = w(['FrontPaw_L', 'FrontPaw_R', 'FrontLeg_L', 'FrontLeg_R'])
    if legw > 0.5:
        if n.x * (1 if c.x > 0 else -1) < -0.3 or c.z < 0.01 * SC: return col(BELLY), snow
        return col(LEG), snow
    if n.z < -0.45 or (w(['FrontUpLeg_L', 'FrontUpLeg_R']) > 0.5 and n.x * (1 if c.x > 0 else -1) < -0.3): return col(BELLY), snow
    if w(['Head']) > 0.5:
        if c.z < EYEC.z - 0.012 * SC and n.z < 0.2: return col(BELLY), snow      # chin, lower cheek
        if c.y < EYEC.y - 0.014 * SC: return col(MUZZLE), snow
        if c.y > EYEC.y + 0.01 * SC and n.z > 0.3: return col(NAPE), snow
        return col(A.mix(BACK, FLANK, 0.5)), snow
    if w(['Neck']) > 0.4: return col(NAPE if n.z > 0.2 else CHEST), snow
    if w(['Spine.001', 'FrontUpLeg_L', 'FrontUpLeg_R']) > 0.5 and n.y < -0.4 and n.z < 0.3: return col(CHEST), snow
    if n.z > 0.45:
        if abs(c.x) < 0.012 * SC: return col(DORSAL), snow                         # the darker dorsal line
        return col(BACK), snow
    return col(FLANK), snow

def vrig(m, wts):
    LA = {'FrontLeg_L', 'FrontPaw_L', 'FrontLeg_R', 'FrontPaw_R'}
    LB = {'BackLeg_L', 'BackLeg_L.001', 'BackPaw_L', 'BackLeg_R', 'BackLeg_R.001', 'BackPaw_R'}
    HD = {'Neck', 'Head'} | EARS
    def rig(i):
        w = wts[i]; tot = sum(w.values()) or 1
        cats = {1: sum(w.get(b, 0) for b in LA) / tot, 2: sum(w.get(b, 0) for b in LB) / tot,
                3: w.get('Tail', 0) / tot, 6: sum(w.get(b, 0) for b in HD) / tot,
                7: (w.get('Spine.001', 0) + w.get('FrontUpLeg_L', 0) + w.get('FrontUpLeg_R', 0) + 0.5 * w.get('Spine', 0)) / tot,
                0: (w.get('Hips', 0) + w.get('BackUpLeg_L', 0) + w.get('BackUpLeg_R', 0) + 0.5 * w.get('Spine', 0)) / tot}
        pid = max(cats, key=cats.get)
        if pid == 0 or cats[pid] < 0.05: return dict(part=0, partw=0.0, pivot=Vector())
        x = m.vertices[i].co.x; s = 'L' if x >= 0 else 'R'
        piv = {1: JS[f'FrontLeg_{s}'], 2: JS[f'BackLeg_{s}'], 3: JS['Tail'], 6: JS['Neck'], 7: JS['Spine']}[pid]
        return dict(part=pid, partw=min(1.0, cats[pid]), pivot=piv)
    return rig

def emit2(m, face_color2, vert_rig):
    """animal_glb.emit with two colour sets: vertices split where either face colour differs."""
    key2i = {}; out = dict(pos=[], col=[], colb=[], part=[], partw=[], piv=[], idx=[])
    rig = {}
    for p in m.polygons:
        fa, fb = face_color2(p); fa = tuple(fa); fb = tuple(fb)
        for vi in p.vertices:
            k = (vi, fa, fb)
            if k not in key2i:
                key2i[k] = len(out['pos'])
                if vi not in rig: rig[vi] = vert_rig(vi)
                r = rig[vi]
                out['pos'].append(A.to3(m.vertices[vi].co)); out['col'].append(fa); out['colb'].append(fb)
                out['part'].append(float(r['part'])); out['partw'].append(float(r['partw'])); out['piv'].append(A.to3(r['pivot']))
            out['idx'].append(key2i[k])
    return out

def write_glb2(path, tiers, generator, copyright, extras):
    """animal_glb.write_glb plus the _COLORB VEC3 attribute (as tools/build_turkey.py writes it)."""
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
                 '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f(t['piv'], 3), '_COLORB': acc_f(t['colb'], 3)}
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
    while len(buf) % 4: buf.append(0)
    g = {'asset': {'version': '2.0', 'generator': generator, 'copyright': copyright},
         'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
         'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}], 'extras': extras}
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    open(path, 'wb').write(glb)
    print('WROTE', path, len(glb), 'bytes;', ', '.join(f'{n} {len(t["idx"]) // 3} tris' for n, t in tiers))

tiers = []
for name, target, prot in TIERS:
    o, n0 = A.tier_copy(ob, target, protect='protect' if prot else ('eartips' if name == 'lod2' else None), protect_factor=prot or 1.0)
    m = o.data
    gmap = {g.index: g.name for g in o.vertex_groups}
    wts = {v.index: {gmap[g.group]: g.weight for g in v.groups if gmap[g.group] not in ('protect', 'eartips')} for v in m.vertices}
    if target <= 350:   # far tiers: no eye
        noeye = A.srgb2lin(A.mix(BACK, FLANK, 0.5)); eyes = (A.srgb2lin(EYE), tuple(A.srgb2lin(RING)))
        def fc(p, m=m, wts=wts):
            a, b = face_color(m, p, wts)
            if tuple(a) in eyes: return noeye, A.srgb2lin(SNOW)
            return a, b
    else:
        fc = lambda p, m=m, wts=wts: face_color(m, p, wts)
    t = emit2(m, fc, vrig(m, wts))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
write_glb2(OUT, tiers, 'wild-earth tools/build_snowshoe_hare.py (Blender)',
           'Rabbit by Čestmír Dammer (CDmir, OpenGameArt, made for Kelgar), CC0 1.0; a variant of the brush rabbit for Wild Earth, posed crouching, ears and tail shortened, hind feet enlarged, recoloured as a snowshoe hare (summer coat, winter white in _COLORB), decimated; CC BY-SA 4.0',
           extras={'rig': {'kind': 'rodent', 'chest': [round(x, 4) for x in A.to3(JS['Spine'])], 'tail': [round(x, 4) for x in A.to3(JS['Tail'])],
                           'head': [round(x, 4) for x in A.to3(JS['Neck'])], 'fore': [round(x, 4) for x in A.to3(JS['FrontLeg_L'])],
                           'hind': [round(x, 4) for x in A.to3(JS['BackLeg_L'])], 'length_m': HEAD_BODY},
                   'species': 'lepus_americanus', 'variant_of': 'sylvilagus_bachmani', 'head_body_m': HEAD_BODY, 'ear_scale': EAR, 'ear_breadth': EAR_WIDE,
                   'forearm_scale': 1 + FORE, 'tail_scale': TAIL, 'hind_foot_scale': [FOOT_L, FOOT_W, FOOT_H], 'pose': f'{POSE[0]} frame {POSE[1]}',
                   'variant': 'winter white coat in _COLORB (mixed by aAnim2.w); COLOR_0 the summer (lowland) coat',
                   'parts': 'template R: BODY 0 (hindquarters), CHEST 7 (pivot at the lumbar), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head, ears) children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3'})
