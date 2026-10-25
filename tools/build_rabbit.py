# Build client/assets/rabbit.glb, the ambient brush rabbit (Sylvilagus bachmani), from a CC0 model.
#
# Source: "Rabbit" by Čestmír Dammer (OpenGameArt user CDmir; made for Kelgar, www.kelgar.org), CC0 1.0
#   (page https://opengameart.org/content/rabbit-0, "License(s): CC0"; the archive's License.txt: "CC0 -
#   Public Domain"). File: https://opengameart.org/sites/default/files/rabbit-FBX.7z, extracted to
#   rabbit.fbx and texture/ (rigged, 10 clips, 1,700-triangle body plus alpha fur cards, 1K diffuse and normal
#   maps; a European rabbit or hare). Download record: library/animals/jobs/sylvilagus_bachmani/download-opengameart/job.json.
#
# Rebuild (Blender 4.1, from the repo root; extract the archive first, e.g. tar -xf rabbit-FBX.7z -C extracted):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_rabbit.py -- \
#       library/animals/jobs/sylvilagus_bachmani/download-opengameart/extracted/rabbit.fbx client/assets/rabbit.glb
#
# What it does (brief: library/animals/drafts/sylvilagus_bachmani.md): drops the fur cards and the whisker
# strands; bakes the resting crouch (frame 1 of the source's "Sitting.000" clip: hind legs folded under,
# forelegs planted, head level, ears up), symmetrised in x; ears 0.55x about their base (hare ears to a brush
# rabbit's 5-6 cm); tail 0.5x about its root; origin centred between the feet; scales head and body (nose to
# tail root, measured along the spine since the crouch tilts the body) to 0.33 m. Colour: the diffuse texture is sampled per face (its ticking and the eye) and multiplied
# onto the brief's darker palette by region: grey-brown back, flanks, warmer nape and ear backs with dark rims,
# pale grey belly, chin and inner legs, buff feet, tail dark above and pale below, dark eye with a pale ring.
# Decimates (collapse, X symmetry; ears, eyes and face protected) to lod0 ~900, lod1 ~300, lod2 ~60
# triangles (no eyes on lod1 and lod2). Rig, template R (rodent and lagomorph, animalModels.js): BODY 0
# (hindquarters and thighs), CHEST 7 (fore body, pivot at the lumbar joint; flexes in the bound, rises to sit up),
# LEG_A 1 (fore pair, pivots at the elbows) and HEAD 6 (neck, head and ears; pivot at the neck base), both
# children of the chest, LEG_B 2 (hind pair with the long hind feet, pivots at the stifles), TAIL 3; from the
# skin weights. Parent pivots in extras.rig.
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 900, 1.0), ('lod1', 300, 0.0), ('lod2', 60, 0.0)]   # (name, triangles, protect ears and eyes)
HEAD_BODY = 0.33        # m, nose to tail root (brief: 30-37 cm)
EAR, TAIL = 0.55, 0.5
POSE = ('Armature|Armature|Sitting.000', 1)   # the resting crouch (also Jump and Guarding frame 1); symmetric

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
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(arm)
me = ob.data
A.weld(me, 1e-4)

# drop whisker strands: loose 8-face ribbons
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
    vs = {v for g in isl for v in g.verts}
    lo = Vector([min(v.co[i] for v in vs) for i in range(3)]); hi = Vector([max(v.co[i] for v in vs) for i in range(3)])
    ext = sorted(hi - lo)
    print('ISLAND faces', len(isl), 'extent', [round(x, 3) for x in ext])
    if len(isl) <= 12: drop.extend(isl)        # whisker strands are loose 8-face ribbons (the eyes are 18-face islands)
bmesh.ops.delete(bm, geom=drop, context='FACES')
bm.to_mesh(me); bm.free(); me.update()
print('INFO dropped whisker faces', len(drop))

groups = {g.index: g.name for g in ob.vertex_groups}
def bw(v, names): return sum(g.weight for g in v.groups if groups.get(g.group) in names)

ground = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= ground
J = {k: Vector((p.x, p.y, p.z - ground)) for k, p in J.items()}
# symmetrise: average each joint pair, mirror the right half from the left (the crouch frame is nearly symmetric)
for k in list(J):
    if k.endswith('_L') or '_L.' in k:
        r = k.replace('_L', '_R'); a, b = J[k], J[r]
        J[k] = Vector(((a.x - b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)); J[r] = Vector((-J[k].x, J[k].y, J[k].z))
    elif not (k.endswith('_R') or '_R.' in k):
        J[k].x = 0.0
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.symmetrize(direction='POSITIVE_X', threshold=0.02)
bpy.ops.object.mode_set(mode='OBJECT'); me = ob.data
A.weld(me, 1e-4)

# ears 0.55x about their base; tail 0.5x about its root
EARB = {'L': J['Ear_L'], 'R': J['Ear_R']}
for v in me.vertices:
    for s in 'LR':
        w = bw(v, {f'Ear_{s}', f'Ear_{s}.001'})
        if w > 0: v.co = v.co.lerp(EARB[s] + (v.co - EARB[s]) * EAR, min(1.0, w))
    w = bw(v, {'Tail'})
    if w > 0: v.co = v.co.lerp(J['Tail'] + (v.co - J['Tail']) * TAIL, min(1.0, w))
for s in 'LR':
    for k in (f'Ear_{s}.001',): J[k] = EARB[s] + (J[k] - EARB[s]) * EAR

# scale: head and body measured along the spine (nose, head, neck, spine, hips, tail root) = HEAD_BODY, since the
# crouch tilts the body; origin between fore and hind feet
nosev = min(me.vertices, key=lambda v: v.co.y - 0.3 * v.co.z).co.copy()
spine = [nosev, J['Head'], J['Neck'], J['Spine.001'], J['Spine'], J['Hips'], J['Tail']]
S = HEAD_BODY / sum((spine[i + 1] - spine[i]).length for i in range(len(spine) - 1))
y0 = (J['FrontPaw_L'].y + J['BackPaw_L'].y) / 2
def sc_(p): return Vector((p.x * S, (p.y - y0) * S, p.z * S))
for v in me.vertices: v.co = sc_(v.co)
JS = {k: sc_(p) for k, p in J.items()}
me.update()
zmax_body = max(v.co.z for v in me.vertices if bw(v, {'Spine', 'Spine.001', 'Hips'}) > 0.5)
ear_h = max(v.co.z for v in me.vertices) - JS['Ear_L'].z
print('LANDMARKS head-body', HEAD_BODY, 'back height', round(zmax_body, 3), 'ear length', round(ear_h, 3), 'total height', round(max(v.co.z for v in me.vertices), 3),
      'length with tail', round(max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices), 3))

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

# eye centre: the darkest texels on the head's left side
head_f = [p for p in me.polygons if all(bw(me.vertices[i], {'Head'}) > 0.6 for i in p.vertices) and p.center.x > 0]
dark = sorted(head_f, key=lambda p: lum(tex(me, p)))[:6]
EYEC = sum((p.center for p in dark), Vector()) / len(dark)
REF = np.median([lum(tex(me, p)) for p in me.polygons])
print('LANDMARKS eye', [round(x, 3) for x in EYEC], 'texture median luminance', round(float(REF), 3))

# ---- palette (sRGB, brief section 1) ----
BACK, FLANK, NAPE, RIM, BELLY = 0x7a6553, 0x8a7663, 0x7b5a40, 0x3a2e25, 0xc6bfb2
TAILTOP, TAILUNDER, FEET, EYE, RING = 0x4a3c30, 0xcfc9bd, 0x9a856c, 0x120f0d, 0xd8cfbf
pg = ob.vertex_groups.new(name='protect')
for v in me.vertices:
    if bw(v, {'Ear_L', 'Ear_R', 'Ear_L.001', 'Ear_R.001'}) > 0.5 or ((Vector((abs(v.co.x), v.co.y, v.co.z)) - EYEC).length < 0.012): pg.add([v.index], 1.0, 'REPLACE')
print('INFO protected vertices', sum(1 for v in me.vertices if any(g.group == pg.index for g in v.groups)), 'of', len(me.vertices))

def face_color(m, p, wts):
    c = p.center; n = p.normal; t = tex(m, p); L = lum(t)
    k = max(0.7, min(1.3, (L / REF) ** 0.6)) if REF > 0 else 1.0
    def col(h, kk=k): return tuple(min(1.0, x * kk) for x in A.srgb2lin(h))
    w = lambda names: sum(wts[i].get(nm, 0) for i in p.vertices for nm in names) / len(p.vertices)
    q = Vector((abs(c.x), c.y, c.z))
    de = (q - EYEC).length
    if de < 0.0065 and L < REF * 0.6: return A.srgb2lin(EYE)
    if de < 0.009 and w(['Head']) > 0.5: return col(RING, 1.0)
    ear = w(['Ear_L', 'Ear_R', 'Ear_L.001', 'Ear_R.001'])
    if ear > 0.5:
        top = max(m.vertices[i].co.z for i in p.vertices)
        if top > EAR_TIP - 0.008: return col(RIM)
        return col(A.mix(NAPE, BELLY, 0.35) if n.y < -0.3 else NAPE)      # inner ear paler
    if w(['Tail']) > 0.5: return col(TAILTOP if n.z > -0.1 and n.y > -0.2 else TAILUNDER)
    if c.z < 0.012 and w(['FrontPaw_L', 'FrontPaw_R', 'BackPaw_L', 'BackPaw_R', 'FrontLeg_L', 'FrontLeg_R', 'BackLeg_L.001', 'BackLeg_R.001']) > 0.3: return col(FEET)
    if n.z < -0.45 or (w(['FrontLeg_L', 'FrontLeg_R', 'FrontPaw_L', 'FrontPaw_R']) > 0.5 and n.x * (1 if c.x > 0 else -1) < -0.3): return col(BELLY)
    if w(['Head']) > 0.5:
        if c.z < EYEC.z - 0.012 and n.z < 0.2: return col(A.mix(BELLY, FLANK, 0.4))   # chin, lower cheek
        if c.y > EYEC.y + 0.01 and n.z > 0.3: return col(NAPE)                       # nape behind the ears
        return col(A.mix(BACK, NAPE, 0.4))
    if w(['Neck']) > 0.4 and n.z > 0.2: return col(NAPE)
    if n.z > 0.45: return col(BACK)
    return col(FLANK)
EAR_TIP = max(v.co.z for v in me.vertices)

def vrig(m, wts):
    LA = {'FrontLeg_L', 'FrontPaw_L', 'FrontLeg_R', 'FrontPaw_R'}
    LB = {'BackLeg_L', 'BackLeg_L.001', 'BackPaw_L', 'BackLeg_R', 'BackLeg_R.001', 'BackPaw_R'}
    HD = {'Neck', 'Head', 'Ear_L', 'Ear_R', 'Ear_L.001', 'Ear_R.001'}
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
    if target <= 300:   # far tiers: no eye
        fc = lambda p, m=m, wts=wts: (lambda c: c if c != A.srgb2lin(EYE) and c != tuple(A.srgb2lin(RING)) else tuple(x * 1.0 for x in A.srgb2lin(A.mix(BACK, NAPE, 0.4))))(face_color(m, p, wts))
    else:
        fc = lambda p, m=m, wts=wts: face_color(m, p, wts)
    t = A.emit(m, fc, vrig(m, wts))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
A.write_glb(OUT, tiers, 'wild-earth tools/build_rabbit.py (Blender)',
            'Rabbit by Čestmír Dammer (CDmir, OpenGameArt, made for Kelgar), CC0 1.0; posed crouching, ears and tail shortened, recoloured as a brush rabbit, decimated',
            extras={'rig': {'kind': 'rodent', 'chest': [round(x, 4) for x in A.to3(JS['Spine'])], 'tail': [round(x, 4) for x in A.to3(JS['Tail'])],
                            'head': [round(x, 4) for x in A.to3(JS['Neck'])], 'fore': [round(x, 4) for x in A.to3(JS['FrontLeg_L'])],
                            'hind': [round(x, 4) for x in A.to3(JS['BackLeg_L'])], 'length_m': HEAD_BODY},
                    'species': 'sylvilagus_bachmani', 'head_body_m': HEAD_BODY, 'ear_scale': EAR, 'tail_scale': TAIL, 'pose': f'{POSE[0]} frame {POSE[1]}',
                    'parts': 'template R: BODY 0 (hindquarters), CHEST 7 (pivot at the lumbar), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head, ears) children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3'})
