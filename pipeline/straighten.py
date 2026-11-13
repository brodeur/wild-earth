"""Straighten a turned head: a generated quadruped's source mesh set facing forward before anything is built from it.

A text-to-3D model keeps the pose its generator gave it, and about half of them come with the head turned to one side
(pipeline/pose_gate.py: 11 of the 21 served four-legged sources over 9.5 degrees on 2026-11-12). The rig, the gait
engine and the hero tier assume a head facing forward, so a turned one shows in the game. Refusing each such preview
costs 20 credits a try; turning the head back costs none. One rule for every four-legged species; nothing per species.

  frame     the pose gate's: the body's axis from the hind feet's midpoint to the fore feet's, the trunk's centreline
            seen from above, the neck's base where that line passes the fore feet, the head's end.
  field     how far along the neck and head each vertex sits, 0 to 1, as the steady state of heat on the mesh (welded
            across its texture seams): the trunk and legs behind the neck's base held at 0 (up to the height of the
            mid-back), the head's end held at 1. Whatever hangs from the head takes the value where it joins, so
            antlers, horns and ears reaching back over the shoulders go with the head; a hump, a mane or the withers
            standing above the back touch the trunk beneath them and are held at 0 with it.
  line      the centre of the neck and head seen from above: the middle of each band of the field ahead of the neck's
            base (weighted by where the field climbs, so what hangs from the head does not pull it), and through
            those middles and the head's end one smooth curve that leaves the base along the trunk.
  unbend    that curve laid straight along the trunk's own direction, its length kept, and every vertex carried with
            its place on it: turned about the vertical by the curve's heading there and moved to where that place
            went.
            Heights do not change (a lowered or raised head stays so); a head that is straight on a bent neck turns as
            one piece, a neck that curves is uncurved where it curves, and a neck that rises straight up twists.
  check     the pose is measured again on the result (and the unbend repeated, at most PASSES times, while the head is
            still off), and the mesh's edges compared with what they were. The source is kept as it is when the turn
            is under MIN_TURN (nothing to see); nothing is written when the head was turned over MAX_TURN, is still
            turned over DONE, or an edge in a hundred changed length by more than STRETCH (a neck folded on itself, a
            head the frame mistook): the pose gate then refuses the mesh for its turned head, as before.

  square    the body itself can stand turned in the file (the wolf's 17 degrees off the axis the build and the rig
            take for forward, so it walked crabwise): when the line from the hind feet to the fore feet is more than
            MIN_YAW off the nearest of the file's axes, the whole mesh is turned about the vertical onto it. Which way
            the animal faces is not changed (the build's own rule).

  source(job) is what every reader of a job's mesh calls (the quadruped build, the hero build, the likeness render and
  the pose gate): the job's model.glb, or model_straight.glb beside it, written once and recorded in straighten.json.
  Only positions and normals differ; the texture, its coordinates and the triangles are the generator's.

  arch -arm64 .venv/bin/python -m pipeline.straighten <job dir or glb> [...] [--sheet out.jpg] [--force]
  arch -arm64 .venv/bin/python -m pipeline.straighten --served [--sheet-dir DIR]
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

from . import pose_gate as pg

ROOT = Path(__file__).resolve().parent.parent
VERSION = 2            # the method's; a record of another version is made again (2: the body set square)

# ---- method constants ---------------------------------------------------------------------------------------------
BANDS = 10             # bands of the field between the neck's base and the head's end
POWERS = (2, 3)        # the fitted curve's terms, a x^2 + b x^3. A third and a fourth term were tried on the test's
                       # lofted animal (tests/test_straighten.py, the neck swung 35 degrees): the head's end lands in
                       # one pass instead of three, but an edge in a hundred stretches 1.66 instead of 1.18 and a bar
                       # set along the head comes out 17 degrees off the body's line instead of 4
FINE = 64              # samples of the fitted curve between the base and the head's end
MIN_BAND = 0.01        # a band holding under this share of the area ahead of the neck's base gives no station
NOSE = 0.03            # the head's end: the surface within this share of the body's length of its foremost point
PASSES = 3             # the unbend is measured and repeated at most this many times

# ---- thresholds (2026-11-12, on the sources of the 21 served four-legged models; docs/avatar-realism.md) -----------
MIN_TURN = 3.0         # degrees: a head turned less is left as the generator made it. The measure repeats within 0.5
                       # between sampling seeds; the pose gate's sheets start to show a turn by eye near 9.5; seven of
                       # the 21 read under 2.3 and are left alone (a call: nothing between 2.3 and 5.5 to place it by).
DONE = 3.0             # degrees: the turn left after straightening must be under this (the same level). The 14
                       # straightened read 0.0 to 2.3 afterwards (the cheetah the most, after three passes).
MAX_TURN = 45.0        # degrees: a head turned further is not tried. The furthest straightened and checked by eye from
STRETCH = 2.0          # above, the front and three-quarter is 38.4 (wildebeest), and the most an edge in a hundred
                       # changed length among the 14 is a factor of 1.83 (wolf, 26 degrees on a short ruffed neck), with
                       # no damage seen in any. No failing case is known, so both limits only refuse what lies beyond
                       # what has been looked at.
MIN_YAW = 2.0          # degrees: a body standing less than this off the file's axis is left. The 21 served sources
                       # stand 0.0 to 16.9 off (wolf 16.9, mountain goat 12.2, coyote 7.7; fifteen under 2.0); the
                       # measure repeats within 0.2 between a source and the model built from it.


# ---- the mesh of a GLB, read and written back ---------------------------------------------------------------------
def read(glb):
    """(js, bin, parts, P, N, T): every triangle primitive in the scene with its node's transform applied; P and N the
    world positions and normals of all of them together, T the triangles into P. None when a mesh is drawn twice (two
    nodes sharing one: its vertices cannot be moved for one and not the other)."""
    js, bin_ = pg.load_glb(glb)
    scene = js.get('scenes', [{'nodes': list(range(len(js.get('nodes', []))))}])[js.get('scene', 0)]
    parts, seen = [], set()
    Ps, Ns, Ts = [], [], []
    n0 = 0

    def walk(i, parent):
        nonlocal n0
        nd = js['nodes'][i]
        M = parent @ pg.node_matrix(nd)
        if 'mesh' in nd:
            for pr in js['meshes'][nd['mesh']]['primitives']:
                if pr.get('mode', 4) != 4:
                    continue
                ia = pr['attributes']['POSITION']
                if ia in seen:
                    raise ValueError('a mesh is drawn by more than one node')
                seen.add(ia)
                p = pg.accessor(js, bin_, ia)
                A = M[:3, :3]
                P = p @ A.T + M[:3, 3]
                inn = pr['attributes'].get('NORMAL')
                if inn is not None:
                    N = pg.accessor(js, bin_, inn) @ np.linalg.inv(A)
                    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
                else:
                    N = np.zeros_like(P)
                idx = (pg.accessor(js, bin_, pr['indices']).astype(np.int64).ravel() if 'indices' in pr else np.arange(len(P)))
                parts.append({'M': M, 'pos': ia, 'nor': inn, 'at': n0, 'n': len(P)})
                Ps.append(P); Ns.append(N); Ts.append(idx.reshape(-1, 3) + n0)
                n0 += len(P)
        for c in nd.get('children', []):
            walk(c, M)

    for i in scene['nodes']:
        walk(i, np.eye(4))
    if not parts:
        raise ValueError('no triangle meshes in the file')
    return js, bin_, parts, np.concatenate(Ps), np.concatenate(Ns), np.concatenate(Ts)


def _put(js, buf, i, rows):
    """Write float rows into accessor i of the binary buffer (a bytearray), and its bounds."""
    a = js['accessors'][i]
    v = js['bufferViews'][a['bufferView']]
    if a['componentType'] != 5126:
        raise ValueError('positions or normals are not 32-bit floats')
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    rows = np.ascontiguousarray(rows, dtype='<f4')
    size = rows.shape[1] * 4
    stride = v.get('byteStride', 0) or size
    for k in range(len(rows)) if stride != size else ():
        buf[off + k * stride: off + k * stride + size] = rows[k].tobytes()
    if stride == size:
        buf[off: off + rows.size * 4] = rows.tobytes()
    if 'min' in a:
        a['min'] = [float(x) for x in rows.min(0)]
    if 'max' in a:
        a['max'] = [float(x) for x in rows.max(0)]


def write(path, js, bin_, parts, P, N):
    """The GLB again with the moved positions and normals in their accessors; everything else as it was."""
    js = json.loads(json.dumps(js))
    buf = bytearray(bin_)
    for pt in parts:
        A, tr = pt['M'][:3, :3], pt['M'][:3, 3]
        s = slice(pt['at'], pt['at'] + pt['n'])
        _put(js, buf, pt['pos'], (P[s] - tr) @ np.linalg.inv(A).T)
        if pt['nor'] is not None:
            n = N[s] @ A
            _put(js, buf, pt['nor'], n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12))
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * (-len(jb) % 4)
    bb = bytes(buf) + b'\0' * (-len(buf) % 4)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jb) + 8 + len(bb)) + struct.pack('<I4s', len(jb), b'JSON') + jb
                           + struct.pack('<I4s', len(bb), b'BIN\0') + bb)


# ---- the body's frame ---------------------------------------------------------------------------------------------
def _into(X, fr, point=True):
    """Horizontal (x, z) of points (or directions) as (U, V) of the body's frame: along the body and to its left."""
    h = X[:, [0, 2]] - (fr['mean'] if point else 0)
    uv = np.stack([h @ fr['ax'], h @ fr['lat']], 1) - (fr['hind'] if point else 0)
    return uv @ fr['d'], uv @ fr['n2']


def _out_of(U, V, fr, point=True):
    uv = np.outer(U, fr['d']) + np.outer(V, fr['n2']) + (fr['hind'] if point else 0)
    return np.outer(uv[:, 0], fr['ax']) + np.outer(uv[:, 1], fr['lat']) + (fr['mean'] if point else 0)


# ---- the field ----------------------------------------------------------------------------------------------------
def weld(P, T, length):
    """The mesh joined across its texture seams: (first, inv, W, area): one welded vertex per place (first: an
    original vertex there; inv: every original vertex's welded one), the welded edge graph, each welded vertex's share
    of the surface."""
    from scipy import sparse
    key = np.round(P / (1e-6 * length)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    n = len(first)
    Tw = inv[T]
    e = np.concatenate([Tw[:, [0, 1]], Tw[:, [1, 2]], Tw[:, [2, 0]]])
    e = e[e[:, 0] != e[:, 1]]
    W = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), (n, n)).tocsr()
    W = W + W.T
    W.data[:] = 1.0
    a = 0.5 * np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1)
    area = np.zeros(n)
    for k in range(3):
        np.add.at(area, Tw[:, k], a / 3)
    return first, inv, W, area


def _steady(W, Pw, zero, one):
    """The steady state of heat on the graph with `zero` held at 0 and `one` at 1. A loose piece holding neither takes
    one value, the rest's where it comes closest."""
    from scipy import sparse
    from scipy.sparse import csgraph
    from scipy.sparse.linalg import spsolve
    from scipy.spatial import cKDTree
    _, lab = csgraph.connected_components(W, directed=False)
    fixed = zero | one
    has = np.bincount(lab[fixed], minlength=lab.max() + 1) > 0
    t = np.where(one, 1.0, 0.0)
    free = ~fixed & has[lab]
    if free.any():
        deg = np.asarray(W.sum(1)).ravel()
        Wf = W[free]
        t[free] = spsolve((sparse.diags(deg[free]) - Wf[:, free]).tocsc(), Wf[:, one] @ np.ones(int(one.sum())))
    lost = ~fixed & ~has[lab]
    if lost.any() and (~lost).any():                     # an eye, a tooth, a horn set into the head: one value a piece,
        dist, near = cKDTree(Pw[~lost]).query(Pw[lost])  # that of the rest where the piece comes closest to it
        rest, li = t[~lost], np.nonzero(lost)[0]
        for c in np.unique(lab[li]):
            m = lab[li] == c
            t[li[m]] = rest[near[m][np.argmin(dist[m])]]
    return np.clip(t, 0.0, 1.0)


def field(Pw, W, U, V, fr):
    """Each welded vertex's place along the neck and head, 0 (trunk and legs) to 1 (the head's end); None when no head
    stands beyond the fore feet."""
    from scipy.sparse import csgraph
    y = Pw[:, 1]
    if fr.get('nose') is None:
        return None
    near = np.linalg.norm(np.stack([U, V, y], 1) - np.asarray(fr['nose'], float), axis=1)
    one = near < max(NOSE * fr['length'], near.min() * 1.5)
    zero = (U <= fr['chord']) & (y <= fr['top']) & ~one
    # what stands above the back behind the neck's base: a piece that touches the trunk under it is the trunk's (a
    # hump, a mane, the withers, a raised tail); one that reaches back from the head touches only what is ahead
    over = ~zero & ~one & (U <= fr['chord'])
    if over.any():
        _, lab = csgraph.connected_components(W[over][:, over], directed=False)
        touches = np.bincount(lab, np.asarray(W[over][:, zero].sum(1)).ravel() > 0, lab.max() + 1) > 0
        zero[np.nonzero(over)[0][touches[lab]]] = True
    return _steady(W, Pw, zero, one)


# ---- the line and the unbend --------------------------------------------------------------------------------------
def flow(Pw, W, t):
    """How steeply the field climbs at each welded vertex (the root mean square of its slope along the vertex's
    edges). Along the neck and head the field climbs; on what hangs from them (an ear, an antler, a horn, the brisket)
    it is level, so weighing by this leaves the hangers-on out of the centreline."""
    W = W.tocoo()
    d = np.linalg.norm(Pw[W.row] - Pw[W.col], axis=1)
    s2 = ((t[W.row] - t[W.col]) / np.maximum(d, 1e-12)) ** 2
    n = len(t)
    return np.sqrt(np.bincount(W.row, s2, n) / np.maximum(np.bincount(W.row, minlength=n), 1))


def line(U, V, t, w, fr):
    """Stations of the neck and head's centreline seen from above: (t, U, V, weight) rows from the neck's base (t 0,
    on the trunk's line) to the head's end (t 1), each the weighted middle of a band of the field ahead of the base.
    w: each vertex's weight, its share of the surface times the field's slope there (see flow); the head's end, where
    the field is held level, by its surface alone, and weighing as much as all the bands together (the curve should
    end on it)."""
    ahead = (U > fr['chord']) & (t > 0) & (t < 1)
    whole = w[ahead].sum()
    rows = [(0.0, fr['base'][0], fr['base'][1], 0.0)]
    edges = np.linspace(0, 1, BANDS + 1)
    for a, b in zip(edges[:-1], edges[1:]):
        m = ahead & (t > a) & (t <= b)
        if not m.any() or w[m].sum() <= MIN_BAND * whole:
            continue
        rows.append((float(np.average(t[m], weights=w[m])), float(np.average(U[m], weights=w[m])), float(np.average(V[m], weights=w[m])), float(w[m].sum() / whole)))
    return rows


def plan(st, fr):
    """Where each part of the line goes and how far it turns: (t, U, V, U', V', heading) rows, fine enough to read
    between. The stations' sideways drift from the trunk's direction is fitted by a curve that leaves the neck's base
    along the trunk (a x^2 + b x^3 of the distance ahead of the base: one bend and its return, which is what a turned
    neck with the head looking partly back is; the stations alone wander with every ear and horn). The curve's length
    is kept, laid from the neck's base along the trunk's direction; the heading is the curve's own."""
    st = np.asarray(st, float)
    e0 = np.asarray(fr['trunk'], float)
    n0 = np.array([-e0[1], e0[0]])
    rel = st[:, 1:3] - np.asarray(fr['base'], float)
    if len(st) < 4:    # no neck between the base and the head's end (the head a piece of its own): one turn about the base
        far = float(np.linalg.norm(rel[-1]))
        return np.array([[0.0, *st[0, 1:3], *st[0, 1:3], 0.0],
                         [1.0, *st[-1, 1:3], *(st[0, 1:3] + far * e0), np.radians(pg._angle(e0, rel[-1]))]])
    x = np.maximum.accumulate(rel @ e0) + 1e-9 * fr['length'] * np.arange(len(st))
    y = rel @ n0
    A = np.stack([x ** k for k in POWERS], 1) * np.sqrt(st[:, 3:4])
    co = np.linalg.lstsq(A, y * np.sqrt(st[:, 3]), rcond=None)[0]
    xs = np.linspace(0, x[-1], FINE)
    f = sum(c * xs ** k for c, k in zip(co, POWERS))
    slope = sum(c * k * xs ** (k - 1) for c, k in zip(co, POWERS))
    L = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(xs), np.diff(f)))])
    ts = np.interp(xs, x, st[:, 0])
    ts = np.maximum.accumulate(ts) + 1e-12 * np.arange(FINE)
    old = np.asarray(fr['base'], float)[None, :] + xs[:, None] * e0[None, :] + f[:, None] * n0[None, :]
    new = np.asarray(fr['base'], float)[None, :] + L[:, None] * e0[None, :]
    return np.column_stack([ts, old, new, np.arctan(slope)])


def unbend(P, N, t, pl, fr):
    """Every vertex carried with its station: turned about the vertical by the station's heading and moved to the
    station's new place. Returns the new positions and normals."""
    U, V = _into(P, fr)
    ts = pl[:, 0]
    cu, cv, nu, nv, hd = (np.interp(t, ts, pl[:, k]) for k in (1, 2, 3, 4, 5))
    co, si = np.cos(hd), np.sin(hd)
    du, dv = U - cu, V - cv
    U2 = nu + co * du + si * dv                            # turned by minus the heading
    V2 = nv - si * du + co * dv
    moved = t > 0
    P2 = P.copy()
    xz = _out_of(U2[moved], V2[moved], fr)
    P2[moved, 0], P2[moved, 2] = xz[:, 0], xz[:, 1]
    N2 = N.copy()
    a, b = _into(N, fr, point=False)
    xz = _out_of((co * a + si * b)[moved], (-si * a + co * b)[moved], fr, point=False)
    N2[moved, 0], N2[moved, 2] = xz[:, 0], xz[:, 1]
    return P2, N2


def square(P, N, fr):
    """(P', N', off): the mesh turned about the vertical so the body's axis (hind feet to fore feet) lies on the
    nearest of the file's horizontal axes; off the degrees it stood from it."""
    f = fr['d'][0] * fr['ax'] + fr['d'][1] * fr['lat']                  # forward in (x, z)
    a = np.degrees(np.arctan2(f[0], f[1]))
    off = float(a - 90.0 * np.round(a / 90.0))
    c, s = np.cos(np.radians(off)), np.sin(np.radians(off))
    out = []
    for X, mid in ((P, np.array([fr['mean'][0], 0.0, fr['mean'][1]])), (N, np.zeros(3))):
        Y = X - mid
        out.append(np.stack([Y[:, 0] * c - Y[:, 2] * s, Y[:, 1], Y[:, 0] * s + Y[:, 2] * c], 1) + mid)
    return out[0], out[1], off


def straighten_mesh(P, N, T, min_turn=MIN_TURN):
    """(P', N', record). The record: ok (the result may be built from), changed, why, before and after (the pose
    gate's measures), yaw (how far the body stood off the file's axis) and squared (whether it was turned onto it),
    turn (the head's signed turn found), stretch (how far an edge in a hundred changed length in the unbend), moved
    (the farthest a vertex went in it, as a share of the body's length)."""
    def measured(X):
        return pg.measure_points(pg.sample_surface(X[T]), keep=True, tris=X[T])

    def brief(m):
        return {k: m.get(k) for k in ('head_turn', 'head_turn_signed', 'spine_bend', 'stagger_fore', 'stagger_hind', 'feet')}

    m = measured(P)
    rec = {'version': VERSION, 'ok': True, 'changed': False, 'why': [], 'before': brief(m), 'after': brief(m), 'turn': m.get('head_turn_signed'), 'passes': 0,
           'yaw': None, 'squared': False}
    if '_frame' in m:                                     # the body set square to the file's axis
        P1, N1, off = square(P, N, m['_frame'])
        rec['yaw'] = round(off, 2)
        if abs(off) > MIN_YAW:
            P, N, m = P1, N1, measured(P1)
            rec.update(squared=True, changed=True, after=brief(m))
    if m.get('head_turn') is None:
        rec.update(ok=False, why=['no head found beyond the fore feet'])
        return P, N, rec
    if m['head_turn'] <= min_turn:
        return P, N, rec
    if m['head_turn'] > MAX_TURN:
        rec.update(ok=False, why=[f"the head is turned {m['head_turn']:.1f} degrees, further than is straightened (limit {MAX_TURN:.0f})"])
        return P, N, rec
    P0 = P
    first, inv, W, area = weld(P, T, m['_frame']['length'])
    for _ in range(PASSES):
        fr = m['_frame']
        Uw, Vw = _into(P[first], fr)
        t = field(P[first], W, Uw, Vw, fr)
        if t is None:
            break
        cap = t >= 1
        st = line(Uw, Vw, t, area * flow(P[first], W, t), fr)
        st.append((1.0, float(np.average(Uw[cap], weights=area[cap])), float(np.average(Vw[cap], weights=area[cap])), 1.0))
        pl = plan(st, fr)
        P, N = unbend(P, N, t[inv], pl, fr)
        rec['passes'] += 1
        m = measured(P)
        if m.get('head_turn') is None or m['head_turn'] <= 0.5 * DONE:
            break
    e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    l0 = np.linalg.norm(P0[e[:, 0]] - P0[e[:, 1]], axis=1)
    l1 = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
    went = np.linalg.norm(P - P0, axis=1) > 1e-9
    r = (l1 / np.maximum(l0, 1e-12))[(went[e[:, 0]] | went[e[:, 1]]) & (l0 > 0)]
    lo, hi = (np.percentile(r, [1, 99]) if len(r) else (1.0, 1.0))
    rec.update(changed=bool(rec['passes']) or rec['squared'], after=brief(m), stretch=round(float(max(hi, 1 / max(lo, 1e-9))), 3),
               moved=round(float(np.linalg.norm(P - P0, axis=1).max() / m['length']), 3))
    if m.get('head_turn') is None or m['head_turn'] > DONE:
        rec['why'].append(f"the head is still turned {m.get('head_turn')} degrees after straightening (limit {DONE})")
    if rec['stretch'] > STRETCH:
        rec['why'].append(f"straightening changed an edge in a hundred by a factor of {rec['stretch']} (limit {STRETCH})")
    rec['ok'] = not rec['why']
    return P, N, rec


def straighten(glb, out=None, min_turn=MIN_TURN):
    """Straighten the head of the mesh in `glb`; write the result to `out` when it changed and may be built from.
    Returns the record (see straighten_mesh), with 'out' the file written or None."""
    try:
        js, bin_, parts, P, N, T = read(glb)
        P2, N2, rec = straighten_mesh(P, N, T, min_turn)
    except Exception as ex:   # an unreadable mesh is left as it is; the pose gate says what is wrong with it
        return {'version': VERSION, 'ok': False, 'changed': False, 'why': [f'the mesh could not be straightened ({type(ex).__name__}: {str(ex)[:80]})'], 'out': None}
    rec['out'] = None
    if out and rec['ok'] and rec['changed']:
        write(out, js, bin_, parts, P2, N2)
        rec['out'] = str(out)
    return rec


# ---- a job's source -----------------------------------------------------------------------------------------------
def source(job, force=False):
    """The mesh to build a job's model from: its model.glb, or model_straight.glb beside it when the head was turned
    and has been straightened (made once; straighten.json records what was found). A job dir or a model.glb."""
    job = Path(job)
    job = job.parent if job.is_file() else job
    src, out, note = job / 'model.glb', job / 'model_straight.glb', job / 'straighten.json'
    if not src.exists():
        return src
    stamp = [src.stat().st_size, int(src.stat().st_mtime)]
    try:
        rec = json.loads(note.read_text())
    except (OSError, ValueError):
        rec = None
    if force or not rec or rec.get('version') != VERSION or rec.get('source') != stamp or (rec.get('out') and not out.exists()):
        rec = straighten(src, out)
        rec['source'] = stamp
        rec['out'] = out.name if rec.get('out') else None
        if not rec['out'] and out.exists():
            out.unlink()
        try:
            note.write_text(json.dumps(rec, indent=1))
        except OSError:
            pass
    return out if rec.get('out') else src


def record(job):
    """What straightening found for a job (source() first): the record, or None."""
    job = Path(job)
    job = job.parent if job.is_file() else job
    try:
        return json.loads((job / 'straighten.json').read_text())
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('jobs', nargs='*', help='job folders or GLBs')
    ap.add_argument('--served', action='store_true', help="every served four-legged model's source")
    ap.add_argument('--force', action='store_true', help='measure and write again')
    ap.add_argument('--sheet', help='a top-down picture of the result (one job)')
    ap.add_argument('--sheet-dir', help='top-down pictures, before and after, of each (--served)')
    a = ap.parse_args(argv)
    jobs = [(Path(j).name, Path(j)) for j in a.jobs]
    if a.served:
        from . import likeness as lk
        from .fauna_models import registry
        for code, e in sorted(registry().get('species', {}).items()):
            s = lk.source_of(code) if e.get('kind', 'quadruped') == 'quadruped' else None
            if s:
                jobs.append((code, s.parent))
    print(f"{'':28} {'before':>7} {'after':>7} {'stretch':>8} {'moved':>6}  result")
    for name, j in jobs:
        p = source(j, force=a.force)
        r = record(j) or {}
        b, af = (r.get('before') or {}).get('head_turn'), (r.get('after') or {}).get('head_turn')
        res = 'straightened' if r.get('out') else ('as generated' if r.get('ok') else 'refused: ' + '; '.join(r.get('why', [])))
        print(f"{name[:28]:28} {pg._fmt(b, '.1f'):>7} {pg._fmt(af, '.1f'):>7} {pg._fmt(r.get('stretch'), '.2f'):>8} {pg._fmt(r.get('moved'), '.3f'):>6}  {res}")
        sheet = a.sheet or (str(Path(a.sheet_dir) / f'{name}.jpg') if a.sheet_dir else None)
        if sheet:
            pg.sheet(p, sheet, title=f'{name}: {res}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
