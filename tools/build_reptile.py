# Build a reptile's client GLB from any Meshy mesh (world pipeline, phase 1: a tile's own animals, 2026-11-06). The one
# build for every pipeline-modelled reptile with legs, as tools/build_quadruped.py is for the four-legged mammals and
# tools/build_bird.py for the birds: nothing in it is per species. The hand builds before it (tools/build_fence_lizard.py,
# build_salamander.py, build_ensatina.py) carried their species' palettes and reshapes; this one reads everything from the
# mesh, its texture, the species' body mass and the slot's archetype. Snakes have no rig and are never built.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_reptile.py -- \
#       <job dir or model.glb> <out.glb> --species <code> --archetype sprawl|tortoise [--mass kg] [--flip] [--meshy-task <id>] [--debug]
#
# Source: a Meshy text-to-3D job directory (tools/meshy_generate.py: model.glb, and texture_base_color.png after a refine)
# or a GLB. Meshy's convention: the animal faces glTF +z (Blender -y), feet on the floor; --flip turns it round.
#
# The archetypes (pipeline/fauna_models.py REPTILE_BUILD) and the pose Meshy is asked for:
#   sprawl    the crocodilians and lizards: the belly low, the four legs splayed beyond the flanks, the tail straight
#             behind on the ground.
#   tortoise  a rigid shell on four legs standing under its rim, the head and neck out in front.
# Both draw on the reptile part rig (client/src/animalModels.js REPTILE_BODY, the fence lizard's template): BODY 0, LEG_A 1
# (left fore, right hind) and LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at the neck);
# TAIL 3 (inner half, pivot at the vent) and TAIL_TIP 8 (outer half, pivot mid-tail, child of the tail); extras.rig the
# spine landmarks (snout, vent and tail-end z, belly and back height, the bask's drop).
#
# What it does:
#   - imports the mesh (one welded object, loose shards under 2% of the faces dropped), normalises it to 2.0 units nose to
#     tail along y, feet on z = 0, centred in x (so the thresholds below are fractions of the length), and voxel-remeshes
#     it closed (Meshy's meshes are not manifold) at a voxel giving about 35,000 faces, 1/330 to 1/170 of the length (a
#     lizard's toes survive at 1/250; a tortoise's dome would take 180,000 faces at that);
#   - the trunk's profile per slice of 1% of the length: the midline's belly and back heights, and the trunk's half-width
#     from the upper 40% of the section (a sprawler's legs and feet are low), the least over five slices (an elbow raised
#     to the shoulder widens a slice or two, never five);
#   - the feet: the vertices within 0.6% of the length of the floor, away from the midline (a sprawler's beyond 0.75 of
#     the trunk's half-width; a tortoise's off the midline by 1.5%), a sprawler's not in the rear third of the length (a
#     tail lying on the floor, curved, is not a foot); grouped by side and fore and hind (the largest gap in y); four quadrants or the
#     build fails;
#   - the legs: sprawl, the pieces beyond the flank (outside 1.1 x the trunk's half-width + 0.5% of the length) or under
#     the belly (2% of the length below the midline's belly) that hold a foot, the pivot the centroid of where the piece
#     meets the trunk (the shoulder and the hip, at the flank); tortoise, the pieces below a cut 2% of the length under
#     the plastron (the midline's belly between the feet) that stand on the floor, the pivot at the cut (the quadruped
#     build's rule); one quadrant per piece, each 0.2-12% of the vertices, or the build fails;
#   - the tail (sprawl): behind a cut 1.5% of the length behind the hip pivots, the piece holding the farthest point and
#     no leg, traced along its axis by edge distance (TAIL inner half, TAIL_TIP outer half); at least 15% of the length or
#     the build fails. A tortoise's tail is a stub under the shell and stays body;
#   - the head: ahead of the neck. Scanning back from the snout over the upper section's width, the head's widest is the
#     first local maximum at least 0.6 of the width at the shoulders, and the neck the narrowest point of the valley
#     behind it (until the width passes the head's again, or the shoulders); the pivot on the midline at the section's
#     mid-height (a tortoise's in the neck's lower part, under the rim); HEAD 1-35% of the vertices or the build fails;
#   - scales by the body mass (the trait card's mass_kg: for reptiles the amniote life-history database, Myhrvold et al.
#     2015): the closed surface's volume at RHO 1,000 kg/m3 (reptiles are close to water's density: a crocodile floats
#     with its lungs full and sinks with them emptied); the origin on the floor between the fore and hind pivots;
#   - colour: as build_quadruped: each source face reads the texture (the PNG's sRGB decoded to linear), the colours are
#     clustered into the skin's own palette (k-means, 10), and each face of each tier takes the commonest palette colour
#     under it (a vote, nearer source faces counting more); no texture: the vertex colours, else a neutral olive-brown;
#   - decimates (collapse, X symmetry) to lod0 = 1,200 + 800 log10(mass / 0.1 kg), 1,000-5,000, times 1-1.5 by how
#     patterned the skin is (the mean lightness step between neighbouring source faces, 0.05-0.09); lod1 0.36 and lod2
#     0.1 of it (at least 120); the bird build's rule.
# The gates (SystemExit, so pipeline/fauna_models.py counts a failed attempt): a mesh wider than long (not side-on); not
# four feet in four quadrants; a leg piece holding two feet, too small or too large; fore pivots not ahead of the hind;
# the left and right pivots apart in y by more than 12% of the length (a walking pose); no tail on a sprawler; a head
# part too large or too small.
import bpy, bmesh, sys, os, math, json
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
SPECIES = opt('--species'); FLIP = '--flip' in argv
ARCH = opt('--archetype', 'sprawl')
ARCH = {'crocodilian': 'sprawl', 'monitor lizard': 'sprawl', 'basking lizard': 'sprawl', 'chameleon': 'sprawl',
        'turtle': 'tortoise'}.get(ARCH, ARCH)
if ARCH not in ('sprawl', 'tortoise'): ARCH = 'sprawl'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOB = SRC if os.path.isdir(SRC) else os.path.dirname(SRC)
GLB = os.path.join(SRC, 'model.glb') if os.path.isdir(SRC) else SRC
TEX = os.path.join(JOB, 'texture_base_color.png')
job = {}
try: job = json.load(open(os.path.join(JOB, 'job.json')))
except (OSError, ValueError): pass
TASK = opt('--meshy-task') or job.get('task_id') or job.get('id') or os.path.basename(JOB.rstrip('/'))
traits = {}
for d in (('traits',), ()):
    try: traits = json.load(open(os.path.join(ROOT, 'library', 'animals', *d, f'{SPECIES}.json'))); break
    except (OSError, ValueError, TypeError): pass
MASS = float(opt('--mass') or traits.get('mass_kg') or 0) or None
if not MASS: raise SystemExit(f'{SPECIES}: no body mass (trait card mass_kg, or --mass)')
RHO = float(opt('--rho') or 1000.0)
BODY, LEG_A, LEG_B, TAIL, HEAD, TAIL_TIP = 0, 1, 2, 3, 6, 8
smooth = A.smooth
def fail(msg): raise SystemExit(f'{SPECIES}: {msg}')

ob = A.import_glb_mesh(GLB)
me = ob.data; V = me.vertices
if FLIP:
    for v in V: v.co.x, v.co.y = -v.co.x, -v.co.y
y0, y1 = min(v.co.y for v in V), max(v.co.y for v in V)
x0, x1 = min(v.co.x for v in V), max(v.co.x for v in V)
if x1 - x0 > 1.2 * (y1 - y0): fail('the mesh is wider than long: not side-on along y (Meshy faces glTF +z)')
k0 = 2.0 / (y1 - y0); z0 = min(v.co.z for v in V); xc = (x0 + x1) / 2
for v in V: v.co = Vector(((v.co.x - xc) * k0, (v.co.y - y0) * k0 - 1.0, (v.co.z - z0) * k0))
me.update()

# ---- source colour per face (build_quadruped's sampling) ----
img = bpy.data.images.load(TEX) if os.path.exists(TEX) else next((im for im in bpy.data.images if im.size[0] > 0), None)
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
if img is not None and me.uv_layers:
    W_, H_ = img.size
    import array
    buf = array.array('f', [0.0]) * (W_ * H_ * 4); img.pixels.foreach_get(buf); px = buf
    uv = me.uv_layers.active.data
    def tex(u, v):
        i = min(W_ - 1, max(0, int((u % 1.0) * W_))); j = min(H_ - 1, max(0, int((v % 1.0) * H_))); o = (j * W_ + i) * 4
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
        cs = [ca.data[l].color for l in p.loop_indices] if ca.domain == 'CORNER' else [ca.data[i].color for i in p.vertices]
        cols.append(tuple(sum(c[k] for c in cs) / len(cs) for k in range(3)))
    COLOR_SRC = 'vertex colours'
else:
    cols = [A.srgb2lin(0x6b6448)] * len(me.polygons); COLOR_SRC = 'none (neutral olive-brown)'
CENTRES = [p.center.copy() for p in me.polygons]
print('INFO colour from', COLOR_SRC, 'source faces', len(cols))

AREA = sum(p.area for p in me.polygons)
me.remesh_voxel_size = min(0.012, max(0.006, math.sqrt(AREA / 35000))); me.use_remesh_preserve_volume = True
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.voxel_remesh()
me = ob.data; V = me.vertices; NV = len(V)
print('INFO archetype', ARCH, 'voxel %.4f' % me.remesh_voxel_size, 'remeshed', len(me.polygons), 'faces', NV, 'vertices')
adj = A.adjacency(me)
CO = np.array([v.co[:] for v in V])
X, Y, Z = CO[:, 0], CO[:, 1], CO[:, 2]

# ---- the trunk's profile ----
BIN = 0.02
NBIN = int(2.0 / BIN) + 1
BI = np.clip(((Y + 1.0) / BIN).astype(int), 0, NBIN - 1)
prof = {}
for k in range(NBIN):
    m = BI == k
    if m.sum() < 4: continue
    mid = m & (np.abs(X) < 0.03)
    if mid.sum() < 2: continue
    zb, zt = float(Z[mid].min()), float(Z[mid].max())
    up = m & (Z > zb + 0.6 * (zt - zb))
    prof[k] = [float(np.abs(X[up]).max()) if up.any() else 0.01, zb, zt]
KS = sorted(prof)
if '--debug' in argv: print('DEBUG profile (y, w_up, zb, zt):', [(round(-1 + k * BIN, 2), *[round(x, 3) for x in prof[k]]) for k in KS])
Wk = {k: min(prof[j][0] for j in range(k - 2, k + 3) if j in prof) for k in KS}
def key(y):
    k = int(min(NBIN - 1, max(0, (y + 1.0) / BIN)))
    return min(KS, key=lambda j: abs(j - k)) if k not in prof else k
def W(y): return Wk[key(y)]
def ZB(y): return prof[key(y)][1]
def ZT(y): return prof[key(y)][2]
_wk = np.array([Wk[key(-1.0 + (k + 0.5) * BIN)] for k in range(NBIN)]); WV = _wk[BI]
_zb = np.array([prof[key(-1.0 + (k + 0.5) * BIN)][1] for k in range(NBIN)]); ZBV = _zb[BI]

# ---- feet ----
FLOOR, LOW = 0.012, 0.03
if ARCH == 'sprawl': off = np.abs(X) > np.maximum(0.03, 0.75 * WV)
else: off = np.abs(X) > 0.03
rear = (Y > 1.0 - 2.0 / 3.0) if ARCH == 'sprawl' else np.zeros(NV, bool)   # a sprawler's rear third (y from -1 at the snout to +1)
lowset = np.nonzero((Z < LOW) & off & ~rear)[0].tolist()
pieces = [c for c in A.components(adj, lowset) if any(Z[i] < FLOOR for i in c)]
if not pieces: fail('no feet on the floor away from the midline')
cy = sorted((float(np.mean([Y[i] for i in c if Z[i] < FLOOR])), j) for j, c in enumerate(pieces))
ys = [c[0] for c in cy]
gap, ymid = 0.0, None
for a, b in zip(ys, ys[1:]):
    if b - a > gap: gap, ymid = b - a, (a + b) / 2
if ymid is None: fail(f'one foot piece only ({len(pieces)}): not four feet on the floor')
feet = {}
for yv, j in cy:
    c = pieces[j]; fl = [i for i in c if Z[i] < FLOOR]
    left = float(np.mean([X[i] for i in fl])) > 0
    feet.setdefault((yv < ymid, left), []).extend(c)
print('INFO foot pieces (y, x, n):', [(round(float(np.mean([Y[i] for i in pieces[j] if Z[i] < FLOOR])), 3), round(float(np.mean([X[i] for i in pieces[j] if Z[i] < FLOOR])), 3), len(pieces[j])) for _, j in cy])
if len(feet) < 4: fail(f'feet in {len(feet)} quadrants ({sorted(("F" if k[0] else "H") + ("L" if k[1] else "R") for k in feet)}), not 4 (not standing on four splayed feet?)')
print('INFO feet pieces', len(pieces), 'fore/hind gap %.3f at y %.3f' % (gap, ymid))

# ---- legs ----
foot_q = {i: q for q, vs in feet.items() for i in vs}
if ARCH == 'sprawl':
    limb = (np.abs(X) > 1.1 * WV + 0.01) | (Z < ZBV - 0.04)
    limbset = set(np.nonzero(limb)[0].tolist()) | set(foot_q)
    comps = A.components(adj, limbset)
else:
    yff = np.mean([Y[i] for q, vs in feet.items() if q[0] for i in vs]); yfh = np.mean([Y[i] for q, vs in feet.items() if not q[0] for i in vs])
    bz = [ZB(yff + (yfh - yff) * t) for t in (0.3, 0.4, 0.5, 0.6, 0.7)]
    ZCUT = float(np.median(bz)) - 0.04
    if ZCUT < 0.03: fail(f'the plastron is at the floor (cut z {ZCUT:.3f}): the legs are not under the shell')
    comps = [c for c in A.components(adj, np.nonzero(Z < ZCUT)[0].tolist()) if any(Z[i] < FLOOR for i in c)]
    print('INFO tortoise leg cut z %.3f' % ZCUT)
legs, LEGV = {}, set()
for c in comps:
    qs = {foot_q[i] for i in c if i in foot_q}
    if not qs: continue
    if len(qs) > 1: fail(f'a leg piece holds {len(qs)} feet ({sorted(("F" if q[0] else "H") + ("L" if q[1] else "R") for q in qs)}): the legs run together (the belly or a leg lying on the floor?)')
    q = qs.pop()
    if q in legs: legs[q] = legs[q] + c
    else: legs[q] = c
for q in [(True, True), (True, False), (False, True), (False, False)]:
    if q not in legs: fail(f'no leg for the {"fore" if q[0] else "hind"} {"left" if q[1] else "right"} foot')
    n = len(legs[q])
    if not (0.002 * NV <= n <= 0.12 * NV): fail(f'the {"fore" if q[0] else "hind"} {"left" if q[1] else "right"} leg is {n / NV:.1%} of the mesh (0.2-12%): not a leg')
    LEGV.update(legs[q])
leg_of = {i: q for q, vs in legs.items() for i in vs}
pivots = {}
for q, vs in legs.items():
    S_ = set(vs)
    if ARCH == 'sprawl':
        ring = [V[i].co for i in vs if any(u not in S_ for u in adj[i]) and Z[i] > FLOOR * 2]
    else:
        ring = [V[i].co for i in vs if Z[i] > ZCUT - 0.03]
    if not ring: ring = [V[i].co for i in vs]
    c = sum(ring, Vector()) / len(ring)
    pivots[q] = Vector((c.x, c.y, ZCUT if ARCH == 'tortoise' else c.z))
P = pivots
if not (min(P[(True, True)].y, P[(True, False)].y) < max(P[(False, True)].y, P[(False, False)].y)): fail('the fore pivots are not ahead of the hind')
for fore in (True, False):
    if abs(P[(fore, True)].y - P[(fore, False)].y) > 0.24: fail(f'the {"fore" if fore else "hind"} pivots are {abs(P[(fore, True)].y - P[(fore, False)].y) / 2:.0%} of the length apart: a walking pose')
y_sh = (P[(True, True)].y + P[(True, False)].y) / 2; y_hip = (P[(False, True)].y + P[(False, False)].y) / 2
print('INFO legs', {('F' if q[0] else 'H') + ('L' if q[1] else 'R'): (len(vs), [round(x, 3) for x in P[q]]) for q, vs in legs.items()})

# ---- tail (sprawl) ----
tail, tailset, TA, tfrac = [], set(), [], {}
far = int(np.argmax(Y))
if ARCH == 'sprawl':
    yc = max(P[(False, True)].y, P[(False, False)].y) + 0.03
    cand = [i for i in np.nonzero(Y > yc)[0].tolist() if i not in LEGV]
    tc = next((c for c in A.components(adj, cand) if far in c), [])
    if tc:
        cs = set(tc)
        roots = [i for i in tc if any(Y[u] <= yc for u in adj[i])]
        if roots:
            TA, tfrac = A.tube_axis(me, adj, tc, roots)
            tail, tailset = tc, cs
    tl = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1)) if len(TA) > 1 else 0.0
    if tl < 0.3: fail(f'no tail behind the hips ({tl / 2:.0%} of the length; a sprawler has one)')
    VENT_Y = yc
else:
    VENT_Y = max(P[(False, True)].y, P[(False, False)].y)
print('INFO tail', '%d vertices from y %.3f' % (len(tail), VENT_Y) if tail else 'none (a tortoise: the stub stays body)')

# ---- head ----
nose = V[int(np.argmin(Y))].co.copy()
# the neck: scanning back from the snout over the upper section's width (three slices averaged), the head's widest is
# the first local maximum at least 0.6 of the width at the shoulders (the snout's ripples are narrower), and the neck the
# narrowest point of the valley behind it, until the width passes the head's again or the shoulders come: a lizard's
# and a crocodile's skull is wider than its neck, a tortoise's head wider than the neck it holds out of the shell
yk = lambda k: -1.0 + (k + 0.5) * BIN
ws = {k: float(np.mean([prof[j][0] for j in (k - 1, k, k + 1) if j in prof])) for k in KS}
end = y_sh - 0.03
run = [k for k in KS if nose.y <= yk(k) < end]
w_sh = ws[key(y_sh)]
peak = next((k for a, k in enumerate(run[:-1]) if ws[k] >= 0.6 * w_sh and ws[k] >= ws[run[a + 1]]), None)
neck_y = nose.y + 0.6 * (end - nose.y)
if peak is not None:
    best = None
    for k in run[run.index(peak) + 1:]:
        if ws[k] > ws[peak]: break
        if best is None or ws[k] < ws[best]: best = k
    if best is not None: neck_y = yk(best)
nm = (np.abs(Y - neck_y) < BIN) & (np.abs(X) < 0.03)
if ARCH == 'tortoise':   # the neck under the shell's front rim: the lowest run of midline points there
    zs = sorted(Z[nm].tolist()); NBz = (zs[0] + zs[len(zs) // 3]) / 2 if zs else ZT(neck_y) / 2
else:
    NBz = (float(Z[nm].min()) + float(Z[nm].max())) / 2 if nm.any() else (ZB(neck_y) + ZT(neck_y)) / 2
NB = Vector((0.0, float(neck_y), NBz))
headv = [V[i].co for i in np.nonzero(Y < nose.y + 0.08)[0].tolist()]
NDIR = (sum(headv, Vector()) / len(headv) - NB).normalized()
nhead = sum(1 for i in range(NV) if i not in LEGV and (V[i].co - NB).dot(NDIR) > 0)
if not (0.01 * NV <= nhead <= 0.35 * NV): fail(f'the head part is {nhead / NV:.0%} of the mesh (1-35%): no neck found')
print('INFO neck y %.3f, head %.1f%% of the mesh, shoulders y %.3f, hips y %.3f' % (neck_y, 100 * nhead / NV, y_sh, y_hip))

# ---- size by mass ----
_bm = bmesh.new(); _bm.from_mesh(me); VOL = abs(_bm.calc_volume()); _bm.free()
S = (MASS / RHO / VOL) ** (1 / 3)
yorg = (y_sh + y_hip) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
me.update()
TA = [sc(p) for p in TA]; NB = sc(NB); nose = sc(nose)
pivots = {q: sc(p) for q, p in pivots.items()}
VY = (VENT_Y - yorg) * S; Y_SH = (y_sh - yorg) * S; Y_HIP = (y_hip - yorg) * S
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1)) if TA else 0.0
TIP = None
if TA:
    acc, half = 0.0, tail_len / 2; TIP = TA[-1]
    for i in range(len(TA) - 1):
        L = (TA[i + 1] - TA[i]).length
        if acc + L >= half: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((half - acc) / L); break
        acc += L
length = 2.0 * S
trunk = [V[i].co for i in range(NV) if Y_SH < V[i].co.y < Y_HIP and i not in LEGV]
belly = min(p.z for p in trunk) if trunk else 0.0
back = max(p.z for p in trunk) if trunk else 0.0
tail_end_y = max(v.co.y for v in V)
print('LANDMARKS length', round(length, 3), 'm, scale', round(S, 4), 'volume %.5f units' % VOL, 'mass', MASS, 'kg; svl', round(VY - nose.y, 3),
      'tail', round(tail_len, 3), 'belly', round(belly, 4), 'back', round(back, 4), 'neck', [round(x, 3) for x in NB],
      'pivots', {('F' if q[0] else 'H') + ('L' if q[1] else 'R'): [round(x, 3) for x in p] for q, p in pivots.items()})

# ---- per-vertex part on the full mesh (decimation keeps vertex groups) ----
LW = 0.02 * S   # a leg's weight ramps in over 2% of the length from its pivot ring
def rig_full(i):
    p = V[i].co
    if i in tailset:
        t = tfrac.get(i, 0.0)
        if t >= 0.5: return dict(part=TAIL_TIP, partw=smooth(0.5, 0.62, t), pivot=TIP)
        return dict(part=TAIL, partw=smooth(0.0, 0.1, t), pivot=TA[0])
    q = leg_of.get(i)
    if q is not None:
        pv = pivots[q]
        return dict(part=LEG_A if q[0] == q[1] else LEG_B, partw=smooth(0.1 * LW, LW, (p - pv).length), pivot=pv)
    wh = smooth(-0.005 * S, 0.02 * S, (p - NB).dot(NDIR))
    if wh > 0: return dict(part=HEAD, partw=wh, pivot=NB)
    return dict(part=BODY, partw=0.0, pivot=Vector())
RIG = [rig_full(i) for i in range(NV)]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')

# ---- colour: the palette vote ----
kd = KDTree(len(CENTRES))
for i, c in enumerate(CENTRES): kd.insert(sc(c), i)
kd.balance()
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
LUM = (C @ np.array([0.2126, 0.7152, 0.0722]))
steps = []
for i in rng.choice(len(C), min(3000, len(C)), replace=False).tolist():
    for _, j, _d in kd.find_n(sc(CENTRES[i]), 7)[1:]: steps.append(abs(LUM[i] - LUM[j]))
PATTERN = float(np.mean(steps)); PT = min(1.0, max(0.0, (PATTERN - 0.05) / 0.04))
L0 = int(min(5000, max(1000, 1200 + 800 * math.log10(MASS / 0.1))) * (1 + 0.5 * PT))
TIERS = [('lod0', int(opt('--lod0') or L0)), ('lod1', max(120, int(0.36 * L0))), ('lod2', max(120, int(0.1 * L0)))]
print('INFO palette shares', [round(float((lab == k).mean()), 3) for k in range(K)], 'pattern %.4f -> tiers %s' % (PATTERN, TIERS))
def face_color(p):
    c = p.center; rad = max(0.006 * S, math.sqrt(max(p.area, 1e-12)) * 0.75)
    hits = kd.find_range(c, rad)
    if len(hits) < 3: hits = kd.find_n(c, 6)
    votes = {}
    for _, i, d in hits: votes[LAB[i]] = votes.get(LAB[i], 0.0) + 1.0 / (0.001 * S + d)
    return PAL[max(votes, key=votes.get)]

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target, symmetry=True)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=BODY, partw=0.0, pivot=Vector(), blue=0.0); continue
        part = int(pid[1:]); co = v.co
        if part in (LEG_A, LEG_B): piv = pivots[(co.y < (Y_SH + Y_HIP) / 2, co.x > 0)]
        else: piv = {HEAD: NB, TAIL: TA[0] if TA else NB, TAIL_TIP: TIP or NB}[part]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv, blue=0.0)
    t = A.emit(m, face_color, lambda i: R[i], extra_names=('blue',))
    print('INFO tier', name, 'from', n0, 'to', len(m.polygons))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
r4 = lambda p: [round(x, 4) for x in A.to3(p)]
common = traits.get('common') or SPECIES
rig = {'kind': 'reptile', 'archetype': ARCH, 'head': r4(NB), 'fore': r4(pivots[(True, True)]), 'hind': r4(pivots[(False, True)]),
       'legs': {'FL': r4(pivots[(True, True)]), 'FR': r4(pivots[(True, False)]), 'HL': r4(pivots[(False, True)]), 'HR': r4(pivots[(False, False)])},
       'snout_z': round(-nose.y, 4), 'vent_z': round(-VY, 4), 'tail_end_z': round(-tail_end_y, 4),
       'belly_y': round(belly, 4), 'back_y': round(back, 4), 'drop': round(belly * 0.85, 4), 'length_m': round(length, 3)}
if TA: rig['tail'] = r4(TA[0]); rig['tail_tip'] = r4(TIP)
A.write_glb(OUT, tiers, 'wild-earth tools/build_reptile.py (Blender)',
            f'{common} generated with Meshy (meshy.ai), task {TASK}, for Wild Earth; CC BY-SA 4.0; scaled, coloured from its texture, decimated',
            extra_names=('blue',),
            extras={'species': SPECIES, 'archetype': ARCH, 'mass_kg': MASS, 'length_m': round(length, 3), 'size_by': f'mass at {RHO:g} kg/m3',
                    'meshy_task': TASK, 'colour': COLOR_SRC, 'build': 'tools/build_reptile.py', 'rig': rig,
                    'parts': 'reptile template: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at the neck); TAIL 3 (inner half, pivot at the vent), TAIL_TIP 8 (outer half, pivot mid-tail, child of TAIL)'})
