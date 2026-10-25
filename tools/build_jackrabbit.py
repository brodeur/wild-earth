# Build client/assets/jackrabbit.glb, the ambient black-tailed jackrabbit (Lepus californicus), from a CC0 model.
#
# Source: "Rabbit" by Čestmír Dammer (OpenGameArt user CDmir; made for Kelgar, www.kelgar.org), CC0 1.0
#   (page https://opengameart.org/content/rabbit-0, "License(s): CC0"; the archive's License.txt: "CC0 -
#   Public Domain"). File: https://opengameart.org/sites/default/files/rabbit-FBX.7z (the same archive the brush
#   rabbit is built from; a long-eared, long-legged, hare-like rabbit), extracted to rabbit.fbx and texture/.
#   Download record: library/animals/jobs/lepus_californicus/download-opengameart/job.json. No credits spent.
#
# Rebuild (Blender 4.1, from the repo root; extract the archive first, e.g. tar -xf rabbit-FBX.7z -C extracted):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_jackrabbit.py -- \
#       library/animals/jobs/lepus_californicus/download-opengameart/extracted/rabbit.fbx client/assets/jackrabbit.glb
#
# What it does (brief: library/animals/drafts/lepus_californicus.md): drops the fur cards and whisker strands; bakes
# the hunched sit (frame 1 of the source's "Sitting.000" clip: hind legs folded under, long hind feet flat, forelegs
# planted, ears up), symmetrised in x; makes it a hare: the forearms lengthened (the elbows, chest, head and ears
# lifted, the paws kept on the ground, the lift fading to nothing along the spine to the hips, so the fore body
# stands higher as a jackrabbit's does), the ears lengthened and broadened about their base, the body slimmed in
# width, the tail kept (a jackrabbit's is 5-11 cm); origin centred between the feet; scales head and body (nose to
# tail root, measured along the spine since the sit tilts the body) to 0.55 m. Colour: the diffuse texture is
# sampled per face (its ticking and the eye) and multiplied onto the brief's palette by region: grizzled grey-buff
# back, paler flanks, buff nape and chest, creamy white belly and inner legs, pale buff legs and feet, grey-buff
# ear backs with black tips and pale insides, the black tail top running up the rump as a stripe, the tail white
# below, a large dark eye with a pale ring. Decimates (collapse, X symmetry; ears, eyes and face protected) to
# lod0 ~1,000, lod1 ~350, lod2 ~80 triangles (no eye on lod1 and lod2). Rig, template R (rodent and lagomorph,
# animalModels.js), as tools/build_rabbit.py: BODY 0 (hindquarters and thighs), CHEST 7 (fore body, pivot at the
# lumbar joint), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head and ears; pivot at the neck base), both
# children of the chest, LEG_B 2 (hind pair with the long hind feet, stifles), TAIL 3; from the skin weights.
# Parent pivots in extras.rig.
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 1000, 1.0), ('lod1', 350, 0.0), ('lod2', 80, 0.0)]   # (name, triangles, protect ears and eyes)
HEAD_BODY = 0.55        # m, nose to tail root (brief: 47-63 cm)
EAR, EAR_WIDE = 0.92, 1.3     # ear length about its base; ear breadth across the ear (hare ears are broad)
FORE = 0.12             # forearm lengthened by this fraction (elbow to paw), lifting the fore body
SLIM = 0.9              # body width (x) outside the legs and head
TAIL = 1.0
POSE = ('Armature|Armature|Sitting.000', 1)   # the hunched sit; symmetric

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

# ---- hare proportions ----
EARS = {'Ear_L', 'Ear_R', 'Ear_L.001', 'Ear_R.001'}
LOWFORE = {'FrontLeg_L', 'FrontLeg_R', 'FrontPaw_L', 'FrontPaw_R'}
HIND = {'Hips', 'BackUpLeg_L', 'BackUpLeg_R', 'BackLeg_L', 'BackLeg_R', 'BackLeg_L.001', 'BackLeg_R.001', 'BackPaw_L', 'BackPaw_R', 'Tail'}
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
    if k == 'Spine': pass

# ears: longer about their base, broader across (perpendicular to the ear axis, in the ear's plane: x mostly)
EARB = {'L': J['Ear_L'], 'R': J['Ear_R']}
EARD = {}
for s in 'LR':
    vs = [v.co for v in me.vertices if bw(v, EARS) > 0.5 and (v.co.x > 0) == (s == 'L')]
    tip = max(vs, key=lambda c: (c - EARB[s]).length)
    EARD[s] = (tip - EARB[s]).normalized()
for v in me.vertices:
    s = 'L' if v.co.x > 0 else 'R'       # by side: symmetrize copies the left groups' names to the right half
    w = bw(v, EARS)
    if w > 0:
        d = v.co - EARB[s]; a = d.dot(EARD[s]); r = d - EARD[s] * a
        ax = Vector((0, 1, 0)).cross(EARD[s]).normalized()          # across the ear, roughly x
        r = r + ax * (r.dot(ax) * (EAR_WIDE - 1)) * min(1.0, max(0.0, a / 0.5))
        v.co = v.co.lerp(EARB[s] + EARD[s] * (a * EAR) + r, min(1.0, w))
    w = bw(v, {'Tail'})
    if w > 0 and TAIL != 1.0: v.co = v.co.lerp(J['Tail'] + (v.co - J['Tail']) * TAIL, min(1.0, w))
for s in 'LR':
    J[f'Ear_{s}.001'] = EARB[s] + (J[f'Ear_{s}.001'] - EARB[s]) * EAR
# slim the body in x (legs keep their spacing so the feet stay under it)
LEGS = LOWFORE | {'BackLeg_L', 'BackLeg_R', 'BackLeg_L.001', 'BackLeg_R.001', 'BackPaw_L', 'BackPaw_R'}
for v in me.vertices:
    w = 1.0 - min(1.0, bw(v, LEGS | EARS | {'Head'}))
    v.co.x *= 1.0 + (SLIM - 1.0) * w

# scale: head and body along the spine (nose, head, neck, spine, hips, tail root) = HEAD_BODY; origin between the feet
nosev = min(me.vertices, key=lambda v: v.co.y - 0.3 * v.co.z).co.copy()
spine = [nosev, J['Head'], J['Neck'], J['Spine.001'], J['Spine'], J['Hips'], J['Tail']]
S = HEAD_BODY / sum((spine[i + 1] - spine[i]).length for i in range(len(spine) - 1))
y0 = (J['FrontPaw_L'].y + J['BackPaw_L'].y) / 2
def sc_(p): return Vector((p.x * S, (p.y - y0) * S, p.z * S))
for v in me.vertices: v.co = sc_(v.co)
JS = {k: sc_(p) for k, p in J.items()}
EARBS = {s: sc_(p) for s, p in EARB.items()}
me.update()
zmax_body = max(v.co.z for v in me.vertices if bw(v, {'Spine', 'Spine.001', 'Hips'}) > 0.5)
ear_vs = [v.co for v in me.vertices if bw(v, EARS) > 0.5 and v.co.x > 0]
ear_tip = max(ear_vs, key=lambda c: (c - EARBS['L']).length)
# visible ear: from where the ear leaves the skull (lowest ear vertex with little head weight) to the tip
EARDS = (sc_(EARB['L'] + EARD['L']) - EARBS['L']).normalized()
# visible ear (about the length from the notch): from the lowest vertex skinned wholly to the ear, along the ear axis
ear_root = min((v.co for v in me.vertices if v.co.x > 0 and bw(v, EARS) > 0.97), key=lambda c: (c - EARBS['L']).dot(EARDS))
hindfoot = (sc_(J['BackLeg_L.001']) - sc_(JT['BackPaw_L'])).length
print('LANDMARKS head-body', HEAD_BODY, 'back height', round(zmax_body, 3), 'ear root->tip', round((ear_tip - EARBS['L']).dot(EARDS) - (ear_root - EARBS['L']).dot(EARDS), 3),
      'ear base joint->tip', round((ear_tip - EARBS['L']).length, 3), 'hind foot (hock to toe joint)', round(hindfoot, 3),
      'total height', round(max(v.co.z for v in me.vertices), 3),
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

# ---- palette (sRGB, brief section 1) ----
BACK, FLANK, NAPE, CHEST, BELLY = 0x8a7d6b, 0x9d907d, 0x9c8160, 0xb09878, 0xe0d9cb
LEG, EARBACK, EARTIP, EARIN, MUZZLE = 0xc6b79d, 0x8f8576, 0x1c1814, 0xcbbca4, 0xa39176
TAILTOP, TAILUNDER, EYE, RING = 0x1e1a16, 0xd9d3c7, 0x24180e, 0xd6ccb8
pg = ob.vertex_groups.new(name='protect')
for v in me.vertices:
    if bw(v, EARS) > 0.5 or ((Vector((abs(v.co.x), v.co.y, v.co.z)) - EYEC).length < 0.02): pg.add([v.index], 1.0, 'REPLACE')
EAR_LEN = (ear_tip - EARBS['L']).length
STRIPE_Y = JS['Tail'].y - 0.07          # the black of the tail runs ~7 cm up the rump, ~3 cm wide
SC = HEAD_BODY / 0.33                   # sizes below were set on the 0.33 m rabbit

def face_color(m, p, wts):
    c = p.center; n = p.normal; t = tex(m, p); L = lum(t)
    k = max(0.75, min(1.25, (L / REF) ** 0.6)) if REF > 0 else 1.0
    def col(h, kk=k): return tuple(min(1.0, x * kk) for x in A.srgb2lin(h))
    w = lambda names: sum(wts[i].get(nm, 0) for i in p.vertices for nm in names) / len(p.vertices)
    q = Vector((abs(c.x), c.y, c.z))
    de = (q - EYEC).length
    if de < 0.0065 * SC and L < REF * 0.6: return A.srgb2lin(EYE)
    if de < 0.0095 * SC and w(['Head']) > 0.5: return col(RING, 1.0)
    if w(list(EARS)) > 0.5:
        s = 'L' if c.x >= 0 else 'R'
        a = (c - EARBS[s]).dot(EARD[s]) / EAR_LEN
        if a > 0.86: return col(EARTIP, 1.0)                          # black tip all round
        inner = n.y < -0.3
        if a > 0.72 and not inner: return col(EARTIP, 1.0)            # black on the back of the distal ear
        return col(EARIN if inner else EARBACK)
    if w(['Tail']) > 0.5: return col(TAILTOP, 1.0) if (n.z > -0.1 and n.y > -0.2) else col(TAILUNDER)
    if c.y > STRIPE_Y and abs(c.x) < 0.016 and (n.z > 0.2 or n.y > 0.3) and w(['Hips', 'Spine', 'Tail']) > 0.4: return col(TAILTOP, 1.0)
    legw = w(['FrontPaw_L', 'FrontPaw_R', 'BackPaw_L', 'BackPaw_R', 'FrontLeg_L', 'FrontLeg_R', 'BackLeg_L.001', 'BackLeg_R.001'])
    if legw > 0.5 or (c.z < 0.02 * SC and legw > 0.3): return col(LEG)
    if n.z < -0.45 or (w(['FrontUpLeg_L', 'FrontUpLeg_R']) > 0.5 and n.x * (1 if c.x > 0 else -1) < -0.3): return col(BELLY)
    if w(['Head']) > 0.5:
        if c.z < EYEC.z - 0.012 * SC and n.z < 0.2: return col(A.mix(BELLY, CHEST, 0.5))   # chin, lower cheek
        if c.y < EYEC.y - 0.014 * SC: return col(MUZZLE)
        if c.y > EYEC.y + 0.01 * SC and n.z > 0.3: return col(NAPE)
        return col(A.mix(BACK, FLANK, 0.5))
    if w(['Neck']) > 0.4: return col(NAPE if n.z > 0.2 else CHEST)
    if w(['Spine.001', 'FrontUpLeg_L', 'FrontUpLeg_R']) > 0.5 and n.y < -0.4 and n.z < 0.3: return col(CHEST)
    if n.z > 0.45: return col(BACK)
    return col(FLANK)

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

tiers = []
for name, target, prot in TIERS:
    o, n0 = A.tier_copy(ob, target, protect='protect' if prot else None, protect_factor=prot)
    m = o.data
    gmap = {g.index: g.name for g in o.vertex_groups}
    wts = {v.index: {gmap[g.group]: g.weight for g in v.groups if gmap[g.group] != 'protect'} for v in m.vertices}
    if target <= 350:   # far tiers: no eye
        noeye = A.srgb2lin(A.mix(BACK, FLANK, 0.5))
        fc = lambda p, m=m, wts=wts: (lambda c: noeye if c in (A.srgb2lin(EYE), tuple(A.srgb2lin(RING))) else c)(face_color(m, p, wts))
    else:
        fc = lambda p, m=m, wts=wts: face_color(m, p, wts)
    t = A.emit(m, fc, vrig(m, wts))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
A.write_glb(OUT, tiers, 'wild-earth tools/build_jackrabbit.py (Blender)',
            'Rabbit by Čestmír Dammer (CDmir, OpenGameArt, made for Kelgar), CC0 1.0; posed in a hunched sit, forearms, ears lengthened, recoloured as a black-tailed jackrabbit, decimated',
            extras={'rig': {'kind': 'rodent', 'chest': [round(x, 4) for x in A.to3(JS['Spine'])], 'tail': [round(x, 4) for x in A.to3(JS['Tail'])],
                            'head': [round(x, 4) for x in A.to3(JS['Neck'])], 'fore': [round(x, 4) for x in A.to3(JS['FrontLeg_L'])],
                            'hind': [round(x, 4) for x in A.to3(JS['BackLeg_L'])], 'length_m': HEAD_BODY},
                    'species': 'lepus_californicus', 'head_body_m': HEAD_BODY, 'ear_scale': EAR, 'ear_breadth': EAR_WIDE, 'forearm_scale': 1 + FORE,
                    'body_width': SLIM, 'pose': f'{POSE[0]} frame {POSE[1]}',
                    'parts': 'template R: BODY 0 (hindquarters), CHEST 7 (pivot at the lumbar), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head, ears) children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3'})
