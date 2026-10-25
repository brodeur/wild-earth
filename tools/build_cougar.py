# Build client/assets/cougar.glb, the ambient mountain lion (Puma concolor), from a Meshy text-to-3D preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model "latest" (meshy-7.1), triangle remesh to
# 20,000 faces, task 01a171bb-8cae-7690-a80d-04545b70957e (prompt B of library/animals/drafts/puma_concolor.md,
# the adult male), run by agent (Claude) for Aaron Brodeur on 2026-10-25 UTC. Record (prompt, cost, checksums):
# library/animals/jobs/puma_concolor/01a171bb-8cae-7690-a80d-04545b70957e/job.json. Paid-plan API output, owned
# by the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA 4.0;
# credit "generated with Meshy". The mesh carried no Meshy metadata to keep (Terms 2.4).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_cougar.py -- \
#       library/animals/jobs/puma_concolor/01a171bb-8cae-7690-a80d-04545b70957e/model.glb client/assets/cougar.glb
#
# What it does: drops the modelled whisker strands (2-5 mm thick, found by an inward ray cast); finds the parts from the geometry (no skeleton): the tail is the
# piece behind a cut at the rump, its axis traced by edge distance from the cut; the legs are what lies below
# the chest and groin lines (pivots there: elbow and stifle); the head part is what lies ahead of a plane at
# the neck base, blended over ~10 cm. Legs below the belly 0.9x (a long, low cat); origin centred between the
# feet; scales to 0.72 m at the withers (between the brief's female 0.68 and male 0.75; scale instances 0.94x
# for a female, 1.04x for a male). Colour from the brief's palette by region with faint per-face noise: tawny
# body, darker back and tail top, cream muzzle, chin, throat, belly and inner legs, black whisker-base patches,
# ear backs and tail tip, pinkish nose, golden eye. Decimates (collapse, X symmetry) to lod0 ~3,000, lod1 ~1,200,
# lod2 ~350 triangles. Rig, quadruped template Q: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner
# half of the tail, pivot at the root), TAIL_TIP 8 (outer half, pivot mid-tail; a child of TAIL in the client's
# one-level parent chain, which reads the parent pivots from extras.rig), HEAD 6 (neck, head, ears).
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 3000), ('lod1', 1200), ('lod2', 350)]
WITHERS = 0.72
LEG = 0.9

ob = A.import_glb_mesh(SRC)
ymin0 = min(v.co.y for v in ob.data.vertices)
A.drop_thin(ob, 0.007, region=lambda co: co.y < ymin0 + 0.3 and co.z > 0.0)     # the whiskers (2-5 mm thick, source units)
me = ob.data
V = me.vertices
adj = A.adjacency(me)
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0
ymax = max(v.co.y for v in V)

adj = A.adjacency(me)
# ---- tail: the component behind a cut at the rump that holds the farthest point and nothing wide ----
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
print('INFO tail cut y', round(yc, 3), 'tail vertices', len(tail), 'axis points', len(TA))

# ---- feet and leg cuts ----
low = [v for v in V if v.co.z < 0.03 and v.index not in tailset]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / sum(1 for v in low if v.co.y < ymid)
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / sum(1 for v in low if v.co.y >= ymid)
def belly_at(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y) < 0.03 and v.index not in tailset]
    return min(zs)
print('INFO low vertex y histogram', sorted({round(v.co.y, 1) for v in low}))
# the forelegs stand close to the midline, so measure the belly between the legs and cut both pairs just below it
zcut_f = zcut_h = belly_at((yff + yfh) / 2) - 0.03
print('INFO feet y fore/hind', round(yff, 3), round(yfh, 3), 'leg cuts z', round(zcut_f, 3), round(zcut_h, 3))
def leg_of(p):   # quadrant: (fore?, left?)
    return (p.y < ymid, p.x > 0)
legs = {}
for v in V:
    if v.index in tailset: continue
    fore, left = leg_of(v.co)
    zc = zcut_f if fore else zcut_h
    if v.co.z < zc: legs.setdefault((fore, left), []).append(v.index)
pivots = {}
for k, vs in legs.items():
    zc = zcut_f if k[0] else zcut_h
    ring = [V[i].co for i in vs if V[i].co.z > zc - 0.03]
    c = sum(ring, Vector()) / len(ring)
    pivots[k] = Vector((c.x, c.y, zc))
    r = max(((p.x - c.x) ** 2 + (p.y - c.y) ** 2) ** 0.5 for p in ring)
    pivots[k + ('r',)] = r
# legs below the belly 0.9x: z map below the mean leg cut
zl = (zcut_f + zcut_h) / 2
def reshape(p):
    p = p.copy(); p.z = p.z * LEG if p.z < zl else p.z - (1 - LEG) * zl; return p
for v in V: v.co = reshape(v.co)
TA = [reshape(p) for p in TA]
for k in list(pivots):
    if len(k) == 2: pivots[k] = reshape(pivots[k])
zcut_f, zcut_h = reshape(Vector((0, 0, zcut_f))).z, reshape(Vector((0, 0, zcut_h))).z

# ---- head: ahead of a plane at the neck base, pointing from the neck base to the head ----
nose = min(V, key=lambda v: v.co.y).co.copy()
y_nb = yff + 0.03
mid = [v.co for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - y_nb) < 0.02 and v.index not in tailset]
neck_top = max(p.z for p in mid)
NB = Vector((0, y_nb, (max(p.z for p in mid if p.z > zcut_f) + min(p.z for p in mid if p.z > zcut_f)) / 2))
headc = sum((v.co for v in V if v.co.y < nose.y + 0.2), Vector()) / sum(1 for v in V if v.co.y < nose.y + 0.2)
NDIR = (headc - NB).normalized()
# withers: top of the back over the forelegs' pivots
yw = (pivots[(True, True)].y + pivots[(True, False)].y) / 2
top = max(v.co.z for v in V if abs(v.co.y - yw) < 0.04 and abs(v.co.x) < 0.05)
S = WITHERS / top
yorg = (yff + yfh) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
TA = [sc(p) for p in TA]
for k in list(pivots):
    if len(k) == 2: pivots[k] = sc(pivots[k])
    else: pivots[k] = pivots[k] * S
NB = sc(NB); nose = sc(nose); ZF, ZH = zcut_f * S, zcut_h * S
me.update()
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
crown = max(v.co.z for v in V if abs(v.co.x) < 0.012 and v.co.y < NB.y)
head_top = max(v.co.z for v in V)
print('LANDMARKS withers', WITHERS, 'head-body (nose to tail root)', round(TA[0].y - nose.y, 3), 'tail along axis', round(tail_len, 3),
      'tail tip lowest z', round(min(p.z for p in TA), 3), 'nose', [round(x, 3) for x in nose], 'crown z', round(crown, 3), 'ear top z', round(head_top, 3),
      'neck base', [round(x, 3) for x in NB], 'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 3) for x in p] for k, p in pivots.items() if len(k) == 2})

# the tail tip segment's pivot: the axis point at half the tail's length
acc = 0.0; half = tail_len / 2; TIP = TA[-1]
for i in range(len(TA) - 1):
    L = (TA[i + 1] - TA[i]).length
    if acc + L >= half: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((half - acc) / L); break
    acc += L

# ---- per-vertex rig on the full mesh (decimation keeps vertex groups, so carry it in groups) ----
def rig_full(i):
    p = V[i].co
    if i in tailset:
        t = tfrac.get(i, 0.0)
        if t >= 0.5: return dict(part=8, partw=A.smooth(0.5, 0.62, t), pivot=TIP)     # TAIL_TIP, child of TAIL
        return dict(part=3, partw=A.smooth(0.0, 0.12, t), pivot=TA[0])
    best = None
    for k in ((True, True), (True, False), (False, True), (False, False)):
        pv = pivots[k]; r = pivots[k + ('r',)] * 1.25
        if (p.x > 0) != k[1] or (p.y < (pivots[(True, True)].y + pivots[(False, True)].y) / 2) != k[0]: continue
        dxy = ((p.x - pv.x) ** 2 + (p.y - pv.y) ** 2) ** 0.5
        # below the cut everything in the quadrant is leg (paws reach forward of the leg column); above it, a
        # blend over ~6 cm inside the leg's footprint
        w = 1.0 if p.z < pv.z - 0.03 else A.smooth(pv.z + 0.06, pv.z - 0.03, p.z) * (1 if dxy < r else A.smooth(r * 1.6, r, dxy))
        if w > 0: best = (w, k)
    if best:
        w, (fore, left) = best
        pid = 1 if fore == left else 2      # LEG_A: left fore, right hind
        return dict(part=pid, partw=w, pivot=pivots[(fore, left)])
    d = (p - NB).dot(NDIR)
    wh = A.smooth(-0.02, 0.1, d)
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')

# ---- palette (sRGB, brief) ----
BODY, BACK, CREAM, DARK, NOSE, EYE = 0xa37e58, 0x8b6a4b, 0xe4dccd, 0x2a221d, 0xb08079, 0xb08a3c
# eye centre (m, after scaling): read off a side close-up of the sculpted eye; x is found on the surface below
EYE_YZ = (-0.478, 0.70)
ring = [v.co for v in V if abs(v.co.y - EYE_YZ[0]) < 0.006 and abs(v.co.z - EYE_YZ[1]) < 0.006 and v.co.x > 0]
EYE_P = Vector((max(c.x for c in ring), EYE_YZ[0], EYE_YZ[1]))
print('LANDMARKS eye', [round(x, 3) for x in EYE_P])
def face_color(m, p, R):
    c = p.center; n = p.normal
    g = lambda col, a=0.05: A.grizzle(col, c, a, 0.03)
    parts = [R[i]['part'] for i in p.vertices]; pw = [R[i]['partw'] for i in p.vertices]
    if all(x in (3, 8) for x in parts):
        d, t, q = A.poly_nearest(c, TA)
        if t > 0.86: return A.srgb2lin(DARK)
        up = (c - q).normalized().z if (c - q).length > 1e-6 else 0
        if t > 0.08 and up > 0.35: return g(BACK)
        if up < -0.5: return g(A.mix(BODY, CREAM, 0.35))
        return g(BODY)
    if c.y < NB.y and c.z > ZF and sum(1 for x in parts if x == 6) * 2 >= len(parts):
        # head and neck
        q = Vector((abs(c.x), c.y, c.z))
        de = (q - EYE_P).length
        if de < 0.006: return A.srgb2lin(0x1a1410)                 # pupil
        if de < 0.012: return A.srgb2lin(EYE)
        if c.z > crown + 0.004 and abs(c.x) > 0.02:     # ears
            return A.srgb2lin(DARK) if n.y > 0.15 else g(A.mix(BODY, CREAM, 0.5))
        if c.y < nose.y + 0.022 and nose.z - 0.012 < c.z < nose.z + 0.018 and n.y < -0.3: return A.srgb2lin(NOSE)
        if nose.y + 0.02 < c.y < nose.y + 0.065 and nose.z - 0.045 < c.z < nose.z - 0.012 and abs(n.x) > 0.55 and abs(c.x) > 0.02: return A.srgb2lin(DARK)  # whisker bases
        if n.z < -0.25 or (c.y < nose.y + 0.09 and c.z < nose.z - 0.01): return g(CREAM, 0.03)   # chin, muzzle, throat
        if n.z > 0.5: return g(A.mix(BODY, BACK, 0.5))
        return g(BODY)
    if any(x in (1, 2) for x in parts) and c.z < max(ZF, ZH) + 0.02:
        side = 1 if c.x > 0 else -1
        if n.x * side < -0.35: return g(A.mix(CREAM, BODY, 0.35), 0.04)   # inner legs
        return g(BODY)
    if n.z < -0.45: return g(CREAM, 0.03)                                  # belly, chest
    if n.z > 0.6: return g(BACK)
    if n.z < -0.1 and c.z < (ZF + ZH) / 2 + 0.05: return g(A.mix(BODY, CREAM, 0.3))
    return g(BODY)

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part == 3: piv = TA[0]
        elif part == 8: piv = TIP
        elif part == 6: piv = NB
        else:
            fore = co.y < (pivots[(True, True)].y + pivots[(False, True)].y) / 2; left = co.x > 0
            piv = pivots[(fore, left)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, lambda p: face_color(m, p, R), lambda i: R[i])
    bpy.data.objects.remove(o)
    tiers.append((name, t))
to3l = lambda p: [round(x, 4) for x in A.to3(p)]
A.write_glb(OUT, tiers, 'wild-earth tools/build_cougar.py (Blender)',
            'Mountain lion generated with Meshy (meshy.ai), text-to-3D preview task 01a171bb-8cae-7690-a80d-04545b70957e, for Wild Earth; CC BY-SA 4.0; legs shortened, recoloured, decimated',
            extras={'species': 'puma_concolor', 'withers_m': WITHERS, 'leg_scale': LEG, 'meshy_task': '01a171bb-8cae-7690-a80d-04545b70957e',
                    'rig': {'kind': 'quadruped', 'tail': to3l(TA[0]), 'tail_tip': to3l(TIP), 'head': to3l(NB),
                            'fore': to3l(pivots[(True, True)]), 'hind': to3l(pivots[(False, True)]), 'length_m': round(TA[0].y - nose.y + tail_len, 3)},
                    'parts': 'BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2, TAIL 3 (inner half), TAIL_TIP 8 (outer half, child of TAIL), HEAD 6'})
