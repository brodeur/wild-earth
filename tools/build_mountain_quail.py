# Build client/assets/mountain_quail.glb, the ambient mountain quail, from a Meshy text-to-3D preview.
#
# Source: Meshy (meshy.ai) text-to-3D preview, task 01a18176-1a9a-7457-80c0-bfdd555bdf38, ai_model latest (meshy-7.1),
#   triangle remesh to 20,000 faces (20,469 triangles in two pieces, untextured), 2026-10-28 UTC; job record in
#   library/animals/jobs/oreortyx_pictus/01a18176-1a9a-7457-80c0-bfdd555bdf38/job.json. Prompt (the brief's B):
#   "A mountain quail (Oreortyx pictus), a plump round ground bird like a small partridge, NOT a dove, NOT a songbird.
#   One adult walking on the ground, side-on, body low and horizontal, a short thick neck, a very short rounded tail,
#   short legs. Two long thin straight black plumes rising from the crown and leaning back over the nape. About 27 cm
#   long. Slate blue-grey head, nape and breast; a chestnut throat outlined in white; chestnut flanks with bold white
#   vertical bars; olive-brown back and wings; a short stout black bill. Realistic proportions. No base, no rock.
#   Game-ready, clean closed mesh."
#   (The first preview, task 01a18174-6786-74a4-99ea-5760f23a40db from the brief's prompt A, came out a slender dove or
#   thrush: a long neck, a long blade tail, no plumes. Not adopted; its job.json is kept for the ledger.)
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; this file carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_mountain_quail.py -- \
#       library/animals/jobs/oreortyx_pictus/01a18176-1a9a-7457-80c0-bfdd555bdf38/model.glb \
#       client/assets/mountain_quail.glb [--preview /tmp/mquail_preview]
#
# What it does (brief: library/animals/drafts/oreortyx_pictus.md), after tools/build_quail.py: deletes the generated
# plume (a detached island floating over the back) and keeps the body's one piece; makes the bill short and stout (0.65x
# as long, 1.5x as wide at the base); cuts the long thin legs off at the belly and adds short grey procedural legs (three
# forward toes and a small hind toe); deletes the thin blade tail and adds a short rounded fan; tips the body 6 degrees
# nose-down; scales to 0.27 m bill to tail; adds a small dark eye and the two long STRAIGHT plumes (thin tapered quills
# side by side on the crown, leaning 25 degrees back; asserted: tips above and behind their bases), tagged HEAD so they
# nod with it; recolours from the brief's sRGB field marks (slate blue-grey head, nape and breast; a chestnut throat
# bordered by a white line from the gape under the eye down the side of the neck; chestnut flanks with white bars across
# the body; a cinnamon-buff belly; a dark chestnut undertail; olive-brown back, wings and tail with a buff line along the
# folded wing's edge; black plumes and bill; grey legs) with a faint per-face noise (+-4%), and carries a second colour
# set for a female (_COLORB: the nape and hindneck washed brown; the client picks it per bird; her shorter plume is not
# drawn: the plume is one length for both); adds flight wing cards (an arm and a hand per side) that the client collapses
# into the shoulder on the ground. Decimates (Blender collapse, X symmetry) to three tiers: lod0 ~1,000, lod1 ~400,
# lod2 ~120 triangles including legs, plumes, tail fan and wing cards (eyes in lod0 only). Each vertex carries the bird
# rig template's part (animalModels.js PART: BODY, LEG_A/B, TAIL, WING_L/R, HEAD, HAND_L/R), the part's weight and its
# pivot (_PART, _PARTW, _PIVOT); the rig's parent pivots are in extras.rig.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 and _COLORB linear, _PART, _PARTW, _PIVOT, indices).
# --preview <prefix>: renders each tier (male and female; workbench, vertex colour) to <prefix>_*.png.
import bpy, bmesh, sys, json, struct, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
JOB = '01a18176-1a9a-7457-80c0-bfdd555bdf38'
LENGTH = 0.27                          # bill tip to tail tip (m)
PITCH = math.radians(6)                # nose down about the hip: the body carried level
LEGH = 0.036                           # belly feathers to the ground (m)
PLUME_LEN, PLUME_BACK = 0.055, math.radians(25)   # the male's plumes, from the crown; lean back from vertical
TIERS = [('lod0', 1000), ('lod1', 400), ('lod2', 120)]

BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10

def srgb2lin(h):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255))
# brief section 1 (sRGB)
GREY, THROAT, BORDER, FLANK, BAR, BELLY, VENT = 0x5e6a79, 0x76321f, 0xebe7dc, 0x7a3a22, 0xece6d8, 0xb08a64, 0x3c2218
BACK, WEDGE, PLUMEC, BILL, EYEC, LEGC, FNAPE = 0x6a5a43, 0xc8b48e, 0x18161a, 0x1c1c1e, 0x3a1c14, 0x7a7672, 0x6c655c
WINGC, WINGU, TAILC, TAILU = 0x6a5a43, 0xa89878, 0x5f523e, 0x4a3f30

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# ---- load, weld, keep the body ----------------------------------------------------------------------
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
# Raw frame after import: x the bird's left, -y forward (f = -y), +z up; about 1.77 units bill to tail, 1.9 tall.
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.verts.ensure_lookup_table()
# islands: the body is the largest; the generated plume floats apart over the back
seen, islands = set(), []
for v in bm.verts:
    if v.index in seen: continue
    comp, stack = [], [v]; seen.add(v.index)
    while stack:
        a = stack.pop(); comp.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen: seen.add(b.index); stack.append(b)
    islands.append(comp)
islands.sort(key=len, reverse=True)
print('islands', [len(c) for c in islands])
F = lambda v: -v.co.y
dele = {v for c in islands[1:] for v in c}
for v in islands[0]:
    f, z = F(v), v.co.z
    if z < -0.585 and -0.45 < f < 0.7: dele.add(v)              # legs and feet
    elif f < -0.55: dele.add(v)                                 # the thin blade tail
bmesh.ops.delete(bm, geom=list(dele), context='VERTS')
for f in [f for f in bm.faces if all(len(e.link_faces) == 1 for e in f.edges)]: bm.faces.remove(f)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
def neck_t(f, z): return (f - 0.45) * 0.399 + (z - 0.28) * 0.917   # the head plane (head_w below), raw
# The head carried lower and a little forward on a shorter neck (the generator's stands up like a pigeon's): everything
# past the neck's base moves by HD (raw f, z), blended in over the neck. The head's landmarks below are given as the
# generator had them, through hd().
HD = (0.03, -0.07)
def hd(f, z): return f + HD[0], z + HD[1]
for v in bm.verts:
    w = smooth(0.0, 0.14, neck_t(F(v), v.co.z))
    if w > 0: v.co.y -= HD[0] * w; v.co.z += HD[1] * w
B0, B1 = hd(0.74, 0.585)[0], hd(0.88, 0)[0]      # bill base and tip (raw f)
for v in bm.verts:
    f = F(v)
    # bill: short and stout (the generator's is a long thin cone)
    if f > B0 - 0.04:
        if f >= B0:
            t = max(0.0, min(1.0, (f - B0) / (B1 - B0)))
            zc = hd(0, 0.585)[1] - 0.01 * t
            v.co.x *= 1.5 - 0.4 * t; v.co.z = zc + (v.co.z - zc) * (1.15 - 0.1 * t); v.co.y = -(B0 + (f - B0) * 0.65)
        else: v.co.x *= 1 + 0.5 * smooth(B0 - 0.04, B0, f)
bm.to_mesh(me); bm.free(); me.update()
# The generator sculpted the breast and lower flanks as overlapping scale flaps: fins sharing edges and some thirty
# small tunnels under them (Euler characteristic -62), which stop Blender's collapse at ~550-1,100 faces whatever the
# ratio, and a voxel remesh of the self-intersecting surface falls apart. So the body is re-skinned: a UV sphere about
# the body's centre with each vertex pushed out to the outermost surface along its ray (the envelope over the scales;
# star-shaped from the centre, as a quail's body is), held to an ellipsoid where the ray meets the neck or the head;
# and the head and neck are the generator's own (faces past a plane below the neck's base, which overlap into the
# re-skinned body). Two closed pieces, both of which decimate freely.
bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
seen, groups = set(), []                       # faces joined through manifold edges: the fins fall away
for f0 in bm.faces:
    if f0.index in seen: continue
    g, st = [], [f0]; seen.add(f0.index)
    while st:
        f = st.pop(); g.append(f)
        for e in f.edges:
            if len(e.link_faces) != 2: continue
            for f2 in e.link_faces:
                if f2.index not in seen: seen.add(f2.index); st.append(f2)
    groups.append(g)
groups.sort(key=len, reverse=True)
bmesh.ops.delete(bm, geom=[f for g in groups[1:] for f in g], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
src_bvh = BVHTree.FromBMesh(bm)
C = Vector((0.0, -0.08, -0.12)); AX = Vector((0.39, 0.56, 0.47))   # body centre (raw x, y = -f, z) and its ellipsoid
out = bmesh.new()
bmesh.ops.create_uvsphere(out, u_segments=56, v_segments=30, radius=1.0)
held = 0
for v in out.verts:
    d = v.co.normalized()
    re = 1 / math.sqrt((d.x / AX.x) ** 2 + (d.y / AX.y) ** 2 + (d.z / AX.z) ** 2)
    h = src_bvh.ray_cast(C + d * 3, -d)[0]
    r = (h - C).length if h else re
    if not h or neck_t(-h.y, h.z) > -0.02: r = min(r, re * 0.97); held += 1
    v.co = C + d * r
bmesh.ops.triangulate(out, faces=out.faces)
head = [f for f in bm.faces if all(neck_t(-v.co.y, v.co.z) > -0.11 for v in f.verts)]   # deep into the body: the far tiers keep the neck joined
vmap = {}
for f in head:
    vs = []
    for v in f.verts:
        if v not in vmap: vmap[v] = out.verts.new(v.co)
        vs.append(vmap[v])
    try: out.faces.new(vs)
    except ValueError: pass
bm.free()
bmesh.ops.triangulate(out, faces=out.faces)
out.to_mesh(me); out.free(); me.update()
print('re-skinned body', len(me.polygons), 'triangles (head piece', len(head), '; rays held to the ellipsoid', held, ')')

# ---- pitch, scale, to metres (three.js axes) --------------------------------------------------------
HIP = (0.0, -0.57)                     # raw (f, z) between where the legs left the belly
cp, sp = math.cos(PITCH), math.sin(PITCH)
def pitch(f, z):
    df, dz = f - HIP[0], z - HIP[1]
    return HIP[0] + df * cp + dz * sp, HIP[1] - df * sp + dz * cp
def unpitch(f, z):
    df, dz = f - HIP[0], z - HIP[1]
    return HIP[0] + df * cp - dz * sp, HIP[1] + df * sp + dz * cp
FAN_LEN = 0.065                        # tail fan behind the cut (m)
pts = [pitch(-v.co.y, v.co.z) for v in me.vertices]
fmin, fmax = min(p[0] for p in pts), max(p[0] for p in pts)
S = (LENGTH - FAN_LEN * 0.9) / (fmax - fmin)
ZB = min(p[1] for p in pts)            # belly after the pitch
def M(f, z, x=0.0):                    # raw unpitched (f, z) -> three.js metres
    f2, z2 = pitch(f, z); return Vector((x * S, (z2 - ZB) * S + LEGH, f2 * S))
def RAW(p):                            # three.js metres -> raw unpitched (x, f, z)
    f, z = unpitch(p.z / S, (p.y - LEGH) / S + ZB); return p.x / S, f, z
for v, (f2, z2) in zip(me.vertices, pts): v.co = Vector((v.co.x * S, -f2 * S, (z2 - ZB) * S + LEGH))
me.update(); bpy.context.view_layer.update()   # the depsgraph (the BVH below) must see the scaled body
def to3(p): return Vector((p.x, p.z, -p.y))
print('scale', S, 'raw belly', ZB, 'raw f', fmin, fmax)

bvh = BVHTree.FromObject(bird, bpy.context.evaluated_depsgraph_get())
def surface(origin3, dir3):            # ray against the body in three.js frame
    o = Vector((origin3.x, -origin3.z, origin3.y)); d = Vector((dir3.x, -dir3.z, dir3.y))
    h = bvh.ray_cast(o, d)[0]
    return to3(h) if h else None

EYE = M(*hd(0.62, 0.61))
EYE_X = (surface(Vector((0.1, EYE.y, EYE.z)), Vector((-1, 0, 0))) or Vector((0.014, 0, 0))).x
NECK_PIV = M(0.45, 0.28)
SH = M(0.36, 0.15); SHOULDER = Vector((0.03, SH.y, SH.z))
KNEE = M(0.02, -0.52, 0.12); KNEE = Vector((KNEE.x, LEGH + 0.012, KNEE.z))
ANKLE = Vector((KNEE.x + 0.001, 0.0075, KNEE.z + 0.012))
crown = surface(M(hd(0.53, 0)[0], 1.3), Vector((0, -1, 0))) or M(*hd(0.53, 0.71))
PLUME = crown + Vector((0, -0.002, 0))
root = M(-0.53, -0.36); TAIL_PIV = Vector((0, root.y, root.z))
print('eye x', EYE_X, 'plume base', tuple(round(c, 4) for c in PLUME), 'tail root', tuple(round(c, 4) for c in TAIL_PIV))

def head_w(p):
    _, f, z = RAW(p); t = (f - 0.45) * 0.399 + (z - 0.28) * 0.917
    return smooth(0.06, 0.16, t)
def wing_line(f):                      # the folded wing's lower edge (raw z by raw f)
    return -0.22 + 1.2 * max(0.0, f - 0.15)
# The throat's white border: from the gape back under the eye (segment 1), then down behind the cheek to the side of the
# neck (segment 2), raw (f, z) before the head drop. throat_s: signed distance, positive on the throat's side.
TH_G, TH_E, TH_N = hd(0.745, 0.575), hd(0.575, 0.535), hd(0.47, 0.28)
_d2 = Vector((TH_N[0] - TH_E[0], TH_N[1] - TH_E[1])).normalized(); TN2 = Vector((_d2.y, -_d2.x))
if TN2.dot(Vector((0.1, -0.1))) < 0: TN2 = -TN2
def throat_s(f, z):
    if f > TH_E[0]: return TH_E[1] + (f - TH_E[0]) * (TH_G[1] - TH_E[1]) / (TH_G[0] - TH_E[0]) - z
    return TN2.dot(Vector((f - TH_E[0], z - TH_E[1])))

def face_color(c, n):
    """(male, female) sRGB for a body face with centroid c and normal n (three.js frame)."""
    x, f, z = RAW(c); X = abs(x)
    hw = head_w(c)
    if hw > 0.12:
        if f > B0 - 0.005: return BILL, BILL
        s = throat_s(f, z)
        if z > TH_N[1] + 0.05 and f > hd(0.43, 0)[0]:
            if s > 0.018: return THROAT, THROAT                                  # chestnut chin and throat
            if s > -0.018 and z < hd(0, 0.6)[1]: return BORDER, BORDER           # the white line, gape to neck side
        nape = f < hd(0.56, 0)[0] and s < -0.018                                 # behind the eye: the female's brown wash
        return GREY, FNAPE if nape else GREY
    # body
    wl = wing_line(f)
    if (z > wl and f < 0.3) or (n.y > 0.5 and f < 0.34):                         # back, folded wings
        if 0.17 < X < 0.25 and n.y > 0.15 and -0.4 < f < 0.15: return WEDGE, WEDGE   # buff line along the folded wing's edge
        return BACK, BACK
    if f > 0.15 and z > -0.25: return GREY, GREY                                # breast
    if f < -0.33 and z < -0.28 and X < 0.22: return VENT, VENT                  # dark chestnut undertail
    if X < 0.16 and n.y < -0.3 and f < 0.3: return BELLY, BELLY                             # cinnamon-buff belly centre
    if f > 0.3: return GREY, GREY                                               # lower breast, sides of the chest
    # flanks: chestnut crossed by white bars (across the body: by f, a little slanted)
    b = (f * 5.0 + z * 0.8) % 1.0
    return (BAR, BAR) if b < 0.24 else (FLANK, FLANK)
def noise(c):                          # faint per-face brightness noise, deterministic from the centroid
    h = (int(c.x * 9973) * 73856093 ^ int(c.y * 9973) * 19349663 ^ int(c.z * 9973) * 83492791) & 0xffff
    return 1 + 0.08 * (h / 65535 - 0.5)

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
            ex.tube([K, A + Vector((0, -0.007, 0.004))], [0.0032, 0], LEGC, part, 1.0, K); continue
        ex.tube([K, A], [0.0032, 0.0025], LEGC, part, 1.0, K)
        toes = [(-0.45, 0.022), (0.0, 0.026), (0.45, 0.022), (math.pi, 0.008)]
        for ang, ln in toes:
            d = Vector((s * math.sin(ang) * 0.8, 0, math.cos(ang)))
            if level == 0:
                hind = ang > 3
                p1 = A + d * (ln * 0.55) + Vector((0, -0.0045 if not hind else -0.002, 0)); p2 = A + d * ln + Vector((0, -0.0072 if not hind else -0.0035, 0))
                ex.tube([A, p1, p2], [0.0018, 0.0013, 0], LEGC, part, 1.0, K)
            else:
                ex.tube([A, A + d * ln + Vector((0, -0.0068, 0))], [0.0017, 0], LEGC, part, 1.0, K)

def wings(ex, level):
    W = SHOULDER; k = 1.08                     # the California quail's cards, 8 % longer (span ~0.37 m)
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + 0.06 * k), W.y, W.z))
        P = lambda dx, dz: Vector((s * (W.x + dx * k), W.y, W.z + dz * k))
        if level == 2:
            ex.card([P(0, 0.018), P(0.13, 0.006), P(0.15, -0.03), P(0.11, -0.055), P(0, -0.062)], (WINGC, WINGC), (WINGU, WINGU), WING_L if s > 0 else WING_R, piv)
            continue
        ex.card([P(0, 0.018), P(0.06, 0.015), P(0.06, -0.058), P(0, -0.064)], (WINGC, WINGC), (WINGU, WINGU), WING_L if s > 0 else WING_R, piv)
        ex.card([P(0.06, 0.015), P(0.11, 0.01), P(0.145, -0.008), P(0.148, -0.03), P(0.125, -0.052), P(0.06, -0.058)], (WINGC, WINGC), (WINGU, WINGU), HAND_L if s > 0 else HAND_R, wrist)

def plumes(ex, level):
    """The two long straight plumes: thin tapered quills side by side on the crown, leaning back."""
    up = Vector((0, math.cos(PLUME_BACK), -math.sin(PLUME_BACK)))
    sides = [0] if level == 2 else [1, -1]
    for side in sides:
        B = PLUME + Vector((side * 0.0016, 0, 0)); T = B + up * PLUME_LEN + Vector((side * 0.0012, 0, 0))
        assert T.y > B.y and T.z < B.z, 'plumes must stand up and lean back'
        if level == 0: ex.tube([B, B + (T - B) * 0.55, T], [0.0019, 0.0013, 0], (PLUMEC, PLUMEC), HEAD, 1.0, NECK_PIV)
        else: ex.tube([B, T], [0.0024 if level == 2 else 0.0019, 0], (PLUMEC, PLUMEC), HEAD, 1.0, NECK_PIV)

def fan(ex, level):
    """Short rounded tail, drooping 15 degrees, root tucked under the rump."""
    R = TAIL_PIV; dr = math.radians(15)
    back = Vector((0, -math.sin(dr), -math.cos(dr)))
    P = lambda u, v: R + Vector((u, 0, 0)) + back * (v - 0.008)
    L = FAN_LEN + 0.008
    if level == 2: poly = [P(-0.012, 0), P(-0.021, L * 0.95), P(0.021, L * 0.95), P(0.012, 0)]
    elif level == 1: poly = [P(-0.012, 0), P(-0.022, L * 0.66), P(-0.013, L * 0.98), P(0.013, L * 0.98), P(0.022, L * 0.66), P(0.012, 0)]
    else: poly = [P(-0.012, 0), P(-0.021, L * 0.56), P(-0.02, L * 0.84), P(-0.01, L * 0.97), P(0, L), P(0.01, L * 0.97), P(0.02, L * 0.84), P(0.021, L * 0.56), P(0.012, 0)]
    ex.card(poly, (TAILC, TAILC), (TAILU, TAILU), TAIL, R, thick=0.0015)

def eyes(ex):
    for s in (1, -1):
        c = Vector((s * (abs(EYE_X) - 0.0006), EYE.y, EYE.z))
        ex.ellipsoid(c, Vector((0.0018, 0.0026, 0.0028)), (EYEC, EYEC), HEAD, 1.0, NECK_PIV)

# ---- tiers ---------------------------------------------------------------------------------------------
def build(level, target):
    ex = Extra(); legs(ex, level); wings(ex, level); plumes(ex, level); fan(ex, level)
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
        hm, hf = face_color(c, n); k = noise(c)
        fc = tuple(min(1.0, ch * k) for ch in srgb2lin(hm)); fb = tuple(min(1.0, ch * k) for ch in srgb2lin(hf))
        for vi in p.vertices:
            key = (vi, fc, fb)
            if key not in key2i:
                key2i[key] = len(pos); pos.append(P3[vi]); col.append(fc); colb.append(fb)
                pt, w, pv = tag(P3[vi]); part.append(float(pt)); partw.append(w); piv.append(pv)
            idx.append(key2i[key])
    nbody = len(idx) // 3
    for a, b, c, h, pt, w, pv in ex.tris:
        h = h if isinstance(h, tuple) else (h, h)
        fc, fb = srgb2lin(h[0]), srgb2lin(h[1])
        for p in (a, b, c):
            idx.append(len(pos)); pos.append(p); col.append(fc); colb.append(fb); part.append(float(pt)); partw.append(w); piv.append(pv)
    bpy.data.objects.remove(ob)
    print('TIER', level, 'tris', len(idx) // 3, f'(body {nbody}, legs/wings/plumes/tail/eyes {len(ex.tris)})', 'verts', len(pos), 'from', n0)
    return dict(pos=pos, col=col, colb=colb, part=part, partw=partw, piv=piv, idx=idx)

tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
xs = [p for p in tiers[0][1]['pos']]
print('extent m: x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f' % (min(p.x for p in xs), max(p.x for p in xs), min(p.y for p in xs), max(p.y for p in xs), min(p.z for p in xs), max(p.z for p in xs)))
RIG = {'kind': 'bird', 'wing': list(SHOULDER), 'tail': list(TAIL_PIV), 'head': list(NECK_PIV), 'length_m': LENGTH,
       'variant': 'female in _COLORB (the nape washed brown; the plume is drawn at the male length for both)'}

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
gltf = {'asset': {'version': '2.0', 'generator': 'wild-earth tools/build_mountain_quail.py (Blender)',
                  'copyright': f'Mountain quail: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (fixed, recoloured, decimated) by wild-earth tools/build_mountain_quail.py'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}],
        'extras': {'species': 'oreortyx_pictus', 'rig': RIG,
                   'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'latest (meshy-7.1)', 'mode': 'text-to-3d preview', **src_meta,
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
        if key == 'colb' and name != 'lod0': continue
        name = name + ('' if key == 'col' else 'f')
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t[key]): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        for view, ctr, d, scale in [('side', (0, 0, 0.13), (1, 0, 0.0), 0.36), ('top', (0, 0, 0.08), (0.001, 0, 1), 0.4),
                                    ('front', (0, -0.08, 0.1), (0.0, -1, 0.1), 0.26), ('q', (0, -0.02, 0.1), (0.8, -0.7, 0.45), 0.34),
                                    ('head', (0, -0.09, 0.17), (1, -0.4, 0.15), 0.13)]:
            cv = Vector(ctr); cam.data.ortho_scale = scale
            cam.location = cv + Vector(d).normalized() * 3
            cam.rotation_euler = (cv - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = f'{PREVIEW}_{name}_{view}.png'
            bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(po)
