# Build a bird's client GLB from any Meshy mesh (world pipeline, phase 1: a tile's own animals, 2026-11-06). The one
# build for every pipeline-modelled bird, as tools/build_quadruped.py is for the four-legged mammals: nothing in it is
# per species. The hand builds before it (tools/build_vulture.py, build_soarer.py, build_songbird.py, build_turkey.py,
# build_heron.py, build_mallard.py ...) each carried their species' landmarks, palette and reshapes; this one reads
# everything from the mesh, its texture, the species' body mass and the slot's archetype.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_bird.py -- \
#       <job dir or model.glb> <out.glb> --species <code> --archetype soar|perch|ground|wade|water [--mass kg]
#       [--flip] [--flightless] [--meshy-task <id>]
#
# Source: a Meshy text-to-3D job directory (tools/meshy_generate.py: model.glb, and texture_base_color.png after a refine)
# or a GLB. Meshy's convention: the bird faces glTF +z (Blender -y); --flip turns it round.
#
# The archetypes are the client's bird templates (animalModels.js RIG; pipeline/fauna_models.py BIRD_BUILD maps a slot's
# archetype to one), and the pose Meshy is asked for follows them:
#   soar    a flight mesh (the red-tail's and turkey vulture's template: the wings are mesh, spread for good, collapse 0):
#           asked for soaring with the wings spread flat. Parts from the span profile: the body is the central slab
#           as thick as the body (the half-width where the slice's height falls under half the body's), the wings beyond it
#           (WING_L/R, pivot at the shoulder: the root's quarter chord), the hands beyond the wrist (HAND_L/R: the leading
#           edge's most forward point between 30% and 75% of the semi-span, else its middle), the head ahead of the wing
#           root's leading edge, where the midline's height falls under 0.6 of the body's (pivot there), the tail behind
#           the body where the midline thins under 40% of the body's height (pivot there); legs stay body. The body is
#           levelled (the neck base and tail root at one height, at most 25 degrees: Meshy's soarers climb 14-18 degrees).
#           Origin: x at the body, y at the shoulders, z at the lowest body point.
#   perch, ground, wade, water
#           a standing mesh (the jays', the turkey's, the heron's, the merganser's templates: folded wings are body; the
#           flight wings are cards that collapse into the shoulder on pose): asked for standing side-on with the wings
#           folded and the legs apart. The legs: each traced up its column from the foot on the floor (left LEG_A and
#           right LEG_B split by the largest gap in x), slice by slice, to where the column's neighbourhood suddenly
#           widens past 2.5 times its own radius (the body, or a drooping wingtip beside the leg), pivot there (where the
#           leg enters the feathers; a stork's bare tibia goes with the leg);
#           the head and neck: geodesic rings from the bill tip (edge-path distance over the closed surface) grow through
#           the head, narrow at the neck and widen into the body; the neck base is where the ring's radius first passes
#           a quarter of the way from the neck's narrowest to the body's (a heron's S-neck, a goose's neck), or 0.62 of
#           the body's where there is no narrowing (a songbird); a head part over 40% of the bird fails the build (wings
#           spread, not side-on); the tail: behind the trunk's deepest slice near the feet, where the trunk's midline (no
#           legs, no head) thins under 0.35 of that depth (else 0.5, else the last eighth of the bird: a goose's stub);
#           pivot at the root. Loose pieces the remesh leaves apart take the part where they come nearest. The flight wing
#           cards are made here: span by body mass and archetype, b = c M^0.39 (Rayner's exponent; c fitted on the
#           hand builds' field-guide spans: perching 1.0, ground 0.62, waders 1.3, waterbirds 0.95), aspect ratio by
#           archetype (5.5, 4.5, 6.5, 8), the hand 55% of the semi-span, outline round, broad-fingered or pointed; the
#           shoulder a fifth of the way from the neck base to the tail root, inside the back; the cards take the coat's
#           own palette colours (below): the folded wing's commonest colour on the coverts, the folded primaries' on the
#           flight feathers, the breast's below. --flightless (or a ratite order on the card) makes none.
#           water: the origin at the waterline, 0.3 of the body's depth above the belly (the mallard's 4 cm draft of a
#           15 cm deep body), the feet below it, as the merganser's (extras.rig waterline_m, draft_m, feet_y_m).
#
# Size: by body mass (the trait card's mass_kg, EltonTraits: the one size a card carries that is measured; its length and
# span are allometric guesses from mass: a white-backed vulture's 1.0 m span for 2.2 m, a marabou's 1.0 m for 2.6 m).
# A bird's tissue is 800-900 kg/m3, but Meshy models the feathered envelope (plumage, the folded wings and tail, the gaps
# a closed remesh fills), so the volume is read at an envelope density fitted on ten Meshy bird meshes of known size
# (the raven, turkey, quails, jays standing; the turkey vulture, red-tail and raven gliding): 60-280 kg/m3 for the whole
# standing mesh, geometric mean 150 (RHO_STAND); a flight mesh by its body slab alone (|x| under the wing root: the wings'
# modelled thickness varies four-fold between meshes): 204, 225 and 378 kg/m3 on the turkey vulture, raven and red-tail
# (the red-tail's deep V shortens its measured span), RHO_FLY 250. The span that gives, and a soarer's span rule
# (1.4 M^0.39), are printed for a check (a WARN past 0.7-1.45 of it).
# Colour: as build_quadruped: each source face reads the texture (the PNG's sRGB decoded to linear), the colours are
# clustered into the plumage's own palette (k-means, 10), and each face of each tier takes the commonest palette colour
# under it (a vote, nearer source faces counting more); no texture: the vertex colours, else a neutral grey-brown.
# Tiers: decimated (collapse, X symmetry) to lod0 = 1,200 + 800 log10(mass / 0.1 kg), 1,000-3,500, times 1-1.5 by how
# patterned the plumage is (the mean lightness step between neighbouring source faces, 0.05-0.09), lod1 0.36 and lod2
# 0.1 of it (at least 120); the cards added per tier (two rows and a hand on lod0-1, a slab each on lod2).
# Parts (animalModels.js PART): BODY 0, LEG_A 1 (left), LEG_B 2 (right), TAIL 3, WING_L 4, WING_R 5, HEAD 6,
# HAND_L 9, HAND_R 10; extras.rig {kind 'bird', archetype, wing (left shoulder), wrist, tail, head, hip, length_m,
# span_m}.
import bpy, bmesh, sys, os, math, json, heapq
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
SPECIES = opt('--species'); FLIP = '--flip' in argv
ARCH = {'soaring scavenger': 'soar', 'soaring raptor': 'soar', 'gull': 'soar', 'wading bird': 'wade', 'waterbird': 'water',
        'ground bird': 'ground'}.get(opt('--archetype', 'perch'), opt('--archetype', 'perch'))
if ARCH not in ('soar', 'perch', 'ground', 'wade', 'water'): ARCH = 'perch'
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
MASS = float(opt('--mass') or find(traits, 'mass_kg') or 0) or None
if not MASS: raise SystemExit(f'{SPECIES}: no body mass (trait card mass_kg, or --mass)')
ORDER = ((traits.get('taxonomy') or {}).get('order') or '')
FLIGHTLESS = '--flightless' in argv or ORDER in ('Struthioniformes', 'Rheiformes', 'Casuariiformes', 'Apterygiformes')
RHO_STAND, RHO_FLY = 150.0, float(opt('--rho-fly') or 0) or None   # kg/m3 of the feathered envelope (see the header)
RHO_FLY = RHO_FLY or 250.0
SPAN_C = {'perch': 1.0, 'ground': 0.62, 'wade': 1.3, 'water': 0.95, 'soar': 1.4}
ASPECT = {'perch': 5.5, 'ground': 4.5, 'wade': 6.5, 'water': 8.0}
HAND_SHAPE = {'perch': 'round', 'ground': 'round', 'wade': 'broad', 'water': 'pointed'}
BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10
smooth = A.smooth

ob = A.import_glb_mesh(GLB)
me = ob.data; V = me.vertices
if FLIP:
    for v in V: v.co.x, v.co.y = -v.co.x, -v.co.y
# normalise: 2.0 units along the longest horizontal axis (the span for a flight mesh, the length for a standing bird)
ex = [max(v.co[i] for v in V) - min(v.co[i] for v in V) for i in range(3)]
if ARCH == 'soar' and ex[0] < ex[1]: print('WARN a flight mesh narrower in x than long: wings not spread along x?')
if ARCH != 'soar' and ex[0] > 1.2 * ex[1]: print('WARN a standing mesh wider than long: not side-on along y? (Meshy faces glTF +z)')
y0 = min(v.co.y for v in V); x0, x1 = min(v.co.x for v in V), max(v.co.x for v in V); z0 = min(v.co.z for v in V)
k0 = 2.0 / (ex[0] if ARCH == 'soar' else ex[1]); xc = (x0 + x1) / 2
for v in V: v.co = Vector(((v.co.x - xc) * k0, (v.co.y - y0) * k0 - 1.0, (v.co.z - z0) * k0))
me.update()

# ---- source colour per face (build_quadruped's sampling) ----
img = bpy.data.images.load(TEX) if os.path.exists(TEX) else next((im for im in bpy.data.images if im.size[0] > 0), None)
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
if img is not None and me.uv_layers:
    W, H = img.size
    import array
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
        cs = [ca.data[l].color for l in p.loop_indices] if ca.domain == 'CORNER' else [ca.data[i].color for i in p.vertices]
        cols.append(tuple(sum(c[k] for c in cs) / len(cs) for k in range(3)))
    COLOR_SRC = 'vertex colours'
else:
    cols = [A.srgb2lin(0x7a6e62)] * len(me.polygons); COLOR_SRC = 'none (neutral grey-brown)'
CENTRES = [p.center.copy() for p in me.polygons]
NORMALS = [p.normal.copy() for p in me.polygons]
print('INFO colour from', COLOR_SRC, 'source faces', len(cols), 'archetype', ARCH, 'mass', MASS)

# one closed surface (Meshy meshes are not manifold; the collapse decimation stalls on them), 1/200 of the size
me.remesh_voxel_size = 0.01; me.use_remesh_preserve_volume = True
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.voxel_remesh()
me = ob.data; V = me.vertices
P = np.array([v.co[:] for v in V])
adj = A.adjacency(me)
print('INFO remeshed', len(me.polygons), 'faces')

def volume(x_half=None):
    """The closed surface's volume, or of its slab |x| < x_half (cut and capped)."""
    bm = bmesh.new(); bm.from_mesh(me)
    if x_half is not None:
        for s in (1, -1):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(s * x_half, 0, 0), plane_no=(s, 0, 0), clear_outer=True)
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    v = abs(bm.calc_volume()); bm.free(); return v

def geodesic(seeds, allowed=None):
    dist = np.full(len(V), np.inf); h = []
    for s in seeds: dist[s] = 0.0; h.append((0.0, s))
    heapq.heapify(h)
    while h:
        d, v = heapq.heappop(h)
        if d > dist[v]: continue
        for u in adj[v]:
            if allowed is not None and u not in allowed: continue
            nd = d + float(np.linalg.norm(P[u] - P[v]))
            if nd < dist[u]: dist[u] = nd; heapq.heappush(h, (nd, u))
    return dist

def rings(dist, step=0.02):
    """Per geodesic band: (distance, centroid, RMS radius about it), smoothed over three bands."""
    ok = np.isfinite(dist); D = dist[ok].max(); n = int(D / step) + 1
    b = np.minimum((dist[ok] / step).astype(int), n - 1); Q = P[ok]
    cen, rad = np.zeros((n, 3)), np.zeros(n)
    for i in range(n):
        q = Q[b == i]
        if len(q): cen[i] = q.mean(0); rad[i] = math.sqrt(((q - cen[i]) ** 2).sum(1).mean())
        elif i: cen[i], rad[i] = cen[i - 1], rad[i - 1]
    rs = np.convolve(np.pad(rad, 1, mode='edge'), np.ones(3) / 3, mode='valid')
    return np.arange(n) * step + step / 2, cen, rs

# ======================================================================================================================
if ARCH == 'soar':
    # ---- the span profile: per |x| slice, the height (z range) and the leading and trailing edges ----
    ax = np.abs(P[:, 0]); SL = 0.02
    def sl(x): return P[(ax >= x) & (ax < x + SL)]
    def thickness(q):
        # the airfoil's or the body's own thickness: the z range per chordwise (y) bin, its 75th percentile over the bins
        # (a slice's whole z range would count the wing's angle of attack and dihedral, and the body's dangling legs)
        if len(q) < 4: return 0.0
        b = np.floor(q[:, 1] / 0.03).astype(int)
        rs = [np.ptp(q[b == k, 2]) for k in np.unique(b) if (b == k).sum() > 1]
        return float(np.percentile(rs, 75)) if rs else 0.0
    T0 = thickness(P[ax < 0.04])
    prof = [(x, thickness(sl(x))) for x in np.arange(0.04, 0.6, 0.01)]
    if '--debug' in argv: print('DEBUG thickness', T0, [(round(a, 2), round(b, 3)) for a, b in prof[::2]])
    xr = next((x for x, t in prof if t < 0.5 * T0), None)
    if xr is None: raise SystemExit(f'{SPECIES}: no wing root found (the body never thins to a wing): not a flight mesh?')
    semi = ax.max()
    # the shoulder: the root slice's quarter chord, at its mid height (left side, +x)
    rs_ = P[(ax >= xr) & (ax < xr + 0.04)]
    le_r, te_r = rs_[:, 1].min(), rs_[:, 1].max()
    SH = Vector((xr, le_r + 0.25 * (te_r - le_r), float(np.median(rs_[:, 2]))))
    # the wrist: the leading edge's most forward point between 30% and 75% of the semi-span, else its middle
    xs = np.arange(xr + 0.3 * (semi - xr), xr + 0.75 * (semi - xr), 0.01)
    le = [(x, sl(x)[:, 1].min()) for x in xs if len(sl(x))]
    xw, lew = min(le, key=lambda t: t[1]) if le else (xr + 0.5 * (semi - xr), le_r)
    if not le or xw <= xs[1] or xw >= xs[-2]: xw = xr + 0.5 * (semi - xr)
    qw = sl(xw); WR = Vector((xw, qw[:, 1].min() + 0.25 * np.ptp(qw[:, 1]), float(np.median(qw[:, 2]))))
    # the head: ahead of the wing root's leading edge; the tail: behind the body where the midline thins
    y_nb = le_r
    mid = P[ax < 0.5 * xr]
    def zrange(y, w=0.02):
        q = mid[np.abs(mid[:, 1] - y) < w]; return (q[:, 2].min(), q[:, 2].max()) if len(q) else None
    # the neck base: ahead of the wing root, where the midline's height first falls under 0.6 of the body's (the breast
    # stays body: a head turned or dipped swings the head and neck alone)
    for y in np.arange(le_r, mid[:, 1].min(), -0.01):
        r = zrange(y)
        if r and r[1] - r[0] < 0.6 * T0: y_nb = y; break
    nbz = zrange(y_nb)
    NB = Vector((0, y_nb, (nbz[0] + nbz[1]) / 2 if nbz else SH.z))
    y_t = None
    for y in np.arange(te_r - 0.1, mid[:, 1].max(), 0.01):
        r = zrange(y)
        if r and r[1] - r[0] < 0.4 * T0 and y > SH.y + 0.05: y_t = y; break
    if y_t is None: y_t = te_r
    tz = zrange(y_t)
    TR = Vector((0, y_t, (tz[0] + tz[1]) / 2 if tz else SH.z))
    VOLB = volume(xr); VOL = volume()
    S = (MASS / RHO_FLY / VOLB) ** (1 / 3); SIZE_BY = f'mass at {RHO_FLY:g} kg/m3 over the body slab'
    # level the body: the neck base and the tail root at one height (Meshy's soarers climb or dive up to 20 degrees), at
    # most 25 degrees, about the shoulders
    PITCH = max(-25.0, min(25.0, math.degrees(math.atan2(NB.z - TR.z, TR.y - NB.y))))
    zfloor = P[ax < xr][:, 2].min()
    org = Vector((0, SH.y, SH.z))
    LEGV = set()
    print('INFO soar: wing root x %.3f, wrist x %.3f, semi-span %.3f, body height %.3f, tail root y %.3f, neck y %.3f, levelled %.1f deg' % (xr, xw, semi, T0, y_t, y_nb, PITCH))
else:
    # ---- feet and legs ----
    low = P[:, 2] < 0.03
    if low.sum() < 6: raise SystemExit(f'{SPECIES}: nothing on the floor (not standing?)')
    lx = np.sort(P[low, 0]); gap, xmid = 0, 0.0
    for a, b in zip(lx, lx[1:]):
        if b - a > gap and lx[0] < (a + b) / 2 < lx[-1]: gap, xmid = b - a, (a + b) / 2
    feet_y = P[low, 1].mean()
    # each leg traced up its column from the foot: slice by slice (2% of the length), the vertices near the column's axis;
    # the leg's top (where it enters the feathers: the knee) is the first slice where that neighbourhood suddenly widens
    # (the body, or a drooping wingtip or tail beside the leg) past 2.5 times the leg's own radius below it
    zmax = P[:, 2].max(); LEGV = set(); piv_leg = {}; tops = {}
    for side in (True, False):
        foot = P[low & ((P[:, 0] > xmid) == side)]
        if not len(foot): continue
        c = foot[:, :2].mean(0); radii = []; axis = []; top = None
        for z in np.arange(0.04, 0.8 * zmax, 0.02):
            q = P[(P[:, 2] >= z) & (P[:, 2] < z + 0.02) & ((P[:, 0] > xmid) == side)]   # this side's (not the other leg)
            q = q[((q[:, :2] - c) ** 2).sum(1) < 0.3 ** 2]
            if not len(q): break
            d = np.sqrt(((q[:, :2] - c) ** 2).sum(1))
            near = q[d < max(0.05, 2.5 * (np.median(radii) if radii else 0.04))]
            r90 = float(np.percentile(d, 90))
            if len(radii) >= 3 and r90 > max(0.1, 2.5 * np.median(radii)): top = z; break
            if len(near): c = near[:, :2].mean(0)
            radii.append(max(0.01, float(np.percentile(np.sqrt(((near[:, :2] - c) ** 2).sum(1)), 90)) if len(near) else r90))
            axis.append((z, c.copy()))
        if top is None or len(axis) < 3: continue
        rl = float(np.median(radii))
        def ax_at(z):
            return min(axis, key=lambda t: abs(t[0] - z))[1]
        for i in range(len(V)):
            pz = P[i, 2]
            if pz >= top or (P[i, 0] > xmid) != side: continue
            if pz < 0.04 or np.sqrt(((P[i, :2] - ax_at(pz)) ** 2).sum()) < 3 * rl + 0.02: LEGV.add(i)
        cc = ax_at(top - 0.02); piv_leg[side] = Vector((cc[0], cc[1], top)); piv_leg[(side, 'r')] = max(0.02, 2 * rl); tops[side] = top
    if len(tops) < 2: raise SystemExit(f'{SPECIES}: found {len(tops)} leg column(s), not 2 (legs together, or sitting?)')
    # the belly over the feet: the down-facing surface near the midline, its lower quarter (a stork's bare tibia rises
    # above its knee to it); the trunk's depth and the waterline are measured from it
    nz = np.array([v.normal.z for v in V])
    def belly_at(y):
        zs = np.sort(P[(np.abs(P[:, 0] - xmid) < 0.08) & (np.abs(P[:, 1] - y) < 0.08) & (P[:, 2] > max(tops.values())) & (nz < -0.5), 2])
        return zs[len(zs) // 4] if len(zs) else None
    bz = [b for b in (belly_at(feet_y + d) for d in (-0.08, 0.0, 0.08)) if b is not None]
    zcut = max(min(bz), min(tops.values())) if bz else min(tops.values())
    print('INFO legs: knees z %.3f %.3f, belly %.3f, feet y %.3f, split x %.3f (gap %.3f), %d leg vertices' % (tops[True], tops[False], zcut, feet_y, xmid, gap, len(LEGV)))
    upper = set(range(len(V))) - LEGV
    # ---- head and neck: geodesic rings from the bill tip ----
    cand = [i for i in upper]
    tip = min(cand, key=lambda i: P[i, 1] - 0.3 * P[i, 2])
    dh = geodesic([i for i in cand if np.linalg.norm(P[i] - P[tip]) < 0.015] or [tip], upper)
    dd, cen, rr = rings(dh)
    rb = float(np.percentile(rr, 90))   # the body's ring (the max can be a stray ring far down the tail or the feet)
    if '--debug' in argv: print('DEBUG head rings', [(round(a, 2), round(b, 3)) for a, b in zip(dd[::3], rr[::3])])
    # a neck: the first local maximum (the head) followed by a dip of more than 8% of it
    i_b = int(np.argmax(rr))   # the body's widest ring; the head and neck come before it
    i_b = next((i for i in range(len(rr)) if rr[i] >= rb), i_b)
    i_h = next((i for i in range(1, i_b) if rr[i] >= rr[i - 1] and rr[i] > rr[i + 1] and rr[i] < 0.9 * rb), None)
    i_n = None
    if i_h is not None:
        j = i_h
        while j + 1 < len(rr) and rr[j + 1] <= rr[j]: j += 1
        if rr[i_h] - rr[j] > 0.08 * rr[i_h]: i_n = j
    if i_n is not None:
        thr = rr[i_n] + 0.25 * (rb - rr[i_n]); i0 = i_n
    else:
        thr = 0.62 * rb; i0 = 0
    i_nb = next((i for i in range(i0, len(rr)) if rr[i] > thr), len(rr) - 1)
    D_NB = dd[i_nb]; NB = Vector(cen[i_nb])
    HEADC = Vector(P[np.isfinite(dh) & (dh < D_NB)].mean(0))
    print('INFO head: tip %s, neck %s, base at %.3f along (ring %.3f of body %.3f), pivot %s' % (
        [round(x, 3) for x in P[tip]], 'dip' if i_n is not None else 'none', D_NB, rr[i_nb], rb, [round(x, 3) for x in NB]))
    share = float((np.isfinite(dh) & (dh < D_NB)).sum()) / len(upper)
    if share > 0.4: raise SystemExit(f'{SPECIES}: the head part would hold {share:.0%} of the bird (no neck found: wings spread, or not side-on?)')
    # ---- tail: behind the rump, where the midline's depth falls under 0.35 of the body's over the feet ----
    U = P[sorted(i for i in upper if not (np.isfinite(dh[i]) and dh[i] < D_NB))]   # the trunk: no legs, no head and neck
    hw = float(np.percentile(np.abs(U[:, 0]), 97))
    topz = U[np.abs(U[:, 1] - feet_y) < 0.05, 2].max() if (np.abs(U[:, 1] - feet_y) < 0.05).any() else U[:, 2].max()
    midm = U[(np.abs(U[:, 0]) < 0.35 * hw) & (U[:, 2] > zcut - 0.15 * (topz - zcut))]   # the trunk's midline, not the bare legs below it
    def depth(y):
        q = midm[np.abs(midm[:, 1] - y) < 0.02]
        return (float(q[:, 2].min()), float(q[:, 2].max())) if len(q) > 2 else None
    # the trunk's deepest slice near the feet (the head and neck taken out: a goose's breast may go with them)
    dep = [(y, (lambda r: r[1] - r[0] if r else 0.0)(depth(y))) for y in np.arange(feet_y - 0.3, feet_y + 0.4, 0.02)]
    y0d, D0 = max(dep, key=lambda t: t[1])
    if D0 <= 0: D0 = 0.4
    Y_TR = next((y for y in np.arange(max(y0d, feet_y), midm[:, 1].max(), 0.01) if (lambda r: r and r[1] - r[0] < 0.35 * D0)(depth(y))), None)
    if Y_TR is None:   # a stubby tail under the folded wings (a goose's): half the depth, else the last eighth of the bird
        Y_TR = next((y for y in np.arange(max(y0d, feet_y), midm[:, 1].max(), 0.01) if (lambda r: r and r[1] - r[0] < 0.5 * D0)(depth(y))), None)
        how = 'depth, half'
        if Y_TR is None:
            Y_TR = float(U[:, 1].max() - 0.125 * np.ptp(U[:, 1])); how = 'the last eighth'
    else: how = 'depth'
    r = depth(Y_TR)
    TR = Vector((0.0, Y_TR, (r[0] + r[1]) / 2 if r else NB.z)); NB.x = 0.0
    print('INFO tail: root y %.3f (%s; body depth %.3f), pivot %s; head %.0f%% of the bird' % (Y_TR, how, D0, [round(x, 3) for x in TR], 100 * share))
    # ---- the shoulder for the cards: a fifth of the way from the neck base to the tail root, inside the back ----
    s0 = NB + (TR - NB) * 0.2
    q = P[(np.abs(P[:, 1] - s0.y) < 0.04) & np.array([i in upper for i in range(len(V))])]
    top = q[:, 2].max() if len(q) else s0.z; bot = q[:, 2].min() if len(q) else s0.z
    s0.z = min(s0.z, top - 0.15 * (top - bot))
    qz = q[np.abs(q[:, 2] - s0.z) < 0.08]
    SH = Vector((0.75 * (np.abs(qz[:, 0]).max() if len(qz) else 0.1), s0.y, s0.z))
    VOL = volume(); VOLB = VOL
    S = (MASS / RHO_STAND / VOL) ** (1 / 3); SIZE_BY = f'mass at {RHO_STAND:g} kg/m3 over the whole mesh'
    # body depth at the feet (for the waterline)
    qf = P[(np.abs(P[:, 1] - feet_y) < 0.05) & (P[:, 2] > zcut)]
    belly, back = (qf[:, 2].min(), qf[:, 2].max()) if len(qf) else (zcut, zcut + 0.4)
    WATERLINE = belly + 0.3 * (back - belly) if ARCH == 'water' else 0.0
    org = Vector((0, feet_y, WATERLINE))

# ---- into metres, the origin as above (a soarer levelled about it, then its lowest body point to z = 0) ----
if ARCH != 'soar': PITCH = 0.0
_c, _s = math.cos(math.radians(PITCH)), math.sin(math.radians(PITCH))
def sc0(p):
    y, z = p[1] - org.y, p[2] - org.z
    return Vector(((p[0] - org.x) * S, (_c * y - _s * z) * S, (_s * y + _c * z) * S))   # nose (-y) down by PITCH about x
LIFT = 0.0
if ARCH == 'soar': LIFT = -min(sc0(P[i]).z for i in np.where(np.abs(P[:, 0]) < SH.x)[0])
def sc(p): q = sc0(p); q.z += LIFT; return q
for v in V: v.co = sc(v.co)
me.update()
P = np.array([v.co[:] for v in V])
SH, NB, TR = sc(SH), sc(NB), sc(TR)
length = (P[:, 1].max() - P[:, 1].min())
print('INFO size by', SIZE_BY, 'volume %.4f (body %.4f) units, scale %.4f -> length %.3f m, height %.3f m, width %.3f m' % (
    VOL, VOLB, S, length, np.ptp(P[:, 2]), np.ptp(P[:, 0])))
SPAN_RULE = SPAN_C[ARCH] * MASS ** 0.39
if ARCH == 'soar':
    WR = sc(WR); SPAN = float(np.ptp(P[:, 0]))
    print('INFO span %.3f m (the span rule for a soarer, 1.4 M^0.39: %.3f m)' % (SPAN, SPAN_RULE))
    if not 0.7 < SPAN / SPAN_RULE < 1.45: print('WARN span %.2f m is far from the rule\'s %.2f m' % (SPAN, SPAN_RULE))
else:
    LP = {s: sc(p) for s, p in piv_leg.items() if not isinstance(s, tuple)}
    LR = {s: r * S for s, r in piv_leg.items() if isinstance(s, tuple)}
    ZC = (zcut - org.z) * S
    SPAN = 0.0 if FLIGHTLESS else SPAN_RULE
    print('INFO cards: span %.3f m (%s), shoulder %s' % (SPAN, 'flightless' if FLIGHTLESS else f'{SPAN_C[ARCH]} M^0.39', [round(x, 3) for x in SH]))

# ---- source colour, now in the final frame ----
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
base = min(3500, max(1000, 1200 + 800 * math.log10(MASS / 0.1)))
if ARCH == 'soar': base = max(base, 2000)
L0 = int(opt('--lod0') or base * (1 + 0.5 * PT))
TIERS = [('lod0', L0), ('lod1', int(L0 * 0.36)), ('lod2', max(120, int(L0 * 0.1)))]
print('INFO palette shares', [round(float((lab == k).mean()), 3) for k in range(K)], 'pattern %.4f -> tiers %s' % (PATTERN, TIERS))

def region_colour(pred, darkest_of=1):
    """The commonest palette colour over the source faces where pred(centre, normal) holds (in the final frame)."""
    votes = {}
    for i, (c, n) in enumerate(zip(CENTRES, NORMALS)):
        if pred(sc(c), n): votes[LAB[i]] = votes.get(LAB[i], 0) + 1
    if not votes: return None
    top = sorted(votes, key=votes.get, reverse=True)[:darkest_of]
    return PAL[min(top, key=lambda k: sum(PAL[k]))]

# ---- per-vertex part on the full mesh (decimation keeps vertex groups) ----
if ARCH == 'soar':
    xr_m, xw_m = SH.x, WR.x; ynb_m, yt_m = NB.y, TR.y
    def rig_full(i):
        p = P[i]; x = abs(p[0]); s = 1 if p[0] > 0 else -1
        if x > xw_m - 0.02 * S:
            return dict(part=HAND_L if s > 0 else HAND_R, partw=smooth(xw_m - 0.04 * S, xw_m + 0.06 * S, x), pivot=Vector((s * WR.x, WR.y, WR.z)))
        if x > xr_m - 0.01 * S:
            return dict(part=WING_L if s > 0 else WING_R, partw=smooth(xr_m - 0.01 * S, xr_m + 0.06 * S, x), pivot=Vector((s * SH.x, SH.y, SH.z)))
        if p[1] < ynb_m + 0.03 * S:
            return dict(part=HEAD, partw=smooth(ynb_m + 0.03 * S, ynb_m - 0.03 * S, p[1]), pivot=NB)
        if p[1] > yt_m - 0.03 * S:
            return dict(part=TAIL, partw=smooth(yt_m - 0.03 * S, yt_m + 0.04 * S, p[1]), pivot=TR)
        return dict(part=BODY, partw=0.0, pivot=Vector())
else:
    bl = 0.02 * S
    def rig_full(i):
        p = P[i]
        side = p[0] > xmid * S if i in LEGV else p[0] > 0
        pv = LP.get(side)
        if pv is not None and (i in LEGV or p[2] < pv.z + 2 * bl):
                r = LR[(side, 'r')] * 1.25; dxy = math.hypot(p[0] - pv.x, p[1] - pv.y)
                w = 1.0 if i in LEGV else smooth(pv.z + 2 * bl, pv.z - bl, p[2]) * (1 if dxy < r else smooth(r * 1.6, r, dxy))
                if w > 0: return dict(part=LEG_A if side else LEG_B, partw=w, pivot=pv)
        if np.isfinite(dh[i]) and dh[i] < D_NB + 0.04:
            return dict(part=HEAD, partw=smooth(D_NB + 0.04, D_NB - 0.04, dh[i]), pivot=NB)
        if i not in LEGV and p[1] > TR.y - 0.02 * S:
            return dict(part=TAIL, partw=smooth(TR.y - 0.02 * S, TR.y + 0.04 * S, p[1]), pivot=TR)
        return dict(part=BODY, partw=0.0, pivot=Vector())
RIG = [rig_full(i) for i in range(len(V))]
# loose pieces the remesh left apart (a quail's plume, a crest): the part of the nearest vertex of the main piece
comps = A.components(adj, range(len(V)))
if len(comps) > 1:
    main = comps[0]; kdm = KDTree(len(main))
    for i in main: kdm.insert(V[i].co, i)
    kdm.balance()
    for c in comps[1:]:
        # the whole piece goes with the part where it comes nearest the main piece (a floating plume with the head)
        j = min((kdm.find(V[i].co) for i in c), key=lambda h: h[2])[1]
        for i in c: RIG[i] = dict(RIG[j], partw=1.0 if RIG[j]['part'] else 0.0)
        if '--debug' in argv: print('DEBUG loose piece', len(c), 'vertices at', [round(x, 3) for x in V[c[0]].co], '-> part', RIG[c[0]]['part'], round(RIG[c[0]]['partw'], 2))
    print('INFO loose pieces', len(comps) - 1, 'joined to their nearest part')
GN = ('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p9', 'p10')
gp = {n: ob.vertex_groups.new(name=n) for n in GN}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
PIVOT_OF = {}
for r in RIG:
    if r['part'] and r['part'] not in PIVOT_OF: PIVOT_OF[r['part']] = r['pivot']
if ARCH != 'soar':
    PIVOT_OF[LEG_A] = LP.get(True); PIVOT_OF[LEG_B] = LP.get(False)

def face_color(p):
    c = p.center; rad = max(0.01 * S, math.sqrt(max(p.area, 1e-12)) * 0.75)
    hits = kd.find_range(c, rad)
    if len(hits) < 3: hits = kd.find_n(c, 6)
    votes = {}
    for _, i, d in hits: votes[LAB[i]] = votes.get(LAB[i], 0.0) + 1.0 / (0.002 * S + d)
    return PAL[max(votes, key=votes.get)]

# ---- the flight wing cards (standing birds) ----
def cards(level):
    if ARCH == 'soar' or SPAN <= 0: return None
    semi = SPAN / 2 - SH.x; arm = 0.45 * semi; hand = semi - arm
    cm = SPAN / ASPECT[ARCH]; cr, cw = 1.15 * cm, 1.0 * cm
    thick = 0.012 * cm
    tail_y = TR.y
    # colours: the folded wing (the flank above the middle, from the shoulder back), the folded primaries (its rear third),
    # the breast and belly below
    mid_z = (SH.z + ZC) / 2; L = tail_y - SH.y   # the shoulder to the tail root (+y is back)
    cov = region_colour(lambda c, n: abs(n.x) > 0.5 and c.z > mid_z and SH.y < c.y < SH.y + 0.6 * L) or PAL[0]
    fl = region_colour(lambda c, n: c.z > mid_z and abs(c.x) > 0.3 * SH.x and SH.y + 0.6 * L <= c.y < tail_y + 0.15 * L, 2) or cov
    und = region_colour(lambda c, n: n.z < -0.4 and c.z > ZC and abs(c.y - SH.y) < 0.5 * L) or cov
    HANDS = {'round': [(0, -0.25), (0.5, -0.22), (0.85, -0.08), (1.0, 0.2), (0.9, 0.5), (0.55, 0.72), (0, 0.75)],
             'broad': [(0, -0.25), (0.6, -0.24), (0.95, -0.15), (1.0, 0.25), (0.95, 0.62), (0.6, 0.76), (0, 0.75)],
             'pointed': [(0, -0.25), (0.6, -0.2), (1.0, 0.1), (0.75, 0.42), (0.3, 0.68), (0, 0.75)]}
    out = []   # (polygon [Vector], top colour, under colour, part, pivot)
    for s in (1, -1):
        sh = Vector((s * SH.x, SH.y, SH.z)); wr = Vector((s * (SH.x + arm), SH.y, SH.z))
        # Blender: forward is -y; chord fractions u run aft from the leading edge (u = -0.25 at the leading edge of the quarter chord)
        P0 = lambda t, u, c: Vector((s * (SH.x + t * arm), SH.y + u * c, SH.z))
        aw, hw = (WING_L, HAND_L) if s > 0 else (WING_R, HAND_R)
        if level < 2:
            out.append(([P0(0, -0.25, cr), P0(1, -0.25, cw), P0(1, 0.2, cw), P0(0, 0.2, cr)], cov, und, aw, sh))
            out.append(([P0(0, 0.2, cr), P0(1, 0.2, cw), P0(1, 0.75, cw), P0(0, 0.75, cr)], fl, und, aw, sh))
        else:
            out.append(([P0(0, -0.25, cr), P0(1, -0.25, cw), P0(1, 0.75, cw), P0(0, 0.75, cr)], cov, und, aw, sh))
        out.append(([Vector((s * (SH.x + arm + a * hand), SH.y + b * cw, SH.z)) for a, b in HANDS[HAND_SHAPE[ARCH]]], fl, und, hw, wr))
    return out, thick

def add_cards(t, level):
    r = cards(level)
    if not r: return
    polys, thick = r
    def tri(a, b, c, col, part, piv):
        for q in (a, b, c):
            t['pos'].append(A.to3(q)); t['col'].append(col); t['part'].append(float(part)); t['partw'].append(1.0); t['piv'].append(A.to3(piv))
            t['idx'].append(len(t['pos']) - 1)
    for poly, ct, cu, part, piv in polys:
        up = Vector((0, 0, thick / 2))
        topv = [p + up for p in poly]; botv = [p - up for p in poly]
        for k in range(1, len(poly) - 1):
            tri(topv[0], topv[k], topv[k + 1], ct, part, piv)
            tri(botv[0], botv[k + 1], botv[k], cu, part, piv)

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target, symmetry=True)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in GN if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); piv = PIVOT_OF.get(part, Vector())
        if part in (LEG_A, LEG_B) and piv is None: part, piv = 0, Vector()
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, face_color, lambda i: R[i])
    bpy.data.objects.remove(o)
    add_cards(t, int(name[-1]))
    print('INFO tier', name, 'from', n0, 'to', len(t['idx']) // 3, 'triangles with the cards')
    tiers.append((name, t))

to3l = lambda p: [round(x, 4) for x in A.to3(p)]
common = traits.get('common') or SPECIES
rig = {'kind': 'bird', 'archetype': ARCH, 'head': to3l(NB), 'tail': to3l(TR), 'length_m': round(float(length), 3)}
if ARCH == 'soar':
    rig.update(wing=to3l(SH), wrist=to3l(WR), span_m=round(SPAN, 3))
else:
    if SPAN > 0:
        rig.update(wing=to3l(SH), wrist=to3l(Vector((SH.x + 0.45 * (SPAN / 2 - SH.x), SH.y, SH.z))), span_m=round(SPAN, 3))
    rig['height_m'] = round(float(P[:, 2].max()), 3)
    if LP.get(True): rig['hip'] = to3l(LP[True])
    if ARCH == 'water':
        rig.update(waterline_m=0.0, draft_m=round(float(-P[:, 2][[i for i in range(len(V)) if i not in LEGV]].min()), 3), feet_y_m=round(float(P[:, 2].min()), 3))
A.write_glb(OUT, tiers, 'wild-earth tools/build_bird.py (Blender)',
            f'{common} generated with Meshy (meshy.ai), task {TASK}, for Wild Earth; CC BY-SA 4.0; scaled, coloured from its texture, decimated',
            extras={'species': SPECIES, 'size_by': SIZE_BY, 'mass_kg': MASS, 'archetype': ARCH, 'meshy_task': TASK, 'colour': COLOR_SRC,
                    'build': 'tools/build_bird.py', 'flightless': FLIGHTLESS, 'rig': rig,
                    'parts': 'BODY 0, LEG_A 1 (left), LEG_B 2 (right), TAIL 3, WING_L 4, WING_R 5, HEAD 6, HAND_L 9, HAND_R 10'})
