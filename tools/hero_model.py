#!/usr/bin/env python3
# The hero tier of an animal: the Meshy source's surface and texture on a clean mesh that carries the game's own skeleton,
# so the leg engine (client/src/gait.js) poses it unchanged. No new rigging and nothing per species.
#
#   arch -arm64 .venv/bin/python tools/hero_model.py <species_code> [--tris 20000] [--bake 2048] [--ao 1024]
#       [--job <meshy job dir>] [--game <rigged glb>] [--out client/assets/hero] [--no-render] [--sheet-dir <dir>]
#
# Inputs: the species' Meshy refine (library/animals/jobs/<code>/<task>/model.glb and texture_base_color.png; the task is
# the game model's extras.meshy_task; the job files live in the main checkout) and the game's rigged GLB
# (client/assets/fauna/<code>.glb: tools/build_quadruped.py, then tools/rig_quadruped.py).
#
# Steps:
#  1. align: the source's glTF coordinates to the game's frame (+z forward, +y up, feet on y = 0, metres) by a similarity
#     (the build only scaled, centred and perhaps turned the source): principal axes and extents for a start (the four
#     proper sign choices tried), then trimmed ICP with scale (Umeyama) of the game's lod0 vertices against the source's
#     welded vertices. Residual: the game's vertices' point-to-plane distance to the aligned source.
#  2-3. tools/hero_model_blender.py build (Blender, headless): clean, decimate to --tris, a new region-and-seam unwrap, the
#     bakes (base colour and tangent-space normal from the dense source, AO on the hero), lod1 (a third) and lod2 (a
#     tenth) sharing the UVs.
#  4. rig: the hero's own weights from the game's skeleton. The tail from the hero mesh (its tip the far end from the
#     mid-back, cross-sections back to where they widen into the rump; the game's Tail1-3 kept when they span it, else
#     moved to thirds of its centreline); the ears (the head's furred, non-horn protrusions, the highest a side) as
#     joints 20 and 21 carried by the Head. Bone heat (Blender's automatic weights) on the welded lod0, then the trunk's
#     Hips/Spine/Chest split smoothed far, the neck split along Neck -> Head, the tail by arc length, the ears falling
#     into the Head at their base; four influences. The game's weights by nearest surface are the fallback and the
#     comparison: both are posed by the same bone matrices in eight tests (fore leg 40 fwd / 30 back, hind 35 fwd / 40
#     back, head 60 turned and lowered, sit, gallop flex, a walk) and the one with fewer inverted faces and less stretch
#     is written (--weights transfer|heat forces one). lod1 and lod2 take lod0's by nearest vertex.
#  5. fur: a hair-length factor per vertex, 0 (bare) to 1 (longest), in TEXCOORD_1.x (TEXCOORD_1.y is 0, reserved),
#     led by geometry: how far the dense source stands off the clean hero surface (the baked normal map's tilt, smoothed)
#     and how its normals scatter; capped only on bare parts (hooves and pads, the nose, thin edges).
#  6. maps beside the GLB, referenced by relative URI: <code>_color.jpg (sRGB), <code>_normal.png (tangent space, glTF's
#     +Y up, MikkTSpace on the file's TANGENT), <code>_ao.jpg (R = occlusion, on TEXCOORD_0).
#  Then (unless --no-render) the verification renders and the sheet hero_<code>_sheet.jpg.
#
# Output: client/assets/hero/<code>.glb: nodes lod0, lod1, lod2 (as the game's tiers, so animalModels.js loadTiers reads
# it), each one triangle primitive with POSITION, NORMAL, TANGENT, TEXCOORD_0, TEXCOORD_1 (fur), JOINTS_0 (u8),
# WEIGHTS_0 (u8 normalised), one shared material (baseColor, normal, occlusion textures); extras = the game GLB's extras
# with its skin block extended: clips made relative to this folder ('../fauna/<code>_clips'); Ear.L / Ear.R appended
# (joints 20, 21) with skin.ears = {L: {joint, tip}, R: ...} when ears are found; Tail1-3 rows and tail_tip corrected
# when the game's were a stub (extras.hero.skin_changes lists the rows). client/assets/hero/index.json is updated.
import json, math, os, struct, subprocess, sys, time, shutil
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from scipy import sparse
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
SCRATCH = Path(os.environ.get('HERO_WORK', '/private/tmp/claude-501/-Users-aaronbrodeur-Sites-wild-earth--claude-worktrees-angry-darwin-f5a92b/15c0cd17-42b0-4e64-950f-b2e5d7088348/scratchpad/hero'))
SHEETS = Path.home() / 'Library/Application Support/Claude/side-session-notes/local_c8e1cd12-f981-4478-859b-711fe38bcb3c/avatar-realism-captures'

# ---- glTF ----------------------------------------------------------------------------------------------------------
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
    return np.frombuffer(bin, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n).astype(np.float64)
def prim(js, bin, mesh=0):
    pr = js['meshes'][mesh]['primitives'][0]
    d = {k: accessor(js, bin, v) for k, v in pr['attributes'].items()}
    d['indices'] = accessor(js, bin, pr['indices']).reshape(-1, 3).astype(np.int64)
    return d

class Writer:
    def __init__(self): self.buf = bytearray(); self.views = []; self.accs = []
    def acc(self, arr, ctype, atype, target=34962, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        while len(self.buf) % 4: self.buf.append(0)
        self.views.append({'buffer': 0, 'byteOffset': len(self.buf), 'byteLength': arr.nbytes, 'target': target}); self.buf.extend(arr.tobytes())
        a = {'bufferView': len(self.views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if normalized: a['normalized'] = True
        if minmax: a['min'] = [float(x) for x in arr.min(axis=0)]; a['max'] = [float(x) for x in arr.max(axis=0)]
        self.accs.append(a); return len(self.accs) - 1

# ---- paths ---------------------------------------------------------------------------------------------------------
def main_checkout():
    try:
        common = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--git-common-dir'], capture_output=True, text=True).stdout.strip()
        p = Path(common if os.path.isabs(common) else ROOT / common).resolve().parent
        return p
    except Exception: return ROOT

def find_job(code, task):
    for base in (ROOT, main_checkout()):
        d = base / 'library' / 'animals' / 'jobs' / code / task
        if (d / 'model.glb').exists() and (d / 'texture_base_color.png').exists(): return d
    raise SystemExit(f'{code}: no job directory with model.glb and texture_base_color.png for task {task}')

# ---- 1. alignment --------------------------------------------------------------------------------------------------
def weld(P, tol=1e-6):
    k = np.round(P / tol).astype(np.int64)
    _, idx, inv = np.unique(k, axis=0, return_index=True, return_inverse=True)
    return P[idx], idx, inv.reshape(-1)

def umeyama(A, B):
    """s, R, t minimising |s R A + t - B|."""
    ma, mb = A.mean(0), B.mean(0); a, b = A - ma, B - mb
    U, S, Vt = np.linalg.svd(b.T @ a / len(A))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt; s = np.trace(np.diag(S) @ D) / (a ** 2).sum(1).mean()
    return s, R, mb - s * R @ ma

def align(S, SN, G):
    cs, cg = S.mean(0), G.mean(0)
    ls, Es = np.linalg.eigh(np.cov((S - cs).T)); lg, Eg = np.linalg.eigh(np.cov((G - cg).T))
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            D = np.diag([sx, sy, sx * sy])
            R = Eg @ D @ Es.T
            if np.linalg.det(R) < 0: R = Eg @ np.diag([sx, sy, -sx * sy]) @ Es.T
            s = math.sqrt(lg.sum() / ls.sum()); t = cg - s * R @ cs
            for it in range(60):
                T = s * S @ R.T + t
                d, j = cKDTree(T).query(G)
                keep = d <= np.percentile(d, 90)
                s2, R2, t2 = umeyama(S[j[keep]], G[keep])
                done = abs(s2 - s) < 1e-7 and np.abs(t2 - t).max() < 1e-7
                s, R, t = s2, R2, t2
                if done: break
            T = s * S @ R.T + t; d, j = cKDTree(T).query(G)
            rms = float(np.sqrt((d[d <= np.percentile(d, 90)] ** 2).mean()))
            if best is None or rms < best[0]: best = (rms, s, R, t)
    rms, s, R, t = best
    T = s * S @ R.T + t; TN = SN @ R.T
    d, j = cKDTree(T).query(G)
    pp = np.abs(((G - T[j]) * TN[j]).sum(1))
    M = np.eye(4); M[:3, :3] = s * R; M[:3, 3] = t
    ang = math.degrees(math.acos(max(-1, min(1, (np.trace(R) - 1) / 2))))
    return M, {'scale': round(float(s), 5), 'rotation_deg': round(ang, 2),
               'point_to_plane_mm': {'median': round(float(np.median(pp)) * 1000, 2), 'p95': round(float(np.percentile(pp, 95)) * 1000, 2), 'rms': round(float(np.sqrt((pp ** 2).mean())) * 1000, 2)},
               'point_to_point_mm': {'median': round(float(np.median(d)) * 1000, 2), 'p95': round(float(np.percentile(d, 95)) * 1000, 2)}}

# ---- 4. skin transfer ----------------------------------------------------------------------------------------------
def dense_weights(g, nj):
    W = np.zeros((len(g['POSITION']), nj))
    ji = g['JOINTS_0'].astype(int); wv = g['WEIGHTS_0']
    for k in range(4): np.add.at(W, (np.arange(len(W)), ji[:, k]), wv[:, k])
    return W

def sample_surface(P, T, W, spacing):
    """Points on every triangle on a barycentric grid no coarser than `spacing`, with the triangle's normal and the
    barycentrically interpolated weights."""
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    n = np.cross(b - a, c - a); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    edge = np.maximum.reduce([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)])
    lev = np.clip(np.ceil(edge / spacing), 1, 40).astype(int)
    pts, nrm, wts = [], [], []
    for L in np.unique(lev):
        sel = np.where(lev == L)[0]
        bc = np.array([(i / L, j / L) for i in range(L + 1) for j in range(L + 1 - i)])
        u, v = bc[:, 0], bc[:, 1]; w = 1 - u - v
        ta, tb, tc = T[sel, 0], T[sel, 1], T[sel, 2]
        pts.append((P[ta][:, None] * w[None, :, None] + P[tb][:, None] * u[None, :, None] + P[tc][:, None] * v[None, :, None]).reshape(-1, 3))
        nrm.append(np.repeat(n[sel], len(bc), axis=0))
        wts.append((W[ta][:, None] * w[None, :, None] + W[tb][:, None] * u[None, :, None] + W[tc][:, None] * v[None, :, None]).reshape(-1, W.shape[1]))
    return np.concatenate(pts), np.concatenate(nrm), np.concatenate(wts)

def nearest_compatible(tree, SN, X, XN, k=16, cos_min=0.2):
    d, j = tree.query(X, k=k)
    dots = np.einsum('nkc,nc->nk', SN[j], XN)
    ok = dots > cos_min
    first = np.where(ok.any(1), ok.argmax(1), 0)
    return j[np.arange(len(X)), first], d[np.arange(len(X)), first], ok.any(1)

def adjacency(T, vid):
    """Row-normalised adjacency over welded vertices (vid) and the map split vertex -> welded index."""
    u, inv = np.unique(vid, return_inverse=True); n = len(u); tw = inv[T]
    e = np.concatenate([tw[:, [0, 1]], tw[:, [1, 2]], tw[:, [2, 0]]]); e = np.concatenate([e, e[:, ::-1]])
    A = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr(); A.data[:] = 1
    deg = np.asarray(A.sum(1)).reshape(-1); A = sparse.diags(1 / np.maximum(deg, 1)) @ A
    return A, inv, n

def welded_mean(X, inv, n):
    S = np.zeros((n,) + X.shape[1:]); np.add.at(S, inv, X); c = np.bincount(inv, minlength=n).reshape((-1,) + (1,) * (X.ndim - 1))
    return S / np.maximum(c, 1)

def smooth(X, A, iters, lam=0.5):
    for _ in range(iters): X = (1 - lam) * X + lam * (A @ X)
    return X

def top4(W):
    order = np.argsort(-W, axis=1)[:, :4]; ws = np.clip(np.take_along_axis(W, order, axis=1), 0, None)
    ws /= np.maximum(ws.sum(1, keepdims=True), 1e-12)
    q = np.round(ws * 255).astype(np.int64)
    q[:, 0] += 255 - q.sum(1)   # the bytes sum to exactly 255
    order[q == 0] = 0
    return order.astype(np.uint8), q.astype(np.uint8)

# ---- 5. fur --------------------------------------------------------------------------------------------------------
def smoothstep(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# ---- the hero's own rig: tail, ears, bone-heat weights, the pose tests ----------------------------------------------
from scipy.sparse.csgraph import dijkstra, connected_components
LEGS = ['FL', 'FR', 'HL', 'HR']

def parents_of(names):
    P = {'Spine': 'Hips', 'Chest': 'Spine', 'Neck': 'Chest', 'Head': 'Neck', 'Tail1': 'Hips', 'Tail2': 'Tail1', 'Tail3': 'Tail2', 'Ear.L': 'Head', 'Ear.R': 'Head'}
    for L in LEGS:
        P[f'UpperLeg.{L}'] = 'Chest' if L[0] == 'F' else 'Hips'; P[f'LowerLeg.{L}'] = f'UpperLeg.{L}'; P[f'Foot.{L}'] = f'LowerLeg.{L}'
    return [names.index(P[n]) if n in P else None for n in names]

def edge_graph(Pw, Tw):
    e = np.unique(np.sort(np.concatenate([Tw[:, [0, 1]], Tw[:, [1, 2]], Tw[:, [2, 0]]]), 1), axis=0)
    w = np.maximum(np.linalg.norm(Pw[e[:, 0]] - Pw[e[:, 1]], axis=1), 1e-9)
    G = sparse.coo_matrix((w, (e[:, 0], e[:, 1])), shape=(len(Pw),) * 2).tocsr()
    return (G + G.T).tocsr(), e

def geodesic(G, src, limit=np.inf):
    return dijkstra(G, directed=False, indices=np.atleast_1d(src), min_only=True, limit=limit)

def find_tail(Pw, G, Wg, names, rest, H):
    """The tail from the hero mesh: its tip the vertex behind the hips, near the midline, off the ground and not on a leg
    that lies farthest over the surface from the mid-back; cross-sections are the bands of surface distance from the tip, each
    one's centre a point of the centreline; the root where a band's radius jumps (the rump). None for a stub (under 30% of
    the withers)."""
    J = {n: i for i, n in enumerate(names)}
    legc = [J[f'{b}.{L}'] for L in LEGS for b in ('UpperLeg', 'LowerLeg', 'Foot')]
    hips = rest[J['Hips']]
    cand = (Pw[:, 2] < hips[2]) & (np.abs(Pw[:, 0]) < 0.2 * H) & (Pw[:, 1] > 0.06 * H) & (Wg[:, legc].sum(1) < 0.5)
    if not cand.any(): return None, {'found': False, 'why': 'no candidate behind the hips'}
    r0 = int(np.argmin(np.linalg.norm(Pw - rest[J['Spine']], axis=1)))   # the mid-back: the tail's tip is the far end from it
    d0 = geodesic(G, r0)
    ci = np.where(cand & np.isfinite(d0))[0]; tip = int(ci[np.argmax(d0[ci])])
    dt = geodesic(G, tip)
    step = 0.015 * H; cents, radii, dists, D = [], [], [], None; cap = int(0.08 * H / step)   # past the tip's cap the tail is a tube
    mx = float(np.max(dt[np.isfinite(dt)]))
    for b in range(int(mx / step) + 1):
        sel = (dt >= b * step) & (dt < (b + 1) * step)
        if sel.sum() < 3: continue
        c = Pw[sel].mean(0); r = float(np.linalg.norm(Pw[sel] - c, axis=1).mean())
        if len(radii) > cap + 2 and r > 1.5 * np.median(radii[cap:]) and r > 0.03 * H: D = b * step; break
        cents.append(c); radii.append(r); dists.append((b + 0.5) * step)
    if D is None or len(cents) < 4: return None, {'found': False, 'why': 'no root found'}
    C = np.array(cents); seg = np.linalg.norm(np.diff(C, axis=0), axis=1); arc_tip = np.concatenate([[0], np.cumsum(seg)])
    length = float(arc_tip[-1])
    info = {'found': length > 0.3 * H, 'length_m': round(length, 3), 'radius_m': round(float(np.median(radii)), 4), 'bands': len(C)}
    if length <= 0.3 * H: info['why'] = 'a stub'; return None, info
    if np.median(radii) > 0.1 * H: info.update(found=False, why='too thick for a tail (a haunch)'); return None, info
    mask = dt < D
    # each tail vertex's arc parameter, 0 at the root to 1 at the tip
    s = np.zeros(len(Pw)); s[mask] = 1 - np.interp(dt[mask], dists, arc_tip) / length
    cl = C[::-1]; arc = length - arc_tip[::-1]   # root -> tip
    at = lambda f: np.array([np.interp(f * length, arc, cl[:, k]) for k in range(3)])
    return {'mask': mask, 's': s, 'centre': cl, 'arc': arc, 'length': length, 'joints': [at(0), at(1 / 3), at(2 / 3)], 'tip': cl[-1]}, info

def protrusion(Gh, Ph, tip, step):
    """From a tip vertex over a sub-mesh: bands of surface distance, each band's centre and mean radius; the root where a
    band's radius passes 1.4 times the median of those before it. Returns (D the root's distance, centres tip->root)."""
    dt = geodesic(Gh, tip); mx = float(np.max(dt[np.isfinite(dt)])); cents, radii = [], []
    for b in range(int(mx / step) + 1):
        sel = (dt >= b * step) & (dt < (b + 1) * step)
        if sel.sum() < 3: continue
        c = Ph[sel].mean(0); r = float(np.linalg.norm(Ph[sel] - c, axis=1).mean())
        if len(radii) >= 3 and r > 1.4 * np.median(radii): return b * step, np.array(cents), dt
        cents.append(c); radii.append(r)
    return len(radii) * step, np.array(cents) if cents else Ph[[tip]], dt

def find_ears(Pw, G, rough, stand, lum, Wg, names, rest, nose, H):
    """Ears: the head's protrusions (tips taken in turn as the farthest point from the head joint, each grown
    back from its tip until its cross-section widens into the skull), kept when longer than 5% of the withers, tipped
    above the head joint, far from the nose, furred (its normals scatter) and not bare keratin (a horn: its outer part over 6 times as
    light as the head's coat in the baked colour); the highest a side.
    Returns {side: {base, tip, k (the ear's weight per vertex: 1 on the ear, falling to 0 into the Head over the root's
    band), n}}."""
    J = {n: i for i, n in enumerate(names)}; hd = rest[J['Head']]; hl = float(np.linalg.norm(nose - rest[J['Neck']]))
    head = np.where(Wg[:, J['Head']] > 0.3)[0]
    if len(head) < 30: return {}, {'why': 'no head region'}
    Gh = G[head][:, head]; Ph = Pw[head]
    dg = np.linalg.norm(Ph - hd, axis=1)   # the tips in turn: the farthest from the skull's centre
    used = np.zeros(len(head), bool); out, cands = {}, []
    for it in range(16):
        c_ = np.where(~used)[0]
        if not len(c_): break
        tip = int(c_[np.argmax(dg[c_])])
        D, C, dt = protrusion(Gh, Ph, tip, 0.01 * H)
        m = dt < D; used |= dt < max(D * 1.3, 0.02 * H)
        if m.sum() < 8: continue
        base = C[-1]; tipv = Ph[tip]; rgh = float(np.median(rough[head][m])); stn = float(np.median(stand[head][m]))
        mt = dt < 0.4 * D; stn_tip = float(np.median(stand[head][mt]))
        lum_ratio = float(np.median(lum[head][mt]) / max(np.median(lum[head]), 1e-4))   # a horn's bare keratin against the head's coat
        side = 'L' if tipv[0] > hd[0] else 'R'
        ok = D > 0.05 * H and tipv[1] > hd[1] and np.linalg.norm(tipv - nose) > 0.5 * hl and rgh > 0.08 and lum_ratio < 6
        cands.append({'side': side, 'n': int(m.sum()), 'length_over_withers': round(D / H, 3), 'rough': round(rgh, 3), 'stand': round(stn, 4), 'stand_tip': round(stn_tip, 4), 'lum_ratio': round(lum_ratio, 2), 'tip': [round(float(x), 3) for x in tipv], 'ear': bool(ok)})
        if ok and (side not in out or out[side]['tip'][1] < tipv[1]):   # the highest furred protrusion a side
            k = np.zeros(len(Pw)); k[head] = np.where(np.isfinite(dt), smoothstep(1.15 * D, 0.8 * D, np.nan_to_num(dt, posinf=9e9)), 0)
            out[side] = {'base': base, 'tip': tipv, 'k': k, 'n': int(m.sum())}
    return out, {'candidates': cands}

def heat_tails(names, rest, sk, tail_tip, ear_tips):
    """Bone tails for the heat solve only (skinning turns about the heads): each joint toward its child, the chest
    forward along the spine, the foot to the toe, the head to the nose, the last tail joint to the tip, an ear to its tip."""
    J = {n: i for i, n in enumerate(names)}; T = rest.copy()
    kid = {'Hips': 'Spine', 'Spine': 'Chest', 'Neck': 'Head', 'Tail1': 'Tail2', 'Tail2': 'Tail3'}
    for L in LEGS: kid[f'UpperLeg.{L}'] = f'LowerLeg.{L}'; kid[f'LowerLeg.{L}'] = f'Foot.{L}'
    for n, i in J.items():
        if n in kid: T[i] = rest[J[kid[n]]]
        elif n == 'Chest': T[i] = rest[i] + (rest[i] - rest[J['Spine']]) * 0.5
        elif n == 'Head': T[i] = np.array(sk['nose'])
        elif n == 'Tail3': T[i] = tail_tip
        elif n.startswith('Foot.'): T[i] = np.array(sk['legs'][n[5:]]['toe'])
        elif n.startswith('Ear.'): T[i] = ear_tips[n[4:]]
        if np.linalg.norm(T[i] - rest[i]) < 1e-3: T[i] = rest[i] + np.array([0, 0.02, 0])
    return T

def trunk_and_neck(W, A, Pw, HJ, rest, nose, iters=40):
    """Two corrections to the heat weights. The trunk: how a vertex's trunk share is split between Hips, Spine and Chest
    is smoothed far over the surface (the share itself kept), so the back bends as one curve, not at three creases. The
    neck: the share Neck and Head hold, ahead of the neck's base, is split by the vertex's place along the neck (its
    projection on Neck -> Head): all Neck at the base, all Head from the head joint on, linear between, so a turned head
    twists the neck along its length and the skull turns whole."""
    W = W.copy()
    tc = [HJ['Hips'], HJ['Spine'], HJ['Chest']]; T = W[:, tc].sum(1, keepdims=True)
    q_ = W[:, tc] / np.maximum(T, 1e-9); q_[T[:, 0] < 1e-6] = 1 / 3
    q_ = smooth(q_, A, iters); q_ /= q_.sum(1, keepdims=True); W[:, tc] = q_ * T
    n0, h0 = rest[HJ['Neck']], rest[HJ['Head']]; ax = h0 - n0; L = float(np.linalg.norm(ax)); ax /= L
    u = (Pw - n0) @ ax / L                      # 0 at the neck's base, 1 at the head joint
    m = W[:, HJ['Neck']] + W[:, HJ['Head']]
    k = smoothstep(-0.25, 0.1, u) * (m > 1e-6)  # blend in just behind the base
    t = np.clip(u, 0, 1)
    W[:, HJ['Neck']] = (1 - k) * W[:, HJ['Neck']] + k * m * (1 - t)
    W[:, HJ['Head']] = (1 - k) * W[:, HJ['Head']] + k * m * t
    return W / np.maximum(W.sum(1, keepdims=True), 1e-12)

def rotm(ax, deg):
    a = math.radians(deg); c, s_ = math.cos(a), math.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]]), 'y': np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]]),
            'z': np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])}[ax]

# the pose tests, degrees about the rest frame's axes applied on the parent's (glTF: x the animal's left, y up, z forward;
# positive about x swings a hanging limb back and pitches the front down; positive about y turns the front to the left)
_SIT = {'Hips': [('x', -40)], '__sit': 40, 'UpperLeg.FL': [('x', 40)], 'UpperLeg.FR': [('x', 40)], 'Tail1': [('x', 35)]}
for _L in ('HL', 'HR'): _SIT.update({f'UpperLeg.{_L}': [('x', -50)], f'LowerLeg.{_L}': [('x', 120)], f'Foot.{_L}': [('x', -110)]})
POSES = {
    'fore_fwd': {'UpperLeg.FL': [('x', -40)], 'LowerLeg.FL': [('x', 10)]},
    'fore_back': {'UpperLeg.FL': [('x', 30)], 'Foot.FL': [('x', 40)]},
    'hind_fwd': {'UpperLeg.HL': [('x', -35)], 'LowerLeg.HL': [('x', 20)]},
    'hind_back': {'UpperLeg.HL': [('x', 40)], 'Foot.HL': [('x', -20)]},
    'head_down': {'Chest': [('x', 20)], 'UpperLeg.FL': [('x', -20)], 'UpperLeg.FR': [('x', -20)], 'Neck': [('y', 35), ('x', 30)], 'Head': [('y', 25), ('x', 15)]},
    'sit': _SIT,
    'gallop': {'Spine': [('x', 15)], 'Chest': [('x', 15)], 'UpperLeg.FL': [('x', 35)], 'UpperLeg.FR': [('x', 25)], 'UpperLeg.HL': [('x', -35)], 'UpperLeg.HR': [('x', -25)]},
    'walk': {'UpperLeg.FL': [('x', -40)], 'LowerLeg.FL': [('x', 15)], 'Foot.FL': [('x', 55)], 'UpperLeg.HR': [('x', -20)], 'LowerLeg.HR': [('x', 50)],
             'Foot.HR': [('x', -45)], 'Neck': [('y', 28)], 'Head': [('y', 14)], 'Tail1': [('x', 20)]},
}
EAR_POSE = {'Ear.L': [('x', -35), ('z', -25)], 'Ear.R': [('x', -35), ('z', 25)], 'Tail1': [('x', 25)], 'Tail2': [('x', 20)]}

def bone_mats(names, rest, pose):
    """Each joint's [R | p - R q] (gait.js). '__sit': the trunk pitched that many degrees nose-up about the hips is
    lowered and moved forward so the shoulders stay where they were (the hips go down, as in a sit)."""
    par = parents_of(names); R = [None] * len(names); p = rest.copy(); M = np.zeros((len(names), 3, 4))
    J = {n: i for i, n in enumerate(names)}; t0 = np.zeros(3)
    if pose.get('__sit'):
        a = math.radians(pose['__sit']); v = rest[J['Chest']] - rest[J['Hips']]
        t0 = v - rotm('x', -pose['__sit']) @ v   # the chest back where it stood
    for j, n in enumerate(names):
        Ri = np.eye(3)
        for ax, deg in pose.get(n, []): Ri = Ri @ rotm(ax, deg)
        if par[j] is None: R[j] = Ri; p[j] = rest[j] + t0
        else: R[j] = R[par[j]] @ Ri; p[j] = p[par[j]] + R[par[j]] @ (rest[j] - rest[par[j]])
        M[j, :, :3] = R[j]; M[j, :, 3] = p[j] - R[j] @ rest[j]
    return M

def lbs(P, N, ji, wf, M):
    B = np.einsum('nk,nkij->nij', wf, M[ji])
    P2 = np.einsum('nij,nj->ni', B[:, :, :3], P) + B[:, :, 3]
    N2 = np.einsum('nij,nj->ni', B[:, :, :3], N); N2 /= np.maximum(np.linalg.norm(N2, axis=1, keepdims=True), 1e-12)
    return P2, N2, B[:, :, :3]

def tri_area(P, T): return 0.5 * np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1)
def volume(P, T): return float(np.einsum('ij,ij->i', P[T[:, 0]], np.cross(P[T[:, 1]], P[T[:, 2]])).sum() / 6)

def between_legs(Pw, Tw, names, rest, H, fore):
    """Faces at rest in the gap between a pair of legs: inside the inner half of their spacing, below the elbows or
    stifles, within the legs' length along the body."""
    J = {n: i for i, n in enumerate(names)}; a, b = ('FL', 'FR') if fore else ('HL', 'HR')
    xa, xb = rest[J[f'Foot.{a}']][0], rest[J[f'Foot.{b}']][0]; xc = (xa + xb) / 2; hw = 0.35 * abs(xa - xb)
    ytop = (rest[J[f'LowerLeg.{a}']][1] + rest[J[f'LowerLeg.{b}']][1]) / 2
    zs = [rest[J[f'{bb}.{L}']][2] for L in (a, b) for bb in ('UpperLeg', 'LowerLeg', 'Foot')]
    c = Pw[Tw].mean(1)
    return (np.abs(c[:, 0] - xc) < hw) & (c[:, 1] < ytop) & (c[:, 2] > min(zs) - 0.1 * H) & (c[:, 2] < max(zs) + 0.1 * H)

def pose_metrics(Pw, Nw, Tw, E, ji, wf, names, rest, pose, boxes):
    M = bone_mats(names, rest, pose); P2, N2, B = lbs(Pw, Nw, ji, wf, M)
    l0 = np.linalg.norm(Pw[E[:, 0]] - Pw[E[:, 1]], axis=1); r = np.linalg.norm(P2[E[:, 0]] - P2[E[:, 1]], axis=1) / l0
    n0 = np.cross(Pw[Tw[:, 1]] - Pw[Tw[:, 0]], Pw[Tw[:, 2]] - Pw[Tw[:, 0]])
    n1 = np.cross(P2[Tw[:, 1]] - P2[Tw[:, 0]], P2[Tw[:, 2]] - P2[Tw[:, 0]])
    ref = np.einsum('nij,nj->ni', B[Tw].mean(1), n0)
    a0, a1 = tri_area(Pw, Tw), tri_area(P2, Tw)
    out = {'stretch_max': round(float(r.max()), 2), 'stretch_p99.9': round(float(np.percentile(r, 99.9)), 2), 'shrink_min': round(float(r.min()), 3),
           'inverted_faces': int((np.einsum('ij,ij->i', n1, ref) < 0).sum()),
           'volume_change_pct': round(100 * (volume(P2, Tw) / volume(Pw, Tw) - 1), 2)}
    for k, m in boxes.items(): out[f'area_{k}'] = round(float(a1[m].sum() / max(a0[m].sum(), 1e-12)), 3)
    return out, P2, N2

def bone_heat(work, Pw, Tw, names, rest, tails, Lm, H, jobd):
    np.savez_compressed(work / 'heat.npz', P=Pw.astype(np.float32), T=Tw.astype(np.int32))
    jh = dict(jobd); jh['skeleton'] = {'names': names, 'heads': rest.tolist(), 'tails': tails.tolist(), 'parents': parents_of(names)}
    jf = work / 'job_heat.json'; json.dump(jh, open(jf, 'w'))
    run_blender('heat', jf, work / 'heat.log')
    W = np.load(work / 'heat_out.npz')['W']
    zero = int((W.sum(1) <= 1e-6).sum())
    return W, zero

def arc_weights(s, stations, cols, nj):
    """Weights along the tail: each vertex between the two joints whose arc parameters bracket its own, linearly."""
    W = np.zeros((len(s), nj)); st = np.array(stations)
    for i, x in enumerate(s):
        if x <= st[0]: W[i, cols[0]] = 1; continue
        k = int(np.searchsorted(st, x)) - 1
        if k >= len(st) - 1: W[i, cols[-1]] = 1; continue
        t = (x - st[k]) / max(st[k + 1] - st[k], 1e-9); W[i, cols[k]] += 1 - t; W[i, cols[k + 1]] += t
    return W

# ---- 5'. fur from geometry -------------------------------------------------------------------------------------------
def standoff_map(normal_png, sigma=8):
    """How far the dense source stands off the clean hero surface, from the baked tangent-space normal map: 1 - n.z (0
    where the source lies along the hero, larger where its modelled locks, tufts and clumps tilt away), averaged over
    about sigma texels (normalised convolution over the used texels only)."""
    from scipy.ndimage import gaussian_filter
    nm = np.asarray(Image.open(normal_png).convert('RGB'), np.float64) / 255 * 2 - 1
    used = (np.linalg.norm(nm, axis=2) > 0.5).astype(np.float64)
    dev = (1 - np.clip(nm[..., 2], 0, 1)) * used
    return gaussian_filter(dev, sigma) / np.maximum(gaussian_filter(used, sigma), 1e-6)

def sample_map(img, uv):
    h, w = img.shape[:2]
    return img[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]

def hair_geometry(Pw, thick, rough, stand, nose, H, A):
    """Geometry leads: long where the dense source stands off the clean surface (its modelled hair: 'stand', the normal
    map's tilt) or its normals scatter ('rough'), short where it is smooth; the body regions only cap the bare parts: the
    hooves and pads (the lowest 5% of the withers), the nose (within 8% of the withers of its tip) and thin edges."""
    g = np.maximum(smoothstep(0.002, 0.03, stand), 0.6 * smoothstep(0.25, 0.7, rough))
    g = 0.08 + 0.92 * g
    cap = 0.12 + 0.88 * smoothstep(0.02 * H, 0.07 * H, Pw[:, 1])
    cap = np.minimum(cap, 0.1 + 0.9 * smoothstep(0.04 * H, 0.12 * H, np.linalg.norm(Pw - nose, axis=1)))
    cap = np.minimum(cap, 0.3 + 0.7 * smoothstep(0.008 * H, 0.025 * H, thick))
    return np.clip(smooth((g * cap)[:, None], A, 4)[:, 0], 0, 1)

# ---- baked lighting --------------------------------------------------------------------------------------------------
def lighting(img, uv, N):
    """Sample the baked colour at the hero vertices; regress luminance on the normal. A coat is left-right symmetric, so
    a clear x term is baked directional light; the up-down term mixes baked sky light with real countershading."""
    a = np.asarray(img, np.float64) / 255; hgt, wid = a.shape[:2]
    x = np.clip((uv[:, 0] * wid).astype(int), 0, wid - 1); y = np.clip((uv[:, 1] * hgt).astype(int), 0, hgt - 1)
    c = a[y, x, :3]; lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    L = lin @ np.array([0.2126, 0.7152, 0.0722])
    X = np.concatenate([np.ones((len(N), 1)), N], 1); coef, *_ = np.linalg.lstsq(X, L, rcond=None)
    up, dn = L[N[:, 1] > 0.6].mean(), L[N[:, 1] < -0.6].mean()
    lf, rt = L[N[:, 0] > 0.6].mean(), L[N[:, 0] < -0.6].mean()
    return {'luminance_mean': round(float(L.mean()), 4), 'per_normal_coef_xyz_over_mean': [round(float(v / coef[0]), 3) for v in coef[1:]],
            'back_over_belly': round(float(up / max(dn, 1e-6)), 3), 'left_over_right': round(float(lf / max(rt, 1e-6)), 3)}

# ---- the sheet -------------------------------------------------------------------------------------------------------
def sheet(cells, code, stats, path):
    from PIL import ImageDraw, ImageFont
    w = stats.get('weights', 'heat'); te = stats.get('pose_tests', {})
    def lab(m, p):
        t = te.get(m, {}).get(p, {}); return f"{'game weights' if m == 'transfer' else 'bone heat'}: stretch {t.get('stretch_max', '?')}, inverted {t.get('inverted_faces', '?')}"
    rows = [('side', ['source_side', 'game_side', 'hero_side']), ('three-quarter front', ['source_threequarter', 'game_threequarter', 'hero_threequarter']),
            ('head', ['source_head', 'game_head', 'hero_head']), ('fore leg 40 fwd', ['transfer_fore_fwd', 'heat_fore_fwd', 'win_hind_back']),
            ('sit', ['transfer_sit', 'heat_sit', 'win_gallop']), ('head 60 turned, lowered', ['transfer_head_down', 'heat_head_down', 'win_ears'])]
    heads = [['source (Meshy refine)', 'game (current)', 'hero'], ['', '', ''], ['', '', ''],
             [f"fore 40 fwd, {lab('transfer', 'fore_fwd')}", f"fore 40 fwd, {lab('heat', 'fore_fwd')}", f'hind 40 back ({w})'],
             [f"sit, {lab('transfer', 'sit')}", f"sit, {lab('heat', 'sit')}", f'gallop flex ({w})'],
             [f"head 60/down, {lab('transfer', 'head_down')}", f"head 60/down, {lab('heat', 'head_down')}", f"ears 35 back 25 out ({w})" if stats.get('ears', {}).get('used') else 'no ears found']]
    im0 = Image.open(cells / f'{rows[0][1][0]}.png'); w, h = im0.size
    pad = 22; W = 3 * w; Hh = len(rows) * (h + pad)
    out = Image.new('RGB', (W, Hh), (24, 24, 24)); dr = ImageDraw.Draw(out)
    try: font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 13)
    except Exception: font = ImageFont.load_default()
    for r, (label, names) in enumerate(rows):
        y = r * (h + pad)
        for c, nm in enumerate(names):
            p = cells / f'{nm}.png'
            if p.exists(): out.paste(Image.open(p).convert('RGB'), (c * w, y + pad))
            t = heads[r][c] or label
            if c == 0 and heads[r][c] and r == 0: t = f'{heads[r][c]} | {label}'
            dr.text((c * w + 6, y + 3), t if r != 0 or c else f'{code}: {t}', fill=(230, 230, 230), font=font)
    if W > 1600: out = out.resize((1600, int(Hh * 1600 / W)), Image.LANCZOS)
    for q in (88, 82, 76, 70, 62, 55):
        out.save(path, quality=q, optimize=True)
        if os.path.getsize(path) < 400_000: break

# ---- main ----------------------------------------------------------------------------------------------------------
def run_blender(mode, jobf, log):
    t0 = time.time()
    with open(log, 'w') as f:
        r = subprocess.run([BLENDER, '-b', '--factory-startup', '--python', str(ROOT / 'tools' / 'hero_model_blender.py'), '--', mode, str(jobf)], stdout=f, stderr=subprocess.STDOUT)
    if r.returncode != 0 or 'Traceback' in open(log).read():
        print(open(log).read()[-4000:]); raise SystemExit(f'blender {mode} failed (log {log})')
    print(f'INFO blender {mode}: {time.time() - t0:.0f} s')

def main(argv):
    if not argv or argv[0] in ('-h', '--help'): print(open(__file__).read().split('import json')[0]); return 0
    code = argv[0]
    opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
    tris = int(opt('--tris', 20000)); bake_px = int(opt('--bake', 2048)); ao_px = int(opt('--ao', 1024))
    game = Path(opt('--game', ROOT / 'client' / 'assets' / 'fauna' / f'{code}.glb'))
    out_dir = Path(opt('--out', ROOT / 'client' / 'assets' / 'hero')); out_dir.mkdir(parents=True, exist_ok=True)
    gjs, gbin = load_glb(game); ex = gjs.get('extras') or {}
    sk = ex.get('skin')
    if not sk: raise SystemExit(f'{game}: no extras.skin (run tools/rig_quadruped.py first)')
    job = Path(opt('--job')) if opt('--job') else find_job(code, ex['meshy_task'])
    work = SCRATCH / code; work.mkdir(parents=True, exist_ok=True)
    H = float(ex['withers_m']); Lm = float((ex.get('rig') or {}).get('length_m') or 2 * H)
    names = sk['joints']; nj = len(names)
    stats = {'species': code, 'source': str(job), 'game': str(game)}

    # 1. align
    sjs, sbin = load_glb(job / 'model.glb'); sp = prim(sjs, sbin)
    S, idx, sinv = weld(sp['POSITION']); SN = sp['NORMAL'][idx]; SN /= np.maximum(np.linalg.norm(SN, axis=1, keepdims=True), 1e-12)
    gnode = {n['name']: n['mesh'] for n in gjs['nodes']}
    g0 = prim(gjs, gbin, gnode['lod0'])
    M, al = align(S, SN, g0['POSITION'])
    stats['align'] = al; print('ALIGN', json.dumps(al))

    # 2-3. Blender build
    jobd = {'source_glb': str(job / 'model.glb'), 'source_tex': str(job / 'texture_base_color.png'), 'matrix': M.tolist(), 'game_glb': str(game),
            'work': str(work), 'tris': tris, 'bake_px': bake_px, 'ao_px': ao_px, 'withers_m': H, 'length_m': Lm}
    jobf = work / 'job.json'; json.dump(jobd, open(jobf, 'w'), indent=1)
    if '--skip-build' not in argv: run_blender('build', jobf, work / 'build.log')
    else: jobd = json.load(open(jobf)) | {k: jobd[k] for k in ('matrix', 'game_glb', 'source_glb', 'source_tex')}
    stats['build'] = json.load(open(work / 'build_stats.json'))
    tiers = [dict(np.load(work / f'tier{k}.npz')) for k in range(3)]

    # 4. skin. The game's weights by nearest surface: the comparison, and the fallback where the heat solve leaves a
    # vertex without weights
    GW = dense_weights(g0, nj)
    GS, GSN, GSW = sample_surface(g0['POSITION'], g0['indices'], GW, 0.003 * Lm)
    tree = cKDTree(GS)
    t0 = tiers[0]; P0, N0 = t0['POSITION'].astype(np.float64), t0['NORMAL'].astype(np.float64)
    j, d, ok = nearest_compatible(tree, GSN, P0, N0)
    if (np.einsum('nc,nc->n', GSN[tree.query(P0)[1]], N0) < 0).mean() > 0.5:   # the game's winding the other way round
        GSN = -GSN; j, d, ok = nearest_compatible(tree, GSN, P0, N0)
    Wraw = GSW[j]
    A, inv, n = adjacency(t0['indices'].astype(np.int64), t0['vid'])
    Wdw = smooth(welded_mean(Wraw, inv, n), A, 4)
    agree = float((Wdw[inv].argmax(1) == Wraw.argmax(1)).mean())
    stats['transfer'] = {'distance_mm': {'median': round(float(np.median(d)) * 1000, 2), 'p99': round(float(np.percentile(d, 99)) * 1000, 2), 'max': round(float(d.max()) * 1000, 2)},
                         'no_facing_match': int((~ok).sum()), 'dominant_joint_agrees': round(agree, 4)}
    # the welded hero lod0: one vertex per position, for the rig
    Pw = welded_mean(P0, inv, n); Nw = welded_mean(N0, inv, n); Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-12)
    Tw = inv[t0['indices'].astype(np.int64)]
    G, E = edge_graph(Pw, Tw)
    thick_w = welded_mean(t0['thickness'].astype(np.float64), inv, n); rough_w = welded_mean(t0['rough'].astype(np.float64), inv, n)
    rest0 = np.array(sk['joint_rest'], float); nose = np.array(sk['nose'], float); J = {nm: i for i, nm in enumerate(names)}

    # the tail: from the hero mesh; the game's joints kept when they are a real tail
    tail, tinfo = find_tail(Pw, G, Wdw, names, rest0, H)
    rest_h = rest0.copy(); tail_tip = np.array(sk['tail_tip'], float); changed = []
    if tail:
        gch = [rest0[J['Tail1']], rest0[J['Tail2']], rest0[J['Tail3']], tail_tip]
        glen = float(sum(np.linalg.norm(gch[i + 1] - gch[i]) for i in range(3)))
        keep = 'tail' in (ex.get('rig') or {}) and glen >= 0.6 * tail['length'] and np.linalg.norm(tail_tip - tail['tip']) < 0.15 * H
        tinfo.update({'game_chain_m': round(glen, 3), 'game_joints_kept': bool(keep)})
        if not keep:
            for k, nm in enumerate(('Tail1', 'Tail2', 'Tail3')): rest_h[J[nm]] = tail['joints'][k]
            tail_tip = tail['tip']; changed = ['Tail1', 'Tail2', 'Tail3', 'tail_tip']
        cl, arc = tail['centre'], tail['arc']
        stations = [float(arc[np.argmin(np.linalg.norm(cl - rest_h[J[nm]], axis=1))] / tail['length']) for nm in ('Tail1', 'Tail2', 'Tail3')]
        stations = list(np.maximum.accumulate(stations))
    stats['tail'] = tinfo; print('TAIL', json.dumps(tinfo))

    # the ears: a pair from the head's geometry, or none
    stand_w = welded_mean(sample_map(standoff_map(work / 'normal.png'), t0['TEXCOORD_0']), inv, n)
    col_lin = np.asarray(Image.open(work / 'color.png').convert('RGB'), np.float64) / 255
    col_lin = np.where(col_lin <= 0.04045, col_lin / 12.92, ((col_lin + 0.055) / 1.055) ** 2.4) @ np.array([0.2126, 0.7152, 0.0722])
    lum_w = welded_mean(sample_map(col_lin, t0['TEXCOORD_0']), inv, n)
    ears, einfo = find_ears(Pw, G, rough_w, stand_w, lum_w, Wdw, names, rest0, nose, H)
    has_ears = 'L' in ears and 'R' in ears
    einfo['found'] = sorted(ears); einfo['used'] = has_ears
    if has_ears:
        for e in 'LR': einfo[e] = {'base': [round(float(x), 4) for x in ears[e]['base']], 'tip': [round(float(x), 4) for x in ears[e]['tip']], 'vertices': ears[e]['n']}
    stats['ears'] = einfo; print('EARS', json.dumps({k: v for k, v in einfo.items() if k != 'candidates'}), 'candidates', einfo.get('candidates'))
    hnames = names + (['Ear.L', 'Ear.R'] if has_ears else [])
    if has_ears: rest_h = np.vstack([rest_h, ears['L']['base'], ears['R']['base']])
    hj = len(hnames); HJ = {nm: i for i, nm in enumerate(hnames)}

    # bone heat on the welded hero, from the skeleton (the tail and the ears as found)
    tails = heat_tails(hnames, rest_h, sk, tail_tip, {e: ears[e]['tip'] for e in ears} if has_ears else {})
    Wh, zero = bone_heat(work, Pw, Tw, hnames, rest_h, tails, Lm, H, jobd)
    Wt = np.zeros((n, hj)); Wt[:, :nj] = Wdw
    miss = Wh.sum(1) <= 1e-6; Wh[miss] = Wt[miss]
    Wh /= Wh.sum(1, keepdims=True)
    Wh = smooth(Wh, A, 2)
    Wh = trunk_and_neck(Wh, A, Pw, HJ, rest_h, nose)
    stats['heat'] = {'zero_weight_vertices': zero}

    def rig_additions(W):
        """The tail by arc length (blending into the body's weights over the first 12% of it) and the ears (their own
        joint inside, falling into the Head at the base): the same for every weight set."""
        W = W.copy()
        if tail:
            m = tail['mask']; sm_ = tail['s'][m]
            Wa = arc_weights(sm_, stations, [HJ['Tail1'], HJ['Tail2'], HJ['Tail3']], hj); k = smoothstep(0, 0.12, sm_)[:, None]
            W[m] = k * Wa + (1 - k) * W[m]
        if has_ears:
            for e in 'LR':
                c = HJ[f'Ear.{e}']; W[:, HJ['Head']] += W[:, c]; W[:, c] = 0
            for e in 'LR':
                k = ears[e]['k'][:, None]; c = HJ[f'Ear.{e}']; W = W * (1 - k); W[:, c] += k[:, 0]
        return W / np.maximum(W.sum(1, keepdims=True), 1e-12)
    methods = {'transfer': rig_additions(Wt), 'heat': rig_additions(Wh)}
    q = {}
    for mname, W in methods.items():
        jiw, wqw = top4(W); q[mname] = (jiw, wqw, wqw.astype(np.float64) / 255)

    # the pose tests: each weight set posed by the game's own bone matrices ([R | p - R q], gait.js)
    boxes = {'fore_gap': between_legs(Pw, Tw, names, rest0, H, True), 'hind_gap': between_legs(Pw, Tw, names, rest0, H, False)}
    tests, posed = {}, {}
    for mname, (jiw, _, wf) in q.items():
        tests[mname] = {}
        for pname, pose in POSES.items():
            m_, P2, N2 = pose_metrics(Pw, Nw, Tw, E, jiw.astype(int), wf, hnames, rest_h, pose, boxes)
            feet = np.isin(jiw[:, 0], [HJ[f'Foot.{L}'] for L in LEGS])
            P2 = P2.copy(); P2[:, 1] -= P2[feet, 1].min()   # the lowest foot on the ground
            tests[mname][pname] = m_; posed[f'{mname}_{pname}'] = (P2, N2)
    tot = {m: {'inverted_faces': sum(t['inverted_faces'] for t in tests[m].values()), 'stretch_max_worst': max(t['stretch_max'] for t in tests[m].values()),
               'stretch_p99.9_mean': round(float(np.mean([t['stretch_p99.9'] for t in tests[m].values()])), 3),
               'fore_gap_area_worst': max(t['area_fore_gap'] for t in tests[m].values()), 'hind_gap_area_worst': max(t['area_hind_gap'] for t in tests[m].values()),
               'volume_change_pct_worst': max((t['volume_change_pct'] for t in tests[m].values()), key=abs)} for m in tests}
    # the winner: fewer inverted faces, then the lower mean p99.9 stretch (--weights forces one)
    sc_ = {m: (tot[m]['inverted_faces'], tot[m]['stretch_p99.9_mean']) for m in tot}
    win = opt('--weights') or min(sc_, key=lambda m: sc_[m][0] + 200 * (sc_[m][1] - 1))
    stats['pose_tests'] = tests; stats['pose_totals'] = tot; stats['weights'] = win
    print('POSETOT', json.dumps(tot)); print('WEIGHTS', win)
    if has_ears:
        jiw, _, wf = q[win]; Mp = bone_mats(hnames, rest_h, EAR_POSE); P2, N2, _ = lbs(Pw, Nw, jiw.astype(int), wf, Mp); posed[f'{win}_ears'] = (P2, N2)
    jiw, wqw, _ = q[win]
    ji0, wq0 = jiw[inv], wqw[inv]
    skins = [(ji0, wq0)]
    k0 = cKDTree(P0)
    for t in tiers[1:]:
        jj, _, _ = nearest_compatible(k0, N0, t['POSITION'].astype(np.float64), t['NORMAL'].astype(np.float64), k=8)
        skins.append((ji0[jj], wq0[jj]))
    Wd = methods[win][inv]

    # 5. fur: geometry leads (the source's modelled locks), the regions cap the bare parts
    hair_w = hair_geometry(Pw, thick_w, rough_w, stand_w, nose, H, A)
    hair0 = hair_w[inv]
    hairs = [hair0] + [hair0[k0.query(t['POSITION'])[1]] for t in tiers[1:]]
    dom = methods[win].argmax(1)
    stats['fur'] = {'hair_mean': round(float(hair_w.mean()), 3), 'hair_p5_p95': [round(float(np.percentile(hair_w, 5)), 3), round(float(np.percentile(hair_w, 95)), 3)],
                    'standoff_p50_p90_p99': [round(float(np.percentile(stand_w, q_)), 4) for q_ in (50, 90, 99)],
                    'rough_p50_p90': [round(float(np.percentile(rough_w, q_)), 3) for q_ in (50, 90)],
                    'by_dominant_joint': {hnames[k]: round(float(hair_w[dom == k].mean()), 2) for k in range(hj) if (dom == k).any()}}

    # 6. maps
    color = Image.open(work / 'color.png').convert('RGB'); normal = Image.open(work / 'normal.png').convert('RGB'); ao = Image.open(work / 'ao.png').convert('L')
    stats['lighting'] = lighting(color, t0['TEXCOORD_0'], N0)
    # the lighter tiers' UVs: the colour each vertex reads against the colour lod0 reads at the nearest lod0 vertex
    ca = np.asarray(color, np.float64) / 255; hh, ww = ca.shape[:2]
    look = lambda uv: ca[np.clip((uv[:, 1] * hh).astype(int), 0, hh - 1), np.clip((uv[:, 0] * ww).astype(int), 0, ww - 1)]
    c0 = look(t0['TEXCOORD_0'])
    stats['lod_uv_colour_error'] = [round(float(np.abs(look(t['TEXCOORD_0']) - c0[k0.query(t['POSITION'])[1]]).mean()), 4) for t in tiers[1:]]
    stats['lod_uv_colour_error_lod0_neighbour'] = round(float(np.abs(c0 - c0[k0.query(P0, k=2)[1][:, 1]]).mean()), 4)
    aoa = np.asarray(ao, np.float64) / 255; ah, aw = aoa.shape
    av = aoa[np.clip((t0['TEXCOORD_0'][:, 1] * ah).astype(int), 0, ah - 1), np.clip((t0['TEXCOORD_0'][:, 0] * aw).astype(int), 0, aw - 1)]
    stats['ao'] = {'mean_at_vertices': round(float(av.mean()), 3), 'p1': round(float(np.percentile(av, 1)), 3), 'below_0.2': round(float((av < 0.2).mean()), 4)}
    files = {'color': f'{code}_color.jpg', 'normal': f'{code}_normal.png', 'ao': f'{code}_ao.jpg'}
    color.save(out_dir / files['color'], quality=86, optimize=True, progressive=True)
    nsize = int(opt('--normal-px', 1024))
    normal.resize((nsize, nsize), Image.LANCZOS).save(out_dir / files['normal'], optimize=True)
    ao.save(out_dir / files['ao'], quality=85, optimize=True)

    # write the GLB
    W = Writer(); meshes = []; nodes = []
    for k, (t, (ji, wq), hr) in enumerate(zip(tiers, skins, hairs)):
        at = {'POSITION': W.acc(t['POSITION'].astype(np.float32), 5126, 'VEC3', minmax=True),
              'NORMAL': W.acc(t['NORMAL'].astype(np.float32), 5126, 'VEC3'),
              'TANGENT': W.acc(np.round(t['TANGENT'], 4).astype(np.float32), 5126, 'VEC4'),
              'TEXCOORD_0': W.acc(t['TEXCOORD_0'].astype(np.float32), 5126, 'VEC2'),
              'TEXCOORD_1': W.acc(np.stack([hr, np.zeros_like(hr)], 1).astype(np.float32), 5126, 'VEC2'),
              'JOINTS_0': W.acc(ji, 5121, 'VEC4'),
              'WEIGHTS_0': W.acc(wq, 5121, 'VEC4', normalized=True)}
        I = t['indices'].reshape(-1); big = len(t['POSITION']) > 65535
        ind = W.acc(I.astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963)
        meshes.append({'name': f'lod{k}', 'primitives': [{'attributes': at, 'indices': ind, 'material': 0, 'mode': 4}]})
        nodes.append({'name': f'lod{k}', 'mesh': k})
    while len(W.buf) % 4: W.buf.append(0)
    skin = dict(sk); skin['clips'] = f"../fauna/{sk['clips']}" if sk.get('clips') else None
    r4 = lambda v: [round(float(x), 4) for x in v]
    skin['joints'] = hnames; skin['joint_rest'] = [r4(r) for r in rest_h]; skin['tail_tip'] = r4(tail_tip)
    if has_ears: skin['ears'] = {e: {'joint': HJ[f'Ear.{e}'], 'tip': r4(ears[e]['tip'])} for e in 'LR'}
    tri_counts = [int(len(t['indices'])) for t in tiers]
    hero_ex = {'tool': 'tools/hero_model.py', 'source_task': ex.get('meshy_task'), 'source_to_game': M.round(6).tolist(),
               'align_residual_mm': al['point_to_plane_mm'], 'triangles': tri_counts,
               'fur': 'TEXCOORD_1.x: hair-length factor 0 (bare) .. 1 (longest) per vertex; TEXCOORD_1.y reserved (0)',
               'maps': files,
               'weights': {'method': win, 'about': ('bone heat on the hero mesh from the game skeleton' if win == 'heat' else 'the game skin by nearest surface') +
                           '; the tail by arc length, the ears by distance from their base; JOINTS_0 u8 / WEIGHTS_0 u8 normalised (sum 255)'},
               'skin_changes': {'joint_rest_rows_changed': [HJ[nm] for nm in changed if nm in HJ], 'changed': changed,
                                'joints_added': hnames[nj:], 'game_joints': nj},
               'tail': {k: v for k, v in tinfo.items()}, 'ears': {k: v for k, v in einfo.items() if k != 'candidates'}}
    exo = dict(ex); exo['skin'] = skin; exo['hero'] = hero_ex
    g = {'asset': {'version': '2.0', 'generator': 'tools/hero_model.py (Blender bake) from ' + (gjs['asset'].get('generator') or ''),
                   'copyright': gjs['asset'].get('copyright', '')},
         'scene': 0, 'scenes': [{'nodes': list(range(3))}], 'nodes': nodes, 'meshes': meshes,
         'materials': [{'name': f'{code}_hero', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0, 'texCoord': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.85},
                        'normalTexture': {'index': 1, 'texCoord': 0}, 'occlusionTexture': {'index': 2, 'texCoord': 0, 'strength': 1.0}}],
         'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
         'images': [{'uri': files['color'], 'mimeType': 'image/jpeg'}, {'uri': files['normal'], 'mimeType': 'image/png'}, {'uri': files['ao'], 'mimeType': 'image/jpeg'}],
         'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}, {'sampler': 0, 'source': 2}],
         'accessors': W.accs, 'bufferViews': W.views, 'buffers': [{'byteLength': len(W.buf)}], 'extras': exo}
    if not g['asset']['copyright']: del g['asset']['copyright']
    jb = json.dumps(g, separators=(',', ':')).encode()
    while len(jb) % 4: jb += b' '
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(W.buf)) + struct.pack('<I4s', len(jb), b'JSON') + jb + struct.pack('<I4s', len(W.buf), b'BIN\x00') + bytes(W.buf)
    gpath = out_dir / f'{code}.glb'; open(gpath, 'wb').write(glb)
    stats['files'] = {p.name: p.stat().st_size for p in [gpath] + [out_dir / f for f in files.values()]}
    stats['files_total'] = sum(stats['files'].values())
    stats['triangles'] = tri_counts
    print('TRANSFER', json.dumps(stats['transfer'])); print('FUR', json.dumps(stats['fur'])); print('LIGHT', json.dumps(stats['lighting']))
    print('FILES', json.dumps(stats['files']), stats['files_total'])
    print('LODUV', stats['lod_uv_colour_error'], 'baseline', stats['lod_uv_colour_error_lod0_neighbour'], 'AO', stats['ao'], 'TRIS', tri_counts)

    # client/assets/hero/index.json: this species' entry rewritten, every other key kept
    ip = out_dir / 'index.json'
    try: index = json.load(open(ip))
    except (OSError, ValueError): index = {}
    index.setdefault('species', {})
    ent = dict(index['species'].get(code) or {})
    ent.update({'glb': gpath.name, 'triangles': tri_counts, 'joints': hj, 'ears': has_ears, 'tail': bool(tail), 'weights': win,
                'bytes': stats['files'], 'maps': files})
    index['species'][code] = ent
    json.dump(index, open(ip, 'w'), indent=1)

    # verification renders and the sheet
    if '--no-render' not in argv:
        cells = work / 'cells'; shutil.rmtree(cells, ignore_errors=True); cells.mkdir()   # no stale cell reaches the sheet
        shots = []
        for m in ('transfer', 'heat'):
            shots += [{'key': f'{m}_fore_fwd', 'name': f'{m}_fore_fwd', 'view': 'frame', 'angle': [8, 8]},
                      {'key': f'{m}_sit', 'name': f'{m}_sit', 'view': 'frame', 'angle': [25, 8]},
                      {'key': f'{m}_head_down', 'name': f'{m}_head_down', 'view': 'frame', 'angle': [45, 18]}]
        shots += [{'key': f'{win}_hind_back', 'name': 'win_hind_back', 'view': 'frame', 'angle': [-10, 8]},
                  {'key': f'{win}_gallop', 'name': 'win_gallop', 'view': 'frame', 'angle': [5, 8]}]
        if has_ears: shots.append({'key': f'{win}_ears', 'name': 'win_ears', 'view': 'head_up'})
        np.savez_compressed(work / 'poses.npz', inv=inv, **{f'{k}_{c}': v[i].astype(np.float32) for k, v in posed.items() for i, c in enumerate('PN') if any(sh['key'] == k for sh in shots)})
        jobd.update({'hero_glb': str(gpath), 'cells': str(cells), 'cell': [532, 400], 'poses_npz': str(work / 'poses.npz'), 'pose_shots': shots})
        json.dump(jobd, open(jobf, 'w'), indent=1)
        run_blender('render', jobf, work / 'render.log')
        sd = Path(opt('--sheet-dir', SHEETS)); sd.mkdir(parents=True, exist_ok=True)
        sheet(cells, code, stats, sd / f'hero_{code}_sheet.jpg')
        stats['sheet'] = str(sd / f'hero_{code}_sheet.jpg')
    json.dump(stats, open(work / 'stats.json', 'w'), indent=1)
    # the work directory keeps the bakes and tiers for --skip-build reruns; --clean removes it
    if '--clean' in argv: shutil.rmtree(work, ignore_errors=True)
    print('STATS', work / 'stats.json')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
