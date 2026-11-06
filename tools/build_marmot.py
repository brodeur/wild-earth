# Build client/assets/marmot.glb, the Olympic marmot (Marmota olympus) of the Olympic Mountains' subalpine meadows, from
# a Meshy text-to-3D preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model meshy-6-lite, triangle remesh to 20,000 faces
#   (untextured), task 01a1ae8c-9bb0-776b-bbdb-68618e5863e6, run by agent (Claude) for Aaron Brodeur on 2026-11-06 01:49
#   UTC (the 2026-11-05 batch, US evening), 5 credits; record in
#   library/animals/jobs/marmota_olympus/01a1ae8c-9bb0-776b-bbdb-68618e5863e6/job.json. Prompt: "An Olympic marmot
#   (Marmota olympus), a large heavy ground squirrel, NOT a beaver, NOT a groundhog cartoon. One adult standing on all
#   four short legs, side-on neutral pose, legs with clear gaps, head level. Realistic proportions: 70 cm long including
#   a bushy 20 cm tail held out behind, a broad heavy body, a broad blunt head with small round ears, short strong legs
#   with dark claws. Brown fur grizzled with pale tips, a white muzzle and a white band in front of the eyes, a darker
#   crown. No base, no ground. Game-ready, clean closed mesh."
# Licence: paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2,
#   https://www.meshy.ai/terms-of-use, last updated 2026-09-19), released with the project's assets under CC BY-SA 4.0.
#   Credit: "generated with Meshy (meshy.ai)". Terms 2.4: no Meshy metadata in the source GLB to carry over
#   (asset.generator only, recorded in extras.source).
#
# Rebuild (Blender 4.1; from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_marmot.py -- \
#       library/animals/jobs/marmota_olympus/01a1ae8c-9bb0-776b-bbdb-68618e5863e6/model.glb client/assets/marmot.glb
#
# What it does (tools/build_ground_squirrel.py's pipeline and rig on a new mesh): drops the modelled whisker strands
# (thin pieces found by an inward ray cast round the muzzle); removes the generated tail (it hangs from the rump down to
# the ground) and lofts a new one from the same root: 0.20 m, bushy and a little flattened (1.3 times wider than deep),
# held out behind and curving gently down, with a lumpy outline; scales head and body to 0.50 m (0.70 m with the tail),
# origin on the ground between the feet; the broad heavy body on short legs is the generator's own. Adds a small dark eye
# each side (lod0). Recolours by region (sRGB, field guides): brown fur grizzled with pale buff tips (a hash of the face
# position, so every tier grizzles alike) and darker flecks, a darker brown crown, face and nape, a white muzzle and
# chin, a white band across the face in front of the eyes, small dark-brown ears, a pale buff-brown belly and inner
# legs, dark brown feet, a dark nose; the tail brown, grizzled, with a darker tip. Decimates (collapse, X symmetry) to
# lod0 ~1,800, lod1 ~600, lod2 ~180 triangles (the tail about a seventh; eyes on lod0 only). Rig: the rodent template
# (animalModels.js), exactly as ground_squirrel.glb (the client drives it with the ground squirrel's colony behaviour and
# sentinel sit-up): BODY 0 hindquarters, CHEST 7 (pivot at the lumbar: flexes with the bound, rises to sit up), HEAD 6
# (pivot at the base of the neck) and LEG_A 1 (fore pair, elbows) children of the chest, LEG_B 2 (hind pair, stifles),
# TAIL 3 and TAIL_TIP 8 (child of the tail); parent pivots in extras.rig (the ground squirrel's keys: kind, chest, tail,
# tail_tip, head, fore, hind, length_m).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
JOB = '01a1ae8c-9bb0-776b-bbdb-68618e5863e6'
SPECIES = 'marmota_olympus'
HEADBODY = 0.50                        # nose to rump (m)
TAIL_LEN = 0.20                        # tail along its axis (m)
HEAD_RAISE = math.radians(0)
TIERS = [('lod0', 1800, 10, 12), ('lod1', 600, 6, 7), ('lod2', 180, 4, 4)]   # name, triangles, tail sides, tail rings

BODY, LEG_A, LEG_B, TAIL, HEAD, CHEST, TAIL_TIP = 0, 1, 2, 3, 6, 7, 8

# Olympic marmot (sRGB): BACK the grizzled brown, BUFF its pale tips, DUSKY the dark flecks, CROWN the darker crown,
# face and nape, WHITE the muzzle, chin and the band in front of the eyes
BACK, BUFF, DUSKY, CROWN, WHITE, BELLY = 0x6e5640, 0xc9b28c, 0x3e3024, 0x45352a, 0xe6e2d8, 0xb3a084
EYEC, NOSE, EARC, FEET = 0x0e0c0c, 0x2a2220, 0x4a3a2e, 0x2e2620
T_CORE, T_DARK, T_FRINGE = 0x5c4634, 0x2e241c, 0x8c765c

smooth = A.smooth

# ---- load, clean -------------------------------------------------------------------------------------------
# Raw frame (Blender axes after import): +x the squirrel's left, -y forward (f = -y), +z up; about 1.9 units long.
ob = A.import_glb_mesh(SRC, keep_fraction=0.01)
sc = bpy.context.scene
src_meta = {'generator': 'Meshy export (glTF)', 'mesh': ob.name}
F = lambda co: -co.y
# whiskers (head, outside the ears) and fur shards on the neck, chest and flanks (not the feet: toes are thin too)
# the whisker strands round the muzzle and the fur tufts on the cheeks (not the ears)
A.drop_thin(ob, 0.015, region=lambda co: F(co) > 0.52 and not (co.z > 0.36 and 0.55 < F(co) < 0.71))
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
# tail: it hangs from the rump to the ground; everything behind the rump seam (the hind feet end well ahead of it)
TAIL_F, TAIL_Z = -0.665, -0.30
dele = [v for v in bm.verts if F(v.co) < TAIL_F and v.co.z > TAIL_Z]
dele += [v for v in bm.verts if F(v.co) < TAIL_F - 0.05]
print('INFO tail vertices', len(set(dele)), 'of', len(bm.verts))
bmesh.ops.delete(bm, geom=list(set(dele)), context='VERTS')
# loose bits left by the cut
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
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
patch = [v for v in bm.verts if F(v.co) < TAIL_F + 0.05]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=patch, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# alert: raise the head about the base of the neck
NECK_RAW = Vector((0, -0.58, 0.15))
R = Matrix.Rotation(-HEAD_RAISE, 3, 'X')         # nose (-y) up
for v in bm.verts:
    t = smooth(0.52, 0.64, F(v.co))
    if t > 0 and HEAD_RAISE:
        q = R @ (v.co - NECK_RAW) + NECK_RAW
        v.co = v.co.lerp(q, t)
bm.to_mesh(me); bm.free(); me.update()

# ---- to metres, origin between the feet, ground at z = 0 (Blender axes, forward -y) -------------------------------
V = me.vertices
nose_f = max(F(v.co) for v in V)
rump_f = min(F(v.co) for v in V if v.co.z > -0.30 and abs(v.co.x) < 0.10)
S = HEADBODY / (nose_f - rump_f)
GROUND = min(v.co.z for v in V)
low = [v.co for v in V if v.co.z < GROUND + 0.03]
F_ORG = (max(F(c) for c in low) + min(F(c) for c in low)) / 2
def M(f, z, x=0.0): return Vector((x * S, -(f - F_ORG) * S, (z - GROUND) * S))
def RAW(p): return p.x / S, -p.y / S + F_ORG, p.z / S + GROUND          # Blender metres -> raw (x, f, z)
for v in V: v.co = M(F(v.co), v.co.z, v.co.x)
me.update()
print('INFO scale', round(S, 5), 'ground', round(GROUND, 4), 'nose f', round(nose_f, 3), 'rump f', round(rump_f, 3), 'origin f', round(F_ORG, 3))
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())

# ---- landmarks ---------------------------------------------------------------------------------------------
EYE_F, EYE_Z = 0.775, 0.36
eye_c = M(EYE_F, EYE_Z)
hit = bvh.ray_cast(Vector((0.3, eye_c.y, eye_c.z)), Vector((-1, 0, 0)))
EYE = hit[0] if hit[0] is not None else Vector((0.05, eye_c.y, eye_c.z))
EYE_N = hit[1] if hit[0] is not None else Vector((1, 0, 0))
NECK_PIV = M(0.58, 0.15)
def section(fmin, fmax, zlo, zhi, side):
    pts = [v.co for v in V if fmin < RAW(v.co)[1] < fmax and zlo < RAW(v.co)[2] < zhi and RAW(v.co)[0] * side > LEG_X]
    c = sum(pts, Vector()) / max(1, len(pts)); return c, len(pts)
FORE_Z, HIND_Z, LEG_X = -0.30, -0.30, 0.13           # raw: the legs below these heights, outside the belly's middle
FORE_F, HIND_F = (0.18, 0.58), (-0.50, -0.02)
FORE_PIV, nf = section(*FORE_F, FORE_Z - 0.03, FORE_Z, 1); FORE_PIV.z = (FORE_Z - GROUND) * S
HIND_PIV, nh = section(*HIND_F, HIND_Z - 0.03, HIND_Z, 1); HIND_PIV.z = (HIND_Z - GROUND) * S
# lumbar: about a third of the body forward of the rump, at mid-height of the body there
LUMBAR_F = -0.14
sect = [v.co.z for v in V if abs(v.co.x) < 0.006 and abs(RAW(v.co)[1] - LUMBAR_F) < 0.02]
CHEST_PIV = Vector((0, -(LUMBAR_F - F_ORG) * S, (max(sect) + min(sect)) / 2))
TAIL_ROOT = M(-0.64, 0.03)
print('INFO eye', [round(x, 4) for x in EYE], 'fore', [round(x, 4) for x in FORE_PIV], nf, 'hind', [round(x, 4) for x in HIND_PIV], nh,
      'chest', [round(x, 4) for x in CHEST_PIV], 'neck', [round(x, 4) for x in NECK_PIV], 'tail', [round(x, 4) for x in TAIL_ROOT])

def head_w(p):
    _, f, z = RAW(p); t = (f - 0.58) * 0.85 + (z - 0.15) * 0.5
    return smooth(0.02, 0.10, t)
def chest_w(p): return smooth(LUMBAR_F - 0.06, LUMBAR_F + 0.10, RAW(p)[1])
def fore_w(p):
    x, f, z = RAW(p)
    if not FORE_F[0] < f < FORE_F[1] + 0.05: return 0.0
    return smooth(FORE_Z + 0.03, FORE_Z - 0.03, z) * smooth(LEG_X - 0.05, LEG_X, abs(x))
def hind_w(p):
    x, f, z = RAW(p)
    if not HIND_F[0] - 0.04 < f < HIND_F[1]: return 0.0
    return smooth(HIND_Z + 0.03, HIND_Z - 0.03, z) * smooth(LEG_X - 0.05, LEG_X, abs(x))

# ---- colour --------------------------------------------------------------------------------------------------
def fleck(c, base, buff=0.30, dusky=0.14, cell=0.012):
    """Grizzle: pale buff tips and dark flecks by a hash of the face position (symmetric in x)."""
    h = A.hash01(abs(c.x) // cell, c.y // cell, c.z // cell)
    if h < buff: return A.mix(base, BUFF, 0.42)
    if h < buff + dusky: return A.mix(base, DUSKY, 0.4)
    return base
def face_color(c, n, eye_faces=(), fi=None):
    """c: face centre (Blender metres), n: face normal (Blender). Returns sRGB hex."""
    x, f, z = RAW(c); up = n.z; lat = abs(n.x); X = abs(x)
    if fi is not None and fi in eye_faces: return eye_faces[fi]
    hw = head_w(c)
    if hw > 0.3:
        if f > 0.915 and z < 0.32 and z > 0.22: return NOSE
        if z > 0.375 and 0.58 < f < 0.69 and X > 0.12: return EARC                    # the small round ears
        if f > 0.80 or (up < -0.3 and f > 0.70): return WHITE                           # the white muzzle and chin
        if 0.775 < f <= 0.80 + 0.04 and z > EYE_Z - 0.05: return WHITE                  # the white band in front of the eyes
        if up < -0.25: return fleck(c, BELLY, 0.2, 0.1)                                 # throat
        return fleck(c, CROWN, 0.18, 0.12)                                              # the darker crown, face and nape
    if z < GROUND + 0.05: return FEET
    fw, hdw = fore_w(c), hind_w(c)
    if fw > 0.5 or hdw > 0.5:
        if z < GROUND + 0.09: return FEET                                               # dark feet
        if lat > 0.3 and (n.x > 0) != (c.x > 0): return fleck(c, BELLY, 0.15, 0.1)     # inner legs
        return fleck(c, A.mix(BACK, CROWN, 0.4), 0.25, 0.15)
    if up < -0.45: return fleck(c, BELLY, 0.2, 0.1)                                     # belly
    if f > 0.40 and up < 0.0 and z < 0.0: return fleck(c, BELLY, 0.2, 0.1)             # chest
    if f > 0.50 and up > 0.3: return fleck(c, A.mix(CROWN, BACK, 0.5), 0.25, 0.15)      # the nape
    return fleck(c, BACK)

# ---- the tail: lofted along a curve -------------------------------------------------------------------------
def tail_frame(u):
    """Centre, tangent and in-plane normal (Blender axes) at u in [0, 1]."""
    th0, th1 = math.radians(-4), math.radians(-22)        # out behind, curving gently down
    n = 48; p = Vector(TAIL_ROOT); out = None
    for i in range(n + 1):
        uu = i / n
        th = th0 + (th1 - th0) * uu ** 1.3
        T = Vector((0, math.cos(th), math.sin(th)))          # back (+y) and up
        if out is None and uu >= u - 1e-9: out = (p.copy(), T, Vector((0, -math.sin(th), math.cos(th))))
        p += T * (TAIL_LEN / n)
    return out
def tail_width(u):
    hw = 0.030 + 0.014 * smooth(0.0, 0.45, u)          # bushy
    if u > 0.8: hw *= math.sqrt(max(0.0, 1 - ((u - 0.8) / 0.2) ** 2))
    hd = hw * (1 - 0.25 * smooth(0.0, 0.35, u))       # 1.3:1 past the base
    return hw, hd
TIP_U = 0.45
TIP_PIV = tail_frame(TIP_U)[0]
def tail_tag(u):
    tw = smooth(0.38, 0.52, u)
    if tw > 0: return TAIL_TIP, tw, TIP_PIV
    return TAIL, smooth(-0.02, 0.1, u), TAIL_ROOT
def plume(sides, rings):
    tris = []
    us = [math.sin(0.5 * math.pi * i / (rings - 1)) for i in range(rings)]
    Rg = []
    for u in us:
        C, T, N = tail_frame(u); hw, hd = tail_width(u)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            lump = 1 + 0.08 * math.sin(5 * a + 7.0 * u) * math.sin(math.pi * u)
            ring.append((C + Vector((hw * math.cos(a) * lump, 0, 0)) + N * (hd * math.sin(a) * lump), a, u))
        Rg.append((C, ring))
    def col(a_mid, u, c):
        ca = abs(math.cos(a_mid))
        if u > 0.72: return T_DARK                                         # the darker tip
        if u < 0.1: return fleck(c, BACK, 0.3, 0.15)
        if sides <= 4: return A.mix(T_CORE, T_FRINGE, 0.3) if ca > 0.9 else T_CORE   # far tier: a grizzled tail
        if ca > (0.86 if sides > 6 else 0.75): return T_FRINGE
        return fleck(c, T_CORE, 0.25, 0.15)
    for i in range(rings - 1):
        (c0, r0), (c1, r1) = Rg[i], Rg[i + 1]
        m = (c0 + c1) / 2
        for k in range(sides):
            a, b = r0[k], r0[(k + 1) % sides]; c, d = r1[k], r1[(k + 1) % sides]
            am = (a[1] + b[1]) / 2 if k < sides - 1 else a[1] + math.pi / sides
            h = col(am, (a[2] + c[2]) / 2, (a[0] + d[0]) / 2)
            tris.append((a[0], b[0], d[0], h, m, (a[2], b[2], d[2]))); tris.append((a[0], d[0], c[0], h, m, (a[2], d[2], c[2])))
    C, T, _ = tail_frame(1.0)
    tipc = Rg[-1][0] + T * 0.008
    for k in range(sides):
        a, b = Rg[-1][1][k], Rg[-1][1][(k + 1) % sides]
        tris.append((a[0], b[0], tipc, T_DARK, Rg[-1][0], (a[2], b[2], 1.0)))
    for k in range(sides):     # root cap, inside the rump
        a, b = Rg[0][1][k], Rg[0][1][(k + 1) % sides]
        tris.append((b[0], a[0], Rg[0][0], T_CORE, Rg[0][0] + tail_frame(0.0)[1] * 0.01, (0.0, 0.0, 0.0)))
    return tris

def eye_tris():
    """A dark eye (octahedron) just proud of the head on each side, lod0 only; the ring is painted on the faces."""
    out = []
    for s in (1, -1):
        c = Vector((s * (abs(EYE.x) + 0.0008), EYE.y, EYE.z))
        r = Vector((0.0035, 0.0055, 0.0045))
        P = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            out.append((P[a], P[b], P[4], c)); out.append((P[b], P[a], P[5], c))
    return out

# ---- tiers ---------------------------------------------------------------------------------------------------------
def build(level, target, sides, rings):
    ptris = plume(sides, rings)
    etris = eye_tris() if level == 0 else []
    o, n0 = A.tier_copy(ob, target - len(ptris) - len(etris))
    m = o.data
    eye_faces = {}
    for s in (1, -1):        # lod1: the face nearest each eye dark (no eye geometry); lod2 none
        q = Vector((s * abs(EYE.x), EYE.y, EYE.z))
        near = sorted((p for p in m.polygons if p.normal.x * s > 0.2), key=lambda p: (p.center - q).length)
        if level == 1 and near and near[0].area < 2.5e-4: eye_faces[near[0].index] = EYEC
    out = dict(pos=[], col=[], part=[], partw=[], piv=[], idx=[])
    def tag(p):
        hw = head_w(p)
        if hw > 0: return HEAD, hw, NECK_PIV
        fw = fore_w(p)
        if fw > 0: return LEG_A, fw, Vector((math.copysign(FORE_PIV.x, p.x), FORE_PIV.y, FORE_PIV.z))
        hdw = hind_w(p)
        if hdw > 0: return LEG_B, hdw, Vector((math.copysign(HIND_PIV.x, p.x), HIND_PIV.y, HIND_PIV.z))
        cw = chest_w(p)
        if cw > 0: return CHEST, cw, CHEST_PIV
        return BODY, 0.0, Vector()
    key2i = {}
    for p in m.polygons:
        c = p.center
        fc = A.srgb2lin(face_color(c, p.normal, eye_faces, p.index))
        for vi in p.vertices:
            k = (vi, fc)
            if k not in key2i:
                key2i[k] = len(out['pos']); co = m.vertices[vi].co
                pt, w, pv = tag(co)
                out['pos'].append(A.to3(co)); out['col'].append(fc); out['part'].append(float(pt)); out['partw'].append(w); out['piv'].append(A.to3(pv))
            out['idx'].append(key2i[k])
    nbody = len(out['idx']) // 3
    def put(a, b, c, h, us):
        fc = A.srgb2lin(h)
        for q, u in zip((a, b, c), us):
            if u is None: pt, w, pv = HEAD, 1.0, NECK_PIV
            else: pt, w, pv = tail_tag(u)
            out['idx'].append(len(out['pos'])); out['pos'].append(A.to3(q)); out['col'].append(fc)
            out['part'].append(float(pt)); out['partw'].append(w); out['piv'].append(A.to3(pv))
    for a, b, c, ctr in etris:
        if (b - a).cross(c - a).dot((a + b + c) / 3 - ctr) < 0: b, c = c, b
        put(a, b, c, EYEC, (None, None, None))
    for a, b, c, h, mid_, us in ptris:
        if (b - a).cross(c - a).dot((a + b + c) / 3 - mid_) < 0: b, c = c, b; us = (us[0], us[2], us[1])
        put(a, b, c, h, us)
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(body {nbody}, tail {len(ptris)}, eyes {len(etris)})', 'from', n0)
    return out

tiers = [(name, build(i, t, s, r)) for i, (name, t, s, r) in enumerate(TIERS)]
r4 = lambda v: [round(x, 4) for x in A.to3(v)]
top = max(v.co.z for v in V)
shoulder = max(v.co.z for v in V if abs(RAW(v.co)[1] - 0.40) < 0.04)
belly = min(v.co.z for v in V if abs(v.co.x) < 0.02 and abs(RAW(v.co)[1] + 0.1) < 0.05)
RIG = {'kind': 'rodent', 'chest': r4(CHEST_PIV), 'tail': r4(TAIL_ROOT), 'tail_tip': r4(TIP_PIV), 'head': r4(NECK_PIV),
       'fore': r4(FORE_PIV), 'hind': r4(HIND_PIV), 'length_m': HEADBODY + TAIL_LEN}
print('LANDMARKS head-body', HEADBODY, 'tail', TAIL_LEN, 'top', round(top, 4), 'shoulder', round(shoulder, 4), 'belly clearance', round(belly, 4),
      'length (bbox)', round(max(p.z for p in tiers[0][1]['pos']) - min(p.z for p in tiers[0][1]['pos']), 4),
      'width', round(2 * max(abs(v.co.x) for v in V), 4), 'eye', [round(x, 4) for x in A.to3(EYE)])
print('RIG', RIG)
A.write_glb(OUT, tiers, 'wild-earth tools/build_marmot.py (Blender)',
            f'Olympic marmot: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (whiskers dropped, new tail, recoloured, decimated) by wild-earth tools/build_marmot.py',
            extras={'rig': RIG, 'species': SPECIES, 'head_body_m': HEADBODY, 'tail_m': TAIL_LEN, 'mass_kg': 6.0,
                    'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview', 'credits': 5, **src_meta,
                               'ai_generated': True, 'meshy_metadata': 'none embedded in the source GLB'},
                    'parts': 'rodent template (as ground_squirrel.glb): BODY 0 (hindquarters), CHEST 7 (pivot at the lumbar), HEAD 6 (neck) and LEG_A 1 (fore pair, elbows) children of the chest, LEG_B 2 (hind pair, stifles), TAIL 3 and TAIL_TIP 8 (child of the tail)'})
