# Build client/assets/deer_mouse.glb, the ambient deer mouse (Peromyscus maniculatus, the northwestern forest form) of
# the Olympic rain forest, as a variant of the California vole's Meshy mesh. No credits.
#
# Source: variant of microtus_californicus built from its Meshy (meshy.ai) text-to-3D preview, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces, task 01a171bc-b285-71cb-9e16-dc06982a34e4, run by agent (Claude) for Aaron Brodeur
#   on 2026-10-25 UTC; record in library/animals/jobs/microtus_californicus/01a171bc-b285-71cb-9e16-dc06982a34e4/job.json.
#   Prompt (for the vole): "A California vole (Microtus californicus), a wild meadow vole, NOT a mouse, NOT a hamster.
#   One adult on all fours in a neutral side-on pose, feet on the ground, head level. Realistic proportions: 17 cm long
#   including a short 4.5 cm tail, stocky cylindrical body, short legs, blunt rounded face, small beady eyes, small round
#   ears almost hidden in fur. Grizzled cinnamon-brown back with darker ticking, grey belly, grey feet, tail dark above
#   and grey below. No whiskers as strands. No base, no ground. Game-ready." (The generator gave it a mouse's thin tail
#   and rat-like ears, which suit the deer mouse better than the vole.) No new Meshy job.
# Licence: paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use,
#   last updated 2026-09-19), released with the project's assets under CC BY-SA 4.0; credit "generated with Meshy
#   (meshy.ai)". Terms 2.4: no Meshy metadata in the file to carry over.
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_deer_mouse.py -- \
#       library/animals/jobs/microtus_californicus/01a171bc-b285-71cb-9e16-dc06982a34e4/model.glb client/assets/deer_mouse.glb
#
# What it does: tools/build_vole.py's clean-up and landmarks on the same mesh (whisker strands dropped by an inward ray
# cast; the tail found as the piece behind a cut at the rump, its axis traced by edge distance), then a deer mouse, not a
# vole: the generated tail is removed (hole closed) and a new one lofted from its root, 0.09 m, thin and tapering, held
# out behind and drooping toward the ground, sharply bicoloured (dark above, white below; TAIL part 3, pivot at the
# root, raised to 0.4 of the rump's height); the ears grown 2.1x about their base (large, thin and rounded); the muzzle ahead of the eyes
# lengthened 1.1x and tapered (a pointed snout); the trunk slimmed 0.8x across and 0.85x in height above the belly line;
# the legs below the belly line stretched 1.45x (long-legged); big protruding black eyes (an octahedron each side, lod0
# and lod1). Origin centred between the feet; head and body (nose to tail root) 0.09 m, 0.18 m with the tail. Colour by
# region with faint per-face ticking (sRGB, field guides): rich grey-brown to tawny back, darker down the spine; a sharp
# line low on the flanks to pure white belly, throat, chin, inner legs and feet; ears dusky with a pale rim; pink-grey
# nose. Decimates (collapse, X symmetry) to lod0 ~900, lod1 ~300, lod2 ~80 triangles (the tail lofted per tier: 6, 4 and
# 3 sides). Rig, template R (animalModels.js), as vole.glb plus a tail: BODY 0 (hindquarters), CHEST 7 (fore body, pivot
# at the lumbar: lifts to sit up and eat), LEG_A 1 (fore pair, elbows) and HEAD 6 (neck, head, ears; pivot at the neck)
# children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3 (pivot at its root). Parent pivots in extras.rig (the
# vole's keys plus 'tail', as rabbit.glb: kind, chest, tail, head, fore, hind, length_m).
import bpy, bmesh, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
JOB = '01a171bc-b285-71cb-9e16-dc06982a34e4'
SPECIES = 'peromyscus_maniculatus'
TIERS = [('lod0', 900, 6, 10), ('lod1', 300, 4, 6), ('lod2', 80, 3, 3)]   # name, triangles, tail sides, tail rings
HEAD_BODY, TAIL_M = 0.09, 0.09
EAR, MUZZLE, TAPER, SLIM, HEIGHT, LEG = 2.1, 1.1, 0.25, 0.8, 0.85, 1.45
TAIL_R0, TAIL_R1 = 0.0016, 0.0005      # tail radius at the root and the tip (m)
EYE_R = 0.0021                          # the eye's radius (m): big and protruding

ob = A.import_glb_mesh(SRC)
ymin0 = min(v.co.y for v in ob.data.vertices)
A.drop_thin(ob, 0.007, region=lambda co: co.y < ymin0 + 0.5)       # whiskers (1-5 mm thick, source units)
me = ob.data; V = me.vertices
adj = A.adjacency(me)
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0

# ---- the generated tail: found as the vole's build finds it, then removed ----
far = max(V, key=lambda v: v.co.y).index
yc = 0.2
while True:
    tail = next(c for c in A.components(adj, [v.index for v in V if v.co.y > yc]) if far in c)
    if max(abs(V[i].co.x) for i in tail) < 0.06: break
    yc += 0.01
tailset = set(tail)
roots = [i for i in tail if any(V[u].co.y <= yc for u in adj[i])]
ROOT = sum((V[i].co for i in roots), Vector()) / len(roots)          # the tail root on the rump (source units)
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in tailset], context='VERTS')
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
patch = [v for v in bm.verts if (v.co - ROOT).length < 0.06]
for _ in range(4): bmesh.ops.smooth_vert(bm, verts=patch, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
# the vole's tail left the rump at its lowest point, on the ground; a mouse's leaves at about 0.4 of the rump's height:
# the root goes there, just inside the rump's rear outline
ymax = max(v.co.y for v in V)
rear = [v.co for v in V if v.co.y > ymax - 0.05 and abs(v.co.x) < 0.05]
zr0, zr1 = min(c.z for c in rear), max(c.z for c in rear)
ROOT = Vector((0.0, ymax - 0.02, zr0 + 0.4 * (zr1 - zr0)))
print('INFO tail cut', round(yc, 3), 'tail vertices removed', len(tailset), 'root', [round(x, 3) for x in ROOT])

# ---- landmarks in source units (as tools/build_vole.py) ----
nose = min(V, key=lambda v: v.co.y).co.copy()
low = [v for v in V if v.co.z < 0.02]
ymid = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
yff = sum(v.co.y for v in low if v.co.y < ymid) / max(1, sum(1 for v in low if v.co.y < ymid))
yfh = sum(v.co.y for v in low if v.co.y >= ymid) / max(1, sum(1 for v in low if v.co.y >= ymid))
mids = [v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - (yff + yfh) / 2) < 0.03]
zcut = min(mids) - 0.01
def ztop(y):
    zs = [v.co.z for v in V if abs(v.co.x) < 0.02 and abs(v.co.y - y) < 0.02]
    return max(zs) if zs else 0.0
ear_pts = [v.co for v in V if v.co.y < nose.y + 0.6 and abs(v.co.x) > 0.04 and v.co.z > ztop(v.co.y) + 0.005]
EARB = Vector((sum(abs(c.x) for c in ear_pts) / len(ear_pts), sum(c.y for c in ear_pts) / len(ear_pts), min(c.z for c in ear_pts) - 0.02))
eye_y = nose.y + 0.22          # source units: the sculpted eye sits ~0.22 behind the nose tip (side close-up)
print('INFO feet y', round(yff, 3), round(yfh, 3), 'leg cut z', round(zcut, 3), 'ear base', [round(x, 3) for x in EARB])

# ---- shape edits (source units) ----
def reshape(p, ears=True):
    if ears:
        for sx in (1, -1):
            B = Vector((sx * EARB.x, EARB.y, EARB.z))
            d = (p - B).length
            if d < 0.12 and p.x * sx > 0.02 and p.z > EARB.z:
                p = p.lerp(B + (p - B) * EAR, A.smooth(EARB.z, EARB.z + 0.04, p.z) * A.smooth(0.12, 0.08, d))
    if p.y < eye_y:                                   # a longer, pointed snout
        t = (eye_y - p.y) / (eye_y - nose.y)
        p = Vector((p.x * (1 - TAPER * t), eye_y + (p.y - eye_y) * MUZZLE, p.z))
    z = p.z * LEG if p.z < zcut else zcut * LEG + (p.z - zcut) * HEIGHT
    return Vector((p.x * SLIM, p.y, z))
for v in V: v.co = reshape(v.co)
ROOT = reshape(ROOT, False); EARB_T = reshape(EARB, False)
ZCUT = zcut * LEG
nose = min(V, key=lambda v: v.co.y).co.copy()
S = HEAD_BODY / (ROOT.y - nose.y)
yorg = (yff + yfh) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * S))
for v in V: v.co = sc(v.co)
ROOT = sc(ROOT); nose = sc(nose); ZC = ZCUT * S; EYE_Y = (eye_y - yorg) * S; EAR_Y = (EARB.y - yorg) * S; EAR_Z = EARB_T.z * S
me.update()
pivots = {}
for fore in (True, False):
    for left in (True, False):
        ring = [v.co for v in V if ZC - 0.004 < v.co.z < ZC and (v.co.y < (yff + yfh - 2 * yorg) / 2 * S) == fore and (v.co.x > 0) == left]
        c = sum(ring, Vector()) / max(1, len(ring))
        pivots[(fore, left)] = Vector((c.x, c.y, ZC))
YMID = (yff + yfh - 2 * yorg) / 2 * S
NB_Y = (yff - yorg) * S - 0.003
sect = [v.co.z for v in V if abs(v.co.x) < 0.003 and abs(v.co.y - NB_Y) < 0.003]
NB = Vector((0, NB_Y, (max(sect) + min(sect)) / 2))
headc = sum((v.co for v in V if v.co.y < nose.y + 0.015), Vector()) / sum(1 for v in V if v.co.y < nose.y + 0.015)
NDIR = (headc - NB).normalized()
Y_LUMBAR = YMID + 0.004
lum = [v.co.z for v in V if abs(v.co.x) < 0.003 and abs(v.co.y - Y_LUMBAR) < 0.003]
CHEST = Vector((0, Y_LUMBAR, (max(lum) + min(lum)) / 2))
crown = max(v.co.z for v in V if abs(v.co.x) < 0.002 and v.co.y < NB.y)
eyes = [v.co for v in V if abs(v.co.y - EYE_Y) < 0.0015 and v.co.x > 0 and v.co.z > crown * 0.55]
EYE_P = max(eyes, key=lambda c: c.x).copy() if eyes else Vector((0.006, EYE_Y, crown * 0.75))
ear_top = max(v.co.z for v in V if abs(v.co.y - EAR_Y) < 0.01 and abs(v.co.x) > 0.003)
def top_at(y):
    zs = [v.co.z for v in V if abs(v.co.y - y) < 0.003 and abs(v.co.x) < 0.004]
    return max(zs) if zs else ZC + 0.02
TOPS = {k: top_at(k * 0.004) for k in range(-40, 40)}
def back_top(y): return TOPS.get(int(round(y / 0.004)), ZC + 0.02)

# ---- the tail: lofted from the root, out behind and drooping toward the ground ----
def tail_frame(u):
    """Centre, tangent (Blender metres) at u in [0, 1]: back (+y) and down, the tip a third of the root's height up."""
    n = 40; p = ROOT.copy(); out = None
    drop = ROOT.z * 0.62
    for i in range(n + 1):
        uu = i / n
        th = math.atan2(drop * 1.6 * (1 - 0.75 * uu), TAIL_M)       # steeper near the root, levelling out
        T = Vector((0, math.cos(th), -math.sin(th)))
        if out is None and uu >= u - 1e-9: out = (p.copy(), T)
        p = p + T * (TAIL_M / n)
    return out
TAIL_TIP_P = tail_frame(1.0)[0]
print('LANDMARKS head-body', HEAD_BODY, 'tail', TAIL_M, 'total length', round(TAIL_TIP_P.y - nose.y, 4),
      'back height', round(max(v.co.z for v in V if v.co.y > NB.y), 4), 'ear top', round(ear_top, 4), 'ear height over crown', round(ear_top - crown, 4),
      'leg cut', round(ZC, 4), 'neck', [round(x, 4) for x in NB], 'eye', [round(x, 4) for x in EYE_P], 'tail root', [round(x, 4) for x in ROOT],
      'tail tip', [round(x, 4) for x in TAIL_TIP_P],
      'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 4) for x in p] for k, p in pivots.items()})

def rig_full(i):
    p = V[i].co
    fore = p.y < YMID; left = p.x > 0
    pv = pivots[(fore, left)]
    w = A.smooth(pv.z + 0.005, pv.z - 0.003, p.z)
    if w > 0: return dict(part=1 if fore else 2, partw=w, pivot=pv)
    wh = A.smooth(-0.002, 0.010, (p - NB).dot(NDIR))
    if wh > 0: return dict(part=6, partw=wh, pivot=NB)
    wc = A.smooth(Y_LUMBAR + 0.006, Y_LUMBAR - 0.010, p.y)
    if wc > 0: return dict(part=7, partw=wc, pivot=CHEST)
    return dict(part=0, partw=0.0, pivot=Vector())
RIG = [rig_full(v.index) for v in V]
gp = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p6', 'p7')}
for i, r in enumerate(RIG):
    if r['part']: gp[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')

# ---- colour (sRGB) ----
BACK, SPINE, FLANK, WHITE, EAR_C, EAR_RIM, NOSE, EYE, T_TOP, T_UNDER = (
    0x6c5644, 0x4e3e30, 0x7c6248, 0xe8e6e0, 0x5e524a, 0xb4a89c, 0xb09490, 0x070707, 0x4a3a2e, 0xe2e0da)
def face_color(m, p, R):
    c = p.center; n = p.normal
    g = lambda col, a=0.12: A.grizzle(col, c, a, 0.0025)
    parts = [R[i]['part'] for i in p.vertices]
    if sum(1 for x in parts if x in (1, 2)) * 2 > len(parts):                       # legs: white feet and inner legs
        if c.z < ZC or (abs(n.x) > 0.3 and (n.x > 0) != (c.x > 0)) or n.z < -0.3: return g(WHITE, 0.04)
        return g(FLANK)
    head = c.y < NB.y + 0.002
    if head:
        if c.y < nose.y + 0.0025: return g(NOSE, 0.04)                               # pink-grey nose
        if c.z > EAR_Z - 0.001 and abs(c.x) > 0.004 and abs(c.y - EAR_Y) < 0.012:      # ears: dusky, the rim pale
            return g(EAR_RIM, 0.05) if c.z > ear_top - 0.0022 else g(EAR_C, 0.06)
        if n.z < -0.2 or c.z < EYE_P.z - 0.0042: return g(WHITE, 0.04)               # chin, throat, lips
        return g(BACK)
    # the sharp flank line: white below about 40% of the way from the belly line to the back
    line = ZC + 0.33 * (back_top(c.y) - ZC)
    if n.z < -0.25 or c.z < line: return g(WHITE, 0.04)
    if n.z > 0.75 and abs(c.x) < 0.0045: return g(SPINE)                            # darker down the spine
    if n.z > 0.3: return g(BACK)
    return g(FLANK)

def extra_tris(level, sides, rings):
    """The lofted tail (rings x sides, a cap at the tip) and the eyes (lod0, lod1): (a, b, c, hex, part, w, pivot, away)."""
    out = []
    us = [i / (rings - 1) for i in range(rings)]
    R = []
    for u in us:
        C, T = tail_frame(u)
        r = TAIL_R0 + (TAIL_R1 - TAIL_R0) * u
        side = Vector((1, 0, 0)); up = T.cross(side).normalized()
        if up.z < 0: up = -up
        R.append((C, u, [(C + (side * math.cos(2 * math.pi * (k + 0.5) / sides) + up * math.sin(2 * math.pi * (k + 0.5) / sides)) * r,
                          2 * math.pi * (k + 0.5) / sides) for k in range(sides)]))
    w = lambda u: A.smooth(-0.02, 0.15, u)
    for i in range(rings - 1):
        (c0, u0, r0), (c1, u1, r1) = R[i], R[i + 1]
        for k in range(sides):
            a, b = r0[k], r0[(k + 1) % sides]; c, d = r1[k], r1[(k + 1) % sides]
            am = a[1] + math.pi / sides
            h = T_TOP if math.sin(am) > 0 else T_UNDER                                # sharply bicoloured
            mid = (c0 + c1) / 2
            out.append(((a[0], u0), (b[0], u0), (d[0], u1), h, mid))
            out.append(((a[0], u0), (d[0], u1), (c[0], u1), h, mid))
    C, T = tail_frame(1.0); tip = C + T * TAIL_R1 * 2
    for k in range(sides):
        a, b = R[-1][2][k], R[-1][2][(k + 1) % sides]
        out.append(((a[0], 1.0), (b[0], 1.0), (tip, 1.0), T_TOP, C))
    tris = [((a[0], b[0], c[0]), h, 3, [w(a[1]), w(b[1]), w(c[1])], ROOT, mid) for (a, b, c, h, mid) in out]
    if level < 2:
        for s in (1, -1):
            ctr = Vector((s * (abs(EYE_P.x) + EYE_R * 0.35), EYE_P.y, EYE_P.z))
            r = Vector((EYE_R * 0.8, EYE_R, EYE_R))
            P = [ctr + Vector((r.x, 0, 0)), ctr - Vector((r.x, 0, 0)), ctr + Vector((0, r.y, 0)), ctr - Vector((0, r.y, 0)),
                 ctr + Vector((0, 0, r.z)), ctr - Vector((0, 0, r.z))]
            for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
                tris.append(((P[a], P[b], P[4]), EYE, 6, [1.0] * 3, NB, ctr)); tris.append(((P[b], P[a], P[5]), EYE, 6, [1.0] * 3, NB, ctr))
    return tris

tiers = []
for li, (name, target, sides, rings) in enumerate(TIERS):
    ex = extra_tris(li, sides, rings)
    o, n0 = A.tier_copy(ob, target - len(ex))
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        pid = max((k for k in ('p1', 'p2', 'p6', 'p7') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        piv = NB if part == 6 else CHEST if part == 7 else pivots[(part == 1, co.x > 0)]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    t = A.emit(m, lambda p: face_color(m, p, R), lambda i: R[i])
    nb = len(t['idx']) // 3
    for (a, b, c), h, part, ws, pv, mid in ex:
        if (b - a).cross(c - a).dot((a + b + c) / 3 - mid) < 0: b, c = c, b; ws = [ws[0], ws[2], ws[1]]
        col = A.srgb2lin(h)
        for q, wq in zip((a, b, c), ws):
            t['idx'].append(len(t['pos'])); t['pos'].append(A.to3(q)); t['col'].append(col)
            t['part'].append(float(part)); t['partw'].append(float(wq)); t['piv'].append(A.to3(pv))
    print('TIER', li, 'tris', len(t['idx']) // 3, f'(body {nb}, tail and eyes {len(ex)})', 'from', n0)
    bpy.data.objects.remove(o)
    tiers.append((name, t))
r4 = lambda v: [round(x, 4) for x in A.to3(v)]
RIGX = {'kind': 'rodent', 'chest': r4(CHEST), 'tail': r4(ROOT), 'head': r4(NB), 'fore': r4(pivots[(True, True)]), 'hind': r4(pivots[(False, True)]),
        'length_m': round(HEAD_BODY + TAIL_M, 4)}
print('RIG', RIGX)
A.write_glb(OUT, tiers, 'wild-earth tools/build_deer_mouse.py (Blender)',
            f'Deer mouse: a variant of the California vole generated with Meshy (meshy.ai), text-to-3D preview task {JOB}, owned by the account holder (Aaron Brodeur), for Wild Earth; CC BY-SA 4.0; new tail, reshaped, recoloured, decimated by wild-earth tools/build_deer_mouse.py',
            extras={'rig': RIGX, 'species': SPECIES, 'head_body_m': HEAD_BODY, 'tail_m': TAIL_M, 'ear_scale': EAR, 'muzzle_scale': MUZZLE,
                    'slim': SLIM, 'height_scale': HEIGHT, 'leg_scale': LEG, 'meshy_task': JOB,
                    'source': {'kind': 'variant', 'variant_of': 'microtus_californicus', 'job_id': JOB, 'ai_model': 'meshy-6-lite',
                               'mode': 'text-to-3d preview', 'ai_generated': True, 'credit': 'generated with Meshy (meshy.ai)',
                               'meshy_metadata': 'none embedded in the source GLB', 'credits': 0},
                    'parts': 'template R: BODY 0 (hindquarters), CHEST 7 (pivot at the lumbar), LEG_A 1 (fore pair, elbows) and HEAD 6 children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3 (lofted, pivot at its root)'})
