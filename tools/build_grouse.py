# Build client/assets/sooty_grouse.glb, the sooty grouse (Dendragapus fuliginosus) of the Olympic conifer forest and
# subalpine edges, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1ae8b-eb2c-73d6-867c-037ab6578488, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (untextured), 2026-11-06 01:49 UTC (the 2026-11-05 batch, US evening), 5 credits;
#   job record in library/animals/jobs/dendragapus_fuliginosus/01a1ae8b-eb2c-73d6-867c-037ab6578488/job.json. Prompt:
#   "A sooty grouse (Dendragapus fuliginosus), a large forest grouse like a chicken, NOT a turkey, NOT a quail, no crest.
#   One adult male standing on the ground, side-on pose, body level, wings folded. Realistic proportions: 50 cm long, a
#   plump round body, a short neck, a small head with a short stout bill, a long squared dark tail with a pale grey band
#   at its tip, feathered legs. Dusky slate-grey plumage finely mottled, a yellow-orange comb above the eye, a
#   white-edged patch on the neck side. No base. Game-ready, clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_grouse.py -- \
#       library/animals/jobs/dendragapus_fuliginosus/01a1ae8b-eb2c-73d6-867c-037ab6578488/model.glb \
#       client/assets/sooty_grouse.glb
#
# What it does: the preview came back pigeon-like (a slim head held high on a long neck, a long thin decurved bill, bare
# thin legs, a pointed blade tail), so it is made a grouse: the neck shortened over its middle (the head comes down
# 5 cm onto the shoulders) and thickened 1.3x across; the bill made short and stout (0.5x as long, 1.7x as wide and
# 1.35x as deep at the base); the whole bird 0.74x across and 0.8x as deep (the preview's body is a pigeon's ball,
# 25 cm across); the thin legs cut off at the belly and short FEATHERED legs added (a thick tapering
# tarsus in the body's colour, grey toes); the blade tail cut off behind the rump and a long SQUARED tail fan added
# (TAIL), 0.17 m, a little fanned (0.13 m across the tip), held out behind and a little down. Scales to 0.50 m bill to tail tip, feet at z = 0, the origin between the feet. Adds a dark eye (lod0) and
# short rounded wing cards (an arm and a hand per side, 0.75 m span) that the client collapses into the shoulder at
# rest. Colours by region (sRGB) with a faint per-face grizzle and a hashed mottle. COLOR_0 = the male: dusky slate-grey,
# finely mottled darker and paler, browner grey on the back and folded wings, white tips on the flank feathers (hashed
# faces low on the sides), a yellow-orange comb over the eye, a white-edged neck patch (a yellowish centre in a white
# rosette) on each side of the neck, a dark bill, the tail blackish with a pale grey terminal band. _COLORB = the
# female: mottled brown barred buff and black all over, a paler buff-grey belly, no comb or neck patch, the tail brown
# barred dark with the grey band. Cards: slate-grey (female brown, barred) above, grey-brown primaries, pale grey below.
# Tiers: lod0 ~1,200, lod1 ~450, lod2 ~150 triangles including legs, tail fan, cards and eyes (Blender collapse, X
# symmetry, finished without symmetry if it stalls). Rig: the bird template as tools/build_turkey.py builds it
# (animalModels.js PART): BODY, LEG_A (left) / LEG_B (right) pivoting at the hip, TAIL (the fan and the rump behind its
# root; pivot at the tail root), HEAD = neck, head and bill pivoting at the neck's base, WING_L/R (arm cards, pivot at
# the shoulder) and HAND_L/R (hand cards, pivot at the wrist). extras.rig = the turkey's keys: kind, wing, tail, head,
# hip, length_m, height_m, variant.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
import bpy, bmesh, sys, os, json, struct, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
JOB = '01a1ae8b-eb2c-73d6-867c-037ab6578488'
SPECIES = 'dendragapus_fuliginosus'
LENGTH = 0.50                          # bill tip to tail tip (m)
SPAN = 0.75                            # wing cards, tip to tip (m)
LEGH = 0.055                           # belly feathers to the ground (m)
FAN_LEN, FAN_W0, FAN_W1, FAN_DROOP = 0.17, 0.075, 0.13, math.radians(12)   # tail: length, width at the root and tip, droop
NECK_Z, NECK_SQ, NECK_Y = (0.30, 0.62), 0.4, (-0.33, -0.48)   # raw z band of the neck squeezed to this fraction, ahead of raw y
B0, BILL_K = -0.775, 0.5               # bill base (raw y) and its length factor
LEG_CUT, TAIL_CUT = -0.47, 0.49        # raw: legs below this z, the blade tail behind this y
TIERS = [('lod0', 1200), ('lod1', 450), ('lod2', 150)]
smooth = A.smooth

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# male, female (sRGB)
M_SLATE, M_DARK, M_PALE, M_BACK, M_BELLY, M_TIP, M_COMB, M_PATCH, M_RING = 0x585d64, 0x383b40, 0x787d84, 0x5a5650, 0x6c7178, 0xe2e0da, 0xe6a02c, 0xc8a868, 0xeeece6
F_BROWN, F_BUFF, F_BLACK, F_BELLY, F_FACE = 0x7a6046, 0xc2a676, 0x2a2018, 0xa89a84, 0x9a8466
BILLC, EYEC, TOES = 0x262422, 0x1a1410, 0x6e6a64
T_M, T_F, T_BAND = 0x1e1e21, 0x5a4634, 0x9c9ea0
CARD_UP, CARD_PRIM, CARD_DN = (0x5a5a58, 0x7a6248), (0x6a6258, 0x6a5a48), (0xb8b8b4, 0xc0b8a8)

# ---- load, clean (raw frame: x the bird's left, -y forward, +z up; 1.9 units bill to tail, feet at -0.8) ----
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
# the thin bare legs and the blade tail off
dele = [v for v in bm.verts if (v.co.z < LEG_CUT and -0.42 < v.co.y < 0.32) or v.co.y > TAIL_CUT]
bmesh.ops.delete(bm, geom=dele, context='VERTS')
bm.verts.ensure_lookup_table()
seen = set(); comps = []
for v in bm.verts:
    if v in seen: continue
    comp = []; st = [v]; seen.add(v)
    while st:
        x = st.pop(); comp.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y not in seen: seen.add(y); st.append(y)
    comps.append(comp)
big = max(len(c) for c in comps)
for c in comps:
    if len(c) < 0.05 * big: bmesh.ops.delete(bm, geom=c, context='VERTS')
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
patch = [v for v in bm.verts if (v.co.z < LEG_CUT + 0.04 and -0.42 < v.co.y < 0.32) or v.co.y > TAIL_CUT - 0.04]
for _ in range(4): bmesh.ops.smooth_vert(bm, verts=patch, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(me); bm.free(); me.update()
print('INFO non-manifold faces removed', nm, 'legs and tail vertices removed', len(dele))

# ---- the neck shortened and thickened, the bill short and stout, the body plump ----
lo, hi = NECK_Z
DROP = (hi - lo) * (1 - NECK_SQ)
V = me.vertices
bill = [v for v in V if v.co.y < B0 and v.co.z > 0.45]
Y_TIP0 = min(v.co.y for v in bill)
ZB_BILL = sum(v.co.z for v in bill) / len(bill)
for v in V:
    p = v.co
    w = smooth(NECK_Y[0], NECK_Y[1], p.y)                 # the neck and head only (ahead of the back)
    if p.y < B0 and p.z > 0.45:                           # bill: short and stout
        t = (B0 - p.y) / (B0 - Y_TIP0)
        p.x *= 1.7 - 0.6 * t
        p.z = ZB_BILL + (p.z - ZB_BILL) * (1.35 - 0.25 * t) - 0.02 * t
        p.y = B0 + (p.y - B0) * BILL_K
    nk = w * smooth(0.0, 0.25, p.z) * (1 - smooth(0.55, 0.72, p.z))
    if w > 0 and p.z > lo:
        z2 = lo + (min(p.z, hi) - lo) * NECK_SQ + max(0.0, p.z - hi)
        p.z = p.z + (z2 - p.z) * w
    p.x *= 1 + 0.30 * nk + 0.08 * (1 - w)
me.update()

# ---- to metres: belly LEGH above the ground, origin between the feet (Blender axes, forward -y) ----
co = [v.co for v in V]
Y_FRONT = min(c.y for c in co)
Z_BELLY = min(c.z for c in co if -0.3 < c.y < 0.2)
Y_HIP = -0.05
ROOT_RAW = Vector((0, TAIL_CUT - 0.03, -0.13))
S = (LENGTH - (FAN_LEN - 0.02) * math.cos(FAN_DROOP)) / (ROOT_RAW.y - Y_FRONT)
KX, KZ = 0.74, 0.80                    # the pigeon-shaped preview is too fat and too deep for a grouse: narrower, shallower
def M(p): return Vector((p.x * S * KX, (p.y - Y_HIP) * S, (p.z - Z_BELLY) * S * KZ + LEGH))
def RAW(q): return Vector((q.x / (S * KX), q.y / S + Y_HIP, (q.z - LEGH) / (S * KZ) + Z_BELLY))
for v in V: v.co = M(v.co)
me.update(); bpy.context.view_layer.update()
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
def ray(o, d):
    return bvh.ray_cast(o, Vector(d))[0]
print('INFO scale %.4f m/unit, belly raw z %.3f, neck lowered %.3f raw' % (S, Z_BELLY, DROP))

# ---- landmarks (raw, after the edits) ----
EYE_RAW = Vector((0, -0.69, 0.665 - DROP))
NECK_RAW = Vector((0, -0.42, 0.18))
SH_RAW = Vector((0, -0.26, 0.20))
EYE = M(EYE_RAW)
h = ray(Vector((0.3, EYE.y, EYE.z)), (-1, 0, 0)); EYE_X = h.x if h else 0.015
NECK_PIV = M(NECK_RAW)
SHOULDER = M(SH_RAW)
h = ray(Vector((0.3, SHOULDER.y, SHOULDER.z)), (-1, 0, 0)); SHOULDER.x = (h.x if h else 0.06) - 0.008
TAILP = M(ROOT_RAW)
h = ray(Vector((0.3, M(Vector((0, -0.05, 0))).y, LEGH + 0.025)), (-1, 0, 0))
HIP = Vector(((h.x if h else 0.05) * 0.6, 0.0, LEGH + 0.025))
CROWN = ray(Vector((0, M(Vector((0, -0.64, 0))).y, 1.0)), (0, 0, -1)) or M(Vector((0, -0.64, 0.79 - DROP)))
NP_RAW = Vector((0, -0.55, 0.40 - DROP * 0.5))          # the neck patch's centre (raw), on the side of the neck
print('INFO eye', [round(x, 4) for x in EYE], 'x', round(EYE_X, 4), 'shoulder', [round(x, 4) for x in SHOULDER], 'hip', [round(x, 4) for x in HIP])

# ---- rig weights ----
def head_w(q):
    r = RAW(q)
    if r.y > NECK_Y[0] - 0.03: return 0.0
    return smooth(0.08, 0.20, r.z + (NECK_RAW.y - r.y) * 0.5) * smooth(NECK_Y[0] - 0.03, NECK_Y[0] - 0.10, r.y)
def tail_w(q):
    return smooth(ROOT_RAW.y - 0.08, ROOT_RAW.y, RAW(q).y)
def vert_rig(i):
    p = V[i].co
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK_PIV)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())

# ---- colour by region: (male, female) ----
def hsh(c, cell): return A.hash01(abs(c.x) // cell, c.y // cell, c.z // cell)
def mmottle(c, base=M_SLATE):
    h = hsh(c, 0.008)
    if h < 0.28: return A.mix(base, M_DARK, 0.6)
    if h < 0.50: return A.mix(base, M_PALE, 0.6)
    return base
def fbar(c, base=F_BROWN):
    """The female's mottled brown, barred buff and black: bars across the body by position, broken by a hash."""
    r = RAW(c); b = (r.y * 9.0 + r.z * 2.5) % 1.0; h = hsh(c, 0.008)
    if b < 0.22 and h < 0.8: return F_BLACK if h < 0.45 else A.mix(F_BLACK, base, 0.4)
    if b < 0.45 and h < 0.75: return F_BUFF
    return A.mix(base, F_BUFF, 0.35) if h > 0.85 else base
def face_color(c, n):
    r = RAW(c)
    if r.y < B0 + 0.01 and r.z > 0.45 - DROP: return BILLC, BILLC
    hw = head_w(c)
    if hw > 0.5:
        e = r - EYE_RAW
        if abs(n.x) > 0.3 and -0.05 < e.y < 0.06 and 0.018 < e.z < 0.06: return M_COMB, fbar(c, F_FACE)     # the comb over the eye
        np = Vector((abs(r.x) * 0, r.y - NP_RAW.y, r.z - NP_RAW.z)).length
        if abs(n.x) > 0.45 and np < 0.065:                                                               # the neck patch
            return (M_PATCH if np < 0.04 else M_RING), fbar(c, F_BROWN)
        if n.z < -0.3: return mmottle(c, A.mix(M_SLATE, M_PALE, 0.3)), fbar(c, F_FACE)                  # throat
        return mmottle(c), fbar(c, F_FACE if r.y < EYE_RAW.y + 0.06 else F_BROWN)
    if r.y > ROOT_RAW.y - 0.10:                                                                          # rump and undertail
        return mmottle(c, M_DARK), fbar(c)
    if n.z < -0.55: return mmottle(c, M_BELLY), fbar(c, F_BELLY)                                         # belly
    wing = n.z > 0.35 or (r.z > 0.05 and r.y > -0.25)
    if wing: return mmottle(c, M_BACK), fbar(c)                                                           # back, folded wings
    if -0.32 < r.z < 0.0 and -0.30 < r.y < 0.35 and abs(n.x) > 0.55 and hsh(c, 0.012) < 0.14: return M_TIP, A.mix(F_BUFF, 0xe8e0d0, 0.5)   # white-tipped flanks
    return mmottle(c), fbar(c)
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

def legs(ex, level):
    """Short feathered legs: a thick tapering tarsus in the body's colour from inside the belly to the foot, three grey toes
    forward and a short hind toe."""
    sides = [5, 4, 3][level]
    for s in (1, -1):
        H = Vector((s * HIP.x, HIP.y, HIP.z))
        Ak = Vector((s * (HIP.x + 0.004), HIP.y - 0.004, 0.008))
        rig = (LEG_A if s > 0 else LEG_B, 1.0, H)
        ex.tube([H, H.lerp(Ak, 0.55), Ak], [0.014, 0.0115, 0.008], (M_SLATE, F_BROWN), rig, sides=sides)
        toes = [(-0.45, 0.040), (0.0, 0.046), (0.45, 0.040), (math.pi, 0.016)]
        if level == 2: toes = toes[:3]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.8, -math.cos(ang), 0))
            tip = Ak + d * ln + Vector((0, 0, -0.0065))
            if level == 0:
                ex.tube([Ak, Ak.lerp(tip, 0.55) + Vector((0, 0, 0.001)), tip], [0.0032, 0.0024, 0.0], (TOES, TOES), rig, sides=3)
            else:
                ex.tube([Ak, tip], [0.003, 0.0], (TOES, TOES), rig, sides=3)

def fan(ex, level):
    """The long squared tail, a little fanned: a solid wedge from the root under the rump (2.2 cm deep there, 0.6 cm at
    the tip), drooping FAN_DROOP; the pale grey terminal band across its last fifth (both sexes), the female's barred."""
    R0 = TAILP; d = Vector((0, math.cos(FAN_DROOP), -math.sin(FAN_DROOP))); up = Vector((0, math.sin(FAN_DROOP), math.cos(FAN_DROOP)))
    rig = (TAIL, 1.0, TAILP)
    def th(v): return 0.022 * (1 - v) + 0.006 * v
    def P(u, v, top): return R0 + d * (v * FAN_LEN - 0.02) + Vector((u, 0, 0)) + up * ((th(v) * 0.5) if top else -(th(v) * 0.5))
    def wd(v): return (FAN_W0 + (FAN_W1 - FAN_W0) * v) / 2
    rows = [0.0, 0.3, 0.55, 0.8, 0.83, 1.0] if level == 0 else ([0.0, 0.45, 0.8, 1.0] if level == 1 else [0.0, 0.8, 1.0])
    for i in range(len(rows) - 1):
        v0, v1 = rows[i], rows[i + 1]
        if v0 >= 0.8: ct = (T_BAND, T_BAND)
        else: ct = (T_M, T_F if i % 2 == 0 else A.mix(T_F, F_BLACK, 0.45))
        cb = (A.mix(ct[0], 0x000000, 0.15), A.mix(ct[1], 0x000000, 0.15))
        for top, col, out in ((True, ct, up), (False, cb, -up)):
            ex.quad([P(-wd(v0), v0, top), P(wd(v0), v0, top), P(wd(v1), v1, top), P(-wd(v1), v1, top)], col, rig, out)
        for sx in (1, -1):    # the sides
            ex.quad([P(sx * wd(v0), v0, True), P(sx * wd(v1), v1, True), P(sx * wd(v1), v1, False), P(sx * wd(v0), v0, False)], cb, rig, Vector((sx, 0, 0)))
    ex.quad([P(-wd(1), 1, True), P(wd(1), 1, True), P(wd(1), 1, False), P(-wd(1), 1, False)], (T_BAND, T_BAND), rig, d)

def wings(ex, level):
    """Short rounded grouse wings, 0.75 m span: arm (pivot at the shoulder) and a broad rounded hand (pivot at the wrist)."""
    W = SHOULDER; ARM = 0.11; HAND = SPAN / 2 - W.x - ARM
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + ARM), W.y, W.z))
        P = lambda dx, dy: Vector((s * (W.x + dx), W.y + dy, W.z))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        ex.slab([P(0, -0.03), P(ARM, -0.035), P(ARM, 0.085), P(0, 0.09)], CARD_UP, CARD_DN, arm_rig, 0.002)
        if level == 2:
            ex.slab([P(ARM, -0.035), P(ARM + HAND, 0.01), P(ARM + HAND * 0.8, 0.07), P(ARM, 0.085)], CARD_PRIM, CARD_DN, hand_rig, 0.002)
            continue
        if level == 0:
            hand = [P(ARM, -0.035), P(ARM + 0.07, -0.03), P(ARM + HAND * 0.85, -0.012), P(ARM + HAND, 0.02), P(ARM + HAND * 0.95, 0.05),
                    P(ARM + HAND * 0.72, 0.075), P(ARM + 0.04, 0.085), P(ARM, 0.085)]
        else:
            hand = [P(ARM, -0.035), P(ARM + HAND * 0.8, -0.015), P(ARM + HAND, 0.03), P(ARM + HAND * 0.7, 0.075), P(ARM, 0.085)]
        ex.slab(hand, CARD_PRIM, CARD_DN, hand_rig, 0.002)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (abs(EYE_X) - 0.0008), EYE.y, EYE.z)), Vector((0.0025, 0.0035, 0.0035)), (EYEC, EYEC), (HEAD, 1.0, NECK_PIV))

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
    ex = Extra(); legs(ex, level); wings(ex, level); fan(ex, level)
    if level == 0: eyes(ex)
    o, n0 = decimated(target - len(ex.tris))
    m = o.data; V0 = V; V = m.vertices
    pos, col, colb, part, partw, piv, idx = [], [], [], [], [], [], []; key2i = {}
    for p in m.polygons:
        hm, hf = face_color(p.center, p.normal)
        fc, fb = grz(hm, p.center), grz(hf, p.center)
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
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, legs/tail/wings/eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
body = [V[i].co for i in range(len(V))]
HEIGHT = max(c.z for c in body)
print('LANDMARKS bill to tail tip %.3f m; span %.3f m; crown %.3f m; back %.3f m; belly %.3f m; body width %.3f m; bill %.3f m; tail %.3f m; '
      'neck pivot %s; hip %s; shoulder %s; tail root %s; extent x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f' % (
      ext[2][1] - ext[2][0], ext[0][1] - ext[0][0], HEIGHT, max(c.z for c in body if c.y > -0.02), LEGH,
      2 * max(abs(c.x) for c in body), (B0 - Y_TIP0) * BILL_K * S, FAN_LEN,
      tuple(round(x, 3) for x in A.to3(NECK_PIV)), tuple(round(x, 3) for x in A.to3(HIP)), tuple(round(x, 3) for x in A.to3(SHOULDER)),
      tuple(round(x, 3) for x in A.to3(TAILP)), *ext[0], *ext[1], *ext[2]))
RIG = {'kind': 'bird', 'wing': [round(x, 4) for x in A.to3(SHOULDER)], 'tail': [round(x, 4) for x in A.to3(TAILP)],
       'head': [round(x, 4) for x in A.to3(NECK_PIV)], 'hip': [round(x, 4) for x in A.to3(HIP)],
       'length_m': LENGTH, 'height_m': round(HEIGHT, 3), 'variant': 'female in _COLORB'}
print('RIG', RIG)

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
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_grouse.py (Blender)',
                  'copyright': f'Sooty grouse: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (neck shortened, bill shortened, legs and tail replaced, wing cards added, recoloured as male and female, decimated) by wild-earth tools/build_grouse.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'species': SPECIES, 'rig': RIG,
                   'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview', 'credits': 5,
                              'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                              'credit': 'generated with Meshy (meshy.ai)', 'meshy_metadata': 'none embedded in the source GLB'}}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb), 'bytes;', ', '.join(f'{n} {len(t["idx"]) // 3} tris' for n, t in tiers))
