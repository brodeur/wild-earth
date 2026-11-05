# Build client/assets/otter.glb, the ambient North American river otter (Lontra canadensis), from a Meshy text-to-3D
# preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model "latest" (meshy-7.1), triangle remesh to
# 20,000 faces, task 01a1ad35-8f53-75f8-9682-8cb53caec1c9, run by agent (Claude) for Aaron Brodeur on 2026-11-05 UTC.
# Prompt: "A North American river otter (Lontra canadensis), NOT a sea otter, NOT a beaver, NOT a mink. One adult
# standing on all four short legs on flat ground, side-on neutral pose, legs with clear gaps between them, webbed feet
# flat. Realistic proportions: 1.1 m long including a thick tapering tail of 40 cm that is broad at the base, a long
# sleek cylindrical body with the back gently arched, a broad flat head on a thick neck, small rounded ears, a blunt
# muzzle with a whisker pad, small eyes high on the head. Dark glossy brown fur, a paler silvery-brown throat and chin.
# The tail held straight out behind, touching nothing. No base, no ground, no water. Game-ready." Record (prompt, cost,
# checksums): library/animals/jobs/lontra_canadensis/01a1ad35-8f53-75f8-9682-8cb53caec1c9/job.json. Paid-plan API
# output, owned by the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA
# 4.0; credit "generated with Meshy (meshy.ai)". The mesh carried no Meshy metadata to keep (Terms 2.4: asset.generator
# only).
#
# Rebuild (Blender 4.1, from the repo root), then skin it and bake its clips:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_otter.py -- \
#       library/animals/jobs/lontra_canadensis/01a1ad35-8f53-75f8-9682-8cb53caec1c9/model.glb client/assets/otter.glb
#   arch -arm64 .venv/bin/python tools/rig_quadruped.py client/assets/otter.glb
#   ~/.nvm/versions/node/v24.13.0/bin/node tools/bake_gait.mjs client/assets/otter.glb --tile utm10n_429_5293
#
# What it does: drops the modelled whisker strands (thin tubes found by an inward ray cast, on the muzzle); finds the
# parts from the geometry as tools/build_cougar.py and tools/build_bear.py do (no skeleton): the tail is the piece behind
# a cut at the rump, its axis traced by edge distance from the cut; the legs are what lies below the belly line between
# the feet (pivots there: elbow and stifle); the head is what lies ahead of a plane at the neck base (half way from the
# neck's narrowest section to the front of the forelegs), kept off the chest. Scales to 0.28 m at the withers, 0.9x across (the preview is a broad, chunky otter); the
# trunk between the neck base and the tail root is stretched along the body (legs carried rigidly with their pivots) so
# that nose to tail root is 0.68 m, the long low weasel line; the hips lifted a little so the back arches highest there;
# the tail (which the preview laid on the ground) carried onto a straight axis on the midline held out behind and
# sloping gently down, lengthened to 0.42 m (thick at the root, tapering), its tip clear of the ground. Colour from the
# brief's palette by region with faint per-face noise: dark glossy brown back, warmer brown flanks, a little paler brown
# belly, silvery grey-brown chin, lips, whisker pad, cheeks below the eye and throat (onto the chest), dark feet, a black
# nose pad, small dark eyes on the sculpted eye globes (the face nearest each eye point and any within 4.5 mm, lod0 and
# lod1). Decimates (collapse, X symmetry; on lod0 and lod1 the head kept back a little and the legs' vertex rings at
# ~0.85 and ~0.45 of the elbow's height, where tools/rig_quadruped.py measures and bends the short legs) to lod0 ~2,400,
# lod1 ~1,000, lod2 ~300 triangles. Rig, quadruped template Q with the mountain lion's two-part tail: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner half, pivot at the root), TAIL_TIP 8
# (outer half, pivot mid-tail; a child of TAIL in the client's one-level parent chain, which reads the parent pivots
# from extras.rig), HEAD 6 (neck, head, ears; pivot at the neck base). extras.rig: kind, tail, tail_tip, head, fore,
# hind, length_m (as the mountain lion's). tools/rig_quadruped.py then adds the 20-joint skin.
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
JOB = '01a1ad35-8f53-75f8-9682-8cb53caec1c9'
TIERS = [('lod0', 2400), ('lod1', 1000), ('lod2', 300)]
WITHERS = 0.28        # m, top of the back over the forelegs
HEADBODY = 0.68       # m, nose to tail root
TAIL_M = 0.42         # m, along the tail's axis
XS = 0.9              # across: the preview is broad
HIP_LIFT = 0.012      # m, the back raised over the hips (the arch highest there)
TAIL_ROOT = 0.25      # the tail's root thickened by this much, fading out by mid-tail

ob = A.import_glb_mesh(SRC)
ymin0 = min(v.co.y for v in ob.data.vertices)
A.drop_thin(ob, 0.008, region=lambda co: co.y < ymin0 + 0.3 and co.z > 0.0)     # the whiskers (thin strands, source units)
me = ob.data
V = me.vertices
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0
adj = A.adjacency(me)

# ---- tail: the component behind a cut at the rump that holds the farthest point and nothing wide ----
far = max(V, key=lambda v: v.co.y).index
yc = 0.2
while True:
    comps = A.components(adj, [v.index for v in V if v.co.y > yc])
    tail = next(c for c in comps if far in c)
    if max(abs(V[i].co.x) for i in tail) < 0.095: break
    yc += 0.01
tailset = set(tail)
roots = [i for i in tail if any(V[u].co.y <= yc for u in adj[i])]
TA, tfrac = A.tube_axis(me, adj, tail, roots)
print('INFO tail cut y', round(yc, 3), 'tail vertices', len(tail), 'axis points', len(TA))

# ---- feet and leg cuts ----
low = [v for v in V if v.co.z < 0.03 and v.index not in tailset]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / sum(1 for v in low if v.co.y < ymid)
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / sum(1 for v in low if v.co.y >= ymid)
def belly_at(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y) < 0.03 and v.index not in tailset]
    return min(zs)
zcut_f = zcut_h = belly_at((yff + yfh) / 2) - 0.02
print('INFO feet y fore/hind', round(yff, 3), round(yfh, 3), 'leg cuts z', round(zcut_f, 3))
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
fore_front = min(V[i].co.y for k, vs in legs.items() if k[0] for i in vs if V[i].co.z > zcut_f - 0.06)
ysplit0 = (pivots[(True, True)].y + pivots[(False, True)].y) / 2

# ---- head: ahead of a vertical plane just ahead of the forelegs, kept off the chest ----
nose = min(V, key=lambda v: v.co.y).co.copy()
# the neck base: half way from the narrowest section of the neck (behind the head) to the front of the forelegs
def depth_at(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y) < 0.015 and v.index not in tailset]
    return max(zs) - min(zs) if zs else 9.0
narrow = min((depth_at(nose.y + 0.12 + j * 0.01), nose.y + 0.12 + j * 0.01) for j in range(int((fore_front - nose.y - 0.12) / 0.01)))[1]
y_nb = (narrow + fore_front) / 2
mid = [v.co for v in V if abs(v.co.x) < 0.04 and abs(v.co.y - y_nb) < 0.03 and v.index not in tailset]
NB = Vector((0, y_nb, (max(p.z for p in mid) + min(p.z for p in mid)) / 2))
headv = [v.co for v in V if v.co.y < nose.y + 0.15]
headc = sum(headv, Vector()) / len(headv)
NDIR = (headc - NB).normalized()
# withers: the top of the back over the forelegs' pivots
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top = max(v.co.z for v in V if abs(v.co.y - yw) < 0.04 and abs(v.co.x) < 0.05)
S = WITHERS / top
yorg = (yff + yfh) / 2
print('INFO scale', round(S, 4), 'withers (source)', round(top, 3), 'neck narrowest y', round(narrow, 3), 'neck base y', round(y_nb, 3), 'fore front', round(fore_front, 3))

# ---- scale to metres: origin on the ground between the feet ----
def sc(p): return Vector((p.x * S * XS, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
TA = [sc(p) for p in TA]
for k in list(pivots):
    if len(k) == 2: pivots[k] = sc(pivots[k])
    else: pivots[k] = pivots[k] * S
NB = sc(NB); nose = sc(nose); ZF = zcut_f * S; fore_front = (fore_front - yorg) * S
NDIR = Vector((NDIR.x, NDIR.y, NDIR.z)).normalized()
ZG = (NB.z - 0.07, NB.z - 0.035)     # below this, behind the leg fronts, it is chest and leg, not neck
me.update()

# ---- leg weights (needed to carry the legs rigidly through the stretch) ----
def leg_w(p):
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p.x > 0) != k[1] or (p.y < (ysplit0 - yorg) * S) != k[0]: continue
        dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
        w = 1.0 if p.z < pv.z - 0.012 else A.smooth(pv.z + 0.025, pv.z - 0.012, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: return w, k
    return 0.0, None

# ---- the trunk stretched between the neck base and the tail root ----
YA, YB = NB.y, TA[0].y
K = 1 + (HEADBODY - (YB - nose.y)) / (YB - YA)
def ymap(y):
    if y < YA: return y
    if y > YB: return y + (YB - YA) * (K - 1)
    return YA + (y - YA) * K
print('INFO trunk stretch', round(K, 3), 'from', round(YA, 3), 'to', round(YB, 3))
pv_new = {k: Vector((p.x, ymap(p.y), p.z)) for k, p in pivots.items() if len(k) == 2}
for v in V:
    if v.index in tailset:
        v.co.y += (YB - YA) * (K - 1); continue
    w, k = leg_w(v.co)
    y_body = ymap(v.co.y)
    if k is not None:
        y_leg = v.co.y + pv_new[k].y - pivots[k].y
        v.co.y = y_body * (1 - w) + y_leg * w
    else:
        v.co.y = y_body
for k in pv_new: pivots[k] = pv_new[k]
TA = [Vector((p.x, p.y + (YB - YA) * (K - 1), p.z)) for p in TA]
# re-centre the origin between the fore and hind feet
fy = (pivots[(True, True)].y + pivots[(True, False)].y) / 2; hy = (pivots[(False, True)].y + pivots[(False, False)].y) / 2
dy = -(fy + hy) / 2
for v in V: v.co.y += dy
for k in pv_new: pivots[k] = pivots[k] + Vector((0, dy, 0))
TA = [p + Vector((0, dy, 0)) for p in TA]
NB = NB + Vector((0, dy, 0)); nose = nose + Vector((0, dy, 0)); fore_front += dy
# the hips lifted a little: a smooth bump over the hind leg columns, fading to nothing at the belly line
hy = (pivots[(False, True)].y + pivots[(False, False)].y) / 2
for v in V:
    if v.index in tailset: continue
    a = A.smooth(0.0, 1.0, 1 - min(1.0, abs(v.co.y - hy) / 0.16))
    b = A.smooth(ZF, ZF + 0.12, v.co.z)
    v.co.z += HIP_LIFT * a * b
me.update()

# ---- the tail: onto a straight axis on the midline, held out and sloping gently down, lengthened ----
L0 = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
KT = TAIL_M / L0
rad = [[] for _ in TA]
for i in tail:
    b = min(len(TA) - 1, int(tfrac[i] * len(TA)))
    rad[b].append((V[i].co - TA[b]).length)
RAD = [sum(r) / len(r) if r else 0.0 for r in rad]
cum = [0.0]
for i in range(len(TA) - 1): cum.append(cum[-1] + (TA[i + 1] - TA[i]).length * KT)
root = TA[0].copy(); tip_z = RAD[-1] + 0.022
NA = []
for i in range(len(TA)):
    t = cum[i] / cum[-1]
    z = root.z + (tip_z - root.z) * (1 - (1 - t) ** 1.6)
    NA.append(Vector((0.0, 0.0, z)))
# y from the arc lengths along the bent line
NA[0].y = root.y
for i in range(1, len(NA)):
    dz = NA[i].z - NA[i - 1].z; L = cum[i] - cum[i - 1]
    NA[i].y = NA[i - 1].y + math.sqrt(max(1e-12, L * L - dz * dz))
for i in tail:     # the root a little thicker (the otter's tail is broad where it leaves the body), tapering
    V[i].co = A.remap_along(TA, NA, V[i].co, 1.0, 1.0 + TAIL_ROOT * (1 - A.smooth(0.0, 0.55, tfrac.get(i, 0.0))))
TA = NA
me.update()
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
print('INFO tail source length', round(L0, 3), 'm, stretch', round(KT, 3), 'radius root/tip', round(RAD[0], 3), round(RAD[-1], 3))

acc = 0.0; TIP = TA[-1]
for i in range(len(TA) - 1):
    L = (TA[i + 1] - TA[i]).length
    if acc + L >= tail_len / 2: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((tail_len / 2 - acc) / L); break
    acc += L

crown = max(v.co.z for v in V if abs(v.co.x) < 0.01 and v.co.y < NB.y)
head_top = max(v.co.z for v in V if v.co.y < NB.y)
ear_pts = [v.co for v in V if v.co.y < NB.y and v.co.z > head_top - 0.012]
ear_y = sum(p.y for p in ear_pts) / len(ear_pts)
fy = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
withers = max(v.co.z for v in V if abs(v.co.y - fy) < 0.015 and abs(v.co.x) < 0.02)
hips = max(v.co.z for v in V if abs(v.co.y - hy) < 0.015 and abs(v.co.x) < 0.02)
midb = [v.co for v in V if abs(v.co.y) < 0.01 and v.index not in tailset]
belly = min(p.z for p in midb if abs(p.x) < 0.02)
width = 2 * max(abs(p.x) for p in midb)
print('LANDMARKS withers', round(withers, 3), 'hips', round(hips, 3), 'belly at mid', round(belly, 3), 'body width at mid', round(width, 3),
      'nose to tail root', round(TA[0].y - nose.y, 3), 'tail along axis', round(tail_len, 3), 'total', round(TA[0].y - nose.y + tail_len, 3),
      'tail tip z', round(TA[-1].z, 3), 'nose', [round(x, 3) for x in nose], 'crown z', round(crown, 3), 'ear top z', round(head_top, 3), 'ear y', round(ear_y, 3),
      'neck base', [round(x, 3) for x in NB], 'tail root', [round(x, 3) for x in TA[0]], 'tail tip pivot', [round(x, 3) for x in TIP],
      'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 3) for x in p] for k, p in pivots.items() if len(k) == 2})

# ---- per-vertex rig on the full mesh (decimation keeps vertex groups, so carry it in groups) ----
ysplit = (pivots[(True, True)].y + pivots[(False, True)].y) / 2
def rig_full(i):
    p = V[i].co
    if i in tailset:
        t = tfrac.get(i, 0.0)
        if t >= 0.5: return dict(part=8, partw=A.smooth(0.5, 0.62, t), pivot=TIP)     # TAIL_TIP, child of TAIL
        return dict(part=3, partw=A.smooth(0.0, 0.12, t), pivot=TA[0])
    best = None
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p.x > 0) != k[1] or (p.y < ysplit) != k[0]: continue
        dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
        w = 1.0 if p.z < pv.z - 0.012 else A.smooth(pv.z + 0.03, pv.z - 0.012, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: best = (w, k)
    if best:
        w, (fore, left) = best
        return dict(part=1 if fore == left else 2, partw=w, pivot=pivots[(fore, left)])
    dd = (p - NB).dot(NDIR)
    wh = A.smooth(-0.012, 0.035, dd)
    if wh > 0 and p.y > fore_front - 0.015: wh *= A.smooth(ZG[0], ZG[1], p.z)
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
# the head kept back a little, and the legs' vertex rings below the elbow / stifle and at the wrist / hock, where
# tools/rig_quadruped.py measures the leg's width and bends it (a plain collapse leaves the short legs a few long faces)
pg = ob.vertex_groups.new(name='protect')
def legring(z): return max(A.smooth(0.06, 0.0, abs(z / ZF - 0.85)), A.smooth(0.08, 0.0, abs(z / ZF - 0.45)))
for i, r in enumerate(RIG):
    w = 0.35 * r['partw'] if r['part'] == 6 else (0.8 * legring(V[i].co.z) if r['part'] in (1, 2) else 0.0)
    if w > 0: pg.add([i], w, 'REPLACE')
print('INFO parts', {k: sum(1 for r in RIG if r['part'] == k and r['partw'] > 0.5) for k in (0, 1, 2, 3, 6, 8)})

# ---- palette (sRGB, brief) ----
BACK, FLANK, PALE, NOSE, EYE, FEET = 0x3b2a1f, 0x4a3627, 0x9a8c7c, 0x111010, 0x0c0a09, 0x2a1f18
BELLY = A.mix(FLANK, PALE, 0.22)
from mathutils.bvhtree import BVHTree
# the eye: the sculpted globe on the side of the face, 40% of the way from the nose tip to the ears and a third of the
# height from the nose to the crown (read off side and front close-ups), where a ray from the otter's left meets it
EYE_Y = nose.y + 0.40 * (ear_y - nose.y)
EYE_Z = nose.z + 0.36 * (crown - nose.z)
hit = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get()).ray_cast(Vector((0.5, EYE_Y, EYE_Z)), Vector((-1, 0, 0)), 1.0)[0]
EYE_P = Vector((hit.x if hit is not None else 0.03, EYE_Y, EYE_Z))
print('LANDMARKS eye', [round(x, 3) for x in EYE_P])
fy_f = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
PALE_LINE = [(nose.y, nose.z - 0.002), (EYE_Y, EYE_Z - 0.007), (ear_y, EYE_Z - 0.012), (NB.y, NB.z - 0.025)]
def pale_line(y):
    if y <= PALE_LINE[0][0]: return PALE_LINE[0][1]
    for (y0, z0_), (y1, z1) in zip(PALE_LINE, PALE_LINE[1:]):
        if y <= y1: return z0_ + (z1 - z0_) * (y - y0) / (y1 - y0)
    return PALE_LINE[-1][1]
def face_color(m, p, R):
    c = p.center; n = p.normal
    g = lambda col, a=0.05: A.grizzle(col, c, a, 0.012)
    parts = [R[i]['part'] for i in p.vertices]
    if all(x in (3, 8) for x in parts):
        d, t, q = A.poly_nearest(c, TA)
        up = (c - q).normalized().z if (c - q).length > 1e-6 else 0
        if up > 0.35: return g(BACK)
        if up < -0.5: return g(A.mix(FLANK, PALE, 0.12))
        return g(A.mix(FLANK, BACK, 0.4))
    if c.y < NB.y + 0.01 and sum(1 for x in parts if x == 6) * 2 >= len(parts):
        if p.index in EYES: return A.srgb2lin(EYE)
        if (Vector((abs(c.x), c.y, c.z)) - EYE_P).length < 0.0045: return A.srgb2lin(EYE)
        # the nose pad: the top of the muzzle's tip
        if c.y < nose.y + 0.011 and nose.z - 0.004 < c.z < nose.z + 0.012 and n.y < -0.2: return A.srgb2lin(NOSE)
        # pale below a line from the nose pad back under the eye to the cheek below the ear, then down the neck to the
        # throat; the nose bridge, crown and the back of the neck stay dark
        zl = pale_line(c.y)
        if n.z < -0.5 or c.z < zl - 0.003: return g(PALE, 0.04)
        if c.z < zl + 0.003: return g(A.mix(PALE, FLANK, 0.5), 0.04)
        if n.z > 0.5: return g(BACK)
        return g(A.mix(FLANK, BACK, 0.3))
    if any(x in (1, 2) for x in parts) and c.z < ZF + 0.012:
        t = A.smooth(0.0, ZF, c.z)
        return g(A.mix(FEET, FLANK, 0.7 * t), 0.04)
    if n.z < -0.35:
        # the throat and chest pale ahead of the forelegs, the belly a paler brown behind
        t = A.smooth(fy_f - 0.03, fy_f + 0.04, c.y)
        return g(A.mix(PALE, BELLY, t), 0.04)
    if n.z > 0.55: return g(BACK)
    if n.z > 0.2: return g(A.mix(FLANK, BACK, 0.5))
    return g(FLANK)

tiers = []
for name, target in TIERS:
    if name == 'lod2': o, n0 = A.tier_copy(ob, target)
    else: o, n0 = A.tier_copy(ob, target, protect='protect', protect_factor=1.0 if name == 'lod0' else 0.6)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    EYES = set() if name == 'lod2' else {min((p for p in m.polygons if p.center.x * sd > 0), key=lambda p: (Vector((abs(p.center.x), p.center.y, p.center.z)) - EYE_P).length).index for sd in (1, -1)}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part == 3: piv = TA[0]
        elif part == 8: piv = TIP
        elif part == 6: piv = NB
        else: piv = pivots[(co.y < ysplit, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, lambda p: face_color(m, p, R), lambda i: R[i])
    print('TIER', name, len(t['idx']) // 3, 'triangles (from', n0, ')')
    bpy.data.objects.remove(o)
    tiers.append((name, t))
to3l = lambda p: [round(x, 4) for x in A.to3(p)]
A.write_glb(OUT, tiers, 'wild-earth tools/build_otter.py (Blender)',
            'North American river otter generated with Meshy (meshy.ai), text-to-3D preview task ' + JOB + ', for Wild Earth; CC BY-SA 4.0; whiskers dropped, body lengthened, tail straightened, recoloured, decimated',
            extras={'species': 'lontra_canadensis', 'withers_m': WITHERS, 'trunk_stretch': round(K, 3), 'width_scale': XS, 'meshy_task': JOB,
                    'rig': {'kind': 'quadruped', 'tail': to3l(TA[0]), 'tail_tip': to3l(TIP), 'head': to3l(NB),
                            'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]), 'length_m': round(TA[0].y - nose.y + tail_len, 3)},
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner half), TAIL_TIP 8 (outer half, child of TAIL), HEAD 6'})
