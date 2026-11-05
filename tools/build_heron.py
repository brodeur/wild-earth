# Build client/assets/heron.glb, the great blue heron (Ardea herodias) of the Hoh's gravel bars and side channels,
# from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1ad36-40a0-71c0-85cb-2afaae713e7e, ai_model latest
#   (meshy-7.1), triangle remesh to 20,000 faces (20,178 triangles, untextured), 2026-11-05 UTC, 20 credits; job record
#   in library/animals/jobs/ardea_herodias/01a1ad36-40a0-71c0-85cb-2afaae713e7e/job.json. Prompt:
#   "A great blue heron (Ardea herodias), one adult standing still in a neutral upright pose on two long thin legs,
#   side-on, wings folded against the body, neck in an S-curve with the head held up, NOT flying. Realistic
#   proportions: 1.1 m tall, 1.0 m long, very long thin yellowish-grey legs with long thin toes, a long slender neck, a
#   long straight dagger-shaped yellow bill, a narrow body. Blue-grey body and wings, a white face and crown with a black
#   stripe above the eye ending in thin black plumes behind the head, rusty-chestnut thighs, a grey neck with a
#   black-and-white streaked front, long grey plumes over the lower neck and back. No base, no ground, no water.
#   Game-ready, clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_heron.py -- \
#       library/animals/jobs/ardea_herodias/01a1ad36-40a0-71c0-85cb-2afaae713e7e/model.glb \
#       client/assets/heron.glb [--preview <prefix>]
#
# What it does (review in library/animals/ardea_herodias.json): keeps the generated standing heron (S-curved neck,
# head, folded wings, the lower-neck plumes, the body held at its upright slant) and its pose. The thin legs would not
# survive the collapse to ~2,500 triangles, so the bare legs and feet are deleted below the feathered thighs (the stubs
# stay as the chestnut thighs) and replaced by procedural legs on the generated legs' own lines: a chestnut feathered
# thigh from the hip, the bare tibia to the backward-bending intertarsal joint, the tarsus to the foot, three long
# forward toes and a hind toe, dull yellowish-grey. The bill is lengthened 1.25x from the gape into the long dagger
# (0.14 m). Adds a pair of thin black nape plumes, a yellow eye (lod0), and flight wing cards for the slow flight when
# flushed (an arm and a hand per side, broad, long and arched down at the hand, 1.85 m span: blue-grey coverts, black
# flight feathers and a chestnut bend above, grey lining and darker grey flight feathers below) that the client
# collapses into the shoulder on the ground. Scales to 1.10 m feet to crown, feet on z = 0, the origin between the
# feet. Recolours by region (sRGB): blue-grey back and folded wings with darker slate primaries, white face and crown
# with a broad black stripe from above the eye back to the nape plumes, white throat, grey neck with a black-and-white
# streaked front, pale grey lower-neck plumes, a chestnut patch at the bend of the folded wing, dark grey belly
# streaked white, chestnut thighs, a yellow bill dusky along the top, dull yellowish-grey legs; faint per-face
# grizzle. Tiers: lod0 ~2,500, lod1 ~900, lod2 ~300 triangles including legs, plumes, wing cards and eyes (eyes in
# lod0 only). Before the collapse, faces on non-manifold edges are deleted and refilled and the loose open feather
# sheets eroded (both stall the collapse). lod0: Blender collapse (X symmetry) in two stages, the neck, head and bill
# to 40% of the mesh budget with the body frozen, then the body with them frozen, so they keep their detail (they
# define the bird). lod1 and lod2: a voxel remesh (6 and 8 mm) of the closed generated mesh, the legs cut off it, then
# a plain symmetric collapse (the generated folded-wing layers stall a direct collapse at ~650 body triangles).
# Rig: the bird template (animalModels.js PART): BODY, LEG_A (left) / LEG_B (right) pivoting at the hip, TAIL (the
# folded wing tips and tail under them, pivot at the tail root), HEAD = the whole neck and head pivoting at the neck's
# base above the shoulders (so the strike swings the neck forward and down; the nape plumes ride with it), WING_L/R
# (arm cards, pivot at the shoulder) and HAND_L/R (hand cards, pivot at the wrist). Pivots in extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (workbench, vertex colour) to <prefix>_<tier>_<view>.png.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1ad36-40a0-71c0-85cb-2afaae713e7e'
SPECIES = 'ardea_herodias'
HEIGHT = 1.10                          # feet to crown, standing (m)
SPAN = 1.85                            # wing cards, tip to tip (m)
BILL_STRETCH = 1.25                    # the bill from the gape
ERODE = 4                              # rings of open-sheet faces eroded before the collapse
TIERS = [('lod0', 2500), ('lod1', 900), ('lod2', 300)]
NECK_SHARE = [0.40, None, None]        # share of lod0's mesh budget kept by the neck, head and bill (masked collapse)
REMESH = [None, 0.006, 0.008]          # voxel remesh (m) before the collapse, per tier
smooth = A.smooth

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

# plumage (sRGB)
BLUEGREY, SLATE, BELLY, STREAKW, CHEST = 0x66788c, 0x3c4452, 0x474b54, 0xd9d9d6, 0x8b4a2b
WHITE, BLACK, NECKG, NECKF, PLUMEG = 0xf0f0ec, 0x18181b, 0x8d929c, 0xe6e6e2, 0xaeb3ba
BILLY, BILLD, LEGC, EYEC, THIGH = 0xe0ad3a, 0x7d6a3c, 0x8c8768, 0xf0d232, 0x8a4a2e
CARD_COV, CARD_FLT, CARD_LIN, CARD_FLT_DN = 0x68798d, 0x1e2024, 0x7d8590, 0x4f545d

# ---- source landmarks (raw units, Blender axes: x the bird's left, -y forward, +z up; 1.9 units feet to crown) ----
NECK_FRONT, NECK_BACK = Vector((0, -0.175, 0.28)), Vector((0, -0.05, 0.425))   # where the neck meets the body
BILL_Y0 = -0.24                        # the gape
EYE_RAW = Vector((0, -0.215, 0.838))
TAIL_RAW = Vector((0, 0.30, -0.27))     # tail root under the folded wings
SHOULDER_RAW = Vector((0.15, -0.01, 0.30))
# the generated legs' centre lines (left side; mirrored): hip inside the body, belly exit, intertarsal joint, foot
LEG_RAW = [Vector((0.066, 0.075, -0.03)), Vector((0.068, 0.10, -0.12)), Vector((0.074, 0.145, -0.45)), Vector((0.10, 0.07, -0.905))]

ob = A.import_glb_mesh(SRC)
me = ob.data
ZF = min(v.co.z for v in me.vertices); ZT = max(v.co.z for v in me.vertices)
print('INFO raw feet z %.3f crown z %.3f' % (ZF, ZT))

# the bill: lengthen from the gape
for v in me.vertices:
    if v.co.z > 0.7 and v.co.y < BILL_Y0:
        v.co.y = BILL_Y0 + (v.co.y - BILL_Y0) * (1 + (BILL_STRETCH - 1) * smooth(BILL_Y0, BILL_Y0 - 0.03, v.co.y))
me.update()
FULL = me.copy()                       # the closed generated mesh (legs on), for the far tiers' voxel remesh
# ---- delete the bare legs and feet (keep the thigh stubs), fill the holes ----
def leg_dist(p):
    q = Vector((abs(p.x), p.y, p.z))
    return A.poly_nearest(q, LEG_RAW)[0]
bm = bmesh.new(); bm.from_mesh(me)
dele = [v for v in bm.verts if v.co.z < ZF + 0.08 or (v.co.z < -0.27 and leg_dist(v.co) < 0.045)]
bmesh.ops.delete(bm, geom=dele, context='VERTS')
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
bmesh.ops.delete(bm, geom=[f for n in isl if len(n) < 0.05 * big for f in n], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
# faces on edges shared by more than two faces stall the collapse: delete them and fill the holes
nm = 0
for _ in range(4):
    fs = {f for e in bm.edges if len(e.link_faces) > 2 for f in e.link_faces}
    if not fs: break
    nm += len(fs)
    bmesh.ops.delete(bm, geom=list(fs), context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0); bmesh.ops.triangulate(bm, faces=bm.faces)
print('INFO non-manifold faces removed', nm, 'boundary edges left', sum(1 for e in bm.edges if len(e.link_faces) < 2))
# loose feather flaps and plume strands (open sheets) also stall it: erode open faces a few rings, refill, drop scraps
ner = 0
for _ in range(ERODE):
    fs = [f for f in bm.faces if any(len(e.link_faces) < 2 for e in f.edges)]
    if not fs: break
    ner += len(fs); bmesh.ops.delete(bm, geom=fs, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0); bmesh.ops.triangulate(bm, faces=bm.faces)
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
print('INFO eroded open faces', ner, 'pieces', len(isl), 'boundary edges left', sum(1 for e in bm.edges if len(e.link_faces) < 2), 'faces', len(bm.faces))
print('INFO leg verts deleted', len(dele))
bm.to_mesh(me); bm.free(); me.update()

# ---- to metres: feet on z = 0, origin between the feet ----
S = HEIGHT / (ZT - ZF)
FOOT_Y = LEG_RAW[3].y
def M(p): return Vector((p.x * S, (p.y - FOOT_Y) * S, (p.z - ZF) * S))
def RAW(q): return Vector((q.x / S, q.y / S + FOOT_Y, q.z / S + ZF))
for v in me.vertices: v.co = M(v.co)
for v in FULL.vertices: v.co = M(v.co)
me.update()
V = me.vertices
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())

NECK_N = Vector((0, -(NECK_BACK.z - NECK_FRONT.z), NECK_BACK.y - NECK_FRONT.y)).normalized()   # up the neck, normal to its base
NECK_PIV = M((NECK_FRONT + NECK_BACK) / 2)
TAILP = M(TAIL_RAW)
SHOULDER = M(SHOULDER_RAW)
EYE = M(EYE_RAW)
hit = bvh.ray_cast(Vector((0.3, EYE.y, EYE.z)), Vector((-1, 0, 0)))[0]
EYE_X = hit.x if hit else 0.02
LEGM = [M(p) for p in LEG_RAW]
LEGM[3].z = 0.012
HIP = LEGM[0]
BILL_TIP = min(V, key=lambda v: v.co.y).co.copy()
CROWN_Z = max(v.co.z for v in V)

# ---- rig weights (raw frame tests) ----
def neck_t(r): return (r - (NECK_FRONT + NECK_BACK) / 2).dot(NECK_N)
def head_w(q):
    r = RAW(q)
    if r.y > 0.12: return 0.0
    return smooth(-0.01, 0.035, neck_t(r))
def tail_w(q):
    r = RAW(q)
    return smooth(TAIL_RAW.y - 0.02, TAIL_RAW.y + 0.08, r.y) * smooth(-0.2, -0.3, r.z)
def vert_rig(i):
    p = V[i].co
    hw = head_w(p)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK_PIV)
    tw = tail_w(p)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())

# lod0: two masks for a two-stage collapse (a vertex with weight 1 in the inverted group is not collapsed): first the
# neck and head down to their share with the body frozen, then the body with the neck and head frozen. lod1 and lod2
# start from a voxel remesh: the generated folded-wing feather layers are fused sheets that make the collapse refuse
# further steps at ~650 body triangles (flips); the remesh closes them into one clean surface, which a plain symmetric
# collapse takes down evenly (a masked collapse of it leaves slivers).
def masks(o):
    gn = o.vertex_groups.new(name='neck'); gb = o.vertex_groups.new(name='body'); ns = set()
    for v in o.data.vertices:
        if head_w(v.co) > 0.5: gn.add([v.index], 1.0, 'REPLACE'); ns.add(v.index)
        else: gb.add([v.index], 1.0, 'REPLACE')
    return sum(1 for p in o.data.polygons if all(i in ns for i in p.vertices))
def collapse(o, target, frozen):
    for sym in (True, True, False, False):   # the symmetric collapse can stall short of a small target; finish without it
        n = len(o.data.polygons)
        if n <= target * 1.03: break
        d = o.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = min(1.0, target / n)
        d.use_symmetry = sym; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
        if frozen: d.vertex_group = frozen; d.invert_vertex_group = True; d.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier='dec')
def tier_mesh(target, share, remesh=None):
    o, n0 = A.tier_copy(ob, None)
    for g in list(o.vertex_groups): o.vertex_groups.remove(g)
    if remesh:                         # remesh the closed mesh (an open one remeshes to a hollow double shell), then cut the legs
        o.data = FULL.copy()
        r = o.modifiers.new('rm', 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = remesh; r.adaptivity = 0.0
        bpy.ops.object.modifier_apply(modifier='rm')
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if (v.co.z < 0.08 * S) or (RAW(v.co).z < -0.27 and leg_dist(RAW(v.co)) < 0.045)], context='VERTS')
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
        bmesh.ops.delete(bm, geom=[f for n in isl if len(n) < 0.05 * big for f in n], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0); bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(o.data); bm.free(); o.data.update()
        n0 = len(o.data.polygons)
    if share:                          # the generated mesh: neck and head first, then the body
        nn = masks(o)
        nb = len(o.data.polygons) - nn
        collapse(o, nb + int(target * share), 'body')
        collapse(o, target, 'neck')
    collapse(o, target, None)          # the remeshed far tiers (masked collapse leaves slivers there), or what is left
    A.triangulate(o.data)
    return o, n0

# ---- colour by region (raw frame) ----
def streak(r, k=0.022, frac=0.4): return A.hash01(abs(r.x) // 0.03, r.z // k, r.y // 0.05) < frac
def body_color(c, n):
    """sRGB hex and grizzle for a face with centroid c and normal n (Blender axes, metres)."""
    r = RAW(c); rn = n
    if head_w(c) > 0.5 or (r.z > 0.7 and r.y < 0.05):
        if r.y < BILL_Y0 + 0.005 and r.z > 0.72:                       # bill: dusky along the top
            return (BILLD if rn.z > 0.45 else BILLY), 0.03
        if r.z > EYE_RAW.z - 0.07:                                      # head
            above = r.z > EYE_RAW.z + 0.012
            if above and r.y > EYE_RAW.y - 0.01 and (abs(r.x) > 0.02 or r.y > EYE_RAW.y + 0.09):
                if r.z < EYE_RAW.z + 0.07 or r.y > EYE_RAW.y + 0.13: return BLACK, 0.05   # the stripe to the nape
            return WHITE, 0.03
        if rn.y < -0.35 and abs(rn.x) < 0.75:                           # front of the neck: streaked, the throat white
            if r.z > 0.66: return NECKF, 0.03
            return (BLACK if streak(r) else NECKF), 0.04
        return NECKG, 0.06
    if leg_dist(r) < 0.05 and r.z < -0.07: return THIGH, 0.06           # the feathered thighs
    if r.y < -0.08 and r.z > 0.12 and rn.y < -0.2:                      # lower-neck plumes
        return (SLATE if streak(r, 0.03, 0.18) else PLUMEG), 0.06
    if abs(r.x) > 0.13 and -0.08 < r.y < 0.03 and 0.25 < r.z < 0.38 and abs(rn.x) > 0.3: return CHEST, 0.06   # the bend
    if r.y > 0.22 and r.z < -0.08 and (abs(rn.x) > 0.25 or rn.z > 0): return SLATE, 0.06   # folded primaries
    if rn.z < -0.35 or (r.y < 0.05 and r.z < 0.15 and rn.y < -0.2):     # belly and lower breast, streaked
        return (STREAKW if streak(r, 0.03, 0.2) else BELLY), 0.06
    return BLUEGREY, 0.08
def body_lin(p):
    h, g = body_color(p.center, p.normal)
    return A.grizzle(h, p.center, g, 0.025)

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
            cc = col[i] if isinstance(col, list) else col
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                if radii[i + 1] == 0: self.quad([a, b, pts[i + 1]], cc, rig, (a + b) / 2 - m, tri=True)
                else:
                    self.quad([a, b, d], cc, rig, (a + b + d) / 3 - m, tri=True); self.quad([a, d, c2], cc, rig, (a + d + c2) / 3 - m, tri=True)
    def ellipsoid(self, c, r, col, rig):
        Q = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            for apex in (4, 5): self.quad([Q[a], Q[b], Q[apex]], col, rig, (Q[a] + Q[b] + Q[apex]) / 3 - c, tri=True)

def legs(ex, level):
    sides = [5, 4, 3][level]
    for s in (1, -1):
        mir = lambda p: Vector((s * abs(p.x), p.y, p.z))
        H, E, J, F = (mir(p) for p in LEGM)
        rig = (LEG_A if s > 0 else LEG_B, 1.0, H)
        if level == 2:
            ex.tube([H, E, J, F], [0.02, 0.011, 0.01, 0.008], [THIGH, LEGC, LEGC], rig, sides=3)
            ex.tube([F, F + Vector((0, -0.11, -0.008))], [0.008, 0], LEGC, rig, sides=3)
            continue
        T = E.lerp(J, 0.25)                                              # the thigh feathers end a little below the belly
        ex.tube([H, E, T], [0.024, 0.017, 0.011], THIGH, rig, sides=sides)
        ex.tube([T, J + Vector((0, 0.004, 0)), J, F], [0.0105, 0.012, 0.0095, 0.0075], LEGC, rig, sides=sides)
        toes = [(-0.5, 0.10), (0.0, 0.12), (0.5, 0.10), (math.pi, 0.06)]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.9, -math.cos(ang), 0))
            tip = F + d * ln + Vector((0, 0, -0.008))
            if level == 0: ex.tube([F, F + d * ln * 0.5 + Vector((0, 0, -0.005)), tip], [0.0055, 0.004, 0], LEGC, rig, sides=3)
            else: ex.tube([F, tip], [0.005, 0], LEGC, rig, sides=3)

def plumes(ex, level):
    """Thin black nape plumes from the back of the crown, hanging back; each a crossed pair of blades."""
    if level == 2: return
    rig = (HEAD, 1.0, NECK_PIV)
    base0 = M(Vector((0, EYE_RAW.y + 0.16, EYE_RAW.z + 0.02)))
    for sx, ln, el in ((0.012, 0.13, -22), (-0.012, 0.11, -30))[:2 if level == 0 else 1]:
        base = base0 + Vector((sx * 0.5, 0, 0))
        d = Vector((sx * 1.5, math.cos(math.radians(el)), math.sin(math.radians(el)))).normalized()
        tip = base + d * ln
        w1 = Vector((1, 0, 0)) - d * d.x; w1.normalize(); w2 = d.cross(w1)
        for wv in (w1, w2):
            for out in (wv.cross(d), -wv.cross(d)):
                ex.quad([base + wv * 0.006, tip, base - wv * 0.006], BLACK, rig, out, tri=True)

def wings(ex, level):
    """Flush and flight cards: broad and long, the hand arched down. Arm (pivot at the shoulder) and hand (pivot at
    the wrist); blue-grey coverts and black flight feathers above with the chestnut bend, grey below."""
    W = SHOULDER; ARM = 0.36; HAND = 0.48
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + ARM), W.y, W.z))
        def P(dx, dy):
            t = max(0.0, dx - ARM) / HAND
            return Vector((s * (W.x + dx), W.y + dy, W.z - 0.07 * t * t))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        if level == 2:
            ex.slab([P(0, -0.07), P(ARM, -0.09), P(ARM, 0.22), P(0, 0.24)], CARD_COV, CARD_LIN, arm_rig, 0.003)
            ex.slab([P(ARM, -0.09), P(ARM + 0.30, -0.05), P(ARM + 0.48, 0.08), P(ARM + 0.30, 0.21), P(ARM, 0.22)], CARD_FLT, CARD_FLT_DN, hand_rig, 0.003)
            continue
        # arm: coverts (leading 45%) then the secondaries
        ex.slab([P(0, -0.07), P(ARM, -0.09), P(ARM, 0.05), P(0, 0.06)], CARD_COV, CARD_LIN, arm_rig, 0.003)
        ex.slab([P(0, 0.06), P(ARM, 0.05), P(ARM, 0.22), P(0, 0.24)], CARD_FLT, CARD_FLT_DN, arm_rig, 0.003)
        # chestnut at the bend of the wing (leading edge at the wrist), above and below
        ex.slab([P(ARM - 0.12, -0.087), P(ARM, -0.09), P(ARM, -0.045), P(ARM - 0.12, -0.04)], CHEST, CHEST, arm_rig, 0.0045)
        # hand: grey primary coverts, then the black primaries; a rounded tip
        hc = [P(ARM, -0.09), P(ARM + 0.18, -0.08), P(ARM + 0.30, -0.045), P(ARM + 0.30, 0.0), P(ARM, 0.01)]
        ex.slab(hc, CARD_COV, CARD_LIN, hand_rig, 0.003)
        if level == 0:
            pr = [P(ARM, 0.01), P(ARM + 0.30, 0.0), P(ARM + 0.30, -0.045), P(ARM + 0.40, 0.0), P(ARM + 0.46, 0.06), P(ARM + 0.48, 0.11),
                  P(ARM + 0.44, 0.17), P(ARM + 0.32, 0.205), P(ARM + 0.15, 0.22), P(ARM, 0.22)]
        else:
            pr = [P(ARM, 0.01), P(ARM + 0.30, 0.0), P(ARM + 0.30, -0.045), P(ARM + 0.46, 0.05), P(ARM + 0.46, 0.15), P(ARM + 0.30, 0.21), P(ARM, 0.22)]
        ex.slab(pr, CARD_FLT, CARD_FLT_DN, hand_rig, 0.003)

def eyes(ex):
    for s in (1, -1):
        ex.ellipsoid(Vector((s * (abs(EYE_X) - 0.0015), EYE.y, EYE.z)), Vector((0.004, 0.0055, 0.005)), EYEC, (HEAD, 1.0, NECK_PIV))

# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); legs(ex, level); plumes(ex, level); wings(ex, level)
    if level == 0: eyes(ex)
    o, n0 = tier_mesh(target - len(ex.tris), NECK_SHARE[level], REMESH[level])
    V0 = V; V = o.data.vertices
    out = A.emit(o.data, body_lin, vert_rig)
    nneck = sum(1 for p in o.data.polygons if head_w(p.center) > 0.5)
    V = V0
    nbody = len(out['idx']) // 3
    for a, b, c, h, (pt, w, pv) in ex.tris:
        fc = A.srgb2lin(h)
        for p in (a, b, c):
            out['idx'].append(len(out['pos'])); out['pos'].append(A.to3(p)); out['col'].append(fc)
            out['part'].append(float(pt)); out['partw'].append(float(w)); out['piv'].append(A.to3(pv))
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(mesh {nbody} of which neck and head {nneck}, legs/plumes/wings/eyes {len(ex.tris)})', 'verts', len(out['pos']), 'from', n0)
    return out

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
# length along the body: bill tip, eye, back of the head, down the S of the neck, its base, the body's centre, tail tip
TAIL_TIP = max(V, key=lambda v: v.co.y - v.co.z).co.copy()
spine = [BILL_TIP, EYE, M(Vector((0, -0.08, 0.86))), M(Vector((0, -0.08, 0.66))), M(Vector((0, -0.12, 0.52))), NECK_PIV,
         M(Vector((0, 0.10, 0.10))), TAILP, TAIL_TIP]
LENGTH = sum((spine[i + 1] - spine[i]).length for i in range(len(spine) - 1))
p0 = tiers[0][1]['pos']
ext = [(min(p[k] for p in p0), max(p[k] for p in p0)) for k in range(3)]
print('LANDMARKS feet to crown %.3f m; bill to tail along the body %.3f m (straight %.3f m); wing cards span %.3f m; bill gape to tip %.3f m; '
      'belly exit height %.3f m; neck pivot %s; hip %s; shoulder %s; tail root %s; extent x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f' % (
      CROWN_Z, LENGTH, TAIL_TIP.y - BILL_TIP.y, ext[0][1] - ext[0][0], (M(Vector((0, BILL_Y0, 0))).y - BILL_TIP.y), LEGM[1].z,
      tuple(round(x, 3) for x in A.to3(NECK_PIV)), tuple(round(x, 3) for x in A.to3(HIP)), tuple(round(x, 3) for x in A.to3(SHOULDER)),
      tuple(round(x, 3) for x in A.to3(TAILP)), *ext[0], *ext[1], *ext[2]))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK_PIV)), 'hip': list(A.to3(HIP)),
       'length_m': round(LENGTH, 3), 'height_m': HEIGHT, 'span_m': SPAN}
A.write_glb(OUT, tiers, 'wild-earth tools/build_heron.py (Blender)',
            f'Great blue heron: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (legs replaced, bill lengthened, plumes and wing cards added, recoloured, decimated) by wild-earth tools/build_heron.py',
            extras={'species': SPECIES, 'rig': RIG,
                    'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'latest (meshy-7.1)', 'mode': 'text-to-3d preview',
                               'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                               'meshy_metadata': 'none embedded in the source GLB'}})

if PREVIEW:
    sc = bpy.context.scene
    ob.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 800; sc.render.resolution_y = 800
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
        for view, ctr, d, scale in [('side', (0, 0, 0.55), (1, 0, 0), 1.3), ('front', (0, 0, 0.55), (0, -1, 0.1), 1.3),
                                    ('q', (0, 0, 0.55), (0.8, -0.7, 0.35), 1.4), ('head', (0, -0.15, 0.95), (1, -0.4, 0.1), 0.4)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 6
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
