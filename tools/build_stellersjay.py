# Build client/assets/stellersjay.glb, the ambient Steller's jay, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a171a4-aca9-7784-b9ab-b6b6f71b0cc4 (the second candidate; the
#   first, 01a1719c-c742, came out with its wings spread and was rejected), ai_model meshy-6-lite, triangle remesh to
#   20,000 faces (20,865 triangles, untextured, one piece plus a stray triangle), 2026-10-25 UTC; job record in
#   library/animals/jobs/cyanocitta_stelleri/01a171a4-aca9-7784-b9ab-b6b6f71b0cc4/job.json. Prompt:
#   "A Steller's jay (Cyanocitta stelleri), Sierra Nevada form, one adult bird standing on the ground, side-on pose,
#   body horizontal, wings closed tight along the back with the wingtips resting on the base of the tail. A tall
#   pointed crest swept back from the crown, sooty black head with a few pale blue streaks on the forehead, sooty
#   grey-brown upper back and breast, deep cobalt-blue belly, rump, wings and tail with fine black bars. Long
#   straight tail, stout black bill, black legs, three toes forward and one back. No white on the face, wings or
#   tail. Realistic proportions, game-ready, no base."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_stellersjay.py -- \
#       library/animals/jobs/cyanocitta_stelleri/01a171a4-aca9-7784-b9ab-b6b6f71b0cc4/model.glb \
#       client/assets/stellersjay.glb [--preview /tmp/stjay_preview]
#
# What it does (brief: library/animals/drafts/cyanocitta_stelleri.md; review in library/animals/cyanocitta_stelleri.json):
# the doubled tail (two full-width plates in an X seen side-on, one rising, one drooping) is cut off at the rump
# and replaced by one long tail lofted from the upper plate's traced outline, trailing 10 degrees below level,
# its tip rounded; the tall forward-leaning crest block is pressed down onto the crown and three to five thin
# blades (crossed pairs, so the crest reads from above and from the side) swept back and up from the crown take its
# place; the generated legs are cut and black procedural legs with three forward toes and a hind toe added; the
# body, pitched up about 35 degrees on long legs, is levelled 18 degrees about the hips. Scales to 0.31 m bill to
# tail. Recolours by region from the brief's sRGB: sooty black head, crest and throat with a few pale blue forehead
# streaks, sooty grey-brown breast and mantle, the boundary to the cobalt body as a slanted line (further back on
# the back than on the belly), cobalt-blue folded wings with black bars, blue rump and tail (black bars across the
# tail on lod0), black bill and legs, a small black eye (lod0). Flight wing cards (arm and hand per side, blue above
# with a barred arm on lod0, grey-blue below) collapse into the shoulder when the bird is perched or on the ground.
# Tiers: lod0 ~1,000, lod1 ~400, lod2 ~120 triangles including legs, tail, crest and wing cards (the body decimated
# with Blender collapse, X symmetry; the crest keeps two crossed blades on lod2). Rig: the bird template
# (animalModels.js PART): BODY, LEG_A/B (pivot at the knee), TAIL (pivot at the rump), HEAD (head, crest and neck,
# pivot at the base of the neck), WING_L/R and HAND_L/R cards; the shoulder, tail and neck pivots are in the GLB's
# extras.rig. Origin on the ground between the feet.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (side, top, front, three-quarter, head; workbench, vertex colour).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a171a4-aca9-7784-b9ab-b6b6f71b0cc4'
LENGTH, TAIL_M = 0.31, 0.14            # bill tip to tail tip; tail beyond the rump (m)
PITCH = 18.0                           # level the body (degrees, nose down about the hips)
TAIL_ANGLE = -10.0                     # the tail's slope (degrees; negative: the tip lower than the root)
TIERS = [('lod0', 1000), ('lod1', 400), ('lod2', 120)]

# Part ids (animalModels.js PART)
BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# brief section 1 (sRGB)
HEADC, STREAK, MANTLE, BLUE, WINGB, BARC, BILL, EYEC = 0x1c1c22, 0x7fa6d8, 0x3e3e44, 0x2c4f8a, 0x2a4fa0, 0x101018, 0x141416, 0x0a0a0c
UNDERTAIL, WINGUNDER = 0x26457a, 0x4a5f80
smooth = A.smooth

# ---- source (raw units, Blender axes: x the bird's left, -y forward, +z up; ~1.9 units bill to tail) ----
Y_CUT = 0.22                           # the doubled tail is cut here (the rump and the wingtips stay)
HIP = Vector((0, -0.2, -0.2))          # pitch pivot
CROWN, CREST_Y = 0.545, (-0.82, -0.42) # the crest block is pressed down onto this crown height over this span
NECK_RAW, HEAD_SCALE = Vector((0, -0.47, 0.32)), 0.86   # the generated head is big: shrink it about the neck base
def head_scale_w(p): return smooth(-0.40, -0.52, p.y) * smooth(0.08, 0.22, p.z)
def HS(p):
    p = Vector(p); k = 1 + (HEAD_SCALE - 1) * head_scale_w(p)
    return NECK_RAW + (p - NECK_RAW) * k

ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
# the upper tail plate's outline (half-width and mid-height per station) before it goes
plate = {}
for v in bm.verts:
    p = v.co
    if p.y > 0.24 and p.z > -0.15 * (p.y - 0.25): plate.setdefault(int((p.y - 0.24) / 0.06), []).append(p.copy())
PLATE = [(0.24 + (k + 0.5) * 0.06, max(abs(p.x) for p in b)) for k, b in sorted(plate.items())]
print('INFO upper plate', ' '.join('%.2f:%.3f' % t for t in PLATE))
dele = [v for v in bm.verts if v.co.y > Y_CUT or v.co.z < -0.285]       # both tail plates; the legs and feet
print('INFO cut verts', len(dele))
bmesh.ops.delete(bm, geom=dele, context='VERTS')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
near = [v for v in bm.verts if v.co.z < -0.26 or v.co.y > Y_CUT - 0.04]
for _ in range(4): bmesh.ops.smooth_vert(bm, verts=near, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# the crest block: press it down onto the crown, then relax the crown
crest = []
for v in bm.verts:
    w = smooth(CREST_Y[0] - 0.03, CREST_Y[0] + 0.04, v.co.y) * smooth(CREST_Y[1] + 0.02, CREST_Y[1] - 0.05, v.co.y)
    if v.co.z > CROWN and w > 0:
        v.co.z = CROWN + (v.co.z - CROWN) * (1 - 0.8 * w); crest.append(v)
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=crest, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in bm.verts: v.co = HS(v.co)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices

# level the body: nose down about the hips
R = Matrix.Rotation(math.radians(PITCH), 3, 'X')     # +x rotation: the front (-y) goes down
def P(p): return HIP + R @ (Vector(p) - HIP)
for v in V: v.co = P(v.co)

# ---- to metres: the body (bill tip to the rump cut) is LENGTH - TAIL_M; feet on the ground below the hips ----
bill_tip = min(v.co.y for v in V)
rump = P((0, Y_CUT, 0.03))                           # the new tail leaves the middle of the rump
S = (LENGTH - TAIL_M) / (rump.y - bill_tip)
belly = min(v.co.z for v in V if abs(v.co.x) < 0.08 and abs(v.co.y - P((0, -0.24, -0.27)).y) < 0.06)
KNEE_H, LEGX = 0.05, 0.02                            # knee height above the ground (m); feet apart
GROUND = belly + 0.012 / S - KNEE_H / S
LEG_Y = P((0, -0.24, -0.27)).y
def M(p): p = Vector(p); return Vector((p.x * S, (p.y - LEG_Y) * S - 0.008, (p.z - GROUND) * S))
INV = lambda q: Vector((q.x / S, (q.y + 0.008) / S + LEG_Y, q.z / S + GROUND))       # metres -> pitched raw
RAW = lambda q: HIP + R.transposed() @ (INV(q) - HIP)                               # metres -> source raw
RAWN = lambda n: R.transposed() @ Vector((n.x, n.y, n.z))
for v in V: v.co = M(v.co)
me.update()
print('INFO scale %.4f m/unit; body %.3f m; belly %.3f m above ground' % (S, LENGTH - TAIL_M, (belly - GROUND) * S))

# landmarks (metres, Blender axes)
NECK = M(P((0, -0.47, 0.32)))
TAILP = M(rump) + Vector((0, -0.012, 0))
SHOULDER = M(P((0.045, -0.36, 0.22))); SHOULDER.x = 0.028
KNEE = Vector((LEGX - 0.002, 0.004, KNEE_H)); ANKLE = Vector((LEGX, -0.012, 0.009))
EYE = M(P(HS((0, -0.765, 0.505))))
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(Vector((0.2, EYE.y, EYE.z)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.01
print('INFO eye x %.4f, neck %s, tail root %s, shoulder %s' % (EYE_X, tuple(round(c, 3) for c in NECK), tuple(round(c, 3) for c in TAILP), tuple(round(c, 3) for c in SHOULDER)))

# ---- rig (mesh) ----
def head_w(r):                                      # r: source raw position
    return smooth(-0.40, -0.50, r.y) * smooth(0.12, 0.25, r.z + 0.25 * (r.y + 0.5))
def tail_w(r): return 0.6 * smooth(0.08, Y_CUT, r.y) if r.z > -0.05 else 0.0
def vert_rig(i):
    r = RAW(V[i].co)
    hw = head_w(r)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK)
    tw = tail_w(r)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())

# ---- colour (mesh) by region, in source coordinates ----
def body_color(c, n):
    r = RAW(c); rn = RAWN(n)
    if r.y < -0.83 and r.z < 0.505: return BILL
    if head_w(r) > 0.5 or (r.y < -0.62 and r.z > 0.12):
        if -0.83 < r.y < -0.77 and r.z > 0.5 and rn.y < -0.3: return A.mix(HEADC, STREAK, 0.4)   # blue-streaked forehead
        return HEADC
    # sooty front to cobalt body: the boundary lies further back on the back than on the belly
    split = -0.36 + 0.24 * (rn.z + 1) / 2
    if abs(rn.x) > 0.3 and r.y > -0.46 and r.z > -0.02 + 0.12 * (r.y + 0.46) / 0.68:          # folded wing
        return A.mix(WINGB, BARC, 0.3) if r.y > -0.02 else WINGB          # the primaries darker toward the tips
    if r.y < split: return MANTLE
    if r.y > 0.05 and rn.z < -0.2: return UNDERTAIL
    return BLUE

class Extra:
    def __init__(self): self.tris = []
    def quad(self, p, col, rig, out, tri=False):
        for i, j, k in (((0, 1, 2),) if tri else ((0, 1, 2), (0, 2, 3))):
            a, b, c = Vector(p[i]), Vector(p[j]), Vector(p[k])
            if (b - a).cross(c - a).dot(out) < 0: b, c = c, b
            self.tris.append((a, b, c, col, rig))
    def slab(self, poly, ct, cb, rig, thick, up=Vector((0, 0, 1))):
        off = up * thick
        for i in range(1, len(poly) - 1):
            self.quad([poly[0] + off, poly[i] + off, poly[i + 1] + off], ct, rig, up, tri=True)
            self.quad([poly[0], poly[i], poly[i + 1]], cb, rig, -up, tri=True)
    def tube(self, pts, radii, col, rig, sides=3):
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = t.cross(a).normalized(); w = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        for i in range(len(pts) - 1):
            m = (pts[i] + pts[i + 1]) / 2
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                if radii[i + 1] == 0: self.quad([a, b, pts[i + 1]], col, rig, (a + b) / 2 - m, tri=True)
                else:
                    self.quad([a, b, d], col, rig, (a + b + d) / 3 - m, tri=True); self.quad([a, d, c2], col, rig, (a + d + c2) / 3 - m, tri=True)
    def ellipsoid(self, c, r, col, rig):
        Q = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            for apex in (4, 5): self.quad([Q[a], Q[b], Q[apex]], col, rig, (Q[a] + Q[b] + Q[apex]) / 3 - c, tri=True)

def legs(ex, level):
    for s in (1, -1):
        rig = (LEG_A if s > 0 else LEG_B, 1.0, Vector((s * KNEE.x, KNEE.y, KNEE.z)))
        K = Vector((s * KNEE.x, KNEE.y, KNEE.z)); Ak = Vector((s * ANKLE.x, ANKLE.y, ANKLE.z))
        if level == 2: ex.tube([K, Ak + Vector((0, -0.004, -0.007))], [0.0017, 0], BILL, rig); continue
        ex.tube([K, Ak], [0.0019, 0.0014], BILL, rig)
        for ang, ln in ((-0.42, 0.023), (0.0, 0.026), (0.42, 0.023), (math.pi, 0.015)):
            d = Vector((s * math.sin(ang) * 0.8, -math.cos(ang), 0))
            if level == 0:
                p1 = Ak + d * (ln * 0.55) + Vector((0, 0, -0.005)); p2 = Ak + d * ln + Vector((0, 0, -0.0085))
                ex.tube([Ak, p1, p2], [0.0012, 0.001, 0], BILL, rig)
            else: ex.tube([Ak, Ak + d * ln + Vector((0, 0, -0.0075))], [0.0011, 0], BILL, rig)

def tail(ex, level):
    """One long tail lofted from the upper plate's outline, trailing at TAIL_ANGLE, the tip rounded: a flat underside
    and a top raised along the middle (the folded central feathers), so it is not a bare plate edge-on."""
    rig = (TAIL, 1.0, TAILP)
    a = math.radians(TAIL_ANGLE); d = Vector((0, math.cos(a), math.sin(a))); up = Vector((0, -math.sin(a), math.cos(a)))
    L = TAIL_M + 0.015; root = TAILP + Vector((0, -0.003, 0))
    halfw = lambda t: 1.2 * S * (PLATE[0][1] + (max(w for _, w in PLATE) - PLATE[0][1]) * smooth(0, 0.4, t)) * (1 - 0.35 * smooth(0.85, 1, t) ** 2)
    ridge = lambda t: 0.005 - 0.003 * t
    n = {0: 9, 1: 4, 2: 2}[level]
    if level == 0:   # fine black bars: a narrow dark row after each blue one
        ts = [0.0] + [x for i in range(1, n) for x in (i / n - 0.03, i / n)] + [1.0]
    else: ts = [i / n for i in range(n + 1)]
    ts += [1.06]
    for i in range(len(ts) - 1):
        t0, t1 = ts[i], ts[i + 1]; tip = i == len(ts) - 2
        c0, c1 = root + d * L * t0, root + d * L * min(t1, 1) + (d * 0.008 if tip else Vector())
        w0, w1 = halfw(t0), (0.0 if tip else halfw(t1))
        bar = level == 0 and i % 2 == 1 and not tip and t0 > 0.1
        col = BARC if bar else WINGB
        X = Vector((1, 0, 0))
        l0, r0, m0 = c0 + X * w0, c0 - X * w0, c0 + up * ridge(t0)
        l1, r1, m1 = c1 + X * w1, c1 - X * w1, c1 + up * ridge(min(t1, 1))
        if tip:
            ex.quad([l0, m0, m1], col, rig, up, tri=True); ex.quad([m0, r0, m1], col, rig, up, tri=True)
            ex.quad([l0, r0, m1], BARC if bar else UNDERTAIL, rig, -up, tri=True)
        else:
            ex.quad([l0, l1, m1, m0], col, rig, up + X * 0.3); ex.quad([m0, m1, r1, r0], col, rig, up - X * 0.3)
            ex.quad([l0, l1, r1, r0], BARC if bar else UNDERTAIL, rig, -up)

def crest(ex, level):
    """Thin blades swept back and up from the crown; each a crossed pair so it reads from above and from the side."""
    blades = [(-0.73, 0.034, 0.0), (-0.66, 0.044, 0.006), (-0.66, 0.044, -0.006), (-0.58, 0.040, 0.0), (-0.52, 0.030, 0.0)]
    if level == 1: blades = [blades[0], blades[1], blades[2], blades[3]]
    if level == 2: blades = [blades[1]]
    rig = (HEAD, 1.0, NECK)
    for yr, ln, sx in blades:
        base = M(P(HS((0, yr, CROWN + 0.004))))
        el = math.radians(46); d = Vector((sx * 2, math.cos(el), math.sin(el))).normalized()
        tip = base + d * ln
        w1 = (Vector((1, 0, 0)) - d * d.x).normalized(); w2 = d.cross(w1)
        for wv in (w1, w1 * 0.5 + w2 * 0.866):                     # two planes 60 degrees apart about the blade
            for out in (wv.cross(d), -wv.cross(d)):
                ex.quad([base + wv * 0.0042, tip, base - wv * 0.0042], HEADC, rig, out, tri=True)

def wings(ex, level):
    W = SHOULDER
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + 0.078), W.y, W.z))
        Pw = lambda dx, dy: Vector((s * (W.x + dx), W.y + dy, W.z))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        if level == 2:
            ex.slab([Pw(0, -0.018), Pw(0.17, -0.006), Pw(0.19, 0.033), Pw(0, 0.068)], WINGB, WINGUNDER, arm_rig, 0.0012); continue
        if level == 0:   # the arm in three chordwise rows, the middle one a black bar
            rows = [(-0.018, -0.014, 0.020, 0.024, WINGB), (0.020, 0.024, 0.025, 0.029, BARC), (0.025, 0.029, 0.042, 0.046, WINGB),
                    (0.042, 0.046, 0.047, 0.051, BARC), (0.047, 0.051, 0.064, 0.068, WINGB)]
            for f0, g0, f1, g1, col in rows:
                ex.slab([Pw(0, f0), Pw(0.078, g0), Pw(0.078, g1), Pw(0, f1)], col, WINGUNDER, arm_rig, 0.0012)
        else:
            ex.slab([Pw(0, -0.018), Pw(0.078, -0.014), Pw(0.078, 0.064), Pw(0, 0.068)], WINGB, WINGUNDER, arm_rig, 0.0012)
        hand = [Pw(0.078, -0.014), Pw(0.14, -0.01), Pw(0.18, 0.006), Pw(0.19, 0.03), Pw(0.16, 0.054), Pw(0.078, 0.064)]
        ex.slab(hand, WINGB, WINGUNDER, hand_rig, 0.0012)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (EYE_X - 0.0007), EYE.y, EYE.z)), Vector((0.0017, 0.0028, 0.003)), EYEC, (HEAD, 1.0, NECK))

# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); legs(ex, level); tail(ex, level); crest(ex, level); wings(ex, level)
    if level == 0: eyes(ex)
    o, n0 = A.tier_copy(ob, target - len(ex.tris))
    V0 = V; V = o.data.vertices
    out = A.emit(o.data, lambda p: A.srgb2lin(body_color(p.center, p.normal)), vert_rig)
    V = V0
    nbody = len(out['idx']) // 3
    for a, b, c, h, (pt, w, pv) in ex.tris:
        fc = A.srgb2lin(h)
        for p in (a, b, c):
            out['idx'].append(len(out['pos'])); out['pos'].append(A.to3(p)); out['col'].append(fc)
            out['part'].append(float(pt)); out['partw'].append(float(w)); out['piv'].append(A.to3(pv))
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(body {nbody}, legs/tail/crest/wings/eyes {len(ex.tris)})', 'verts', len(out['pos']), 'from', n0)
    return out

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK)), 'length_m': LENGTH}
A.write_glb(OUT, tiers, 'wild-earth tools/build_stellersjay.py (Blender)',
            f"Steller's jay: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (tail replaced, crest rebuilt, legs replaced, levelled, recoloured, decimated) by wild-earth tools/build_stellersjay.py",
            extras={'rig': RIG, 'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
                                           'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                                           'meshy_metadata': 'none embedded in the source GLB'}})

# ---- optional preview: each tier with its vertex colours, workbench, orthographic ----
if PREVIEW:
    sc = bpy.context.scene
    ob.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for name, t in tiers:
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t['col']): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, up, scale in [('side', (0, 0.0, 0.1), (1, 0, 0.02), (0, 0, 1), 0.36), ('top', (0, 0.0, 0.08), (0, 0, 1), (0, -1, 0), 0.4),
                                        ('front', (0, 0, 0.1), (0, -1, 0.1), (0, 0, 1), 0.3), ('q', (0, 0, 0.1), (0.8, -0.7, 0.45), (0, 0, 1), 0.36),
                                        ('head', (0, -0.1, 0.13), (1, -0.25, 0.1), (0, 0, 1), 0.12)]:
            ctr = Vector(ctr); cam.data.ortho_scale = scale
            fwd = -Vector(d).normalized(); u = Vector(up)
            r = fwd.cross(u).normalized(); u = r.cross(fwd)
            mw = Matrix((r, u, -fwd)).transposed().to_4x4(); mw.translation = ctr - fwd * 3
            cam.matrix_world = mw
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
