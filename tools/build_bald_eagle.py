# Build client/assets/bald_eagle.glb, the ambient soaring bald eagle (Haliaeetus leucocephalus), the river eagle of
# the Hoh, as a variant of the red-tailed hawk's flight mesh.
#
# Source: variant of buteo_jamaicensis built from its Meshy (meshy.ai) text-to-3D preview, task
#   01a1719d-772f-76b4-9155-823815fec267 (ai_model meshy-6-lite, triangle remesh to 20,000 faces, 20,779 triangles,
#   untextured), 2026-10-25 UTC; job record in the main checkout's
#   library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/job.json (prompt there and in
#   library/animals/buteo_jamaicensis.json). No credits: the eagle's own preview, task
#   01a1ad37-9f49-7378-98c1-23e921af6bc7 (meshy-6-lite, 2026-11-05, 5 credits; prompt in its job.json and in
#   library/animals/haliaeetus_leucocephalus.json), came back flapping with the body upright like a perched pigeon, the
#   legs dangling, the tail hanging at 60 degrees and a small thin bill, so it is not used; the red-tail source's body is
#   already a level flight body with a long projecting head and a big hooked bill, which reads as an eagle's.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root; the source mesh is git-ignored, in the main checkout):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_bald_eagle.py -- \
#       library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/model.glb \
#       client/assets/bald_eagle.glb [--preview <prefix>]
#
# What it does (review in library/animals/haliaeetus_leucocephalus.json): the ambient flight mesh, seen from below and
# above at 100-400 m, built exactly as tools/build_redtail.py builds the hawk (same source, same landmarks): the
# dangling feet deleted, the bird pitched 12 degrees nose-down, the generated wings cut off at the body. Then for the
# eagle: the head made fuller (1.12x across and deep) and the bill deepened (a further 1.12x tall, 1.15x wide) so
# the white head and massive yellow bill project well ahead of the wings; the tail lifted 6 degrees toward the body line, lengthened 1.12x and
# drawn out into a medium wedge (the centre feathers longest), fanned 1.05x at the tip. Scales the body to 0.85 m bill
# to tail. The wings are lofted from a plan outline of our own (not traced): long broad "plank" wings with nearly
# parallel leading and trailing edges (chord 0.42 m at the arm, 0.44 m over the bulging secondaries, 0.34 m at the end of
# the hand, so the hand is as broad as the arm), blended from the cut root stub over the first 0.1 m, a 2 degree
# dihedral (flat-winged soaring), a closed cambered section, and seven well-separated slotted primaries (tapered blades
# fanned from -16 to +44 degrees, the middle ones longest, tips curled up); span 2.0 m. Recolours by region (adult):
# the head and upper neck white, the tail and undertail coverts white, the body dark chocolate brown, a yellow hooked
# bill and cere, a pale yellow eye (lod0); the wings dark chocolate above and below, a little paler grey-brown on the
# bases of the flight feathers below with a dark trailing edge and dark finger tips. Faint per-face grizzle on the body.
# Tiers: lod0 ~2,500, lod1 ~900, lod2 ~250 triangles: the body decimated (collapse, X symmetry), the wing lofted per tier
# with fewer stations and rows (lod2: three stations, three rows, seven fingers, 2.5x thicker so it never thins out
# edge-on). Rig: the bird template (animalModels.js PART): BODY, TAIL, HEAD, WING_L/R (arm, pivot at the shoulder,
# weight ramped in over the wing root) and HAND_L/R (pivot at the wrist, weight ramped over the hand; primaries fully
# HAND); the shoulder, wrist, tail and neck pivots are in the GLB's extras.rig (the hawk's keys). Origin 0.11 m below
# the shoulder line, like the hawk. Mass 4.5 kg (not used by the mesh).
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (top, below, front, side, three-quarter; workbench, vertex colour).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1719d-772f-76b4-9155-823815fec267'           # the red-tail source used
JOB_EAGLE = '01a1ad37-9f49-7378-98c1-23e921af6bc7'     # the eagle's own preview (not used: flapping, upright)
SPECIES = 'haliaeetus_leucocephalus'
SPAN = 2.0                             # wingtip to wingtip (m)
LENGTH = 0.85                          # bill tip to tail tip (m)
DIHEDRAL = 2.0                         # degrees, shoulder to wingtip
PITCH = 12.0                           # the source flies nose-up: pitch the whole bird down (degrees)
TAIL_LIFT = 6.0                        # then lift the tail toward the body line (degrees, about its root)
TAIL_STRETCH, TAIL_WEDGE, TAIL_FAN = 1.12, 0.045, 1.05   # tail length factor, extra length of the centre (raw), fan
BILL_Z, BILL_X, HEAD_X, HEAD_Z, HEAD_ZC = 1.12, 1.15, 1.12, 1.12, -0.125
ROUND_TE, ROUND_LE = 0.06, 0.03        # hand rounding: trailing and leading edge pulled in at the hand's end (of chord)
T_ROOT, T_HAND, CAMBER = 0.05, 0.016, 0.03     # wing thickness at the root and hand (m), camber (of chord)
WRIST_X = 0.50                         # wrist, metres from the centreline
TIERS = [('lod0', 2500), ('lod1', 900), ('lod2', 250)]
WING_LOD = [dict(arm=8, hand=5, rows=(0, 0.04, 0.11, 0.45, 0.93, 1.0), seg=2, serr=0.008),
            dict(arm=4, hand=2, rows=(0, 0.12, 0.45, 0.92, 1.0), seg=1, serr=0),
            dict(arm=2, hand=1, rows=(0, 0.15, 0.5, 1.0), seg=1, serr=0, thick=2.5)]
# seven primaries P10 (front) .. P4: angle from straight out (degrees, + swept back), length (m), root width (m)
FINGERS = [(-16, 0.15, 0.046), (-6, 0.21, 0.052), (4, 0.235, 0.054), (13, 0.225, 0.054), (22, 0.20, 0.052),
           (32, 0.165, 0.050), (44, 0.12, 0.046)]
FINGER_CURL = 0.10                     # tips lift by this fraction of their length
# plank plan outline (metres from the centreline; y of the leading and trailing edge relative to the shoulder pivot's y,
# forward is -y); the root stub's own chord is blended in over the first 0.1 m
PLAN = [(0.12, -0.20, 0.22), (0.30, -0.215, 0.225), (0.50, -0.225, 0.205), (0.65, -0.215, 0.19), (0.80, -0.195, 0.175)]

# Part ids (animalModels.js PART)
BODY, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 3, 4, 5, 6, 9, 10

# adult plumage (sRGB)
BACK, BELLY, NAPE = 0x3b2a1e, 0x34251b, 0x4a3828
WHITE, WHITE_DN, TAIL_UP, TAIL_DN = 0xf2f0ea, 0xe4e2dc, 0xf3f1ec, 0xe2e0da
BILL, CERE, EYEC = 0xe8b828, 0xe9c447, 0xece08c
COVERT_UP, FLIGHT_UP, TIP_UP = 0x45321f, 0x2f2218, 0x221a14
LINING, FLIGHT_DN, TRAIL, TIP_DN = 0x35261b, 0x6a5e54, 0x2e251e, 0x2a221c
smooth = A.smooth

# ---- source landmarks (raw units, Blender axes: x the bird's left, -y forward, +z up; ~1.9 units span) ----
X_ROOT, X_CUT = 0.115, 0.70            # the wing leaves the body; end of the hand (the generated fingers part)
Y_NECK, Y_TAIL = -0.165, 0.14          # neck base, tail root
PIV0 = Vector((0, -0.04, -0.12))       # body centre (pitch pivot)
BILL0 = Vector((0, -0.30, -0.15))      # the bill's base (gape), before the pitch
def is_tail(p): return abs(p.x) < 0.17 and p.y > Y_TAIL and p.z < -0.17

ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
feet = [v for v in bm.verts if abs(v.co.x) < 0.09 and 0.085 < v.co.y < 0.18 and v.co.z < -0.258]
print('INFO feet verts', len(feet))
bmesh.ops.delete(bm, geom=feet, context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
near = [v for v in bm.verts if abs(v.co.x) < 0.1 and 0.06 < v.co.y < 0.2 and v.co.z < -0.22]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=near, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
tailset = {v.index for v in V if is_tail(v.co)}

# ---- the eagle's head: fuller across, the bill deeper and wider (before the pitch) ----
for v in V:
    p = v.co
    if abs(p.x) > 0.12: continue
    hw = smooth(-0.17, -0.24, p.y)                       # the head, ramped in ahead of the neck
    p.x *= 1 + (HEAD_X - 1) * hw
    p.z = HEAD_ZC + (p.z - HEAD_ZC) * (1 + (HEAD_Z - 1) * hw)
    bw = smooth(-0.285, -0.305, p.y)                     # the bill
    if bw > 0:
        p.x *= 1 + (BILL_X - 1) * bw
        p.z = BILL0.z + (p.z - BILL0.z) * (1 + (BILL_Z - 1) * bw)
me.update()

# pitch the whole bird nose-down about the body centre
R = Matrix.Rotation(math.radians(PITCH), 3, 'X')    # +x rotation: the front (-y) goes down
for v in V: v.co = PIV0 + R @ (v.co - PIV0)

# ---- the root stub's chord (le, te) from the source, to blend the lofted wing into the body ----
def stub(lo, hi):
    s = [v.co.y for v in V if lo <= abs(v.co.x) < hi and v.index not in tailset]
    return min(s), max(s)
STUB_RAW = stub(X_ROOT - 0.02, X_ROOT)

# ---- the wing root stub: level its chord, then cut the generated wings off at the body ----
def section(lo, hi):
    s = [v.co for v in V if lo < abs(v.co.x) < hi and v.index not in tailset]
    s.sort(key=lambda p: p.y); n = max(3, len(s) // 8)
    le, te = s[:n], s[-n:]
    zl, zt = sum(p.z for p in le) / n, sum(p.z for p in te) / n
    yl, yt = sum(p.y for p in le) / n, sum(p.y for p in te) / n
    return math.atan2(zl - zt, yt - yl), Vector((0, (yl + yt) / 2, (zl + zt) / 2)), min(p.z for p in s), max(p.z for p in s)
ang, ctr, _, _ = section(X_ROOT - 0.01, X_ROOT + 0.02)
print('INFO root chord angle after pitch %.1f deg' % math.degrees(ang))
for v in V:
    ax = abs(v.co.x); w = smooth(X_ROOT - 0.05, X_ROOT - 0.005, ax)
    if w <= 0 or v.index in tailset: continue
    d = v.co - Vector((v.co.x, ctr.y, ctr.z)); r = Matrix.Rotation(ang * w, 3, 'X') @ d
    v.co = Vector((v.co.x, ctr.y, ctr.z)) + r
_, ROOT_C, zlo, zhi = section(X_ROOT - 0.015, X_ROOT)
print('INFO root section centre y %.3f z %.3f thickness %.3f (raw)' % (ROOT_C.y, ROOT_C.z, zhi - zlo))
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(v.co.x) > X_ROOT and v.index not in tailset], context='VERTS')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
seen = set(); isl = []
for f in bm.faces:
    if f in seen: continue
    st = [f]; seen.add(f); n = []
    while st:
        g = st.pop(); n.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h not in seen: seen.add(h); st.append(h)
    isl.append(n)
big = max(len(n) for n in isl)
bmesh.ops.delete(bm, geom=[f for n in isl if len(n) < 0.02 * big for f in n], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
print('INFO pieces after the wing cut', len(isl))
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices

# ---- tail: lift toward the body line about its root, lengthen into a wedge, fan the tip a little ----
TP = PIV0 + R @ (Vector((0, Y_TAIL, -0.215)) - PIV0)
TAIL_TIP0 = max(v.co.y for v in V)
L = math.radians(TAIL_LIFT)
HW = max(abs(v.co.x) for v in V if v.co.y > TAIL_TIP0 - 0.04)       # half-width at the tip
for v in V:
    if abs(v.co.x) > 0.2 or v.co.y < TP.y - 0.02: continue
    w = smooth(TP.y - 0.02, TP.y + 0.08, v.co.y)
    d = v.co - Vector((v.co.x, TP.y, TP.z))
    v.co = Vector((v.co.x, TP.y, TP.z)) + Matrix.Rotation(L * w, 3, 'X') @ d
    t = max(0.0, (v.co.y - TP.y) / (TAIL_TIP0 - TP.y))
    k = smooth(0.0, 0.5, t)
    v.co.y = TP.y + (v.co.y - TP.y) * (1 + (TAIL_STRETCH - 1) * k) + TAIL_WEDGE * t * t * max(0.0, 1 - abs(v.co.x) / max(HW, 1e-3))
    v.co.x *= 1 + (TAIL_FAN - 1) * smooth(0.4, 1.0, t)
me.update()

# ---- to metres: shoulder pivot at the root section's centre, 0.11 m above the origin and 0.02 m ahead of it ----
L_RAW = max(v.co.y for v in V) - min(v.co.y for v in V)
S = LENGTH / L_RAW
SH_RAW = Vector((X_ROOT, ROOT_C.y, ROOT_C.z))
def M(p): return Vector((p[0] * S, (p[1] - SH_RAW.y) * S - 0.02, (p[2] - SH_RAW.z) * S + 0.11))
for v in V: v.co = M(v.co)
me.update()
SHOULDER = Vector((X_ROOT * S, -0.02, 0.11))
STUB = ((STUB_RAW[0] - SH_RAW.y) * S - 0.02, (STUB_RAW[1] - SH_RAW.y) * S - 0.02)
tanD = math.tan(math.radians(DIHEDRAL))
def zmid(ax): return SHOULDER.z + max(0.0, ax - SHOULDER.x) * tanD
WRIST = Vector((WRIST_X, -0.02, zmid(WRIST_X)))
REACH = max(Lf * math.cos(math.radians(a)) for a, Lf, w in FINGERS) - 0.015
CUT = SPAN / 2 - REACH
NECK = M(PIV0 + R @ (Vector((0, Y_NECK, -0.12)) - PIV0))
TAILP = M(TP)
Y_TAILTIP = max(v.co.y for v in V); Y_BILL = min(v.co.y for v in V)
print('INFO scale %.4f m/unit; bill to tail %.3f m; span %.3f m; shoulder x %.3f; root stub le %.3f te %.3f; cut %.3f' %
      (S, Y_TAILTIP - Y_BILL, 2 * (CUT + REACH), SHOULDER.x, STUB[0], STUB[1], CUT))

# eye on the head surface (a little behind the gape)
EYE = M(PIV0 + R @ (Vector((0, -0.283, -0.112)) - PIV0))
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(Vector((0.3, EYE.y, EYE.z)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.03
print('INFO eye x %.4f' % EYE_X)

# ---- the wing: outline, mid-surface, thickness ----
PLAN_S = [(ax if i else SHOULDER.x, le - 0.02, te - 0.02) for i, (ax, le, te) in enumerate(PLAN)]
PLAN_S[-1] = (CUT, PLAN_S[-1][1], PLAN_S[-1][2])
def interp(tab, i, ax):
    if ax <= tab[0][0]: return tab[0][i]
    for a, b in zip(tab, tab[1:]):
        if ax <= b[0]: t = (ax - a[0]) / (b[0] - a[0]); return a[i] + (b[i] - a[i]) * t
    return tab[-1][i]
def outline(ax):
    le, te = interp(PLAN_S, 1, ax), interp(PLAN_S, 2, ax)
    b = smooth(SHOULDER.x, SHOULDER.x + 0.10, ax)           # blend from the cut stub's chord
    le = STUB[0] + (le - STUB[0]) * b; te = STUB[1] + (te - STUB[1]) * b
    h = smooth(WRIST.x, CUT, ax) ** 1.6; c = te - le
    return le + ROUND_LE * c * h, te - ROUND_TE * c * h
def wing_point(s, ax, f, side, serr=0.0, tk=1.0):
    le, te = outline(ax); c = te - le
    th = tk * (T_ROOT + (T_HAND - T_ROOT) * smooth(SHOULDER.x, CUT, ax))
    z = zmid(ax) + CAMBER * c * 4 * f * (1 - f) + side * 0.5 * th * 2.6 * math.sqrt(f) * (1 - f)
    return Vector((s * ax, le + c * f + (serr if f >= 1 else 0), z))
for ax in (SHOULDER.x, 0.2, 0.35, WRIST.x, 0.65, CUT):
    le, te = outline(ax); print('PLAN x %.3f le %.3f te %.3f chord %.3f' % (ax, le, te, te - le))

# ---- rig ----
def head_w(p): return smooth(NECK.y + 0.02, NECK.y - 0.04, p.y)
def tail_w(p): return smooth(TAILP.y - 0.01, TAILP.y + 0.06, p.y) if abs(p.x) < 0.22 else 0.0
def vert_rig(i):
    p = V[i].co
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())
def arm_rig(s, ax): return (WING_L if s > 0 else WING_R), smooth(SHOULDER.x - 0.01, SHOULDER.x + 0.07, ax), Vector((s * SHOULDER.x, SHOULDER.y, SHOULDER.z))
def hand_rig(s, ax): return (HAND_L if s > 0 else HAND_R), smooth(WRIST.x - 0.005, WRIST.x + 0.08, ax), Vector((s * WRIST.x, WRIST.y, WRIST.z))

# ---- colour: the mesh (body, head, tail) by region ----
WHITE_TO = NECK.y + 0.005              # the white hood reaches back over the upper neck
def fleck(c, k=0.02): return A.hash01(abs(c.x) // k, c.y // k, c.z // k)
def body_color(c, n):
    """sRGB hex and grizzle amount for a body face (centroid c, normal n; Blender axes, metres)."""
    if c.y < Y_BILL + 0.075 and abs(c.x) < 0.045 and c.y < EYE.y - 0.012:
        return (BILL if c.y < Y_BILL + 0.058 else CERE), 0.03
    if c.y < WHITE_TO + 0.015 * (fleck(c) - 0.5):
        return (WHITE if n.z > -0.4 else WHITE_DN), 0.04
    if tail_w(c) > 0.35 or (c.y > TAILP.y - 0.03 and n.z < -0.3 and abs(c.x) < 0.1):    # tail and undertail coverts
        return (TAIL_DN if n.z < 0 else TAIL_UP), 0.04
    if n.z > 0.05: return (NAPE if c.y < NECK.y + 0.09 else BACK), 0.10
    return BELLY, 0.10
def body_lin(p):
    h, g = body_color(p.center, p.normal)
    return A.grizzle(h, p.center, g, 0.03)
# ---- colour: the wing by chordwise row ----
def wing_color(f0, f1, up, hand):
    if up: return COVERT_UP if f1 <= 0.45 else FLIGHT_UP
    if f1 <= 0.45: return LINING
    return TRAIL if f0 >= 0.88 else FLIGHT_DN

class Extra:
    def __init__(self): self.tris = []
    def quad(self, p, col, rigs, out):
        """p: 4 corners in order; rigs: (part, weight, pivot) per corner."""
        for i, j, k in ((0, 1, 2), (0, 2, 3)):
            a, b, c = p[i], p[j], p[k]; ra, rb, rc = rigs[i], rigs[j], rigs[k]
            if (b - a).cross(c - a).dot(out) < 0: b, c, rb, rc = c, b, rc, rb
            self.tris.append((a, b, c, col, (ra, rb, rc)))
    def ellipsoid(self, c, r, col, rig):
        P = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            for apex in (4, 5):
                q = [P[a], P[b], P[apex]]
                o = (q[0] + q[1] + q[2]) / 3 - c
                if (q[1] - q[0]).cross(q[2] - q[0]).dot(o) < 0: q[1], q[2] = q[2], q[1]
                self.tris.append((q[0], q[1], q[2], col, (rig, rig, rig)))

def wings(ex, level):
    cfg = WING_LOD[level]; rows = cfg['rows']; tk = cfg.get('thick', 1.0)   # the far tier thicker, so it never thins out edge-on
    root = SHOULDER.x - 0.015
    st = [root + (WRIST.x - root) * i / cfg['arm'] for i in range(cfg['arm'] + 1)] + [WRIST.x + (CUT - WRIST.x) * i / cfg['hand'] for i in range(1, cfg['hand'] + 1)]
    for s in (1, -1):
        for k in range(len(st) - 1):
            a0, a1 = st[k], st[k + 1]; hand = a0 >= WRIST.x - 1e-6
            rig = (lambda ax: hand_rig(s, ax)) if hand else (lambda ax: arm_rig(s, ax))
            e0 = cfg['serr'] if (not hand and k % 2) else 0; e1 = cfg['serr'] if (not hand and (k + 1) % 2 and k + 1 < cfg['arm']) else 0
            for j in range(len(rows) - 1):
                f0, f1 = rows[j], rows[j + 1]
                for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                    p = [wing_point(s, a0, f0, side, e0, tk), wing_point(s, a1, f0, side, e1, tk), wing_point(s, a1, f1, side, e1, tk), wing_point(s, a0, f1, side, e0, tk)]
                    ex.quad(p, wing_color(f0, f1, side > 0, hand), [rig(abs(q.x)) for q in p], out)
    # primaries: fanned blades from the hand's end, well separated, tips curled up
    for s in (1, -1):
        part, _, piv = hand_rig(s, CUT); rg = (part, 1.0, piv)
        for i, (a, Lf, w0) in enumerate(FINGERS):
            f = 0.04 + 0.92 * (i + 0.5) / len(FINGERS)
            root = wing_point(s, CUT - 0.02, f, 0)
            d = Vector((s * math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
            across = Vector((-d.y, d.x, 0)) * s
            seg = cfg['seg']; pts = []
            for q in range(seg + 1):
                t = q / seg
                p = root + d * (Lf * t) + Vector((0, 0, FINGER_CURL * Lf * t * t))
                wd = w0 * (1 - 0.45 * t)
                pts.append((p + across * (wd / 2), p - across * (wd / 2)))
            for q in range(seg):
                (a0p, b0p), (a1p, b1p) = pts[q], pts[q + 1]; tip = q == seg - 1
                for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                    off = Vector((0, 0, 0.003 * tk * side))
                    col = (TIP_UP if tip else FLIGHT_UP) if side > 0 else (TIP_DN if tip else FLIGHT_DN)
                    ex.quad([a0p + off, b0p + off, b1p + off, a1p + off], col, [rg] * 4, out)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (abs(EYE_X) - 0.0015), EYE.y, EYE.z)), Vector((0.005, 0.0065, 0.0055)), EYEC, (HEAD, 1.0, NECK))

# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); wings(ex, level)
    if level == 0: eyes(ex)
    o, n0 = A.tier_copy(ob, target - len(ex.tris))
    V0 = V; V = o.data.vertices
    out = A.emit(o.data, body_lin, vert_rig)
    V = V0
    nbody = len(out['idx']) // 3
    for a, b, c, h, rigs in ex.tris:
        fc = A.srgb2lin(h)
        for p, (pt, w, pv) in zip((a, b, c), rigs):
            out['idx'].append(len(out['pos'])); out['pos'].append(A.to3(p)); out['col'].append(fc)
            out['part'].append(float(pt)); out['partw'].append(float(w)); out['piv'].append(A.to3(pv))
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(mesh {nbody}, wings and eyes {len(ex.tris)})', 'verts', len(out['pos']), 'from', n0)
    return out

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
print('LANDMARKS span %.3f m, bill to tail %.3f m, bill tip z %.3f, tail tip z %.3f, head+neck ahead of the wing root %.3f m, tail behind its root %.3f m, shoulder %s, wrist %s, neck %s, tail root %s' % (
    ext[0][1] - ext[0][0], ext[2][1] - ext[2][0], -Y_BILL, -Y_TAILTIP, outline(SHOULDER.x + 0.1)[0] - Y_BILL, Y_TAILTIP - TAILP.y,
    tuple(round(x, 3) for x in A.to3(SHOULDER)), tuple(round(x, 3) for x in A.to3(WRIST)), tuple(round(x, 3) for x in A.to3(NECK)), tuple(round(x, 3) for x in A.to3(TAILP))))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'wrist': list(A.to3(WRIST)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK)),
       'span_m': SPAN, 'dihedral_deg': DIHEDRAL}
A.write_glb(OUT, tiers, 'wild-earth tools/build_bald_eagle.py (Blender)',
            f'Bald eagle: generated with Meshy (meshy.ai), task {JOB} (the red-tailed hawk preview), owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt as an eagle (feet removed, levelled, head and bill enlarged, wedge tail, plank wings lofted flat with seven primaries, recoloured, decimated) by wild-earth tools/build_bald_eagle.py',
            extras={'species': SPECIES, 'rig': RIG,
                    'source': {'kind': 'variant', 'of': 'buteo_jamaicensis', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
                               'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                               'meshy_metadata': 'none embedded in the source GLB',
                               'rejected': {'job_id': JOB_EAGLE, 'why': 'flapping, upright body, dangling legs, small bill'}}})

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
        for view, d, up in [('top', (0, 0, 1), (0, -1, 0)), ('below', (0, 0, -1), (0, -1, 0)), ('front', (0, -1, 0.08), (0, 0, 1)),
                            ('side', (1, 0, 0.02), (0, 0, 1)), ('q', (0.7, -0.8, -0.5), (0, 0, 1))]:
            ctr = Vector((0, 0, 0.1)); cam.data.ortho_scale = SPAN * 1.1
            fwd = -Vector(d).normalized(); u = Vector(up)
            r = fwd.cross(u).normalized(); u = r.cross(fwd)
            mw = Matrix((r, u, -fwd)).transposed().to_4x4(); mw.translation = ctr - fwd * 3
            cam.matrix_world = mw
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
