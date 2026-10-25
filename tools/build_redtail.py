# Build client/assets/redtail.glb, the ambient soaring red-tailed hawk, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1719d-772f-76b4-9155-823815fec267, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (20,779 triangles, untextured, one piece plus a stray triangle), 2026-10-25 UTC;
#   job record in library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/job.json. Prompt:
#   "A red-tailed hawk (Buteo jamaicensis), one adult bird soaring in mid-air, wings fully spread out flat to the
#   sides and symmetrical, about 125 cm wingspan and 55 cm long, shaped to read from below and from above. Broad
#   rounded wings with a straight leading edge and five separated, fingered primary feathers at each wingtip. Short,
#   broad brick-red tail fanned wide into a rounded fan. Legs and feet tucked up under the body. Big rounded head and
#   short hooked bill projecting ahead of the wings. Pale underwing with a dark leading-edge bar and a dark wrist
#   mark, pale breast with a dark belly band. Not an eagle, not a falcon. Single bird, no base, no perch. Game-ready,
#   clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_redtail.py -- \
#       library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/model.glb \
#       client/assets/redtail.glb [--preview /tmp/redtail_preview]
#
# What it does (brief: library/animals/drafts/buteo_jamaicensis.md; review in library/animals/buteo_jamaicensis.json):
# the ambient flight mesh, seen from below and above at 100-400 m. The generated body, head and tail are kept and
# fixed: the dangling feet are deleted, the whole bird is pitched 12 degrees nose-down (the source flies nose-up
# with its wing at about 17 degrees of incidence), the drooping tail is lifted 6 degrees toward the body line and
# fanned 1.1x at its tip. The generated wings (a 24 degree V, long and narrow, seven to eight eagle-like fingers)
# are cut off at the body and rebuilt: the plan outline (leading and trailing edge per span station) is traced from
# the source and lofted as a closed, cambered wing on a 5 degree dihedral from the shoulder, its chord widened 1.2x
# about the mid-chord (ramped in from the shoulder) so it reads broad and buteo-like, the hand's trailing edge
# pulled forward into a rounded tip, with five shorter slotted primaries (tapered blades fanned from -18 to +28
# degrees, tips curled up) and a lightly serrated trailing edge on lod0. Scales to a 1.24 m span (0.6 m bill to
# tail follows). Recolours by region from the brief's sRGB: dark brown head and back with pale mottled scapulars,
# cream breast with a streaked dark belly band, brick-red tail above (pinkish below); underneath, the wing is lofted
# in chordwise rows so its pattern is its own faces: a dark patagial bar on the arm's leading edge, a dark wrist
# comma, pale lining, pale flight feathers with a dark trailing edge and dark finger tips; brown upperwing with
# paler coverts; dark bill with a yellow cere, dark eye (lod0). Tiers: lod0 ~2,500, lod1 ~900, lod2 ~250
# triangles: the body decimated (collapse, X symmetry), the wing lofted per tier with fewer stations and rows (lod2:
# three stations, three rows: bar, lining, flight feathers; five fingers; 2.5x thicker so it never thins out
# edge-on), so the outline, finger notches and colours survive to the far tier. Rig: the bird template
# (animalModels.js PART): BODY, TAIL, HEAD, WING_L/R (arm, pivot at the shoulder, weight ramped in over the wing
# root) and HAND_L/R (pivot at the wrist, weight ramped over the hand; primaries fully HAND); the shoulder, wrist,
# tail and neck pivots are in the GLB's extras.rig. Origin 0.11 m below the shoulder line, like buildHawk.
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
JOB = '01a1719d-772f-76b4-9155-823815fec267'
SPAN = 1.24                            # wingtip to wingtip (m)
DIHEDRAL = 5.0                         # degrees, shoulder to wingtip
CHORD = 1.2                            # wing chord factor (about the mid-chord, ramped in from the shoulder)
PITCH = 12.0                           # the source flies nose-up: pitch the whole bird down (degrees)
TAIL_LIFT = 6.0                        # then lift the tail toward the body line (degrees, about its root)
ROUND_TE, ROUND_LE = 0.30, 0.06        # hand rounding: trailing and leading edge pulled in at the hand's end (of chord)
T_ROOT, T_HAND, CAMBER = 0.034, 0.012, 0.035   # wing thickness at the root and hand (m), camber (of chord)
TIERS = [('lod0', 2500), ('lod1', 900), ('lod2', 250)]
# per tier: arm and hand intervals, chordwise row edges (fractions of chord), finger segments, trailing-edge serration
WING_LOD = [dict(arm=8, hand=5, rows=(0, 0.04, 0.11, 0.45, 0.93, 1.0), seg=2, serr=0.008),
            dict(arm=4, hand=2, rows=(0, 0.12, 0.45, 0.92, 1.0), seg=1, serr=0),
            dict(arm=2, hand=1, rows=(0, 0.15, 0.5, 1.0), seg=1, serr=0, thick=2.5)]
# five primaries P10 (front) .. P6: angle from straight out (degrees, + swept back), length (m), root width (m)
FINGERS = [(-18, 0.064, 0.040), (-6, 0.084, 0.044), (5, 0.088, 0.044), (16, 0.076, 0.044), (28, 0.056, 0.040)]
FINGER_CURL = 0.16                     # tips lift by this fraction of their length

# Part ids (animalModels.js PART)
BODY, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 3, 4, 5, 6, 9, 10

# brief section 1 (sRGB)
BACK, MOTTLE, BREAST, BAND, VENT = 0x4f3826, 0x8a6a4c, 0xe6dcc6, 0x5a3e2a, 0xebe3d0
TAIL_UP, TAIL_DN = 0xb4502b, 0xd9b8a0
BAR, LINING, FLIGHT_DN, TRAIL, TIP_DN = 0x3a2a20, 0xe4d8c0, 0xd8d4cc, 0x8a8078, 0x403830
COVERT_UP, FLIGHT_UP, TIP_UP = 0x5e4430, 0x463224, 0x2e2620
HEADC, THROAT, BILL, CERE, EYEC = 0x4a3424, 0x6a5038, 0x2a2622, 0xd9c25a, 0x2a160c
smooth = A.smooth

# ---- source landmarks (raw units, Blender axes: x the bird's left, -y forward, +z up; ~1.9 units span) ----
X_ROOT, X_WR, X_CUT = 0.115, 0.50, 0.70   # the wing leaves the body, wrist, end of the hand (the generated fingers part)
Y_NECK, Y_TAIL = -0.165, 0.14             # neck base, tail root
PIV0 = Vector((0, -0.04, -0.12))          # body centre (pitch pivot)
def is_tail(p): return abs(p.x) < 0.17 and p.y > Y_TAIL and p.z < -0.17

ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
# feet: the talon blob under the tail root
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

# pitch the whole bird nose-down about the body centre
R = Matrix.Rotation(math.radians(PITCH), 3, 'X')    # +x rotation: the front (-y) goes down
for v in V: v.co = PIV0 + R @ (v.co - PIV0)

# ---- trace the wing outline in plan (|x| bins: leading and trailing edge y), both sides together ----
def trace(lo, hi, step):
    bins = {}
    for v in V:
        ax = abs(v.co.x)
        if lo <= ax < hi and v.index not in tailset: bins.setdefault(int((ax - lo) / step), []).append(v.co)
    t = [(lo + (k + 0.5) * step, min(p.y for p in b), max(p.y for p in b)) for k, b in sorted(bins.items())]
    sm = []                                             # 3-bin running mean (the feather-tip serrations)
    for i in range(len(t)):
        w = t[max(0, i - 1):i + 2]
        sm.append((t[i][0], sum(a[1] for a in w) / len(w), sum(a[2] for a in w) / len(w)))
    return sm
TR_RAW = trace(X_ROOT - 0.02, X_CUT + 0.02, 0.02)
def interp(tab, i, ax):
    if ax <= tab[0][0]: return tab[0][i]
    for a, b in zip(tab, tab[1:]):
        if ax <= b[0]: t = (ax - a[0]) / (b[0] - a[0]); return a[i] + (b[i] - a[i]) * t
    return tab[-1][i]

# ---- the wing root stub: level its chord, then cut the generated wings off at the body (procedural wings follow) ----
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
ROOT_T = zhi - zlo
print('INFO root section centre y %.3f z %.3f thickness %.3f (raw)' % (ROOT_C.y, ROOT_C.z, ROOT_T))
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(v.co.x) > X_ROOT and v.index not in tailset], context='VERTS')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
seen = set(); isl = []                                  # wing scraps left loose by the cut
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

# ---- tail: lift toward the body line about its root, fan the tip a little ----
TP = PIV0 + R @ (Vector((0, Y_TAIL, -0.215)) - PIV0)
TAIL_TIP = max(v.co.y for v in V)
L = math.radians(TAIL_LIFT)
for v in V:
    if abs(v.co.x) > 0.2 or v.co.y < TP.y - 0.02: continue
    w = smooth(TP.y - 0.02, TP.y + 0.08, v.co.y)
    d = v.co - Vector((v.co.x, TP.y, TP.z))
    v.co = Vector((v.co.x, TP.y, TP.z)) + Matrix.Rotation(L * w, 3, 'X') @ d
    v.co.x *= 1 + 0.1 * smooth(TP.y + 0.04, TAIL_TIP, v.co.y)
me.update()

# ---- to metres: shoulder pivot at the root section's centre, 0.11 m above the origin and 0.02 m ahead of it ----
REACH = max(Lf * math.cos(math.radians(a)) for a, Lf, w in FINGERS) - 0.015
S = (SPAN / 2 - REACH) / X_CUT         # the procedural primaries' tips make the span
SH_RAW = Vector((X_ROOT, ROOT_C.y, ROOT_C.z))
def M(p): return Vector((p[0] * S, (p[1] - SH_RAW.y) * S - 0.02, (p[2] - SH_RAW.z) * S + 0.11))
for v in V: v.co = M(v.co)
me.update()
TR = [(ax * S, (le - SH_RAW.y) * S - 0.02, (te - SH_RAW.y) * S - 0.02) for ax, le, te in TR_RAW]
for ax, le, te in TR[::3]: print('TRACE %.3f le %.3f te %.3f chord %.3f' % (ax, le, te, te - le))
SHOULDER = Vector((X_ROOT * S, -0.02, 0.11))
tanD = math.tan(math.radians(DIHEDRAL))
def zmid(ax): return SHOULDER.z + max(0.0, ax - SHOULDER.x) * tanD
WRIST = Vector((X_WR * S, -0.02, zmid(X_WR * S)))
CUT = X_CUT * S
NECK = M(PIV0 + R @ (Vector((0, Y_NECK, -0.12)) - PIV0))
TAILP = M(TP)
Y_TAILTIP = max(v.co.y for v in V); Y_BILL = min(v.co.y for v in V)
print('INFO scale %.4f m/unit; bill to tail %.3f m; span %.3f m' % (S, Y_TAILTIP - Y_BILL, 2 * (CUT + REACH)))

# eye on the head surface
EYE = M(PIV0 + R @ (Vector((0, -0.305, -0.105)) - PIV0))
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(Vector((0.3, EYE.y, EYE.z)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.022
print('INFO eye x %.4f' % EYE_X)

# ---- the wing: outline, mid-surface, thickness ----
def outline(ax):
    le, te = interp(TR, 1, ax), interp(TR, 2, ax)
    k = 1 + (CHORD - 1) * smooth(SHOULDER.x, SHOULDER.x + 0.1, ax)
    yc = (le + te) / 2; le, te = yc + (le - yc) * k, yc + (te - yc) * k
    h = smooth(WRIST.x, CUT, ax) ** 1.6; c = te - le
    return le + ROUND_LE * c * h, te - ROUND_TE * c * h
def wing_point(s, ax, f, side, serr=0.0, tk=1.0):
    le, te = outline(ax); c = te - le
    th = tk * (T_ROOT + (T_HAND - T_ROOT) * smooth(SHOULDER.x, CUT, ax))
    z = zmid(ax) + CAMBER * c * 4 * f * (1 - f) + side * 0.5 * th * 2.6 * math.sqrt(f) * (1 - f)
    return Vector((s * ax, le + c * f + (serr if f >= 1 else 0), z))

# ---- rig ----
def head_w(p): return smooth(NECK.y + 0.015, NECK.y - 0.03, p.y)
def tail_w(p): return smooth(TAILP.y - 0.01, TAILP.y + 0.05, p.y) if abs(p.x) < 0.16 else 0.0
def vert_rig(i):
    p = V[i].co
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())
def arm_rig(s, ax): return (WING_L if s > 0 else WING_R), smooth(SHOULDER.x - 0.01, SHOULDER.x + 0.05, ax), Vector((s * SHOULDER.x, SHOULDER.y, SHOULDER.z))
def hand_rig(s, ax): return (HAND_L if s > 0 else HAND_R), smooth(WRIST.x - 0.005, WRIST.x + 0.06, ax), Vector((s * WRIST.x, WRIST.y, WRIST.z))

# ---- colour: the mesh (body, head, tail) by region ----
def fleck(c, k=0.012): return A.hash01(abs(c.x) // k, c.y // k, c.z // k)
def body_color(c, n):
    ax = abs(c.x)
    if head_w(c) > 0.5:
        if c.y < Y_BILL + 0.03: return BILL if c.y < Y_BILL + 0.024 else CERE
        return THROAT if n.z < -0.45 else HEADC
    if tail_w(c) > 0.5:
        return TAIL_DN if n.z < 0 else TAIL_UP
    if n.z > 0.05:                                                     # back, pale mottled scapulars
        return A.mix(BACK, MOTTLE, 0.65) if ax > 0.03 and c.y < 0.04 and fleck(c) < 0.45 else BACK
    if NECK.y + 0.07 < c.y < NECK.y + 0.17:                              # belly band: dark streaks
        return BAND if fleck(c, 0.012) < 0.6 else BREAST
    return BREAST if c.y < NECK.y + 0.07 else VENT
# ---- colour: the wing by chordwise row ----
def wing_color(f0, f1, up, hand, comma):
    if up: return COVERT_UP if f1 <= 0.5 else FLIGHT_UP
    if f1 <= 0.15: return LINING if hand else BAR                      # patagial bar to the wrist
    if f1 <= 0.5: return BAR if comma else LINING                      # lining; the comma at the wrist
    return TRAIL if f0 >= 0.88 else FLIGHT_DN                          # flight feathers, dark trailing edge

class Extra:
    def __init__(self): self.tris = []
    def tri(self, a, b, c, col, rig, out):
        a, b, c = Vector(a), Vector(b), Vector(c)
        if (b - a).cross(c - a).dot(out) < 0: b, c = c, b
        self.tris.append((a, b, c, col, rig))
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
            comma = level < 2 and ((hand and k == cfg['arm']) or (level == 0 and not hand and k == cfg['arm'] - 1))
            e0 = cfg['serr'] if (not hand and k % 2) else 0; e1 = cfg['serr'] if (not hand and (k + 1) % 2 and k + 1 < cfg['arm']) else 0
            for j in range(len(rows) - 1):
                f0, f1 = rows[j], rows[j + 1]
                for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                    p = [wing_point(s, a0, f0, side, e0, tk), wing_point(s, a1, f0, side, e1, tk), wing_point(s, a1, f1, side, e1, tk), wing_point(s, a0, f1, side, e0, tk)]
                    col = wing_color(f0, f1, side > 0, hand, comma)
                    ex.quad(p, col, [rig(abs(q.x)) for q in p], out)
    # primaries: fanned blades from the hand's end, the outer ones slotted, tips curled up
    le, te = outline(CUT); c = te - le
    for s in (1, -1):
        part, _, piv = hand_rig(s, CUT); rg = (part, 1.0, piv)
        for i, (a, Lf, w0) in enumerate(FINGERS):
            f = 0.05 + 0.9 * (i + 0.5) / len(FINGERS)
            root = wing_point(s, CUT - 0.015, f, 0)
            d = Vector((s * math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
            across = Vector((-d.y, d.x, 0)) * s
            seg = cfg['seg']; pts = []
            for q in range(seg + 1):
                t = q / seg
                p = root + d * (Lf * t) + Vector((0, 0, FINGER_CURL * Lf * t * t))
                wd = w0 * (1 - 0.6 * t)
                pts.append((p + across * (wd / 2), p - across * (wd / 2)))
            for q in range(seg):
                (a0p, b0p), (a1p, b1p) = pts[q], pts[q + 1]; tip = q == seg - 1
                for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                    off = Vector((0, 0, 0.0025 * tk * side))
                    col = (TIP_UP if tip else FLIGHT_UP) if side > 0 else (TIP_DN if tip else FLIGHT_DN)
                    ex.quad([a0p + off, b0p + off, b1p + off, a1p + off], col, [rg] * 4, out)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (EYE_X - 0.001), EYE.y, EYE.z)), Vector((0.0035, 0.005, 0.0045)), EYEC, (HEAD, 1.0, NECK))

# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); wings(ex, level)
    if level == 0: eyes(ex)
    o, n0 = A.tier_copy(ob, target - len(ex.tris))
    V0 = V; V = o.data.vertices
    out = A.emit(o.data, lambda p: A.srgb2lin(body_color(p.center, p.normal)), vert_rig)
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
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'wrist': list(A.to3(WRIST)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK)),
       'span_m': SPAN, 'dihedral_deg': DIHEDRAL}
A.write_glb(OUT, tiers, 'wild-earth tools/build_redtail.py (Blender)',
            f'Red-tailed hawk: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (feet removed, levelled, wings retraced broader and flat with five primaries, recoloured, decimated) by wild-earth tools/build_redtail.py',
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
