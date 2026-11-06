# Build the ambient soaring and gliding birds of the Hoh and the coast as variants of the red-tailed hawk's flight
# mesh, one recipe per species (--species <id>):
#   pandion_haliaetus   osprey               -> client/assets/osprey.glb
#   accipiter_striatus  sharp-shinned hawk   -> client/assets/sharp_shinned_hawk.glb
#   falco_columbarius   merlin (black form)  -> client/assets/merlin.glb
#   larus_glaucescens   glaucous-winged gull -> client/assets/glaucous_winged_gull.glb
#   larus_californicus  California gull      -> client/assets/california_gull.glb
#   larus_occidentalis  western gull         -> client/assets/western_gull.glb
#
# Source: variant of buteo_jamaicensis built from its Meshy (meshy.ai) text-to-3D preview, task
#   01a1719d-772f-76b4-9155-823815fec267 (ai_model meshy-6-lite, triangle remesh to 20,000 faces, 20,779 triangles,
#   untextured), 2026-10-25 UTC; job record in the main checkout's
#   library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/job.json (prompt there and in
#   library/animals/buteo_jamaicensis.json). No credits: only the red-tail's body and head are used; the wings, tail
#   and (gulls) bill are our own lofted geometry.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root; the source mesh is git-ignored, in the main checkout), per species:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_soarer.py -- \
#       library/animals/jobs/buteo_jamaicensis/01a1719d-772f-76b4-9155-823815fec267/model.glb \
#       client/assets/osprey.glb --species pandion_haliaetus [--preview <prefix>]
#
# What it does (reviews in library/animals/<id>.json): the ambient flight mesh, seen from below and above at
# 50-400 m, built as tools/build_bald_eagle.py builds the eagle from the same source: the dangling feet deleted, the
# generated tail deleted, the head reshaped per recipe (scale, width, depth, projection ahead of the wings; the hawk's
# hooked bill scaled, or for the gulls cut off and replaced by a lofted gull bill with its gonys, hooked tip and red
# (and black) spots), the bird pitched 12 degrees nose-down, the generated wings cut off at the body. The body is
# scaled so that bill tip to tail tip is the recipe's length and narrowed per recipe. The wings are lofted from the
# recipe's plan outline (leading and trailing edge per span station, in metres), blended from the cut root stub, a
# closed cambered section, an arm and a hand dihedral (the osprey's crooked M: arm up, hand down and swept back),
# then the recipe's slotted primaries (tapered blades, tips curled) or, with none, a pointed tip. The tail is a lofted
# plate (root and tip width, length, square or rounded tip) rising out of the rump. Each surface is lofted in rows
# and stations placed on the field marks, so bars, bands, wingtips, mirrors and trailing edges are their own faces and
# survive to the far tier; the body is recoloured by region with the faint per-face grizzle of the templates.
# Tiers: lod0 ~2,000, lod1 ~800, lod2 ~220 triangles: the body decimated (collapse, X symmetry), wings, tail and bill
# lofted per tier with fewer stations and rows (lod2 2.5x thicker so it never thins out edge-on).
# Rig: the bird template (animalModels.js PART), exactly as client/assets/redtail.glb: BODY, TAIL (pivot at the tail
# root), HEAD (head, neck and bill, pivot at the neck's base), WING_L/R (arm, pivot at the shoulder, weight ramped in
# over the wing root) and HAND_L/R (pivot at the wrist, weight ramped over the hand; primaries fully HAND); collapse 0.
# extras.rig keys as the hawk's: kind, wing, wrist, tail, head, span_m, dihedral_deg (shoulder to wingtip).
# Origin 0.11 m below the shoulder line, like the hawk.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (top, below, side, front, three-quarter; workbench, vertex colour).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
SPECIES = opt('--species', None)
JOB = '01a1719d-772f-76b4-9155-823815fec267'           # the red-tail source used
PITCH = 12.0                                           # the source flies nose-up: pitch the whole bird down (degrees)
TARGETS = [('lod0', 2000), ('lod1', 800), ('lod2', 220)]
BODY, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 3, 4, 5, 6, 9, 10     # animalModels.js PART
smooth, mix = A.smooth, A.mix

# per tier: arm and hand station counts, finger segments, wing thickness factor, tail stations, bill ring and stations
LOD = [dict(arm=7, hand=5, seg=2, thick=1.0, tail=None, ring=6, bill=(0, 0.35, 0.6, 0.75, 0.88, 1.0)),
       dict(arm=3, hand=2, seg=1, thick=1.0, tail=(0, 0.5, 1.0), ring=4, bill=(0, 0.55, 0.85, 1.0)),
       dict(arm=1, hand=1, seg=1, thick=2.5, tail=(0, 1.0), ring=4, bill=(0, 0.6, 1.0))]


# ============================== recipes ==============================
# plan: (u = fraction of the semi-span, leading edge y, trailing edge y), metres relative to the shoulder pivot's y
#   (forward is -y); the root stub's own chord is blended in over the first part of the arm.
# fingers: (angle from straight out in degrees, + swept back; length m; root width m), front (P10) first.
# rows: chordwise row edges (fractions of chord) per tier for the upper and under surface; breaks: extra span
#   stations (u) so field marks land on face edges.
# tail: L root-to-tip length behind the tail pivot (m), w0/w1 half-width at root/tip, tip: centre extension (+ round
#   or wedge, - notch), stations (t, 0 root .. 1 tip, lod0), th thickness at the root.
# head: s uniform head scale, x width, z depth, y projection factor (ahead of the neck), bill: hooked-bill scale
#   (x, z) or a gull bill dict.

class Row(tuple):
    """A chordwise row (f0, f1) that compares as its mid fraction."""
    def __new__(cls, a, b): return tuple.__new__(cls, (a, b))
    m = property(lambda r: (r[0] + r[1]) / 2)
    def __lt__(r, x): return r.m < x
    def __gt__(r, x): return r.m > x
    def __le__(r, x): return r.m <= x
    def __ge__(r, x): return r.m >= x
    def __mul__(r, x): return r.m * x
    __rmul__ = __mul__

def bars(f, f0, f1, n, a, b):
    """Alternate colours a/b in n bands between chord fractions f0..f1, by the face's row (fa, fb); a row wider
    than a band (the far tiers) takes the average."""
    fa, fb = f
    if fb - fa > 1.3 * (f1 - f0) / n: return mix(a, b, 0.5)
    k = int(((fa + fb) / 2 - f0) / (f1 - f0) * n)
    return a if k % 2 == 0 else b

def osprey_wing(side, u, f, hand, L):
    if side > 0:                                     # above: dark brown, coverts a shade warmer
        if f > 0.93: return 0x2a1f17
        return 0x45332a if f < 0.42 else 0x34271e
    if f < 0.42:                                     # underwing coverts white, the dark carpal patch and covert bar
        if L.WRIST_U - 0.05 < u < L.WRIST_U + 0.16 and f > 0.06: return 0x2c2119
        if 0.30 < f and u < L.WRIST_U: return 0x6a5848
        return 0xefece6
    if f > 0.93: return 0x3e342c                     # dark trailing edge
    return bars(f, 0.42, 0.93, 4, 0xb8b4ae, 0x736a62)

def osprey_finger(side, i, q, seg, L):
    if side > 0: return 0x2a1f17 if q == seg - 1 else 0x34271e
    if q == seg - 1: return 0x2a221c
    return 0x9a948c if (q + i) % 2 == 0 else 0x655c54

def osprey_tail(side, t, x):
    if side > 0: return 0x4e3c2e if int(t * 6) % 2 == 0 else 0x3a2c22
    if t > 0.9: return 0xd4d0c8
    return 0xdcd8d0 if int(t * 6) % 2 == 0 else 0x8c8278

def osprey_body(c, n, L):
    S = L.S
    if L.is_bill(c): return (0x1c1c1e if c.y < L.Y_BILL + 0.06 * L.SB else 0x464a50), 0.03
    head = c.y < L.NECK.y + 0.02 * S
    if head or c.y < L.NECK.y + 0.06 * S and n.z > 0.2:
        # white head with a broad dark stripe through the eye, back to the nape
        side = abs(n.x) > 0.35 and abs(c.z - (L.EYE.z - 0.004 * S - (c.y - L.EYE.y) * 0.25)) < 0.017 * S and c.y > L.EYE.y - 0.012 * S
        if side or (c.y > L.NECK.y - 0.01 * S and n.z > 0.45): return 0x3a2a1e, 0.06
        if n.z > 0.5 and L.fleck(c, 0.01 * S) > 0.7: return 0x8a7462, 0.04       # a few streaks on the crown
        return (0xf2efe8 if n.z > -0.4 else 0xe8e4dc), 0.04
    if n.z > 0.05: return 0x3d2c20, 0.10
    if L.NECK.y + 0.02 * S < c.y < L.NECK.y + 0.10 * S and L.fleck(c, 0.012 * S) > 0.45:
        return 0x8a6c50, 0.06                        # the faint brown breast band
    return 0xf1eee8, 0.04

def sharpie_wing(side, u, f, hand, L):
    if side > 0:
        if f > 0.45: return bars(f, 0.45, 1.0, 4, 0x4f5a64, 0x3e4750)
        return 0x5a6773
    if f < 0.42:                                     # white lining with rusty spotting
        return 0xebe4da if f < 0.21 else 0xdcc6b0
    return bars(f, 0.42, 1.0, 5, 0xeeeeea, 0x8c9096)

def sharpie_finger(side, i, q, seg, L):
    if side > 0: return 0x3e4750 if q == seg - 1 else 0x4f5a64
    return 0x5c6066 if q == seg - 1 else (0xe4e4e0 if i % 2 else 0x9a9ea4)

def sharpie_tail(side, t, x):
    band = int(t * 8) % 2 == 1                       # four broad dark bands (t 1/8, 3/8, 5/8, 7/8)
    if t > 0.97: return 0xe8e6e0 if side < 0 else 0xc8c8c4                   # a narrow pale tip
    if side > 0: return 0x2e3135 if band else 0x6b747c
    return 0x5c6066 if band else 0xcdd0d3

def sharpie_body(c, n, L):
    S = L.S
    if L.is_bill(c): return (0x2a2c30 if c.y < L.Y_BILL + 0.052 * L.SB else 0xe8d050), 0.03
    if c.y < L.NECK.y + 0.02 * S:
        if n.z > 0.25: return 0x343e48, 0.04          # the dark cap
        if n.z > -0.3: return 0xc08a60, 0.05          # rufous cheek
        return (0xf0ebe2 if L.fleck(c, 0.006 * S) > 0.4 else 0xb08a6a), 0.03   # streaked throat
    if n.z > 0.05: return 0x56636f, 0.08
    if c.y > L.TAILP.y - 0.03 * S: return 0xf2eee8, 0.03                     # white undertail coverts
    return (0xc8743e if int(c.y / (0.008 * S)) % 2 else 0xf1ebe0), 0.05       # barred rusty-orange on white

def merlin_wing(side, u, f, hand, L):
    if side > 0: return 0x26231f if f > 0.9 else (0x2e2b27 if f < 0.42 else 0x2a2723)
    if f[1] - f[0] < 0.3 and A.hash01(int(u * 40), int(f.m * 30)) > 0.7: return 0x5e5244     # fine pale spots (lod0 rows)
    return 0x352e28 if f < 0.42 else 0x3a332d

def merlin_finger(side, i, q, seg, L): return 0x26231f if side > 0 else 0x352e28

def merlin_tail(side, t, x):
    band = int(t * 10) % 3 == 2 and t < 0.9           # faint narrow pale bands
    if side > 0: return 0x575046 if band else 0x2a2724
    return 0x8a7d6c if band else 0x332e2a

def merlin_body(c, n, L):
    S = L.S
    if L.is_bill(c): return (0x3a4048 if c.y < L.Y_BILL + 0.052 * L.SB else 0xd8b84a), 0.03
    if c.y < L.NECK.y + 0.02 * S:
        if n.z > 0.15: return 0x2e2a26, 0.04          # the dark face and crown
        mous = abs(n.x) > 0.5 and c.y > L.EYE.y and c.z < L.EYE.z
        if mous: return 0x3a302a, 0.04                # an indistinct moustache
        return (0xb8a388 if L.fleck(c, 0.006 * S) > 0.5 else 0x5a4a3c), 0.04   # streaked buff throat
    if n.z > 0.05: return 0x2c2925, 0.06
    return (0x3a2a1f if A.hash01(abs(c.x) // (0.006 * S), c.y // (0.02 * S)) > 0.4 else 0xc9a77c), 0.04   # heavy streaks

def gull(mantle, under_ff, tips, mirror, tip_from):
    """Wing, finger, tail and body colour functions for a white-headed gull: mantle grey above, white trailing
    edge, wingtips (u > tip_from) of colour `tips` with white mirrors, white underwing coverts, under_ff below."""
    def wing(side, u, f, hand, L):
        tip = u > tip_from
        if tip:
            if mirror(u, f): return 0xf4f4f2
            if side > 0 or tips != mantle: return tips
            return mix(tips, 0xffffff, 0.15)
        if side > 0:
            return 0xf2f2f0 if f > 0.86 else mantle
        if f < 0.42: return 0xf4f4f2
        return 0xeeeeec if f > 0.9 else under_ff
    def body(c, n, L):
        S = L.S
        if L.is_bill(c): return 0xe8c040, 0.02
        if n.z > -0.3 and c.z > L.SHZ - 0.005 * S and L.NECK.y + 0.05 * S < c.y < L.TAILP.y - 0.01 * S:
            return mantle, 0.03                       # the grey mantle and scapulars
        return (0xf6f6f4 if n.z > -0.3 else 0xeeeeec), 0.025
    tail = lambda side, t, x: 0xf6f6f4 if side > 0 else 0xececea
    return wing, None, tail, body

def gull_mirror(u0, u1, f0, f1):
    def m(u, f): return u0 < u < u1 and f0 < f < f1
    return m

GW = gull(0xb0b9c1, 0xd2d6da, 0xa2abb4, lambda u, f: (u > 0.965 and 0.2 < f < 0.8) or (0.9 < u < 0.965 and f > 0.75), 0.86)
CA = gull(0x98a1ab, 0xb2b7bd, 0x1c1c1e, gull_mirror(0.93, 0.975, 0.12, 0.5), 0.80)
WE = gull(0x59616b, 0x60666d, 0x1a1a1c, lambda u, f: u > 0.975 and f > 0.25, 0.82)

RECIPES = {
    'pandion_haliaetus': dict(
        out='osprey', common='Osprey', span=1.6, length=0.56, mass=1.6,
        arm_deg=9.0, hand_deg=-11.0, wrist_u=0.42, body_x=0.82, body_z=0.9,
        plan=[(0.25, -0.13, 0.15), (0.42, -0.17, 0.12), (0.6, -0.125, 0.13), (0.75, -0.08, 0.135), (0.86, -0.055, 0.13)],
        fingers=[(4, 0.11, 0.036), (14, 0.14, 0.038), (24, 0.135, 0.038), (35, 0.11, 0.036)], curl=0.10,
        rows_up=(0, 0.12, 0.42, 0.93, 1.0), rows_dn=(0, 0.06, 0.30, 0.42, 0.55, 0.68, 0.80, 0.93, 1.0),
        rows1=((0, 0.42, 0.93, 1.0), (0, 0.06, 0.42, 0.68, 0.93, 1.0)), rows2=((0, 0.42, 1.0), (0, 0.42, 1.0)),
        breaks=(0.37, 0.58), round_te=0.05, round_le=0.03,
        tail=dict(L=0.20, w0=0.045, w1=0.075, tip=0.004, stations=(0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 0.9, 1.0), th=0.014),
        head=dict(s=0.96, x=0.92, z=0.95, y=1.08, bill=(1.0, 1.0)),
        eye=0xf0d040, colors=(osprey_wing, osprey_finger, osprey_tail, osprey_body)),
    'accipiter_striatus': dict(
        out='sharp_shinned_hawk', common='Sharp-shinned hawk', span=0.58, length=0.29, mass=0.14,
        arm_deg=4.0, hand_deg=0.0, wrist_u=0.42, body_x=0.95, body_z=1.0,
        plan=[(0.25, -0.048, 0.062), (0.42, -0.057, 0.055), (0.62, -0.05, 0.052), (0.80, -0.042, 0.044), (0.86, -0.038, 0.040)],
        fingers=[(-14, 0.030, 0.011), (-4, 0.040, 0.012), (7, 0.043, 0.012), (18, 0.039, 0.012), (29, 0.031, 0.011)], curl=0.12,
        rows_up=(0, 0.45, 0.59, 0.72, 0.86, 1.0), rows_dn=(0, 0.21, 0.42, 0.536, 0.652, 0.768, 0.884, 1.0),
        rows1=((0, 0.45, 1.0), (0, 0.42, 0.652, 0.884, 1.0)), rows2=((0, 0.45, 1.0), (0, 0.42, 1.0)),
        breaks=(), round_te=0.10, round_le=0.04,
        tail=dict(L=0.15, w0=0.021, w1=0.029, tip=-0.002, stations=(0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 0.97, 1.0), stations1=(0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1.0), th=0.006),
        head=dict(s=0.84, x=0.95, z=0.95, y=0.85, bill=(0.9, 0.9)),
        eye=0xd8401a, colors=(sharpie_wing, sharpie_finger, sharpie_tail, sharpie_body)),
    'falco_columbarius': dict(
        out='merlin', common='Merlin', span=0.60, length=0.27, mass=0.19,
        arm_deg=2.0, hand_deg=-3.0, wrist_u=0.38, body_x=1.0, body_z=1.0,
        plan=[(0.22, -0.046, 0.06), (0.38, -0.05, 0.05), (0.6, -0.036, 0.048), (0.8, -0.008, 0.044), (0.93, 0.02, 0.044), (1.0, 0.040, 0.046)],
        fingers=[], curl=0,
        rows_up=(0, 0.42, 0.9, 1.0), rows_dn=(0, 0.2, 0.42, 0.6, 0.8, 1.0),
        rows1=((0, 0.42, 1.0), (0, 0.42, 1.0)), rows2=((0, 0.5, 1.0), (0, 0.5, 1.0)),
        breaks=(), round_te=0.0, round_le=0.0,
        tail=dict(L=0.125, w0=0.017, w1=0.023, tip=0.003, stations=(0, 0.2, 0.3, 0.5, 0.6, 0.8, 0.9, 1.0), th=0.006),
        head=dict(s=0.95, x=1.0, z=1.0, y=0.9, bill=(0.95, 0.95)),
        eye=0x1c140e, colors=(merlin_wing, merlin_finger, merlin_tail, merlin_body)),
    'larus_glaucescens': dict(
        out='glaucous_winged_gull', common='Glaucous-winged gull', span=1.4, length=0.63, mass=1.0,
        arm_deg=6.0, hand_deg=-6.0, wrist_u=0.42, body_x=0.74, body_z=0.85,
        plan=[(0.22, -0.10, 0.13), (0.42, -0.118, 0.11), (0.6, -0.098, 0.10), (0.78, -0.052, 0.085), (0.92, 0.0, 0.07), (1.0, 0.042, 0.054)],
        fingers=[], curl=0,
        rows_up=(0, 0.42, 0.75, 0.86, 1.0), rows_dn=(0, 0.2, 0.42, 0.9, 1.0),
        rows1=((0, 0.42, 0.86, 1.0), (0, 0.42, 1.0)), rows2=((0, 0.5, 0.86, 1.0), (0, 0.5, 1.0)),
        breaks=(0.86, 0.9, 0.965), round_te=0.0, round_le=0.0,
        tail=dict(L=0.18, w0=0.040, w1=0.058, tip=0.0, stations=(0, 0.5, 1.0), th=0.012),
        head=dict(s=0.95, x=0.86, z=0.95, y=1.16,
                  bill=dict(L=0.058, w=0.016, dt=0.010, db=0.009, gonys=1.35, hook=0.006, spots=[(0.6, 0.86, -1, 0xd8402a)])),
        eye=0x2a2420, colors=GW),
    'larus_californicus': dict(
        out='california_gull', common='California gull', span=1.3, length=0.53, mass=0.6,
        arm_deg=6.0, hand_deg=-6.0, wrist_u=0.42, body_x=0.70, body_z=0.82, chord=0.9,
        plan=[(0.22, -0.10, 0.13), (0.42, -0.118, 0.11), (0.6, -0.098, 0.10), (0.78, -0.052, 0.085), (0.92, 0.0, 0.07), (1.0, 0.042, 0.054)],
        fingers=[], curl=0,
        rows_up=(0, 0.12, 0.42, 0.75, 0.86, 1.0), rows_dn=(0, 0.12, 0.42, 0.9, 1.0),
        rows1=((0, 0.42, 0.86, 1.0), (0, 0.42, 1.0)), rows2=((0, 0.5, 0.86, 1.0), (0, 0.5, 1.0)),
        breaks=(0.80, 0.93, 0.975), round_te=0.0, round_le=0.0,
        tail=dict(L=0.16, w0=0.034, w1=0.050, tip=0.0, stations=(0, 0.5, 1.0), th=0.010),
        head=dict(s=0.92, x=0.84, z=0.92, y=1.16,
                  bill=dict(L=0.050, w=0.013, dt=0.008, db=0.007, gonys=1.25, hook=0.005,
                            spots=[(0.6, 0.75, 0, 0x1c1c1e), (0.75, 0.88, -1, 0xd8402a)])),
        eye=0x2a2420, colors=CA),
    'larus_occidentalis': dict(
        out='western_gull', common='Western gull', span=1.4, length=0.60, mass=1.0,
        arm_deg=5.0, hand_deg=-5.0, wrist_u=0.42, body_x=0.76, body_z=0.88, chord=1.1,
        plan=[(0.22, -0.10, 0.13), (0.42, -0.118, 0.11), (0.6, -0.098, 0.10), (0.78, -0.055, 0.085), (0.92, -0.005, 0.07), (1.0, 0.036, 0.056)],
        fingers=[], curl=0,
        rows_up=(0, 0.42, 0.75, 0.86, 1.0), rows_dn=(0, 0.2, 0.42, 0.9, 1.0),
        rows1=((0, 0.42, 0.86, 1.0), (0, 0.42, 1.0)), rows2=((0, 0.5, 0.86, 1.0), (0, 0.5, 1.0)),
        breaks=(0.82, 0.975), round_te=0.0, round_le=0.0,
        tail=dict(L=0.17, w0=0.040, w1=0.058, tip=0.0, stations=(0, 0.5, 1.0), th=0.012),
        head=dict(s=0.98, x=0.9, z=0.98, y=1.12,
                  bill=dict(L=0.057, w=0.018, dt=0.012, db=0.011, gonys=1.6, hook=0.007, spots=[(0.6, 0.86, -1, 0xd8402a)])),
        eye=0xb89a40, colors=WE),
}
assert SPECIES in RECIPES, 'use --species with one of ' + ', '.join(RECIPES)
RC = RECIPES[SPECIES]
SPAN, LENGTH, SEMI = RC['span'], RC['length'], RC['span'] / 2
KS = SEMI / 1.0                                        # size factor against the eagle (metre ramps in the template)
HD = RC['head']; GULL_BILL = isinstance(HD['bill'], dict)
WING_C, FINGER_C, TAIL_C, BODY_C = RC['colors']
TAIL_R = RC['tail']

# ---- source landmarks (raw units, Blender axes: x the bird's left, -y forward, +z up; ~1.9 units span) ----
X_ROOT = 0.115                         # the wing leaves the body
Y_NECK, Y_TAIL = -0.165, 0.14          # neck base, tail root
PIV0 = Vector((0, -0.04, -0.12))       # body centre (pitch pivot)
BILL0 = Vector((0, -0.30, -0.15))      # the bill's base (gape), before the pitch
EYE0 = Vector((0, -0.283, -0.112))
HC = Vector((0, -0.25, -0.13))         # head centre (raw)
HEAD_ZC = -0.125
def is_tail(p): return abs(p.x) < 0.17 and p.y > Y_TAIL and p.z < -0.17

def head_t(p):
    """The recipe's head reshaping (raw, before the pitch): bill scale, head width and depth, head scale, projection."""
    q = p.copy(); xr = 1 - smooth(0.07, 0.11, abs(p.x))
    if xr <= 0: return q
    hw = smooth(-0.17, -0.24, p.y) * xr
    if not GULL_BILL:
        bx, bz = HD['bill']; bw = smooth(-0.285, -0.305, p.y) * xr
        q.x *= 1 + (bx - 1) * bw; q.z = BILL0.z + (q.z - BILL0.z) * (1 + (bz - 1) * bw)
    q.x *= 1 + (HD['x'] - 1) * hw
    q.z = HEAD_ZC + (q.z - HEAD_ZC) * (1 + (HD['z'] - 1) * hw)
    q = HC + (q - HC) * (1 + (HD['s'] - 1) * hw) if hw > 0 else q
    q.y += (HD['y'] - 1) * min(0.0, p.y + 0.10) * xr
    return q

ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
feet = [v for v in bm.verts if abs(v.co.x) < 0.09 and 0.085 < v.co.y < 0.18 and v.co.z < -0.258]
tailv = [v for v in bm.verts if is_tail(v.co) and v.co.y > 0.175 and v not in set(feet)]
print('INFO feet verts', len(feet), 'tail verts', len(tailv))
bmesh.ops.delete(bm, geom=list(set(feet) | set(tailv)), context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
near = [v for v in bm.verts if abs(v.co.x) < 0.12 and 0.06 < v.co.y < 0.2 and v.co.z < -0.1]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=near, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(me); bm.free(); me.update()
for v in me.vertices: v.co = head_t(v.co)
EYE_R, BILL_R = head_t(EYE0), head_t(BILL0)
me.update()
if GULL_BILL:
    # cut the hawk's hook off at the gape, taper the forehead into the gull bill's base
    cut = BILL_R.y + 0.004
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < cut and abs(v.co.x) < 0.08], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free(); me.update()
    ring = [v.co for v in me.vertices if v.co.y < cut + 0.01]
    BZC = sum(p.z for p in ring) / len(ring) - 0.004
    for v in me.vertices:
        w = smooth(cut + 0.05, cut, v.co.y)
        if w > 0:
            k = 1 - 0.45 * w
            v.co.x *= k; v.co.z = BZC + (v.co.z - BZC) * k
    me.update()
    BILL_ROOT_R = Vector((0, cut + 0.006, BZC))

# pitch the whole bird nose-down about the body centre
R = Matrix.Rotation(math.radians(PITCH), 3, 'X')
pitch = lambda p: PIV0 + R @ (p - PIV0)
V = me.vertices
for v in V: v.co = pitch(v.co)

# ---- the root stub's chord, level it, cut the generated wings off at the body ----
def stub(lo, hi):
    s = [v.co.y for v in V if lo <= abs(v.co.x) < hi]
    return min(s), max(s)
STUB_RAW = stub(X_ROOT - 0.02, X_ROOT)
def section(lo, hi):
    s = [v.co for v in V if lo < abs(v.co.x) < hi]
    s.sort(key=lambda p: p.y); n = max(3, len(s) // 8)
    le, te = s[:n], s[-n:]
    zl, zt = sum(p.z for p in le) / n, sum(p.z for p in te) / n
    yl, yt = sum(p.y for p in le) / n, sum(p.y for p in te) / n
    return math.atan2(zl - zt, yt - yl), Vector((0, (yl + yt) / 2, (zl + zt) / 2)), min(p.z for p in s), max(p.z for p in s)
ang, ctr, _, _ = section(X_ROOT - 0.01, X_ROOT + 0.02)
for v in V:
    w = smooth(X_ROOT - 0.05, X_ROOT - 0.005, abs(v.co.x))
    if w <= 0: continue
    d = v.co - Vector((v.co.x, ctr.y, ctr.z))
    v.co = Vector((v.co.x, ctr.y, ctr.z)) + Matrix.Rotation(ang * w, 3, 'X') @ d
_, ROOT_C, zlo, zhi = section(X_ROOT - 0.015, X_ROOT)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(v.co.x) > X_ROOT], context='VERTS')
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
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
print('INFO pieces after the wing cut', len(isl), 'root chord angle %.1f deg' % math.degrees(ang))

# ---- to metres: bill (or gape plus the gull bill) to tail tip = LENGTH ----
TP_R = pitch(Vector((0, Y_TAIL, -0.215)))
FRONT_R = pitch(BILL_ROOT_R).y if GULL_BILL else min(v.co.y for v in V)
S = (LENGTH - TAIL_R['L'] - (HD['bill']['L'] if GULL_BILL else 0)) / (TP_R.y - FRONT_R)
BX, BZ = RC['body_x'], RC['body_z']
SH_RAW = Vector((X_ROOT, ROOT_C.y, ROOT_C.z))
def M(p): return Vector((p[0] * S * BX, (p[1] - SH_RAW.y) * S - 0.02, (p[2] - SH_RAW.z) * S * BZ + 0.11))
for v in V: v.co = M(v.co)
me.update()
SHOULDER = Vector((X_ROOT * S * BX, -0.02, 0.11))
STUB = ((STUB_RAW[0] - SH_RAW.y) * S - 0.02, (STUB_RAW[1] - SH_RAW.y) * S - 0.02)
NECK = M(pitch(head_t(Vector((0, Y_NECK, -0.12)))))
TAILP = M(TP_R)
EYE = M(pitch(EYE_R))
SB = S * (HD['bill'][1] if not GULL_BILL else 1) * HD['s'] * HD['y']     # bill-scale for colour thresholds
Y_BILL = min(v.co.y for v in V)
if GULL_BILL: BILL_ROOT = M(pitch(BILL_ROOT_R)); Y_BILL = BILL_ROOT.y - HD['bill']['L']
Y_TAILTIP = TAILP.y + TAIL_R['L']

WRIST_X = RC['wrist_u'] * SEMI
tanA, tanH = math.tan(math.radians(RC['arm_deg'])), math.tan(math.radians(RC['hand_deg']))
def zmid(ax):
    return SHOULDER.z + (min(ax, WRIST_X) - SHOULDER.x) * tanA + max(0.0, ax - WRIST_X) * tanH if ax > SHOULDER.x else SHOULDER.z
WRIST = Vector((WRIST_X, -0.02, zmid(WRIST_X)))
FING = RC['fingers']
REACH = max([Lf * math.cos(math.radians(a)) for a, Lf, w in FING] or [0]) - (0.015 * KS if FING else 0)
CUT = SEMI - REACH
TIP_Z = zmid(CUT) + (REACH * tanH if FING else 0)
DIHEDRAL = round(math.degrees(math.atan2(TIP_Z - SHOULDER.z, SEMI - SHOULDER.x)), 1)
print('INFO scale %.4f m/unit; shoulder x %.3f; wrist %.3f; cut %.3f; stub le %.3f te %.3f; dihedral %.1f' %
      (S, SHOULDER.x, WRIST_X, CUT, STUB[0], STUB[1], DIHEDRAL))

# eye on the head surface
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
hit = bvh.ray_cast(Vector((0.3, EYE.y, EYE.z)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.03 * S
print('INFO eye x %.4f' % EYE_X)

# ---- the wing outline ----
CH = RC.get('chord', 1.0)
PLAN_S = [(SHOULDER.x, STUB[0], STUB[1])] + [(u * SEMI, -0.02 + (le + te) / 2 - CH * (te - le) / 2, -0.02 + (le + te) / 2 + CH * (te - le) / 2) for u, le, te in RC['plan']]
if FING: PLAN_S[-1] = (CUT, PLAN_S[-1][1], PLAN_S[-1][2])
def interp(tab, i, ax):
    if ax <= tab[0][0]: return tab[0][i]
    for a, b in zip(tab, tab[1:]):
        if ax <= b[0]: t = (ax - a[0]) / (b[0] - a[0]); return a[i] + (b[i] - a[i]) * t
    return tab[-1][i]
BLEND = RC['plan'][0][0] * SEMI
def outline(ax):
    le, te = interp(PLAN_S[1:], 1, ax), interp(PLAN_S[1:], 2, ax)
    b = smooth(SHOULDER.x, BLEND, ax)
    le = STUB[0] + (le - STUB[0]) * b; te = STUB[1] + (te - STUB[1]) * b
    h = smooth(WRIST.x, CUT, ax) ** 1.6; c = te - le
    return le + RC['round_le'] * c * h, te - RC['round_te'] * c * h
T_ROOT, T_HAND, CAMBER = 0.025 * SPAN, 0.008 * SPAN, 0.03
def wing_point(s, ax, f, side, tk=1.0):
    le, te = outline(ax); c = te - le
    th = tk * (T_ROOT + (T_HAND - T_ROOT) * smooth(SHOULDER.x, CUT, ax))
    th = min(th, 0.25 * c) if c > 0 else 0
    z = zmid(ax) + CAMBER * c * 4 * f * (1 - f) + side * 0.5 * th * 2.6 * math.sqrt(f) * (1 - f)
    return Vector((s * ax, le + c * f, z))
for ax in (SHOULDER.x, BLEND, WRIST.x, (WRIST.x + CUT) / 2, CUT):
    le, te = outline(ax); print('PLAN x %.3f le %.3f te %.3f chord %.3f z %.3f' % (ax, le, te, te - le, zmid(ax)))

# ---- rig ----
def head_w(p): return smooth(NECK.y + 0.02 * S, NECK.y - 0.04 * S, p.y)
def tail_w(p): return smooth(TAILP.y - 0.01 * S, TAILP.y + 0.06 * S, p.y) if abs(p.x) < 0.22 * S else 0.0
def pos_rig(p):
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())
def vert_rig(i): return pos_rig(V[i].co)
def rig3(p): r = pos_rig(p); return (r['part'], r['partw'], r['pivot'])
def arm_rig(s, ax): return (WING_L if s > 0 else WING_R), smooth(SHOULDER.x - 0.01 * KS, SHOULDER.x + 0.07 * KS, ax), Vector((s * SHOULDER.x, SHOULDER.y, SHOULDER.z))
def hand_rig(s, ax): return (HAND_L if s > 0 else HAND_R), smooth(WRIST.x - 0.005 * KS, WRIST.x + 0.08 * KS, ax), Vector((s * WRIST.x, WRIST.y, WRIST.z))

# ---- colour landmarks for the recipe's functions ----
class LM: pass
L = LM(); L.S, L.SB, L.NECK, L.TAILP, L.EYE, L.Y_BILL, L.WRIST_U = S, SB, NECK, TAILP, EYE, Y_BILL, RC['wrist_u']
L.SHZ = SHOULDER.z
L.fleck = lambda c, k: A.hash01(abs(c.x) // k, c.y // k, c.z // k)
L.is_bill = lambda c: (not GULL_BILL) and c.y < Y_BILL + 0.075 * SB and abs(c.x) < 0.045 * S * BX * HD['s'] and c.y < EYE.y - 0.012 * S
def body_lin(p):
    h, g = BODY_C(p.center, p.normal, L)
    return A.grizzle(h, p.center, g, 0.03 * S)

class Extra:
    def __init__(self): self.tris = []
    def quad(self, p, col, rigs, out):
        for i, j, k in ((0, 1, 2), (0, 2, 3)):
            a, b, c = p[i], p[j], p[k]; ra, rb, rc = rigs[i], rigs[j], rigs[k]
            n = (b - a).cross(c - a)
            if n.length < 1e-12: continue
            if n.dot(out) < 0: b, c, rb, rc = c, b, rc, rb
            self.tris.append((a, b, c, col, (ra, rb, rc)))
    def tri(self, p, col, rigs, out):
        a, b, c = p; ra, rb, rc = rigs
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

def stations(cfg):
    root = SHOULDER.x - 0.015 * KS
    st = [root + (WRIST.x - root) * i / cfg['arm'] for i in range(cfg['arm'] + 1)] + [WRIST.x + (CUT - WRIST.x) * i / cfg['hand'] for i in range(1, cfg['hand'] + 1)]
    for u in RC['breaks']:
        x = u * SEMI
        if root < x < CUT and min(abs(x - a) for a in st) > 0.012 * SEMI: st.append(x)
    return sorted(st)

def wings(ex, level):
    cfg = LOD[level]; tk = cfg['thick']
    rows_up, rows_dn = (RC['rows_up'], RC['rows_dn']) if level == 0 else RC['rows%d' % level]
    st = stations(cfg)
    for s in (1, -1):
        for k in range(len(st) - 1):
            a0, a1 = st[k], st[k + 1]; hand = a0 >= WRIST.x - 1e-6; um = (a0 + a1) / 2 / SEMI
            rig = (lambda ax: hand_rig(s, ax)) if hand else (lambda ax: arm_rig(s, ax))
            for side, rows, out in ((1, rows_up, Vector((0, 0, 1))), (-1, rows_dn, Vector((0, 0, -1)))):
                for j in range(len(rows) - 1):
                    f0, f1 = rows[j], rows[j + 1]
                    p = [wing_point(s, a0, f0, side, tk), wing_point(s, a1, f0, side, tk), wing_point(s, a1, f1, side, tk), wing_point(s, a0, f1, side, tk)]
                    ex.quad(p, WING_C(side, um, Row(f0, f1), hand, L), [rig(abs(q.x)) for q in p], out)
    # primaries: fanned blades from the hand's end, tips curled up, continuing the hand's dihedral
    for s in (1, -1):
        part, _, piv = hand_rig(s, CUT); rg = (part, 1.0, piv)
        for i, (a, Lf, w0) in enumerate(FING):
            f = 0.04 + 0.92 * (i + 0.5) / len(FING)
            root = wing_point(s, CUT - 0.01 * KS, f, 0)
            d = Vector((s * math.cos(math.radians(a)), math.sin(math.radians(a)), math.cos(math.radians(a)) * tanH))
            across = Vector((-d.y, d.x, 0)).normalized() * s
            seg = cfg['seg'] + (1 if level == 0 and SPECIES == 'pandion_haliaetus' else 0); pts = []
            for q in range(seg + 1):
                t = q / seg
                p = root + d * (Lf * t) + Vector((0, 0, RC['curl'] * Lf * t * t))
                wd = w0 * (1 - 0.45 * t)
                pts.append((p + across * (wd / 2), p - across * (wd / 2)))
            for q in range(seg):
                (a0p, b0p), (a1p, b1p) = pts[q], pts[q + 1]
                for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                    off = Vector((0, 0, 0.0015 * KS * tk * side))
                    ex.quad([a0p + off, b0p + off, b1p + off, a1p + off], FINGER_C(side, i, q, seg, L), [rg] * 4, out)

def tail(ex, level):
    T = TAIL_R; tk = LOD[level]['thick']
    ts = T['stations'] if level == 0 else T.get('stations1') if level == 1 and 'stations1' in T else LOD[level]['tail']
    y0 = TAILP.y - 0.35 * T['L']
    xs = (-1, -0.5, 0, 0.5, 1) if level == 0 else (-1, 0, 1)
    def pt(t, xf, side):
        hw = T['w0'] * 0.8 + (T['w1'] - T['w0'] * 0.8) * smooth(0, 1, t)
        y = y0 + (TAILP.y + T['L'] - y0) * t + T['tip'] * (1 - xf * xf) * t
        z = TAILP.z + 0.004 * KS + 0.02 * (y - TAILP.y)
        th = tk * T['th'] * (1 - xf * xf) * (1 - 0.75 * t)
        return Vector((xf * hw, y, z + side * th / 2))
    for i in range(len(ts) - 1):
        t0, t1 = ts[i], ts[i + 1]
        for j in range(len(xs) - 1):
            x0, x1 = xs[j], xs[j + 1]
            for side, out in ((1, Vector((0, 0, 1))), (-1, Vector((0, 0, -1)))):
                p = [pt(t0, x0, side), pt(t0, x1, side), pt(t1, x1, side), pt(t1, x0, side)]
                ex.quad(p, TAIL_C(side, (t0 + t1) / 2, (x0 + x1) / 2), [rig3(q) for q in p], out)

def bill(ex, level):
    """The gull bill: rings from the base (inside the forehead) to the hooked tip; gonys bulge; spots."""
    B = HD['bill']; cfg = LOD[level]; ts = cfg['bill']; nr = cfg['ring']
    rg = (HEAD, 1.0, NECK)
    base = BILL_ROOT + Vector((0, 0.008, 0))
    Lb = B['L'] + 0.008
    def ring(t):
        y = base.y - Lb * t
        zc = base.z - 0.08 * Lb * t - B['hook'] * smooth(0.8, 1.0, t)
        w = B['w'] / 2 * (1 - 0.5 * t) * (1 - smooth(0.88, 1.0, t))
        dt = B['dt'] * (1 - 0.45 * t) * (1 - smooth(0.9, 1.0, t))
        db = B['db'] * (1 - 0.5 * t + (B['gonys'] - 1) * math.exp(-((t - 0.72) / 0.12) ** 2)) * (1 - smooth(0.78, 1.0, t))
        pts = []
        for k in range(nr):
            th = math.pi / 2 - 2 * math.pi * k / nr
            sn = math.sin(th)
            pts.append(Vector((w * math.cos(th), y, zc + (dt if sn > 0 else db) * sn)))
        return pts, Vector((0, y, zc))
    rings = [ring(t) for t in ts]
    for i in range(len(ts) - 1):
        (r0, c0), (r1, c1) = rings[i], rings[i + 1]; tm = (ts[i] + ts[i + 1]) / 2
        for k in range(nr):
            a, b = r0[k], r0[(k + 1) % nr]; c, d = r1[(k + 1) % nr], r1[k]
            low = (a.z + b.z) / 2 < (c0.z if True else 0) - 1e-4
            col = 0xe8c040
            if level == 0:
                for t0, t1, where, h in B['spots']:
                    if t0 <= tm < t1 and (where == 0 or (where < 0 and low)): col = h
            if tm > 0.94: col = 0xf0d878
            out = ((a + b + c + d) / 4) - (c0 + c1) / 2
            ex.quad([a, b, c, d], col, [rg] * 4, out)

def eyes(ex):
    r = Vector((0.005, 0.0065, 0.0055)) * S * HD['s']
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (abs(EYE_X) - 0.0015 * S), EYE.y, EYE.z)), r, RC['eye'], (HEAD, 1.0, NECK))

# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); wings(ex, level); tail(ex, level)
    if GULL_BILL: bill(ex, level)
    if level == 0: eyes(ex)
    o, n0 = A.tier_copy(ob, max(60, target - len(ex.tris)))
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
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(mesh {nbody}, wings, tail, bill and eyes {len(ex.tris)})', 'verts', len(out['pos']), 'from', n0)
    return out

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TARGETS)]
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
le_root, te_root = outline(BLEND)
print('LANDMARKS %s span %.3f m, bill to tail %.3f m, bill tip z %.3f, tail tip z %.3f, head ahead of the wing leading edge %.3f m, tail behind the root trailing edge %.3f m, chord at the arm %.3f m, shoulder %s, wrist %s, neck %s, tail root %s, dihedral %.1f deg, body scale %.3f' % (
    SPECIES, ext[0][1] - ext[0][0], ext[2][1] - ext[2][0], ext[2][1], ext[2][0], le_root - Y_BILL, Y_TAILTIP - te_root, te_root - le_root,
    tuple(round(x, 3) for x in A.to3(SHOULDER)), tuple(round(x, 3) for x in A.to3(WRIST)), tuple(round(x, 3) for x in A.to3(NECK)),
    tuple(round(x, 3) for x in A.to3(TAILP)), DIHEDRAL, S))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'wrist': list(A.to3(WRIST)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK)),
       'span_m': SPAN, 'dihedral_deg': DIHEDRAL}
A.write_glb(OUT, tiers, 'wild-earth tools/build_soarer.py (Blender)',
            f'{RC["common"]}: generated with Meshy (meshy.ai), task {JOB} (the red-tailed hawk preview), owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt as the {RC["common"].lower()} (feet and tail removed, head reshaped, wings and tail lofted from our own outline, recoloured, decimated) by wild-earth tools/build_soarer.py --species {SPECIES}',
            extras={'species': SPECIES, 'rig': RIG,
                    'source': {'kind': 'variant', 'of': 'buteo_jamaicensis', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
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
        for view, d, up, scale in [('top', (0, 0, 1), (0, -1, 0), SPAN * 1.1), ('below', (0, 0, -1), (0, -1, 0), SPAN * 1.1),
                                   ('side', (1, 0, 0.02), (0, 0, 1), LENGTH * 1.5), ('front', (0, -1, 0.08), (0, 0, 1), SPAN * 1.1),
                                   ('q', (0.7, -0.8, -0.5), (0, 0, 1), SPAN * 1.1), ('head', (0.8, -0.9, 0.5), (0, 0, 1), LENGTH * 0.8)]:
            ctr = Vector((0, (NECK.y + Y_BILL) / 2, NECK.z)) if view == 'head' else Vector((0, 0, 0.1))
            cam.data.ortho_scale = scale
            fwd = -Vector(d).normalized(); u = Vector(up)
            r = fwd.cross(u).normalized(); u = r.cross(fwd)
            mw = Matrix((r, u, -fwd)).transposed().to_4x4(); mw.translation = ctr - fwd * 3
            cam.matrix_world = mw
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
