#!/usr/bin/env python3
# Bake a rigged GLB's animation clips into a bone-animation texture for the client's GPU-instanced skinning
# (client/src/animalModels.js, the skin path of animalMaterial): one draw call per species still, every instance
# picking its own clip and frame from a per-instance vec4.
#
#   .venv/bin/python tools/bake_clips.py SRC.glb OUT_PREFIX --fit client/assets/deer.glb \
#       [--recipe library/animals/clips/odocoileus_hemionus.json] [--rate 30] [--f32]
#
# Reads the source's node tree, skin and animations (standard library + numpy; nothing is executed from the file).
# For each clip it samples every joint's global matrix G_j(t) at --rate Hz and writes, per frame and joint, the
# 3x4 matrix that carries a vertex of the ADOPTED tier (the rest pose baked, scaled and grounded by the build script)
# to its posed place: M_j(t) = T G_j(t) G_j(rest)^-1 T^-1, with T the build's uniform scale and ground shift (read from
# the adopted GLB's extras.skin, else fitted from its extents: --fit). The inverse bind matrices drop out: the
# adopted vertices are the rest-skinned source (checked 2026-10-27 on the doe: body within 1 mm), and the client
# skins them with the adopted JOINTS_0 / WEIGHTS_0 the build script keeps from the source's vertex groups. A model
# of the same skeleton at another size (the buck, 5 % larger) reuses the texture: the client scales the
# translation column by its own scale over the texture's (`scale` in the index).
#
# Output: OUT_PREFIX.bin, the texture's texels row-major (RGBA, half floats by default, --f32 for floats), width
# joints x 3 texels (the matrix's three rows), one row per frame; and OUT_PREFIX.json, the index:
#   { rate, width, height, format, joints: [names in skin order], scale, offset, source,
#     clips: { name: { first, count, loop, duration, root_motion, stride_m, touchdown, speed_mps } } }
# first / count are the clip's first frame (texture row) and frame count; a looping clip's frame `count` is frame 0
# again (the client wraps). root_motion: the root joint's translation over the clip (metres; in-place clips give ~0).
# For clips the recipe marks `gait`, the left fore hoof joint's travel on the ground over a cycle gives stride_m
# (metres per cycle, the distance an instance should move per cycle for planted hooves), touchdown (the phase, 0..1,
# at which it lands) and speed_mps (stride / duration: the speed the clip was authored at).
#
# The recipe (JSON, optional) says which clips to bake and how:
#   { "clips": { "Walk": { "loop": true, "gait": true, "hoof": "FF.L" [, "stride_m": 3.0] }, "Idle": { "loop": true }, ... },
#     "synthetic": { "bed": { "from": "Idle_Headlow", "at": 0.0, "root": [0, -0.47, 0],
#                             "aim": [ ["FrontUpperLeg.L", "FrontLowerLeg.L", [-0.4, 0.9]], ["FrontLowerLeg.L+IKFrontLeg.L+FF.L", "IKFrontLeg.L", [0, -1]] ],
#                             "rotate": [ ["BackLeg.L", "x", -50] ] } } }
# A synthetic clip is one frame: a sampled frame of another clip, every joint moved by `root` (adopted metres) and
# listed joints (with their descendants, '+' joining extra joints such as a leg's IK hoof bones, which hang off the
# armature root) turned about the first joint's head in adopted space, in order: `aim` turns about x so the bone from
# the first joint to the named end joint points along the (y, z) direction given (+z forward, y up); `rotate` turns by
# degrees about x, y or z. Without a recipe every clip is baked as a loop. The hoof heads and the lowest joint are
# printed so the pose can be tuned; the drawn result is checked in the browser.
import json, struct, sys, math, os
import numpy as np

argv = sys.argv[1:]
if len(argv) < 2 or '-h' in argv or '--help' in argv:
    print(__doc__ or open(__file__).read().split('import json')[0]); sys.exit(0)
SRC, OUT = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
RATE = float(opt('--rate', 30))
FIT = opt('--fit')
RECIPE = json.load(open(opt('--recipe'))) if opt('--recipe') else {}
F32 = '--f32' in argv

# ---- glTF reading ------------------------------------------------------------------------------------------------
def load_glb(path):
    b = open(path, 'rb').read()
    if b[:4] != b'glTF': raise SystemExit(f'{path}: not a GLB')
    ln, = struct.unpack_from('<I', b, 12); js = json.loads(b[20:20 + ln]); off = 20 + ln
    bl, = struct.unpack_from('<I', b, off)
    return js, b[off + 8:off + 8 + bl]

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def accessor(js, bin, i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]; ct = CT[a['componentType']]; n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0); size = np.dtype(ct).itemsize; stride = v.get('byteStride', n * size)
    if stride != n * size:
        raw = np.frombuffer(bin, dtype=np.uint8, count=stride * (a['count'] - 1) + n * size, offset=off)
        out = np.stack([raw[k * stride:k * stride + n * size].view(ct) for k in range(a['count'])])
    else: out = np.frombuffer(bin, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n)
    out = out.astype(np.float64) if ct == np.float32 else out
    if a.get('normalized') and ct != np.float32: out = out / np.iinfo(ct).max
    return out

def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def trs(t, q, s):
    M = np.eye(4); M[:3, :3] = quat_mat(q) * np.asarray(s, float); M[:3, 3] = t; return M
def slerp(a, b, u):
    a = np.asarray(a, float); b = np.asarray(b, float); d = float(np.dot(a, b))
    if d < 0: b = -b; d = -d
    if d > 0.9995: q = a + (b - a) * u; return q / np.linalg.norm(q)
    th = math.acos(d); return (math.sin((1 - u) * th) * a + math.sin(u * th) * b) / math.sin(th)

js, bin = load_glb(SRC)
N = js['nodes']
parent = {c: i for i, n in enumerate(N) for c in n.get('children', [])}
def local_rest(i):
    n = N[i]
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    return trs(n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1]))
def chain(i):
    out = []
    while i is not None: out.append(i); i = parent.get(i)
    return out
skin = js['skins'][0]
JOINTS = skin['joints']; JN = [N[j].get('name', f'joint{j}') for j in JOINTS]; NJ = len(JOINTS)
name2joint = {n: k for k, n in enumerate(JN)}
children = {i: n.get('children', []) for i, n in enumerate(N)}
def descendants(i):
    out = [i]; stack = list(children[i])
    while stack: k = stack.pop(); out.append(k); stack.extend(children[k])
    return out

# ---- the build's frame: adopted = T(rest-skinned source) ----------------------------------------------------------
def rest_globals():
    G = {}
    def g(i):
        if i not in G: L = local_rest(i); G[i] = (g(parent[i]) @ L) if i in parent else L
        return G[i]
    for i in range(len(N)): g(i)
    return G
G_REST = rest_globals()
def rest_skinned_positions():
    """Every skinned vertex of the source at rest, in root space (what Blender's REST bake gives the build script)."""
    ibm = accessor(js, bin, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    Mj = np.array([G_REST[j] @ ibm[k] for k, j in enumerate(JOINTS)])
    P = []; J = []; W = []
    for node in N:
        if node.get('skin') is None: continue
        for pr in js['meshes'][node['mesh']]['primitives']:
            A = pr['attributes']; P.append(accessor(js, bin, A['POSITION'])); J.append(accessor(js, bin, A['JOINTS_0'])); W.append(accessor(js, bin, A['WEIGHTS_0']))
    P = np.concatenate(P); J = np.concatenate(J).astype(int); W = np.concatenate(W)
    Ph = np.c_[P, np.ones(len(P))]; S = np.zeros((len(P), 3))
    for c in range(4): S += W[:, c:c + 1] * np.einsum('nij,nj->ni', Mj[J[:, c]], Ph)[:, :3]
    return S
SCALE, OFFSET = 1.0, np.zeros(3)
if FIT:
    fj, fb = load_glb(FIT)
    ex = (fj.get('extras') or {}).get('skin')
    if ex and 'scale' in ex:
        SCALE = float(ex['scale']); OFFSET = np.array(ex.get('offset', [0, 0, 0]), float)
        print(f'INFO frame from {FIT} extras.skin: scale {SCALE:.5f} offset {np.round(OFFSET, 4).tolist()}')
    else:   # fit by extents: the build scales uniformly and puts the feet at y = 0 (the nose-to-tail length is untouched)
        m0 = next(m for m in fj['meshes'] if m['name'] == 'lod0')
        A = accessor(fj, fb, m0['primitives'][0]['attributes']['POSITION'])
        S = rest_skinned_positions()
        SCALE = float((A[:, 2].max() - A[:, 2].min()) / (S[:, 2].max() - S[:, 2].min()))
        OFFSET = np.array([0.0, A[:, 1].min() - S[:, 1].min() * SCALE, A[:, 2].min() - S[:, 2].min() * SCALE])
        print(f'INFO frame fitted to {FIT} by extents: scale {SCALE:.5f} offset {np.round(OFFSET, 4).tolist()}')
T = np.eye(4); T[:3, :3] *= SCALE; T[:3, 3] = OFFSET
T_INV = np.linalg.inv(T)
G_REST_INV = {j: np.linalg.inv(G_REST[j]) for j in JOINTS}

# ---- sampling ---------------------------------------------------------------------------------------------------
def sample_channel(js, bin, anim, ch, t):
    s = anim['samplers'][ch['sampler']]; times = accessor(js, bin, s['input'])[:, 0]; vals = accessor(js, bin, s['output'])
    interp = s.get('interpolation', 'LINEAR'); path = ch['target']['path']
    if interp == 'CUBICSPLINE': vals = vals.reshape(len(times), 3, -1)   # in-tangent, value, out-tangent
    if t <= times[0]: k, u = 0, 0.0
    elif t >= times[-1]: k, u = len(times) - 1, 0.0
    else:
        k = int(np.searchsorted(times, t, side='right') - 1); dt = times[k + 1] - times[k]; u = (t - times[k]) / dt if dt > 0 else 0.0
    if interp == 'STEP' or u == 0.0 or k + 1 >= len(times):
        return vals[k, 1] if interp == 'CUBICSPLINE' else vals[k]
    if interp == 'CUBICSPLINE':
        dt = times[k + 1] - times[k]; p0, m0 = vals[k, 1], vals[k, 2] * dt; p1, m1 = vals[k + 1, 1], vals[k + 1, 0] * dt
        u2, u3 = u * u, u * u * u
        v = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1
        return v / np.linalg.norm(v) if path == 'rotation' else v
    if path == 'rotation': return slerp(vals[k], vals[k + 1], u)
    return vals[k] + (vals[k + 1] - vals[k]) * u

def pose_globals(anim, t):
    """Every node's global matrix at time t of the clip (nodes without channels keep their rest TRS)."""
    loc = {}
    for ch in anim['channels']:
        i = ch['target']['node']; path = ch['target']['path']
        if path not in ('translation', 'rotation', 'scale'): continue
        loc.setdefault(i, {})[path] = sample_channel(js, bin, anim, ch, t)
    L = {}
    for i, n in enumerate(N):
        if i in loc:
            c = loc[i]
            L[i] = trs(c.get('translation', n.get('translation', [0, 0, 0])), c.get('rotation', n.get('rotation', [0, 0, 0, 1])), c.get('scale', n.get('scale', [1, 1, 1])))
        else: L[i] = local_rest(i)
    G = {}
    def g(i):
        if i not in G: G[i] = (g(parent[i]) @ L[i]) if i in parent else L[i]
        return G[i]
    for i in range(len(N)): g(i)
    return G
def duration(anim):
    return max(float(accessor(js, bin, anim['samplers'][ch['sampler']]['input'])[:, 0].max()) for ch in anim['channels'])
def to_adopted(G):
    """Joint matrices in the adopted frame, (NJ, 4, 4): T G_j G_j(rest)^-1 T^-1."""
    return np.array([T @ G[j] @ G_REST_INV[j] @ T_INV for j in JOINTS])
def joint_pos(G, j):
    """A joint's head in the adopted frame."""
    return (T @ G[j])[:3, 3]

# the clips, by name (FBX2glTF exports each twice, once as 'Armature|Name'; keep the short name)
anims = {}
for a in js.get('animations', []):
    name = a.get('name', f'clip{len(anims)}'); short = name.split('|')[-1]
    anims.setdefault(short, a)
wanted = RECIPE.get('clips') or {n: {'loop': True} for n in anims}
root_joint = JOINTS[0]
frames = []   # (NJ, 4, 4) per frame
index = {}
def add_frames(name, mats, meta):
    index[name] = {'first': len(frames), 'count': len(mats), **meta}
    frames.extend(mats)

for name, spec in wanted.items():
    if name not in anims: raise SystemExit(f'clip {name!r} not in {SRC}; clips: {sorted(anims)}')
    a = anims[name]; dur = duration(a); loop = bool(spec.get('loop', True))
    count = max(1, int(round(dur * RATE))) if loop else int(math.floor(dur * RATE + 1e-6)) + 1
    mats = []; hoof = []; root = []
    hj = JOINTS[name2joint[spec['hoof']]] if spec.get('hoof') in name2joint else None
    for f in range(count):
        G = pose_globals(a, f / RATE if loop else min(dur, f / RATE))
        mats.append(to_adopted(G)); root.append(joint_pos(G, root_joint))
        if hj is not None: hoof.append(joint_pos(G, hj))
    G_end = pose_globals(a, dur); rm = (joint_pos(G_end, root_joint) - joint_pos(pose_globals(a, 0.0), root_joint))
    meta = {'loop': loop, 'duration': round(dur, 4), 'root_motion': [round(float(x), 4) for x in rm]}
    if spec.get('gait') and hoof:
        H = np.array(hoof); y = H[:, 1]; stance = y < y.min() + float(spec.get('stance_lift', 0.03))
        # touchdown: the first stance frame after a swing (circular)
        td = next((f for f in range(count) if stance[f] and not stance[(f - 1) % count]), 0)
        # the planted hoof moves back under the body at the body's speed: its ground travel over the stance, spread
        # over the whole cycle, is the distance an instance covers per cycle with no hoof slide (the recipe may override)
        z = H[stance, 2]; ns = int(stance.sum()); travel = float(z.max() - z.min()) if ns else 0.0
        stride = float(spec['stride_m']) if 'stride_m' in spec else (travel * count / ns if ns else 0.0)
        meta.update({'stride_m': round(stride, 4), 'touchdown': round(td / count, 4), 'speed_mps': round(stride / dur, 3) if dur > 0 else 0.0,
                     'hoof': spec['hoof'], 'stance_frames': ns, 'stance_travel_m': round(travel, 4)})
    add_frames(name, mats, meta)
    print(f'CLIP {name}: {count} frames, {dur:.3f} s, loop {loop}, root motion {meta["root_motion"]}' + (f', stride {meta["stride_m"]} m, touchdown {meta["touchdown"]}, {meta["speed_mps"]} m/s' if 'stride_m' in meta else ''))

def rot_about(axis, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    R = np.eye(4)
    if axis == 'x': R[1:3, 1:3] = [[c, -s], [s, c]]
    elif axis == 'y': R[0, 0], R[0, 2], R[2, 0], R[2, 2] = c, s, -s, c
    else: R[0:2, 0:2] = [[c, -s], [s, c]]
    return R
for name, spec in (RECIPE.get('synthetic') or {}).items():
    a = anims[spec['from']]; G = pose_globals(a, float(spec.get('at', 0.0)))
    A = {j: T @ G[j] for j in JOINTS}   # adopted-frame globals
    def aim_angle(a_name, b_name, yz):   # degrees about x taking the bone a->b (its yz projection) onto direction yz
        a, b = A[JOINTS[name2joint[a_name]]][:3, 3], A[JOINTS[name2joint[b_name]]][:3, 3]
        cur, want = math.atan2(b[2] - a[2], b[1] - a[1]), math.atan2(yz[1], yz[0])
        return math.degrees(want - cur)   # R_x(t) adds t to atan2(z, y)
    edits = [('aim', e) for e in spec.get('aim', [])] + [('rotate', e) for e in spec.get('rotate', [])]
    for kind, entry in edits:   # each aim measured after the edits before it
        if kind == 'aim': names, axis, deg = entry[0], 'x', aim_angle(entry[0].split('+')[0], entry[1], entry[2])
        else: names, axis, deg = entry
        targets = []
        for nm in names.split('+'):
            if nm not in name2joint: raise SystemExit(f'synthetic {name}: unknown joint {nm}')
            targets.extend(descendants(JOINTS[name2joint[nm]]))
        head = A[JOINTS[name2joint[names.split('+')[0]]]][:3, 3].copy()
        R = rot_about(axis, float(deg)); Tp = np.eye(4); Tp[:3, 3] = head; Tm = np.eye(4); Tm[:3, 3] = -head
        X = Tp @ R @ Tm
        for j in set(targets):
            if j in A: A[j] = X @ A[j]
    root = np.array(spec.get('root', [0, 0, 0]), float)
    mats = np.array([A[j] @ G_REST_INV[j] @ T_INV for j in JOINTS]); mats[:, :3, 3] += root
    add_frames(name, [mats], {'loop': False, 'duration': 0.0, 'root_motion': [0, 0, 0], 'synthetic': spec})
    # report the posed hooves and the lowest body point for the recipe's author
    hoofs = {nm: np.round((mats[name2joint[nm]] @ np.r_[joint_pos(G_REST, JOINTS[name2joint[nm]]), 1])[:3], 3).tolist() for nm in JN if nm.startswith('FF')}
    heads = {nm: (mats[name2joint[nm]] @ np.r_[joint_pos(G_REST, JOINTS[name2joint[nm]]), 1])[:3] for nm in JN}
    low = min(heads, key=lambda k: heads[k][1])
    print(f'SYNTH {name}: from {spec["from"]}@{spec.get("at", 0)}, root {root.tolist()}, hoof heads {hoofs}, lowest joint {low} y {heads[low][1]:.3f}')
    for nm in [n for n in JN if 'Leg' in n and n.endswith('.L')]: print(f'   {nm:18s} {np.round(heads[nm], 3).tolist()}')

# ---- the texture ------------------------------------------------------------------------------------------------
H = len(frames); W = NJ * 3
tex = np.zeros((H, W, 4), np.float32)
for f, mats in enumerate(frames):
    for j in range(NJ): tex[f, j * 3:j * 3 + 3, :] = mats[j][:3, :]   # the three rows of the 3x4
worst = float(np.abs(tex).max())
if not F32 and worst > 60000: print(f'WARNING values up to {worst:.0f} overflow half floats; use --f32')
data = tex.astype(np.float32 if F32 else np.float16).tobytes()
open(OUT + '.bin', 'wb').write(data)
# half-float precision check against the floats
if not F32:
    err = float(np.abs(tex.astype(np.float16).astype(np.float32) - tex).max()); print(f'INFO half-float rounding error up to {err * 1000:.3f} mm (or per unit of rotation)')
idx = {'rate': RATE, 'width': W, 'height': H, 'format': 'rgba32f' if F32 else 'rgba16f', 'texels': 'row f = frame f; texels j*3..j*3+2 = rows 0..2 of joint j\'s 3x4 matrix (adopted frame)',
       'joints': JN, 'scale': round(SCALE, 6), 'offset': [round(float(x), 5) for x in OFFSET],
       'source': {'file': os.path.basename(SRC), 'fit': FIT, 'recipe': opt('--recipe'), 'clips_in_source': sorted(anims)},
       'clips': index}
json.dump(idx, open(OUT + '.json', 'w'), indent=1)
print(f'WROTE {OUT}.bin ({len(data)} bytes, {W}x{H} {idx["format"]}) and {OUT}.json ({len(index)} clips)')
