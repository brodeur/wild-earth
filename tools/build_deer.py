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
# What it does: bakes the rest pose; scales to 0.95 m at the withers (Neck1 joint); enlarges the ears
# 1.3x (black-tailed and mule deer ears are big); recolours with animalModels.js buildDeer's palette
# as a black-tailed deer (grey-brown coat, darker forehead and nose bridge, small dark almond eye, tail
# black on top and at the tip and white beneath, a clean white rump patch); decimates (Blender
# collapse, X symmetry) to three tiers: lod0 2096, lod1 1000, lod2 ~300 triangles (no eyes in lod2).
# The skeleton and clips are dropped. Instead each vertex carries the procedural rig's part
# (animalModels.js PART: legs A/B, tail, head), that part's skin weight and its pivot (the joint), as
# custom attributes _PART, _PARTW, _PIVOT; animalModels.js poses it in the vertex shader like the
# procedural deer. Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, indices).
# --preview <prefix>: also renders lod0 side, head and rear views (workbench) to <prefix>_*.png.
import bpy, bmesh, sys, json, struct
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
EAR = float(opt('--ear', 1.3))
PREVIEW = opt('--preview', None)
TIERS = [('lod0', None), ('lod1', 1000), ('lod2', 300)]
WITHERS = 0.95          # Neck1 joint height after scaling (m): black-tailed doe, ~0.9-1.0 m at the shoulder

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
BONE2CAT = {b: c for c, (_, _, bs) in CATS.items() for b in bs}

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# animalModels.js buildDeer's palette (sRGB), plus a face tone and the darker brow
COAT, PALE, RUMP, LEG, DARK = 0x86694b, 0xbfa98a, 0xddd2bb, 0x6f5640, 0x241a14
FACE, BROW, EYE, NOSE = 0x7e6650, 0x4f3d2e, 0x120d0b, 0x1c1714
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
    if mat == 'Hooves' and c.z > 1.0: return srgb2lin(NOSE)        # the nose pad shares the hoof material
    # the tail itself (near its joint axis; the rump skin round the root is also weighted to Tail1):
    # black along the top and at the tip, white beneath
    if tail_w > 0.55 and seg_dist(c, T1, T3 + (T3 - T1) * 0.4) < 0.065:
        tip = c.y > T3.y - 0.02
        return srgb2lin(DARK if tip or n.z > -0.1 else RUMP)
    if head and mat != 'Main_Light':
        # darker forehead and nose bridge: the upward-facing strip between the ears and down the face
        if n.z > 0.35 and abs(c.x) < EARB.x + 0.03 and c.z > EYE_Z - 0.02 and c.y < EARB.y + 0.03: return srgb2lin(BROW)
        if mat in ('Main', 'Main_Dark', 'Eye_Lighter'): return srgb2lin(FACE)
    if mat in ('Main', 'Main_Light'):
        # white rump patch: an ellipse on the back of the haunches around and below the tail root
        ex, ez = c.x / 0.115, (c.z - (T1.z - 0.1)) / 0.16
        if n.y > 0.25 and c.y > T1.y - 0.12 and ex * ex + ez * ez < 1: return srgb2lin(RUMP)
    if mat == 'Main':
        legs = [k for k in ('fl', 'fr', 'hl', 'hr') if sum(vw[i][0].get(k, 0) for i in p.vertices) / len(p.vertices) > 0.5]
        if legs and c.z < 0.42: return srgb2lin(LEG)
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
    key2i = {}; pos = []; col = []; part = []; partw = []; piv = []; idx = []
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
            idx.append(key2i[k])
    bpy.data.objects.remove(ob)
    print('TIER', target, 'tris', len(idx) // 3, 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, part=part, partw=partw, piv=piv, idx=idx)

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
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_deer.py (Blender)',
                  'copyright': 'Deer by Quaternius (quaternius.com, Ultimate Animated Animal Pack), CC0 1.0; recoloured, rest pose baked, decimated'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'ear_scale': EAR, 'withers_m': WITHERS}}
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
        cv = Vector(ctr); cam.data.ortho_scale = scale
        cam.location = cv + Vector(d).normalized() * 5
        cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{PREVIEW}_{name}.png'
        bpy.ops.render.render(write_still=True)
