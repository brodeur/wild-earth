# Build client/assets/mallard.glb, the mallard (Anas platyrhynchos) of the Hoh's sloughs, side channels and ponds, as a
# variant of the common merganser's Meshy mesh. No credits.
#
# Source: variant of mergus_merganser built from its Meshy (meshy.ai) text-to-3D preview, task
#   01a1ad3c-fd50-7790-860b-de59283a3ab8, ai_model meshy-6-lite, triangle remesh to 20,000 faces (20,919 triangles,
#   untextured), 2026-11-05 UTC, 5 credits (charged to the merganser); job record in
#   library/animals/jobs/mergus_merganser/01a1ad3c-fd50-7790-860b-de59283a3ab8/job.json. Prompt (for the merganser):
#   "A common merganser (Mergus merganser), adult female, swimming low on the water, side-on pose, wings folded, NOT a
#   mallard, NOT a duck with a broad flat bill. No water modelled: the bird alone with a flat waterline underside.
#   Realistic proportions: 62 cm long, a long low streamlined body, a long thin straight red bill with a small hooked
#   tip, a rusty chestnut head with a shaggy crest hanging back from the nape, a sharp line between the rusty neck and
#   the white chin and breast, a grey back, flanks and tail. No base. Game-ready, clean closed mesh." No new Meshy job.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_mallard.py -- \
#       library/animals/jobs/mergus_merganser/01a1ad3c-fd50-7790-860b-de59283a3ab8/model.glb \
#       client/assets/mallard.glb [--preview <prefix>]
#
# What it does: tools/build_merganser.py's clean-up, waterline, legs, wing cards and rig on the same floating mesh, made a
# dabbling duck: the neck shortened 55% over its middle (the head rides low on the shoulders) and thickened 1.3x across;
# the head rounded (1.12x across, 1.05x deep about its centre); the merganser's thin hooked bill rebuilt as a mallard's
# BROAD FLAT spatulate bill (each slice of it scaled to a set half-width, widening a little to the tip, and flattened to a
# set depth that thins from the base to the nail, the axis drooping a touch; then shortened to 0.62 of its length, ~5 cm
# from its base); no crest; the body 1.12x across (fuller), the long crossed wing tips and tail behind the rump shortened
# 0.7x and cocked up (the tail rides above the water). Scales to 0.58 m bill to tail; the origin at the WATERLINE (y = 0
# in glTF), the flat underside 4 cm below it. Adds a dark eye (lod0), the short orange legs with webbed feet, the drake's
# two small curled black central tail feathers (lod0; on the hen they take her tail colour), and the wing cards (an arm
# and a hand per side, 0.90 m span) that the client collapses into the shoulder at rest.
# Colours by region (sRGB) with a faint per-face grizzle and a hashed mottle. COLOR_0 = the hen: mottled brown and buff
# all over (dark feather centres, buff edges), a dark brown crown and a dark eye line, a paler buff face and throat, the
# blue speculum bordered white showing on the folded wing, darker folded primaries, a buff-edged tail; an orange bill
# blotched dark on the culmen. _COLORB = the breeding drake: glossy green head and upper neck, a narrow white neck
# ring, a chestnut breast, pale grey flanks and back (vermiculated by a fine hash), a black rump and undertail, the tail
# black with a pale edge and the black curls, the blue speculum on the folded wing, a yellow bill. Both: orange legs; the
# cards grey-brown (hen browner) above with a white bar, the blue speculum and a white trailing edge on the arm, darker
# grey-brown primaries, whitish below.
# Tiers: lod0 ~1,200, lod1 ~450, lod2 ~150 triangles including legs, cards, eyes and curls (Blender collapse, X symmetry,
# finished without symmetry if it stalls). Rig: the merganser's bird template (animalModels.js PART): BODY, LEG_A (left)
# / LEG_B (right) pivoting at the hip, TAIL (pivot at the tail root; the curls ride with it), HEAD = neck, head and bill
# pivoting at the neck's base, WING_L/R (arm cards, pivot at the shoulder) and HAND_L/R (hand cards, pivot at the
# wrist). extras.rig = the merganser's keys: kind, wing, tail, head, hip, length_m, span_m, waterline_m, draft_m,
# feet_y_m, variant.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (hen and drake; workbench, vertex colour) to <prefix>_*.png.
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
SPECIES = 'anas_platyrhynchos'
LENGTH = 0.58                          # bill tip to tail tip (m)
SPAN = 0.90                            # wing cards, tip to tip (m)
DRAFT = 0.04                           # the flat underside below the waterline (m)
NECK_Z, NECK_SQ = (-0.10, 0.15), 0.45  # raw z band of the neck shortened to this fraction (the head comes down with it)
BILL_Y0 = -0.655                       # bill base (raw y)
BILL_LEN, BILL_DROOP = 0.052, math.radians(14)   # the new bill: base to nail (m), its axis below the horizontal
NECK_THICK, HEAD_S, HEAD_X, BODY_X = 1.3, 0.86, 1.06, 1.12   # neck across; the head scaled about the top of the neck (rounder: HEAD_X across)
TAIL_Y0, TAIL_K, TAIL_LIFT = 0.60, 0.70, 0.32   # behind raw y TAIL_Y0: shortened by TAIL_K and lifted (raw z per raw y)
TIERS = [('lod0', 1200), ('lod1', 450), ('lod2', 150)]
smooth = A.smooth

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# hen, then drake (sRGB)
H_BROWN, H_DARK, H_BUFF, H_CROWN, H_FACE, H_LINE, H_THROAT, H_BELLY, H_PRIM, H_TAIL = (
    0x8a6844, 0x4e3a28, 0xc4a57a, 0x4a3626, 0xb89a74, 0x3a2a1e, 0xccb28c, 0xb0946e, 0x4c4036, 0x9a8060)
M_HEAD, M_GLOSS, M_RING, M_BREAST, M_FLANK, M_BACK, M_BLACK, M_BELLY, M_PRIM, M_TAILW = (
    0x1b5034, 0x2a7448, 0xf2f2ee, 0x6a3222, 0xbdbcb6, 0x9a968c, 0x121212, 0xcfcfca, 0x5a554e, 0xd8d8d2)
H_BILL, H_BILLD, M_BILL, LEGC, EYEC = 0xd4883a, 0x4a3a2c, 0xc9c04a, 0xe8822a, 0x1a0e0a
SPEC, SPEC_W = 0x3446a8, 0xf2f2ee     # the speculum (iridescent blue-violet) and its white borders
# cards: (hen, drake) above / below
CARD_COV, CARD_PRIM = (0x7a644c, 0x8a8378), (0x5e5246, 0x6a645c)
CARD_DN, CARD_DN_HAND = (0xdcdad4, 0xe4e2dc), (0xb0aca4, 0xb8b4ac)

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
me.update()
# the merganser's thin hooked bill is cut off at its base (the hole closed) and the mallard's broad flat bill is built in
# its place (bill() below, a HEAD extra): the base at the bill's axis height there
V = me.vertices
bill = [v for v in V if v.co.y < BILL_Y0 and v.co.z > -0.05]
_ax = [v.co for v in bill if BILL_Y0 - 0.12 < v.co.y < BILL_Y0 - 0.06]
BILL_BASE_RAW = Vector((0, BILL_Y0, (max(c.z for c in _ax) + min(c.z for c in _ax)) / 2))
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[v.index] for v in bill], context='VERTS')
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
cap = [v for v in bm.verts if v.co.y < BILL_Y0 + 0.03 and v.co.z > -0.05]
for _ in range(3): bmesh.ops.smooth_vert(bm, verts=cap, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
print('INFO bill cut: vertices', len(bill), 'base (raw)', [round(x, 3) for x in BILL_BASE_RAW])
# a thicker neck, a rounder head, a fuller body, the tail shortened and cocked up
HEAD_J = Vector((0, -0.50, 0.20 - DROP))     # the top of the neck: the head is scaled toward it
def head_wt(p): return smooth(-0.30, -0.36, p.y) * smooth(0.10 - DROP, 0.22 - DROP, p.z)
def headmap(p):
    w = head_wt(p); q = HEAD_J + (p - HEAD_J) * HEAD_S; q.x *= HEAD_X
    return p.lerp(q, w)
for v in V:
    p = v.co
    hw = smooth(-0.30, -0.36, p.y)
    nk = hw * smooth(-0.22, -0.10, p.z) * smooth(0.40 - DROP, 0.16 - DROP, p.z)   # the neck band
    hp = headmap(p.copy())
    p.x = hp.x * (1 + (BODY_X - 1) * (1 - hw) + (NECK_THICK - 1) * nk); p.y = hp.y; p.z = hp.z
    if p.y > TAIL_Y0:
        d = p.y - TAIL_Y0
        p.y = TAIL_Y0 + d * TAIL_K; p.z += d * TAIL_K * TAIL_LIFT
me.update()

# ---- to metres: the waterline at z = 0, the flat underside DRAFT below it; origin between the feet ----
co = [v.co for v in me.vertices]
Y_BILL, Y_TAIL = min(c.y for c in co), max(c.y for c in co)
Z_BOT = min(c.z for c in co)
S = (LENGTH - BILL_LEN * math.cos(BILL_DROOP)) / (Y_TAIL - headmap(BILL_BASE_RAW).y)    # the bill (built below) reaches LENGTH
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
EYE_RAW = headmap(Vector((0, -0.54, 0.335 - DROP)))
CROWN_RAW = headmap(Vector((0, -0.52, 0.45 - DROP)))
TAIL_RAW = Vector((0, 0.55, -0.20))
SH_RAW = Vector((0.15, -0.30, -0.10))
CURL_RAW = Vector((0, TAIL_Y0 + 0.14 * TAIL_K, -0.12))   # the top of the tail, a little ahead of its tip
NECK_PIV, TAILP, EYE = M(NECK_RAW), M(TAIL_RAW), M(EYE_RAW)
h = ray(Vector((1.0, EYE_RAW.y, EYE_RAW.z)), (-1, 0, 0)); EYE_X = h.x if h else 0.012
SHOULDER = M(SH_RAW)
h = ray(Vector((1.0, SH_RAW.y, SH_RAW.z)), (-1, 0, 0)); SHOULDER.x = (h.x if h else SHOULDER.x) - 0.006
h = ray(Vector((0, CROWN_RAW.y, 1.0)), (0, 0, -1)); CROWN = h if h else M(CROWN_RAW)
HIP = M(HIP_RAW)
BILL_BASE = M(headmap(BILL_BASE_RAW)) + Vector((0, 0.004, 0))   # a little inside the face
h = ray(Vector((0, CURL_RAW.y, 1.0)), (0, 0, -1)); CURL_BASE = (h - Vector((0, 0, 0.003))) if h else M(CURL_RAW)
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

# ---- colour by region: (hen, drake) ----
RING_Z = -0.035                        # raw z of the drake's white neck ring (after the neck edit)
def mottle(c, base=H_BROWN, dark=0.30, buff=0.30, cell=0.010):
    h = A.hash01(abs(c.x) // cell, c.y // cell, c.z // cell)
    if h < dark: return A.mix(base, H_DARK, 0.7)
    if h < dark + buff: return A.mix(base, H_BUFF, 0.7)
    return base
def verm(c, base):                     # the drake's fine grey vermiculation
    return A.mix(base, 0x6e6c66, 0.35) if A.hash01(abs(c.x) // 0.006, c.y // 0.006, c.z // 0.006) < 0.3 else base
def face_color(c, n):
    r = RAW(c)
    if head_w(c) > 0.5:
        if r.z > RING_Z + 0.02:                                                               # head and upper neck
            g = M_GLOSS if A.hash01(abs(r.x) // 0.03, r.y // 0.03, r.z // 0.03) < 0.3 else M_HEAD
            dz = r.z - EYE_RAW.z
            if abs(n.x) > 0.35 and -0.008 < dz < 0.010 and EYE_RAW.y - 0.05 < r.y < EYE_RAW.y + 0.10: return H_LINE, g        # the hen's eye line
            if n.z > 0.45 or (dz > 0.06 and abs(r.x) < 0.05): return H_CROWN, g                  # crown
            if n.z < -0.3 or dz < -0.07: return H_THROAT, g                                      # throat
            return H_FACE, g
        if r.z > RING_Z - 0.02: return mottle(c, H_FACE, 0.2, 0.3), M_RING                    # the drake's neck ring
        return mottle(c, H_BROWN), M_BREAST
    wl = r.z < Z_WL + 0.03
    if wl or n.z < -0.6: return mottle(c, H_BELLY, 0.2, 0.35), M_BELLY
    if r.y < -0.45 and n.y < -0.2: return mottle(c), M_BREAST                                  # breast
    if r.y > 0.40 and (r.z > -0.25 or n.z > 0.3):                                              # rump, folded primaries, tail
        if r.y > 0.62:
            edge = r.y > 0.74
            return (H_BUFF if edge else mottle(c, H_TAIL, 0.25, 0.3)), (M_TAILW if edge and n.z < 0.6 else M_BLACK)
        prim = n.z > 0.2 or abs(r.x) < 0.1
        return (H_PRIM if prim else mottle(c)), (M_PRIM if prim and r.z > -0.16 else M_BLACK)
    # the speculum on the folded wing: blue bordered white, low on the side of the folded wing
    if 0.12 < r.y < 0.38 and abs(n.x) > 0.5 and -0.20 < r.z < -0.12:
        sp = SPEC_W if (r.y < 0.15 or r.y > 0.35) else SPEC
        return sp, sp
    if n.z > 0.45 or (abs(r.x) < 0.09 and r.z > -0.12):                                        # back
        return mottle(c, H_BROWN, 0.4, 0.25), verm(c, M_BACK)
    return mottle(c), verm(c, M_FLANK)
def grz(h, c, amt=0.05): return A.grizzle(h, c, amt, 0.012)

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

def curls(ex):
    """The drake's two small curled black central tail feathers (lod0): thin tubes rising from the top of the tail near
    its tip and curling up and forward over it; on the hen they take her tail colour (a small tuft)."""
    rig = (TAIL, 1.0, TAILP); col = (H_TAIL, M_BLACK)
    R0 = 0.011
    for sx in (0.003, -0.003):
        b = CURL_BASE + Vector((sx, 0, 0)); pts = []
        for k in range(6):
            a = math.radians(-90 + 54 * k)                     # a loop: up, then forward over the top
            pts.append(b + Vector((sx * 0.3 * k / 5, R0 * math.cos(a) - R0 * math.cos(math.radians(-90)) + 0.0, R0 * (math.sin(a) + 1))))
        ex.tube(pts, [0.0022, 0.002, 0.0018, 0.0015, 0.0011, 0.0], col, rig, sides=3)

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
    """Mallard wings, 0.90 m span: arm (pivot at the shoulder) and hand (pivot at the wrist). The arm in chordwise rows:
    coverts, a white bar, the blue speculum, a white trailing edge."""
    W = SHOULDER; ARM = 0.165; HAND = SPAN / 2 - W.x - ARM
    sw = (SPEC_W, SPEC_W); sp = (SPEC, SPEC)
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + ARM), W.y, W.z))
        P = lambda dx, dy: Vector((s * (W.x + dx), W.y + dy, W.z))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        if level == 2:
            ex.slab([P(0, -0.035), P(ARM, -0.04), P(ARM, 0.025), P(0, 0.03)], CARD_COV, CARD_DN, arm_rig, 0.002)
            ex.slab([P(0, 0.03), P(ARM, 0.025), P(ARM, 0.07), P(0, 0.085)], sp, CARD_DN, arm_rig, 0.002)
            ex.slab([P(ARM, -0.04), P(ARM + HAND, 0.03), P(ARM, 0.07)], CARD_PRIM, CARD_DN_HAND, hand_rig, 0.002)
            continue
        rows = [(-0.035, -0.04, 0.012, 0.010, CARD_COV), (0.012, 0.010, 0.022, 0.020, sw), (0.022, 0.020, 0.072, 0.060, sp), (0.072, 0.060, 0.085, 0.07, sw)]
        if level == 1: rows = [(-0.035, -0.04, 0.018, 0.016, CARD_COV), (0.018, 0.016, 0.074, 0.062, sp), (0.074, 0.062, 0.085, 0.07, sw)]
        for f0, g0, f1, g1, col in rows:
            ex.slab([P(0, f0), P(ARM, g0), P(ARM, g1), P(0, f1)], col, CARD_DN, arm_rig, 0.002)
        if level == 0:
            hand = [P(ARM, -0.04), P(ARM + 0.10, -0.035), P(ARM + 0.19, -0.012), P(ARM + HAND, 0.022), P(ARM + 0.16, 0.040), P(ARM + 0.07, 0.058), P(ARM, 0.07)]
        else:
            hand = [P(ARM, -0.04), P(ARM + 0.15, -0.025), P(ARM + HAND, 0.022), P(ARM + 0.10, 0.052), P(ARM, 0.07)]
        ex.slab(hand, CARD_PRIM, CARD_DN_HAND, hand_rig, 0.002)

def bill(ex, level):
    """The mallard's broad flat spatulate bill: a tube of five-sided sections (the culmen ridge, the upper edges, the
    flat lower mandible) from inside the face to the rounded nail, its axis drooping BILL_DROOP; parallel-sided and a
    little wider toward the tip, deep at the base and thin at the tip. Hen: orange, blotched dark on the culmen; drake:
    yellow."""
    d = Vector((0, -math.cos(BILL_DROOP), -math.sin(BILL_DROOP))); up = Vector((0, -math.sin(BILL_DROOP), math.cos(BILL_DROOP)))
    rig = (HEAD, 1.0, NECK_PIV)
    us = {0: [0.0, 0.25, 0.55, 0.8, 0.93, 1.0], 1: [0.0, 0.45, 0.85, 1.0], 2: [0.0, 0.8, 1.0]}[level]
    L = BILL_LEN + 0.004
    def sect(u):
        w = 0.0115 + 0.0015 * u                          # half-width: broad, a little wider to the tip
        if u > 0.82: w *= math.sqrt(max(0.08, 1 - ((u - 0.82) / 0.18) ** 2))
        top = 0.0105 * (1 - u) + 0.0024 * u              # above the axis: deep at the base, thin at the nail
        bot = 0.0075 * (1 - u) + 0.0018 * u
        c = BILL_BASE + d * (L * u)
        return [c + up * top, c + Vector((w, 0, 0)) + up * (top * 0.45), c + Vector((w * 0.92, 0, 0)) - up * bot,
                c - Vector((w * 0.92, 0, 0)) - up * bot, c - Vector((w, 0, 0)) + up * (top * 0.45)]
    S_ = [sect(u) for u in us]
    for i in range(len(us) - 1):
        a, b = S_[i], S_[i + 1]; m = BILL_BASE + d * (L * (us[i] + us[i + 1]) / 2)
        for k in range(5):
            k2 = (k + 1) % 5
            top_face = k in (0, 4)                       # the two faces either side of the culmen
            dark = top_face and 0.2 < us[i] < 0.8 and (level > 0 or A.hash01(i, k) < 0.8)
            col = ((H_BILLD if dark else H_BILL), M_BILL)
            ex.quad([a[k], a[k2], b[k2], b[k]], col, rig, (a[k] + a[k2] + b[k] + b[k2]) / 4 - m)
    tip = BILL_BASE + d * (L * 1.0)
    last = S_[-1]
    for k in range(5):
        ex.quad([last[k], last[(k + 1) % 5], tip + d * 0.0015], (H_BILL, M_BILL), rig, d, tri=True)

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
    ex = Extra(); legs(ex, level); wings(ex, level); bill(ex, level)
    if level == 0: eyes(ex); curls(ex)
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
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, legs/wings/eyes/curls {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
body = [V[i].co for i in range(len(V))]
print('LANDMARKS body (bill base) to tail %.3f m; span %.3f m; underside %.3f m (waterline 0); back top %.3f m; crown %.3f m; feet %.3f m; bill %.3f m; '
      'neck pivot %s; hip %s; shoulder %s; tail root %s; extent x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f' % (
      max(c.y for c in body) - min(c.y for c in body), ext[0][1] - ext[0][0], min(c.z for c in body), max(c.z for c in body if c.y > -0.05),
      CROWN.z, ext[1][0], BILL_LEN,
      tuple(round(x, 3) for x in A.to3(NECK_PIV)), tuple(round(x, 3) for x in A.to3(HIP)), tuple(round(x, 3) for x in A.to3(SHOULDER)),
      tuple(round(x, 3) for x in A.to3(TAILP)), *ext[0], *ext[1], *ext[2]))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK_PIV)), 'hip': list(A.to3(HIP)),
       'length_m': LENGTH, 'span_m': SPAN, 'waterline_m': 0.0, 'draft_m': DRAFT, 'feet_y_m': round(ext[1][0], 3),
       'variant': 'breeding drake in _COLORB (the hen in COLOR_0)'}

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
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_mallard.py (Blender)',
                  'copyright': f'Mallard: a variant of the common merganser generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (neck shortened and thickened, head rounded, a broad flat bill, body fuller, tail cocked; legs, wing cards and curls added, recoloured as hen and drake, decimated) by wild-earth tools/build_mallard.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'species': SPECIES, 'rig': RIG,
                   'source': {'kind': 'variant', 'variant_of': 'mergus_merganser', 'credits': 0, 'credit': 'generated with Meshy (meshy.ai)', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
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
