"""pipeline/straighten.py: a turned head set straight in a generated quadruped's source mesh. Offline: an animal lofted
in the test (a trunk, a neck that curves aside, a head; four legs), written as a GLB with normals and texture
coordinates."""
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from pipeline import fauna_models as fm
from pipeline import pose_gate as pg
from pipeline import straighten as st


def box(x0, x1, y0, y1, z0, z1):
    c = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)
    q = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return c, np.array([t for a, b, c_, d in q for t in ((a, b, c_), (a, c_, d))])


def animal(turn=0.0, horn=False, n=20):
    """(P, T): a tube from the tail to the nose, 1.75 long, standing on four legs; ahead of the shoulders its heading
    swings `turn` degrees to one side over the neck and holds through the head. horn: a thin bar set into the top of
    the head (a piece of its own) reaching back and up over the shoulders."""
    xs = np.linspace(-0.6, 0.5, 23)
    path = [(-0.63, 0.6, 0.0)] + [(x, 0.6, 0.0) for x in xs]
    rad = [0.0] + [0.18] * len(xs)
    p, ds = np.array([0.5, 0.6, 0.0]), 0.025
    for k in range(1, 21):
        s = k * ds
        f = min(s / 0.25, 1.0)
        psi = np.radians(turn) * f * f * (3 - 2 * f)
        p = p + ds * np.array([np.cos(psi), 0.8 * (1 - f), np.sin(psi)])
        path.append(tuple(p))
        rad.append(0.18 - 0.08 * f if s < 0.4 else 0.10 - 0.04 * (s - 0.4) / 0.1)
    psi = np.radians(turn)
    path.append(tuple(p + 0.03 * np.array([np.cos(psi), 0, np.sin(psi)])))
    path = np.array(path)
    V, F = [path[0]], []
    for i in range(1, len(path) - 1):
        tan = path[i + 1] - path[i - 1]
        side = np.array([-tan[2], 0, tan[0]]) / np.hypot(tan[0], tan[2])
        for k in range(n):
            a = 2 * np.pi * k / n
            V.append(path[i] + rad[i] * (np.cos(a) * side + np.sin(a) * np.array([0, 1.0, 0])))
    V.append(path[-1])
    rings = len(path) - 2
    ring = lambda r, k: 1 + r * n + k % n
    for k in range(n):
        F.append((0, ring(0, k), ring(0, k + 1)))
        F.append((len(V) - 1, ring(rings - 1, k + 1), ring(rings - 1, k)))
        for r in range(rings - 1):
            F += [(ring(r, k), ring(r + 1, k), ring(r + 1, k + 1)), (ring(r, k), ring(r + 1, k + 1), ring(r, k + 1))]
    P, T = [np.array(V)], [np.array(F)]
    at = len(V)
    for x in (-0.4, 0.4):
        for z in (-0.12, 0.12):
            c, t = box(x - 0.04, x + 0.04, 0.0, 0.5, z - 0.04, z + 0.04)
            P.append(c); T.append(t + at); at += len(c)
    if horn:
        head = path[-6]
        c, t = box(-0.62, 0.02, -0.01, 0.01, -0.01, 0.01)
        c[:, 1] -= 0.4 * c[:, 0]                                   # rising toward its far end, clear of the neck
        c = c @ np.array([[np.cos(psi), 0, np.sin(psi)], [0, 1, 0], [-np.sin(psi), 0, np.cos(psi)]]) + head + [0, 0.11, 0]
        P.append(c); T.append(t + at); at += len(c)
    return np.concatenate(P), np.concatenate(T)


def turned(P, deg):
    """The points turned about the vertical."""
    c, s = np.cos(np.radians(deg)), np.sin(np.radians(deg))
    return np.stack([P[:, 0] * c - P[:, 2] * s, P[:, 1], P[:, 0] * s + P[:, 2] * c], 1)


def normals(P, T):
    N = np.zeros_like(P)
    f = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3):
        np.add.at(N, T[:, k], f)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def write_glb(path, P, T, node=None):
    P32, N32 = P.astype('<f4'), normals(P, T).astype('<f4')
    UV = np.stack([P[:, 0], P[:, 1]], 1).astype('<f4')
    I = T.astype('<u4').ravel()
    chunks, views, off = [], [], 0
    for b in (P32.tobytes(), N32.tobytes(), UV.tobytes(), I.tobytes()):
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}); chunks.append(b); off += len(b)
    js = {'asset': {'version': '2.0'}, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, **(node or {})}], 'buffers': [{'byteLength': off}],
          'bufferViews': views,
          'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P32.min(0).tolist(), 'max': P32.max(0).tolist()},
                        {'bufferView': 1, 'componentType': 5126, 'count': len(P), 'type': 'VEC3'},
                        {'bufferView': 2, 'componentType': 5126, 'count': len(P), 'type': 'VEC2'},
                        {'bufferView': 3, 'componentType': 5125, 'count': len(I), 'type': 'SCALAR'}],
          'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3}]}]}
    jb = json.dumps(js).encode(); jb += b' ' * (-len(jb) % 4)
    body = b''.join(chunks)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(jb) + 8 + len(body)) + struct.pack('<I4s', len(jb), b'JSON') + jb
                           + struct.pack('<I4s', len(body), b'BIN\0') + body)
    return Path(path)


class Mesh(unittest.TestCase):
    def test_a_turned_head_is_set_straight_and_the_trunk_and_legs_stay(self):
        P, T = animal(turn=35)
        P2, N2, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertGreater(rec['before']['head_turn'], 15)
        self.assertTrue(rec['ok'] and rec['changed'], rec)
        self.assertLess(rec['after']['head_turn'], st.DONE)
        self.assertLess(rec['stretch'], st.STRETCH)
        behind = P[:, 0] < 0.3                                        # the trunk behind the shoulders, the legs
        np.testing.assert_allclose(P2[behind], P[behind], atol=1e-12)
        np.testing.assert_allclose(P2[:, 1], P[:, 1], atol=1e-12)     # no height changes
        self.assertLess(abs(P2[P2[:, 0] > 0.9][:, 2].mean()), 0.02)   # the head stands on the body's line
        self.assertGreater(abs(P[P[:, 0] > 0.9][:, 2].mean()), 0.10)
        np.testing.assert_allclose(np.linalg.norm(N2, axis=1), 1.0, atol=1e-9)

    def test_a_head_facing_forward_is_left_as_generated(self):
        P, T = animal(turn=0)
        P2, _, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertTrue(rec['ok'])
        self.assertFalse(rec['changed'])
        self.assertIs(P2, P)

    def test_a_body_standing_off_the_axis_is_set_square(self):
        P, T = animal(turn=0)
        P = turned(P, 17.0)
        P2, N2, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertTrue(rec['ok'] and rec['changed'] and rec['squared'], rec)
        self.assertAlmostEqual(abs(rec['yaw']), 17.0, delta=0.5)
        self.assertEqual(rec['passes'], 0)                             # the head was straight: only the turn
        feet = lambda X, x: X[(X[:, 1] < 0.01) & (np.sign(X[:, 0]) == x)].mean(0)
        axis = feet(P2, 1) - feet(P2, -1)
        self.assertLess(abs(np.degrees(np.arctan2(axis[2], axis[0]))), 0.5)
        self.assertGreater(P2[np.argmax(P2[:, 1])][0], 0.5)            # and it faces the way it did
        np.testing.assert_allclose(P2[:, 1], P[:, 1], atol=1e-12)
        d = lambda X: np.linalg.norm(X[T[:, 0]] - X[T[:, 1]], axis=1)
        np.testing.assert_allclose(d(P2), d(P), atol=1e-9)             # nothing bent

    def test_a_body_a_degree_off_is_left(self):
        P, T = animal(turn=0)
        P = turned(P, 1.0)
        P2, _, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertFalse(rec['changed'] or rec['squared'])
        self.assertIs(P2, P)

    def test_a_head_turned_past_the_limit_is_not_tried(self):
        P, T = animal(turn=35)
        with mock.patch.object(st, 'MAX_TURN', 10.0):
            P2, _, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertFalse(rec['ok'])
        self.assertIn('further than is straightened', rec['why'][0])
        self.assertIs(P2, P)

    def test_what_hangs_from_the_head_goes_with_it_whole(self):
        P, T = animal(turn=30, horn=True)
        horn = slice(len(P) - 8, len(P))
        self.assertLess(P[horn][:, 0].min(), 0.4)                      # it reaches back over the shoulders
        P2, _, rec = st.straighten_mesh(P, normals(P, T), T)
        self.assertTrue(rec['ok'] and rec['changed'], rec)
        d = lambda X: np.linalg.norm(X[horn][:, None] - X[horn][None], axis=2)
        np.testing.assert_allclose(d(P2), d(P), atol=1e-9)             # one piece, its shape kept
        self.assertGreater(np.linalg.norm(P2[horn] - P[horn], axis=1).min(), 0.01)
        heading = lambda X: abs(np.degrees(np.arctan2(*(X[horn][X[horn][:, 0].argmax()] - X[horn][X[horn][:, 0].argmin()])[[2, 0]])))
        self.assertGreater(heading(P), 25)
        self.assertLess(heading(P2), 6)                                # and it points along the body now


class File(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def job(self, name, turn, node=None):
        j = self.d / name
        j.mkdir()
        P, T = animal(turn=turn)
        write_glb(j / 'model.glb', P, T, node)
        return j

    def test_only_positions_and_normals_change_in_the_file(self):
        c, s = np.cos(0.1), np.sin(0.1)                                # 11.5 degrees about the vertical, as a node's turn
        j = self.job('turned', 30, {'rotation': [0, s, 0, c], 'scale': [2, 2, 2], 'translation': [3, 0, -1]})   # as the file lays it
        src = st.source(j)
        self.assertEqual(src.name, 'model_straight.glb')
        a, ab = pg.load_glb(j / 'model.glb')
        b, bb = pg.load_glb(src)
        self.assertEqual(a['nodes'], b['nodes'])
        for i in (2, 3):
            np.testing.assert_array_equal(pg.accessor(a, ab, i), pg.accessor(b, bb, i))
        self.assertFalse(np.allclose(pg.accessor(a, ab, 0), pg.accessor(b, bb, 0)))
        self.assertEqual(b['accessors'][0]['max'], [float(x) for x in pg.accessor(b, bb, 0).astype('<f4').max(0)])
        self.assertGreater(pg.gate(j / 'model.glb')['head_turn'], pg.MAX_HEAD_TURN)
        self.assertLess(pg.gate(src)['head_turn'], st.DONE)
        rec = st.record(j)
        self.assertTrue(rec['squared'])
        self.assertAlmostEqual(abs(rec['yaw']), 11.5, delta=0.6)
        _, _, _, P2, _, _ = st.read(src)                               # square in the scene, through the node's turn
        feet = lambda x: P2[(P2[:, 1] < 0.01) & (np.sign(P2[:, 0] - P2[:, 0].mean()) == x)].mean(0)
        axis = feet(1) - feet(-1)
        off = np.degrees(np.arctan2(axis[2], axis[0]))
        self.assertLess(abs(off - 90 * round(off / 90)), 0.6)

    def test_the_source_is_made_once_and_recorded(self):
        j = self.job('turned', 30)
        src = st.source(j)
        rec = st.record(j)
        self.assertEqual((rec['out'], rec['version']), ('model_straight.glb', st.VERSION))
        stamp = src.stat().st_mtime_ns
        self.assertEqual(st.source(j), src)
        self.assertEqual(src.stat().st_mtime_ns, stamp)
        self.assertEqual(st.source(j / 'model.glb'), src)             # by the file's path too

    def test_a_straight_job_is_read_as_generated(self):
        j = self.job('straight', 0)
        self.assertEqual(st.source(j).name, 'model.glb')
        self.assertFalse((j / 'model_straight.glb').exists())
        self.assertIsNone(st.record(j)['out'])

    def test_the_pose_check_passes_a_head_that_could_be_set_straight(self):
        g = fm.pose_check(self.job('turned', 30))
        self.assertTrue(g['ok'], g)
        self.assertGreater(g['straightened'], 15)
        self.assertLess(g['head_turn'], st.DONE)
        g = fm.pose_check(self.job('straight', 0))
        self.assertTrue(g['ok'])
        self.assertIsNone(g['straightened'])

    def test_the_pose_check_still_refuses_a_head_that_could_not(self):
        with mock.patch.object(st, 'MAX_TURN', 10.0):
            g = fm.pose_check(self.job('far', 35))
        self.assertFalse(g['ok'])
        self.assertIsNone(g['straightened'])
        self.assertTrue(any('degrees (limit' in w for w in g['why']), g['why'])                 # the gate's own reason
        self.assertTrue(any('further than is straightened' in w for w in g['why']), g['why'])   # and why it was not fixed


if __name__ == '__main__':
    unittest.main()
