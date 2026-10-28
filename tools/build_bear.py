# Build client/assets/bear.glb, the American black bear (Ursus americanus) of the Sierra, from a Meshy text-to-3D preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model "latest" (meshy-7.1), triangle remesh to
# 20,000 faces, task 01a1814a-bb04-7644-bd83-16c7c1947527 (prompt A of library/animals/drafts/ursus_americanus.md),
# run by agent (Claude) for Aaron Brodeur on 2026-10-28 UTC. Record (prompt, cost, checksums):
# library/animals/jobs/ursus_americanus/01a1814a-bb04-7644-bd83-16c7c1947527/job.json. Paid-plan API output, owned
# by the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA 4.0;
# credit "generated with Meshy". The mesh carried no Meshy metadata to keep (Terms 2.4).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_bear.py -- \
#       library/animals/jobs/ursus_americanus/01a1814a-bb04-7644-bd83-16c7c1947527/model.glb client/assets/bear.glb
#
# What it does: turns the head back to the midline (the generator turned it about 17 degrees to the bear's left: the
# nose 0.1 units off the midline, the ears staggered), about a vertical axis behind the ears, blended over the neck;
# lengthens the whole bear 1.12x nose to tail (the preview is a little short in the body for a black bear: 1.18 m nose
# to rump at 0.8 m at the shoulder, now ~1.32 m); finds the parts from the geometry (no skeleton) as
# tools/build_cougar.py does: the tail is the stub at the rump (the points within ~8 cm of its farthest point), the
# legs are what lies below the belly line between the feet (pivots there: elbow and stifle), the head is what lies
# ahead of a vertical plane at the neck's base, kept off the chest and the tops of the forelegs; weights blended over
# 5-12 cm. Origin centred between the feet; scales to 0.8 m at the withers (the brief: Sierra bears 0.7-0.9 m). Colour
# from the brief's palette by region with faint per-face noise: dark brown body, darker back and darker legs, a little
# lighter belly, tan muzzle to the eyes, black nose pad, dark eyes, lighter inner ears. Decimates (collapse, X symmetry)
# to lod0 ~3,000, lod1 ~1,200 and lod2 ~350 triangles (the head decimated last). Rig, quadruped template Q: BODY 0, LEG_A 1 (left fore, right hind),
# LEG_B 2, TAIL 3 (the stub, pivot at its root), HEAD 6 (neck and head, pivot at the neck's base). No TAIL_TIP.
import bpy, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 3000), ('lod1', 1200), ('lod2', 350)]
WITHERS = 0.8
STRETCH = 1.12
POSE_X = 0.3        # the client's pose.x (RIG.bear): the legs' squash at pose 1, for the bedded drop

ob = A.import_glb_mesh(SRC)
me = ob.data
V = me.vertices
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0
ymin0 = min(v.co.y for v in V)

# ---- the head turned to the bear's left: turn it back about a vertical axis on the midline behind the ears ----
nose0 = sum((v.co for v in V if v.co.y < ymin0 + 0.03), Vector()) / sum(1 for v in V if v.co.y < ymin0 + 0.03)
zt = max(v.co.z for v in V)
ear_pts = [v.co for v in V if v.co.z > zt - 0.15 and v.co.y < ymin0 + 0.45]
eL = max((p for p in ear_pts if p.x > 0), key=lambda p: p.z); eR = max((p for p in ear_pts if p.x < 0), key=lambda p: p.z)
em = (eL + eR) / 2
d = (em - nose0); d.z = 0; d.normalize()
yp = nose0.y + d.y * (-nose0.x / d.x) if abs(d.x) > 1e-4 else em.y      # where the nose-to-ears line crosses x = 0
phi_n = -math.atan2(nose0.x, yp - nose0.y)                                 # turns the nose onto the midline
phi_e = -math.atan2(eL.y - eR.y, eL.x - eR.x)                              # levels the ears across the head
PHI = (phi_n + phi_e) / 2
P0 = Vector((0, yp, 0))
for v in V:
    w = A.smooth(yp + 0.07, yp - 0.08, v.co.y)
    if w <= 0: continue
    R = Matrix.Rotation(PHI * w, 3, 'Z')
    q = v.co - P0; q.z = 0
    r = R @ q
    v.co.x, v.co.y = r.x + P0.x, r.y + P0.y
me.update()
nose1 = sum((v.co for v in V if v.co.y < ymin0 + 0.03), Vector()) / max(1, sum(1 for v in V if v.co.y < ymin0 + 0.03))
print('INFO head turn: pivot y', round(yp, 3), 'deg', round(math.degrees(PHI), 1), '(nose', round(math.degrees(phi_n), 1), 'ears', round(math.degrees(phi_e), 1),
      ') nose x', round(nose0.x, 3), '->', round(nose1.x, 3))

# ---- longer in the body ----
for v in V: v.co.y *= STRETCH
me.update()
adj = A.adjacency(me)

# ---- the tail: the stub at the rump ----
rear = sorted(V, key=lambda v: -v.co.y)[:12]
TT = sum((v.co for v in rear), Vector()) / len(rear)
tailset = {v.index for v in V if v.co.y > TT.y - 0.09 and (v.co - TT).length < 0.1 and abs(v.co.x) < 0.09}
TAILP = Vector((0, TT.y - 0.07, TT.z))
print('INFO tail stub end', [round(x, 3) for x in TT], 'vertices', len(tailset))

# ---- feet and leg cuts ----
low = [v for v in V if v.co.z < 0.03 and v.index not in tailset]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / sum(1 for v in low if v.co.y < ymid)
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / sum(1 for v in low if v.co.y >= ymid)
def belly_at(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y) < 0.03 and v.index not in tailset]
    return min(zs)
zcut_f = zcut_h = belly_at((yff + yfh) / 2) - 0.03
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
fore_front = min(V[i].co.y for k, vs in legs.items() if k[0] for i in vs)

# ---- head: ahead of a vertical plane at the neck's base, kept off the chest and the forelegs ----
nose = min(V, key=lambda v: v.co.y).co.copy()
y_nb = fore_front - 0.04
mid = [v.co for v in V if abs(v.co.x) < 0.04 and abs(v.co.y - y_nb) < 0.03 and v.index not in tailset]
NB = Vector((0, y_nb, (max(p.z for p in mid) + min(p.z for p in mid)) / 2))
NDIR = Vector((0, -1, 0))
ZG = (NB.z - 0.3, NB.z - 0.18)       # below this, behind the leg fronts, it is chest and leg, not neck
# withers: the top of the back over the forelegs' pivots
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top = max(v.co.z for v in V if abs(v.co.y - yw) < 0.04 and abs(v.co.x) < 0.05)
S = WITHERS / top
yorg = (yff + yfh) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
for k in list(pivots):
    if len(k) == 2: pivots[k] = sc(pivots[k])
    else: pivots[k] = pivots[k] * S
NB = sc(NB); nose = sc(nose); TT = sc(TT); TAILP = sc(TAILP); ZF = zcut_f * S; fore_front = (fore_front - yorg) * S
ZG = (ZG[0] * S, ZG[1] * S)
me.update()
crown = max(v.co.z for v in V if abs(v.co.x) < 0.015 and v.co.y < NB.y)
ear_top = max(v.co.z for v in V if v.co.y < NB.y)
ear_y = sum(v.co.y for v in V if v.co.y < NB.y and v.co.z > ear_top - 0.02) / max(1, sum(1 for v in V if v.co.y < NB.y and v.co.z > ear_top - 0.02))
drop = ZF * (1 - POSE_X)
print('LANDMARKS withers', WITHERS, 'scale', round(S, 4), 'nose to rump', round(TT.y - nose.y, 3), 'tail end', [round(x, 3) for x in TT],
      'nose', [round(x, 3) for x in nose], 'crown z', round(crown, 3), 'ear top z', round(ear_top, 3), 'ear y', round(ear_y, 3),
      'neck base', [round(x, 3) for x in NB], 'leg pivot z', round(ZF, 3), 'bedded drop', round(drop, 3),
      'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 3) for x in p] for k, p in pivots.items() if len(k) == 2})

# ---- per-vertex rig on the full mesh (decimation keeps vertex groups, so carry it in groups) ----
ysplit = (pivots[(True, True)].y + pivots[(False, True)].y) / 2
def rig_full(i):
    p = V[i].co
    if i in tailset:
        return dict(part=3, partw=A.smooth(TAILP.y, TAILP.y + 0.03, p.y), pivot=TAILP)
    best = None
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p.x > 0) != k[1] or (p.y < ysplit) != k[0]: continue
        dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
        w = 1.0 if p.z < pv.z - 0.03 else A.smooth(pv.z + 0.07, pv.z - 0.03, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: best = (w, k)
    if best:
        w, (fore, left) = best
        return dict(part=1 if fore == left else 2, partw=w, pivot=pivots[(fore, left)])
    dd = (p - NB).dot(NDIR)
    wh = A.smooth(-0.03, 0.09, dd)
    if wh > 0 and p.y > fore_front - 0.04: wh *= A.smooth(ZG[0], ZG[1], p.z)
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
bk = ob.vertex_groups.new(name='bk')   # everything but the head, for the far tier's second pass
for i, r in enumerate(RIG):
    bk.add([i], 1.0 - (r['partw'] if r['part'] == 6 else 0.0), 'REPLACE')

# ---- palette (sRGB, brief) ----
BODY, BACK, LEGS, BELLY, TAN, NOSE, EAR_IN, EYE = 0x45301f, 0x36261b, 0x2b201a, 0x50392a, 0xa8845e, 0x1d1714, 0x4c3a2e, 0x140e0a
# the eye: on the side of the head just behind the stop (68% of the way from the nose tip to the ears, 45% of the height from nose to crown),
# where a ray from the bear's left side meets the head
from mathutils.bvhtree import BVHTree
EYE_Y = nose.y + 0.68 * (ear_y - nose.y)
EYE_Z = nose.z + 0.45 * (crown - nose.z)
hit = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get()).ray_cast(Vector((1.0, EYE_Y, EYE_Z)), Vector((-1, 0, 0)), 2.0)[0]
EYE_P = Vector((hit.x if hit is not None else 0.06, EYE_Y, EYE_Z))
print('LANDMARKS eye', [round(x, 3) for x in EYE_P])
def face_color(m, p, R):
    c = p.center; n = p.normal
    g = lambda col, a=0.06: A.grizzle(col, c, a, 0.03)
    parts = [R[i]['part'] for i in p.vertices]
    if all(x == 3 for x in parts): return g(BACK)
    if c.y < NB.y + 0.02 and sum(1 for x in parts if x == 6) * 2 >= len(parts):
        q = Vector((abs(c.x), c.y, c.z))
        if p.index in EYES: return A.srgb2lin(EYE)
        if c.z > crown + 0.006 and abs(c.x) > 0.03:     # ears
            return g(EAR_IN, 0.04) if n.y < -0.25 else g(BACK)
        if c.y < nose.y + 0.022 and c.z > nose.z - 0.025 and n.y < -0.2: return A.srgb2lin(NOSE)
        # the tan muzzle, to the eyes on top and a little past them below
        lim = EYE_Y - 0.04 if c.z > EYE_Z - 0.005 else EYE_Y - 0.005
        t = A.smooth(lim - 0.03, lim + 0.012, c.y)
        if t < 1: return g(A.mix(TAN, BODY, t), 0.05)
        if n.z > 0.5: return g(BACK)
        return g(BODY)
    if any(x in (1, 2) for x in parts) and c.z < max(ZF, 0) + 0.03:
        t = A.smooth(ZF - 0.12, ZF + 0.03, c.z)
        return g(A.mix(LEGS, BODY, 0.6 * t), 0.05)
    if n.z < -0.45: return g(BELLY, 0.05)
    if n.z > 0.6: return g(BACK)
    return g(BODY)

tiers = []
for name, target in TIERS:
    # the head kept back (a plain collapse takes the smooth, low-poly head first and leaves the fur); for lod2 that
    # would keep ~800 triangles of head, so the head then goes down in a second pass with the body kept
    if name == 'lod2':   # two passes: the body down with the head kept, then the head down on its own
        o1, n0 = A.tier_copy(ob, target, protect='p6')
        o, _ = A.tier_copy(o1, target + 110, protect='bk')
        bpy.data.objects.remove(o1)
    else: o, n0 = A.tier_copy(ob, target, protect='p6', protect_factor=0.6)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    # the eyes: the face nearest the eye point on each side (the faces are larger than an eye at every tier)
    EYES = {min((p for p in m.polygons if p.center.x * sd > 0), key=lambda p: (Vector((abs(p.center.x), p.center.y, p.center.z)) - EYE_P).length).index for sd in (1, -1)}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part == 3: piv = TAILP
        elif part == 6: piv = NB
        else: piv = pivots[(co.y < ysplit, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, lambda p: face_color(m, p, R), lambda i: R[i])
    bpy.data.objects.remove(o)
    tiers.append((name, t))
to3l = lambda p: [round(x, 4) for x in A.to3(p)]
A.write_glb(OUT, tiers, 'wild-earth tools/build_bear.py (Blender)',
            'American black bear generated with Meshy (meshy.ai), text-to-3D preview task 01a1814a-bb04-7644-bd83-16c7c1947527, for Wild Earth; CC BY-SA 4.0; head turned to the midline, lengthened, recoloured, decimated',
            extras={'species': 'ursus_americanus', 'withers_m': WITHERS, 'stretch': STRETCH, 'meshy_task': '01a1814a-bb04-7644-bd83-16c7c1947527',
                    'rig': {'kind': 'quadruped', 'tail': to3l(TAILP), 'head': to3l(NB),
                            'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]), 'length_m': round(TT.y - nose.y, 3),
                            'drop': round(drop, 3)},
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (the stub), HEAD 6'})
