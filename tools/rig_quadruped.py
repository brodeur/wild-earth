#!/usr/bin/env python3
# Give a built quadruped GLB (tools/build_fox.py, build_coyote.py, build_cougar.py, build_bear.py: meshes lod0-lod2 with
# POSITION, COLOR_0, _PART, _PARTW, _PIVOT) the standard small skeleton the client's leg engine drives
# (client/src/gait.js; docs/movement.md "The legs"): JOINTS_0 / WEIGHTS_0 on every tier and extras.skin, in the same
# form tools/build_deer.py writes for the deer, so animalModels.js draws it by the skin path. The part attributes stay,
# so the part rig still draws the file where the skin is not loaded.
#
#   .venv/bin/python tools/rig_quadruped.py client/assets/fox.glb [--wrist 0.42 --hock 0.5 --out path] [--dry]
#
# Everything is read from the geometry and the file's extras.rig (no source skeleton is needed; the Meshy meshes never
# had one), in the model's frame: metres, +z forward, +y up, +x the animal's left, the origin on the ground between the
# feet. The posture (digitigrade, plantigrade) comes from the library's locomotion tree (pipeline/locomotion.py) for the
# file's extras.species.
#
# The skeleton, 20 joints, every joint's rest orientation the identity (so a bone's matrix in the pose texture is
# [R | p - R q] for its posed head p, rest head q and rotation R; gait.js writes exactly that):
#   0 Hips (root)  1 Spine  2 Chest  3 Neck  4 Head  5 Tail1  6 Tail2  7 Tail3
#   8-10  UpperLeg.FL LowerLeg.FL Foot.FL      11-13 FR      14-16 HL      17-19 HR
# A leg's three bones: upper (the shoulder or hip joint to the elbow or stifle), lower (to the wrist or hock), foot (the
# wrist or hock to the toe). The elbow and stifle are the part pivots the build scripts found (the belly line); the wrist
# and hock sit at a fraction of that height (--wrist, --hock; defaults by posture, below), each joint centred on the leg
# column's vertices at its height; the toe is the centre of the leg's lowest vertices (the paw's print). The shoulder
# joint is above and ahead of the elbow inside the chest (the humerus slopes down and back), the hip above and behind the
# stifle (the femur slopes down and forward). Hips, Spine and Chest run along the back between the hip and shoulder
# joints; the Neck is the head part's pivot (the neck base), the Head a little over half way from it to the nose; the tail
# chain follows the tail's axis (an edge-path distance from its root) in thirds.
#
# Each leg is cut by a horizontal plane at the elbow/stifle and at the wrist/hock (triangles whose vertices all belong to
# the leg part), so the low-poly leg has a vertex ring to bend at. Weights: a leg vertex goes to the bone of its height,
# blended over a short band at each joint; the body skin in the leg's column above the elbow/stifle takes the upper bone
# fading out toward the shoulder/hip (the arm and thigh move with the leg); the trunk splits Hips / Spine / Chest by z;
# the head part splits Neck / Head by z; the tail by its arc. Four weights a vertex, normalised.
import json, math, struct, sys, os
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.locomotion import resolve as resolve_loco   # noqa: E402

JOINTS = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Tail1', 'Tail2', 'Tail3',
          'UpperLeg.FL', 'LowerLeg.FL', 'Foot.FL', 'UpperLeg.FR', 'LowerLeg.FR', 'Foot.FR',
          'UpperLeg.HL', 'LowerLeg.HL', 'Foot.HL', 'UpperLeg.HR', 'LowerLeg.HR', 'Foot.HR']
J = {n: i for i, n in enumerate(JOINTS)}
LEGS = ['FL', 'FR', 'HL', 'HR']
# the wrist's (fore) and hock's (hind) height as a fraction of the elbow's / stifle's, by posture; the plantigrade foot
# is flat on the ground, its ankle low
DEFAULTS = {'digitigrade': {'wrist': 0.42, 'hock': 0.5}, 'plantigrade': {'wrist': 0.4, 'hock': 0.45}, 'unguligrade': {'wrist': 0.45, 'hock': 0.55}}

# ---- glTF ---------------------------------------------------------------------------------------------------------
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def load_glb(path):
    b = open(path, 'rb').read()
    if b[:4] != b'glTF': raise SystemExit(f'{path}: not a GLB')
    ln, = struct.unpack_from('<I', b, 12); js = json.loads(b[20:20 + ln]); off = 20 + ln
    bl, = struct.unpack_from('<I', b, off)
    return js, b[off + 8:off + 8 + bl]

def accessor(js, bin, i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]; ct = CT[a['componentType']]; n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bin, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n).copy()

class Writer:
    def __init__(self):
        self.buf = bytearray(); self.views = []; self.accs = []
    def add(self, data, target):
        while len(self.buf) % 4: self.buf.append(0)
        off = len(self.buf); self.buf.extend(data)
        self.views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}); return len(self.views) - 1
    def acc(self, arr, ctype, atype, target=34962, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = {'bufferView': self.add(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if minmax: a['min'] = [float(x) for x in arr.min(axis=0)]; a['max'] = [float(x) for x in arr.max(axis=0)]
        self.accs.append(a); return len(self.accs) - 1

# ---- geometry helpers ---------------------------------------------------------------------------------------------
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def bisect(P, attrs, idx, y0, allowed):
    """Split every triangle of `idx` (N,3) whose three vertices are `allowed` and which crosses the plane y = y0: two
    new vertices on the plane (attributes interpolated along the edge), three triangles for one. Returns new P, attrs
    (dict name -> array), idx."""
    P = list(P); A = {k: list(v) for k, v in attrs.items()}; out = []
    cache = {}
    def cut(a, b):
        k = (a, b) if a < b else (b, a)
        if k in cache: return cache[k]
        pa, pb = P[a], P[b]; t = (y0 - pa[1]) / (pb[1] - pa[1])
        P.append(pa + (pb - pa) * t)
        for n in A: A[n].append(A[n][a] + (A[n][b] - A[n][a]) * t)
        cache[k] = len(P) - 1; return cache[k]
    for tri in idx:
        a, b, c = (int(x) for x in tri)
        if not (allowed[a] and allowed[b] and allowed[c]): out.append((a, b, c)); continue
        s = [P[a][1] - y0, P[b][1] - y0, P[c][1] - y0]
        if all(x >= -1e-6 for x in s) or all(x <= 1e-6 for x in s): out.append((a, b, c)); continue
        # the odd vertex: the one alone on its side
        verts = [a, b, c]
        side = [x > 0 for x in s]
        odd = next(i for i in range(3) if side.count(side[i]) == 1)
        o = verts[odd]; p = verts[(odd + 1) % 3]; q = verts[(odd + 2) % 3]
        if abs(s[odd]) < 1e-6: out.append((a, b, c)); continue
        m1 = cut(o, p); m2 = cut(o, q)
        out.append((o, m1, m2)); out.append((m1, p, q)); out.append((m1, q, m2))
    return np.array(P, np.float32), {k: np.array(v, np.float32) for k, v in A.items()}, np.array(out, np.uint32)

def arc_fraction(P, idx, members, roots):
    """Edge-path distance from the root vertices over the member set, as a 0-1 fraction of the farthest. The emitted
    meshes split vertices where face colours differ, so vertices are welded by position for the graph."""
    import heapq
    members = set(int(x) for x in members)
    key = lambda i: tuple(np.round(P[i] * 5000).astype(int))
    canon = {}; rep = {}
    for i in members: rep[i] = canon.setdefault(key(i), i)
    adj = {}
    for tri in idx:
        t = [int(x) for x in tri]
        if not all(v in members for v in t): continue
        t = [rep[v] for v in t]
        for i in range(3):
            a, b = t[i], t[(i + 1) % 3]
            if a != b: adj.setdefault(a, set()).add(b); adj.setdefault(b, set()).add(a)
    dist = {rep[int(r)]: 0.0 for r in roots if int(r) in members}
    h = [(0.0, r) for r in dist]; heapq.heapify(h)
    while h:
        d, v = heapq.heappop(h)
        if d > dist.get(v, 1e9): continue
        for u in adj.get(v, ()):
            nd = d + float(np.linalg.norm(P[u] - P[v]))
            if nd < dist.get(u, 1e9): dist[u] = nd; heapq.heappush(h, (nd, u))
    dmax = max(dist.values()) if dist else 1.0
    return {v: dist.get(rep[v], dmax) / dmax for v in members}, dmax

# ---- the skeleton from one tier's geometry ------------------------------------------------------------------------
def skeleton(P, part, pw, piv, idx, rig, posture, wrist_k, hock_k, withers):
    part = part.astype(int)
    H = withers
    fore_z = (rig['fore'][2] + rig['hind'][2]) / 2
    legs = {}
    for name in LEGS:
        fore = name[0] == 'F'; left = name[1] == 'L'
        s = ((part == 1) | (part == 2)) & (pw > 0.5) & ((piv[:, 2] > fore_z) == fore) & ((piv[:, 0] > 0) == left)
        if s.sum() < 6: raise SystemExit(f'leg {name}: only {s.sum()} vertices')
        L = P[s]; pv = piv[s][0].copy()
        elbow = pv.copy()                      # the part pivot: the elbow or stifle at the belly line
        low = L[L[:, 1] < 0.08 * elbow[1]]
        toe = np.array([low[:, 0].mean(), 0.0, low[:, 2].mean()])
        k = wrist_k if fore else hock_k
        wy = k * elbow[1]
        band = L[np.abs(L[:, 1] - wy) < 0.12 * elbow[1]]
        if len(band) < 3: band = L[np.abs(L[:, 1] - wy) < 0.25 * elbow[1]]
        wrist = np.array([band[:, 0].mean(), wy, band[:, 2].mean()])
        if posture == 'plantigrade':   # the foot lies flat: its ankle is above the heel, behind the toe
            foot_len = (0.16 if fore else 0.24) * H
            wrist[2] = toe[2] - foot_len * 0.8
        r = max(float(np.ptp(L[np.abs(L[:, 1] - elbow[1] * 0.85) < 0.1 * elbow[1]][:, 0])), float(np.ptp(L[np.abs(L[:, 1] - elbow[1] * 0.85) < 0.1 * elbow[1]][:, 2])), 0.02) / 2
        if fore:
            rise = H - elbow[1]
            top = np.array([elbow[0] * 0.85, elbow[1] + 0.55 * rise, elbow[2] + 0.22 * rise])   # the shoulder joint
        else:
            trunk = P[(part == 0) & (np.abs(P[:, 2] - elbow[2]) < 0.1 * H) & (np.abs(P[:, 0]) < 0.3 * H)]
            rump = float(np.percentile(trunk[:, 1], 95)) if len(trunk) > 5 else rig['tail'][1]
            rise = max(rump - elbow[1], 0.1 * H)
            top = np.array([elbow[0] * 0.85, elbow[1] + 0.5 * rise, elbow[2] - 0.25 * rise])    # the hip joint
        legs[name] = dict(top=top, mid=elbow, low=wrist, toe=toe, r=r, pivot=pv, mask=s)
    hipsP = (legs['HL']['top'] + legs['HR']['top']) / 2; hipsP[0] = 0
    chestP = (legs['FL']['top'] + legs['FR']['top']) / 2; chestP[0] = 0
    hipsP[1] += 0.04 * H; chestP[1] += 0.02 * H       # the spine runs a little above the joints
    spineP = (hipsP + chestP) / 2
    neckP = np.array(rig['head'], float)
    head_mask = (part == 6) & (pw > 0.5)
    hz = P[head_mask]
    nose_z = float(hz[:, 2].max())
    nose = hz[hz[:, 2] > nose_z - 0.03 * H]
    noseP = np.array([0.0, nose[:, 1].mean(), nose_z])
    headP = neckP + (noseP - neckP) * 0.55
    # the tail chain: by edge-path distance from the root over the tail parts
    tail_mask = ((part == 3) | (part == 8)) & (pw > 0.3)
    rootP = np.array(rig['tail'], float)
    tail_idx = np.where(tail_mask)[0]
    tail = {}
    extent = float(np.ptp(P[tail_idx], axis=0).max()) if len(tail_idx) else 0.0
    if len(tail_idx) > 12 and extent > 0.3 * H:   # a real tail; shorter is a stub (the bear)
        d2 = ((P[tail_idx] - rootP) ** 2).sum(axis=1)
        roots = tail_idx[d2 < np.sort(d2)[max(2, len(d2) // 12)]]
        frac, length = arc_fraction(P, idx, tail_idx, roots)
        fr = np.zeros(len(P), np.float32); fr[list(frac.keys())] = list(frac.values())
        def at(t):
            sel = tail_idx[np.abs(fr[tail_idx] - t) < 0.08]
            if len(sel) < 2: sel = tail_idx[np.abs(fr[tail_idx] - t) < 0.2]
            return P[sel].mean(axis=0)
        t1, t2, tip = at(1 / 3), at(2 / 3), at(1.0)
        tail = dict(p=[rootP, t1, t2], tip=tip, frac=fr, length=length)
    else:   # a stub (the bear): a short chain pointing back and down
        d = np.array([0, -0.02, -0.03]) * (H / 0.8)
        tail = dict(p=[rootP, rootP + d, rootP + 2 * d], tip=rootP + 3 * d, frac=None, length=float(np.linalg.norm(3 * d)))
    rest = {'Hips': hipsP, 'Spine': spineP, 'Chest': chestP, 'Neck': neckP, 'Head': headP, 'Tail1': tail['p'][0], 'Tail2': tail['p'][1], 'Tail3': tail['p'][2]}
    for n in LEGS:
        rest[f'UpperLeg.{n}'] = legs[n]['top']; rest[f'LowerLeg.{n}'] = legs[n]['mid']; rest[f'Foot.{n}'] = legs[n]['low']
    return rest, legs, tail, noseP

def weights(P, part, pw, piv, rest, legs, tail, H):
    """(N,4) joint indices and (N,4) weights."""
    part = part.astype(int); n = len(P)
    W = np.zeros((n, len(JOINTS)), np.float32)
    hipsZ, spineZ, chestZ = rest['Hips'][2], rest['Spine'][2], rest['Chest'][2]
    def trunk(i, w):
        z = P[i, 2]
        if z <= hipsZ: W[i, J['Hips']] += w
        elif z >= chestZ: W[i, J['Chest']] += w
        elif z < spineZ:
            t = (z - hipsZ) / (spineZ - hipsZ); W[i, J['Hips']] += w * (1 - t); W[i, J['Spine']] += w * t
        else:
            t = (z - spineZ) / (chestZ - spineZ); W[i, J['Spine']] += w * (1 - t); W[i, J['Chest']] += w * t
    fore_z = (rest['LowerLeg.FL'][2] + rest['LowerLeg.HL'][2]) / 2
    legmask = {name: legs[name]['mask'] for name in LEGS}
    headZ = rest['Head'][2]; neckZ = rest['Neck'][2]
    for i in range(n):
        p = part[i]; w = float(pw[i]); y = P[i, 1]; z = P[i, 2]; x = P[i, 0]
        if p in (1, 2) and w > 0:
            fore = piv[i, 2] > fore_z; left = piv[i, 0] > 0
            name = ('F' if fore else 'H') + ('L' if left else 'R'); L = legs[name]
            ey, wy = L['mid'][1], L['low'][1]
            b = max(0.012, 0.05 * ey)   # the blend band at a joint
            up, lo, ft = J[f'UpperLeg.{name}'], J[f'LowerLeg.{name}'], J[f'Foot.{name}']
            if y < wy - b: W[i, ft] += w
            elif y < wy + b: t = (y - (wy - b)) / (2 * b); W[i, ft] += w * (1 - t); W[i, lo] += w * t
            elif y < ey - b: W[i, lo] += w
            elif y < ey + b: t = (y - (ey - b)) / (2 * b); W[i, lo] += w * (1 - t); W[i, up] += w * t
            else: W[i, up] += w
            if w < 1: trunk(i, 1 - w)
            continue
        if p == 6 and w > 0:
            t = float(smooth(headZ - 0.06 * H, headZ + 0.04 * H, z))
            W[i, J['Head']] += w * t; W[i, J['Neck']] += w * (1 - t)
            if w < 1: trunk(i, 1 - w)
            continue
        if p in (3, 8) and w > 0:
            fr = float(tail['frac'][i]) if tail['frac'] is not None else 0.0
            if fr < 1 / 3: t = fr * 3; W[i, J['Tail1']] += w * (1 - t); W[i, J['Tail2']] += w * t
            elif fr < 2 / 3: t = fr * 3 - 1; W[i, J['Tail2']] += w * (1 - t); W[i, J['Tail3']] += w * t
            else: W[i, J['Tail3']] += w
            if w < 1: W[i, J['Hips']] += 1 - w
            continue
        # the trunk, with the leg columns' upper bones painted into the arm and thigh skin above the elbow and stifle
        rem = 1.0
        for name in LEGS:
            L = legs[name]; top, mid, r = L['top'], L['mid'], L['r']
            if (x > 0) != (name[1] == 'L') or (z > fore_z) != (name[0] == 'F'): continue
            if y < mid[1] - 0.02 * H or y > top[1]: continue
            # distance to the upper bone's axis, in the horizontal
            t = np.clip((y - mid[1]) / max(top[1] - mid[1], 1e-3), 0, 1)
            ax = mid + (top - mid) * t
            d = math.hypot(x - ax[0], z - ax[2])
            k = float(smooth(top[1], mid[1] + 0.02 * H, y)) * float(smooth(r * 1.8, r * 1.0, d))
            if k > 0: W[i, J[f'UpperLeg.{name}']] += k; rem -= k
        if rem > 0: trunk(i, rem)
    # top four, normalised
    order = np.argsort(-W, axis=1)[:, :4]
    ws = np.take_along_axis(W, order, axis=1)
    ws[ws < 0] = 0
    tot = ws.sum(axis=1, keepdims=True); tot[tot == 0] = 1
    ws = ws / tot
    order[ws == 0] = 0
    return order.astype(np.uint8), ws.astype(np.float32)

def main(argv):
    if not argv or argv[0] in ('-h', '--help'): print(__doc__ or open(__file__).read().split('import json')[0]); return 0
    src = argv[0]
    opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
    out = opt('--out', src); dry = '--dry' in argv
    js, bin = load_glb(src)
    ex = js.get('extras') or {}
    rig = ex.get('rig'); species = ex.get('species'); H = float(ex.get('withers_m') or 0)
    if not rig or rig.get('kind') != 'quadruped' or not H: raise SystemExit(f'{src}: no quadruped extras.rig / withers_m')
    row = resolve_loco(species) if species else None
    posture = (row or {}).get('posture') or 'digitigrade'
    D = DEFAULTS.get(posture, DEFAULTS['digitigrade'])
    wrist_k = float(opt('--wrist', D['wrist'])); hock_k = float(opt('--hock', D['hock']))
    print(f'INFO {src}: species {species}, posture {posture}, withers {H} m, wrist {wrist_k} hock {hock_k}')
    W = Writer()
    meshes = []; nodes = []; rest = None; skin_extra = None
    tier_stats = []
    for mesh in js['meshes']:
        pr = mesh['primitives'][0]; A = pr['attributes']
        P = accessor(js, bin, A['POSITION']).astype(np.float32)
        attrs = {k: accessor(js, bin, A[k]).astype(np.float32) for k in A if k != 'POSITION' and not k.startswith(('JOINTS', 'WEIGHTS'))}
        idx = accessor(js, bin, pr['indices']).reshape(-1, 3).astype(np.uint32)
        part = attrs['_PART'][:, 0]; pw = attrs['_PARTW'][:, 0]; piv = attrs['_PIVOT']
        if rest is None:   # the skeleton from lod0, shared by every tier
            rest, legs, tail, nose = skeleton(P, part, pw, piv, idx, rig, posture, wrist_k, hock_k, H)
            for n in JOINTS: print(f'   {n:12s} {np.round(rest[n], 3).tolist()}')
            for n in LEGS: print(f'   toe {n} {np.round(legs[n]["toe"], 3).tolist()}  r {legs[n]["r"]:.3f}')
            print(f'   tail tip {np.round(tail["tip"], 3).tolist()} length {tail["length"]:.3f}; nose {np.round(nose, 3).tolist()}')
        # cut rings at the wrist/hock and at the elbow/stifle, inside each leg part
        n0 = len(P)
        for name in LEGS:
            fore_z = (rig['fore'][2] + rig['hind'][2]) / 2
            fore = name[0] == 'F'; left = name[1] == 'L'
            for y0 in (rest[f'Foot.{name}'][1], rest[f'LowerLeg.{name}'][1] - 0.005):
                p_ = attrs['_PART'][:, 0].astype(int); pw_ = attrs['_PARTW'][:, 0]; pv_ = attrs['_PIVOT']
                allowed = ((p_ == 1) | (p_ == 2)) & (pw_ > 0.3) & ((pv_[:, 2] > fore_z) == fore) & ((pv_[:, 0] > 0) == left)
                P, attrs, idx = bisect(P, attrs, idx, y0, allowed)
        # the tail's arc fractions on this tier (the cut rings have none; recomputed from the tier's own mesh)
        tl = dict(tail)
        if tail['frac'] is not None:   # (a welded graph: see arc_fraction)
            part_t = attrs['_PART'][:, 0].astype(int); pw_t = attrs['_PARTW'][:, 0]
            tmask = ((part_t == 3) | (part_t == 8)) & (pw_t > 0.3); tidx = np.where(tmask)[0]
            rootP = np.array(rig['tail'], float); d2 = ((P[tidx] - rootP) ** 2).sum(axis=1)
            roots = tidx[d2 < np.sort(d2)[max(2, len(d2) // 12)]]
            frac, _ = arc_fraction(P, idx, tidx, roots)
            fr = np.zeros(len(P), np.float32); fr[list(frac.keys())] = list(frac.values()); tl['frac'] = fr
        legs_t = {n: dict(legs[n]) for n in LEGS}
        # the leg masks on this tier (for the painter's quadrant test it uses pivots, not masks)
        ji, wv = weights(P, attrs['_PART'][:, 0], attrs['_PARTW'][:, 0], attrs['_PIVOT'], rest, legs_t, tl, H)
        tier_stats.append((mesh['name'], n0, len(P), len(idx)))
        # write the tier
        new_attrs = {'POSITION': W.acc(P, 5126, 'VEC3', minmax=True)}
        for k, v in attrs.items():
            t = {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[v.shape[1]]
            new_attrs[k] = W.acc(v if v.shape[1] > 1 else v[:, 0], 5126, t)
        new_attrs['JOINTS_0'] = W.acc(ji, 5121, 'VEC4'); new_attrs['WEIGHTS_0'] = W.acc(wv, 5126, 'VEC4')
        big = len(P) > 65535
        ind = W.acc(idx.reshape(-1).astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963)
        meshes.append({'name': mesh['name'], 'primitives': [{'attributes': new_attrs, 'indices': ind, 'mode': 4}]})
        nodes.append({'name': mesh['name'], 'mesh': len(meshes) - 1})
    for name, a, b, t in tier_stats: print(f'TIER {name}: {a} -> {b} vertices, {t} triangles')
    stem = os.path.basename(out).replace('.glb', '')
    r3 = lambda p: [round(float(x), 4) for x in p]
    skin_extra = {
        'joints': JOINTS, 'joint_rest': [r3(rest[n]) for n in JOINTS], 'scale': 1.0, 'offset': [0.0, 0.0, 0.0], 'clips': f'{stem}_clips',
        'rig': 'quadruped-20 (tools/rig_quadruped.py)', 'posture': posture, 'withers_m': H,
        'legs': {n: {'joints': [J[f'UpperLeg.{n}'], J[f'LowerLeg.{n}'], J[f'Foot.{n}']], 'toe': r3(legs[n]['toe'])} for n in LEGS},
        'tail_tip': r3(tail['tip']), 'nose': r3(nose), 'wrist_k': wrist_k, 'hock_k': hock_k,
    }
    while len(W.buf) % 4: W.buf.append(0)
    ex = dict(ex); ex['skin'] = skin_extra
    g = {'asset': js['asset'], 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
         'accessors': W.accs, 'bufferViews': W.views, 'buffers': [{'byteLength': len(W.buf)}], 'extras': ex}
    g['asset']['generator'] = (js['asset'].get('generator') or '') + ' + tools/rig_quadruped.py'
    if dry: print('DRY RUN: not written'); return 0
    jb = json.dumps(g, separators=(',', ':')).encode()
    while len(jb) % 4: jb += b' '
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(W.buf)) + struct.pack('<I4s', len(jb), b'JSON') + jb + struct.pack('<I4s', len(W.buf), b'BIN\x00') + bytes(W.buf)
    open(out, 'wb').write(glb)
    print(f'WROTE {out} {len(glb)} bytes')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
