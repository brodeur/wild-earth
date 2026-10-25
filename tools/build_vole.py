# Build client/assets/vole.glb, the ambient California vole (Microtus californicus), from a Meshy preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model meshy-6-lite, triangle remesh to 20,000
# faces, task 01a171bc-b285-71cb-9e16-dc06982a34e4 (prompt A of library/animals/drafts/microtus_californicus.md),
# run by agent (Claude) for Aaron Brodeur on 2026-10-25 UTC; record in
# library/animals/jobs/microtus_californicus/01a171bc-b285-71cb-9e16-dc06982a34e4/job.json. Paid-plan API output,
# owned by the account holder (Meshy Terms of Use 3.2), released with the project's assets under CC BY-SA 4.0;
# credit "generated with Meshy". No Meshy metadata in the file to carry over (Terms 2.4).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_vole.py -- \
#       library/animals/jobs/microtus_californicus/01a171bc-b285-71cb-9e16-dc06982a34e4/model.glb client/assets/vole.glb
#
# What it does: drops the modelled whiskers (thin strands, found by an inward ray cast); the generator gave a
# mouse's thin tail and rat-like ears, so the tail (the piece behind a cut at the rump, its axis traced by edge
# distance) is shortened to 4.5 cm and thickened (2.6x) toward the tip, the ears are pressed down 0.6x toward their
# base, the muzzle ahead of the eyes is shortened 0.85x (blunter face) and the body height squashed 0.85x
# (a low, cylindrical vole); origin centred between the feet; scales head and body (nose to tail root) to
# 0.125 m, 0.17 m with the tail. Colour by region from the brief's palette with per-face ticking: grizzled brown
# back with a reddish line down the middle, flanks, blue-grey belly, grey feet, tail dark above and grey below,
# a small black eye (one face each side, lod0 only). Decimates (collapse, X symmetry) to lod0 ~400, lod1 ~120,
# lod2 ~24 triangles. Rig, template R (animalModels.js): BODY 0 (hindquarters, with the tail, too short to animate), CHEST 7 (fore body,
# pivot at the lumbar: lifts to sit up and eat), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head, ears; pivot
# at the neck), both children of the chest, LEG_B 2 (hind pair, stifles). Parent pivots in extras.rig.
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TIERS = [('lod0', 400), ('lod1', 120), ('lod2', 24)]
HEAD_BODY, TAIL_M = 0.125, 0.045
EAR, MUZZLE, HEIGHT = 0.6, 0.85, 0.85

ob = A.import_glb_mesh(SRC)
ymin0 = min(v.co.y for v in ob.data.vertices)
A.drop_thin(ob, 0.007, region=lambda co: co.y < ymin0 + 0.5)       # whiskers (1-5 mm thick, source units)
me = ob.data; V = me.vertices
adj = A.adjacency(me)
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0

# ---- tail ----
far = max(V, key=lambda v: v.co.y).index
yc = 0.2
while True:
    tail = next(c for c in A.components(adj, [v.index for v in V if v.co.y > yc]) if far in c)
    if max(abs(V[i].co.x) for i in tail) < 0.06: break
    yc += 0.01
tailset = set(tail)
roots = [i for i in tail if any(V[u].co.y <= yc for u in adj[i])]
TA, tfrac = A.tube_axis(me, adj, tail, roots, bins=16)

# ---- landmarks in source units ----
nose = min(V, key=lambda v: v.co.y).co.copy()
low = [v for v in V if v.co.z < 0.02 and v.index not in tailset]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / max(1, sum(1 for v in low if v.co.y < ymid))
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / max(1, sum(1 for v in low if v.co.y >= ymid))
mids = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - (yff + yfh) / 2) < 0.03 and v.index not in tailset]
zcut = min(mids) - 0.01
def ztop(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.02 and abs(v.co.y - y) < 0.02]
    return max(zs) if zs else 0.0
ear_pts = [v.co for v in V if v.co.y < nose.y + 0.6 and abs(v.co.x) > 0.04 and v.co.z > ztop(v.co.y) + 0.005]
EARB = Vector((sum(abs(c.x) for c in ear_pts) / len(ear_pts), sum(c.y for c in ear_pts) / len(ear_pts), min(c.z for c in ear_pts) - 0.02))
eye_y = nose.y + 0.22          # source units: the sculpted eye sits ~0.22 behind the nose tip (side close-up)
print('INFO tail cut', round(yc, 3), 'feet y', round(yff, 3), round(yfh, 3), 'leg cut z', round(zcut, 3), 'ear base', [round(x, 3) for x in EARB])

# ---- shape edits ----
L0 = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
S = HEAD_BODY / (TA[0].y - nose.y)
NA = A.bent_axis(TA, 0, TAIL_M / (L0 * S))
for v in V:
    p = v.co
    if v.index in tailset:
        t = tfrac.get(v.index, 0.0)
        p = A.remap_along(TA, NA, p, 1.0, 1 + 1.6 * A.smooth(0.05, 0.4, t))
    else:
        for sx in (1, -1):
            B = Vector((sx * EARB.x, EARB.y, EARB.z))
            d = (p - B).length
            if d < 0.12 and p.x * sx > 0.02 and p.z > EARB.z:
                p = p.lerp(B + (p - B) * EAR, A.smooth(EARB.z, EARB.z + 0.04, p.z) * A.smooth(0.12, 0.08, d))
        if p.y < eye_y: p = Vector((p.x, eye_y + (p.y - eye_y) * MUZZLE, p.z))
    p = Vector((p.x, p.y, p.z * HEIGHT))
    v.co = p
TA = [Vector((p.x, p.y, p.z * HEIGHT)) for p in NA]
zcut *= HEIGHT; EARB.z *= HEIGHT
nose = min(V, key=lambda v: v.co.y).co.copy()
yorg = (yff + yfh) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co); v.co.z = max(0.0, v.co.z)      # the thickened tail would dip a mm under the ground
TA = [sc(p) for p in TA]; nose = sc(nose); ZC = zcut * S; EYE_Y = (eye_y - yorg) * S
me.update()
# leg pivots: centroid of each leg's section just below the cut
pivots = {}
for fore in (True, False):
    for left in (True, False):
        ring = [v.co for v in V if v.index not in tailset and ZC - 0.004 < v.co.z < ZC and (v.co.y < (yff + yfh - 2 * yorg) / 2 * S) == fore and (v.co.x > 0) == left]
        c = sum(ring, Vector()) / max(1, len(ring))
        pivots[(fore, left)] = Vector((c.x, c.y, ZC))
YMID = (yff + yfh - 2 * yorg) / 2 * S
NB_Y = (yff - yorg) * S - 0.004
sect = [v.co.z for v in V if abs(v.co.x) < 0.004 and abs(v.co.y - NB_Y) < 0.003]
NB = Vector((0, NB_Y, (max(sect) + min(sect)) / 2))
headc = sum((v.co for v in V if v.co.y < nose.y + 0.02), Vector()) / sum(1 for v in V if v.co.y < nose.y + 0.02)
NDIR = (headc - NB).normalized()
eyes = [v.co for v in V if abs(v.co.y - EYE_Y) < 0.002 and v.co.x > 0]
top = max(v.co.z for v in V if v.index not in tailset)
crown = max(v.co.z for v in V if abs(v.co.x) < 0.002 and v.co.y < NB.y)
print('LANDMARKS head-body', HEAD_BODY, 'tail', round(sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1)), 4), 'total length', round(max(v.co.y for v in V) - nose.y, 4),
      'back height', round(top, 4), 'leg cut', round(ZC, 4), 'neck', [round(x, 4) for x in NB], 'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 4) for x in p] for k, p in pivots.items()})

Y_LUMBAR = YMID + 0.005
lum = [v.co.z for v in V if abs(v.co.x) < 0.004 and abs(v.co.y - Y_LUMBAR) < 0.003]
CHEST = Vector((0, Y_LUMBAR, (max(lum) + min(lum)) / 2))
def rig_full(i):
    p = V[i].co
    if i in tailset: return dict(part=0, partw=0.0, pivot=Vector())
    fore = p.y < YMID; left = p.x > 0
    pv = pivots[(fore, left)]
    w = A.smooth(pv.z + 0.006, pv.z - 0.003, p.z)
    if w > 0: return dict(part=1 if fore else 2, partw=w, pivot=pv)
    wh = A.smooth(-0.002, 0.012, (p - NB).dot(NDIR))
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    wc = A.smooth(Y_LUMBAR + 0.008, Y_LUMBAR - 0.012, p.y)
    if wc > 0: return dict(part=7, partw=wc, pivot=CHEST)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p6', 'p7', 'tail')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
    if i in tailset: gp['tail'].add([i], 1.0, 'REPLACE')

BACK, TINGE, FLANK, BELLY, FEET, TTOP, TUNDER, EYE = 0x6b5a48, 0x7a5c42, 0x7d6b57, 0x8f8b86, 0xa39b91, 0x3d342d, 0x8a8580, 0x0d0d0d
EAR_C = A.mix(BACK, 0x3a3029, 0.3)
EYE_P = None
if eyes:
    EYE_P = Vector((0, EYE_Y, 0)); ez = [c for c in eyes if c.z > crown * 0.55]
    if ez: e = max(ez, key=lambda c: c.x); EYE_P = Vector((e.x, e.y, e.z))
print('LANDMARKS eye', EYE_P and [round(x, 4) for x in EYE_P])
def face_color(m, p, R, tw, eye_faces=()):
    c = p.center; n = p.normal
    g = lambda col, a=0.14: A.grizzle(col, c, a, 0.004)
    if sum(tw[i] for i in p.vertices) / len(p.vertices) > 0.5:
        return g(TTOP if n.z > -0.2 else TUNDER, 0.06)
    if p.index in eye_faces: return A.srgb2lin(EYE)
    parts = [R[i]['part'] for i in p.vertices]
    if sum(1 for x in parts if x in (1, 2)) * 2 > len(parts) and c.z < ZC + 0.003: return g(FEET, 0.05)
    if n.z < -0.35: return g(BELLY, 0.06)
    if c.y < NB.y and c.z > EARB.z * S - 0.002 and abs(c.x) > 0.004 and abs(c.y - EARB.y * 0 - (EARB.y - yorg) * S) < 0.012: return g(EAR_C, 0.06)
    if n.z > 0.75 and abs(c.x) < 0.006: return g(TINGE)
    if n.z > 0.35: return g(BACK)
    if c.z < ZC + 0.012 and n.z < 0.1: return g(A.mix(FLANK, BELLY, 0.5), 0.08)
    return g(FLANK)

tiers = []
for name, target in TIERS:
    o, n0 = A.tier_copy(ob, target)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}; TW = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        TW[v.index] = w.get('tail', 0.0)
        pid = max((k for k in ('p1', 'p2', 'p6', 'p7') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        piv = NB if part == 6 else CHEST if part == 7 else pivots[(part == 1, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    eye_faces = set()
    if EYE_P and target >= 300:   # lod0: the one face nearest each eye, a small beady eye
        for sx in (1, -1):
            q = Vector((sx * EYE_P.x, EYE_P.y, EYE_P.z))
            eye_faces.add(min(m.polygons, key=lambda f: (f.center - q).length + (0 if f.normal.x * sx > 0.3 else 1)).index)
    t = A.emit(m, lambda p: face_color(m, p, R, TW, eye_faces), lambda i: R[i])
    bpy.data.objects.remove(o)
    tiers.append((name, t))
A.write_glb(OUT, tiers, 'wild-earth tools/build_vole.py (Blender)',
            'California vole generated with Meshy (meshy.ai), text-to-3D preview task 01a171bc-b285-71cb-9e16-dc06982a34e4, for Wild Earth; CC BY-SA 4.0; reshaped, recoloured, decimated',
            extras={'rig': {'kind': 'rodent', 'chest': [round(x, 4) for x in A.to3(CHEST)], 'head': [round(x, 4) for x in A.to3(NB)],
                            'fore': [round(x, 4) for x in A.to3(pivots[(True, True)])], 'hind': [round(x, 4) for x in A.to3(pivots[(False, True)])],
                            'length_m': HEAD_BODY + TAIL_M},
                    'species': 'microtus_californicus', 'head_body_m': HEAD_BODY, 'tail_m': TAIL_M, 'ear_scale': EAR, 'muzzle_scale': MUZZLE, 'height_scale': HEIGHT,
                    'meshy_task': '01a171bc-b285-71cb-9e16-dc06982a34e4',
                    'parts': 'template R: BODY 0 (hindquarters, with the tail), CHEST 7 (pivot at the lumbar), LEG_A 1 (fore pair, elbows) and HEAD 6 children of the chest, LEG_B 2 (hind pair, stifles)'})
