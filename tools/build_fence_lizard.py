# Build client/assets/fence_lizard.glb, the ambient western fence lizard (Sceloporus occidentalis), from a Meshy preview.
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model latest (meshy-7.1), no remesh (317,880
# triangles, one piece), task 01a179be-fa71-7497-a767-d62f23b4af9f (prompt in
# library/animals/drafts/sceloporus_occidentalis.md, section 4), run by agent (Claude) for Aaron Brodeur on
# 2026-10-26 UTC; record in library/animals/jobs/sceloporus_occidentalis/01a179be-fa71-7497-a767-d62f23b4af9f/job.json.
# A refine (task 01a179c0-41e6-764a-88fb-3291a60da9b5, same geometry, 2K colour map) was made as a colour reference
# only; the tiers carry vertex colour from the brief's palette, not the map. Paid-plan API output, owned by the account
# holder (Meshy Terms of Use 3.2), released with the project's assets under CC BY-SA 4.0; credit "generated with
# Meshy". No Meshy metadata in the file to carry over (Terms 2.4: asset.generator only).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_fence_lizard.py -- \
#       library/animals/jobs/sceloporus_occidentalis/01a179be-fa71-7497-a767-d62f23b4af9f/model.glb \
#       client/assets/fence_lizard.glb
#
# What it does (brief: library/animals/drafts/sceloporus_occidentalis.md): welds and pre-decimates the 318k-triangle
# sculpt to 60k; finds the four limbs from the geometry (outside the trunk's half-width or under the belly, connected
# to a foot) and their shoulder and hip rings; puts the vent just behind the hips; the generator's tail was 0.62x the
# snout-vent length, so it is stretched along its own axis to 0.11 m and laid down to rest on the ground behind;
# the body is lowered and flattened (z 0.75x: lizards are wider than deep, and the back stands 2.5 cm); scales snout to
# vent to 0.07 m (0.18 m in all). Colour by region from the brief's palette: grey-brown back with two rows of dark
# blotches (pale trailing edge) and a pale dorsolateral stripe, speckled flanks, a cream-grey belly with a cobalt patch
# edged in black on each side (wrapping onto the lower flank), a pale throat with a blue patch, yellow-orange under
# the limbs, grey-brown toes, a banded tail, a dark eye (lod0). Decimates (collapse, X symmetry) to
# lod0 ~1,200, lod1 ~400, lod2 ~120 triangles.
# Rig, the reptile template (proposed in docs/animal-library.md): BODY 0, LEG_A 1 (left fore, right hind) and LEG_B 2
# (right fore, left hind), splayed, pivots at the shoulder and hip rings; HEAD 6 (pivot at the neck); TAIL 3 (inner
# half, pivot at the vent) and TAIL_TIP 8 (outer half, pivot mid-tail, child of the tail). A per-vertex _BLUE (0-1)
# marks the male's belly and throat patches so the shader can show more of them in the push-up (and grey them for a
# female). extras.rig: the pivots and the spine landmarks (snout, vent and tail-tip z) for the lateral undulation.
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
JOB = '01a179be-fa71-7497-a767-d62f23b4af9f'
REFINE = '01a179c0-41e6-764a-88fb-3291a60da9b5'
TIERS = [('lod0', 1200), ('lod1', 400), ('lod2', 120)]
SVL, TAIL_M = 0.07, 0.11          # snout to vent, vent to tail tip (m): 0.18 m in all
HEIGHT = 0.75                     # z squash: a flatter body, the back at ~2.5 cm
HEAD_, TAIL, TAIL_TIP = 6, 3, 8

ob = A.import_glb_mesh(SRC)
o2, n0 = A.tier_copy(ob, 60000)                 # 318k triangles is more than the rig pass needs
bpy.data.objects.remove(ob); ob = o2; ob.name = 'lizard'
me = ob.data; V = me.vertices
print('INFO source triangles', n0, 'working', len(me.polygons))
adj = A.adjacency(me)
z0 = min(v.co.z for v in V)
for v in V: v.co.z -= z0
nose = min(V, key=lambda v: v.co.y).co.copy(); ytip = max(v.co.y for v in V)

# ---- trunk profile per y: half-width above the limbs, belly and back z on the midline ----
BIN = 0.025
NOSE_Y0 = nose.y                                  # source units; nose is rescaled later
def bin_of(y): return int(math.floor((y - NOSE_Y0) / BIN))
rows = {}
for v in V: rows.setdefault(bin_of(v.co.y), []).append(v.co)
prof = {}
for k, c in rows.items():
    mid = [p.z for p in c if abs(p.x) < 0.02]
    if not mid: continue
    zt, zb = max(mid), min(mid)
    up = [abs(p.x) for p in c if p.z > (zt + zb) / 2 + 0.3 * (zt - zb) / 2]
    prof[k] = (max(up, default=0.01) / 0.95, zb, zt)
# the upper section underestimates a flat-sided trunk: scale by max/upper measured where no limb reaches
_r = sorted(max(abs(p.x) for p in rows[k]) / (prof[k][0] * 0.95) for k in prof if k in rows and min(p.z for p in rows[k]) > 0.08 and 0.4 < (k * BIN) / (2 * abs(nose.y)) < 0.5)
FLAT = _r[len(_r) // 2] if _r else 1.0
prof = {k: (w * FLAT, zb, zt) for k, (w, zb, zt) in prof.items()}
print('INFO trunk flat-side ratio', round(FLAT, 3), 'from', len(_r), 'slices')
def P(y):
    k = bin_of(y)
    while k not in prof and k > 0: k -= 1
    return prof.get(k, (0.01, 0.0, 0.0))

# ---- limbs: outside the trunk or under the belly, connected to a foot ----
feet = [v.index for v in V if v.co.z < 0.02]
cand = [v.index for v in V if nose.y + 0.15 < v.co.y < ytip - 0.4 and
        (abs(v.co.x) > P(v.co.y)[0] * 1.05 + 0.01 or v.co.z < P(v.co.y)[1] - 0.015)]
comps = A.components(adj, cand)
fs = set(feet)
limbs = [c for c in comps if fs & set(c)][:4]
assert len(limbs) == 4, [len(c) for c in comps[:6]]
tmp = []
for c in limbs:
    cs = set(c)
    cen = sum((V[i].co for i in c), Vector()) / len(c)
    ring = [V[i].co for i in c if any(u not in cs for u in adj[i])]
    tmp.append((sum(ring, Vector()) / len(ring), cen, cs))
tmp.sort(key=lambda r: r[0].y)                   # fore pair first (the animal faces -y)
pivots = {}; limbset = {}
for j, (piv, cen, cs) in enumerate(tmp):
    k = (j < 2, cen.x > 0)
    pivots[k] = piv; limbset[k] = cs
assert len(pivots) == 4, pivots.keys()
limb_of = {i: k for k, s in limbset.items() for i in s}
hind_ring_y = max(V[i].co.y for k in ((False, True), (False, False)) for i in limbset[k] if any(u not in limbset[k] for u in adj[i]))
VENT_Y = hind_ring_y + 0.03
print('INFO limbs', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): (len(s), [round(x, 3) for x in pivots[k]]) for k, s in limbset.items()},
      'vent y', round(VENT_Y, 3), 'nose', [round(x, 3) for x in nose], 'tip y', round(ytip, 3))

# ---- tail: behind the vent ----
tail = [v.index for v in V if v.co.y > VENT_Y and v.index not in limb_of]
far = max(V, key=lambda v: v.co.y).index
tail = next(c for c in A.components(adj, tail) if far in c)
tailset = set(tail)
roots = [i for i in tail if any(V[u].co.y <= VENT_Y for u in adj[i])]
TA, tfrac = A.tube_axis(me, adj, tail, roots, bins=20)
L0 = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
S = SVL / (VENT_Y - nose.y)                      # metres per source unit
K = TAIL_M / (L0 * S)
# tail radius per axis point, for laying the stretched tail on the ground
rad = [[] for _ in TA]
for i in tail:
    b = min(len(TA) - 1, int(tfrac[i] * len(TA)))
    rad[b].append((V[i].co - TA[b]).length)
R = [sum(r) / len(r) if r else 0.0 for r in rad]
cum = [0.0]
for i in range(len(TA) - 1): cum.append(cum[-1] + (TA[i + 1] - TA[i]).length)
NA = []
for i, p in enumerate(TA):
    t = cum[i] / L0
    d = p - TA[0]
    zt = R[i] + 0.004 + (TA[0].z - R[0] - 0.004) * (1 - A.smooth(0.0, 0.55, t))
    NA.append(Vector((d.x * K * 0.3, TA[0].y + d.y * K, zt)))
# keep each new segment's length = old * K (the lowering shortens y a little; scale y so the arc is right)
arc = sum((NA[i + 1] - NA[i]).length for i in range(len(NA) - 1))
NA = [Vector((q.x, TA[0].y + (q.y - TA[0].y) * (L0 * K / arc) ** 1.0, q.z)) for q in NA]
for i in tail:
    V[i].co = A.remap_along(TA, NA, V[i].co, 1.0, 1.0)
TA = NA
print('INFO tail source length', round(L0 * S, 4), 'm, stretch', round(K, 2))

# ---- landmarks (source units, before the squash) ----
yf = [k for k in pivots if k[0]]
y_sh = sum(pivots[k].y for k in yf) / 2
y_hip = sum(pivots[k].y for k in pivots if not k[0]) / 2
# neck: the narrowest trunk section between the head and the shoulders
cands = [(P(nose.y + 0.2 + j * 0.0125)[0], nose.y + 0.2 + j * 0.0125) for j in range(int((y_sh - nose.y - 0.2) / 0.0125))]
neck_y = min(cands)[1] if cands else nose.y + 0.35
_, zb, zt = P(neck_y)
NB = Vector((0, neck_y, (zb + zt) / 2))
headv = [v.co for v in V if v.co.y < nose.y + 0.08]
headc = sum(headv, Vector()) / len(headv)
NDIR = (headc - NB).normalized()
headlen = neck_y - nose.y
print('INFO neck y', round(neck_y, 3), 'shoulders y', round(y_sh, 3), 'hips y', round(y_hip, 3), 'head length frac of SVL', round(headlen / (VENT_Y - nose.y), 3))

# ---- squash and scale: Blender axes, metres, origin on the ground between the fore and hind pivots ----
yorg = (y_sh + y_hip) / 2
def sc(p): return Vector((p.x * S, (p.y - yorg) * S, p.z * HEIGHT * S))
for v in V: v.co = sc(v.co); v.co.z = max(0.0, v.co.z)
me.update()
TA = [sc(p) for p in TA]; NB = sc(NB); NDIR = Vector((NDIR.x, NDIR.y, NDIR.z * HEIGHT)).normalized()
pivots = {k: sc(p) for k, p in pivots.items()}
nose = sc(nose); VY = (VENT_Y - yorg) * S; Y_SH = (y_sh - yorg) * S; Y_HIP = (y_hip - yorg) * S
def W(y): return P(y / S + yorg)[0] * S                       # trunk half-width at y (m)
def ZB(y): return P(y / S + yorg)[1] * S * HEIGHT
tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
acc = 0.0; TIP = TA[-1]
for i in range(len(TA) - 1):
    L = (TA[i + 1] - TA[i]).length
    if acc + L >= tail_len / 2: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((tail_len / 2 - acc) / L); break
    acc += L
trunk = [v.co for v in V if Y_SH < v.co.y < Y_HIP and v.index not in limb_of]
back_mid = max(v.co.z for v in V if abs(v.co.x) < 0.002 and abs(v.co.y - (Y_SH + Y_HIP) / 2) < 0.002)
back_sh = max(v.co.z for v in V if abs(v.co.x) < 0.002 and abs(v.co.y - Y_SH) < 0.002)
back_hip = max(v.co.z for v in V if abs(v.co.x) < 0.002 and abs(v.co.y - Y_HIP) < 0.002)
belly = min(p.z for p in trunk)
width = 2 * max(abs(p.x) for p in trunk)
span = max(abs(v.co.x) for v in V) * 2
print('LANDMARKS svl', round(VY - nose.y, 4), 'tail', round(tail_len, 4), 'total (straight)', round(max(v.co.y for v in V) - nose.y, 4),
      'back at shoulders / mid / hips', round(back_sh, 4), round(back_mid, 4), round(back_hip, 4), 'belly clearance', round(belly, 4),
      'trunk width', round(width, 4), 'toe span', round(span, 4), 'head top', round(max(v.co.z for v in V), 4),
      'neck', [round(x, 4) for x in NB], 'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 4) for x in p] for k, p in pivots.items()})

# ---- rig on the working mesh, carried through decimation in vertex groups ----
def rig_full(i):
    p = V[i].co
    if i in tailset:
        t = tfrac.get(i, 0.0)
        if t >= 0.5: return dict(part=TAIL_TIP, partw=A.smooth(0.5, 0.62, t), pivot=TIP)
        return dict(part=TAIL, partw=A.smooth(0.0, 0.1, t), pivot=TA[0])
    k = limb_of.get(i)
    if k is not None:
        pv = pivots[k]
        part = 1 if k[0] == k[1] else 2              # LEG_A: left fore (True, True) and right hind (False, False)
        return dict(part=part, partw=A.smooth(0.0005, 0.004, (p - pv).length), pivot=pv)
    wh = A.smooth(-0.001, 0.003, (p - NB).dot(NDIR))
    if wh > 0: return dict(part=HEAD_, partw=wh, pivot=NB)
    return dict(part=0, partw=0.0, pivot=Vector())
RIGF = [rig_full(v.index) for v in V]
groups = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8', 'feet', 'tail')}
feet_g = []
for i, r in enumerate(RIGF):
    if r['part']: groups[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')
    if i in tailset: groups['tail'].add([i], 1.0, 'REPLACE')
    if V[i].co.z < 0.004 and i in limb_of: feet_g.append(i)
groups['feet'].add(feet_g, 1.0, 'REPLACE')
LIMB_KEY = {i: limb_of[i] for i in limb_of}

# ---- colours (brief section 1, sRGB) ----
BACK, BLOTCH, EDGE, STRIPE, FLANK, BELLY = 0x6f6557, 0x2a241f, 0x9a8f7e, 0x9c8e75, 0x665b4e, 0xb3ada0
BLUE, BLUE_EDGE, THROAT, THROAT_BLUE = 0x2d5fa8, 0x1b2230, 0xb8b2a6, 0x3a6cb0
YELLOW, TOES, LIMB, HEADTOP, LIP, EYE = 0xc9933a, 0x5a5048, 0x62584c, 0x554c42, 0x7d7262, 0x121010
TTOP, TBAND, TUNDER = 0x645a4e, 0x3d362f, 0xa29b8e
# the blue patches for the shader: _BLUE 1 on the patch, 0.5 on its black edge (seen in the push-up)
EYE_P = None
hv = [v.co for v in V if RIGF[v.index]['part'] == HEAD_ and abs(v.co.y - (nose.y + 0.36 * (NB.y - nose.y))) < 0.0008]
if hv:
    zc = max(p.z for p in hv)
    side = [p for p in hv if p.x > 0 and p.z > zc - 0.006]
    if side: EYE_P = max(side, key=lambda p: p.x).copy()
print('LANDMARKS eye', EYE_P and [round(x, 4) for x in EYE_P])

def region(p, R, tw, eye_faces, far):
    """(sRGB hex, blue) for a face; far: the coarse tier, no pattern."""
    c = p.center; n = p.normal
    if p.index in eye_faces: return EYE, 0.0
    if sum(tw[i] for i in p.vertices) / len(p.vertices) > 0.5:
        t = max(0.0, (c.y - VY) / (TA[-1].y - VY))
        if n.z < -0.3: return TUNDER, 0.0
        if far: return TTOP, 0.0
        band = (t * 6 + 0.2) % 1.0 < 0.45 and t < 0.8
        return (A.mix(TBAND, TTOP, t / 0.8) if band else TTOP), 0.0
    parts = [R[i]['part'] for i in p.vertices]
    if sum(1 for x in parts if x in (1, 2)) * 2 > len(parts):
        if c.z < 0.0025: return TOES, 0.0
        if n.z < -0.25 or (n.y > 0.6 and c.y > 0 and n.z < 0.3): return YELLOW, 0.0     # under the limbs, back of the thighs
        return LIMB, 0.0
    if n.z < -0.3 and nose.y + 0.5 * (NB.y - nose.y) < c.y < Y_SH - 0.002:                 # the throat, under head and neck
        return (THROAT_BLUE, 1.0) if c.y > nose.y + 0.75 * (NB.y - nose.y) and abs(c.x) < W(c.y) * 0.45 and not far else (THROAT, 0.0)
    if sum(1 for x in parts if x == HEAD_) * 2 > len(parts):
        if n.z < -0.3: return THROAT, 0.0
        if n.z > 0.45: return HEADTOP, 0.0
        if c.z < (NB.z + nose.z) / 2 * 0.8: return LIP, 0.0
        return A.mix(HEADTOP, FLANK, 0.5), 0.0
    w = max(W(c.y), 1e-4); xr = abs(c.x) / w
    in_trunk = Y_SH - 0.002 < c.y < Y_HIP + 0.002
    if n.z < -0.35:
        if in_trunk and xr > 0.36: return BLUE, 1.0
        if in_trunk and xr > 0.22 and not far: return BLUE_EDGE, 0.5
        return BELLY, 0.0
    if in_trunk and not far and n.z < 0.15 and c.z < ZB(c.y) + 0.004: return BLUE, 1.0                 # the patch wraps onto the lower flank
    if n.z > 0.3:
        if far: return A.mix(BACK, BLOTCH, 0.2), 0.0
        if 0.55 < xr < 0.78: return STRIPE, 0.0
        # two rows of dark blotches, each a chevron (its outer end further back) with a pale trailing edge,
        # from the nape to the base of the tail: five pairs, bold enough for faces 2-3 mm across
        u = (c.y - (NB.y + 0.002)) / ((VY + 0.006) - (NB.y + 0.002))
        if 0.0 < u < 1.0 and 0.1 < xr <= 0.6:
            f = (u * 5 - 0.5 * xr + 0.25) % 1.0
            if f < 0.45: return BLOTCH, 0.0
            if f < 0.6: return EDGE, 0.0
        return BACK, 0.0
    return FLANK, 0.0

def emit_blue(m, colour, vert_rig):
    """A.emit with a face-level extra: _BLUE comes from the face's region, so it splits with the colour."""
    key2i = {}; out = dict(pos=[], col=[], part=[], partw=[], piv=[], idx=[], blue=[]); rig = {}
    for p in m.polygons:
        fc, blue = colour(p)
        for vi in p.vertices:
            k = (vi, fc, blue)
            if k not in key2i:
                key2i[k] = len(out['pos'])
                if vi not in rig: rig[vi] = vert_rig(vi)
                r = rig[vi]
                out['pos'].append(A.to3(m.vertices[vi].co)); out['col'].append(fc); out['blue'].append(blue)
                out['part'].append(float(r['part'])); out['partw'].append(float(r['partw'])); out['piv'].append(A.to3(r['pivot']))
            out['idx'].append(key2i[k])
    return out

tiers = []
for name, target in TIERS:
    o, _ = A.tier_copy(ob, target)
    m = o.data
    gi = {g.index: g.name for g in o.vertex_groups}
    R = {}; TW = {}
    for v in m.vertices:
        w = {gi[g.group]: g.weight for g in v.groups}
        TW[v.index] = w.get('tail', 0.0)
        pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
        if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
        part = int(pid[1:]); co = v.co
        if part in (1, 2):
            fore = co.y < (Y_SH + Y_HIP) / 2; left = co.x > 0
            piv = pivots[(fore, left)]
        else:
            piv = {HEAD_: NB, TAIL: TA[0], TAIL_TIP: TIP}[part]
        R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
    eye_faces = set()
    if EYE_P and target >= 1000:
        for sx in (1, -1):
            q = Vector((sx * EYE_P.x, EYE_P.y, EYE_P.z))
            eye_faces.add(min(m.polygons, key=lambda f: (f.center - q).length + (0 if f.normal.x * sx > 0.3 else 1)).index)
    far = target < 200
    def colour(p):
        hexc, blue = region(p, R, TW, eye_faces, far)
        g = A.grizzle(hexc, p.center, 0.05 if blue else 0.12, 0.003)
        return tuple(g), blue
    t = emit_blue(m, colour, lambda i: R[i])
    print('INFO', name, 'tris', len(t['idx']) // 3, 'blue faces', sum(1 for p in m.polygons if region(p, R, TW, eye_faces, far)[1] > 0.9))
    bpy.data.objects.remove(o)
    tiers.append((name, t))

r4 = lambda p: [round(x, 4) for x in A.to3(p)]
A.write_glb(OUT, tiers, 'wild-earth tools/build_fence_lizard.py (Blender)',
            'Western fence lizard generated with Meshy (meshy.ai), text-to-3D preview task ' + JOB + ', for Wild Earth; CC BY-SA 4.0; reshaped, recoloured, decimated',
            extra_names=('blue',),
            extras={'rig': {'kind': 'reptile', 'head': r4(NB), 'tail': r4(TA[0]), 'tail_tip': r4(TIP),
                            'fore': r4(pivots[(True, True)]), 'hind': r4(pivots[(False, True)]),
                            'legs': {'FL': r4(pivots[(True, True)]), 'FR': r4(pivots[(True, False)]), 'HL': r4(pivots[(False, True)]), 'HR': r4(pivots[(False, False)])},
                            'snout_z': round(-nose.y, 4), 'vent_z': round(-VY, 4), 'tail_end_z': round(-TA[-1].y, 4),
                            'belly_y': round(belly, 4), 'back_y': round(back_mid, 4), 'drop': round(belly * 0.85, 4),
                            'blue_off': [round(x, 4) for x in A.srgb2lin(BELLY)], 'throat_off': [round(x, 4) for x in A.srgb2lin(THROAT)],
                            'length_m': SVL + TAIL_M},
                    'species': 'sceloporus_occidentalis', 'svl_m': SVL, 'tail_m': TAIL_M, 'height_scale': HEIGHT, 'tail_stretch': round(K, 3),
                    'meshy_task': JOB, 'meshy_refine_reference': REFINE,
                    'parts': 'reptile template: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at the neck); TAIL 3 (inner half, pivot at the vent), TAIL_TIP 8 (outer half, pivot mid-tail, child of TAIL); _BLUE marks the male blue patches (1 patch, 0.5 its black edge)'})
