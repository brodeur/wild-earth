"""pipeline/pose_gate.py: the pose measures on synthetic box animals with known poses (offline; no library files).

The animal: a box trunk 1.0 long (x 0 to 1), 0.3 wide and 0.3 deep on four box legs 0.5 long (so the leg length is 0.5),
a neck-and-head box reaching 0.45 beyond the fore feet, and a thin tail behind. Each case moves one part by a known
amount and checks that its measure reads it, and that the gate passes the square animal and fails the others.
"""
import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from pipeline import pose_gate as pg

LEG = 0.5
HIND_X, FORE_X, HALF_GAUGE = 0.1, 0.9, 0.1


def box(x0, x1, y0, y1, z0, z1):
    """The 12 triangles of an axis-aligned box: (12, 3, 3)."""
    c = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)
    q = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tris = []
    for a, b, cc, d in q:
        tris += [[c[a], c[b], c[cc]], [c[a], c[cc], c[d]]]
    return np.array(tris)


def yaw(T, deg, pivot):
    """Turn triangles about the vertical axis through pivot (x, z) by deg: positive takes +x toward -z, which is the
    animal's left when it faces +x with +y up."""
    t = np.radians(deg)
    R = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    p = np.array([pivot[0], 0, pivot[1]])
    return (T - p) @ R.T + p


def leg(x, z):
    return box(x - 0.04, x + 0.04, 0, LEG, z - 0.04, z + 0.04)


def animal(head_yaw=0.0, bend=0.0, fore_shift=0.0, hind_shift=0.0):
    """Triangles of the box animal. head_yaw turns the neck and head about the fore feet; bend turns the rear half of the
    trunk (with its legs and tail) by -bend/2 and the front half (with its legs and head) by +bend/2 about the middle;
    fore_shift (hind_shift) moves one fore (hind) foot forward and the other back by that much."""
    rear = [box(0.0, 0.5, LEG, 0.8, -0.15, 0.15), leg(HIND_X + hind_shift, -HALF_GAUGE),
            leg(HIND_X - hind_shift, HALF_GAUGE),
            box(-0.4, 0.0, 0.68, 0.72, -0.015, 0.015)]
    head = yaw(box(FORE_X, FORE_X + 0.45, 0.62, 0.86, -0.07, 0.07), head_yaw, (FORE_X, 0.0))
    front = [box(0.5, 1.0, LEG, 0.8, -0.15, 0.15), leg(FORE_X + fore_shift, -HALF_GAUGE),
             leg(FORE_X - fore_shift, HALF_GAUGE), head]
    R = yaw(np.concatenate(rear), -bend / 2, (0.5, 0.0))
    F = yaw(np.concatenate(front), bend / 2, (0.5, 0.0))
    return np.concatenate([R, F])


def write_glb(path, T, node=None):
    """A one-mesh GLB of triangles T, indexed, under one node (optionally with a matrix or TRS)."""
    P = T.reshape(-1, 3).astype(np.float32)
    idx = np.arange(len(P), dtype=np.uint32)
    pb, ib = P.tobytes(), idx.tobytes()
    js = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'mesh': 0, **(node or {})}],
          'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
          'buffers': [{'byteLength': len(pb) + len(ib)}],
          'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(pb)},
                          {'buffer': 0, 'byteOffset': len(pb), 'byteLength': len(ib)}],
          'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3',
                         'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
                        {'bufferView': 1, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}]}
    j = json.dumps(js).encode()
    j += b' ' * (-len(j) % 4)
    b = pb + ib
    b += b'\0' * (-len(b) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(j) + 8 + len(b))
    out += struct.pack('<I', len(j)) + b'JSON' + j + struct.pack('<I', len(b)) + b'BIN\0' + b
    Path(path).write_bytes(out)
    return path


class PoseGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_gate(self, name, T, node=None):
        return pg.gate(write_glb(self.d / f'{name}.glb', T, node))

    def test_square_passes(self):
        g = self.run_gate('square', animal())
        self.assertEqual(g['feet'], 4)
        self.assertAlmostEqual(g['leg'], LEG, delta=0.02)
        self.assertLess(g['head_turn'], 1.0)
        self.assertLess(g['spine_bend'], 1.0)
        self.assertLess(g['stagger_fore'], 0.03)
        self.assertLess(g['stagger_hind'], 0.03)
        self.assertTrue(g['ok'], g['why'])

    def test_head_turn_reads_the_yaw(self):
        # tolerance 3 degrees: the head's end is the centroid of its last tenth, which a box's corner pulls sideways
        for deg in (20.0, -14.0):
            g = self.run_gate(f'head{deg}', animal(head_yaw=deg))
            self.assertAlmostEqual(g['head_turn'], abs(deg), delta=3.0)
            self.assertEqual(np.sign(g['head_turn_signed']), np.sign(deg))
            self.assertLess(g['spine_bend'], 1.0)
            self.assertFalse(g['ok'])
            self.assertTrue(any('head is turned' in w for w in g['why']), g['why'])

    def test_spine_bend_reads_the_bend(self):
        g = self.run_gate('bend', animal(bend=10.0))
        self.assertAlmostEqual(g['spine_bend'], 10.0, delta=1.5)
        self.assertGreater(g['spine_bend_signed'], 0)          # the front half turned toward the left
        self.assertFalse(g['ok'])
        self.assertTrue(any('spine is bent' in w for w in g['why']), g['why'])

    def test_stagger_reads_a_stride(self):
        g = self.run_gate('stride', animal(hind_shift=0.3))     # the hind feet 0.6 apart: 1.2 leg lengths
        self.assertAlmostEqual(g['stagger_hind'], 0.6 / LEG, delta=0.05)
        self.assertLess(g['stagger_fore'], 0.03)
        self.assertLess(g['head_turn'], 1.0)
        self.assertLess(g['spine_bend'], 1.0)
        self.assertFalse(g['ok'])
        self.assertTrue(any('hind feet' in w for w in g['why']), g['why'])
        g = self.run_gate('half_stride', animal(fore_shift=0.15))   # the fore feet 0.3 apart: 0.6, inside the limit
        self.assertAlmostEqual(g['stagger_fore'], 0.3 / LEG, delta=0.05)
        self.assertLess(g['stagger_hind'], 0.03)
        self.assertLess(g['head_turn'], 1.0)
        self.assertTrue(g['ok'], g['why'])

    def test_node_transform_and_orientation(self):
        # the same square animal turned 37 degrees, scaled and moved by its node (TRS), and by a matrix; and facing -x
        t = np.radians(37 / 2)
        trs = {'rotation': [0.0, float(np.sin(t)), 0.0, float(np.cos(t))], 'scale': [2.0, 2.0, 2.0],
               'translation': [3.0, 1.0, -5.0]}
        c, s = np.cos(np.radians(-120)), np.sin(np.radians(-120))
        mat = {'matrix': [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0.5, 0, 0.2, 1]}
        for name, T, node in (('trs', animal(), trs), ('matrix', animal(), mat),
                              ('mirrored', animal() * np.array([-1, 1, 1]), None)):
            g = self.run_gate(name, T, node)
            self.assertEqual(g['feet'], 4, name)
            self.assertLess(g['head_turn'], 1.0, name)
            self.assertLess(g['spine_bend'], 1.0, name)
            self.assertLess(g['stagger_fore'], 0.03, name)
            self.assertTrue(g['ok'], (name, g['why']))
        g = self.run_gate('trs_turned', animal(head_yaw=20.0), trs)
        self.assertAlmostEqual(g['head_turn'], 20.0, delta=3.0)

    def test_no_legs_fails(self):
        g = self.run_gate('lump', box(0, 1, 0, 0.4, -0.2, 0.2))
        self.assertFalse(g['ok'])


if __name__ == '__main__':
    unittest.main()
