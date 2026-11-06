# Build a quadruped's client GLB from any Meshy mesh (world pipeline, phase 1: a tile's own animals, 2026-11-06). The one
# build for every pipeline-modelled four-legged species: nothing in it is per species. The hand builds before it
# (tools/build_cougar.py, build_bobcat.py, build_elk.py ...) each carried their species' palette, landmarks and reshapes;
# this one reads everything from the mesh, its texture and the species' trait card.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_quadruped.py -- \
#       <job dir or model.glb> <out.glb> --species <code> [--withers <m>] [--flip] [--meshy-task <id>]
#   then, as for the hand builds:
#   arch -arm64 .venv/bin/python tools/rig_quadruped.py <out.glb>
#   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs <out.glb> --tile <tile>
#
# Source: a Meshy text-to-3D job directory (tools/meshy_generate.py: model.glb, and texture_base_color.png after a refine)
# or a GLB. Meshy's convention: the animal faces glTF +z (Blender -y), feet on the floor; --flip turns it round.
#
# What it does:
#   - imports the mesh (one welded object, loose shards under 2% of the faces dropped) and normalises it to 2.0 units
#     nose to tail along y, so the thresholds below are fractions of the body's length (the cougar build's, which were
#     tuned on a Meshy mesh of about that size);
#   - the tail: the piece behind a cut at the rump holding the farthest point and nothing wide (under 4% of the length
#     from the midline, or 45% of the body's half-width), traced along its axis by edge distance; none if no such piece is found before the hind legs
#     (a hippo's stub, a tail lying against the legs), and then no TAIL part;
#   - the feet: the vertices within 1.5% of the length of the floor, split fore and hind by the largest gap in y; the
#     legs: what lies below a cut just under the belly line between the feet, by quadrant, pivots at the cut (elbow and
#     stifle);
#   - the head part: ahead of the fore feet and on the head's side of a plane at the neck base, pointing from it to the
#     centre of the front 10% of the body (a giraffe's neck, an elephant's trunk and a lion's mane all go with it);
#   - scales by the body mass: the remeshed (closed) surface's volume at 1,000 kg/m3 holds the trait card's mass_kg
#     (--withers sets the shoulder height instead; the card's shoulder height, an allometric estimate, is the last
#     resort), the origin between the feet;
#   - colour: each source face reads the texture (four samples at its UV centroid and toward its corners, the PNG's sRGB
#     decoded to linear); the source colours are clustered into the coat's own palette (k-means, 10 colours), and each face
#     of each tier takes the commonest palette colour under it (a vote, nearer source faces counting more), so the coat,
#     its stripes, spots and the face's markings come from the texture with their contrast, never from a palette in code;
#     with no texture, the mesh's vertex colours, else a neutral brown;
#   - decimates (collapse, X symmetry) to lod0 4,000-12,000 and lod1 1,500-4,000 triangles by how patterned the coat is
#     (the mean lightness step between neighbouring source faces), lod2 ~400;
#   - parts (the quadruped template Q): BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner half), TAIL_TIP 8
#     (outer half, child of TAIL), HEAD 6; pivots and lengths in extras.rig, so tools/rig_quadruped.py skins it.
import bpy, sys, os, math, json
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
SPECIES = opt('--species'); FLIP = '--flip' in argv; SYM = '--no-symmetry' not in argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOB = SRC if os.path.isdir(SRC) else os.path.dirname(SRC)
GLB = os.path.join(SRC, 'model.glb') if os.path.isdir(SRC) else SRC
TEX = os.path.join(JOB, 'texture_base_color.png')
job = {}
try: job = json.load(open(os.path.join(JOB, 'job.json')))
except (OSError, ValueError): pass
TASK = opt('--meshy-task') or job.get('task_id') or job.get('id') or os.path.basename(JOB.rstrip('/'))
traits = {}
for d in (('traits',), ()):   # the generated trait card, else the library record
    try: traits = json.load(open(os.path.join(ROOT, 'library', 'animals', *d, f'{SPECIES}.json'))); break
    except (OSError, ValueError, TypeError): pass
def find(o, key):
    if isinstance(o, dict):
        if key in o: return o[key]
        for v in o.values():
            r = find(v, key)
            if r is not None: return r
    return None
# size: --withers if given; else from the body mass (the trait card's mass_kg, from EltonTraits / PanTHERIA: the most
# reliable size a card carries) and the closed mesh's volume at 1,000 kg/m3; else the card's shoulder height (an
# allometric estimate from mass that ignores build: a hippo 2.5 m at the shoulder, a zebra 1.65 m)
WITHERS = float(opt('--withers') or 0) or None
MASS = float(opt('--mass') or find(traits, 'mass_kg') or 0) or None
SHOULDER = float(find(traits, 'shoulder_or_wingspan_m') or 0) or None
if not (WITHERS or MASS or SHOULDER): raise SystemExit(f'{SPECIES}: no size (trait card mass_kg or shoulder_or_wingspan_m, or --withers)')
TIERS = [('lod0', int(opt('--lod0') or 4000)), ('lod1', 1500), ('lod2', 400)]   # lod0 a little finer than the hand builds' 3,000: a coat's pattern

ob = A.import_glb_mesh(GLB)
me = ob.data; V = me.vertices
if FLIP:
    for v in V: v.co.x, v.co.y = -v.co.x, -v.co.y
# normalise: 2.0 units along y, feet on z = 0, centred in x
y0, y1 = min(v.co.y for v in V), max(v.co.y for v in V)
x0, x1 = min(v.co.x for v in V), max(v.co.x for v in V)
if x1 - x0 > 1.2 * (y1 - y0): print('WARN the mesh is wider than long: not side-on along y? (Meshy faces glTF +z)')
k0 = 2.0 / (y1 - y0); z0 = min(v.co.z for v in V); xc = (x0 + x1) / 2
for v in V: v.co = Vector(((v.co.x - xc) * k0, (v.co.y - y0) * k0 - 1.0, (v.co.z - z0) * k0))
me.update()

# ---- source colour per face (before anything moves: sampled by UV, kept by position in source space mapped later) ----
img = None
if os.path.exists(TEX):
    img = bpy.data.images.load(TEX)
else:
    for im in bpy.data.images:
        if im.size[0] > 0: img = im; break
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
if img is not None and me.uv_layers:
    W, H = img.size; px = list(img.pixels[:]) if W * H < 4_200_000 else None
    import array
    if px is None:
        buf = array.array('f', [0.0]) * (W * H * 4); img.pixels.foreach_get(buf); px = buf
    uv = me.uv_layers.active.data
    def tex(u, v):
        i = min(W - 1, max(0, int((u % 1.0) * W))); j = min(H - 1, max(0, int((v % 1.0) * H))); o = (j * W + i) * 4
        return px[o], px[o + 1], px[o + 2]
    cols = []
    for p in me.polygons:
        us = [uv[l].uv for l in p.loop_indices]; cu = sum((Vector((a.x, a.y)) for a in us), Vector((0, 0))) / len(us)
        s = [tex(cu.x, cu.y)] + [tex(cu.x + (a.x - cu.x) * 0.6, cu.y + (a.y - cu.y) * 0.6) for a in us[:3]]
        cols.append(tuple(srgb_to_lin(sum(c[k] for c in s) / len(s)) for k in range(3)))
    COLOR_SRC = 'texture'
elif me.color_attributes:
    ca = me.color_attributes[0]; cols = []
    for p in me.polygons:
        if ca.domain == 'CORNER': cs = [ca.data[l].color for l in p.loop_indices]
        else: cs = [ca.data[i].color for i in p.vertices]
        cols.append(tuple(sum(c[k] for c in cs) / len(cs) for k in range(3)))
    COLOR_SRC = 'vertex colours'
else:
    cols = [A.srgb2lin(0x8a7458)] * len(me.polygons); COLOR_SRC = 'none (neutral brown)'
# the source faces' centres (normalised frame; mapped by sc() below) carry the colour from here: the mesh is remeshed
CENTRES = [p.center.copy() for p in me.polygons]
print('INFO colour from', COLOR_SRC, 'source faces', len(cols))
# Meshy meshes are not manifold (the refines: hundreds of edges on three or more faces), and the collapse decimation
# stalls on them (the ground squirrel's refine at 3,821 triangles whatever the ratio): a voxel remesh, 1/200 of the
# length, makes one closed surface first. Thin strands (whiskers, tail hairs) under a voxel go with it.
me.remesh_voxel_size = 0.01; me.use_remesh_preserve_volume = True
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.voxel_remesh()
me = ob.data; V = me.vertices
print('INFO remeshed', len(me.polygons), 'faces')

adj = A.adjacency(me)
ymax = max(v.co.y for v in V)
# ---- tail ----
far = max(V, key=lambda v: v.co.y).index
# a tail is narrower than the body: under 4% of the length from the midline, or under 45% of the body's half-width (a
# squirrel's or a wildebeest's bushy tail)
xs = sorted(abs(v.co.x) for v in V); TAIL_W = max(0.08, 0.45 * xs[int(0.97 * (len(xs) - 1))])
tail, yc = [], 0.3
while yc < 0.95:
    comps = A.components(adj, [v.index for v in V if v.co.y > yc])
    c = next(c for c in comps if far in c)
    if max(abs(V[i].co.x) for i in c) < TAIL_W and len(c) < 0.2 * len(V): tail = c; break
    yc += 0.01
tailset = set(tail)
TA, tfrac = ([], {})
if tail:
    roots = [i for i in tail if any(V[u].co.y <= yc for u in adj[i])]
    if roots: TA, tfrac = A.tube_axis(me, adj, tail, roots)
    if len(TA) < 3 or not roots: tail, tailset, TA, tfrac = [], set(), [], {}
print('INFO tail', 'cut y %.3f, %d vertices' % (yc, len(tail)) if tail else 'none found')

# ---- feet, legs ----
low = [v for v in V if v.co.z < 0.03 and v.index not in tailset]
ys = sorted(v.co.y for v in low)
gap, ymid = 0, (ys[0] + ys[-1]) / 2
for a, b in zip(ys, ys[1:]):
    if b - a > gap and ys[0] + 0.15 < (a + b) / 2 < ys[-1] - 0.15: gap, ymid = b - a, (a + b) / 2
fore_low = [v.co.y for v in low if v.co.y < ymid]; hind_low = [v.co.y for v in low if v.co.y >= ymid]
yff, yfh = sum(fore_low) / len(fore_low), sum(hind_low) / len(hind_low)
def belly_at(y):
    # the torso's underside: the down-facing surface near the midline (a leg standing close under a narrow body, as a
    # hartebeest's, faces sideways and is not taken for the belly), its lower quarter
    zs = sorted(v.co.z for v in V if abs(v.co.x) < 0.06 and abs(v.co.y - y) < 0.06 and v.index not in tailset
                and v.co.z > 0.08 and v.normal.z < -0.5)
    return zs[len(zs) // 4] if zs else None
bz = [b for b in (belly_at(yff + (yfh - yff) * t) for t in (0.35, 0.5, 0.65)) if b is not None]
zcut = min(bz) - 0.03 if bz else 0.5 * max(v.co.z for v in V if abs(v.co.y - yff) < 0.05)
print('INFO feet y fore/hind %.3f %.3f, gap %.3f, leg cut z %.3f' % (yff, yfh, gap, zcut))
# a leg is a piece below the cut that stands on the floor; a piece that hangs below it without reaching the floor (an
# elephant's trunk, a long mane or tail tuft) is not
LEGV = set()
for c in A.components(adj, [v.index for v in V if v.index not in tailset and v.co.z < zcut]):
    if any(V[i].co.z < 0.03 for i in c): LEGV.update(c)
legs = {}
for i in LEGV:
    v = V[i]; legs.setdefault((v.co.y < ymid, v.co.x > 0), []).append(i)
if len(legs) < 4: raise SystemExit(f'{SPECIES}: found {len(legs)} leg columns below z {zcut:.3f}, not 4 (not standing on four feet?)')
# each quadrant's leg stands on the floor there: a walking pose (a hind foot stepped under the body) fails here, not in the game
for k, vs in legs.items():
    if not any(V[i].co.z < 0.03 for i in vs):
        raise SystemExit(f'{SPECIES}: no foot on the floor in the {"fore" if k[0] else "hind"} {"left" if k[1] else "right"} quadrant (a walking pose?)')
pivots = {}
for k, vs in legs.items():
    ring = [V[i].co for i in vs if V[i].co.z > zcut - 0.03] or [V[i].co for i in vs]
    c = sum(ring, Vector()) / len(ring)
    pivots[k] = Vector((c.x, c.y, zcut))
    pivots[k + ('r',)] = max(((p.x - c.x) ** 2 + (p.y - c.y) ** 2) ** 0.5 for p in ring)

# ---- head ----
nose = min(V, key=lambda v: v.co.y).co.copy()
y_nb = yff + 0.03
mid = [v.co for v in V if abs(v.co.x) < 0.04 and abs(v.co.y - y_nb) < 0.03 and v.index not in tailset and v.co.z > zcut]
NB = Vector((0, y_nb, (max(p.z for p in mid) + min(p.z for p in mid)) / 2)) if mid else Vector((0, y_nb, zcut + 0.2))
front = [v.co for v in V if v.co.y < nose.y + 0.2]
headc = sum(front, Vector()) / len(front)
NDIR = (headc - NB).normalized()
# withers: the top of the back over the forelegs
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top = max(v.co.z for v in V if abs(v.co.y - yw) < 0.05 and abs(v.co.x) < 0.06 and (v.co - NB).dot(NDIR) < 0.15)
import bmesh
_bm = bmesh.new(); _bm.from_mesh(me); VOL = abs(_bm.calc_volume()); _bm.free()
SIZE_BY = 'withers' if WITHERS else 'mass' if MASS else 'shoulder (trait card)'
S = WITHERS / top if WITHERS else (MASS / 1000.0 / VOL) ** (1 / 3) if MASS else SHOULDER / top
WITHERS = round(top * S, 3)
print('INFO size by', SIZE_BY, 'mass', MASS, 'volume %.4f units' % VOL, '-> withers', WITHERS, 'm; card shoulder', SHOULDER)
yorg = (yff + yfh) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
TA = [sc(p) for p in TA]
for k in list(pivots):
    pivots[k] = sc(pivots[k]) if len(k) == 2 else pivots[k] * S
NB = sc(NB); nose = sc(nose); ZC = zcut * S
me.update()
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1)) if TA else 0.0
TIP = None
if TA:
    acc, half = 0.0, tail_len / 2; TIP = TA[-1]
    for i in range(len(TA) - 1):
        L = (TA[i + 1] - TA[i]).length
        if acc + L >= half: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((half - acc) / L); break
        acc += L
body_len = (TA[0].y if TA else max(v.co.y for v in V)) - nose.y
print('LANDMARKS withers', WITHERS, 'scale', round(S, 4), 'head-body', round(body_len, 3), 'tail', round(tail_len, 3), 'nose', [round(x, 3) for x in nose],
      'neck base', [round(x, 3) for x in NB], 'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 3) for x in p] for k, p in pivots.items() if len(k) == 2})

# ---- source colour, now in the final frame: a kd-tree of the source faces' centres ----
kd = KDTree(len(CENTRES))
for i, c in enumerate(CENTRES): kd.insert(sc(c), i)
kd.balance()
# the coat's palette: k-means of the source faces' colours (on sRGB-like values, so dark marks separate), K colours.
# A face of a tier takes the commonest palette colour under it (votes weighted by nearness), not the mean: a mean turns a
# zebra's stripes and a leopard's rosettes to grey and brown at a few thousand triangles; a vote keeps the contrast.
import numpy as np
K = 10
C = np.array(cols, dtype=np.float64) ** (1 / 2.2)
rng = np.random.default_rng(7)
cent = C[rng.choice(len(C), K, replace=False)]
for _ in range(25):
    lab = np.argmin(((C[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
    for k in range(K):
        m = lab == k
        cent[k] = C[m].mean(0) if m.any() else C[rng.integers(len(C))]
LAB = lab.tolist(); PAL = [tuple(float(x) for x in (c ** 2.2)) for c in cent]
print('INFO palette', K, 'colours, shares', [round(float((lab == k).mean()), 3) for k in range(K)])
# how patterned the coat is: the mean lightness step between a source face and its nearest neighbours, over a sample
LUM = (C @ np.array([0.2126, 0.7152, 0.0722]))
steps = []
for i in rng.choice(len(C), min(3000, len(C)), replace=False).tolist():
    for _, j, _d in kd.find_n(sc(CENTRES[i]), 7)[1:]: steps.append(abs(LUM[i] - LUM[j]))
PATTERN = float(np.mean(steps))
# a patterned coat gets the triangles to carry it at the near tier: plain coats measure 0.024-0.058 (the hippo, the
# wildebeest, the lion, the wild dog's blotches), patterned ones 0.089-0.125 (the zebra, the giraffe, the cheetah, the
# leopard); lod0 runs from 4,000 to 12,000 triangles and lod1 from 1,500 to 4,000 between 0.05 and 0.09
PT = min(1.0, max(0.0, (PATTERN - 0.05) / 0.04))
if not opt('--lod0'): TIERS = [('lod0', int(4000 + 8000 * PT)), ('lod1', int(1500 + 2500 * PT)), ('lod2', 400)]
print('INFO pattern (mean neighbour lightness step) %.4f -> tiers %s' % (PATTERN, TIERS))

# ---- per-vertex part on the full mesh (decimation keeps vertex groups) ----
ymid_s = (pivots[(True, True)].y + pivots[(False, True)].y) / 2
def rig_full(i):
    p = V[i].co
    if i in tailset:
        t = tfrac.get(i, 0.0)
        if t >= 0.5: return dict(part=8, partw=A.smooth(0.5, 0.62, t), pivot=TIP)
        return dict(part=3, partw=A.smooth(0.0, 0.12, t), pivot=TA[0])
    k = (p.y < ymid_s, p.x > 0); pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
    dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
    bl = 0.03 * S
    # below the cut only the pieces standing on the floor are leg (an elephant's trunk goes to the head below)
    w = (1.0 if i in LEGV else 0.0) if p.z < pv.z - bl else A.smooth(pv.z + 2 * bl, pv.z - bl, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
    if w > 0 and not (k[0] and p.y < NB.y and p.z > ZC): return dict(part=1 if k[0] == k[1] else 2, partw=w, pivot=pv)
    if p.y < NB.y + 0.05 * S:
        wh = A.smooth(-0.02 * S, 0.1 * S, (p - NB).dot(NDIR))
        if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')

def face_color(p):
    c = p.center; rad = max(0.01 * S, math.sqrt(max(p.area, 1e-12)) * 0.75)
    hits = kd.find_range(c, rad)
    if len(hits) < 3: hits = kd.find_n(c, 6)
    votes = {}
    for _, i, d in hits: votes[LAB[i]] = votes.get(LAB[i], 0.0) + 1.0 / (0.002 * S + d)
    return PAL[max(votes, key=votes.get)]

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target, symmetry=SYM)
    print("INFO tier", name, "from", n0, "to", len(o.data.polygons))
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        piv = TA[0] if part == 3 else TIP if part == 8 else NB if part == 6 else pivots[(co.y < ymid_s, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, face_color, lambda i: R[i])
    bpy.data.objects.remove(o)
    tiers.append((name, t))
to3l = lambda p: [round(x, 4) for x in A.to3(p)]
common = traits.get('common') or SPECIES
rig = {'kind': 'quadruped', 'head': to3l(NB), 'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]),
       'length_m': round(body_len + tail_len, 3)}
if TA: rig['tail'] = to3l(TA[0]); rig['tail_tip'] = to3l(TIP)
A.write_glb(OUT, tiers, 'wild-earth tools/build_quadruped.py (Blender)',
            f'{common} generated with Meshy (meshy.ai), task {TASK}, for Wild Earth; CC BY-SA 4.0; scaled, coloured from its texture, decimated',
            extras={'species': SPECIES, 'withers_m': WITHERS, 'size_by': SIZE_BY, 'mass_kg': MASS, 'meshy_task': TASK, 'colour': COLOR_SRC, 'build': 'tools/build_quadruped.py',
                    'rig': rig, 'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner half), TAIL_TIP 8 (outer half, child of TAIL), HEAD 6'})
