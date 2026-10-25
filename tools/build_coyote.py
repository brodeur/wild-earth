# Build client/assets/coyote.glb, the ambient coyote (Canis latrans; California valley coyote, C. l. ochropus),
# from a CC0 model.
#
# Source: "Wolf" by Quaternius (quaternius.com), Ultimate Animated Animal Pack, CC0 1.0
#   (https://creativecommons.org/publicdomain/zero/1.0/). Page: https://poly.pizza/m/P1gU3Qkr9r ("CC0 1.0");
#   file: https://static.poly.pizza/f1d12388-e39b-4157-b32a-646a1d089fc4.glb (1,962 triangles with the eyes,
#   skinned, 12 clips, flat dark grey material colours). Download record:
#   library/animals/jobs/canis_latrans/download-polypizza/job.json.
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_coyote.py -- \
#       library/animals/jobs/canis_latrans/download-polypizza/Wolf.glb client/assets/coyote.glb
#
# What it does (brief: library/animals/drafts/canis_latrans.md): bakes the rest pose and turns the wolf into a
# lean coyote: chest 0.85x narrower and neck 0.85x thinner (the forelegs follow the chest in), legs 0.8x
# thinner, muzzle (ahead of the eyes) 0.8x narrower, ears 1.25x about their base, the tail shortened to about
# 0.40 m, thinned 0.85x and hung low (down and back, below the back line); origin centred between the feet;
# scales to 0.58 m at the withers (dorsal surface over the shoulders). Recolours by region from the brief's
# palette: grizzled tan back with per-face noise, a dark dorsal stripe and shoulder cross, buff flanks,
# rufous forelegs, ear backs, muzzle sides and feet, whitish throat, belly and inner legs, a black tail tip
# and a dark gland spot near the tail root. Decimates (collapse, X symmetry; ears, eyes, face and tail tip
# protected) to lod0 ~1,900, lod1 ~800, lod2 ~220 triangles (no eyes on lod2). Writes the quadruped
# template's _PART/_PARTW/_PIVOT from the skin weights (tools/animal_glb.py). Skeleton and clips dropped.
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 1900, 2.0), ('lod1', 800, 1.0), ('lod2', 220, 0.0)]
WITHERS = 0.58          # m (brief: 53-61 cm; draw 0.58)
CHEST, NECK, LEGR, MUZZLE, EAR = 0.85, 0.85, 0.8, 0.8, 1.25
TAIL_LEN_M, TAIL_R = 0.40, 0.8
TAIL_DROOP = [62, 52, 42, 36, 32, 28, 24, 20]   # degrees per tail segment, root to tip: hangs down, tip eases back

ob, J = A.bake_skinned(SRC, 'Wolf')
me = ob.data
A.weld(me)
mats = [m.name for m in me.materials]
EARS = [f'Ear{i}.{s}' for s in 'LR' for i in range(1, 5)]
cats = A.quaternius_cats([f'Tail{i}' for i in range(1, 9)], EARS)
vweights = A.skin_reader(ob, cats)
BODYB = {'Body', 'Back', 'Torso', 'Torso2', 'Torso3'}
groups = {g.index: g.name for g in ob.vertex_groups}
def bone_w(v, names):
    return sum(g.weight for g in v.groups if groups.get(g.group) in names)

ground = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= ground
J = {k: Vector((p.x, p.y, p.z - ground)) for k, p in J.items()}
belly = min(v.co.z for v in me.vertices if vweights(v)[1] in BODYB)
eye_i = {i for p in me.polygons if mats[p.material_index] == 'Eyes_Black' for i in p.vertices}
eye_y = sum(me.vertices[i].co.y for i in eye_i) / len(eye_i)

# chest and neck: narrower in x, blended from the loins (y = Torso) forward; the neck also thinner in z
# about the neck line. Forelegs move in with the chest so the shoulder does not shear.
def zone(y):     # 1 over the chest and neck, 0 behind the middle of the back
    return A.smooth(-J['Torso'].y, -J['Torso2'].y, -y)
neck_line = [J['Torso3'], J['Neck1'], J['Neck2'], J['Neck3'], J['Head']]
legs_f = {'fl': J['FrontUpperLeg.L'].x, 'fr': J['FrontUpperLeg.R'].x}
leg_axes = {c: [J[f'{a}.{s}'] for a in (('FrontUpperLeg', 'FrontLowerLeg', 'FF') if c[0] == 'f' else ('BackUpperLeg', 'BackLowerLeg', 'FFB'))]
            for c, s in (('fl', 'L'), ('fr', 'R'), ('hl', 'L'), ('hr', 'R'))}
for v in me.vertices:
    w, b = vweights(v)
    p = v.co.copy(); z = zone(p.y)
    s = 1 - (1 - CHEST) * z
    wl = sum(w.get(c, 0) for c in ('fl', 'fr'))
    p.x = p.x * s * (1 - wl) + (p.x - (1 - s) * (legs_f['fl'] if p.x > 0 else legs_f['fr'])) * wl   # forelegs translate in
    wn = w.get('head', 0) * (1 - bone_w(v, {'Head'} | set(EARS)))
    if wn > 0 and p.y < J['Neck1'].y + 0.2:     # thinner neck (and ruff) about the neck line
        d, t, q = A.poly_nearest(p, neck_line)
        off = p - q; p = q + Vector((off.x * (1 - (1 - NECK) * wn), off.y, off.z * (1 - (1 - NECK) * wn)))
    for c, ax in leg_axes.items():   # thinner legs about the leg bones, below the belly
        wc = w.get(c, 0)
        if wc > 0 and p.z < belly:
            d, t, q = A.poly_nearest(p, ax)
            k = 1 - (1 - LEGR) * wc * A.smooth(belly, belly * 0.7, p.z)
            p = q + Vector(((p.x - q.x) * k, (p.y - q.y) * k, p.z - q.z))
    if p.y < eye_y: p.x *= MUZZLE                                         # narrower muzzle
    for side in 'LR':                                                     # ears 1.25x about the base
        we = bone_w(v, {f'Ear{i}.{side}' for i in range(1, 5)})
        if we > 0:
            base = J[f'Ear1.{side}']; p = p.lerp(base + (p - base) * EAR, min(1.0, we))
    v.co = p
# move the forelegs' joints in with the chest
for side in 'LR':
    for jn in ('FrontUpperLeg', 'FrontLowerLeg', 'FF', 'IKFrontLeg'):
        k = f'{jn}.{side}'; J[k] = Vector((J[k].x - (1 - CHEST) * zone(J[k].y) * J[f'FrontUpperLeg.{side}'].x, J[k].y, J[k].z))
for side in 'LR':
    for i in range(1, 5): k = f'Ear{i}.{side}'; J[k] = J[f'Ear1.{side}'] + (J[k] - J[f'Ear1.{side}']) * EAR

# metres per source unit (the withers do not move with the tail)
wy = J['FrontUpperLeg.L'].y
top = max(v.co.z for v in me.vertices if abs(v.co.y - wy) < 0.12 and abs(v.co.x) < 0.15)
S = WITHERS / top
# tail: shorter, thinner, hung low
tail_axis = [J[f'Tail{i}'] for i in range(1, 9)]
tipv = max(me.vertices, key=lambda v: v.co.y).co
tail_axis.append(Vector((0, tipv.y + 0.02, tipv.z)))
old_len = sum((tail_axis[i + 1] - tail_axis[i]).length for i in range(len(tail_axis) - 1))
k_len = TAIL_LEN_M / (old_len * S)
new_axis = A.bent_axis(tail_axis, TAIL_DROOP, k_len)
for v in me.vertices:
    w = vweights(v)[0].get('tail', 0)
    if w > 0: v.co = A.remap_along(tail_axis, new_axis, v.co, min(1.0, w * 1.15), TAIL_R)
for i in range(1, 9): J[f'Tail{i}'] = new_axis[i - 1]
ground = min(v.co.z for v in me.vertices)

# origin between the feet; scale to the withers
y0 = (J['FF.L'].y + J['FFB.L'].y) / 2
def sc(p): return Vector((p.x * S, (p.y - y0) * S, p.z * S))
for v in me.vertices: v.co = sc(v.co)
JS = {k: sc(p) for k, p in J.items()}
TA = [sc(p) for p in new_axis]
me.update()
eyes = [me.vertices[i].co for i in eye_i]
E = Vector((max(abs(c.x) for c in eyes), sum(c.y for c in eyes) / len(eyes), sum(c.z for c in eyes) / len(eyes)))
nose = min((v.co for v in me.vertices), key=lambda c: c.y)
BELLY = belly * S
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
print('LANDMARKS withers', round(top * S, 3), 'belly', round(BELLY, 3), 'nose-to-tail-root', round(JS['Tail1'].y - nose.y, 3), 'tail', round(tail_len, 3),
      'tail tip z', round(TA[-1].z, 3), 'chest width', round(2 * max(abs(v.co.x) for v in me.vertices if abs(v.co.y - JS['Torso3'].y) < 0.03 and v.co.z > BELLY), 3),
      'ear height', round(JS['Ear4.L'].z - JS['Ear1.L'].z, 3), 'head length', round(JS['Neck3'].y - nose.y, 3))

# ---- palette (sRGB, brief section 1) ----
BACK, STRIPE, FLANK, RUF, WHITE, TIP = 0x7e6650, 0x4b3b2e, 0xa48563, 0xb27c4e, 0xe2d9c9, 0x1f1a17
NOSE, EYE = 0x1a1614, 0x2a2012
TAILUNDER = A.mix(FLANK, WHITE, 0.35)

pg = ob.vertex_groups.new(name='protect')
for v in me.vertices:
    w, b = vweights(v)
    if (b or '').startswith('Ear') or v.index in eye_i or v.co.y < E.y + 0.01 or (w.get('tail', 0) > 0.5 and A.poly_nearest(v.co, TA)[1] > 0.75):
        pg.add([v.index], 1.0, 'REPLACE')

def face_color(m, p, vw):
    mat = mats[p.material_index]
    c = sum((m.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices); n = p.normal
    W = {}
    for i in p.vertices:
        for k, x in vw[i][0].items(): W[k] = W.get(k, 0) + x / len(p.vertices)
    bones = [vw[i][1] or '' for i in p.vertices]
    g = lambda col, a=0.12: A.grizzle(col, c, a * 1.4, 0.03)
    if mat == 'Eyes_Black': return A.srgb2lin(EYE)
    if mat == 'Nose': return A.srgb2lin(NOSE)
    if W.get('tail', 0) > 0.5:
        d, t, q = A.poly_nearest(c, TA)
        if t > 0.82 or (t > 0.74 and len(m.polygons) < 400): return A.srgb2lin(TIP)
        up = n.z * 0.7 - n.y * 0.7                     # the tail hangs: its upper side faces up and back
        if 0.1 < t < 0.24 and up > 0.3: return g(STRIPE, 0.06)      # gland spot
        if up > 0.35: return g(A.mix(BACK, STRIPE, 0.35))
        if up < -0.35: return g(TAILUNDER, 0.06)
        return g(BACK, 0.15)
    if sum(b.startswith('Ear') for b in bones) * 2 > len(bones):
        if n.y < -0.2 and abs(n.x) < 0.8: return g(WHITE, 0.05)        # inner ear
        return g(RUF, 0.08)                                            # rufous ear backs
    head = W.get('head', 0) > 0.5 and c.y < JS['Neck3'].y + 0.03
    if head:
        if n.z < -0.4 or c.z < nose.z - 0.018: return g(WHITE, 0.05)     # lips, chin, throat
        if c.y < E.y - 0.01 and abs(n.x) > 0.3: return g(RUF, 0.08)    # muzzle sides
        if mat == 'Main_Light' and c.y > E.y: return g(A.mix(WHITE, FLANK, 0.25), 0.06)   # cheeks behind the eye
        if c.y < E.y and n.z > 0.3: return g(A.mix(BACK, RUF, 0.35), 0.1)  # top of the muzzle
        if abs(n.x) > 0.4 and c.z < E.z - 0.01: return g(A.mix(RUF, WHITE, 0.4), 0.08)   # cheeks
        return g(A.mix(BACK, 0x8d8273, 0.4), 0.14)                     # crown, a little greyer
    legs = [k for k in ('fl', 'fr', 'hl', 'hr') if W.get(k, 0) > 0.5]
    if legs and c.z < BELLY + 0.03:
        lx = JS['FrontUpperLeg.L' if legs[0][1] == 'l' else 'FrontUpperLeg.R'].x
        inner = n.x * (1 if lx > 0 else -1) < -0.4
        if inner: return g(A.mix(WHITE, FLANK, 0.3), 0.05)                 # inner legs
        if legs[0][0] == 'f' or c.z < 0.08: return g(RUF, 0.08)          # forelegs and all feet rufous
        return g(A.mix(FLANK, RUF, 0.5), 0.1)                            # hind legs: buff to rufous
    if mat == 'Main_Light' or n.z < -0.55: return g(WHITE, 0.05)          # throat, belly
    # back: dark dorsal stripe and a cross over the shoulders
    wy_ = JS['FrontUpperLeg.L'].y
    if n.z > 0.75 and abs(c.x) < 0.035 and wy_ - 0.12 < c.y < JS['Tail1'].y: return g(STRIPE, 0.1)
    if n.z > 0.35 and abs(c.y - (wy_ + 0.02)) < 0.045 and c.z > JS['Neck1'].z - 0.06: return g(A.mix(STRIPE, BACK, 0.3), 0.1)
    if W.get('head', 0) > 0.3:
        return g(BACK if n.z > 0.2 else A.mix(BACK, FLANK, 0.5), 0.14)
    if n.z > 0.45: return g(BACK, 0.14)
    if c.z < BELLY + 0.06: return g(A.mix(FLANK, WHITE, 0.25), 0.08)
    return g(FLANK, 0.12)

tiers = []
for name, target, prot in TIERS:
    drop = (lambda f: mats[f.material_index] == 'Eyes_Black') if target <= 300 else None
    o, n0 = A.tier_copy(ob, target, protect='protect' if prot else None, drop_faces=drop, protect_factor=prot)
    m = o.data
    vw = {v.index: vweights(v) for v in m.vertices}
    t = A.emit(m, lambda p: face_color(m, p, vw), A.skin_rig(m, cats, JS, vweights))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
A.write_glb(OUT, tiers, 'wild-earth tools/build_coyote.py (Blender)',
            'Wolf by Quaternius (quaternius.com, Ultimate Animated Animal Pack), CC0 1.0; reshaped and recoloured as a coyote, rest pose baked, decimated',
            extras={'rig': {'kind': 'quadruped', 'head': [round(x, 4) for x in A.to3(JS['Neck1'])], 'tail': [round(x, 4) for x in A.to3(JS['Tail1'])],
                            'fore': [round(x, 4) for x in A.to3(JS['FrontUpperLeg.L'])], 'hind': [round(x, 4) for x in A.to3(JS['BackUpperLeg.L'])]},
                    'species': 'canis_latrans', 'withers_m': WITHERS, 'chest_scale': CHEST, 'neck_scale': NECK, 'leg_radius_scale': LEGR,
                    'muzzle_width_scale': MUZZLE, 'ear_scale': EAR, 'tail_length_m': TAIL_LEN_M,
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3, HEAD 6 (neck, head, ears)'})
