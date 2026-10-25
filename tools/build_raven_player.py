# Build client/assets/raven_player.glb, the player's flying common raven, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a171aa-e080-75ec-971a-feaa08763b2e, ai_model latest (meshy-7.1),
#   triangle remesh to 20,000 faces (20,347 triangles, untextured), 2026-10-25 UTC; job record in
#   library/animals/jobs/corvus_corax/01a171aa-e080-75ec-971a-feaa08763b2e/job.json (prompt there: a raven in level
#   gliding flight, long narrow wings straight out, five separated outer primaries, wedge tail, legs tucked).
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none beyond asset.generator, which is kept in extras.source.
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_raven_player.py -- \
#       library/animals/jobs/corvus_corax/01a171aa-e080-75ec-971a-feaa08763b2e/model.glb \
#       client/assets/raven_player.glb [--preview /tmp/raven_player]
#
# What it does (brief: library/animals/drafts/corvus_corax.md; review notes in library/animals/corvus_corax.json):
# drops the stray shard; cuts the dangling lower legs and toes off below the belly feathers and caps the stumps (the
# feet stay tucked out of sight, as in a gliding raven); keeps the bird's left half (the better hand, five separate
# fingers) and mirrors it; scales bill tip to tail tip to 0.62 m with the origin on the body at the wing roots; stretches
# each wing outward, 1.15x in the arm and the rest in the hand, to a 1.25 m span (the source spans only 1.56 lengths);
# reshapes the rounded fan tail into a graduated wedge (centre feathers longer, outer ones shorter, tip narrowed) and
# lifts it 8 degrees into line with the body; colours by vertex (all black #0e0f13, a blue-violet gloss band across the
# upper wing coverts and the mantle, slightly paler flight feathers below, matte bill). Tiers: lod0 ~2,500 and lod1
# ~900 triangles by Blender collapse decimation with X symmetry; lod2 ~250 triangles built from the top-view
# silhouette (constrained Delaunay inside the outline, top and bottom surfaces lifted onto the source mesh) so the
# five fingers and the wedge tail survive. A 10-bone armature (spine, neck, head, tail; per wing upper arm, forearm,
# hand) skins all three tiers with procedural weights (blends at shoulder, elbow, wrist, neck and tail base), and two
# clips are authored by script: `fly` (1.4 s, one wingbeat: 45% downstroke, wrist flexed and hand swept back on the
# upstroke, body rising on the downstroke) and `glide` (4 s loop: slight extra dihedral, small slow flex of hand,
# arm and tail). Output: one GLB with skinned meshes lod0, lod1, lod2 (POSITION, NORMAL, COLOR_0 linear, JOINTS_0,
# WEIGHTS_0), one material, clips fly and glide; metres, +y up, bill toward +z, origin on the body at the wing roots.
# --preview <prefix>: renders the tiers (top, below, side, chase view) and a fly / glide montage to <prefix>_*.png.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector, Quaternion, Matrix
from mathutils.bvhtree import BVHTree
from mathutils import geometry as mgeo

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a171aa-e080-75ec-971a-feaa08763b2e'
LENGTH, SPAN = 0.62, 1.25          # bill tip to tail tip, wingspan (m)
# Landmarks in the source's own units (Blender axes after import: bill toward -y, +z up, +x the bird's left; the source
# is 1.9 units across): shoulder where the wing leaves the flank, wrist where the leading edge steps back.
SHOULDER_SRC, WRIST_SRC, TAIL_BASE_SRC = 0.152, 0.545, 0.30
LEG_CUT_SRC = dict(z=-0.118, y0=-0.17, y1=0.17, x=0.2)   # below this, in this box: tarsi and toes
ARM_STRETCH = 1.15                 # outward stretch of the arm; the hand takes the rest of the span
TAIL_LIFT = math.radians(8)
TIERS = [('lod0', 2500), ('lod1', 900), ('lod2', 250)]
FPS, FLY_T, GLIDE_T = 30, 1.4, 4.0

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
def mixc(a, b, t): return tuple(x + (y - x) * t for x, y in zip(a, b))
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
# brief section 1 (sRGB)
BLACK, SHEEN, BILL, PALEFLIGHT = srgb2lin(0x0e0f13), srgb2lin(0x3a3f66), srgb2lin(0x141416), srgb2lin(0x24252c)

# ---- source metadata (Meshy Terms 2.4: carry over what it embeds) ----
raw = open(SRC, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
src_json = json.loads(raw[20:20 + jl])
SRC_META = {'asset': src_json.get('asset', {}), 'extras': src_json.get('extras')}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
src = next(o for o in sc.objects if o.type == 'MESH')
bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.mesh.customdata_custom_splitnormals_clear()

# ---- clean, cut the legs, mirror the left half ----
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
L = LEG_CUT_SRC
leg = [f for f in bm.faces if any(abs(v.co.x) < L['x'] and L['y0'] < v.co.y < L['y1'] and v.co.z < L['z'] for v in f.verts)]
bmesh.ops.delete(bm, geom=leg, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
filled = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)['faces']
bmesh.ops.triangulate(bm, faces=filled)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
for v in bm.verts:
    if abs(v.co.x) < 1e-5: v.co.x = 0.0
dup = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
dverts = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMVert)]
dfaces = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMFace)]
for v in dverts: v.co.x = -v.co.x
bmesh.ops.reverse_faces(bm, faces=dfaces)
bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.co.x == 0.0], dist=1e-5)
bmesh.ops.triangulate(bm, faces=bm.faces)

# ---- scale, origin, wing stretch, tail wedge ----
ys = [v.co.y for v in bm.verts]
S = LENGTH / (max(ys) - min(ys))
root = [v.co for v in bm.verts if SHOULDER_SRC < v.co.x < SHOULDER_SRC + 0.05]
le, te = min(c.y for c in root), max(c.y for c in root)
oy = le + 0.35 * (te - le)                                   # about a third of the root chord back: the wing roots
mid = [v.co.z for v in bm.verts if abs(v.co.x) < 0.03 and abs(v.co.y - oy) < 0.03]
O = Vector((0, oy, (min(mid) + max(mid)) / 2))
for v in bm.verts: v.co = (v.co - O) * S
XS, XW = SHOULDER_SRC * S, WRIST_SRC * S
YTB = (TAIL_BASE_SRC - O.y) * S
tip0 = max(v.co.x for v in bm.verts)
# outward stretch: slope 1 on the body, ARM_STRETCH on the arm, KH on the hand, blended over a few cm; KH is solved so
# the tip lands at SPAN / 2
def make_stretch(kh, n=2000):
    xs_ = [tip0 * 1.02 * i / n for i in range(n + 1)]; out = [0.0]
    for i in range(1, n + 1):
        u = (xs_[i - 1] + xs_[i]) / 2
        s = 1 + (ARM_STRETCH - 1) * smooth(XS - 0.01, XS + 0.03, u) + (kh - ARM_STRETCH) * smooth(XW - 0.03, XW + 0.03, u)
        out.append(out[-1] + s * (xs_[i] - xs_[i - 1]))
    def f(x):
        a = abs(x); k = min(n - 1, int(a / xs_[-1] * n)); t = (a - xs_[k]) / (xs_[k + 1] - xs_[k])
        return math.copysign(out[k] + (out[k + 1] - out[k]) * t, x)
    return f
lo, hi = 1.0, 3.0
for _ in range(40):
    KH = (lo + hi) / 2
    if make_stretch(KH)(tip0) < SPAN / 2: lo = KH
    else: hi = KH
stretch = make_stretch(KH)
XW2 = stretch(XW)
for v in bm.verts: v.co.x = stretch(v.co.x)
XS2 = stretch(XS)
# tail: graduate into a wedge, narrow the tip, lift it about its base
tail = [v for v in bm.verts if v.co.y > YTB and abs(v.co.x) < 0.13]
ytip = max(v.co.y for v in tail)
W = max(abs(v.co.x) for v in tail if v.co.y > YTB + 0.7 * (ytip - YTB))
ztb = sum(v.co.z for v in bm.verts if abs(v.co.x) < 0.02 and abs(v.co.y - YTB) < 0.01) / max(1, sum(1 for v in bm.verts if abs(v.co.x) < 0.02 and abs(v.co.y - YTB) < 0.01))
Rl = Matrix.Rotation(TAIL_LIFT, 3, 'X')
for v in tail:
    t = max(0.0, min(1.0, (v.co.y - YTB) / (ytip - YTB))); u = min(1.0, abs(v.co.x) / W)
    g = 1.06 - 0.34 * u * u
    v.co.y = YTB + (v.co.y - YTB) * (1 + (g - 1) * t ** 1.5)
    v.co.x *= 1 - 0.14 * t * t
    w = smooth(0.0, 0.35, t)
    p = Vector((0, v.co.y - YTB, v.co.z - ztb)); q = Rl @ p
    v.co.y = YTB + p.y + (q.y - p.y) * w; v.co.z = ztb + p.z + (q.z - p.z) * w
for e in bm.edges:   # crisp feather edges, smooth elsewhere
    e.smooth = not (e.is_manifold and e.calc_face_angle(0) > math.radians(70))
for f in bm.faces: f.smooth = True
base_me = bpy.data.meshes.new('base'); bm.to_mesh(base_me); bm.free()
base = bpy.data.objects.new('base', base_me); sc.collection.objects.link(base)
bpy.data.objects.remove(src)
print('SCALE', S, 'hand stretch', KH, 'shoulder', XS2, 'wrist', XW2, 'tail base y', YTB)

# ---- landmarks for the armature (final coordinates) ----
bvs = [v.co.copy() for v in base_me.vertices]
def wing_joint(x):
    sl = [c for c in bvs if abs(c.x - x) < 0.012]
    yle = min(c.y for c in sl)
    front = sorted(c.z for c in sl if c.y < yle + 0.04)
    return Vector((x, yle + 0.022, front[len(front) // 2]))
XE2 = XS2 + 0.45 * (XW2 - XS2)
J = {'shoulder': wing_joint(XS2 + 0.01), 'elbow': wing_joint(XE2), 'wrist': wing_joint(XW2), 'tip': wing_joint(SPAN / 2 - 0.02)}
J['elbow'].y += 0.012   # the elbow sits behind the shoulder-wrist line
ybill = min(c.y for c in bvs); ytail = max(c.y for c in bvs)
def mid_z(y):
    s = [c.z for c in bvs if abs(c.x) < 0.015 and abs(c.y - y) < 0.01]
    return (min(s) + max(s)) / 2 if s else 0.0
YNECK, YHEAD = ybill + 0.20, ybill + 0.125      # base of the neck, back of the skull
ZTB = mid_z(YTB)
BONES = [  # name, head, tail, parent
    ('spine', Vector((0, 0.06, 0)), Vector((0, -0.06, 0)), None),
    ('neck', Vector((0, YNECK, mid_z(YNECK))), Vector((0, YHEAD, mid_z(YHEAD))), 'spine'),
    ('head', Vector((0, YHEAD, mid_z(YHEAD))), Vector((0, ybill, mid_z(ybill + 0.01))), 'neck'),
    ('tail', Vector((0, YTB, ZTB)), Vector((0, ytail, mid_z(ytail - 0.01))), 'spine'),
]
for sd, s in (('L', 1), ('R', -1)):
    m = lambda p: Vector((p.x * s, p.y, p.z))
    BONES += [(f'upperarm.{sd}', m(J['shoulder']), m(J['elbow']), 'spine'),
              (f'forearm.{sd}', m(J['elbow']), m(J['wrist']), f'upperarm.{sd}'),
              (f'hand.{sd}', m(J['wrist']), m(J['tip']), f'forearm.{sd}')]

def weights(p):
    """Bone weights for a rest position (final coordinates)."""
    a = abs(p.x); sd = 'L' if p.x > 0 else 'R'
    wa = smooth(XS2 - 0.012, XS2 + 0.022, a)
    wf = smooth(XE2 - 0.03, XE2 + 0.03, a)
    wh = smooth(XW2 - 0.025, XW2 + 0.025, a)
    body = 1 - wa
    wt = smooth(YTB - 0.015, YTB + 0.03, p.y) * body
    wn = smooth(YNECK + 0.02, YNECK - 0.02, p.y) * body
    whd = smooth(YHEAD + 0.012, YHEAD - 0.012, p.y) * body
    w = {'spine': body - wt - wn, 'neck': wn - whd, 'head': whd, 'tail': wt,
         f'upperarm.{sd}': wa - wf, f'forearm.{sd}': wf - wh, f'hand.{sd}': wh}
    return {k: x for k, x in w.items() if x > 1e-3}

def colour(p, n):
    """Vertex colour (linear) from rest position and normal."""
    a = abs(p.x)
    if p.y < ybill + 0.075 and a < 0.03: return BILL
    if a > XS2 - 0.005:   # wing
        sl_le = J['shoulder'].y + (J['wrist'].y - J['shoulder'].y) * min(1, (a - XS2) / (XW2 - XS2)) - 0.022
        chord = (p.y - sl_le)
        if n.z > 0.2 and a < XW2 + 0.05:
            band = smooth(0.0, 0.025, chord) * (1 - smooth(0.06, 0.10, chord))   # the covert band behind the leading edge
            return mixc(BLACK, SHEEN, 0.38 * band * smooth(0.2, 0.6, n.z))
        if n.z < -0.2 and chord > 0.07: return mixc(BLACK, PALEFLIGHT, smooth(0.07, 0.13, chord))
        if n.z < -0.2 and a > XW2: return mixc(BLACK, PALEFLIGHT, 0.7)
        return BLACK
    if n.z > 0.45 and YNECK + 0.04 < p.y < YTB - 0.02:   # mantle and scapulars
        return mixc(BLACK, SHEEN, 0.22 * smooth(0.45, 0.85, n.z))
    return BLACK

# ---- tiers ----
def tri_bm(me):
    b = bmesh.new(); b.from_mesh(me); bmesh.ops.triangulate(b, faces=b.faces); b.to_mesh(me); b.free()

def decimated(name, target):
    ob = base.copy(); ob.data = base_me.copy(); ob.name = name; ob.data.name = name; sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = target / len(ob.data.polygons)
    d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    tri_bm(ob.data)
    b = bmesh.new(); b.from_mesh(ob.data)
    for e in b.edges: e.smooth = not (e.is_manifold and e.calc_face_angle(0) > math.radians(70))
    b.to_mesh(ob.data); b.free()
    return ob

def silhouette(name, target, cell=0.004):
    """lod2: top-view outline of the base mesh, triangulated inside, top and bottom lifted onto the mesh."""
    me = base_me
    x0, y0 = -SPAN / 2 - 0.02, ybill - 0.02
    nx, ny = int((SPAN + 0.04) / cell) + 1, int((ytail - ybill + 0.04) / cell) + 1
    grid = bytearray(nx * ny)
    vco = [v.co for v in me.vertices]
    for p in me.polygons:
        a, b, c = (vco[i] for i in p.vertices[:3])
        i0 = max(0, int((min(a.x, b.x, c.x) - x0) / cell)); i1 = min(nx - 1, int((max(a.x, b.x, c.x) - x0) / cell) + 1)
        j0 = max(0, int((min(a.y, b.y, c.y) - y0) / cell)); j1 = min(ny - 1, int((max(a.y, b.y, c.y) - y0) / cell) + 1)
        d = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        if abs(d) < 1e-12: continue
        for j in range(j0, j1 + 1):
            py = y0 + (j + 0.5) * cell
            for i in range(i0, i1 + 1):
                px = x0 + (i + 0.5) * cell
                l1 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / d
                l2 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / d
                if l1 >= -1e-9 and l2 >= -1e-9 and l1 + l2 <= 1 + 1e-9: grid[j * nx + i] = 1
    # outer boundary only: flood the outside, everything else is inside
    out = bytearray(nx * ny); stack = [0]; out[0] = 1
    while stack:
        k = stack.pop(); i, j = k % nx, k // nx
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if 0 <= ii < nx and 0 <= jj < ny:
                kk = jj * nx + ii
                if not out[kk] and not grid[kk]: out[kk] = 1; stack.append(kk)
    inside = lambda i, j: 0 <= i < nx and 0 <= j < ny and not out[j * nx + i]
    # trace the boundary between inside and outside cells along cell edges (corner lattice), counter-clockwise
    start = next((i, j) for j in range(ny) for i in range(nx) if inside(i, j))
    # walk with the inside on the left; directions: 0 +x, 1 +y, 2 -x, 3 -y
    D = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    def cell_left(px, py, d):   # inside cell on the left of an edge leaving corner (px,py) in direction d
        return {0: (px, py), 1: (px - 1, py), 2: (px - 1, py - 1), 3: (px, py - 1)}[d]
    def cell_right(px, py, d):
        return {0: (px, py - 1), 1: (px, py), 2: (px - 1, py), 3: (px - 1, py - 1)}[d]
    px, py, d = start[0], start[1], 0
    poly = []; first = (px, py, d)
    for _ in range(nx * ny * 4):
        poly.append((px, py))
        px, py = px + D[d][0], py + D[d][1]
        for nd in ((d + 1) % 4, d, (d + 3) % 4, (d + 2) % 4):   # prefer left turns: keeps diagonal gaps open
            if inside(*cell_left(px, py, nd)) and not inside(*cell_right(px, py, nd)): d = nd; break
        if (px, py, d) == first: break
    pts = [Vector((x0 + px * cell, y0 + py * cell)) for px, py in poly]
    def dp(ptsc, eps):
        # Douglas-Peucker on a closed ring: split at the two farthest-apart points
        n = len(ptsc); a = 0; b = max(range(n), key=lambda k: (ptsc[k] - ptsc[0]).length)
        def rec(i, j, keep):
            if j <= i + 1: return
            A, B = ptsc[i % n], ptsc[j % n]; ab = B - A; L2 = ab.length_squared
            best, bk = -1, None
            for k in range(i + 1, j):
                P = ptsc[k % n]
                dd = abs(ab.x * (P.y - A.y) - ab.y * (P.x - A.x)) / math.sqrt(L2) if L2 > 0 else (P - A).length
                if dd > best: best, bk = dd, k
            if best > eps: keep.add(bk % n); rec(i, bk, keep); rec(bk, j, keep)
        keep = {a, b}; rec(a, b, keep); rec(b, n + a, keep)
        return [ptsc[k] for k in sorted(keep)]
    # joint stations the outline must carry so the low tier bends at shoulder, elbow and wrist
    def with_stations(ring):
        outp = []
        for k in range(len(ring)):
            A, B = ring[k], ring[(k + 1) % len(ring)]; outp.append(A)
            cuts = []
            for xc in (XS2, XE2, XW2, -XS2, -XE2, -XW2):
                if (A.x - xc) * (B.x - xc) < 0:
                    t = (xc - A.x) / (B.x - A.x); cuts.append((t, A.lerp(B, t)))
            outp += [c for _, c in sorted(cuts, key=lambda q: q[0])]
        return outp
    interior = [Vector((0, y)) for y in [ybill + 0.04 + k * 0.07 for k in range(9)] if y < ytail - 0.04]
    for s in (1, -1):
        for key in ('shoulder', 'elbow', 'wrist'):
            jp = J[key]; interior.append(Vector((s * jp.x, jp.y + 0.03)))
    interior = [p for p in interior if inside(int((p.x - x0) / cell), int((p.y - y0) / cell))]
    lo_e, hi_e = 0.001, 0.05
    for _ in range(30):
        eps = (lo_e + hi_e) / 2
        ring = with_stations(dp(pts, eps))
        if 2 * (len(ring) + 2 * len(interior) - 2) > target: lo_e = eps   # triangles of a CDT: boundary + 2 interior - 2, per side
        else: hi_e = eps
    ring = with_stations(dp(pts, hi_e))
    allv = ring + interior
    vout, _, fout, _, _, _ = mgeo.delaunay_2d_cdt(allv, [], [list(range(len(ring)))], 1, 1e-7)
    bvh = BVHTree.FromObject(base, bpy.context.evaluated_depsgraph_get())
    def heights(p):
        top = bvh.ray_cast(Vector((p.x, p.y, 2)), Vector((0, 0, -1)))
        bot = bvh.ray_cast(Vector((p.x, p.y, -2)), Vector((0, 0, 1)))
        if top[0] is None or bot[0] is None:
            near = bvh.find_nearest(Vector((p.x, p.y, 0)))[0]; return near.z, near.z
        return top[0].z, bot[0].z
    nb = len(vout)
    onb = [any((Vector(v) - r).length < 1e-6 for r in ring) for v in vout]
    verts = []; idx_top = []; idx_bot = []
    for k, v in enumerate(vout):
        zt, zb = heights(v)
        if onb[k]: zt = zb = (zt + zb) / 2   # the rim: top and bottom meet (own vertices, so no face is a duplicate)
        verts.append((v.x, v.y, zt)); idx_top.append(len(verts) - 1)
        verts.append((v.x, v.y, zb)); idx_bot.append(len(verts) - 1)
    faces = []
    for f in fout:
        for k in range(1, len(f) - 1):
            a, b, c = f[0], f[k], f[k + 1]
            A, B, C = vout[a], vout[b], vout[c]
            if (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0: b, c = c, b
            faces.append((idx_top[a], idx_top[b], idx_top[c]))
            faces.append((idx_bot[a], idx_bot[c], idx_bot[b]))
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    for p in m.polygons: p.use_smooth = False
    ob = bpy.data.objects.new(name, m); sc.collection.objects.link(ob)
    print('SILHOUETTE ring', len(ring), 'interior', len(interior), 'eps', round(hi_e, 4))
    return ob

tier_obs = []
for name, target in TIERS:
    ob = silhouette(name, target) if name == 'lod2' else decimated(name, target)
    ob.data.validate()   # drop degenerate faces now, so the counts below are the exported ones
    tier_obs.append(ob)
bpy.data.objects.remove(base)

# ---- colour and material ----
mat = bpy.data.materials.new('raven')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1); bsdf.inputs['Roughness'].default_value = 0.55
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
for ob in tier_obs:
    me = ob.data
    for uv in list(me.uv_layers): me.uv_layers.remove(uv)   # vertex colour only; the source atlas is not used
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            ca.data[li].color = (*colour(co, n), 1.0)
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.append(mat)
    print('TIER', ob.name, 'tris', len(me.polygons), 'verts', len(me.vertices))

# ---- armature, weights ----
ad = bpy.data.armatures.new('raven_rig'); arm = bpy.data.objects.new('raven_rig', ad); sc.collection.objects.link(arm)
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    eb = ad.edit_bones.new(name); eb.head = h; eb.tail = t; eb.roll = 0
    if parent: eb.parent = ad.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
for ob in tier_obs:
    ob.parent = arm
    for name, *_ in BONES: ob.vertex_groups.new(name=name)
    for v in ob.data.vertices:
        w = weights(v.co); tot = sum(w.values())
        for k, x in w.items(): ob.vertex_groups[k].add([v.index], x / tot, 'REPLACE')
    mod = ob.modifiers.new('rig', 'ARMATURE'); mod.object = arm

# ---- clips ----
REST = {b.name: b.matrix_local.to_quaternion() for b in ad.bones}
def left_and_right(name, axis, deg):
    """Rotation for the left bone and its mirror image on the right (axial vector mirrors as (x, -y, -z))."""
    a = Vector(axis)
    return {f'{name}.L': Quaternion(a, math.radians(deg)), f'{name}.R': Quaternion(Vector((a.x, -a.y, -a.z)), math.radians(deg))}
FLAP, SWEEP, TWIST = (0, -1, 0), (0, 0, 1), (1, 0, 0)   # left wing: up, tip back, trailing edge up (leading edge down)
def combine(*ds):
    out = {}
    for d in ds:
        for k, q in d.items(): out[k] = q @ out[k] if k in out else q
    return out
def fly_pose(t):
    u = (t / FLY_T) % 1.0; D = 0.45
    p = u / D if u < D else 1 + (u - D) / (1 - D)          # 0 top, 1 bottom, 2 top again
    c = math.cos(math.pi * p)
    up = math.sin(math.pi * (p - 1)) if p > 1 else 0.0     # 0..1..0 through the upstroke
    up = up ** 0.8
    dn = math.sin(math.pi * p) if p <= 1 else 0.0
    rot = combine(
        left_and_right('upperarm', FLAP, -1 + 36 * c), left_and_right('upperarm', SWEEP, 6 * up),
        left_and_right('forearm', SWEEP, -12 * up), left_and_right('forearm', FLAP, -6 * up + 4 * dn),
        left_and_right('hand', FLAP, 9 * dn - 20 * up), left_and_right('hand', SWEEP, 38 * up),
        left_and_right('hand', TWIST, -7 * dn + 4 * up),
        {'spine': Quaternion((1, 0, 0), math.radians(-2.5 * up + 1.0 * dn)),
         'neck': Quaternion((1, 0, 0), math.radians(2.0 * up - 1.0 * dn)),
         'tail': Quaternion((1, 0, 0), math.radians(-3 * dn + 2 * up))})
    loc = {'spine': Vector((0, 0, 0.014 * (1 - c) / 2))}
    return rot, loc
def glide_pose(t):
    w = 2 * math.pi * t / GLIDE_T
    rot = combine(
        left_and_right('upperarm', FLAP, 3 + 1.2 * math.sin(w)), left_and_right('upperarm', SWEEP, 1.0 * math.sin(w + 0.6)),
        left_and_right('hand', FLAP, -1.5 + 1.8 * math.sin(w + 1.1)), left_and_right('hand', SWEEP, 3 + 2.0 * math.sin(w + 0.4)),
        left_and_right('hand', TWIST, 1.2 * math.sin(w + 2.0)),
        {'tail': Quaternion((1, 0, 0), math.radians(1.5 * math.sin(w + 2.2))),
         'neck': Quaternion((0, 0, 1), math.radians(1.5 * math.sin(w)))})
    return rot, {}
arm.animation_data_create()
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
for clip, T, fn in (('fly', FLY_T, fly_pose), ('glide', GLIDE_T, glide_pose)):
    act = bpy.data.actions.new(clip); arm.animation_data.action = act
    n = round(T * FPS); prev = {}
    for f in range(n + 1):
        rot, loc = fn(f / FPS)
        for pb in arm.pose.bones:
            r = REST[pb.name]
            q = r.inverted() @ rot.get(pb.name, Quaternion()) @ r
            if pb.name in prev and prev[pb.name].dot(q) < 0: q.negate()
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.location = r.inverted() @ loc.get(pb.name, Vector())
            pb.keyframe_insert('rotation_quaternion', frame=f); pb.keyframe_insert('location', frame=f)
    tr = arm.animation_data.nla_tracks.new(); tr.name = clip; tr.strips.new(clip, 0, act)
arm.animation_data.action = None
sc.render.fps = FPS

# ---- export ----
sc['wild_earth'] = {
    'species': 'corvus_corax', 'role': 'player (flying)', 'length_m': LENGTH, 'span_m': SPAN,
    'tiers': {ob.name: len(ob.data.polygons) for ob in tier_obs},
    'clips': {'fly': FLY_T, 'glide': GLIDE_T},
    'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'latest (meshy-7.1)', 'mode': 'text-to-3d preview',
               'credit': 'generated with Meshy (meshy.ai)', 'meshy_asset': json.dumps(SRC_META['asset']),
               'meshy_extras': json.dumps(SRC_META['extras'])},
    'license': 'CC BY-SA 4.0', 'built_by': 'tools/build_raven_player.py',
    'stretch': {'arm': ARM_STRETCH, 'hand': round(KH, 3)},
}
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True, export_animations=True,
    export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=False,
    export_colors=True, export_normals=True, export_texcoords=False, export_materials='EXPORT', export_extras=True,
    export_def_bones=False, export_reset_pose_bones=True, export_rest_position_armature=True,
    export_copyright='Common raven: generated with Meshy (meshy.ai), task 01a171aa-e080-75ec-971a-feaa08763b2e, for the '
                     'Wild Earth project; mirrored, rescaled, re-shaped, rigged and animated by tools/build_raven_player.py. '
                     'CC BY-SA 4.0')
import os
print('WROTE', OUT, os.path.getsize(OUT))

# ---- optional preview (workbench, vertex colour) ----
if PREVIEW:
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 560
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.62, 0.68, 0.74)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    def shot(path, d, scale=1.45, ortho=True, ctr=(0, 0, 0)):
        cv = Vector(ctr); cam.data.type = 'ORTHO' if ortho else 'PERSP'; cam.data.ortho_scale = scale; cam.data.lens = 50
        cam.location = cv + Vector(d).normalized() * (5 if ortho else 5.7)
        up = 'Y' if abs(Vector(d).normalized().z) < 0.99 else 'Z'
        cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', up).to_euler()
        if up == 'Z': cam.rotation_euler = (0, 0, 0) if d[2] > 0 else (math.pi, 0, 0)
        sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    for ob in tier_obs: ob.hide_render = True
    arm.animation_data.action = None
    for ob in tier_obs:
        ob.hide_render = False
        for view, d in (('top', (0, 0, 1)), ('below', (0, 0, -1)), ('side', (1, 0, 0.0001)), ('chase', (0, 5.5, 1.6))):
            shot(f'{PREVIEW}_{ob.name}_{view}.png', d, ortho=view != 'chase')
        ob.hide_render = True
    tier_obs[0].hide_render = False
    for tr in arm.animation_data.nla_tracks: tr.mute = True
    for clip, T in (('fly', FLY_T), ('glide', GLIDE_T)):
        arm.animation_data.action = bpy.data.actions[clip]
        for k in range(6):
            f = round(k * T * FPS / 6); sc.frame_set(f)
            shot(f'{PREVIEW}_{clip}_{k}_chase.png', (0, 5.5, 1.6), ortho=False)
            shot(f'{PREVIEW}_{clip}_{k}_front.png', (0, -1, 0.0001))
