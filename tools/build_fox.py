# Build client/assets/fox.glb, the ambient gray fox (Urocyon cinereoargenteus townsendi), from a CC0 model.
#
# Source: "Fox" by Quaternius (quaternius.com), Ultimate Animated Animal Pack, CC0 1.0
#   (https://creativecommons.org/publicdomain/zero/1.0/). Page: https://poly.pizza/m/Bc97C66HKi ("CC0 1.0");
#   file: https://static.poly.pizza/e18e86df-1692-48d8-ac6e-1e25ab4ad574.glb (1,848 triangles with the eyes,
#   skinned, 12 clips, flat material colours: a red fox). Download record:
#   library/animals/jobs/urocyon_cinereoargenteus/download-polypizza/job.json.
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_fox.py -- \
#       library/animals/jobs/urocyon_cinereoargenteus/download-polypizza/Fox.glb client/assets/fox.glb
#
# What it does (brief: library/animals/drafts/urocyon_cinereoargenteus.md): bakes the rest pose; legs below
# the belly 0.9x and the muzzle (ahead of the eyes) 0.9x, for the gray fox's short-legged, short-faced,
# cat-like build; tail 1.15x thicker; origin centred between the feet; scales to 0.37 m at the withers
# (dorsal surface over the shoulders). Recolours by region from the brief's palette, dropping the red fox's
# orange coat, black stockings and white tail tip: grizzled grey back with per-face noise, a black dorsal
# stripe from the withers down the top of the tail, a black tail tip, rusty cinnamon on the neck sides,
# chest sides, a lower flank band, the legs, the ear backs and the tail underside, white throat, cheeks and
# belly centre, and the black eye-to-muzzle stripe, lips and nose. Decimates (collapse, X symmetry; ears,
# eyes, face and tail tip protected) to lod0 ~1,800, lod1 ~700, lod2 ~200 triangles (no eyes on lod2).
# Writes the quadruped template's _PART/_PARTW/_PIVOT from the skin weights (tools/animal_glb.py), as
# tools/build_deer.py. The skeleton and clips are dropped here; keep the source for the later player fox.
import bpy, bmesh, sys, os
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 1800, 2.0), ('lod1', 700, 1.0), ('lod2', 200, 0.0)]   # (name, triangles, protection of ears/eyes/face/tail tip)
WITHERS = 0.37      # m, dorsal surface over the shoulders (brief: 35-40 cm; draw 0.37)
LEG, MUZZLE, TAIL_R = 0.9, 0.9, 1.15
TAIL_DROOP = (20, 14)   # degrees: the rest pose holds the tail level; lower it at the root and again mid-tail

ob, J = A.bake_skinned(SRC, 'Fox')
me = ob.data
A.weld(me)
mats = [m.name for m in me.materials]
cats = A.quaternius_cats([f'Tail{i}' for i in range(1, 9)], [f'Ear{i}.{s}' for s in 'LR' for i in range(1, 5)])
vweights = A.skin_reader(ob, cats)
groups = {g.index: g.name for g in ob.vertex_groups}
BODYB = {'Body', 'Back', 'Torso', 'Torso2', 'Torso3'}

# ---- shape, in source units (feet at z = 0) ----
ground = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= ground
J = {k: Vector((p.x, p.y, p.z - ground)) for k, p in J.items()}
belly = min(v.co.z for v in me.vertices if vweights(v)[1] in BODYB)
eye_i = {i for p in me.polygons if mats[p.material_index] == 'Eyes' for i in p.vertices}
eye_y = sum(me.vertices[i].co.y for i in eye_i) / len(eye_i)
def reshape(p):
    p = p.copy()
    p.z = p.z * LEG if p.z < belly else p.z - (1 - LEG) * belly          # legs below the belly line
    if p.y < eye_y: p.y = eye_y + (p.y - eye_y) * MUZZLE                 # muzzle ahead of the eyes
    return p
tail_axis = [J[f'Tail{i}'] for i in range(1, 9)]
tip = max(me.vertices, key=lambda v: v.co.y).co.copy(); tail_axis.append(Vector((0, tip.y, tail_axis[-1].z)))
for v in me.vertices:
    w = vweights(v)[0].get('tail', 0)
    if w > 0:   # thicker tail: push away from the tail axis, by tail weight
        d, t, q = A.poly_nearest(v.co, tail_axis)
        v.co = q + (v.co - q) * (1 + (TAIL_R - 1) * min(1, w * 1.5))
# lower the tail: rotate about Tail1 by TAIL_DROOP[0] and the outer half about Tail4 by TAIL_DROOP[1] more
from mathutils import Matrix
import math
def droop(p, w, t):
    for piv, ang, t0 in ((J['Tail1'], TAIL_DROOP[0], 0.0), (J['Tail4'], TAIL_DROOP[1], 0.35)):
        k = w * A.smooth(t0, t0 + 0.12, t)
        if k > 0: p = piv + Matrix.Rotation(-math.radians(ang) * k, 3, 'X') @ (p - piv)
    return p
for v in me.vertices:
    w = vweights(v)[0].get('tail', 0)
    if w > 0: v.co = droop(v.co, min(1, w * 1.2), A.poly_nearest(v.co, tail_axis)[1])
tail_axis = [droop(p, 1, A.poly_nearest(p, tail_axis)[1]) for p in tail_axis]
for i in range(2, 9): J[f'Tail{i}'] = tail_axis[i - 1]
for v in me.vertices: v.co = reshape(v.co)
J = {k: reshape(p) for k, p in J.items()}
tail_axis = [reshape(p) for p in tail_axis]
# origin between the fore and hind feet; scale to the withers height
y0 = (J['FF.L'].y + J['FFB.L'].y) / 2
wy = J['FrontUpperLeg.L'].y
top = max(v.co.z for v in me.vertices if abs(v.co.y - wy) < 0.12 and abs(v.co.x) < 0.15)
S = WITHERS / top
def sc(p): return Vector((p.x * S, (p.y - y0) * S, p.z * S))
for v in me.vertices: v.co = sc(v.co)
JS = {k: sc(p) for k, p in J.items()}
TA = [sc(p) for p in tail_axis]
me.update()

# ---- landmarks (metres) ----
eyes = [me.vertices[i].co for i in eye_i]
E = Vector((max(abs(c.x) for c in eyes), sum(c.y for c in eyes) / len(eyes), sum(c.z for c in eyes) / len(eyes)))
nose = min((v.co for v in me.vertices), key=lambda c: c.y)
BELLY = belly * LEG * S
head_len = abs(nose.y - JS['Head'].y)
print('LANDMARKS withers', round(top * S, 3), 'belly', round(BELLY, 3), 'eye', [round(x, 3) for x in E], 'nose', [round(x, 3) for x in nose],
      'length nose-to-tail-root', round(JS['Tail1'].y - nose.y, 3), 'tail', round(TA[-1].y - JS['Tail1'].y, 3))

# ---- palette (sRGB, brief section 1) ----
GREY, STRIPE, TIP, RUST, WHITE, MASK = 0x7c7d7f, 0x2a2725, 0x1d1b1a, 0xa2683e, 0xe8e2d6, 0x1a1817
BACKLINE = A.mix(GREY, STRIPE, 0.6)        # the dorsal line on the body is grizzled black, darker on the tail
RUST_GREY = A.mix(RUST, GREY, 0.45)        # legs' fronts, upper flank transition
EYE = 0x100c0a

# protect ears, eyes, face and tail tip in decimation
pg = ob.vertex_groups.new(name='protect')
for v in me.vertices:
    w, b = vweights(v)
    keep = (b or '').startswith('Ear') or v.index in eye_i or v.co.y < E.y + 0.01 or A.poly_nearest(v.co, TA)[1] > 0.75 and w.get('tail', 0) > 0.5
    if keep: pg.add([v.index], 1.0, 'REPLACE')

def face_color(m, p, vw):
    mat = mats[p.material_index]
    c = sum((m.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices); n = p.normal
    W = {}
    for i in p.vertices:
        for k, x in vw[i][0].items(): W[k] = W.get(k, 0) + x / len(p.vertices)
    bones = [vw[i][1] or '' for i in p.vertices]
    g = lambda col, a=0.12: A.grizzle(col, c, a)
    if mat == 'Eyes': return A.srgb2lin(EYE)
    if mat == 'Black': return A.srgb2lin(MASK)                       # nose
    # tail: black tip, black mane along the top, rust beneath, grizzled grey sides
    if W.get('tail', 0) > 0.5:
        d, t, q = A.poly_nearest(c, TA)
        if t > 0.8 or (t > 0.7 and len(m.polygons) < 400): return A.srgb2lin(TIP)
        if t > 0.08:
            if n.z > 0.65 and abs(c.x) < 0.45 * d: return g(STRIPE, 0.08)     # the mane: a black line along the top
            if n.z < -0.45: return g(RUST)
        return g(GREY, 0.15)
    ear = sum(b.startswith('Ear') for b in bones) * 2 > len(bones)
    if ear:
        if n.y < -0.2 and abs(n.x) < 0.8: return g(WHITE, 0.05)        # inner ear, facing forward
        return g(RUST if c.z < JS['Ear2.L'].z else A.mix(RUST, GREY, 0.3), 0.06)
    head = W.get('head', 0) > 0.5 and c.y < JS['Neck2'].y
    if head and c.y < JS['Neck3'].y + 0.02:
        # black stripe from the inner eye down to the side of the muzzle; black lips at the mouth line
        a, b = Vector((E.x * 0.7, E.y, E.z)), Vector((nose.x + 0.012, nose.y + 0.035, nose.z - 0.012))
        q = Vector((abs(c.x), c.y, c.z))
        if abs(n.x) > 0.25 and A.seg_dist(q, a, b) < 0.011 and c.y < E.y + 0.006: return A.srgb2lin(MASK)
        if c.y < nose.y + 0.02 and c.z < nose.z - 0.006: return A.srgb2lin(MASK)        # lips at the muzzle tip
        if mat == 'Main_Light' or (n.z < -0.3) or (c.z < E.z - 0.022 and c.y > E.y - 0.01): return g(WHITE, 0.04)  # cheeks, chin, throat
        if c.y < E.y: return g(A.mix(GREY, RUST, 0.2), 0.1)          # top of the muzzle, a little warm
        if c.y > E.y + 0.035 and c.z < E.z + 0.005 and abs(n.x) > 0.3: return g(RUST, 0.1)   # rufous behind the cheeks, up under the ears
        return g(GREY, 0.14)
    legs = [k for k in ('fl', 'fr', 'hl', 'hr') if W.get(k, 0) > 0.5]
    if legs and c.z < BELLY + 0.02:
        if c.z < 0.025: return g(A.mix(RUST, 0x4a3b30, 0.35), 0.06)   # feet: darker cinnamon, not black
        if n.y < -0.45 and abs(n.x) < 0.7: return g(RUST_GREY, 0.08)  # front of the leg greyer
        return g(RUST, 0.08)
    if mat == 'Main_Light' or n.z < -0.6:
        return g(WHITE, 0.04)                                          # throat, chest centre, belly centre
    neck = W.get('head', 0) > 0.3 or c.y < JS['FrontUpperLeg.L'].y - 0.03
    if neck:
        if n.z > 0.75 and abs(c.x) < 0.02: return g(BACKLINE, 0.08)
        if abs(n.x) > 0.25 and c.z < JS['Neck3'].z + 0.03: return g(RUST, 0.1)   # neck and chest sides
        return g(GREY, 0.14)
    # body: dorsal line, lower flank band, grizzled grey
    if n.z > 0.8 and abs(c.x) < 0.022 and JS['FrontUpperLeg.L'].y - 0.03 < c.y < JS['Tail1'].y + 0.02: return g(BACKLINE, 0.1)
    if c.z < BELLY + 0.045 and abs(n.x) > 0.3: return g(RUST, 0.1)
    if c.z < BELLY + 0.07 and abs(n.x) > 0.3: return g(RUST_GREY, 0.1)
    return g(GREY, 0.14)

tiers = []
for name, target, prot in TIERS:
    drop = (lambda f: mats[f.material_index] == 'Eyes') if target <= 300 else None
    o, n0 = A.tier_copy(ob, target, protect='protect' if prot else None, drop_faces=drop, protect_factor=prot)
    m = o.data
    vw = {v.index: vweights(v) for v in m.vertices}
    t = A.emit(m, lambda p: face_color(m, p, vw), A.skin_rig(m, cats, JS, vweights))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
A.write_glb(OUT, tiers, 'wild-earth tools/build_fox.py (Blender)',
            'Fox by Quaternius (quaternius.com, Ultimate Animated Animal Pack), CC0 1.0; reshaped and recoloured as a gray fox, rest pose baked, decimated',
            extras={'rig': {'kind': 'quadruped', 'head': [round(x, 4) for x in A.to3(JS['Neck1'])], 'tail': [round(x, 4) for x in A.to3(JS['Tail1'])],
                            'fore': [round(x, 4) for x in A.to3(JS['FrontUpperLeg.L'])], 'hind': [round(x, 4) for x in A.to3(JS['BackUpperLeg.L'])]},
                    'species': 'urocyon_cinereoargenteus', 'withers_m': WITHERS, 'leg_scale': LEG, 'muzzle_scale': MUZZLE, 'tail_radius_scale': TAIL_R,
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3, HEAD 6 (neck, head, ears)'})
