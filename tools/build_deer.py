# Build client/assets/deer.glb, the ambient black-tailed deer, from a downloaded CC0 model.
#
# Source: "Deer" by Quaternius (quaternius.com), Ultimate Animated Animal Pack, CC0 1.0
#   (https://creativecommons.org/publicdomain/zero/1.0/). Page: https://poly.pizza/m/T6Cs7tmMHJ
#   ("Public Domain (CC0)"); file: https://static.poly.pizza/4b6c2a41-43c7-404c-ae37-e8c4645ff93b.glb
#   (FBX2glTF export, 2096 triangles, 46-joint skin, 13 clips, flat material colours, no textures).
#
# Rebuild (Blender 4.1; run from the repo root, with the source GLB downloaded to /path/to/Deer.glb):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_deer.py -- \
#       /path/to/Deer.glb client/assets/deer.glb [--ear 1.3] [--preview /tmp/deer_preview]
#
# What it does: bakes the rest pose; scales to 0.95 m at the withers (the top of the back over the fore legs, measured as
# client/src/lineupAnimals.js measureGeo does; the Neck1 joint sits ~0.2 m lower, at ~0.77 m); enlarges the ears
# 1.3x (black-tailed and mule deer ears are big); recolours with animalModels.js buildDeer's palette
# as a black-tailed deer (grey-brown coat, darker forehead and nose bridge, small dark almond eye, tail
# black on top and at the tip and white beneath, a clean white rump patch); decimates (Blender
# collapse, X symmetry) to three tiers: lod0 2096, lod1 1000, lod2 ~300 triangles (no eyes in lod2).
# The skeleton and clips are dropped. Instead each vertex carries the procedural rig's part
# (animalModels.js PART: legs A/B, tail, head), that part's skin weight and its pivot (the joint), as
# custom attributes _PART, _PARTW, _PIVOT; animalModels.js poses it in the vertex shader like the
# procedural deer. Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, indices).
# --preview <prefix>: also renders lod0 side, head and rear views (workbench) to <prefix>_*.png.
# Skinning (2026-10-27): every tier also keeps the source's skin as JOINTS_0 / WEIGHTS_0 (the four heaviest vertex
# groups, normalised; the groups survive the decimation), indexed in the source skin's joint order (read from the
# GLB's JSON), and the file's extras.skin records that order and the frame the rest pose was baked in (scale = S x U,
# offset = the ground shift), so tools/bake_clips.py can bake the source's clips into a bone texture the client skins
# these vertices with (animalModels.js, the skin path). Antler vertices are skinned to the Head joint.
#
# --buck: the antlered buck instead (brief: library/animals/drafts/odocoileus_hemionus_buck.md), written to OUT
# (client/assets/deer_buck.glb): 5% larger (0.9975 m at the withers), neck 1.15x thicker about the neck line, darker
# forehead (#3b2c22), the hooves and pasterns kept with their leg (the doe leaves them on the body part, a
# known doe fault left alone so the doe's output does not change), and procedural mule-deer antlers built per
# tier and never decimated with the body: burr on the frontal bone in front of and inside the ear base, the beam
# up, out and back, an even fork at ~45% of its length, the rear branch forking again (mature 3x3), a small
# brow tine; tubes tapering 2.5 to 0.5 cm, 6-sided on lod0, 3-sided (1 cm minimum) on lod1, one flat V per side
# on lod2. Body tiers 2,096 / 1,000 / ~300 plus antlers make ~2,350 / ~1,100 / ~320. Antler vertices are HEAD
# (6), weight 1, and carry _ANTLER (0 off the antler; else 0.05 + 0.95 x the fraction of the way from burr to
# tip, for growth and the colour gradient) and _TINE (0 beam and main fork, 1 the rear branch's second fork,
# which a forked-horn 2x2 hides, 2 the brow tine, 3 the burr ring). The burr centre is in extras.antler_burr
# (glTF axes, the left burr; the right mirrors in x) so the shader can grow, shed and thicken (velvet) them.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
EAR = float(opt('--ear', 1.3))
PREVIEW = opt('--preview', None)
TIERS = [('lod0', None), ('lod1', 1000), ('lod2', 300)]
WITHERS = 0.95          # withers height after scaling (m), top of the back over the fore legs: black-tailed doe, ~0.9-1.0 m
BUCK = '--buck' in argv
if BUCK:
    WITHERS = round(0.95 * 1.05, 4)   # the buck ~5% larger: 1.0 m at the shoulder
    NECK = 1.15             # neck thickness about the neck line (the rut swell would be ~1.3)

def glb_json(path):
    b = open(path, 'rb').read(); ln = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + ln])
_src = glb_json(SRC)
SKIN_JOINTS = [_src['nodes'][j].get('name', f'joint{j}') for j in _src['skins'][0]['joints']]   # the skin's joint order
JOINT_INDEX = {n: i for i, n in enumerate(SKIN_JOINTS)}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == 'MESH' and o.name != 'Deer': bpy.data.objects.remove(o)   # an IK helper sphere
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
deer = sc.objects['Deer']
arm.data.pose_position = 'REST'
if arm.animation_data: arm.animation_data.action = None
bpy.context.view_layer.update()
J = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
# bake the rest pose and the object transform into the vertices
bpy.ops.object.select_all(action='DESELECT'); deer.select_set(True); bpy.context.view_layer.objects.active = deer
for m in list(deer.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(arm)
me = deer.data
ground = min(v.co.z for v in me.vertices)
S = WITHERS / (J['Neck1'].z - ground)
# Work in scaled Blender axes (metres, feet at z = 0, the deer faces -y, +x is its left);
# to3 maps to three.js / glTF axes (x, z, -y): +y up, +z forward.
def to3(p): return Vector((p.x, p.z, -p.y))
for v in me.vertices: v.co = Vector((v.co.x * S, v.co.y * S, (v.co.z - ground) * S))
JS = {k: Vector((p.x * S, p.y * S, (p.z - ground) * S)) for k, p in J.items()}
# weld the per-material splits so the decimator does not open cracks along colour borders
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(me); bm.free()
groups = {g.index: g.name for g in deer.vertex_groups}
mats = [m.name for m in me.materials]

# ears: scale each ear about its base by EAR, by ear weight
for v in me.vertices:
    for side in ('L', 'R'):
        w = sum(g.weight for g in v.groups if groups[g.group].startswith('Ear') and groups[g.group].endswith(side))
        if w > 0:
            base = JS[f'Ear1.{side}']
            v.co = v.co.lerp(base + (v.co - base) * EAR, min(1.0, w))
# buck: thicker neck, radially about the neck line, by the neck bones' weight (not the head's)
if BUCK:
    nl = [JS['Torso3'], JS['Neck1'], JS['Neck2'], JS['Neck3'], JS['Head']]
    def _near(p):
        best = (1e9, None)
        for i in range(len(nl) - 1):
            a, b = nl[i], nl[i + 1]; ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)); q = a + ab * t
            if (p - q).length < best[0]: best = ((p - q).length, q)
        return best[1]
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if groups[g.group] in ('Neck1', 'Neck2', 'Neck3'))
        tot = sum(g.weight for g in v.groups) or 1
        w = min(1.0, w / tot)
        if w > 0:
            q = _near(v.co); v.co = q + (v.co - q) * (1 + (NECK - 1) * w)
# eyes: the source eye (Eye_Black, Eye_White) is a round disc; squash it into a small almond about
# its centre on each side: 0.5x in height, 0.8x in length
eye_v = {i for p in me.polygons if mats[p.material_index] in ('Eye_Black', 'Eye_White') for i in p.vertices}
for side in (1, -1):
    vs = [me.vertices[i] for i in eye_v if me.vertices[i].co.x * side > 0]
    c = sum((v.co for v in vs), Vector()) / len(vs)
    for v in vs: v.co = Vector((v.co.x, c.y + (v.co.y - c.y) * 0.8, c.z + (v.co.z - c.z) * 0.5))
EYE_Z = max(me.vertices[i].co.z for i in eye_v)

# part categories: (PART id, pivot joint, bones); PART: BODY 0, LEG_A 1, LEG_B 2, TAIL 3, HEAD 6.
# Diagonal walk as in buildDeer: left fore and right hind are A. The thigh (BackLeg) stays with the
# body, so hind legs pivot at the stifle and a bedded deer keeps its haunch.
CATS = {
    'fl': (1, 'FrontUpperLeg.L', ('FrontUpperLeg.L', 'FrontLowerLeg.L')),
    'hr': (1, 'BackUpperLeg.R', ('BackUpperLeg.R', 'BackLowerLeg.R')),
    'fr': (2, 'FrontUpperLeg.R', ('FrontUpperLeg.R', 'FrontLowerLeg.R')),
    'hl': (2, 'BackUpperLeg.L', ('BackUpperLeg.L', 'BackLowerLeg.L')),
    'tail': (3, 'Tail1', ('Tail1', 'Tail2', 'Tail3')),
    'head': (6, 'Neck1', ('Neck1', 'Neck2', 'Neck3', 'Head', 'Ear1.L', 'Ear2.L', 'Ear3.L', 'Ear4.L', 'Ear1.R', 'Ear2.R', 'Ear3.R', 'Ear4.R')),
}
if BUCK:   # hooves and pasterns are skinned to the IK foot bones: keep them with their leg
    for c, extra in (('fl', ('IKFrontLeg.L', 'FF.L')), ('fr', ('IKFrontLeg.R', 'FF.R')), ('hl', ('IKBackLeg.L', 'FFB.L')), ('hr', ('IKBackLeg.R', 'FFB.R'))):
        CATS[c] = (CATS[c][0], CATS[c][1], CATS[c][2] + extra)
BONE2CAT = {b: c for c, (_, _, bs) in CATS.items() for b in bs}

# withers: the mesh was scaled above with Neck1 at WITHERS, and the ears, neck and eyes edited about scaled joints
# (all scale-equivariant). Measure the withers as client/src/lineupAnimals.js measureGeo does, the top of the body
# (not strongly head or tail) from 20% of the head-body length behind the fore legs' pivot to 5% ahead of it, then
# rescale everything about the feet by U so the withers sit at WITHERS. U also scales every absolute length below
# (colour regions, antler offsets), so the output is the Neck1-referenced build times U.
def measure_withers():
    info = []
    for v in me.vertices:
        w = {}; tot = 0
        for g in v.groups:
            tot += g.weight; c = BONE2CAT.get(groups[g.group])
            if c: w[c] = w.get(c, 0) + g.weight
        if w and tot > 0:
            c = max(w, key=w.get); info.append((v.co, CATS[c][0], min(1.0, w[c] / tot)))
        else: info.append((v.co, 0, 0.0))
    strong = lambda pid, pw, k: pid in k and pw > 0.5
    fore = max(-JS[j].y for c, (pid, j, _) in CATS.items() if pid in (1, 2))
    zs = [-co.y for co, pid, pw in info if not strong(pid, pw, (3,))]
    z0, z1 = min(zs), max(zs)
    Lhb = z1 - (max(z0, -JS['Tail1'].y) if any(pid == 3 for _, pid, _ in info) else z0)
    top = max(co.z for co, pid, pw in info if not strong(pid, pw, (3, 6)) and -0.2 * Lhb < -co.y - fore < 0.05 * Lhb)
    return top - min(v.co.z for v in me.vertices)
W0 = measure_withers()
U = WITHERS / W0
for v in me.vertices: v.co = v.co * U
JS = {k: p * U for k, p in JS.items()}
EYE_Z *= U
print('INFO withers before %.4f m (Neck1 %.4f m), rescale U %.4f -> withers %.4f m, Neck1 %.4f m' % (W0, WITHERS, U, measure_withers(), JS['Neck1'].z))

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# animalModels.js buildDeer's palette (sRGB), plus a face tone and the darker brow
COAT, PALE, RUMP, LEG, DARK = 0x86694b, 0xbfa98a, 0xddd2bb, 0x6f5640, 0x241a14
FACE, BROW, EYE, NOSE = 0x7e6650, 0x4f3d2e, 0x120d0b, 0x1c1714
if BUCK: BROW = 0x3b2c22    # the buck's darker forehead (brief palette)
MATCOL = {'Main': COAT, 'Main_Light': PALE, 'Main_Dark': FACE, 'Hooves': 0x2a2420, 'Eye_Lighter': FACE, 'Eye_Black': EYE, 'Eye_White': EYE}
T1, T3 = JS['Tail1'], JS['Tail3']
EARB = JS['Ear1.L']

def vweights(v):
    """Per category skin weight (normalised) and the dominant bone."""
    w = {}; tot = 0; best = (0, None)
    for g in v.groups:
        tot += g.weight; n = groups[g.group]
        if g.weight > best[0]: best = (g.weight, n)
        c = BONE2CAT.get(n)
        if c: w[c] = w.get(c, 0) + g.weight
    if tot > 0: w = {k: x / tot for k, x in w.items()}
    return w, best[1]

def seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length

def face_color(m, p, vw):
    mat = mats[p.material_index]
    col = MATCOL.get(mat, COAT)
    c = sum((m.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices)
    n = p.normal
    tail_w = sum(vw[i][0].get('tail', 0) for i in p.vertices) / len(p.vertices)
    head = sum(1 for i in p.vertices if vw[i][1] in ('Head',)) * 2 > len(p.vertices)
    if mat in ('Eye_Black', 'Eye_White'): return srgb2lin(EYE)
    if mat == 'Hooves' and c.z > 1.0 * U: return srgb2lin(NOSE)        # the nose pad shares the hoof material
    # the tail itself (near its joint axis; the rump skin round the root is also weighted to Tail1):
    # black along the top and at the tip, white beneath
    if tail_w > 0.55 and seg_dist(c, T1, T3 + (T3 - T1) * 0.4) < 0.065 * U:
        tip = c.y > T3.y - 0.02 * U
        return srgb2lin(DARK if tip or n.z > -0.1 else RUMP)
    if head and mat != 'Main_Light':
        # darker forehead and nose bridge: the upward-facing strip between the ears and down the face
        if n.z > 0.35 and abs(c.x) < EARB.x + 0.03 * U and c.z > EYE_Z - 0.02 * U and c.y < EARB.y + 0.03 * U: return srgb2lin(BROW)
        if mat in ('Main', 'Main_Dark', 'Eye_Lighter'): return srgb2lin(FACE)
    if mat in ('Main', 'Main_Light'):
        # white rump patch: an ellipse on the back of the haunches around and below the tail root
        ex, ez = c.x / (0.115 * U), (c.z - (T1.z - 0.1 * U)) / (0.16 * U)
        if n.y > 0.25 and c.y > T1.y - 0.12 * U and ex * ex + ez * ez < 1: return srgb2lin(RUMP)
    if mat == 'Main':
        legs = [k for k in ('fl', 'fr', 'hl', 'hr') if sum(vw[i][0].get(k, 0) for i in p.vertices) / len(p.vertices) > 0.5]
        if legs and c.z < 0.42 * U: return srgb2lin(LEG)
    return srgb2lin(col)

def build(target):
    ob = deer.copy(); ob.data = deer.data.copy(); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    m = ob.data
    if target is not None and target <= 400:   # far tier: drop the eyes
        bm = bmesh.new(); bm.from_mesh(m)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if mats[f.material_index].startswith('Eye_') and mats[f.material_index] != 'Eye_Lighter'], context='FACES')
        bm.to_mesh(m); bm.free()
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m); bm.free()
    n0 = len(m.polygons)
    if target is not None:
        d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = target / n0
        d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m); bm.free()
    m.update()
    vw = {v.index: vweights(v) for v in m.vertices}
    def part_of(i):
        w = vw[i][0]
        if not w: return None, 0.0
        c = max(w, key=w.get); return c, min(1.0, w[c])
    def skin_of(v):   # the four heaviest skin joints and their weights, normalised (JOINTS_0 / WEIGHTS_0)
        gs = sorted(((g.weight, JOINT_INDEX[groups[g.group]]) for g in v.groups if g.weight > 0 and groups[g.group] in JOINT_INDEX), reverse=True)[:4]
        tot = sum(w for w, _ in gs) or 1.0
        js_ = [j for _, j in gs] + [0] * (4 - len(gs)); ws = [w / tot for w, _ in gs] + [0.0] * (4 - len(gs))
        return tuple(js_), tuple(ws)
    key2i = {}; pos = []; col = []; part = []; partw = []; piv = []; idx = []; joints = []; weights = []
    for p in m.polygons:
        fc = face_color(m, p, vw)
        for vi in p.vertices:
            k = (vi, fc)
            if k not in key2i:
                key2i[k] = len(pos)
                pos.append(to3(m.vertices[vi].co)); col.append(fc)
                c, w = part_of(vi)
                if c is None: part.append(0.0); partw.append(0.0); piv.append(Vector((0, 0, 0)))
                else:
                    pid, joint, _ = CATS[c]
                    part.append(float(pid)); partw.append(w); piv.append(to3(JS[joint]))
                sj, sw = skin_of(m.vertices[vi]); joints.append(sj); weights.append(sw)
            idx.append(key2i[k])
    bpy.data.objects.remove(ob)
    print('TIER', target, 'tris', len(idx) // 3, 'verts', len(pos), 'from', n0, 'unskinned verts', sum(1 for w in weights if w[0] == 0.0))
    return dict(pos=pos, col=col, part=part, partw=partw, piv=piv, idx=idx, joints=joints, weights=weights)

# ---- buck: procedural mule-deer antlers, one set per tier (never decimated with the body) ----
def antler_geometry(level):
    """Triangles for both antlers: a list of ((p0, p1, p2) Blender coords, (t0, t1, t2), tine class).
    level 0: 6-sided tubes with burr ring, brow tine, curved beam; 1: 3-sided, 1 cm minimum radius, no brow;
    2: one flat V per side."""
    head_v = [v.co for v in me.vertices if sum(g.weight for g in v.groups if groups[g.group] in ('Head', 'Neck3')) > 0.5]
    bx, by = EARB.x * 0.55, EARB.y - 0.035 * U
    near = sorted(head_v, key=lambda c: (c.x - bx) ** 2 + (c.y - by) ** 2)[:6]
    B = Vector((bx, by, max(c.z for c in near) - 0.008 * U))
    # points relative to the left burr (x out, +y back, z up) and radii (m), for a mature 3x3 black-tailed buck
    P = {'Bb': ((0, 0, -0.012), 0.031), 'B': ((0, 0, 0), 0.025), 'P1': ((0.06, 0.04, 0.06), 0.021),
         'P2': ((0.12, 0.06, 0.12), 0.018), 'F1': ((0.15, 0.03, 0.19), 0.012), 'Ft': ((0.155, -0.02, 0.26), 0.005),
         'R1': ((0.16, 0.1, 0.17), 0.015), 'R2': ((0.172, 0.112, 0.19), 0.013), 'Ra': ((0.168, 0.08, 0.27), 0.005),
         'Rb': ((0.195, 0.172, 0.24), 0.005), 'W0': ((0.012, -0.008, 0.026), 0.008), 'Wt': ((0.026, -0.045, 0.056), 0.004)}
    P = {k: (tuple(x * U for x in o), r * U) for k, (o, r) in P.items()}   # sized with the body (inside the ear spread)
    if level == 0:
        paths = [(['Bb', 'B'], 3, False), (['B', 'P1', 'P2', 'F1', 'Ft'], 0, True), (['P2', 'R1', 'R2', 'Ra'], 0, True),
                 (['R2', 'Rb'], 1, True), (['W0', 'Wt'], 2, True)]
        sides, rmin = 6, 0.0
    else:
        paths = [(['B', 'P2', 'Ft'], 0, True), (['P2', 'R2', 'Ra'], 0, True), (['R2', 'Rb'], 1, True)]
        sides, rmin = 3, 0.01
    # arc length from the burr along the tree, for t (0 burr, 1 tip)
    parent = {'B': None, 'Bb': None, 'P1': 'B', 'P2': 'P1', 'F1': 'P2', 'Ft': 'F1', 'R1': 'P2', 'R2': 'R1', 'Ra': 'R2', 'Rb': 'R2', 'W0': None, 'Wt': 'W0'}
    def dist(k):
        d = 0.0
        while parent[k]: d += (Vector(P[k][0]) - Vector(P[parent[k]][0])).length; k = parent[k]
        return d
    tip_of = {'Bb': 'Ft', 'B': 'Ft', 'P1': 'Ft', 'P2': 'Ft', 'F1': 'Ft', 'Ft': 'Ft', 'R1': 'Ra', 'R2': 'Ra', 'Ra': 'Ra', 'Rb': 'Rb', 'W0': 'Wt', 'Wt': 'Wt'}
    def tval(k):
        if k == 'Bb': return 0.0
        if k.startswith('W'): return 0.15 + 0.35 * dist(k) / dist('Wt')
        return dist(k) / dist(tip_of[k])
    tris = []
    for side in (1, -1):
        def at(k): o = Vector(P[k][0]); return Vector((side * (B.x + o.x), B.y + o.y, B.z + o.z))
        if level == 2:   # flat V: stem to the front tip and to the rear tip, a notch between, both faces
            b, ft, ra, nt = at('B'), at('Ft'), at('Ra'), at('P2') + Vector((0, 0, 0.05 * U))
            nrm = (ft - b).cross(ra - b).normalized() * 0.004
            for off, flip in ((nrm, False), (-nrm, True)):
                for tri, tt in (((b, ft, nt), (0, 1, 0.6)), ((b, nt, ra), (0, 0.6, 1))):
                    q = tuple(x + off for x in tri)
                    if flip: q = (q[0], q[2], q[1]); tt = (tt[0], tt[2], tt[1])
                    tris.append((q, tt, 0))
            continue
        for keys, tine, cap in paths:
            pts = [at(k) for k in keys]; rad = [max(rmin, P[k][1]) for k in keys]; ts = [tval(k) for k in keys]
            # ring frames by parallel transport
            tang = []
            for i in range(len(pts)):
                a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]; tang.append((b - a).normalized())
            ref = Vector((0, 1, 0)) if abs(tang[0].y) < 0.9 else Vector((1, 0, 0))
            u = (ref - tang[0] * ref.dot(tang[0])).normalized()
            rings = []
            for i, (c, r, tn) in enumerate(zip(pts, rad, tang)):
                if i: u = (u - tn * u.dot(tn)).normalized()
                w = tn.cross(u)
                rings.append([c + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
            def tri(a, b, c, ta, tb, tc, axis):
                n = (b - a).cross(c - a); cen = (a + b + c) / 3
                if n.dot(cen - axis) < 0: a, b, c, ta, tb, tc = a, c, b, ta, tc, tb   # outward winding
                tris.append(((a, b, c), (ta, tb, tc), tine))
            for i in range(len(pts) - 1):
                ax = (pts[i] + pts[i + 1]) / 2
                for k in range(sides):
                    k2 = (k + 1) % sides
                    tri(rings[i][k], rings[i][k2], rings[i + 1][k2], ts[i], ts[i], ts[i + 1], ax)
                    tri(rings[i][k], rings[i + 1][k2], rings[i + 1][k], ts[i], ts[i + 1], ts[i + 1], ax)
            if cap:   # cone to the tip
                apex = pts[-1] + tang[-1] * rad[-1] * 2.5
                for k in range(sides):
                    tri(rings[-1][k], rings[-1][(k + 1) % sides], apex, ts[-1], ts[-1], 1.0, pts[-1])
    return tris, B

ANTLER_BASE, ANTLER_TIP = 0x6b5843, 0xd9ceb5   # hard antler, burr to tip (brief palette)
def antler_color(t):
    t = max(0.0, min(1.0, t)) ** 1.6
    a, b = srgb2lin(ANTLER_BASE), srgb2lin(ANTLER_TIP)
    return tuple(x + (y - x) * t for x, y in zip(a, b))

def add_antlers(t, level):
    tris, B = antler_geometry(level)
    n = len(t['pos'])
    t['antler'] = [0.0] * n; t['tine'] = [0.0] * n
    for (ps, ts, tine) in tris:
        fc = antler_color(sum(ts) / 3)
        for p_, tv in zip(ps, ts):
            t['idx'].append(len(t['pos'])); t['pos'].append(to3(p_)); t['col'].append(fc)
            t['part'].append(6.0); t['partw'].append(1.0); t['piv'].append(to3(JS['Neck1']))
            t['antler'].append(0.05 + 0.95 * tv); t['tine'].append(float(tine))
            t['joints'].append((JOINT_INDEX['Head'], 0, 0, 0)); t['weights'].append((1.0, 0.0, 0.0, 0.0))
    return len(tris), B

if BUCK:
    BUCK_TIERS = [('lod0', 2350, 0), ('lod1', 1100, 1), ('lod2', 320, 2)]   # total triangles, antler level
    tiers = []
    for name, total, level in BUCK_TIERS:
        na = len(antler_geometry(level)[0])
        t = build(total - na)
        nat, BURR = add_antlers(t, level)
        print('TIER', name, 'antler tris', nat, 'total', len(t['idx']) // 3)
        tiers.append((name, t))
    # graze clearance: rotate the antler tips about Neck1 as the shader's flick does (glTF: +y up, +z forward)
    piv = to3(JS['Neck1']); lo = {}
    for a in (0.5, 1.0, 1.5):
        c, s_ = math.cos(a), math.sin(a)
        ys = [piv.y + s_ * (p.z - piv.z) * -1 + c * (p.y - piv.y) for p, an in zip(tiers[0][1]['pos'], tiers[0][1]['antler']) if an > 0]
        lo[a] = round(min(ys), 3)
    print('INFO antler lowest point (m) at head flick 0.5 / 1.0 / 1.5 rad:', lo)
else:
    tiers = [(name, build(t)) for name, t in TIERS]

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
    a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[n]}
    if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
    accs.append(a); return len(accs) - 1
def acc_u8v4(vals):   # JOINTS_0: unsigned byte VEC4
    flat = [x for v in vals for x in v]
    accs.append({'bufferView': add(struct.pack(f'<{len(flat)}B', *flat), 34962), 'componentType': 5121, 'count': len(vals), 'type': 'VEC4'})
    return len(accs) - 1
def acc_i(vals):
    big = max(vals) > 65535
    accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
    return len(accs) - 1
meshes = []; nodes = []
for name, t in tiers:
    attrs = {'POSITION': acc_f([tuple(p) for p in t['pos']], 3), 'COLOR_0': acc_f(t['col'], 3),
             '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f([tuple(p) for p in t['piv']], 3)}
    if 'antler' in t: attrs['_ANTLER'] = acc_f(t['antler'], 1); attrs['_TINE'] = acc_f(t['tine'], 1)
    attrs['JOINTS_0'] = acc_u8v4(t['joints']); attrs['WEIGHTS_0'] = acc_f(t['weights'], 4)
    meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
while len(buf) % 4: buf.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_deer.py (Blender)',
                  'copyright': 'Deer by Quaternius (quaternius.com, Ultimate Animated Animal Pack), CC0 1.0; recoloured, rest pose baked, decimated'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'ear_scale': EAR, 'withers_m': WITHERS, 'neck1_m': round(JS['Neck1'].z, 4),
                   # the skin: JOINTS_0 index this joint order; the rest pose was baked at scale S x U with the feet lifted to y = 0
                   'skin': {'joints': SKIN_JOINTS, 'scale': round(S * U, 6), 'offset': [0.0, round(-ground * S * U, 5), 0.0], 'clips': 'deer_clips'}}}
if BUCK:
    gltf['asset']['copyright'] = 'Deer by Quaternius (quaternius.com, Ultimate Animated Animal Pack), CC0 1.0; recoloured, rest pose baked, decimated; buck: larger, thicker neck, procedural antlers (wild-earth)'
    gltf['extras'].update({'rig': {'kind': 'quadruped', **{k: [round(x, 4) for x in to3(JS[j])] for k, j in (('head', 'Neck1'), ('tail', 'Tail1'), ('fore', 'FrontUpperLeg.L'), ('hind', 'BackUpperLeg.L'))}},
                           'variant': 'buck', 'neck_scale': NECK, 'antler_burr': [round(x, 4) for x in to3(BURR)],
                           'antler': '_ANTLER 0 off the antler, else 0.05 + 0.95 x fraction burr to tip; _TINE 0 beam and main fork, 1 rear second fork (mature only), 2 brow tine, 3 burr ring; right antler mirrors the left in x',
                           'antler_tris': {n: sum(1 for k in range(0, len(t['idx']), 3) if t['antler'][t['idx'][k]] > 0) for n, t in tiers}})
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb))

# ---- optional preview: lod0 with its vertex colours, workbench ----
if PREVIEW:
    t = tiers[0][1]
    pm = bpy.data.meshes.new('preview')
    pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
    ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(t['col']): ca.data[i].color = (*c, 1.0)
    pm.color_attributes.active_color = ca
    po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
    deer.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 800; sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for name, ctr, d, scale in [('side', (0, -0.2, 0.85), (1, 0, 0.05), 2.0), ('head', (0, -0.75, 1.45), (0.8, -0.6, 0.15), 0.6),
                                ('rear', (0, 0.4, 0.9), (0.2, 1, 0.25), 1.2), ('front', (0, -0.8, 1.45), (0.0, -1, 0.1), 0.6)]:
        cv = Vector(ctr) * U; cam.data.ortho_scale = scale * U   # framed for the Neck1-referenced size
        cam.location = cv + Vector(d).normalized() * 5
        cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{PREVIEW}_{name}.png'
        bpy.ops.render.render(write_still=True)
