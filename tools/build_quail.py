# Build client/assets/quail.glb, the ambient California quail, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a1719b-a621-7275-a36c-5deb473f01f5, ai_model meshy-6-lite,
#   triangle remesh to 20,000 faces (20,737 triangles, untextured), 2026-10-25 UTC; job record in
#   library/animals/jobs/callipepla_californica/01a1719b-a621-7275-a36c-5deb473f01f5/job.json. Prompt:
#   "A male California quail (Callipepla californica), one bird standing upright with its wings folded against a plump
#   round body. Realistic proportions, about 25 cm long. A black teardrop-shaped topknot plume rising from the forehead
#   and curling forward over the short black bill. Black face and throat outlined in white, white forehead line,
#   chestnut-brown crown, slate blue-grey breast, buff belly with black-edged scaled feathers and a chestnut centre
#   patch, olive-brown back, brown flanks with white streaks, short grey legs. No base, no rock. Game-ready, clean
#   closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_quail.py -- \
#       library/animals/jobs/callipepla_californica/01a1719b-a621-7275-a36c-5deb473f01f5/model.glb \
#       client/assets/quail.glb [--preview /tmp/quail_preview]
#
# What it does (brief: library/animals/drafts/callipepla_californica.md): deletes the generated wire plume and crown
# spikes and adds a procedural topknot, a flattened teardrop on a short stalk whose tip curls forward over the bill
# (asserted: tip ahead of its base); rounds the crown, which the generator pinched into a ridge; makes the bill short
# and stout (0.8x as long, 1.7x as wide at the base); cuts the long thin legs off at the belly and adds short grey
# procedural legs (three forward toes and a small hind toe), which drops the tall upright stance by about a third of
# the leg; deletes the two long tail blades and adds a short rounded fan; tips the body 12 degrees nose-down into the
# forage posture; scales to 0.25 m bill to tail; adds a small dark eye; recolours from the brief's sRGB field marks as
# a male (blue-grey breast, olive-brown back and wings, black face and throat bordered white with the white forehead
# line, chestnut-brown crown, buff belly scaled black with the chestnut patch, brown flanks streaked white, grey legs)
# and carries a second colour set for a female (_COLORB: grey-brown head and breast without the face pattern, no
# belly patch, a brown-black plume) that the client picks per bird; adds flight wing cards (an arm and a hand per side)
# that the client collapses into the shoulder on the ground. Decimates (Blender collapse, X symmetry) to three tiers:
# lod0 ~1,000, lod1 ~400, lod2 ~120 triangles including legs, plume, tail fan and wing cards (eyes in lod0 only).
# Each vertex carries the bird rig template's part (animalModels.js PART: BODY, LEG_A/B, TAIL, WING_L/R, HEAD,
# HAND_L/R), the part's weight and its pivot (_PART, _PARTW, _PIVOT); the rig's parent pivots are in extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (male and female; workbench, vertex colour) to <prefix>_*.png.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a1719b-a621-7275-a36c-5deb473f01f5'
LENGTH = 0.25                          # bill tip to tail tip (m)
PITCH = math.radians(12)               # forage posture: nose down about the hip
LEGH = 0.030                           # belly feathers to the ground (m)
TIERS = [('lod0', 1000), ('lod1', 400), ('lod2', 120)]

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# brief section 1 (sRGB). Male, then the female's head and breast. The belly scaling is a face-sized mottle of
# black-edged feathers, drawn lighter than the brief's #2a2420 so a dark face does not read as a hole.
BREAST, BACK, BELLY, SCALE, PATCH, FACE, BORDER, CROWN = 0x5f6874, 0x6f604f, 0xc9b48c, 0x4a3c2e, 0x8a4a2a, 0x18181a, 0xece8dc, 0x6b4a32
STREAK, FLANK, LEGC, BILL, NAPE, WINGC, WINGU, TAILC, TAILU = 0xe8e2d4, 0x6a5a48, 0x5e5852, 0x1c1c1e, 0x5d5c5c, 0x7a6853, 0xb7a58b, 0x5e5a52, 0x4a4640
FHEAD, FCROWN, FPLUME, EYEC = 0x7a6e60, 0x6b5f52, 0x3a3028, 0x0d0d0f

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# ---- load and weld --------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
obs = [o for o in sc.objects if o.type == 'MESH']
src_meta = {'generator': 'Khronos glTF Blender I/O (Meshy export)', 'mesh': obs[0].name}
bpy.ops.object.select_all(action='DESELECT')
for o in obs: o.select_set(True)
bpy.context.view_layer.objects.active = obs[0]
if len(obs) > 1: bpy.ops.object.join()
bird = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = bird.data
# Raw frame after import: x the bird's left, -y forward (f = -y), +z up; about 1.9 units tall and long.
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
F = lambda v: -v.co.y
dele = set()
for v in bm.verts:
    f, z = F(v), v.co.z
    if z > 0.875 and f > 0.4: dele.add(v)                       # wire plume and crown spikes
    elif z < -0.578 and -0.45 < f < 0.5: dele.add(v)            # legs and feet
    elif f < -0.60: dele.add(v)                                 # the two long tail blades
bmesh.ops.delete(bm, geom=list(dele), context='VERTS')
# stray single triangles
for f in [f for f in bm.faces if all(len(e.link_faces) == 1 for e in f.edges)]: bm.faces.remove(f)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
for v in bm.verts:
    f, z = F(v), v.co.z
    # crown: the generator pinched it into a ridge; widen the top of the head and lower it a little
    if f > 0.3 and z > 0.6:
        t = smooth(0.6, 0.875, z); v.co.x *= 1 + 0.6 * t; v.co.z = 0.6 + (z - 0.6) * (1 - 0.25 * t)
    # bill: short and stout
    if f > 0.79:
        t = max(0.0, min(1.0, (f - 0.83) / (0.945 - 0.83)))
        if f >= 0.83:
            zc = 0.61 - 0.015 * t
            v.co.x *= 1.7 - 0.5 * t; v.co.z = zc + (v.co.z - zc) * (1.15 - 0.1 * t); v.co.y = -(0.83 + (f - 0.83) * 0.8)
        else: v.co.x *= 1 + 0.7 * smooth(0.79, 0.83, f)
bm.to_mesh(me); bm.free(); me.update()

# ---- pitch, scale, to metres (three.js axes) --------------------------------------------------------
HIP = (-0.11, -0.56)                   # raw (f, z) where the legs left the belly
cp, sp = math.cos(PITCH), math.sin(PITCH)
def pitch(f, z):
    df, dz = f - HIP[0], z - HIP[1]
    return HIP[0] + df * cp + dz * sp, HIP[1] - df * sp + dz * cp
def unpitch(f, z):
    df, dz = f - HIP[0], z - HIP[1]
    return HIP[0] + df * cp - dz * sp, HIP[1] + df * sp + dz * cp
FAN_LEN = 0.05                         # tail fan behind the cut (m)
pts = [pitch(-v.co.y, v.co.z) for v in me.vertices]
fmin, fmax = min(p[0] for p in pts), max(p[0] for p in pts)
S = (LENGTH - FAN_LEN * 0.9) / (fmax - fmin)
ZB = min(p[1] for p in pts)            # belly after the pitch
def M(f, z, x=0.0):                    # raw unpitched (f, z) -> three.js metres
    f2, z2 = pitch(f, z); return Vector((x * S, (z2 - ZB) * S + LEGH, f2 * S))
def RAW(p):                            # three.js metres -> raw unpitched (x, f, z)
    f, z = unpitch(p.z / S, (p.y - LEGH) / S + ZB); return p.x / S, f, z
for v, (f2, z2) in zip(me.vertices, pts): v.co = Vector((v.co.x * S, -f2 * S, (z2 - ZB) * S + LEGH))
def to3(p): return Vector((p.x, p.z, -p.y))
print('scale', S, 'raw belly', ZB)

bvh = BVHTree.FromObject(bird, bpy.context.evaluated_depsgraph_get())
def surface(origin3, dir3):            # ray against the body in three.js frame
    o = Vector((origin3.x, -origin3.z, origin3.y)); d = Vector((dir3.x, -dir3.z, dir3.y))
    h = bvh.ray_cast(o, d)[0]
    return to3(h) if h else None

EYE = M(0.72, 0.615)
EYE_X = (surface(Vector((0.1, EYE.y, EYE.z)), Vector((-1, 0, 0))) or Vector((0.012, 0, 0))).x
NECK_PIV = M(0.45, 0.30)
SH = M(0.40, 0.20); SHOULDER = Vector((0.026, SH.y, SH.z))
KNEE = M(-0.11, -0.50, 0.135); KNEE = Vector((KNEE.x, LEGH + 0.010, KNEE.z))
ANKLE = Vector((KNEE.x + 0.001, 0.0065, KNEE.z + 0.012))
crown = surface(M(0.70, 1.2), Vector((0, -1, 0))) or M(0.70, 0.80)
PLUME = crown + Vector((0, -0.0015, 0))
root = M(-0.585, -0.36); TAIL_PIV = Vector((0, root.y, root.z))
print('eye x', EYE_X, 'plume base', tuple(round(c, 4) for c in PLUME), 'tail root', tuple(round(c, 4) for c in TAIL_PIV))

def head_w(p):
    _, f, z = RAW(p); t = (f - 0.45) * 0.399 + (z - 0.30) * 0.917
    return smooth(0.06, 0.16, t)
def wing_line(f):
    return -0.2 + (0.75 * (f - 0.025) if f > 0.025 else 0.19 * (f - 0.025))

def face_color(c, n):
    """(male, female) sRGB for a body face with centroid c and normal n (three.js frame)."""
    x, f, z = RAW(c); X = abs(x)
    hw = head_w(c)
    ef, ez = 0.72, 0.615
    if hw > 0.12:
        if f > 0.815: return BILL, BILL
        # the face border: a white line from the forehead over the eye and down behind the cheek to the throat
        line = (z > ez + 0.035 and z < ez + 0.085 and f > 0.50) or (0.465 < f < 0.52 and 0.42 < z < ez + 0.085)
        inside = f > 0.5 and z < ez + 0.035 and z > 0.40
        crownz = z >= ez + 0.085 or (f <= 0.44)
        fem = FCROWN if crownz else FHEAD
        if inside and not line: return FACE, fem
        if line and X > 0.06: return BORDER, fem
        if f > 0.76 and z > ez + 0.02: return BORDER, fem     # white forehead line above the bill
        if f < 0.47 and z < ez: return NAPE, FHEAD
        return CROWN, fem
    # body
    wl = wing_line(f)
    if z > wl and f < 0.45 and (X > 0.15 or n.y > 0.3):
        return BACK, BACK
    if n.y > 0.35: return BACK, BACK
    if f > 0.25 and z > -0.25: return BREAST, FHEAD                                   # breast
    if z < -0.25 and X < 0.3 and (n.y < -0.2 or f > 0.2):                              # belly, scaled
        h = (int(c.x * 2600) * 7 + int(c.z * 2600) * 13 + int(c.y * 2600) * 3) % 9
        if X < 0.13 and 0.05 < f < 0.45 and z < -0.32: return PATCH if h > 1 else SCALE, BELLY if h > 1 else SCALE
        return (SCALE, SCALE) if h < 2 else (BELLY, BELLY)
    # flanks: brown with white streaks running back and down
    s = (z * 9 + f * 3.0) % 1.0
    return (STREAK, STREAK) if s < 0.22 else (FLANK, FLANK)
class Extra:
    def __init__(self): self.tris = []        # (p0, p1, p2, colour hex, part, weight, pivot)
    def tri(self, a, b, c, col, part, w, piv, away=None):
        a, b, c = Vector(a), Vector(b), Vector(c)
        if away is not None and (b - a).cross(c - a).dot((a + b + c) / 3 - away) < 0: b, c = c, b   # face away from `away`
        self.tris.append((a, b, c, col, part, w, Vector(piv)))
    def tube(self, pts, radii, col, part, w, piv, sides=3, cap=True):
        """Tapered tube along pts; the last radius may be 0 (a point)."""
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = t.cross(a).normalized(); v = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        for i in range(len(pts) - 1):
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                m = (pts[i] + pts[i + 1]) / 2
                if radii[i + 1] == 0: self.tri(a, b, pts[i + 1], col, part, w, piv, m)
                else: self.tri(a, b, d, col, part, w, piv, m); self.tri(a, d, c2, col, part, w, piv, m)
    def card(self, poly, col_top, col_bot, part, piv, thick=0.0012):
        """A flat polygon (list of three.js points, wound so its normal is +y when seen from above), two-sided."""
        n = len(poly); off = Vector((0, thick, 0))
        for i in range(1, n - 1):
            c = (poly[0] + poly[i] + poly[i + 1]) / 3
            self.tri(poly[0] + off, poly[i] + off, poly[i + 1] + off, col_top, part, 1.0, piv, c - Vector((0, 1, 0)))
            self.tri(poly[0], poly[i], poly[i + 1], col_bot, part, 1.0, piv, c + Vector((0, 1, 0)))
    def ellipsoid(self, c, r, col, part, w, piv):
        """An octahedron (8 triangles) scaled to radii r."""
        P = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            self.tri(P[a], P[b], P[4], col, part, w, piv, c); self.tri(P[b], P[a], P[5], col, part, w, piv, c)


def legs(ex, level):
    for s in (1, -1):
        part = LEG_A if s > 0 else LEG_B
        K = Vector((s * abs(KNEE.x), KNEE.y, KNEE.z)); A = Vector((s * abs(ANKLE.x), ANKLE.y, ANKLE.z))
        if level == 2:
            ex.tube([K, A + Vector((0, -0.006, 0.004))], [0.0028, 0], LEGC, part, 1.0, K); continue
        ex.tube([K, A], [0.0028, 0.0022], LEGC, part, 1.0, K)
        toes = [(-0.45, 0.019), (0.0, 0.023), (0.45, 0.019), (math.pi, 0.007)]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.8, 0, math.cos(ang)))
            if level == 0:
                hind = ang > 3
                p1 = A + d * (ln * 0.55) + Vector((0, -0.004 if not hind else -0.002, 0)); p2 = A + d * ln + Vector((0, -0.0062 if not hind else -0.003, 0))
                ex.tube([A, p1, p2], [0.0016, 0.0012, 0], LEGC, part, 1.0, K)
            else:
                ex.tube([A, A + d * ln + Vector((0, -0.0058, 0))], [0.0015, 0], LEGC, part, 1.0, K)

def wings(ex, level):
    W = SHOULDER
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + 0.06), W.y, W.z))
        P = lambda dx, dz: Vector((s * (W.x + dx), W.y, W.z + dz))
        if level == 2:
            ex.card([P(0, 0.018), P(0.13, 0.006), P(0.15, -0.03), P(0.11, -0.055), P(0, -0.062)], (WINGC, WINGC), (WINGU, WINGU), WING_L if s > 0 else WING_R, piv)
            continue
        ex.card([P(0, 0.018), P(0.06, 0.015), P(0.06, -0.058), P(0, -0.064)], (WINGC, WINGC), (WINGU, WINGU), WING_L if s > 0 else WING_R, piv)
        ex.card([P(0.06, 0.015), P(0.11, 0.01), P(0.145, -0.008), P(0.148, -0.03), P(0.125, -0.052), P(0.06, -0.058)], (WINGC, WINGC), (WINGU, WINGU), HAND_L if s > 0 else HAND_R, wrist)

def plume(ex, level):
    """The topknot: a flattened teardrop on a short stalk in the bird's mid plane, tip forward and down."""
    B = PLUME
    P = lambda dz, dy: Vector((0, B.y + dy, B.z + dz))
    tip = P(0.019, 0.0145)
    assert tip.z > B.z, 'topknot must curl forward'
    if level == 2: drop = [P(-0.002, 0.0), P(0.004, 0.025), tip]
    elif level == 1: drop = [P(-0.002, 0.0), P(-0.001, 0.019), P(0.008, 0.026), P(0.017, 0.021), tip, P(0.0015, 0.0)]
    else: drop = [P(-0.0015, 0.0), P(-0.0018, 0.011), P(-0.001, 0.018), P(0.004, 0.024), P(0.011, 0.0255), P(0.017, 0.0215), tip, P(0.0115, 0.017), P(0.0035, 0.012), P(0.0015, 0.0)]
    for side in (1, -1):
        off = Vector((side * 0.0007, 0, 0))
        c0 = sum(drop, Vector()) / len(drop)
        if level == 0:   # stalk quad, then a fan over the drop from its centre
            stalk = [drop[0], drop[1], drop[8], drop[9]]; body = drop[1:9]
            cc = sum(body, Vector()) / len(body)
            ex.tri(stalk[0] + off, stalk[1] + off, stalk[2] + off, (FACE, FPLUME), HEAD, 1.0, NECK_PIV, off * -10 + stalk[0])
            ex.tri(stalk[0] + off, stalk[2] + off, stalk[3] + off, (FACE, FPLUME), HEAD, 1.0, NECK_PIV, off * -10 + stalk[0])
            for i in range(len(body)):
                a, b = body[i], body[(i + 1) % len(body)]
                ex.tri(cc + off, a + off, b + off, (FACE, FPLUME), HEAD, 1.0, NECK_PIV, cc - off * 10)
        else:
            for i in range(1, len(drop) - 1):
                ex.tri(drop[0] + off, drop[i] + off, drop[i + 1] + off, (FACE, FPLUME), HEAD, 1.0, NECK_PIV, c0 - off * 10)

def fan(ex, level):
    """Short rounded tail, drooping 15 degrees, root tucked under the rump."""
    R = TAIL_PIV; dr = math.radians(15)
    back = Vector((0, -math.sin(dr), -math.cos(dr)))
    P = lambda u, v: R + Vector((u, 0, 0)) + back * (v - 0.008)
    if level == 2: poly = [P(-0.011, 0), P(-0.019, 0.05), P(0.019, 0.05), P(0.011, 0)]
    elif level == 1: poly = [P(-0.011, 0), P(-0.02, 0.035), P(-0.012, 0.052), P(0.012, 0.052), P(0.02, 0.035), P(0.011, 0)]
    else: poly = [P(-0.011, 0), P(-0.019, 0.03), P(-0.018, 0.045), P(-0.009, 0.052), P(0, 0.054), P(0.009, 0.052), P(0.018, 0.045), P(0.019, 0.03), P(0.011, 0)]
    ex.card(poly, (TAILC, TAILC), (TAILU, TAILU), TAIL, R, thick=0.0015)

def eyes(ex):
    for s in (1, -1):
        c = Vector((s * (abs(EYE_X) - 0.0006), EYE.y, EYE.z))
        ex.ellipsoid(c, Vector((0.0016, 0.0024, 0.0026)), (EYEC, EYEC), HEAD, 1.0, NECK_PIV)

# ---- tiers ---------------------------------------------------------------------------------------------
def build(level, target):
    ex = Extra(); legs(ex, level); wings(ex, level); plume(ex, level); fan(ex, level)
    if level == 0: eyes(ex)
    body_target = target - len(ex.tris)
    ob = bird.copy(); ob.data = bird.data.copy(); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    m = ob.data; n0 = len(m.polygons)
    d = ob.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = body_target / n0
    d.use_symmetry = True; d.symmetry_axis = 'X'; d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(m); bm.free(); m.update()
    pos = []; col = []; colb = []; part = []; partw = []; piv = []; idx = []; key2i = {}
    P3 = [to3(v.co) for v in m.vertices]
    def tag(p):
        hw = head_w(p)
        if hw > 0: return HEAD, hw, NECK_PIV
        return BODY, 0.0, Vector()
    for p in m.polygons:
        c = sum((P3[i] for i in p.vertices), Vector()) / 3
        nb = p.normal; n = Vector((nb.x, nb.z, -nb.y))
        hm, hf = face_color(c, n); fc, fb = srgb2lin(hm), srgb2lin(hf)
        for vi in p.vertices:
            k = (vi, fc, fb)
            if k not in key2i:
                key2i[k] = len(pos); pos.append(P3[vi]); col.append(fc); colb.append(fb)
                pt, w, pv = tag(P3[vi]); part.append(float(pt)); partw.append(w); piv.append(pv)
            idx.append(key2i[k])
    nbody = len(idx) // 3
    for a, b, c, h, pt, w, pv in ex.tris:
        h = h if isinstance(h, tuple) else (h, h)
        fc, fb = srgb2lin(h[0]), srgb2lin(h[1])
        for p in (a, b, c):
            idx.append(len(pos)); pos.append(p); col.append(fc); colb.append(fb); part.append(float(pt)); partw.append(w); piv.append(pv)
    bpy.data.objects.remove(ob)
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, legs/wings/plume/tail/eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
RIG = {'kind': 'bird', 'wing': list(SHOULDER), 'tail': list(TAIL_PIV), 'head': list(NECK_PIV), 'length_m': LENGTH, 'variant': 'female in _COLORB'}

# ---- minimal GLB writer: one buffer, one mesh per tier, custom attributes _PART, _PARTW, _PIVOT ----
buf = bytearray(); views = []; accs = []
def add(data_bytes, target=None):
    while len(buf) % 4: buf.append(0)
    off = len(buf); buf.extend(data_bytes)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data_bytes)}
    if target: v['target'] = target
    views.append(v); return len(views) - 1
def acc_f(vals, n):
    flat = [x for v in vals for x in (v[:] if n > 1 else [v])]
    a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3'}[n]}
    if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
    accs.append(a); return len(accs) - 1
def acc_i(vals):
    big = max(vals) > 65535
    accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
    return len(accs) - 1
meshes = []; nodes = []
for name, t in tiers:
    attrs = {'POSITION': acc_f([tuple(p) for p in t['pos']], 3), 'COLOR_0': acc_f(t['col'], 3),
             '_PART': acc_f(t['part'], 1), '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f([tuple(p) for p in t['piv']], 3), '_COLORB': acc_f(t['colb'], 3)}
    meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
    nodes.append({'name': name, 'mesh': len(meshes) - 1})
while len(buf) % 4: buf.append(0)
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_quail.py (Blender)',
                  'copyright': f'California quail: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (fixed, recoloured, decimated) by wild-earth tools/build_quail.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'rig': RIG, 'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview', **src_meta,
                                          'ai_generated': True, 'meshy_metadata': 'none embedded in the source GLB'}}}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
open(OUT, 'wb').write(glb)
print('WROTE', OUT, len(glb))

# ---- optional preview: each tier with its vertex colours, workbench ----
if PREVIEW:
    bird.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 900; sc.render.resolution_y = 600
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    for (name, t), key in [(nt, k) for nt in tiers for k in ('col', 'colb')]:
        name = name + ('' if key == 'col' else 'f')
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t[key]): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, scale in [('side', (0, 0, 0.1), (1, 0, 0.0), 0.32), ('top', (0, 0, 0.08), (0.001, 0, 1), 0.38),
                                    ('front', (0, -0.08, 0.1), (0.0, -1, 0.1), 0.24), ('q', (0, -0.02, 0.1), (0.8, -0.7, 0.45), 0.32),
                                    ('head', (0, -0.08, 0.15), (1, -0.4, 0.15), 0.11)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 3
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
