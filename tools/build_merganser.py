# Build client/assets/merganser.glb, the common merganser (Mergus merganser) of the Hoh's main channel, from a Meshy
# text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1ad3c-fd50-7790-860b-de59283a3ab8, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (20,919 triangles, untextured), 2026-11-05 UTC, 5 credits; job record in
#   library/animals/jobs/mergus_merganser/01a1ad3c-fd50-7790-860b-de59283a3ab8/job.json. Prompt:
#   "A common merganser (Mergus merganser), adult female, swimming low on the water, side-on pose, wings folded, NOT a
#   mallard, NOT a duck with a broad flat bill. No water modelled: the bird alone with a flat waterline underside.
#   Realistic proportions: 62 cm long, a long low streamlined body, a long thin straight red bill with a small hooked
#   tip, a rusty chestnut head with a shaggy crest hanging back from the nape, a sharp line between the rusty neck and
#   the white chin and breast, a grey back, flanks and tail. No base. Game-ready, clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_merganser.py -- \
#       library/animals/jobs/mergus_merganser/01a1ad3c-fd50-7790-860b-de59283a3ab8/model.glb \
#       client/assets/merganser.glb [--preview <prefix>]
#
# What it does (review in library/animals/mergus_merganser.json): keeps the generated floating female (long low body,
# flat underside, the folded wing tips crossed over the tail). The generated neck is held tall (alert): it is
# shortened 40% over its middle so the head rides lower, as a swimming merganser's does; the long thin bill is
# shortened to 0.6 of its length (to ~6 cm from its base) and keeps its small hooked tip. Adds the female's shaggy crest hanging
# back from the nape (thin crossed blades, as tools/build_stellersjay.py makes its crest: five on lod0, three on lod1,
# two on lod2), a dark eye (lod0), short orange legs with webbed feet tucked under the rear of the body (in the water
# while it swims, there for a walk on a gravel bar), and flight wing cards (an arm and a hand per side: narrow, pointed
# duck wings, 0.90 m span) that the client collapses into the shoulder at rest. Scales to 0.62 m bill to tail; the
# origin is at the WATERLINE (y = 0 in glTF), the body's flat underside 4 cm below it, between the feet fore and aft.
# Colours by region (sRGB) with a faint per-face grizzle. COLOR_0 = the female ("redhead"): rusty chestnut head,
# crest and upper neck, a sharply defined white chin, a sharp border to the white foreneck and breast, grey back,
# flanks and tail, white belly, darker grey folded primaries, red bill, orange legs; the cards grey above with a white
# square speculum on the arm (a dark bar before it), dark grey primaries, pale grey below. _COLORB = the breeding male:
# dark glossy green-black head and upper neck (the crest blades take the head colour: the drake has no shaggy crest),
# white breast, flanks and belly with a faint salmon-pink wash, black back, grey rump and tail, black folded primaries,
# red bill; the cards black with a big white inner wing (secondaries and inner coverts; a thin black leading edge),
# white below on the arm.
# Tiers: lod0 ~1,200, lod1 ~450, lod2 ~150 triangles including crest, legs, cards and eyes (Blender collapse, X
# symmetry, finished without symmetry if it stalls). Rig: the bird template (animalModels.js PART): BODY, LEG_A (left)
# / LEG_B (right) pivoting at the hip, TAIL (pivot at the tail root), HEAD = neck, head and crest pivoting at the
# neck's base, WING_L/R (arm cards, pivot at the shoulder) and HAND_L/R (hand cards, pivot at the wrist). Pivots in
# extras.rig, plus waterline_m and the feet's depth.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (female and male; workbench, vertex colour) to <prefix>_*.png.
import bpy, bmesh, sys, os, json, struct, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1ad3c-fd50-7790-860b-de59283a3ab8'
SPECIES = 'mergus_merganser'
LENGTH = 0.62                          # bill tip to tail tip (m)
SPAN = 0.90                            # wing cards, tip to tip (m)
DRAFT = 0.04                           # the flat underside below the waterline (m)
NECK_Z, NECK_SQ = (-0.10, 0.15), 0.6   # raw z band of the neck shortened to this fraction (the head comes down with it)
BILL_Y0, BILL_K = -0.655, 0.60         # bill base (raw y) and the length factor
TIERS = [('lod0', 1200), ('lod1', 450), ('lod2', 150)]
smooth = A.smooth

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# female, then male (sRGB)
F_HEAD, F_CHIN, F_BREAST, F_BACK, F_FLANK, F_TAIL, F_PRIM, F_BELLY, F_NAPE = 0x9c4826, 0xf4f2ec, 0xeceae4, 0x737981, 0x8b9097, 0x6c727a, 0x4b5058, 0xe8e6e0, 0x8a4a2e
M_HEAD, M_BREAST, M_BACK, M_RUMP, M_PRIM = 0x13261c, 0xf3e5d8, 0x17171a, 0x8a8f96, 0x1c1c1f
BILL, LEGC, EYEC = 0xbd2d24, 0xe0702a, 0x1a0e0a
# cards: (female, male) above / below
CARD_COV, CARD_SPEC, CARD_BAR, CARD_PRIM = (0x7a8088, 0x1c1c1f), (0xf2f2ee, 0xf2f2ee), (0x2a2c30, 0xf2f2ee), (0x40444b, 0x1c1c1f)
CARD_DN, CARD_DN_HAND = (0xc8cacd, 0xe8e8e6), (0x9a9ea4, 0x8c9096)
CARD_INNER_M = 0xf0f0ec                # the drake's white inner coverts

# ---- load, fix the neck and bill (raw frame: x the bird's left, -y forward, +z up; 1.9 units bill to tail) ----
ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
nm = 0
for _ in range(4):                     # faces on edges shared by more than two faces stall the collapse
    fs = {f for e in bm.edges if len(e.link_faces) > 2 for f in e.link_faces}
    if not fs: break
    nm += len(fs); bmesh.ops.delete(bm, geom=list(fs), context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0); bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()
print('INFO non-manifold faces removed', nm)
lo, hi = NECK_Z
DROP = (hi - lo) * (1 - NECK_SQ)
for v in me.vertices:
    p = v.co
    w = smooth(-0.30, -0.36, p.y)                         # the neck and head only (ahead of the back)
    if w > 0 and p.z > lo:
        z2 = lo + (min(p.z, hi) - lo) * NECK_SQ + max(0.0, p.z - hi)
        p.z = p.z + (z2 - p.z) * w
    if p.y < BILL_Y0:
        p.y = BILL_Y0 + (p.y - BILL_Y0) * BILL_K
me.update()

# ---- to metres: the waterline at z = 0, the flat underside DRAFT below it; origin between the feet ----
co = [v.co for v in me.vertices]
Y_BILL, Y_TAIL = min(c.y for c in co), max(c.y for c in co)
Z_BOT = min(c.z for c in co)
S = LENGTH / (Y_TAIL - Y_BILL)
Z_WL = Z_BOT + DRAFT / S
HIP_RAW = Vector((0.075, 0.22, -0.36))
def M(p): return Vector((p.x * S, (p.y - HIP_RAW.y) * S, (p.z - Z_WL) * S))
def RAW(q): return Vector((q.x / S, q.y / S + HIP_RAW.y, q.z / S + Z_WL))
for v in me.vertices: v.co = M(v.co)
me.update()
V = me.vertices
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
def ray(o_raw, d):
    h = bvh.ray_cast(M(o_raw), Vector(d))[0]
    return h

# landmarks (raw, after the neck edit)
NECK_RAW = Vector((0, -0.54, -0.12))   # the neck's base, between the breast and the back
EYE_RAW = Vector((0, -0.54, 0.335 - DROP))
CROWN_RAW = Vector((0, -0.50, 0.45 - DROP))
TAIL_RAW = Vector((0, 0.55, -0.20))
SH_RAW = Vector((0.15, -0.30, -0.10))
NECK_PIV, TAILP, EYE = M(NECK_RAW), M(TAIL_RAW), M(EYE_RAW)
h = ray(Vector((1.0, EYE_RAW.y, EYE_RAW.z)), (-1, 0, 0)); EYE_X = h.x if h else 0.012
SHOULDER = M(SH_RAW)
h = ray(Vector((1.0, SH_RAW.y, SH_RAW.z)), (-1, 0, 0)); SHOULDER.x = (h.x if h else SHOULDER.x) - 0.006
h = ray(Vector((0, CROWN_RAW.y, 1.0)), (0, 0, -1)); CROWN = h if h else M(CROWN_RAW)
HIP = M(HIP_RAW)
print('INFO scale %.4f m/unit, waterline raw z %.3f, neck lowered %.3f raw' % (S, Z_WL, DROP))

# ---- rig weights ----
def head_w(q):
    r = RAW(q)
    if r.y > -0.36: return 0.0
    return smooth(-0.15, -0.09, r.z)
def tail_w(q):
    r = RAW(q)
    return smooth(TAIL_RAW.y - 0.02, TAIL_RAW.y + 0.10, r.y)
def vert_rig(i):
    p = V[i].co
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK_PIV)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())

# ---- colour by region: (female, male) ----
def face_color(c, n):
    r = RAW(c)
    if r.y < BILL_Y0 + 0.004 and r.z > 0.0: return BILL, BILL
    if head_w(c) > 0.5:
        if r.y < -0.58 and EYE_RAW.z - 0.14 < r.z < EYE_RAW.z - 0.06 and n.z < -0.25: return F_CHIN, M_HEAD   # the white chin, under the bill
        if r.z > -0.06: return F_HEAD, M_HEAD                                                           # head, upper neck
        return (F_BREAST if n.y < -0.1 else F_FLANK), M_BREAST                                           # lower neck
    wl = r.z < Z_WL + 0.03
    if wl or n.z < -0.6: return F_BELLY, M_BREAST
    if r.y < -0.50 and n.y < -0.2: return F_BREAST, M_BREAST                                             # breast
    if r.y > 0.40 and (r.z > -0.25 or n.z > 0.3):                                                        # folded primaries, tail
        if r.y > 0.72: return F_TAIL, M_RUMP
        return F_PRIM, (M_PRIM if n.z > 0.2 or abs(r.x) < 0.1 else M_RUMP)
    if n.z > 0.45 or (abs(r.x) < 0.09 and r.z > -0.12):                                                  # back
        return F_BACK, (M_RUMP if r.y > 0.3 else M_BACK)
    return F_FLANK, M_BREAST
def grz(h, c, amt=0.06): return A.grizzle(h, c, amt, 0.012)

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

def crest(ex, level):
    """The female's shaggy crest: thin blades from the back of the crown hanging back and a little down over the nape;
    each a crossed pair of planes so it reads from the side and from above. The drake's take his head colour."""
    blades = [(0.000, 0.000, 0.060, -18), (0.011, 0.008, 0.055, -28), (-0.011, 0.008, 0.055, -28), (0.006, 0.020, 0.048, -42), (-0.006, 0.020, 0.048, -42)]
    if level == 1: blades = blades[:3]
    if level == 2: blades = blades[1:3]
    rig = (HEAD, 1.0, NECK_PIV); col = (F_HEAD, M_HEAD)
    for sx, back, ln, el in blades:
        base = CROWN + Vector((sx, 0.026 + back, -0.012 - back * 0.8))       # the back of the crown, over the nape
        d = Vector((sx * 2.5, math.cos(math.radians(el)), math.sin(math.radians(el)))).normalized()
        tip = base + d * ln
        w1 = Vector((1, 0, 0)) - d * d.x; w1.normalize(); w2 = d.cross(w1)
        planes = (w1, w2) if level < 2 else (w1 * 0.7 + w2 * 0.7,)
        for wv in planes:
            for out in (wv.cross(d), -wv.cross(d)):
                ex.quad([base + wv * 0.008, tip, base - wv * 0.008], col, rig, out, tri=True)

def legs(ex, level):
    """Short orange legs under the rear of the body: the tarsus from the hip down and back, three webbed toes forward."""
    for s in (1, -1):
        H = Vector((s * HIP.x, HIP.y, HIP.z))
        Ak = Vector((s * (HIP.x + 0.004), HIP.y + 0.018, -DRAFT - 0.040))
        rig = (LEG_A if s > 0 else LEG_B, 1.0, H); col = (LEGC, LEGC)
        ex.tube([H, Ak], [0.0045, 0.0035], col, rig, sides=4 if level == 0 else 3)
        if level == 2:
            ex.slab([Ak, Ak + Vector((s * 0.014, -0.045, -0.003)), Ak + Vector((-s * 0.010, -0.045, -0.003))], col, col, rig, 0.002); continue
        toes = [Ak + Vector((s * 0.022, -0.042, -0.004)), Ak + Vector((s * 0.004, -0.052, -0.004)), Ak + Vector((-s * 0.016, -0.040, -0.004))]
        ex.slab([Ak, toes[0], toes[1], toes[2]], col, col, rig, 0.002)                       # the web

def wings(ex, level):
    """Narrow pointed duck wings, 0.90 m span. Arm (pivot at the shoulder) and hand (pivot at the wrist)."""
    W = SHOULDER; ARM = 0.165; HAND = SPAN / 2 - W.x - ARM
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + ARM), W.y, W.z))
        P = lambda dx, dy: Vector((s * (W.x + dx), W.y + dy, W.z))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        if level == 2:
            ex.slab([P(0, -0.035), P(ARM, -0.04), P(ARM, 0.07), P(0, 0.085)], (CARD_COV[0], CARD_SPEC[1]), CARD_DN, arm_rig, 0.002)
            ex.slab([P(ARM, -0.04), P(ARM + HAND, 0.03), P(ARM, 0.07)], CARD_PRIM, CARD_DN_HAND, hand_rig, 0.002)
            continue
        # arm in chordwise rows: the leading edge (the drake's black), coverts (his white), a dark bar, the white square speculum
        rows = [(-0.035, -0.04, -0.022, -0.027, (CARD_COV[0], M_BACK)), (-0.022, -0.027, 0.012, 0.010, (CARD_COV[0], CARD_INNER_M)), (0.012, 0.010, 0.022, 0.020, CARD_BAR),
                (0.022, 0.020, 0.085, 0.07, CARD_SPEC)]
        if level == 1: rows = [(-0.035, -0.04, 0.016, 0.014, (CARD_COV[0], CARD_INNER_M)), (0.016, 0.014, 0.085, 0.07, CARD_SPEC)]
        for f0, g0, f1, g1, col in rows:
            ex.slab([P(0, f0), P(ARM, g0), P(ARM, g1), P(0, f1)], col, CARD_DN, arm_rig, 0.002)
        if level == 0:
            hand = [P(ARM, -0.04), P(ARM + 0.10, -0.035), P(ARM + 0.19, -0.012), P(ARM + HAND, 0.022), P(ARM + 0.16, 0.040), P(ARM + 0.07, 0.058), P(ARM, 0.07)]
        else:
            hand = [P(ARM, -0.04), P(ARM + 0.15, -0.025), P(ARM + HAND, 0.022), P(ARM + 0.10, 0.052), P(ARM, 0.07)]
        ex.slab(hand, CARD_PRIM, CARD_DN_HAND, hand_rig, 0.002)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (abs(EYE_X) - 0.0008), EYE.y, EYE.z)), Vector((0.0022, 0.003, 0.003)), (EYEC, EYEC), (HEAD, 1.0, NECK_PIV))

# ---- tiers ----
def decimated(target):
    o, n0 = A.tier_copy(ob, None)
    for sym in (True, False):          # the symmetric collapse can stall short of a small target; finish without it
        n = len(o.data.polygons)
        if n <= target * 1.03: break
        d = o.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = min(1.0, target / n)
        d.use_symmetry = sym; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    A.triangulate(o.data)
    return o, n0

def build(level, target):
    global V
    ex = Extra(); crest(ex, level); legs(ex, level); wings(ex, level)
    if level == 0: eyes(ex)
    o, n0 = decimated(target - len(ex.tris))
    m = o.data; V0 = V; V = m.vertices
    pos, col, colb, part, partw, piv, idx = [], [], [], [], [], [], []; key2i = {}
    for p in m.polygons:
        hf, hm = face_color(p.center, p.normal)
        fc, fb = grz(hf, p.center), grz(hm, p.center)
        for vi in p.vertices:
            k = (vi, fc, fb)
            if k not in key2i:
                key2i[k] = len(pos); r = vert_rig(vi)
                pos.append(A.to3(V[vi].co)); col.append(fc); colb.append(fb)
                part.append(float(r['part'])); partw.append(float(r['partw'])); piv.append(A.to3(r['pivot']))
            idx.append(key2i[k])
    V = V0
    nbody = len(idx) // 3
    for a, b, c, h, (pt, w, pv) in ex.tris:
        h = h if isinstance(h, tuple) else (h, h)
        fc, fb = A.srgb2lin(h[0]), A.srgb2lin(h[1])
        for q in (a, b, c):
            idx.append(len(pos)); pos.append(A.to3(q)); col.append(fc); colb.append(fb)
            part.append(float(pt)); partw.append(float(w)); piv.append(A.to3(pv))
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, crest/legs/wings/eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
body = [V[i].co for i in range(len(V))]
print('LANDMARKS bill to tail %.3f m; span %.3f m; underside %.3f m (waterline 0); back top %.3f m; crown %.3f m; feet %.3f m; bill %.3f m; '
      'neck pivot %s; hip %s; shoulder %s; tail root %s; extent x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f' % (
      max(c.y for c in body) - min(c.y for c in body), ext[0][1] - ext[0][0], min(c.z for c in body), max(c.z for c in body if c.y > -0.05),
      CROWN.z, ext[1][0], (M(Vector((0, BILL_Y0, 0))).y - min(c.y for c in body)),
      tuple(round(x, 3) for x in A.to3(NECK_PIV)), tuple(round(x, 3) for x in A.to3(HIP)), tuple(round(x, 3) for x in A.to3(SHOULDER)),
      tuple(round(x, 3) for x in A.to3(TAILP)), *ext[0], *ext[1], *ext[2]))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK_PIV)), 'hip': list(A.to3(HIP)),
       'length_m': LENGTH, 'span_m': SPAN, 'waterline_m': 0.0, 'draft_m': DRAFT, 'feet_y_m': round(ext[1][0], 3),
       'variant': 'breeding male in _COLORB'}

# ---- GLB writer: one buffer, one mesh per tier, COLOR_0 and _COLORB, custom attributes _PART, _PARTW, _PIVOT ----
buf = bytearray(); views = []; accs = []
def add(data_bytes, target=None):
    while len(buf) % 4: buf.append(0)
    off = len(buf); buf.extend(data_bytes)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data_bytes)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def acc_f(vals, n):
    flat = [x for v in vals for x in (tuple(v) if n > 1 else (v,))]
    a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3'}[n]}
    if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
    accs.append(a); return len(accs) - 1
def acc_i(vals):
    big = max(vals) > 65535
    accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
    return len(accs) - 1
meshes = []; nodes = []
for name, t in tiers:
    attrs = {'POSITION': acc_f(t['pos'], 3), 'COLOR_0': acc_f(t['col'], 3), '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1),
             '_PIVOT': acc_f(t['piv'], 3), '_COLORB': acc_f(t['colb'], 3)}
    meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
while len(buf) % 4: buf.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_merganser.py (Blender)',
                  'copyright': f'Common merganser: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (neck and bill shortened, crest, legs and wing cards added, recoloured as female and drake, decimated) by wild-earth tools/build_merganser.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'species': SPECIES, 'rig': RIG,
                   'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
                              'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                              'meshy_metadata': 'none embedded in the source GLB'}}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb), 'bytes;', ', '.join(f'{n} {len(t["idx"]) // 3} tris' for n, t in tiers))

if PREVIEW:
    sc = bpy.context.scene
    ob.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for (name, t), key in [(nt, k) for nt in tiers for k in ('col', 'colb')]:
        name = name + ('' if key == 'col' else 'm')
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t[key]): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, scale in [('side', (0, -0.1, 0.06), (1, 0, 0), 0.75), ('top', (0, -0.1, 0.0), (0.001, 0, 1), 0.95),
                                    ('q', (0, -0.1, 0.06), (0.8, -0.7, 0.45), 0.8), ('head', (0, -0.3, 0.15), (1, -0.4, 0.15), 0.25)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 3
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
