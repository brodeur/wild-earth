# Build client/assets/elk_bull.glb and client/assets/elk_cow.glb, the Roosevelt elk (Cervus canadensis roosevelti) of
# the Olympic rain forest, from two Meshy text-to-3D previews.
#
# Sources: generated with Meshy (meshy.ai), text-to-3D preview, ai_model "latest", triangle remesh to 20,000 faces, run
# by agent (Claude) for Aaron Brodeur on 2026-11-05 UTC, 20 credits each. Both prompts asked for a COW with no antlers;
# both came back as antlered bulls:
#   A, task 01a1ad34-dfa4-7155-942a-b456a4b712a3 (the bull): "A Roosevelt elk cow (Cervus canadensis roosevelti) of the
#     Olympic rain forest, NOT a red deer, NOT a moose, NOT a horse. One adult female with NO antlers, standing still on
#     all four legs, side-on neutral pose, ... a long neck with a short dark mane under the throat, a long face, large
#     upright ears, a short tail. Tan-grey body, dark chocolate brown head, neck and legs, a pale buff rump patch around
#     the tail. No base, no ground. Game-ready." It came back a heavy Roosevelt-type bull with a dark shaggy mane and
#     long six-point beams, the head turned a little to its right.
#   B, task 01a1ad39-d6da-72e2-a426-4eb60ac49b36 (the cow): "A female elk (a cow elk, Cervus canadensis roosevelti),
#     hornless like a deer doe: NO antlers, NO horns, the top of the head smooth and bare between two large upright ears.
#     NOT a bull, NOT a moose, NOT a horse. ..." It came back a lighter, red-deer-like bull with crowned antlers, the
#     whole animal yawed ~30 degrees and the head turned ~40 degrees to its right; its antlers are cut off here.
# Records (full prompts, cost, checksums): library/animals/jobs/cervus_canadensis/<task>/job.json. Paid-plan API output,
# owned by the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA 4.0;
# credit "generated with Meshy (meshy.ai)". The meshes carried no Meshy metadata to keep (Terms 2.4).
#
# Rebuild (Blender 4.1, from the repo root), then skin each and bake its clips:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_elk.py -- \
#       library/animals/jobs/cervus_canadensis/01a1ad34-dfa4-7155-942a-b456a4b712a3/model.glb client/assets/elk_bull.glb --sex bull
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_elk.py -- \
#       library/animals/jobs/cervus_canadensis/01a1ad39-d6da-72e2-a426-4eb60ac49b36/model.glb client/assets/elk_cow.glb --sex cow
#   arch -arm64 .venv/bin/python tools/rig_quadruped.py client/assets/elk_<sex>.glb --wrist 0.45 --hock 0.55
#   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs client/assets/elk_<sex>.glb --tile utm10n_429_5293
# (--wrist / --hock are the rigger's unguligrade defaults, passed because the locomotion tree has no elk row yet.)
#
# What it does: grounds the mesh and turns the whole animal square to the axes (the trunk's long axis, a principal axis
# of a horizontal band through the body: B was yawed 30 degrees, A 6). Finds the antlers from the geometry, one way per
# source: B by lowering a horizontal cut from the top until the two antlers join through the skull (what lay above the
# last cut that kept them apart); A, whose beams leave the head nearly level, by thinness (an inward ray along each vertex
# normal leaves the surface within ~11 cm) high on the animal, connected to the two highest points, plus thin pieces
# rising well above their own foot (a brow tine whose root on the beam is thick); either way plus whatever the set
# encloses or cuts loose. The burrs are the two clusters of the ring where that set meets the skull. Turns the head back
# to the midline about a vertical axis just behind the poll (the median of three bearings: the face's long axis, the
# poll-to-nose line, the burrs' tilt; B 47 degrees, A 40), sliding it sideways so the nose lands on the midline, blended
# over the upper neck and kept off the chest. The bull's antlers are then made 1.2x larger about their burrs (the beams
# ~0.85 m along the curve in the preview; a mature Roosevelt bull's run 1.0-1.3 m), the growth fading in over the first
# 15 cm. The cow's antlers are deleted, the two holes capped (filled and poked), and the skull top relaxed into a bare
# poll (Laplacian steps weighted within ~9 cm of each burr, which pull the pedicle stubs into the skull's curve).
# Finds the parts as tools/build_bear.py: the tail is the stub at the top of the rump; the legs what lies below the belly
# line (the median of the midline's low points between the legs, below any sheath) between the feet, pivots there
# (elbow and stifle); the head and neck what lies ahead of a plane through the withers (where the top line, going
# forward, tops out under the bull's mane or turns steeply up into the cow's neck) and the top of the brisket, kept off
# the chest and the tops of the forelegs; the neck joint low in that plane (the neck's root), so the head and neck dip
# to graze as one. Origin centred between the feet; scales to the withers (bull 1.50 m, cow 1.30 m) and stretches the
# trunk between the leg columns (the legs moved rigidly) toward the brief's head-and-body length (along the top: nose,
# poll, neck base, withers, tail root), at most 1.12x (both previews are short in the body for their height). The cow
# then: the shaggy throat bulge pulled in toward the neck's axis (a short dark throat mane, not the bull's bib), the
# neck 10% slimmer and 10 cm longer, pitched 14 degrees forward about its root (the preview held it bolt upright, a
# llama's carriage) with the head turned back up so the face keeps its angle, and the face 1.15x longer along its line
# (the preview's was ~35 cm poll to nose). Colour by region with faint per-face noise: tan-grey body (the bull paler,
# fall), dark chocolate head and neck, the dark cape to the shoulders and the brisket (the bull's mane darker), the
# belly dark brown graded up the lower flank, dark brown legs from the elbow and stifle down darkening to near-black
# hooves, the large pale buff rump patch round the tail (an oval) with a dark line down its sides, the buff tail, ears
# tan-grey outside with dark rims and paler inside, a black nose pad, a dark eye (the face within 3 cm of the eye point
# nearest an elk's eye in size, each side, lod0 and lod1); the bull's antlers brown at the burr and along the beams,
# polished ivory over the last ~10 cm of every tine (by the distance along the antler from the nearest tip, a tip being
# a local farthest point from the burr). A's right ear is fused to the underside of its beam and stays in the antler
# set: the part hanging below the burrs is coloured as the head. Decimates (collapse) in stages, each with the rest
# frozen: the body (X symmetry) with the head, neck and antlers kept, then the head and neck, then the bull's antlers
# alone (no symmetry: they are not mirror images) to a fixed share, so the beams and main tines survive every tier;
# the stage aims rescaled until the totals land: bull ~3,600 / 1,500 / 450 (antlers ~1,000 / 450 / 145), cow ~3,000 /
# 1,200 / 350 triangles (tools/rig_quadruped.py adds ~5% cutting the leg rings).
# Rig, quadruped template Q: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (the short tail, pivot at its
# root), HEAD 6 (neck, head, ears and the antlers; pivot at the neck's root). No TAIL_TIP. Parent pivots in extras.rig
# (kind, tail, head, fore, hind, length_m, drop), as the bear's; the left burr in extras.antler_burr (the bull; glTF
# axes, the right roughly mirrors it). --debug <prefix> also writes the full mesh after the head turn (antlers in red)
# and with its rig parts coloured, for checking.
import bpy, bmesh, sys, os, math, json, heapq
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
SEX = opt('--sex', 'bull')
if SEX not in ('bull', 'cow'): raise SystemExit('--sex bull|cow')
BULL = SEX == 'bull'
DEBUG = opt('--debug', None)          # a path prefix: also write the full-resolution mesh with its region colours
TASK = os.path.basename(os.path.dirname(os.path.abspath(SRC)))
WITHERS = 1.50 if BULL else 1.30      # m at the withers (Roosevelt elk: bulls ~1.5, cows ~1.3)
LENGTH = 2.45 if BULL else 2.10       # m nose to rump
TIERS = [('lod0', 3600), ('lod1', 1500), ('lod2', 450)] if BULL else [('lod0', 3000), ('lod1', 1200), ('lod2', 350)]
ANTLER_TRIS = {'lod0': 1000, 'lod1': 420, 'lod2': 110}   # the bull's antlers' share of each tier (both antlers)
POSE_X = 0.3        # the client's pose.x: the legs' squash at pose 1, for the bedded drop

ob = A.import_glb_mesh(SRC)
me = ob.data
V = me.vertices
NV = len(V)
def getP():
    a = np.zeros(NV * 3); V.foreach_get('co', a); return a.reshape(-1, 3)
def setP(P):
    V.foreach_set('co', np.ascontiguousarray(P, dtype=np.float64).reshape(-1)); me.update()
P = getP()
P[:, 2] -= P[:, 2].min()
H = P[:, 2].max()
U = H / 1.9          # the sources' unit: both previews are ~1.9 units tall with the antlers (~1.4 m a unit)
adj = A.adjacency(me)

def comps(mask):
    lab = -np.ones(NV, int); k = 0
    for s0 in np.nonzero(mask)[0]:
        if lab[s0] >= 0: continue
        st = [s0]; lab[s0] = k
        while st:
            v = st.pop()
            for u in adj[v]:
                if mask[u] and lab[u] < 0: lab[u] = k; st.append(u)
        k += 1
    return lab

def dijkstra(P, seeds, mask):
    """Edge-path distance from the seed vertices over the vertices in mask."""
    d = np.full(NV, np.inf); h = []
    for s in seeds: d[s] = 0.0; h.append((0.0, s))
    heapq.heapify(h)
    while h:
        dv, v = heapq.heappop(h)
        if dv > d[v]: continue
        for u in adj[v]:
            if not mask[u]: continue
            nd = dv + float(np.linalg.norm(P[u] - P[v]))
            if nd < d[u]: d[u] = nd; heapq.heappush(h, (nd, u))
    return d

# ---- square the animal to the axes: the trunk's long axis (a band through the body below the neck) onto y ----
band = P[(P[:, 2] > 0.4 * H) & (P[:, 2] < 0.55 * H)]
c2 = band[:, :2].mean(0); _, _, vt = np.linalg.svd(band[:, :2] - c2)
ax = vt[0] if vt[0][1] < 0 else -vt[0]
yaw = math.atan2(ax[0], -ax[1])
cy, sy = math.cos(-yaw), math.sin(-yaw)
P[:, 0], P[:, 1] = P[:, 0] * cy - P[:, 1] * sy, P[:, 0] * sy + P[:, 1] * cy
low = P[P[:, 2] < 0.02 * H]
P[:, 0] -= low[:, 0].mean()                      # the midline between the feet
print('INFO body turned', round(-math.degrees(yaw), 1), 'deg about the vertical')
setP(P)

# ---- the antlers ----
# Two ways to find them, one per source (each is the one that separates that mesh's antlers from its ears):
# 'cut' (the cow's source, B): lower a horizontal cut from the top until the two antlers (grown from the two highest
#   points) join through the skull; what lies above the last cut that kept them apart, in their two pieces, is antler.
# 'thin' (the bull's source, A, whose beams leave the head nearly level, below any such cut): the thin parts (an inward
#   ray along the vertex normal leaves the surface within ~11 cm) high on the animal connected to the two highest
#   points, plus thin pieces near them that rise well above their own foot (a tine whose root on the beam is thick).
# Either way, plus whatever the set encloses or cuts loose. (A's right ear touches the underside of its beam and stays
# in the set: it is coloured as the head where it hangs below the burrs, see the palette.)
ANTLERS = 'thin' if BULL else 'cut'
s1 = int(np.argmax(P[:, 2]))
far = np.linalg.norm(P[:, :2] - P[s1, :2], axis=1) > 0.35 * U
s2 = int(np.argmax(np.where(far, P[:, 2], -1)))
if ANTLERS == 'cut':
    prev = None
    for zc in np.arange(H - 0.1 * U, 0.5 * H, -0.005 * U):
        lab = comps(P[:, 2] > zc)
        if lab[s1] == lab[s2]: break
        prev = (zc, lab)
    zc, lab = prev
    ant = (lab == lab[s1]) | (lab == lab[s2])
    print('INFO antlers cut at z', round(zc, 3))
else:
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    thick = np.full(NV, 9.0)
    for v in V:
        h = bvh.ray_cast(v.co - v.normal * 1e-4, -v.normal, 1.0)
        if h[0] is not None: thick[v.index] = h[3]
    thin = (thick < 0.08 * U) & (P[:, 2] > 0.6 * H)
    labt = comps(thin)
    ant = (labt == labt[s1]) | (labt == labt[s2])
    foot = P[ant][np.argmin(P[ant, 2])]
    for k in set(labt[thin & ~ant]):
        m = labt == k; q = P[m]
        if m.sum() >= 15 and q[:, 2].max() - q[:, 2].min() > 0.15 * U and np.linalg.norm(q.mean(0) - foot) < 0.45 * U:
            ant |= m; print('INFO antler piece added (a tine whose root is thick):', int(m.sum()), 'vertices, z', round(q[:, 2].min(), 3), '-', round(q[:, 2].max(), 3))
rest = comps(~ant); big = np.bincount(rest[rest >= 0]).argmax()
ant |= (~ant) & (rest != big)
print('INFO antlers', int(ant.sum()), 'vertices')
earv = np.zeros(NV, bool)

# ---- the burrs: the antler vertices next to the skull, in two clusters (2-means on the plane) ----
ring = np.array([i for i in np.nonzero(ant)[0] if any(not ant[u] for u in adj[i]) and not any(earv[u] for u in adj[i])])
R2 = P[ring, :2]
i1 = int(np.argmax(np.linalg.norm(R2 - R2[0], axis=1))); i0 = int(np.argmax(np.linalg.norm(R2 - R2[i1], axis=1)))
cc = np.array([R2[i0], R2[i1]])
for _ in range(20):
    lr = np.argmin(((R2[:, None] - cc[None]) ** 2).sum(-1), 1)
    cc = np.array([R2[lr == k].mean(0) for k in range(2)])
burr = [P[ring[lr == k]].mean(0) for k in range(2)]
if burr[0][0] < burr[1][0]: burr = burr[::-1]                          # burr[0] the left (+x)

# ---- turn the head back to the midline about a vertical axis behind the poll ----
# Three estimates of the face's bearing off the line ahead: the long axis (on the plane) of the head within 0.3 units
# (~40 cm) of the nose tip, the line from the poll (between the burrs) to the nose, and the burrs' tilt off the line
# across; the median of the three.
nonant = ~ant
nose0 = P[nonant][np.argmin(P[nonant, 1])]
snout = P[nonant & (np.linalg.norm(P - nose0, axis=1) < 0.3 * U)]
_, _, vt = np.linalg.svd(snout[:, :2] - snout[:, :2].mean(0))
fa = vt[0] if vt[0][1] < 0 else -vt[0]                                  # the face's axis, pointing to the nose
poll = (burr[0] + burr[1]) / 2
dn = nose0 - poll
est = [math.atan2(fa[0], -fa[1]), math.atan2(dn[0], -dn[1]), math.atan2(burr[0][1] - burr[1][1], burr[0][0] - burr[1][0])]
phi = sorted(est)[1]
PHI = -phi
# the pivot: just behind the poll (the atlas); then the head slides sideways so the nose comes onto the midline, both
# blended in over the upper neck and kept off the chest and forelegs
P0 = np.array([poll[0], poll[1] + 0.08 * U])
yp = P0[1]
zneck = nose0[2] - 0.3 * U
w = np.array([A.smooth(yp + 0.3 * U, yp - 0.04 * U, y) for y in P[:, 1]]) * np.array([A.smooth(zneck - 0.15 * U, zneck + 0.1 * U, z) for z in P[:, 2]])
def turn(p, a=PHI, wt=1.0):
    qq = p[:2] - P0; ang = a * wt
    return np.array([qq[0] * math.cos(ang) - qq[1] * math.sin(ang) + P0[0], qq[0] * math.sin(ang) + qq[1] * math.cos(ang) + P0[1], p[2]])
slide = -turn(nose0)[0]
ang = PHI * w
q = P[:, :2] - P0
ca, sa = np.cos(ang), np.sin(ang)
P[:, 0], P[:, 1] = q[:, 0] * ca - q[:, 1] * sa + P0[0] + slide * w, q[:, 0] * sa + q[:, 1] * ca + P0[1]
burr = [turn(b) + np.array([slide, 0, 0]) for b in burr]
nose1 = P[nonant][np.argmin(P[nonant, 1])]
print('INFO head turn: bearings (face, poll to nose, burrs)', [round(math.degrees(e), 1) for e in est], 'turned back', round(math.degrees(phi), 1),
      'deg about', [round(x, 3) for x in P0], 'slid', round(slide, 3), 'nose x', round(nose0[0], 3), '->', round(nose1[0], 3), 'burrs', [b.round(3).tolist() for b in burr])
setP(P)

# ---- the bull's antlers 1.2x larger about their burrs (the preview's beams are ~0.85 m along the curve; a mature
# Roosevelt bull's run 1.0-1.3 m), the growth fading in over the first 15 cm so the burrs stay put ----
ANT_SCALE = 1.2
if BULL:
    side = np.sign(P[:, 0] - (burr[0][0] + burr[1][0]) / 2)
    ringv = [i for i in np.nonzero(ant)[0] if any(not ant[u] for u in adj[i])]
    dB = [dijkstra(P, [i for i in ringv if side[i] == sd], ant) for sd in (1, -1)]
    for i in np.nonzero(ant)[0]:
        k = 0 if dB[0][i] <= dB[1][i] else 1
        d = min(dB[0][i], dB[1][i])
        if not np.isfinite(d): continue
        f = 1 + (ANT_SCALE - 1) * A.smooth(0.0, 0.15 / 1.4, d)        # in source units (~1.4 m each)
        P[i] = burr[k] + (P[i] - burr[k]) * f
    setP(P)

def debug_export(path, colors):
    """The working mesh with per-vertex debug colours (rgb 0-1 rows), for checking the steps."""
    ca = me.color_attributes.get('dbg') or me.color_attributes.new('dbg', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(colors): ca.data[i].color = (c[0], c[1], c[2], 1.0)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_colors=True, use_selection=True)
    print('DEBUG wrote', path)
if DEBUG:
    debug_export(DEBUG + '_turn.glb', [(0.9, 0.3, 0.1) if a else (0.7, 0.7, 0.7) for a in ant])

def refresh():
    global V, NV, P, adj
    V = me.vertices; NV = len(V); P = getP(); adj = A.adjacency(me)

# ---- the cow: the antlers off, the skull capped and smoothed into a bare poll ----
if not BULL:
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(ant)[0]], context='VERTS')
    holes = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)['faces']
    print('INFO cow: antlers removed,', len(holes), 'holes capped')
    bmesh.ops.poke(bm, faces=holes)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()
    refresh()
    # relax round each burr: Laplacian steps weighted by the distance from the burr (full within 4 cm-ish, none past
    # ~9 cm), which pulls the pedicle stubs and the caps down into the skull's curve
    bc = np.array(burr)
    dmin = np.min(np.linalg.norm(P[:, None, :] - bc[None], axis=2), axis=1)
    R0 = 0.065 * U
    wt = np.array([A.smooth(R0, 0.45 * R0, d) for d in dmin])
    nb = [np.array(a) for a in adj]
    for it in range(40):
        L = np.array([P[n].mean(0) if len(n) else P[i] for i, n in enumerate(nb)])
        P = P + (L - P) * (0.6 * wt)[:, None]
    setP(P)
    ant = np.zeros(NV, bool)
else:
    refresh()

# ---- the tail: the stub at the top of the rump (the hind feet may step back further, so only high up) ----
nonant = ~ant
hi = nonant & (P[:, 2] > 0.4 * H)
rear = np.argsort(-np.where(hi, P[:, 1], -9))[:12]
TT = P[rear].mean(0)
tailset = set(np.nonzero(nonant & (P[:, 1] > TT[1] - 0.075 * U) & (np.linalg.norm(P - TT, axis=1) < 0.09 * U) & (np.abs(P[:, 0]) < 0.07 * U))[0].tolist())
TAILP = np.array([0.0, TT[1] - 0.065 * U, TT[2] + 0.01 * U])
print('INFO tail end', TT.round(3).tolist(), 'vertices', len(tailset))

# ---- feet and leg cuts ----
intail = np.zeros(NV, bool); intail[list(tailset)] = True
lowm = (P[:, 2] < 0.02 * U) & ~intail
low = P[lowm]
ymid = (low[:, 1].min() + low[:, 1].max()) / 2
yff = low[low[:, 1] < ymid, 1].mean(); yfh = low[low[:, 1] >= ymid, 1].mean()
# the belly line: the median, along the trunk between the legs, of the lowest midline point (a sheath hangs lower)
bz = []
for y in np.linspace(yff + 0.25 * (yfh - yff), yfh - 0.25 * (yfh - yff), 9):
    m = (np.abs(P[:, 0]) < 0.03 * U) & (np.abs(P[:, 1] - y) < 0.03 * U) & nonant & (P[:, 2] > 0.2 * H)
    if m.any(): bz.append(P[m, 2].min())
zcut = float(np.median(bz)) - 0.03 * U
print('INFO feet y fore/hind', round(yff, 3), round(yfh, 3), 'belly line z', round(zcut + 0.03 * U, 3), 'leg cuts z', round(zcut, 3))
legs = {}
for i in range(NV):
    if intail[i] or ant[i]: continue
    if P[i, 2] < zcut: legs.setdefault((P[i, 1] < ymid, P[i, 0] > 0), []).append(i)
pivots = {}
for k, vs in legs.items():
    ring = P[[i for i in vs if P[i, 2] > zcut - 0.03 * U]]
    c = ring.mean(0)
    pivots[k] = np.array([c[0], c[1], zcut])
    pivots[k + ('r',)] = float(np.max(np.hypot(ring[:, 0] - c[0], ring[:, 1] - c[1])))
fore_front = min(P[i, 1] for k, vs in legs.items() if k[0] for i in vs)

# ---- the withers and the neck's base ----
# The top line along the midline: along the back, then into the neck. The withers are where, going forward from
# behind the forelegs, it either tops out (the bull's shoulder hump under the mane, the neck dipping ahead of it) or
# turns steeply up into the neck (more than ~60 degrees, the cow). The neck's base is the plane through the withers
# and the top of the brisket (the chest's front-most point, raised ~10 cm): what lies ahead of it is head and neck.
nose = P[nonant][np.argmin(P[nonant, 1])].copy()
mid = (np.abs(P[:, 0]) < 0.08 * U) & nonant & (P[:, 2] > zcut)
def ztop(y):
    m = mid & (np.abs(P[:, 1] - y) < 0.02 * U)
    return P[m, 2].max() if m.any() else np.nan
ys = np.arange(yff + 0.25 * (yfh - yff), nose[1] + 0.3 * U, -0.01 * U)
zt = np.array([ztop(y) for y in ys])
yw = None
for j in range(len(ys) - 3):
    if zt[j + 3] < zt[j] - 0.003 * U or zt[j + 3] - zt[j] > 0.06 * U:
        yw = ys[j]; top = zt[j]; break
if yw is None: yw = yff; top = ztop(yff)
fr = (np.abs(P[:, 0]) < 0.08 * U) & nonant & (P[:, 2] > zcut) & (P[:, 2] < zcut + 0.3 * U) & (P[:, 1] > yff - 0.3 * U)
bi = np.nonzero(fr)[0][np.argmin(P[fr, 1])]
BR = P[bi].copy()
Wp = np.array([0.0, yw, top]); Cp = np.array([0.0, BR[1] + 0.01 * U, BR[2] + 0.08 * U])
def neck_plane(Wp, Cp, inset):
    t = (Wp - Cp) / np.linalg.norm(Wp - Cp)
    n = np.array([0.0, -t[2], t[1]])
    if n[1] > 0: n = -n                     # perpendicular to the withers-brisket line, pointing forward (and up)
    return n, Cp + (Wp - Cp) * 0.4 + n * inset   # the neck joint: low in the neck's base (the root of the neck)
NDIR, NB = neck_plane(Wp, Cp, 0.02 * U)
ZG = (BR[2], BR[2] + 0.05 * U)
print('INFO withers', Wp.round(3).tolist(), 'brisket', BR.round(3).tolist(), 'neck base', NB.round(3).tolist(), 'plane normal', NDIR.round(3).tolist())
S = WITHERS / top
yorg = (yff + yfh) / 2
# head and body length along the top: nose, poll, neck base, withers, rump (the tail's root)
poll = (burr[0] + burr[1]) / 2
LEN0 = S * sum(np.linalg.norm(b - a) for a, b in zip([nose, poll, NB, Wp], [poll, NB, Wp, TAILP]))
# the trunk between the leg columns stretched (or shortened) to the brief's length, the legs moved with it rigidly
yF = max(pivots[(True, True)][1], pivots[(True, False)][1]) + max(pivots[(True, True, 'r')], pivots[(True, False, 'r')])
yH = min(pivots[(False, True)][1], pivots[(False, False)][1]) - max(pivots[(False, True, 'r')], pivots[(False, False, 'r')])
STRETCH = min(1.12, max(0.9, 1 + (LENGTH - LEN0) / ((yH - yF) * S)))
def ys_(y):
    return y if y <= yF else (yF + (y - yF) * STRETCH if y < yH else y + (yH - yF) * (STRETCH - 1))
def sc(p): return np.array([p[0] * S, (ys_(p[1]) - yorg) * S, p[2] * S])
P = np.array([sc(p) for p in P])
setP(P)
for k in list(pivots):
    if len(k) == 2: pivots[k] = sc(pivots[k])
    else: pivots[k] = pivots[k] * S
nose = sc(nose); TT = sc(TT); TAILP = sc(TAILP); ZF = zcut * S; fore_front = (fore_front - yorg) * S
burr = [sc(b) for b in burr]
Wp = sc(Wp); Cp = sc(Cp); BR = sc(BR)
NDIR, NB = neck_plane(Wp, Cp, 0.02 * U * S)
ZG = (ZG[0] * S, ZG[1] * S)
print('INFO scale', round(S, 4), 'head and body along the top at that scale', round(LEN0, 3), 'the trunk between the legs stretched', round(STRETCH, 3))

# ---- the neck's axis: from the neck joint to the head's base (behind and below the poll) ----
poll = (burr[0] + burr[1]) / 2
HB = np.array([0.0, poll[1] + 0.05, poll[2] - 0.13])
NAX = HB - NB; NL = float(np.linalg.norm(NAX)); NAXU = NAX / NL
DOWN = np.array([0.0, 0.0, -1.0]) - NAXU * (-NAXU[2]); DOWN /= np.linalg.norm(DOWN)      # down, square to the axis
def neck_t(p): return float((p - NB) @ NAXU) / NL
def head_w(p):
    """1 on the head (within ~13 cm of the line from the head's base to the nose, not behind the base), 0 on the neck."""
    ax = nose - HB; la = float(np.linalg.norm(ax)); ax = ax / la
    d = float((p - HB) @ ax)
    r = float(np.linalg.norm(p - HB - ax * min(max(d, 0.0), la)))
    return A.smooth(0.17, 0.12, r) * A.smooth(-0.07, 0.0, d)

# ---- the cow: a short throat mane (the shaggy bulge pulled in toward the neck), the neck a little longer and slimmer ----
NECK_EXT = 0.0 if BULL else 0.1        # m added along the neck
FACE_LEN = 1.15                        # the cow's face, along its line
NECK_PITCH = 14                        # degrees forward (the cow)
if not BULL:
    T = np.array([neck_t(p) for p in P])
    HW = np.array([head_w(p) for p in P])
    wn = np.array([A.smooth(-0.03, 0.1, float((p - NB) @ NDIR)) for p in P])      # in the head part
    # the neck's half-width at each station (lateral), for where the throat bulge starts
    hw = {}
    for k in range(11):
        m = (np.abs(T - k / 10) < 0.06) & (wn > 0.5)
        hw[k] = np.percentile(np.abs(P[m, 0]), 90) if m.sum() > 10 else 0.1
    Q = P.copy()
    for i in np.nonzero(wn > 0)[0]:
        t = T[i]; p = P[i]
        if t < 0.85:
            c = NB + NAX * t; r = p - c
            vent = float(r @ DOWN); lat = r[0]
            rest_ = r - DOWN * vent - np.array([lat, 0, 0])
            k = int(round(min(1.0, max(0.0, t)) * 10)); R = hw[k] * 1.05
            g = A.smooth(-0.05, 0.15, t) * A.smooth(0.85, 0.6, t) * (1 - HW[i])   # along the neck, none at the base, none on the head
            if vent > R: vent = R + (vent - R) * (1 - 0.8 * g)                 # the throat bulge pulled in
            lat *= 1 - 0.1 * g                                                      # slimmer
            r = rest_ + DOWN * vent + np.array([lat, 0, 0])
            p = c + r
        Q[i] = P[i] + (p - P[i]) * wn[i] + NAXU * NECK_EXT * max(HW[i], A.smooth(0.0, 1.0, t)) * wn[i]
    # the preview holds its neck bolt upright, head high (a llama's carriage): pitch the neck and head forward about the
    # neck's base, the bend spread over the lower neck, so she carries it at ~45 degrees and can reach the ground
    PITCH = math.radians(NECK_PITCH)
    def pitch(p, a):
        q = p - NB; return NB + np.array([q[0], q[1] * math.cos(a) - q[2] * math.sin(a), q[1] * math.sin(a) + q[2] * math.cos(a)])
    # the preview's face is short for its body (~35 cm poll to nose; a cow elk's is ~45): longer along the face's line
    HBe = HB + NAXU * NECK_EXT
    FA = nose + NAXU * NECK_EXT - HBe; FA /= np.linalg.norm(FA)
    for i in np.nonzero(wn > 0)[0]:
        d = float((Q[i] - HBe) @ FA)
        if d > 0: Q[i] = Q[i] + FA * d * (FACE_LEN - 1) * wn[i] * HW[i]
    # (the head itself turned back up about its base, so the face keeps its angle)
    HB1 = pitch(HBe, PITCH)
    def unpitch(p, a):
        q = p - HB1; return HB1 + np.array([q[0], q[1] * math.cos(a) - q[2] * math.sin(a), q[1] * math.sin(a) + q[2] * math.cos(a)])
    for i in np.nonzero(wn > 0)[0]:
        Q[i] = unpitch(pitch(Q[i], PITCH * wn[i] * A.smooth(-0.1, 0.3, T[i])), -PITCH * wn[i] * max(HW[i], A.smooth(0.7, 1.0, T[i])))
    P = Q; setP(P)
    nose_new = P[np.argmin(P[:, 1])].copy()
    def hs(b):
        b = b + NAXU * NECK_EXT; d = float((b - HBe) @ FA)
        return unpitch(pitch(b + FA * max(0.0, d) * (FACE_LEN - 1), PITCH), -PITCH)
    poll = hs(poll); HB = HB1; burr = [hs(b) for b in burr]; nose = nose_new
    NAX = HB - NB; NL = float(np.linalg.norm(NAX)); NAXU = NAX / NL
    DOWN = np.array([0.0, 0.0, -1.0]) - NAXU * (-NAXU[2]); DOWN /= np.linalg.norm(DOWN)
    print('INFO cow neck: throat bulge pulled in, slimmed, lengthened', NECK_EXT, 'm, pitched forward', NECK_PITCH, 'deg; face', FACE_LEN, 'x longer')

# ---- per-vertex rig on the full mesh (decimation keeps vertex groups, so carry it in groups) ----
ysplit = (pivots[(True, True)][1] + pivots[(False, True)][1]) / 2
def rig_full(i):
    p = P[i]
    if i in tailset:
        return dict(part=3, partw=A.smooth(TAILP[1], TAILP[1] + 0.03, p[1]), pivot=TAILP)
    if ant[i]: return dict(part=6, partw=1.0, pivot=NB)
    best = None
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p[0] > 0) != k[1] or (p[1] < ysplit) != k[0]: continue
        dxy = math.hypot(p[0] - pv[0], p[1] - pv[1])
        w = 1.0 if p[2] < pv[2] - 0.04 else A.smooth(pv[2] + 0.09, pv[2] - 0.04, p[2]) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: best = (w, k)
    if best:
        w, (fore, left) = best
        return dict(part=1 if fore == left else 2, partw=w, pivot=pivots[(fore, left)])
    dd = float((p - NB) @ NDIR)
    wh = A.smooth(-0.03, 0.1, dd)
    if wh > 0 and p[1] > fore_front - 0.05: wh *= A.smooth(ZG[0], ZG[1], p[2])
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=np.zeros(3))
RIG = [rig_full(i) for i in range(NV)]

# ---- landmarks ----
hp = np.array([r['part'] == 6 and r['partw'] > 0.5 for r in RIG]) & ~ant
crown = P[hp & (np.abs(P[:, 0]) < 0.02) & (np.abs(P[:, 1] - poll[1]) < 0.08), 2].max()
# the ears: head vertices above the crown's level less 3 cm, out past the skull's half-width at the poll, near the poll
skull_hw = np.percentile(np.abs(P[hp & (np.abs(P[:, 1] - poll[1]) < 0.03) & (np.abs(P[:, 2] - (crown - 0.06)) < 0.02), 0]), 95)
earm = hp & (P[:, 2] > crown - 0.03) & (np.abs(P[:, 0]) > skull_hw * 0.9) & (np.abs(P[:, 1] - poll[1]) < 0.16)
lab_e = comps(earm)
earm = np.zeros(NV, bool)
for sd in (1, -1):                       # the largest such piece each side
    ks = [k for k in set(lab_e[lab_e >= 0]) if np.sign(P[lab_e == k, 0].mean()) == sd]
    if ks: earm |= lab_e == max(ks, key=lambda k: (lab_e == k).sum())
ear_top = P[earm, 2].max(); ear_y = P[earm, 1].mean()
ear_base, ear_len = {}, {}
for sd in (1, -1):
    e = P[earm & (np.sign(P[:, 0]) == sd)]
    if len(e): ear_base[sd] = e[np.argmin(np.abs(e[:, 0]))]; ear_len[sd] = np.linalg.norm(e - ear_base[sd], axis=1).max()
for sd in (1, -1):                       # an ear hidden in the antler set: the other one mirrored
    if sd not in ear_base: ear_base[sd] = ear_base[-sd] * np.array([-1, 1, 1]); ear_len[sd] = ear_len[-sd]
print('INFO ears', int(earm.sum()), 'vertices, bases', {sd: L(b) for sd, b in ear_base.items()} if False else '')
drop = ZF * (1 - POSE_X)
L = lambda v: [round(float(x), 3) for x in v]
spine = sum(np.linalg.norm(b - a) for a, b in zip([nose, poll, NB, Wp], [poll, NB, Wp, TAILP]))
LM = dict(withers=WITHERS, scale=round(S, 4), stretch=round(STRETCH, 3), head_and_body_along_top=round(float(spine), 3),
          nose_to_rump_straight=round(float(TT[1] - nose[1]), 3), tail_end=L(TT), tail_root=L(TAILP), nose=L(nose), poll=L(poll), crown_z=round(float(crown), 3),
          ear_top_z=round(float(ear_top), 3), ear_y=round(float(ear_y), 3), withers_pt=L(Wp), neck_base=L(NB), head_base=L(HB), leg_pivot_z=round(float(ZF), 3),
          bedded_drop=round(float(drop), 3), pivots={('F' if k[0] else 'H') + ('L' if k[1] else 'R'): L(v) for k, v in pivots.items() if len(k) == 2})
if BULL:
    LM['antlers'] = dict(burr_L=L(burr[0]), burr_R=L(burr[1]), spread=round(float(P[ant, 0].max() - P[ant, 0].min()), 3),
                         above_poll=round(float(P[ant, 2].max() - crown), 3), top_z=round(float(P[ant, 2].max()), 3))
print('LANDMARKS', json.dumps(LM))

# ---- the bull's antlers: brown at the burr and along the beams, ivory over the last ~10 cm of every tine ----
ivory = np.zeros(NV)
if BULL:
    seeds = [i for i in np.nonzero(ant)[0] if any(not ant[u] for u in adj[i]) and P[i, 2] > crown - 0.06]
    db = dijkstra(P, seeds, ant)
    cand = [i for i in np.nonzero(ant & np.isfinite(db))[0] if db[i] > 0.18 and all(db[u] <= db[i] for u in adj[i] if ant[u])]
    tips = []
    for i in sorted(cand, key=lambda i: -db[i]):
        if all(np.linalg.norm(P[i] - P[j]) > 0.09 for j in tips): tips.append(i)
    dt = dijkstra(P, tips, ant)
    for i in np.nonzero(ant)[0]:
        ivory[i] = A.smooth(0.13, 0.04, dt[i]) * A.smooth(0.12, 0.25, db[i])
    print('INFO antler tips', len(tips), '(left', sum(1 for i in tips if P[i, 0] > 0), 'right', sum(1 for i in tips if P[i, 0] < 0), ')',
          'beam length (burr to farthest tip) left', round(float(max(db[i] for i in tips if P[i, 0] > 0)), 3), 'right', round(float(max(db[i] for i in tips if P[i, 0] < 0)), 3))

# ---- vertex groups: the rig parts, the ears, the ivory, and the frozen sets for the staged decimation ----
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6')}
for i, r in enumerate(RIG):
    if r['part']: gp['p%d' % r['part']].add([i], max(1e-4, r['partw']), 'REPLACE')
gE = ob.vertex_groups.new(name='ear'); gE.add([int(i) for i in np.nonzero(earm)[0]], 1.0, 'REPLACE')
gI = ob.vertex_groups.new(name='ivory')
for i in np.nonzero(ivory > 0)[0]: gI.add([int(i)], float(ivory[i]), 'REPLACE')
gA = ob.vertex_groups.new(name='ant'); gA.add([int(i) for i in np.nonzero(ant)[0]], 1.0, 'REPLACE')
headv = np.array([r['part'] == 6 and r['partw'] > 0.5 for r in RIG])
def frozen(name, mask):
    g = ob.vertex_groups.new(name=name); g.add([int(i) for i in np.nonzero(mask)[0]], 1.0, 'REPLACE')
frozen('fH', headv)                     # the head and neck (and antlers) kept: the body goes down
frozen('fB', ~headv | ant)              # all but the head and neck kept: they go down
frozen('fN', ~ant)                      # all but the antlers kept: they go down

# ---- palette (sRGB) ----
BODY = 0xa88e6a if BULL else 0x9c8160
HEADC, MANE = 0x4a3222, (0x3a271b if BULL else 0x43301f)
LEGS, HOOF, BELLY = 0x3e2c20, 0x1f1915, 0x4a3626
RUMP, RLINE = 0xe0cfa6, 0x3e2c20
EAR_OUT, EAR_IN, EAR_RIM = 0x8a7457, 0xbba585, 0x2c2019
NOSE, EYE = 0x1a1512, 0x120d0a
ANT0, ANT1 = 0x6a573f, 0xece2c9
# the eye: on the side of the head 70% of the way from the nose tip to the ears, 55% of the way up from the nose to the
# crown, where a ray from the side meets the head
EYE_Y = nose[1] + 0.7 * (ear_y - nose[1])
EYE_Z = nose[2] + 0.55 * (crown - nose[2])
hit = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get()).ray_cast(Vector((1.0, EYE_Y, EYE_Z)), Vector((-1, 0, 0)), 2.0)[0]
EYE_P = Vector((hit.x if hit is not None else 0.08, EYE_Y, EYE_Z))
print('LANDMARKS eye', [round(x, 3) for x in EYE_P])
zb_min = min(b[2] for b in burr) if BULL else 0
fpy = (pivots[(True, True)][1] + pivots[(True, False)][1]) / 2
RE = (0.2, 0.27) if BULL else (0.18, 0.25)        # the rump patch's half-width and half-height
RZ = TAILP[2] - 0.11

def face_color(m, p, R, W):
    c = p.center; n = p.normal
    g = lambda col, a=0.06: A.grizzle(col, c, a, 0.03)
    vs = list(p.vertices)
    parts = [R[i]['part'] for i in vs]
    if all(W['ant'][i] > 0.5 for i in vs):
        if c.z < zb_min - 0.01: return g(HEADC)                 # the ear tucked under a beam
        t = sum(W['ivory'][i] for i in vs) / len(vs)
        return g(A.mix(ANT0, ANT1, min(1.0, t)), 0.04)
    if all(x == 3 for x in parts): return g(RUMP, 0.04)
    if p.index in EYES: return A.srgb2lin(EYE)
    q = np.array(c[:])
    nh = sum(1 for x in parts if x == 6)
    if nh * 2 >= len(parts):
        if sum(W['ear'][i] for i in vs) * 2 >= len(vs):          # ears: dark rims, pale inside, tan-grey outside
            sd = 1 if c.x > 0 else -1
            f = np.linalg.norm(q - ear_base[sd]) / ear_len[sd]
            if f > 0.82: return g(EAR_RIM, 0.04)
            inside = n.y < -0.2 or (n.x * sd < -0.2)
            return g(EAR_IN if inside else EAR_OUT, 0.04)
        if c.y < nose[1] + 0.035 and c.z > nose[2] - 0.05 and n.y < -0.3: return A.srgb2lin(NOSE)
        t = neck_t(q)
        if head_w(q) < 0.5:                                        # the neck and mane
            vent = float((q - (NB + NAX * max(0.0, t))) @ DOWN)
            col = MANE if (BULL or vent > 0.02) else HEADC
            dd = float((q - NB) @ NDIR)
            return g(A.mix(BODY, col, A.smooth(-0.16, -0.06, dd)), 0.07)
        return g(HEADC)
    dd = float((q - NB) @ NDIR)
    if any(x in (1, 2) for x in parts) and c.z < ZF + 0.05:
        t = A.smooth(0.05, 0.22, c.z)
        base = A.mix(HOOF, LEGS, t)
        return g(A.mix(base, BODY if c.y > fpy or c.z > ZF - 0.1 else BELLY, A.smooth(ZF - 0.04, ZF + 0.05, c.z)), 0.05)
    # the rump patch round the tail, bordered by a dark line
    if c.y > TAILP[1] - 0.2 and n.y > -0.3:
        e = math.hypot(c.x / RE[0], (c.z - RZ) / RE[1])
        if e < 1.0: return g(RUMP, 0.04)
        if e < 1.13 and abs(c.x) > 0.45 * RE[0] and c.z < RZ + 0.12: return g(A.mix(RLINE, BODY, 0.25), 0.05)   # dark down the sides
    if dd > -0.16: return g(A.mix(BODY, MANE if BULL else HEADC, A.smooth(-0.16, -0.06, dd)), 0.07)     # the dark cape, to the shoulders
    if c.y < fpy and c.z < NB[2]: return g(MANE if BULL else HEADC, 0.06)       # the dark brisket
    if c.z < ZF + 0.3 and n.z < -0.1:      # the dark belly, graded up the lower flank
        t = A.smooth(-0.1, -0.6, n.z) * A.smooth(ZF + 0.3, ZF + 0.12, c.z)
        if t > 0: return g(A.mix(BODY, BELLY, t), 0.05)
    return g(BODY)

# ---- tiers: staged collapse (the body with the head kept, then the head, then the bull's antlers) ----
def region_faces(o, gname):
    gi = o.vertex_groups[gname].index
    fz = {v.index for v in o.data.vertices if any(gg.group == gi and gg.weight > 0.5 for gg in v.groups)}
    return sum(1 for p in o.data.polygons if not all(i in fz for i in p.vertices))
def stage(o, gname, want, symmetry=True):
    n = len(o.data.polygons); r = region_faces(o, gname)
    o2, _ = A.tier_copy(o, max(n - r + want, 10), symmetry=symmetry, protect=gname)
    return o2
tiers = []
for name, target in TIERS:
    k = 1.0
    for it in range(4):                  # the stages land short of their aims; scale the aims until the total is near
        at = ANTLER_TRIS[name] if BULL else 0
        rest_t = target - at
        head_t = int(rest_t * (0.34 if name != 'lod2' else 0.3))
        o1 = stage(ob, 'fH', int((rest_t - head_t) * k))             # the body down, the head and neck (and antlers) kept
        o2 = stage(o1, 'fB', int(head_t * k)); bpy.data.objects.remove(o1)  # the head and neck down
        if BULL:
            o3 = stage(o2, 'fN', int(at * k), symmetry=False); bpy.data.objects.remove(o2); o2 = o3
        n = len(o2.data.polygons)
        if abs(n - target) < 0.03 * target or it == 3: break
        bpy.data.objects.remove(o2); k *= target / n
    o = o2; m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    W = {k: np.zeros(len(m.vertices)) for k in ('ant', 'ivory', 'ear')}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        for k in W: W[k][v.index] = w.get(k, 0.0)
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part == 3: piv = TAILP
        elif part == 6: piv = NB
        else: piv = pivots[(co.y < ysplit, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=Vector(tuple(piv)))
    # the eyes: the face nearest the eye point on each side (none on the far tier)
    def eye_face(sd):         # of the faces within 3 cm of the eye point, the one nearest an elk's eye in size (~4 cm2)
        de = lambda p: (Vector((abs(p.center.x), p.center.y, p.center.z)) - EYE_P).length
        side = [p for p in m.polygons if p.center.x * sd > 0]
        near = [p for p in side if de(p) < 0.03]
        return (min(near, key=lambda p: abs(math.log(max(p.area, 1e-7) / 0.0004))) if near else min(side, key=de)).index
    EYES = set() if name == 'lod2' else {eye_face(sd) for sd in (1, -1)}
    t = A.emit(m, lambda p: face_color(m, p, R, W), lambda i: R[i])
    nA = sum(1 for p in m.polygons if all(W['ant'][i] > 0.5 for i in p.vertices))
    print('INFO', name, len(m.polygons), 'triangles', '(antlers %d)' % nA if BULL else '')
    bpy.data.objects.remove(o)
    tiers.append((name, t))

to3l = lambda p: [round(x, 4) for x in A.to3(Vector(tuple(p)))]
JOB = {}
jp = os.path.join(os.path.dirname(os.path.abspath(SRC)), 'job.json')
if os.path.exists(jp): JOB = json.load(open(jp))
extras = {'species': 'cervus_canadensis', 'sex': SEX, 'withers_m': WITHERS, 'stretch': round(STRETCH, 3), 'meshy_task': TASK,
          'source': {'kind': 'meshy', 'task': TASK, 'ai_model': 'latest', 'credits': JOB.get('credits_charged', 20),
                     'note': 'the prompt asked for a cow; the preview came back an antlered bull' + ('' if BULL else '; its antlers are removed by this build')},
          'rig': {'kind': 'quadruped', 'tail': to3l(TAILP), 'head': to3l(NB),
                  'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]), 'length_m': round(float(TT[1] - nose[1]), 3),
                  'drop': round(float(drop), 3)},
          'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (the short tail), HEAD 6 (neck, head, ears' + (' and antlers)' if BULL else ')')}
if BULL: extras['antler_burr'] = to3l(burr[0])
A.write_glb(OUT, tiers, 'wild-earth tools/build_elk.py (Blender)',
            'Roosevelt elk %s generated with Meshy (meshy.ai), text-to-3D preview task %s, for Wild Earth; CC BY-SA 4.0; squared to the axes, head turned to the midline, ' % (SEX, TASK)
            + ('recoloured, decimated' if BULL else 'antlers removed and the poll smoothed, throat mane reduced, neck lengthened, recoloured, decimated'),
            extras=extras)
