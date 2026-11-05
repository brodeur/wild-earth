# Build client/assets/bobcat.glb, the ambient bobcat (Lynx rufus; the dark, heavily spotted coastal form of the Pacific
# Northwest, L. r. fasciatus), a variant of the mountain lion.
#
# Source: variant of puma_concolor built from the mountain lion's Meshy source, no credits. That source: generated with
# Meshy (meshy.ai), text-to-3D preview, ai_model "latest" (meshy-7.1), triangle remesh to 20,000 faces, task
# 01a171bb-8cae-7690-a80d-04545b70957e (prompt B of library/animals/drafts/puma_concolor.md, the adult male: "A mountain
# lion (cougar, Puma concolor) of California, NOT an African lion, no mane, no spots. One adult male standing still,
# side-on neutral pose, ..."), run by agent (Claude) for Aaron Brodeur on 2026-10-25 UTC. Record (prompt, cost,
# checksums): library/animals/jobs/puma_concolor/01a171bb-8cae-7690-a80d-04545b70957e/job.json. Paid-plan API output,
# owned by the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA 4.0;
# credit "generated with Meshy (meshy.ai)". The mesh carried no Meshy metadata to keep (Terms 2.4).
#
# Rebuild (Blender 4.1, from the repo root), then skin it and bake its clips:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_bobcat.py -- \
#       library/animals/jobs/puma_concolor/01a171bb-8cae-7690-a80d-04545b70957e/model.glb client/assets/bobcat.glb
#   arch -arm64 .venv/bin/python tools/rig_quadruped.py client/assets/bobcat.glb
#   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs client/assets/bobcat.glb --tile utm10n_429_5293
#
# What it does: as tools/build_cougar.py, drops the whisker strands and finds the parts from the geometry (the tail behind
# a cut at the rump traced along its axis, the legs below the belly line with pivots there, the head ahead of a plane at
# the neck base). Then makes the lion a bobcat: the legs below the belly 1.04x (the lion's build has them 0.9x, so the
# bobcat stands ~16% higher on its legs for its size), the trunk between the leg columns 0.96x (compact); the long tail
# folded to a 14 cm stub at its root (every tail vertex carried to its arc station on a short straight axis held back and
# a little down, at the same angle around it, on a round profile 5 cm across with a rounded end); scales to 0.50 m at the
# withers. The head smaller and rounder (0.9x about its centre, the muzzle 0.85x in length), the ears 2.2x taller above
# the crown and pinched to points, each with a short black tuft (a thin four-sided cone, 2.4 cm), the cheek fur flared
# out and down into the facial ruff. Colour (the dark coastal form) by region with faint per-face noise: reddish-brown
# back, tawny grey-brown flanks, paler buff sides of the face; bold black spots hashed in space (round, symmetric in x)
# over the back and flanks and a few on the white belly, bars on the upper arms, thighs and upper legs and two inside
# each foreleg, all drawn by coverage (a face darkens by the share of its sample points inside a mark, so marks smaller
# than the far faces still show); white belly, chin, throat and inner legs; ear backs black with a white central spot;
# the stub barred black on top with a black tip above, white below; a white eye ring, a pinkish-brown nose, a dark line
# back across the ruff and two on the forehead, yellow-amber eyes (the face nearest each eye point and any within 6 mm,
# lod0 and lod1). Decimates (collapse, X symmetry; the head kept back a little, the tufts wholly) to lod0 ~2,400, lod1
# ~1,000, lod2 ~300 triangles. Rig, quadruped template Q: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (the
# stub, pivot at its root), HEAD 6 (neck, head, ears and tufts; pivot at the neck base). No TAIL_TIP. Parent pivots in
# extras.rig (kind, tail, head, fore, hind, length_m), as the bear's.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 2400), ('lod1', 1000), ('lod2', 300)]
WITHERS = 0.50
LEG = 1.04          # legs below the belly line (the lion's build: 0.9)
TRUNK = 0.96        # the trunk between the fore and hind leg columns, in length
STUB = 0.14         # m, the tail
HEAD_S, MUZZLE = 0.9, 0.85
EAR_Z = 2.2         # ear height above the crown
LION_EYE_YZ, LION_WITHERS, LION_LEG = (-0.478, 0.70), 0.72, 0.9   # tools/build_cougar.py's eye, read off the lion

ob = A.import_glb_mesh(SRC)
ymin0 = min(v.co.y for v in ob.data.vertices)
A.drop_thin(ob, 0.007, region=lambda co: co.y < ymin0 + 0.3 and co.z > 0.0)     # the whiskers
me = ob.data
V = me.vertices
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0
adj = A.adjacency(me)

# ---- tail: the component behind a cut at the rump that holds the farthest point and nothing wide (as the lion) ----
far = max(V, key=lambda v: v.co.y).index
yc = 0.3
while True:
    comps = A.components(adj, [v.index for v in V if v.co.y > yc])
    tail = next(c for c in comps if far in c)
    if max(abs(V[i].co.x) for i in tail) < 0.08: break
    yc += 0.01
tailset = set(tail)
roots = [i for i in tail if any(V[u].co.y <= yc for u in adj[i])]
TA, tfrac = A.tube_axis(me, adj, tail, roots)

# ---- feet and leg cuts (as the lion) ----
low = [v for v in V if v.co.z < 0.03 and v.index not in tailset]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / sum(1 for v in low if v.co.y < ymid)
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / sum(1 for v in low if v.co.y >= ymid)
def belly_at(y):
    return min(v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y) < 0.03 and v.index not in tailset)
zcut_f = zcut_h = belly_at((yff + yfh) / 2) - 0.03
legs = {}
for v in V:
    if v.index in tailset: continue
    fore, left = v.co.y < ymid, v.co.x > 0
    if v.co.z < (zcut_f if fore else zcut_h): legs.setdefault((fore, left), []).append(v.index)
pivots = {}
for k, vs in legs.items():
    zc = zcut_f if k[0] else zcut_h
    ring = [V[i].co for i in vs if V[i].co.z > zc - 0.03]
    c = sum(ring, Vector()) / len(ring)
    pivots[k] = Vector((c.x, c.y, zc))
    pivots[k + ('r',)] = max(((p.x - c.x) ** 2 + (p.y - c.y) ** 2) ** 0.5 for p in ring)
zl = (zcut_f + zcut_h) / 2
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top0 = max(v.co.z for v in V if abs(v.co.y - yw) < 0.04 and abs(v.co.x) < 0.05)
yorg = (yff + yfh) / 2
# the lion's eye (tools/build_cougar.py, metres) back in source units: its legs 0.9x below zl, 0.72 m at the withers
S_lion = LION_WITHERS / (top0 - (1 - LION_LEG) * zl)
EYE0 = Vector((0, LION_EYE_YZ[0] / S_lion + yorg, LION_EYE_YZ[1] / S_lion + (1 - LION_LEG) * zl))

# ---- longer legs, a shorter trunk ----
yF = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
yH = (pivots[(False, True)].y + pivots[(False, False)].y) / 2
def reshape(p):
    p = p.copy()
    p.z = p.z * LEG if p.z < zl else p.z + (LEG - 1) * zl
    # the trunk between the leg columns shortened; the fore end (legs, chest, head) moves back, the rump stays
    a, b = yF + 0.06, yH - 0.06
    if p.y < a: p.y += (b - a) * (1 - TRUNK)
    elif p.y < b: p.y = b - (b - p.y) * TRUNK
    return p
for v in V: v.co = reshape(v.co)
TA = [reshape(p) for p in TA]
for k in list(pivots):
    if len(k) == 2: pivots[k] = reshape(pivots[k])
EYE0 = reshape(EYE0)
zcut_f = zcut_h = zl * LEG
yff2 = reshape(Vector((0, yff, 0))).y; yfh2 = reshape(Vector((0, yfh, 0))).y

# ---- head: ahead of a plane at the neck base (as the lion) ----
nose = min(V, key=lambda v: v.co.y).co.copy()
y_nb = yff2 + 0.03
mid = [v.co for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y_nb) < 0.02 and v.index not in tailset]
NB = Vector((0, y_nb, (max(p.z for p in mid if p.z > zcut_f) + min(p.z for p in mid if p.z > zcut_f)) / 2))
headc = sum((v.co for v in V if v.co.y < nose.y + 0.2), Vector()) / sum(1 for v in V if v.co.y < nose.y + 0.2)
NDIR = (headc - NB).normalized()
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top = max(v.co.z for v in V if abs(v.co.y - yw) < 0.04 and abs(v.co.x) < 0.05)
S = WITHERS / top
yorg = (yff2 + yfh2) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
TA = [sc(p) for p in TA]
for k in list(pivots):
    if len(k) == 2: pivots[k] = sc(pivots[k])
    else: pivots[k] = pivots[k] * S
NB = sc(NB); nose = sc(nose); headc = sc(headc); EYE0 = sc(EYE0); ZF = ZH = zcut_f * S
me.update()

# ---- the tail folded to a stub: each vertex to its arc station on a short straight axis, at the same angle around it,
# on a round profile (the root's radius, a rounded end over the last quarter), so the end stays closed ----
lens = [(TA[i + 1] - TA[i]).length for i in range(len(TA) - 1)]; tail_len0 = sum(lens)
def axis_at(t):
    s = t * tail_len0; acc = 0.0
    for i, L in enumerate(lens):
        if acc + L >= s or i == len(lens) - 1:
            u = max(0.0, min(1.0, (s - acc) / L)); return TA[i] + (TA[i + 1] - TA[i]) * u, (TA[i + 1] - TA[i]).normalized()
        acc += L
DIR = Vector((0, 1, -0.5)).normalized()                      # back and a little down
ROOT = TA[0]
def perp(i):
    q, T = axis_at(tfrac.get(i, 0.0)); r = V[i].co - q
    return r - T * r.dot(T), T
rr = sorted(perp(i)[0].length for i in tailset if tfrac.get(i, 0.0) < 0.06)
R0 = 0.026                                                   # a bobcat's furred stub, ~5 cm across
print('INFO tail root radius', round(rr[len(rr) // 2], 4), '->', round(R0, 4))
for i in tailset:
    t = tfrac.get(i, 0.0); p = V[i].co
    r, T = perp(i)
    u = T.rotation_difference(DIR) @ r
    u = u.normalized() if u.length > 1e-6 else Vector((0, 0, 1))
    k = (t - 0.7) / 0.3
    rad = R0 * (1.0 - 0.12 * t) * (math.sqrt(max(0.0, 1 - k * k)) if k > 0 else 1.0)
    new = ROOT + DIR * (t * STUB) + u * rad
    V[i].co = p.lerp(new, A.smooth(0.0, 0.08, t))
TA = [ROOT + DIR * (STUB * k / 8) for k in range(9)]
TT = TA[-1]
me.update()

# ---- a smaller, rounder head; pointed ears; the ruff ----
HC = sum((v.co for v in V if v.co.y < nose.y + 0.12), Vector()) / sum(1 for v in V if v.co.y < nose.y + 0.12)
def head_w(p): return A.smooth(0.02, 0.1, (p - NB).dot(NDIR))
def head_map(p, w):
    q = HC + (p - HC) * HEAD_S
    if q.y < EYE0.y: q.y = EYE0.y + (q.y - EYE0.y) * MUZZLE
    return p.lerp(q, w)
EYE0 = head_map(EYE0, 1.0)
for v in V:
    w = head_w(v.co)
    if w > 0: v.co = head_map(v.co, w)
nose = min(V, key=lambda v: v.co.y).co.copy()
me.update()
crown = max(v.co.z for v in V if abs(v.co.x) < 0.012 and v.co.y < NB.y)
earv = {sd: [v for v in V if v.co.y < NB.y and v.co.z > crown and v.co.x * sd > 0.01] for sd in (1, -1)}
for sd, vs in earv.items():
    etop = max(v.co.z for v in vs)
    cx = sum(v.co.x for v in vs) / len(vs); cy = sum(v.co.y for v in vs) / len(vs)
    for v in vs:
        h = (v.co.z - crown) / (etop - crown)
        k = 1 - 0.45 * h * h
        v.co.x = cx + (v.co.x - cx) * k; v.co.y = cy + (v.co.y - cy) * k
        v.co.z = crown + (v.co.z - crown) * EAR_Z
me.update()
# the eye's x: on the surface at its y, z
ring = [v.co for v in V if abs(v.co.y - EYE0.y) < 0.006 and abs(v.co.z - EYE0.z) < 0.006 and v.co.x > 0]
EYE_P = Vector((max(c.x for c in ring), EYE0.y, EYE0.z))
ear_y = sum(sum(v.co.y for v in vs) / len(vs) for vs in earv.values()) / 2
# the ruff: cheek fur behind and below the eye, flared out and down
RUFF_C = (EYE_P.y + 0.6 * (ear_y - EYE_P.y) + 0.012, EYE_P.z - 0.03)
for v in V:
    p = v.co
    if p.y > NB.y + 0.01 or head_w(p) <= 0: continue
    sd = 1 if p.x > 0 else -1
    if v.normal.x * sd < 0.2: continue
    d = math.hypot((p.y - RUFF_C[0]) / 0.04, (p.z - RUFF_C[1]) / 0.032)
    w = A.smooth(1.0, 0.3, d) * head_w(p)
    if w > 0: v.co = p + Vector((sd * 0.011, 0.003, -0.008)) * w
me.update()
tips = {sd: max((v.co for vs in [earv[sd]] for v in vs), key=lambda c: c.z).copy() for sd in (1, -1)}

# ---- the ear tufts: a thin four-sided cone at each ear tip ----
nv0 = len(me.vertices)
bm = bmesh.new(); bm.from_mesh(me)
TUFT_L, TUFT_R = 0.024, 0.0032
for sd in (1, -1):
    tip = tips[sd]; d = Vector((0.12 * sd, 0.05, 1.0)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    mat = Matrix.Translation(tip + d * (TUFT_L / 2 - 0.004)) @ rot
    r = bmesh.ops.create_cone(bm, cap_ends=False, segments=4, radius1=TUFT_R, radius2=0.0, depth=TUFT_L, matrix=mat)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
TUFT_IDX = set(range(nv0, len(V)))      # bmesh keeps the old vertices' order and appends the new

head_top = max(v.co.z for v in V)
print('LANDMARKS withers', WITHERS, 'head-body (nose to tail root)', round(ROOT.y - nose.y, 3), 'tail (stub) along axis', STUB,
      'tail end', [round(x, 3) for x in TT], 'nose', [round(x, 3) for x in nose], 'crown z', round(crown, 3), 'ear tip z', round(max(t.z for t in tips.values()), 3),
      'tuft top z', round(head_top, 3), 'neck base', [round(x, 3) for x in NB], 'eye', [round(x, 3) for x in EYE_P],
      'length', round(max(v.co.y for v in V) - min(v.co.y for v in V), 3), 'width', round(2 * max(v.co.x for v in V), 3),
      'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 3) for x in p] for k, p in pivots.items() if len(k) == 2})

# ---- per-vertex rig on the full mesh (decimation keeps vertex groups, so carry it in groups) ----
ysplit = (pivots[(True, True)].y + pivots[(False, True)].y) / 2
def rig_full(i):
    p = V[i].co
    if i in TUFT_IDX: return dict(part=6, partw=1.0, pivot=NB)
    if i in tailset:
        return dict(part=3, partw=A.smooth(0.0, 0.25, (p - ROOT).dot(DIR) / STUB), pivot=ROOT)
    best = None
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p.x > 0) != k[1] or (p.y < ysplit) != k[0]: continue
        dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
        w = 1.0 if p.z < pv.z - 0.02 else A.smooth(pv.z + 0.045, pv.z - 0.02, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: best = (w, k)
    if best:
        w, (fore, left) = best
        return dict(part=1 if fore == left else 2, partw=w, pivot=pivots[(fore, left)])
    wh = A.smooth(-0.015, 0.07, (p - NB).dot(NDIR))
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
# the head kept back a little, the tufts wholly; and the legs' vertex rings below the elbow / stifle and at the wrist /
# hock, where tools/rig_quadruped.py measures the leg's width and bends it (a plain collapse leaves the foreleg one long
# face from the wrist to the chest)
pg = ob.vertex_groups.new(name='protect')
def legring(z): return max(A.smooth(0.05, 0.0, abs(z / ZF - 0.85)), A.smooth(0.07, 0.0, abs(z / ZF - 0.45)))
for i, r in enumerate(RIG):
    w = 1.0 if i in TUFT_IDX else (0.25 * r['partw'] if r['part'] == 6 else (0.8 * legring(V[i].co.z) if r['part'] in (1, 2) else 0.0))
    if w > 0: pg.add([i], w, 'REPLACE')

# ---- palette (sRGB): the dark coastal bobcat ----
BACK, BODY, GREY, FACE = 0x664430, 0x7f5a3f, 0x7c6b5b, 0xb89874
WHITE, BLACK, NOSE, EYE, EARW = 0xe9e3d8, 0x1d1612, 0xa66e60, 0xd29a26, 0xece8e0

def spot(c, cell=0.045, rmin=0.013, rmax=0.02, keep=1.0):
    """Hashed round spots, symmetric in x: one jittered centre a cell (kept with probability `keep`)."""
    q = Vector((abs(c.x), c.y, c.z))
    i0, j0, k0 = (math.floor(q[a] / cell) for a in range(3))
    for i in (i0 - 1, i0, i0 + 1):
        for j in (j0 - 1, j0, j0 + 1):
            for k in (k0 - 1, k0, k0 + 1):
                if A.hash01(i, j, k, 7) > keep: continue
                ctr = Vector(((i + A.hash01(i, j, k, 1)) * cell, (j + A.hash01(i, j, k, 2)) * cell, (k + A.hash01(i, j, k, 3)) * cell))
                r = rmin + (rmax - rmin) * A.hash01(i, j, k, 4)
                if (q - ctr).length < r: return True
    return False

def face_color(m, p, R):
    c = p.center; n = p.normal
    g = lambda col, a=0.05: A.grizzle(col, c, a, 0.02)
    parts = [R[i]['part'] for i in p.vertices]
    q = Vector((abs(c.x), c.y, c.z)); side = 1 if c.x > 0 else -1
    if all(x == 3 for x in parts):
        s = (c - ROOT).dot(DIR) / STUB
        up = (c - (ROOT + DIR * max(0.0, s) * STUB)).normalized().z
        if up < -0.3: return g(WHITE, 0.03)
        if s > 0.8: return A.srgb2lin(BLACK)
        if s > 0.3 and (s * 3.2) % 1 < 0.42 and up > 0.2: return A.srgb2lin(BLACK)
        return g(BODY)
    if p.index in TUFTF: return A.srgb2lin(BLACK)
    if c.y < NB.y and c.z > ZF and sum(1 for x in parts if x == 6) * 2 >= len(parts):
        if p.index in EYES: return A.srgb2lin(EYE)
        de = (q - EYE_P).length
        if EYES and de < 0.006: return A.srgb2lin(EYE)
        if EYES and de < 0.014 and abs(n.x) > 0.3: return g(WHITE, 0.02)                 # the white eye ring
        if c.z > crown + 0.003 and abs(c.x) > 0.015 and c.y > nose.y + 0.03:                # ears
            if n.y < -0.45: return g(A.mix(FACE, WHITE, 0.5), 0.03)                           # inside
            h = (c.z - crown) / max(1e-4, EAR_TOP - crown)
            if 0.2 < h < 0.6 and n.y > 0.4 and abs(abs(c.x) - EAR_X) < 0.012: return A.srgb2lin(EARW)    # the white spot on the black back
            return A.srgb2lin(BLACK)
        if c.y < nose.y + 0.01 and nose.z - 0.006 < c.z < nose.z + 0.012 and n.y < -0.3: return A.srgb2lin(NOSE)
        if n.z < -0.25 or (c.y < nose.y + 0.06 and c.z < nose.z - 0.008): return g(WHITE, 0.03)     # chin, muzzle, throat
        # the ruff: buff with two dark lines sweeping back from the eye
        dr = math.hypot((c.y - RUFF_C[0]) / 0.04, (c.z - RUFF_C[1]) / 0.032)
        if dr < 1.0 and abs(c.x) > 0.02:
            band = (c.z - RUFF_C[1] + 0.25 * (c.y - RUFF_C[0])) / 0.011
            if abs(band) < 0.2 and c.y > EYE_P.y + 0.014: return A.srgb2lin(A.mix(BLACK, FACE, 0.2))
            return g(A.mix(FACE, WHITE, 0.3 if c.z < RUFF_C[1] else 0.0))
        if n.z > 0.55:   # the forehead: dark lines back from between the eyes
            if c.y > EYE_P.y - 0.005 and abs(abs(c.x) - 0.009) < 0.004: return A.srgb2lin(A.mix(BLACK, BACK, 0.3))
            return g(A.mix(BACK, BODY, 0.4))
        if c.y < EYE_P.y + 0.01: return g(FACE)
        return g(A.mix(FACE, BODY, 0.5))
    legp = [x for x in parts if x in (1, 2)]
    if legp and c.z < ZF + 0.02:
        fore = c.y < ysplit
        if n.x * side < -0.35:      # inner legs white; two black bars inside the foreleg
            return marked(m, p, g(WHITE, 0.03), lambda x: fore and (0.55 < x.z / ZF < 0.63 or 0.73 < x.z / ZF < 0.81))
        h = c.z / ZF
        if h < 0.12: return g(A.mix(BODY, FACE, 0.5))     # the feet paler
        return marked(m, p, g(A.mix(BODY, GREY, 0.3 + 0.4 * (1 - h))),
                      lambda x: x.z / ZF > (0.55 if fore else 0.6) and ((x.z / ZF * (6.5 if fore else 5.5)) % 1) < 0.32, 0.85)
    if n.z < -0.45 or (n.z < -0.1 and c.z < ZF + 0.04):   # belly and chest: white, a few spots
        return marked(m, p, g(WHITE, 0.03), lambda x: spot(x, 0.07, 0.012, 0.018, 0.4))
    if c.y < NB.y + 0.04 and n.y < -0.4 and c.z < NB.z: return g(WHITE, 0.03)                # the throat and fore chest
    if n.z > 0.6: base = g(BACK)
    else:
        t = A.smooth(-0.2, 0.6, n.z)
        base = g(A.mix(GREY, BACK, t * 0.6) if c.z < NB.z - 0.06 else A.mix(BODY, BACK, t))
    pv = pivots[(c.y < ysplit, c.x > 0)]
    def mark(x):   # bold round spots; bars on the upper arm and thigh, over the leg columns
        if ZF < x.z < ZF + 0.08 and n.x * side > 0.3 and math.hypot(x.x - pv.x, x.y - pv.y) < 0.06 and ((x.z - ZF) / 0.026) % 1 < 0.38: return True
        return spot(x)
    return marked(m, p, base, mark, 0.95 if n.z < 0.7 else 0.8)

def marked(m, p, base, pred, strength=1.0):
    """The face's colour: base mixed toward black by the share of sample points (corners, edge midpoints, centre and
    between) where pred holds, so a mark smaller than the face still darkens it in proportion."""
    cs = [m.vertices[i].co for i in p.vertices]; c = p.center
    pts = cs + [(cs[k] + cs[(k + 1) % 3]) / 2 for k in range(3)] + [c] + [(c + x) / 2 for x in cs]
    f = sum(1 for x in pts if pred(x)) / len(pts)
    if f <= 0: return base
    k = min(1.0, f * 2.6) * strength; b = A.srgb2lin(BLACK)
    return tuple(base[j] + (b[j] - base[j]) * k for j in range(3))
EAR_TOP = max(t.z for t in tips.values()); EAR_X = abs(tips[1].x)

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target, protect='protect', protect_factor=1.0 if name == 'lod0' else 0.6)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    EYES = set() if name == 'lod2' else {min((p for p in m.polygons if p.center.x * sd > 0), key=lambda p: (Vector((abs(p.center.x), p.center.y, p.center.z)) - EYE_P).length).index for sd in (1, -1)}
    # the tufts: faces whose every vertex lies above the ear tips
    TUFTF = {p.index for p in m.polygons if min(m.vertices[i].co.z for i in p.vertices) > EAR_TOP - 0.006 and p.center.z > EAR_TOP}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part == 3: piv = ROOT
        elif part == 6: piv = NB
        else: piv = pivots[(co.y < ysplit, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, lambda p: face_color(m, p, R), lambda i: R[i])
    print('TIER', name, len(t['idx']) // 3, 'triangles (from', n0, ')', 'tuft faces', len(TUFTF))
    bpy.data.objects.remove(o)
    tiers.append((name, t))
to3l = lambda p: [round(x, 4) for x in A.to3(p)]
A.write_glb(OUT, tiers, 'wild-earth tools/build_bobcat.py (Blender)',
            'Bobcat, a variant of the mountain lion generated with Meshy (meshy.ai), text-to-3D preview task 01a171bb-8cae-7690-a80d-04545b70957e, for Wild Earth; CC BY-SA 4.0; legs lengthened, body shortened, tail cut to a stub, head reshaped with ear tufts and ruff, recoloured, decimated',
            extras={'species': 'lynx_rufus', 'withers_m': WITHERS, 'leg_scale': LEG, 'trunk_scale': TRUNK, 'variant_of': 'puma_concolor',
                    'meshy_task': '01a171bb-8cae-7690-a80d-04545b70957e',
                    'rig': {'kind': 'quadruped', 'tail': to3l(ROOT), 'head': to3l(NB),
                            'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]), 'length_m': round(ROOT.y - nose.y + STUB, 3)},
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (the stub), HEAD 6'})
