# Build client/assets/fruit/<id>.glb, the fruit models fruit.js and acorns.js instance, from Meshy text-to-3D jobs.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview (ai_model "latest", triangle remesh to 6,000 faces) and
# a 2K texture refine, run by agent (Claude) for Aaron Brodeur on 2026-11-04 UTC. Records (prompts, cost, checksums):
# library/fruit/jobs/<id>/<task>/job.json. Paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2)
# and released with the project's assets under CC BY-SA 4.0; credit "generated with Meshy".
#
# Rebuild all (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_fruit.py
#
# Not adopted: the wild grape bunch (task 01a1a9da-b45d-76a3, refined): at a few hundred triangles its 25 berries
# collapse to a lump (voxel-remeshed, 480) or stall at 1,082 (non-manifold where they touch), and the procedural bunch
# in fruit.js, 20 triangles a berry, reads better; the walnut (furrowed like a shelled nut, not the smooth husk) and
# the bay nut (a plain egg) previews, not refined.
#
# What it does, per model (FRUIT below): imports the refined GLB (mesh and its base-colour texture), turns it to stand
# or hang (a hanging spray is flipped so its twig is on top), scales it to life size (the record's size, metres, along
# its long axis), puts the origin where fruit.js attaches it (the top of the stem for a hanging spray, the centre for
# the acorn, as acorns.js's own model), decimates (collapse) to a few hundred triangles because the client instances
# hundreds of them, and bakes the texture into colours: each triangle corner takes the texture's colour at the nearest
# point of the full-detail surface to a point a quarter of the way from the corner to the triangle's centre (vertices
# split where corners clearly disagree, so the cap's edge stays sharp), sRGB to linear. Smooth normals from the decimated
# mesh. No texture in the output: the client's draw takes no sampler (POSITION, NORMAL, COLOR_0, indices).
import bpy, bmesh, json, struct, math, os, sys, glob
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

SPLIT = 0.12   # corners of one vertex whose linear colours differ by less than this (summed over r g b) share it
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# id: (how it is used, its size along the long axis in metres, triangles[, saturation and gain of the baked colour])
FRUIT = {
    'quercus_lobata': ('center', 0.032, 160, 0.55, 1.05),   # the acorn, cap and stem (acorns.js); 160: it draws every acorn within
    # 300 m (2,400 by a valley oak). The texture's nut is a saturated red-brown (sRGB 127 54 25): graded toward chestnut.
    'rosa_californica': ('hang', 0.045, 360),   # three hips on a twig, flipped to hang
}


def refine_job(fid):
    for j in sorted(glob.glob(os.path.join(ROOT, 'library', 'fruit', 'jobs', fid, '*', 'job.json'))):
        r = json.load(open(j))
        if r.get('mode') == 'refine' and r.get('status') == 'SUCCEEDED': return os.path.dirname(j), r
    raise SystemExit(f'no refined job for {fid}')


def load(src):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o is not ob: bpy.data.objects.remove(o)
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()
    return ob


def texture(ob):
    for m in ob.data.materials:
        if not m or not m.use_nodes: continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                im = n.image; w, h = im.size
                px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px)
                return px.reshape(h, w, 4)[:, :, :3], w, h
    raise SystemExit('no base colour texture')


def build(fid, use, size, tris, sat=1.0, gain=1.0):
    d, rec = refine_job(fid)
    ob = load(os.path.join(d, 'model.glb'))
    me = ob.data
    # stand or hang: Blender z up. The spray's twig is its lowest part as generated: flip it to hang from the top.
    if use == 'hang' and fid == 'rosa_californica':
        me.transform(Matrix.Rotation(math.pi, 4, 'X'))
    co = np.array([v.co[:] for v in me.vertices])
    ext = co.max(0) - co.min(0); k = size / ext[2]
    me.transform(Matrix.Scale(k, 4))
    co = np.array([v.co[:] for v in me.vertices]); lo, hi = co.min(0), co.max(0)
    if use == 'hang':   # the origin at the top of the stem: the highest vertex's x y, the top z
        top = co[co[:, 2].argmax()]; off = Vector((-top[0], -top[1], -hi[2]))
    else:   # the acorn: centred across, its bottom ACORN_R * 1.1 (1.3 cm) below the origin, where acorns.js seats a nut
        c = (lo + hi) / 2; off = Vector((-c[0], -c[1], -lo[2] - 0.0132))
    me.transform(Matrix.Translation(off)); me.update()
    # the full-detail surface and its UVs, for the colours
    img, W, H = texture(ob)
    uv = me.uv_layers.active.data
    tri_uv = [[uv[li].uv.copy() for li in p.loop_indices] for p in me.polygons]
    tri_co = [[me.vertices[vi].co.copy() for vi in p.vertices] for p in me.polygons]
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    def colour(p):
        loc, nrm, fi, dist = bvh.find_nearest(p)
        a, b, c = tri_co[fi]; ua, ub, uc = tri_uv[fi]
        q = barycentric_transform(loc, a, b, c, ua.to_3d(), ub.to_3d(), uc.to_3d())
        x = min(W - 1, max(0, int((q.x % 1.0) * W))); y = min(H - 1, max(0, int((q.y % 1.0) * H)))
        s = img[y, x]
        if sat != 1.0 or gain != 1.0: l = float(s @ np.array([0.2126, 0.7152, 0.0722])); s = np.clip((l + (s - l) * sat) * gain, 0, 1)
        return tuple(float(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in s)
    # decimate a welded copy
    o2 = ob.copy(); o2.data = me.copy(); bpy.context.scene.collection.objects.link(o2)
    bm = bmesh.new(); bm.from_mesh(o2.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 2e-4); bm.to_mesh(o2.data); bm.free()   # the UV seams closed (the source is split at every seam; open, the collapse keeps them)
    n0 = len(o2.data.polygons)
    bpy.ops.object.select_all(action='DESELECT'); o2.select_set(True); bpy.context.view_layer.objects.active = o2
    for _ in range(6):   # one collapse can stop short: again until near the target
        n = len(o2.data.polygons)
        if n <= tris * 1.08: break
        dm = o2.modifiers.new('dec', 'DECIMATE'); dm.decimate_type = 'COLLAPSE'; dm.ratio = tris / n; dm.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
        bm = bmesh.new(); bm.from_mesh(o2.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(o2.data); bm.free()
    m2 = o2.data
    bm = bmesh.new(); bm.from_mesh(m2); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m2); bm.free(); m2.update()
    for p in m2.polygons: p.use_smooth = True
    m2.update()
    # per-corner colours, vertices split where they differ
    key2i = {}; pos = []; nor = []; col = []; idx = []; per = {}   # per: vertex -> [(colour, index)]
    for p in m2.polygons:
        cen = sum((m2.vertices[vi].co for vi in p.vertices), Vector()) / 3
        for vi in p.vertices:
            v = m2.vertices[vi]
            c = colour(v.co * 0.75 + cen * 0.25)
            near = next((i for cc, i in per.get(vi, []) if sum(abs(a - b) for a, b in zip(cc, c)) < SPLIT), None)
            if near is None:   # a colour this vertex has not taken yet: a new split vertex
                near = len(pos); per.setdefault(vi, []).append((c, near))
                pos.append((v.co.x, v.co.z, -v.co.y)); n = v.normal; nor.append((n.x, n.z, -n.y)); col.append(c)
            idx.append(near)
    out = os.path.join(ROOT, 'client', 'assets', 'fruit', f'{fid}.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    write(out, pos, nor, col, idx, {'source': f'Meshy text-to-3D, task {rec["task_id"]} (refine of {rec.get("preview_job") or "its preview"})',
                                     'size_m': size, 'use': use, 'faces_in': n0})
    print(f'WROTE {out}: {len(idx) // 3} tris, {len(pos)} verts (from {n0})')


def write(path, pos, nor, col, idx, extras):
    buf = bytearray(); views = []; accs = []
    def add(data, target):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data); views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}); return len(views) - 1
    def f3(vals, mm=False):
        flat = [x for v in vals for x in v]
        a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': 'VEC3'}
        if mm: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
        accs.append(a); return len(accs) - 1
    attrs = {'POSITION': f3(pos, True), 'NORMAL': f3(nor), 'COLOR_0': f3(col)}
    accs.append({'bufferView': add(struct.pack(f'<{len(idx)}H', *idx), 34963), 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
    while len(buf) % 4: buf.append(0)
    g = {'asset': {'version': '2.0', 'generator': 'tools/build_fruit.py', 'copyright': 'generated with Meshy, by agent (Claude) for Aaron Brodeur; CC BY-SA 4.0'},
         'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'fruit', 'mesh': 0}],
         'meshes': [{'name': 'fruit', 'primitives': [{'attributes': attrs, 'indices': len(accs) - 1, 'mode': 4}]}],
         'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}], 'extras': extras}
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    open(path, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js
                           + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf))


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for fid in (argv or FRUIT):
    build(fid, *FRUIT[fid])
