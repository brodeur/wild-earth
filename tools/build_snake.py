# Build a snake's client GLB from any Meshy mesh (world pipeline, phase 1: a tile's own animals, 2026-11-06). The one
# build for every pipeline-modelled snake, as tools/build_reptile.py is for the reptiles with legs: nothing in it is per
# species. It reads everything from the mesh, its texture and the species' body mass.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_snake.py -- \
#       <job dir or model.glb> <out.glb> --species <code> [--mass kg] [--meshy-task <id>] [--debug]
#
# Source: a Meshy text-to-3D job directory (tools/meshy_generate.py: model.glb, and texture_base_color.png after a refine)
# or a GLB. Meshy is asked (pipeline/fauna_models.py) for a snake lying on flat ground stretched out or in a gentle S; it
# may still curve it any way it likes in the ground plane: the build finds the body as a tube and straightens it.
#
# The snake template (client/src/animalModels.js SNAKE_BODY, RIG.snake): the body lies straight along glTF +z (the snout
# at +z, the tail tip at -z, the belly on y = 0, the origin at the middle of its length), and each vertex's _PIVOT is the
# point of the centreline it belongs to (x 0, its own z: so z is the vertex's arc parameter along the body). The client
# bends the centreline (a travelling wave, a turn, a coil) and carries each cross-section round with it. HEAD 6 (part)
# ahead of the neck (rigid in the client), BODY 0 the rest. extras.rig: kind 'snake', the snout, neck and tail-end z, the
# length, the largest radius.
#
# What it does:
#   - imports the mesh (one welded object, loose shards under 2% of the faces dropped: the tongue), normalises its larger
#     horizontal extent to 2.0 units, the lowest point on z = 0; voxel-remeshes it closed at about 40,000 faces (Meshy's
#     meshes are not manifold), keeping the largest piece;
#   - the ends: the two vertices farthest apart along the surface (edge distance, Dijkstra: from any vertex the farthest
#     one, from that the farthest again), the snout and the tail tip;
#   - the centreline: the vertices binned by their edge distance from one end, the centroid of each bin, smoothed and
#     resampled; then three times: every vertex projected onto the line, onto the nearest of the line points whose arc
#     is within a window of its guess (its edge distance at first, then its last arc; the window three median radii, so
#     a part of the body lying close to another, the inside of a tight bend, is never taken for it), the centroids of
#     slices 0.6 of a radius thick along the projected arcs the new line (cross-sections square to the axis; thinner
#     slices are cut obliquely by a bend and zigzag), smoothed;
#   - which end is the head: the body's radius (each vertex's distance from its line point, the median per 1% of the
#     length) at 2-8% from each end; the thicker end is the head, the tapering one the tail;
#   - straightens it: a rotation-minimising frame along the line (up the world's up at the middle of the body, carried
#     both ways), each vertex's offset from its line point read in that frame (left, up, along) and laid out again along
#     a straight line, each cross-section's lowest point on the floor (a raised head is laid down: the client poses it);
#   - the neck: the narrowest section behind the head's widest within the front 12% of the length (the head's widest in
#     the front 1-7%), a dip of 5% at least; else 4.5% of the length behind the snout;
#   - scales by the body mass (the trait card's mass_kg; reptiles: the amniote life-history database): the closed
#     surface's volume (before the straightening) at RHO 1,000 kg/m3 (as build_reptile.py). The card's length (an
#     allometric guess, pipeline/fauna.py) is printed beside the result;
#   - colour: as build_reptile.py: each source face reads the texture (sRGB decoded to linear), the colours clustered into
#     the skin's palette (k-means, 10), each face of each tier the commonest palette colour under it (the source faces
#     carried through the same straightening); no texture: the vertex colours, else a neutral olive-brown;
#   - decimates (collapse, X symmetry) by the reptile build's rule (lod0 1,200 + 800 log10(mass / 0.1 kg), 1,000-5,000,
#     times 1-1.5 by how patterned the skin is; lod1 0.36, lod2 0.1 of it, at least 120).
# The gates (SystemExit, so pipeline/fauna_models.py counts a failed attempt, before the refine is paid when it builds the
# preview first): a mesh taller than 0.35 of its extent (not lying on the ground); the body in pieces (the largest under
# 85% of the remeshed vertices); a line that jumps (a bin's centroid more than 6 median steps from the last: the body
# touches itself, a coil fused by the remesh) or whose length disagrees with the ends' edge distance (0.8-1.2); no taper
# (the thinner end over 0.85 of the thicker); not slender (length under 10 times the largest diameter); a body that
# stands up (the line within 25 degrees of vertical at its middle); something besides the body (a cross-section more than
# 2.6 times the median radius over 3% of the length: a base, a rock, a coil); the straightening tearing the mesh (over
# 0.2% of the edges stretched 3 times).
import bpy, bmesh, sys, os, math, json, heapq
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
SPECIES = opt('--species'); DEBUG = '--debug' in argv
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
CARD_LEN = (traits.get('size') or {}).get('length_m')
BODY, HEAD = 0, 6
def fail(msg): raise SystemExit(f'{SPECIES}: {msg}')

ob = A.import_glb_mesh(GLB)
me = ob.data; V = me.vertices
CO = np.array([v.co[:] for v in V])
ex, ey, ez = np.ptp(CO, axis=0)
EXT = max(ex, ey)
if ez > 0.35 * EXT: fail(f'the mesh is {ez / EXT:.0%} as tall as it is long: not a snake lying on the ground')
k0 = 2.0 / EXT; c0 = np.array([(CO[:, 0].min() + CO[:, 0].max()) / 2, (CO[:, 1].min() + CO[:, 1].max()) / 2, CO[:, 2].min()])
for v in V: v.co = Vector(((v.co.x - c0[0]) * k0, (v.co.y - c0[1]) * k0, (v.co.z - c0[2]) * k0))
me.update()

# ---- source colour per face (build_reptile's sampling) ----
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
CENTRES = np.array([p.center[:] for p in me.polygons])
print('INFO colour from', COLOR_SRC, 'source faces', len(cols))

# ---- remesh closed, the largest piece ----
AREA = sum(p.area for p in me.polygons)
me.remesh_voxel_size = min(0.012, max(0.0025, math.sqrt(AREA / 40000))); me.use_remesh_preserve_volume = True
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.voxel_remesh()
me = ob.data
adj = A.adjacency(me)
comps = A.components(adj, range(len(me.vertices)))
if len(comps[0]) < 0.85 * len(me.vertices): fail(f'the body is in pieces (the largest {len(comps[0]) / len(me.vertices):.0%} of the mesh)')
if len(comps) > 1:
    keep = set(comps[0]); bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS'); bm.to_mesh(me); bm.free(); me.update()
    adj = A.adjacency(me)
V = me.vertices; NV = len(V)
P0 = np.array([v.co[:] for v in V])
_bm = bmesh.new(); _bm.from_mesh(me); VOL = abs(_bm.calc_volume()); _bm.free()   # the closed body's volume, before the straightening
print('INFO voxel %.4f' % me.remesh_voxel_size, 'remeshed', len(me.polygons), 'faces', NV, 'vertices')
EDGES = np.array([e.vertices[:] for e in me.edges]); ELEN = np.linalg.norm(P0[EDGES[:, 0]] - P0[EDGES[:, 1]], axis=1)
nbr = [[] for _ in range(NV)]
for (a, b), l in zip(EDGES.tolist(), ELEN.tolist()): nbr[a].append((b, l)); nbr[b].append((a, l))

def dijkstra(src):
    dist = np.full(NV, np.inf); dist[src] = 0.0; h = [(0.0, src)]
    while h:
        d, v = heapq.heappop(h)
        if d > dist[v]: continue
        for u, l in nbr[v]:
            nd = d + l
            if nd < dist[u]: dist[u] = nd; heapq.heappush(h, (nd, u))
    return dist

# ---- the ends ----
EA = int(np.argmax(dijkstra(0))); DA = dijkstra(EA); EB = int(np.argmax(DA)); LGEO = float(DA[EB])
print('INFO ends', [round(x, 3) for x in P0[EA]], [round(x, 3) for x in P0[EB]], 'edge distance %.3f' % LGEO)

# ---- the centreline ----
def resample(pts, n):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, k]) for k in range(3)], axis=1), t
def smooth_line(pts, w=2):
    out = pts.copy()
    for i in range(w, len(pts) - w): out[i] = pts[i - w:i + w + 1].mean(0)
    return out
def bin_centroids(key, kmax, nb):
    b = np.clip((key / kmax * nb).astype(int), 0, nb - 1)
    cen = [P0[b == k].mean(0) for k in range(nb) if (b == k).any()]
    return np.array(cen)
NB = 160
cen = bin_centroids(DA, LGEO, NB)
st = np.linalg.norm(np.diff(cen, axis=0), axis=1)
if st.max() > 6 * np.median(st): fail(f'the centreline jumps ({st.max() / np.median(st):.1f} median steps): the body touches itself (a coil?)')
M = 400
LINE, ARC = resample(smooth_line(cen), M)

def project(P, g, W):
    """(arc s, foot point) of points P on LINE: the nearest line point among those whose arc is within W of the point's
    guess g (so a part of the body lying close to another, the inside of a tight bend, is never taken for it); then on
    the two segments round it (the end segments run on: the caps)."""
    step = ARC[1] - ARC[0]; K = int(math.ceil(W / step)); off = np.arange(-K, K + 1)
    S = np.empty(len(P)); F = np.empty((len(P), 3))
    for c0 in range(0, len(P), 4000):
        p = P[c0:c0 + 4000]; gi = np.rint(g[c0:c0 + 4000] / step).astype(int)
        idx = np.clip(gi[:, None] + off[None, :], 0, M - 1)
        d2 = ((LINE[idx] - p[:, None, :]) ** 2).sum(-1)
        i = idx[np.arange(len(p)), d2.argmin(1)]
        best_d = np.full(len(p), np.inf); bs = np.zeros(len(p)); bq = np.zeros((len(p), 3))
        for dj in (-1, 0):
            j = np.clip(i + dj, 0, M - 2)
            a, b = LINE[j], LINE[j + 1]; ab = b - a
            t = ((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12)
            t = np.minimum(np.where(j == M - 2, np.inf, 1.0), np.maximum(np.where(j == 0, -np.inf, 0.0), t))
            q = a + ab * t[:, None]; dd = np.linalg.norm(p - q, axis=1)
            better = dd < best_d
            best_d[better] = dd[better]; bs[better] = (ARC[j] + (ARC[j + 1] - ARC[j]) * t)[better]; bq[better] = q[better]
        S[c0:c0 + 4000] = bs; F[c0:c0 + 4000] = bq
    return S, F
G = DA * (ARC[-1] / LGEO)   # each vertex's edge distance as an arc guess
W = 0.12 * ARC[-1]          # the first window, before the body's radius is known
for it in range(3):
    S, F = project(P0, G, W)
    rmed = float(np.median(np.linalg.norm(P0 - F, axis=1)))
    W = 3.0 * rmed   # three median radii: the guess's error round a bend
    # the centroids of slices 0.6 of a radius thick (thinner ones are cut obliquely by a bend and zigzag), smoothed
    nb = int(min(200, max(40, ARC[-1] / (0.6 * rmed)))); b = np.clip((S / ARC[-1] * nb).astype(int), 0, nb - 1)
    cen = np.array([P0[b == k].mean(0) for k in range(nb) if (b == k).any()])
    # keep the end caps' reach: the line runs on to the extreme points of the ends
    cen = np.vstack([P0[EA], cen, P0[EB]])
    LINE, ARC = resample(smooth_line(cen, 2), M)
    G = np.clip(S, 0, None) * (ARC[-1] / max(S.max(), 1e-9))
S, F = project(P0, G, W)
L = float(ARC[-1])
if not (0.8 <= L / LGEO <= 1.2): fail(f'the centreline ({L:.3f}) and the ends\' edge distance ({LGEO:.3f}) disagree: not one tube')
R = np.linalg.norm(P0 - F, axis=1)
NP = 100
pb = np.clip((S / L * NP).astype(int), 0, NP - 1)
prof = np.array([np.median(R[pb == k]) if (pb == k).any() else np.nan for k in range(NP)])
for k in range(NP):
    if np.isnan(prof[k]): prof[k] = np.nanmean(prof[max(0, k - 2):k + 3])
rh, rt = float(np.mean(prof[2:8])), float(np.mean(prof[92:98]))
if DEBUG: print('DEBUG profile', [round(x, 4) for x in prof])
REV = rt > rh
if REV:
    S = L - S; LINE = LINE[::-1].copy(); ARC = L - ARC[::-1]; prof = prof[::-1].copy(); pb = NP - 1 - pb; rh, rt = rt, rh
taper = rt / rh
print('INFO length %.3f units (edge distance %.3f), radius head %.4f tail %.4f (taper %.2f), max %.4f, head at %s' % (L, LGEO, rh, rt, taper, np.nanmax(prof), 'the far end' if REV else 'the first end'))
if taper > 0.85: fail(f'no taper (the tail end {taper:.0%} of the head end\'s radius): head and tail not told apart')
RMAX = float(np.nanmax(np.convolve(prof, np.ones(3) / 3, mode='same')[1:-1]))
if L / (2 * RMAX) < 10: fail(f'not slender: {L / (2 * RMAX):.1f} diameters long (a snake is 10 or more)')
RMED = float(np.median(prof))
fat = prof > 2.6 * RMED
if fat.mean() > 0.03: fail(f'something besides the body: {fat.mean():.0%} of the length is over 2.6 times the median radius (a base, a rock, a coil)')

# ---- the frame, and the straightening ----
T = np.array([LINE[min(M - 1, i + 4)] - LINE[max(0, i - 4)] for i in range(M)])   # over 2% of the length
T /= np.linalg.norm(T, axis=1)[:, None]
mid = M // 2
if abs(T[mid][2]) > math.cos(math.radians(25)): fail('the body stands up at its middle (the line near vertical)')
U = np.zeros_like(LINE)
def perp(u, t): u = u - np.dot(u, t) * t; return u / np.linalg.norm(u)
U[mid] = perp(np.array([0.0, 0.0, 1.0]), T[mid])
for i in range(mid + 1, M): U[i] = perp(U[i - 1], T[i])
for i in range(mid - 1, -1, -1): U[i] = perp(U[i + 1], T[i])
LEFT = np.cross(U, -T)   # the animal's left: up x forward (forward is -T: T runs from the snout to the tail)
li = np.clip(np.rint(S / L * (M - 1)).astype(int), 0, M - 1)   # the frame nearest each vertex's foot (ARC is uniform)
REL = P0 - F
la, lu, lt = (REL * LEFT[li]).sum(1), (REL * U[li]).sum(1), (REL * T[li]).sum(1)
# each cross-section's lowest point on the floor
lowb = np.array([lu[pb == k].min() if (pb == k).any() else np.nan for k in range(NP)])
for k in range(NP):
    if np.isnan(lowb[k]): lowb[k] = np.nanmean(lowb[max(0, k - 2):k + 3])
lowb = np.array([np.median(lowb[max(0, k - 2):k + 3]) for k in range(NP)])
HB = -lowb   # the centreline's height over the floor per 1% of the length
def hb_at(s): return np.interp(s, (np.arange(NP) + 0.5) / NP * L, HB)
NEW = np.stack([la, S + lt - L / 2, lu + hb_at(S)], axis=1)
nl = np.linalg.norm(NEW[EDGES[:, 0]] - NEW[EDGES[:, 1]], axis=1)
tear = float((nl > 3 * ELEN + 1e-6).mean())
if tear > 0.002: fail(f'the straightening tears the mesh ({tear:.2%} of the edges stretched 3 times)')
for i, v in enumerate(V): v.co = Vector(NEW[i])
me.update()
print('INFO straightened: tear %.4f%%, height range %.4f-%.4f' % (100 * tear, NEW[:, 2].min(), NEW[:, 2].max()))

# the source faces carried through the same straightening (by their nearest remeshed vertex's frame)
kd0 = KDTree(NV)
for i, p in enumerate(P0): kd0.insert(Vector(p), i)
kd0.balance()
CNEW = np.empty_like(CENTRES)
for n, c in enumerate(CENTRES):
    _, i, _ = kd0.find(Vector(c)); d = c - P0[i]; j = li[i]
    CNEW[n] = NEW[i] + np.array([np.dot(d, LEFT[j]), np.dot(d, T[j]), np.dot(d, U[j])])

# ---- the neck ----
sm = np.convolve(prof, np.ones(3) / 3, mode='same'); sm[0], sm[-1] = prof[0], prof[-1]
pk = 1 + int(np.argmax(sm[1:7]))
nk = pk + 1 + int(np.argmin(sm[pk + 1:12]))
NECK = (nk + 0.5) / NP * L if sm[nk] < 0.95 * sm[pk] else 0.045 * L
print('INFO head widest at %.1f%%, neck at %.1f%% of the length (%s)' % ((pk + 0.5), 100 * NECK / L, 'a dip' if sm[nk] < 0.95 * sm[pk] else 'no dip: the default'))

# ---- size by mass ----
SC = (MASS / RHO / VOL) ** (1 / 3)
for v in V: v.co = v.co * SC
me.update()
CNEW *= SC
Lm = L * SC; NECKm = NECK * SC
ys = np.array([v.co.y for v in V])
snout_y, tail_y = float(ys.min()), float(ys.max())
length = tail_y - snout_y
back = max(v.co.z for v in V)
print('LANDMARKS length', round(length, 3), 'm (centreline %.3f), scale %.4f, volume %.5f units, mass %g kg; radius max %.4f m, neck %.3f m behind the snout'
      % (Lm, SC, VOL, MASS, RMAX * SC, NECKm), '; trait card length (an allometric guess)', CARD_LEN, '(ratio %.2f)' % (length / CARD_LEN) if CARD_LEN else '')

# ---- the rig per vertex (pivot: its centreline point) ----
def hc_m(s_m): return float(hb_at(s_m / SC)) * SC
def rig_at(co):
    s_m = co.y + Lm / 2
    piv = Vector((0.0, co.y, hc_m(min(max(s_m, 0.0), Lm))))
    return dict(part=HEAD if s_m < NECKm else BODY, partw=1.0, pivot=piv)

# ---- colour: the palette vote (build_reptile's) ----
kd = KDTree(len(CNEW))
for i, c in enumerate(CNEW): kd.insert(Vector(c), i)
kd.balance()
K = 10
C = np.array(cols, dtype=np.float64) ** (1 / 2.2)
rng = np.random.default_rng(7)
cent = C[rng.choice(len(C), min(K, len(C)), replace=False)]
for _ in range(25):
    lab = np.argmin(((C[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
    for k in range(len(cent)):
        m = lab == k
        cent[k] = C[m].mean(0) if m.any() else C[rng.integers(len(C))]
LAB = lab.tolist(); PAL = [tuple(float(x) for x in (c ** 2.2)) for c in cent]
LUM = (C @ np.array([0.2126, 0.7152, 0.0722]))
steps = []
for i in rng.choice(len(C), min(3000, len(C)), replace=False).tolist():
    for _, j, _d in kd.find_n(Vector(CNEW[i]), 7)[1:]: steps.append(abs(LUM[i] - LUM[j]))
PATTERN = float(np.mean(steps)); PT = min(1.0, max(0.0, (PATTERN - 0.05) / 0.04))
L0 = int(min(5000, max(1000, 1200 + 800 * math.log10(MASS / 0.1))) * (1 + 0.5 * PT))
TIERS = [('lod0', int(opt('--lod0') or L0)), ('lod1', max(120, int(0.36 * L0))), ('lod2', max(120, int(0.1 * L0)))]
print('INFO palette shares', [round(float((lab == k).mean()), 3) for k in range(len(cent))], 'pattern %.4f -> tiers %s' % (PATTERN, TIERS))
def face_color(p):
    c = p.center; rad = max(0.004 * Lm, math.sqrt(max(p.area, 1e-12)) * 0.75)
    hits = kd.find_range(c, rad)
    if len(hits) < 3: hits = kd.find_n(c, 6)
    votes = {}
    for _, i, d in hits: votes[LAB[i]] = votes.get(LAB[i], 0.0) + 1.0 / (0.0005 * Lm + d)
    return PAL[max(votes, key=votes.get)]

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target, symmetry=True)
    m = o.data
    R_ = {v.index: rig_at(v.co) for v in m.vertices}
    t = A.emit(m, face_color, lambda i: R_[i])
    print('INFO tier', name, 'from', n0, 'to', len(m.polygons))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
common = traits.get('common') or SPECIES
rig = {'kind': 'snake', 'archetype': 'snake', 'snout_z': round(-snout_y, 4), 'tail_end_z': round(-tail_y, 4),
       'neck_z': round(-(snout_y + NECKm), 4), 'length_m': round(length, 3), 'radius_m': round(RMAX * SC, 4),
       'belly_y': 0.0, 'back_y': round(back, 4), 'taper': round(taper, 3)}
A.write_glb(OUT, tiers, 'wild-earth tools/build_snake.py (Blender)',
            f'{common} generated with Meshy (meshy.ai), task {TASK}, for Wild Earth; CC BY-SA 4.0; straightened, scaled, coloured from its texture, decimated',
            extras={'species': SPECIES, 'archetype': 'snake', 'mass_kg': MASS, 'length_m': round(length, 3), 'size_by': f'mass at {RHO:g} kg/m3',
                    'card_length_m': CARD_LEN, 'meshy_task': TASK, 'colour': COLOR_SRC, 'build': 'tools/build_snake.py', 'rig': rig,
                    'parts': 'snake template: the body straight along +z (snout +z), each vertex\'s pivot its centreline point (its arc parameter in z); HEAD 6 ahead of the neck, BODY 0'})
