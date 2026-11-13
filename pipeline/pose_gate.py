"""Pose gate: does a generated quadruped mesh stand square? Measured on a Meshy job's model.glb before more credits go
into it (a preview before its refine; a refine keeps its preview's mesh, so both measure the same). One rule for every
four-legged species; nothing per species.

A text-to-3D model keeps whatever pose the generator gave it, and the rig, the gait engine and the hero tier assume an
animal standing square: the spine straight, the head facing forward, four feet down in a fore and a hind pair. The
coyote's first preview (01a1cefb) had a turned head and a bent spine and was rejected by eye; its second (01a1cefd) was
accepted by eye with its head turned, and the turn shows in the game. This gate measures what the eye judged.

  read      every triangle primitive of the GLB with its node transforms applied (matrix or TRS, down the scene tree).
            Up is +y (glTF's convention; Meshy writes y-up). The surface is sampled uniformly by area (SAMPLES points,
            a fixed seed), so dense patches of vertices weigh no more than sparse ones.
  frame     a first long axis is the principal axis of the horizontal footprint. The belly is the lowest height whose
            slab covers the middle BELLY_SPAN of that axis: below it are legs, above it the body; the leg length is the
            belly's height above the lowest point. The feet are the separate pieces, seen from above, of the slab from
            the ground to FOOT_SLAB of the leg length; the four largest are split along the axis into two pairs. The
            body's axis is the line from one pair's midpoint to the other's (the feet set it, not the head or the
            tail), and the head end is the end with more surface above the belly beyond its feet (a head and neck
            carry more than a tail: on the library's 38 meshes with feet the head end holds 1.27 to 24 times the tail
            end's, the least a puma with its long tail; every one checked by eye on its sheet).
  measure   seen from above, the trunk (above the belly, between TRUNK_LOW of the way up to the mid-back's top and that
            top, so legs, antlers and horns over the shoulders stay out) is cut into STATIONS slices between the hind and
            fore feet; the middle of each slice's lateral extent gives the trunk's centreline. (The area-weighted mean
            was tried first: a hollow shell's two flanks make it noisy, 1 to 2.5 degrees of spine bend between sampling
            seeds on the same mesh; the extent's middle repeats within 0.5.)
              head turn    (signed: positive toward the animal's left) the angle between the trunk's centreline (a line fitted to all its stations) and the line from
                           the neck's base (that line at the fore feet) to the head's end: the middle of the head as
                           a solid, within HEAD_TIP of the body's length of its foremost point, with everything
                           thinner than THIN of the body's length taken away first (head_end). The surface's own
                           foremost point was used at first: a moose's antler tines reach past its muzzle and a
                           leopard's whiskers past its nose, and horns and ears in the slab pulled the middle toward
                           the body's line (a bison read 14.1 where its muzzle stands 17.9 off; a moose 6.5 for 10.3).
              spine bend   (signed likewise: the front half's turn from the rear's) the angle between lines fitted to the rear and front halves of the trunk's centreline.
              stagger      for each foot pair, how far apart along the body its two feet stand, as a share of the leg
                           length. Standing square both are near zero; in a stride they open.
              feet         how many separate pieces the ground slab holds (four expected; a fifth is usually a tail tip).
  gate      a mesh passes when at least four feet are found, a head is found beyond the fore feet, and every measure is
            within its limit (the constants below, each with where its number came from). gate() returns ok, the
            reasons in plain words, and the measures.

  The library's quadrupeds (2026-11-12, 21 species, 59 jobs with a model.glb, 38 distinct meshes) were accepted by
  eye without a pose check, and by eye on the top-down sheets many of their heads are turned: their numbers do not
  bound what passes. The limits sit in the widest gap of each measure's distribution at or below the known bad cases,
  checked against the sheets by eye.

  A turned head is no longer a reason to refuse a mesh by itself: pipeline/straighten.py turns it back before anything
  is built (the same frame, and this module's measures before and after), and the build's check
  (fauna_models.pose_check) gates the straightened mesh. The head's limit here then refuses only a head that could not
  be straightened; a bent spine and a stride are refused as before.

  arch -arm64 .venv/bin/python -m pipeline.pose_gate <job dir or glb> [...] [--sheet out.jpg]
  arch -arm64 .venv/bin/python -m pipeline.pose_gate --library [--sheet-dir DIR] [--json]
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent

# ---- sampling and frame (method constants, not thresholds) ------------------------------------------------------
SAMPLES = 200_000      # surface points; over four seeds the measures repeat within 0.5 degrees and 0.01 stagger
SEED = 0
BELLY_SPAN = 0.30      # the middle share of the long axis a slab must cover to be the body, not the legs
BELLY_FILL = 0.85      # share of that span's bins that must hold surface
FOOT_SLAB = 0.30       # the feet are the pieces of the slab from the ground to this share of the leg length
GRID = 0.008           # raster cell for the feet and the belly, as a share of the body's horizontal length
STATIONS = 12          # slices of the trunk between the hind and fore feet
EXTENT_PCT = 2         # a slice's lateral extent: these percentiles of its points (a stray point cannot move it)
HEAD_TIP = 0.10        # the head's end: what lies within this share of the length of the head's foremost point
THIN = 0.025           # ... of the head as a solid with everything thinner than this share of the body's length taken
                       # away: ears, antlers, horns and whiskers are not the head's end (a moose's tines reach past its
                       # muzzle, a leopard's whiskers past its nose)
CELL = 0.005           # the solid's grid, as a share of the body's length
HEAD_SAMPLES = 400_000 # surface points over the part ahead of the fore feet, so the grid's shell has no holes
BACK_PCT = 95          # the trunk's top: this percentile of height over the middle half of the trunk (a moose's
                       # antler reaching back over the shoulders read as a 14-degree spine bend without it)
TRUNK_LOW = 0.25       # the trunk's bottom: this share of the way from the belly to that top (upper legs stay out)

# ---- thresholds (2026-11-12, measured on every quadruped job in the library; known cases named by job) ----------
MAX_HEAD_TURN = 9.9    # degrees, on the head's end found on the solid (2026-11-12, later the same day; 9.5 on the
                       # surface's before). Known: puma 01a1cefb straight, 1.8; coyote 01a1cefb rejected by eye, 26.8;
                       # coyote 01a1cefd turned "about 25 by eye", 33.6. The library's 37 distinct meshes run from 0.1
                       # to 38.4; the gap 9.4 (cheetah, no turn seen on its sheet) to 10.3 (moose 01a1b12c, its muzzle
                       # off the line seen from the front) is where a turn starts to show: margin 0.45 either side.
MAX_SPINE_BEND = 3.5   # degrees. Known: puma 1.0; coyote 01a1cefb (bent by eye) 7.2. Every served mesh reads 0.0 to
                       # 2.2 except coyote 01a1cefd, 4.4 (a slight arc by eye), and wild dog 01a1afc7, 6.3 (an arc by
                       # eye). Margin 1.3 above 2.2, 0.9 below 4.4.
MAX_STAGGER = 1.0      # share of leg length, per pair. Served meshes read 0.0 to 0.82 (cheetah fore; bear, goat
                       # 01a1b123 and badger read 0.72 to 0.79 and stand in a mild stride by eye; accepted and played).
                       # The unserved image meshes in a stride by eye (badger 01a1b19b and 01a1b172, goat 01a1b167)
                       # read 1.30 to 2.07 on their worse pair (puma 01a171bb's 1.58 counts its grounded tail as a
                       # foot). Margin 0.18 above, 0.30 below.
FEET = 4


# ---- glTF ---------------------------------------------------------------------------------------------------------
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    b = Path(path).read_bytes()
    if b[:4] != b'glTF':
        raise ValueError(f'{path}: not a GLB')
    ln, = struct.unpack_from('<I', b, 12)
    js = json.loads(b[20:20 + ln])
    off = 20 + ln
    bl, = struct.unpack_from('<I', b, off)
    return js, b[off + 8:off + 8 + bl]


def accessor(js, bin_, i):
    a = js['accessors'][i]
    v = js['bufferViews'][a['bufferView']]
    ct = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 0)
    if stride and stride != ct.itemsize * n:
        raw = np.frombuffer(bin_, dtype=np.uint8, count=stride * (a['count'] - 1) + ct.itemsize * n, offset=off)
        rows = np.lib.stride_tricks.as_strided(raw, (a['count'], ct.itemsize * n), (stride, 1))
        return np.ascontiguousarray(rows).view(ct).reshape(a['count'], n).astype(np.float64)
    return np.frombuffer(bin_, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n).astype(np.float64)


def node_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T     # glTF stores column-major
    T = np.eye(4)
    x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    T[:3, :3] = R * np.array(nd.get('scale', [1, 1, 1]))[None, :]
    T[:3, 3] = nd.get('translation', [0, 0, 0])
    return T


def triangles(js, bin_):
    """Every triangle of every mesh in the default scene, in world space: (n, 3, 3)."""
    out = []
    scene = js.get('scenes', [{'nodes': list(range(len(js.get('nodes', []))))}])[js.get('scene', 0)]

    def walk(i, parent):
        nd = js['nodes'][i]
        M = parent @ node_matrix(nd)
        if 'mesh' in nd:
            for pr in js['meshes'][nd['mesh']]['primitives']:
                if pr.get('mode', 4) != 4:
                    continue
                P = accessor(js, bin_, pr['attributes']['POSITION'])
                P = P @ M[:3, :3].T + M[:3, 3]
                idx = (accessor(js, bin_, pr['indices']).astype(np.int64).ravel() if 'indices' in pr
                       else np.arange(len(P)))
                out.append(P[idx.reshape(-1, 3)])
        for c in nd.get('children', []):
            walk(c, M)

    for i in scene['nodes']:
        walk(i, np.eye(4))
    if not out:
        raise ValueError('no triangle meshes in the file')
    return np.concatenate(out)


def sample_surface(T, n=SAMPLES, seed=SEED):
    """Points spread uniformly by area over triangles T (k, 3, 3)."""
    a = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
    keep = a > 0
    T, a = T[keep], a[keep]
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(T), size=n, p=a / a.sum())
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1)
    w0, w1, w2 = 1 - s, s * (1 - r2), s * r2
    t = T[pick]
    return w0[:, None] * t[:, 0] + w1[:, None] * t[:, 1] + w2[:, None] * t[:, 2]


# ---- geometry -----------------------------------------------------------------------------------------------------
def _angle(a, b):
    """Signed angle in degrees from 2-vector a to 2-vector b."""
    return float(np.degrees(np.arctan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])))


def _fit_dir(u, v, w=None):
    """Direction (1, slope) of the weighted least-squares line v = a + b u, normalised."""
    if len(u) < 2:
        return np.array([1.0, 0.0])
    b = np.polyfit(u, v, 1, w=w)[0]
    d = np.array([1.0, b])
    return d / np.linalg.norm(d)


def _centre(v):
    """The middle of a slice's lateral extent (EXTENT_PCT to 100 - EXTENT_PCT percentiles of its surface points)."""
    lo, hi = np.percentile(v, [EXTENT_PCT, 100 - EXTENT_PCT])
    return float(0.5 * (lo + hi))


def _belly(y, u, v, length, y0, height):
    """Lowest height whose slab covers BELLY_SPAN of the middle of the long axis."""
    uc = 0.5 * (u.min() + u.max())
    half = 0.5 * BELLY_SPAN * length
    nb = max(8, int(round(BELLY_SPAN / GRID / 2)))
    mid = np.abs(u - uc) < half
    step = 0.01 * height
    for k in range(1, 100):
        lo = y0 + (k - 1) * step
        s = mid & (y >= lo) & (y < lo + 2 * step)
        if not s.any():
            continue
        h = np.bincount(np.clip(((u[s] - uc + half) / (2 * half) * nb).astype(int), 0, nb - 1), minlength=nb)
        if (h > 0).mean() >= BELLY_FILL:
            return lo
    return y0 + 0.5 * height


def _feet(P, u, v, ymin, leg, length):
    """The four largest separate pieces of the ground slab seen from above: list of dicts with u, v, n."""
    s = P[:, 1] < ymin + FOOT_SLAB * max(leg, 1e-9)
    cell = GRID * length
    uu, vv = u[s], v[s]
    if len(uu) == 0:
        return []
    iu = ((uu - uu.min()) / cell).astype(int)
    iv = ((vv - vv.min()) / cell).astype(int)
    img = np.zeros((iu.max() + 3, iv.max() + 3), bool)
    img[iu + 1, iv + 1] = True
    img = ndimage.binary_closing(img, iterations=1)
    lab, n = ndimage.label(img, structure=np.ones((3, 3)))
    if n == 0:
        return []
    pl = lab[iu + 1, iv + 1]
    pieces = []
    for k in range(1, n + 1):
        m = pl == k
        if m.sum() < 0.02 * len(uu):
            continue
        pieces.append({'u': float(uu[m].mean()), 'v': float(vv[m].mean()), 'n': int(m.sum())})
    pieces.sort(key=lambda p: -p['n'])
    return pieces


def _ball(r):
    k = np.arange(-r, r + 1)
    return (k[:, None, None] ** 2 + k[None, :, None] ** 2 + k[None, None, :] ** 2) <= r * r + 1


def head_solid(Q, length):
    """The part ahead of the fore feet as a solid on a grid of CELL. Q: its surface points (U, V, y), dense enough to
    close the grid, cut off square at the low end of U. The shell is thickened by a cell (a cell the surface only
    clips can be missed, and one gap lets the outside in), the cut end closed by its own filled outline, the inside
    filled, and the thickening taken off again. Returns (solid, lo, cell): a cell (i, j, k) has its middle at
    lo + (i + 0.5, j + 0.5, k + 0.5) cell."""
    cell = CELL * length
    lo = Q.min(0) - 3 * cell
    I = ((Q - lo) / cell).astype(int)
    surf = np.zeros(tuple(I.max(0) + 4), bool)
    surf[I[:, 0], I[:, 1], I[:, 2]] = True
    thick = ndimage.binary_dilation(surf)
    k0 = int(I[:, 0].min())
    for k in range(max(k0 - 1, 0), k0 + 2):
        thick[k] = ndimage.binary_fill_holes(thick[k])
    return ndimage.binary_erosion(ndimage.binary_fill_holes(thick)) | surf, lo, cell


def head_end(Q, length, floor):
    """The head's end on the solid (head_solid) opened by a ball THIN across: the largest piece left is the head and
    neck without what is thin. Returns (tip, nose): tip the (U, V) middle of that piece within HEAD_TIP of the length
    of its foremost cell above `floor` (a height: a foot stepped forward is not the head), nose that foremost point
    (U, V, y); or None when nothing solid is left."""
    solid, lo, cell = head_solid(Q, length)
    r = max(1, int(round(0.5 * THIN / CELL - 0.5)))
    core = ndimage.binary_opening(solid, structure=_ball(r))
    lab, n = ndimage.label(core)
    if n == 0:
        return None
    big = lab == (1 + int(np.argmax(ndimage.sum(core, lab, range(1, n + 1)))))
    iu, iv, iy = np.nonzero(big)
    Uc, Vc, yc = (lo[0] + (iu + 0.5) * cell, lo[1] + (iv + 0.5) * cell, lo[2] + (iy + 0.5) * cell)
    up = yc > floor
    if not up.any():
        return None
    umax = Uc[up].max()
    tm = up & (Uc > umax - HEAD_TIP * length)
    fm = up & (Uc > umax - 2 * cell)
    return np.array([Uc[tm].mean(), Vc[tm].mean()]), np.array([Uc[fm].mean(), Vc[fm].mean(), yc[fm].mean()])


def measure(glb_path, samples=SAMPLES, seed=SEED, keep=False):
    js, bin_ = load_glb(glb_path)
    T = triangles(js, bin_)
    return measure_points(sample_surface(T, samples, seed), keep=keep, tris=T)


def measure_points(P, keep=False, tris=None):
    """The pose measures of a surface given as uniformly spread points P (n, 3), y up. tris: the surface's triangles
    (k, 3, 3), with which the head's end is found on the solid (head_end); without them, on the points."""
    y = P[:, 1]
    ymin, height = y.min(), np.ptp(y)
    centre = P[:, [0, 2]].mean(0)
    H = P[:, [0, 2]] - centre
    w, V = np.linalg.eigh(np.cov(H.T))
    ax = V[:, np.argmax(w)]
    lat = np.array([-ax[1], ax[0]])
    u, v = H @ ax, H @ lat
    length = float(np.ptp(u))
    yb = _belly(y, u, v, length, ymin, height)
    leg = yb - ymin
    feet = _feet(P, u, v, ymin, leg, length)
    out = {'height': float(height), 'length': length, 'leg': float(leg), 'feet': len(feet)}
    if len(feet) < 2:
        out.update(head_turn=None, spine_bend=None, stagger_fore=None, stagger_hind=None, head_end=None)
        return out
    f4 = sorted(feet[:4], key=lambda p: p['u'])
    lo, hi = f4[:len(f4) // 2], f4[len(f4) // 2:]
    m_lo = np.array([np.mean([p['u'] for p in lo]), np.mean([p['v'] for p in lo])])
    m_hi = np.array([np.mean([p['u'] for p in hi]), np.mean([p['v'] for p in hi])])
    # which end is the head: the one with more surface beyond its feet (above the belly)
    body = y > yb
    beyond_hi = float((body & (u > m_hi[0])).mean())
    beyond_lo = float((body & (u < m_lo[0])).mean())
    head_hi = beyond_hi >= beyond_lo
    # the body's frame: hind-feet midpoint to fore-feet midpoint, origin at the hind midpoint
    hind, fore = (m_lo, m_hi) if head_hi else (m_hi, m_lo)
    hp, fp = (lo, hi) if head_hi else (hi, lo)
    d = fore - hind
    chord = float(np.linalg.norm(d))
    d = d / chord
    fwd = d[0] * ax + d[1] * lat                        # forward in (x, z)
    left = np.array([fwd[1], -fwd[0]])                  # up (+y) cross forward: the animal's left, in (x, z)
    n2 = np.array([left @ ax, left @ lat])              # ... in the footprint's (u, v)
    UV = np.stack([u, v], 1) - hind
    U, Vl = UV @ d, UV @ n2
    # trunk centreline: the middle of each station's lateral extent, between the hind and fore feet
    # (only up to the height of the mid-back, so antlers, horns or a raised head over the shoulders stay out)
    mid = body & (U > 0.25 * chord) & (U < 0.75 * chord)
    top = np.percentile(y[mid], BACK_PCT) if mid.sum() > 20 else np.inf
    trunk_pts = body & (y < top) & (y > yb + TRUNK_LOW * (top - yb))
    edges = np.linspace(0, chord, STATIONS + 1)
    su, sv = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        m = trunk_pts & (U >= a) & (U < b)
        if m.sum() < 20:
            continue
        su.append(0.5 * (a + b)); sv.append(_centre(Vl[m]))
    su, sv = np.array(su), np.array(sv)
    if len(su) < 4:
        out.update(head_turn=None, spine_bend=None, stagger_fore=None, stagger_hind=None, head_end=None)
        return out
    trunk = _fit_dir(su, sv)
    half = su < chord / 2
    rear, front = _fit_dir(su[half], sv[half]), _fit_dir(su[~half], sv[~half])
    spine = _angle(rear, front)
    # head: the surface beyond the fore feet, above half the leg; its end within HEAD_TIP of the foremost point
    hm = (U > chord) & (y > ymin + 0.5 * leg)
    head_turn = None
    tip = base = nose = None
    if hm.any():
        umax = U[hm].max()
        tm = hm & (U > umax - HEAD_TIP * length)
        tip = np.array([U[tm].mean(), Vl[tm].mean()])
        nose = np.array([umax, float(Vl[hm][np.argmax(U[hm])]), float(y[hm][np.argmax(U[hm])])])
        if tris is not None:                            # the head's end on the solid, thin parts taken away
            def placed(X):
                uv = np.stack([(X[:, [0, 2]] - centre) @ ax, (X[:, [0, 2]] - centre) @ lat], 1) - hind
                return np.stack([uv @ d, uv @ n2, X[:, 1]], 1)
            c3 = tris.mean(1)
            ahead = placed(c3)[:, 0] > chord - 0.05 * length
            if ahead.any():
                Q = placed(sample_surface(tris[ahead], HEAD_SAMPLES, SEED))
                Q = Q[Q[:, 0] > chord - 0.02 * length]
                he = head_end(Q, length, ymin + 0.5 * leg) if len(Q) else None
                if he is not None:
                    tip, nose = he
        a, b = np.polyfit(su, sv, 1)
        base = np.array([chord, a + b * chord])
        head_turn = _angle(trunk, tip - base)
    def stagger(pair):
        if len(pair) < 2:
            return None
        pu = [(np.array([p['u'], p['v']]) - hind) @ d for p in pair]
        return float(abs(pu[0] - pu[1]) / max(leg, 1e-9))
    out.update(head_turn=None if head_turn is None else round(abs(head_turn), 2),
               head_turn_signed=None if head_turn is None else round(head_turn, 2),
               spine_bend=round(abs(spine), 2), spine_bend_signed=round(spine, 2),
               stagger_fore=None if stagger(fp) is None else round(stagger(fp), 3),
               stagger_hind=None if stagger(hp) is None else round(stagger(hp), 3),
               head_end='+axis' if head_hi else '-axis',
               head_margin=round(max(beyond_hi, beyond_lo) / max(min(beyond_hi, beyond_lo), 1e-9), 2),
               chord=round(chord / length, 3), belly=round(float(leg / height), 3))
    if keep:
        out['_draw'] = {'U': U, 'V': Vl, 'y': y, 'body': body, 'stations': (su, sv), 'tip': tip, 'base': base,
                        'feet': [((np.array([p['u'], p['v']]) - hind) @ d, (np.array([p['u'], p['v']]) - hind) @ n2)
                                 for p in f4], 'chord': chord, 'trunk': trunk, 'rear': rear, 'front': front,
                        'length': length}
        # the body's frame, for whoever places other points in it (pipeline/straighten.py): a point's horizontal
        # (x, z) less 'mean' gives (u, v) on 'ax' and 'lat'; less 'hind' and on 'd' and 'n2', (U, V)
        out['_frame'] = {'mean': centre, 'nose': nose, 'ax': ax, 'lat': lat, 'hind': hind, 'd': d, 'n2': n2,
                         'chord': chord, 'length': length, 'ymin': float(ymin), 'leg': float(leg), 'belly': float(yb),
                         'top': float(top), 'trunk': trunk, 'base': base, 'tip': tip}
    return out


def gate(glb_path, m=None):
    m = m or measure(glb_path)
    why = []
    if m['feet'] < FEET:
        why.append(f"{m['feet']} separate piece(s) stand on the ground where four feet should")
    if m.get('head_turn') is None:
        why.append('no head found beyond the fore feet')
    elif m['head_turn'] > MAX_HEAD_TURN:
        why.append(f"the head is turned {m['head_turn']:.1f} degrees (limit {MAX_HEAD_TURN:.1f})")
    if m.get('spine_bend') is not None and m['spine_bend'] > MAX_SPINE_BEND:
        why.append(f"the spine is bent {m['spine_bend']:.1f} degrees (limit {MAX_SPINE_BEND:.1f})")
    # a stride is read only between four feet: with fewer pieces on the ground the pairs are not known to be a fore or a
    # hind pair (2026-11-13: a bobcat's preview, its long tail on the ground and its fore feet together, read as a fore
    # stride of 1.48 leg lengths)
    for k, name in (('stagger_fore', 'fore'), ('stagger_hind', 'hind')) if m['feet'] >= FEET else ():
        if m.get(k) is not None and m[k] > MAX_STAGGER:
            why.append(f"the {name} feet stand {m[k]:.2f} of the leg length apart along the body, a stride "
                       f"(limit {MAX_STAGGER:.2f})")
    return {'ok': not why, 'why': why, **{k: v for k, v in m.items() if not k.startswith('_')}}


# ---- picture ------------------------------------------------------------------------------------------------------
def sheet(glb_path, out, m=None, title=None, px=600):
    import cv2
    m = m if m is not None and '_draw' in m else measure(glb_path, keep=True)
    g = gate(glb_path, m)
    if '_draw' not in m:
        return None
    D = m['_draw']
    U, V = D['U'], D['V']
    lo, hi = U.min(), U.max()
    span = max(hi - lo, 2 * np.abs(V).max()) * 1.08
    s = px / span
    W, Hh = px, int(px * 0.75)
    def xy(uu, vv):
        return int((uu - (lo + hi) / 2) * s + W / 2), int(Hh / 2 - vv * s)
    img = np.full((Hh, W, 3), 255, np.uint8)
    xs = ((U - (lo + hi) / 2) * s + W / 2).astype(int).clip(0, W - 1)
    ys = (Hh / 2 - V * s).astype(int).clip(0, Hh - 1)
    img[ys[~D['body']], xs[~D['body']]] = (200, 200, 200)
    img[ys[D['body']], xs[D['body']]] = (140, 140, 140)
    c = D['chord']
    cv2.line(img, xy(-0.4 * c, 0), xy(1.6 * c, 0), (200, 160, 0), 1)
    su, sv = D['stations']
    for a, b in zip(su, sv):
        cv2.circle(img, xy(a, b), 3, (0, 0, 220), -1)
    for dd, a0, a1 in ((D['rear'], 0, c / 2), (D['front'], c / 2, c)):
        k = np.polyfit(su, sv, 1)
        p0 = np.array([c / 2, k[0] * c / 2 + k[1]])
        cv2.line(img, xy(*(p0 + dd * (a0 - c / 2))), xy(*(p0 + dd * (a1 - c / 2))), (0, 120, 255), 2)
    if D['tip'] is not None:
        cv2.line(img, xy(*D['base']), xy(*D['tip']), (0, 160, 0), 2)
        cv2.circle(img, xy(*D['tip']), 5, (0, 160, 0), -1)
    for fu, fv in D['feet']:
        cv2.circle(img, xy(fu, fv), 7, (160, 0, 160), 2)
    lines = [title or str(glb_path)[-60:],
             f"head {g['head_turn']}  spine {g['spine_bend']}  stagger {g['stagger_fore']}/{g['stagger_hind']}  "
             f"feet {g['feet']}  {'PASS' if g['ok'] else 'FAIL'}"]
    for i, t in enumerate(lines):
        cv2.putText(img, t, (6, 16 + 16 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return out


# ---- library ------------------------------------------------------------------------------------------------------
def main_checkout():
    try:
        common = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--git-common-dir'], capture_output=True,
                                text=True).stdout.strip()
        return Path(common if os.path.isabs(common) else ROOT / common).resolve().parent
    except Exception:
        return ROOT


def find_glb(job_dir):
    """A job's model.glb in this checkout, else the same path under the main checkout."""
    p = Path(job_dir)
    if p.suffix == '.glb':
        return p if p.exists() else None
    if (p / 'model.glb').exists():
        return p / 'model.glb'
    try:
        rel = p.resolve().relative_to(ROOT)
    except ValueError:
        return None
    q = main_checkout() / rel / 'model.glb'
    return q if q.exists() else None


def library_jobs():
    """Every job of every quadruped in models.json that has a model.glb here or in the main checkout."""
    models = json.loads((ROOT / 'library/animals/models.json').read_text())
    rows = []
    for code, sp in models['species'].items():
        if sp.get('kind') != 'quadruped':
            continue
        served = set(sp.get('jobs') or [])
        for jj in sorted((ROOT / 'library/animals/jobs' / code).glob('*/job.json')):
            d = jj.parent
            glb = find_glb(d)
            if glb is None:
                continue
            mode = json.loads(jj.read_text()).get('mode')
            rows.append({'code': code, 'job': d, 'glb': glb, 'mode': mode,
                         'served': str(d.relative_to(ROOT)) in served})
    return rows


def _fmt(x, f):
    return '-' if x is None else format(x, f)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('paths', nargs='*', help='job directories or .glb files')
    ap.add_argument('--library', action='store_true', help='every quadruped job with a model.glb')
    ap.add_argument('--sheet', help='a top-down picture (JPEG) of the single path given')
    ap.add_argument('--sheet-dir', help='a picture of every measured job into this folder')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    rows = library_jobs() if a.library else []
    for p in a.paths:
        job = Path(p).parent if p.endswith('.glb') else Path(p)
        rows.append({'code': job.parent.name, 'job': job, 'glb': find_glb(p), 'mode': None, 'served': None})
    if not rows:
        ap.error('give job directories or --library')
    print(f"{'species':24s} {'job':13s} {'mode':8s} {'srv':3s} {'head':>6s} {'spine':>6s} {'st.f':>5s} {'st.h':>5s} "
          f"{'feet':>4s}  verdict")
    res = []
    for r in rows:
        if r['glb'] is None:
            print(f"{r['code']:24s} {Path(r['job']).name[:13]:13s} no model.glb")
            continue
        if r['mode'] is None and (Path(r['job']) / 'job.json').exists():
            r['mode'] = json.loads((Path(r['job']) / 'job.json').read_text()).get('mode')
        m = measure(r['glb'], keep=bool(a.sheet or a.sheet_dir))
        g = gate(r['glb'], m)
        print(f"{r['code']:24s} {Path(r['job']).name[:13]:13s} {str(r['mode']):8s} "
              f"{'' if r['served'] is None else ('yes' if r['served'] else 'no'):3s} "
              f"{_fmt(g['head_turn'], '6.1f')} {_fmt(g['spine_bend'], '6.1f')} {_fmt(g['stagger_fore'], '5.2f')} "
              f"{_fmt(g['stagger_hind'], '5.2f')} {g['feet']:4d}  {'pass' if g['ok'] else 'FAIL: ' + '; '.join(g['why'])}",
              flush=True)
        res.append({**{k: str(v) for k, v in r.items()}, **g})
        if a.sheet and len(rows) == 1:
            sheet(r['glb'], a.sheet, m)
        if a.sheet_dir:
            sheet(r['glb'], Path(a.sheet_dir) / f"{r['code']}_{Path(r['job']).name[:13]}.jpg", m,
                  title=f"{r['code']} {Path(r['job']).name[:13]} {r['mode']}")
    if a.json:
        print(json.dumps(res, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
