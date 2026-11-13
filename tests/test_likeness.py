"""pipeline/likeness.py: a model's likeness to photographs of its species, and its stage in the acceptance rule
(pipeline/fauna_models.py). Offline: synthetic silhouettes and pictures, a textured box written as a GLB in the test,
stand-in embeddings; nothing here reads the git-ignored photo cache or the embedding network."""
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from pipeline import fauna_models as fm
from pipeline import likeness as lk

ROOT = Path(__file__).resolve().parent.parent


def animal(w=200, h=120, legs=True):
    """A side-on silhouette: a trunk 160 x 50 with a head block at one end and, with legs, four legs 40 long."""
    m = np.zeros((h, w), bool)
    m[20:70, 20:180] = True                      # the trunk
    m[10:40, 170:195] = True                     # the head
    if legs:
        for x in (30, 50, 150, 168):
            m[70:110, x:x + 10] = True
    return m


def paint(mask, base=(0.30, 0.22, 0.14)):
    img = np.zeros(mask.shape + (3,), float)
    img[mask] = base
    return img


class Regions(unittest.TestCase):
    def test_a_standing_animal_is_cut_into_its_five_regions(self):
        nz = lk.normalised(paint(animal()), animal())
        reg = lk.regions(nz[1])
        self.assertEqual(set(reg), set(lk.REGIONS))
        rows = {k: np.nonzero(m.any(1))[0].mean() for k, m in reg.items()}
        self.assertLess(rows["back"], rows["flank"])
        self.assertLess(rows["flank"], rows["under"])
        self.assertLess(rows["under"], rows["legs"])
        self.assertFalse((reg["back"] & reg["flank"]).any())

    def test_no_belly_line_means_no_regions(self):
        self.assertIsNone(lk.regions(animal(legs=False)))   # lying down, in tall grass, a rock


class Measures(unittest.TestCase):
    def test_a_dark_saddle_reads_as_the_back_darker_than_the_flank(self):
        m = animal()
        img = paint(m)
        plain = lk.measures(img, m)
        img[20:34, 20:180] = (0.03, 0.03, 0.03)   # the top of the trunk painted near black
        saddle = lk.measures(img, m)
        self.assertAlmostEqual(plain["back.L"], 0.0, delta=1.0)
        self.assertLess(saddle["back.L"], -25.0)
        self.assertAlmostEqual(saddle["legs.L"], plain["legs.L"], delta=1.0)   # the legs against the flank: unchanged

    def test_rufous_legs_read_as_legs_redder_and_yellower_than_the_flank(self):
        m = animal()
        img = paint(m, (0.2, 0.2, 0.2))
        img[72:110] = np.where(m[72:110, :, None], (0.45, 0.16, 0.04), img[72:110])
        r = lk.measures(img, m)
        self.assertGreater(r["legs.a"], 10.0)
        self.assertGreater(r["legs.b"], 10.0)
        self.assertAlmostEqual(r["trunk.a"], 0.0, delta=1.5)

    def test_the_ground_behind_the_animal_does_not_bleed_into_it(self):
        m = animal()
        img = paint(m, (0.2, 0.2, 0.2))
        img[~m] = (0.0, 1.0, 0.0)                 # a loud green ground
        r = lk.measures(img, m)
        self.assertAlmostEqual(r["trunk.a"], 0.0, delta=2.0)

    def test_the_cloud_measures_a_picture_in_its_own_spreads(self):
        rng = np.random.default_rng(1)
        F = rng.normal(0, 1, (12, len(lk.KEYS))) * 5
        c, s = lk._cloud(F)
        self.assertTrue((s >= lk._floor()).all())   # a measure's spread is never under its floor
        d, z = lk.distance(c, {"centre": c, "spread": s})
        self.assertEqual(d, 0.0)


def textured_box(path, long_axis="z"):
    """A box 2 long, 0.5 wide, 1 high, its texture red on the left half of the image and blue on the right; the faces
    are mapped so the +side face is red."""
    from PIL import Image
    L = {"z": (0.25, 1.0, 1.0), "x": (1.0, 1.0, 0.25)}[long_axis]
    c = np.array([[sx * L[0], sy * 0.5 + 0.5, sz * L[2]] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], np.float32)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    P, UV, I = [], [], []
    for q in quads:
        base = len(P)
        P += [c[i] for i in q]
        red = all(c[i][0] > 0 for i in q) if long_axis == "z" else all(c[i][2] > 0 for i in q)
        UV += [[0.25 if red else 0.75, 0.5]] * 4
        I += [base, base + 1, base + 2, base, base + 2, base + 3]
    P, UV, I = np.array(P, np.float32), np.array(UV, np.float32), np.array(I, np.uint16)
    im = Image.new("RGB", (8, 8)); px = im.load()
    for x in range(8):
        for y in range(8):
            px[x, y] = (255, 0, 0) if x < 4 else (0, 0, 255)
    buf = io.BytesIO(); im.save(buf, "PNG"); png = buf.getvalue()
    chunks, views, off = [], [], 0
    for b in (P.tobytes(), UV.tobytes(), I.tobytes(), png):
        pad = (-len(b)) % 4
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b)}); chunks.append(b + b"\0" * pad); off += len(b) + pad
    js = {"asset": {"version": "2.0"}, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}], "buffers": [{"byteLength": off}], "bufferViews": views,
          "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(P), "type": "VEC3"},
                        {"bufferView": 1, "componentType": 5126, "count": len(UV), "type": "VEC2"},
                        {"bufferView": 2, "componentType": 5123, "count": len(I), "type": "SCALAR"}],
          "images": [{"bufferView": 3, "mimeType": "image/png"}], "textures": [{"source": 0}],
          "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
          "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0}]}]}
    jb = json.dumps(js).encode(); jb += b" " * ((-len(jb)) % 4)
    body = b"".join(chunks)
    Path(path).write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(jb) + 8 + len(body)) + struct.pack("<I4s", len(jb), b"JSON") + jb
                           + struct.pack("<I4s", len(body), b"BIN\0") + body)


class Source(unittest.TestCase):
    def test_a_generated_source_is_pictured_side_on_in_its_own_colours(self):
        for axis in ("z", "x"):                      # whichever way the file lays the body
            with tempfile.TemporaryDirectory() as d:
                glb = Path(d) / "model.glb"
                textured_box(glb, axis)
                near, sil = lk.render_source(glb)
                far, sil2 = lk.render_source(glb, flip=True)
            h, w = sil.shape
            self.assertGreater(sil.sum() / sil.size, 0.5)
            self.assertAlmostEqual((np.ptp(np.nonzero(sil.any(0))[0]) + 1) / (np.ptp(np.nonzero(sil.any(1))[0]) + 1), 2.0, delta=0.1)   # 2 long, 1 high
            a, b = near[h // 2, w // 2], far[h // 2, w // 2]
            # one side is the red face and the other the blue, each in the texture's colour (dimmed by the sky term)
            self.assertEqual({int(np.argmax(a)), int(np.argmax(b))}, {0, 2}, axis)
            self.assertLess(min(a[1], b[1]), 0.01)


class Recognition(unittest.TestCase):
    """recognise() with stand-in embeddings: three species on three axes of a small space."""

    def setUp(self):
        e = np.eye(4)
        self.pts = {name: {"centre": e[i], "floor": 0.6, "n": 9} for i, name in enumerate(["canis_latrans", "lupulella_mesomelas", "puma_concolor"])}
        self.pic = [(np.zeros((8, 8, 3), np.uint8), np.ones((8, 8), bool))]

    def run_with(self, v):
        v = np.array(v, float)
        with mock.patch.object(lk, "embed", lambda pic: v / np.linalg.norm(v)), mock.patch.object(lk, "picture", lambda rgb, comp: rgb):
            return lk.recognise("canis_latrans", self.pic, self.pts)

    def test_its_own_species_nearest_and_over_the_floor_is_recognised(self):
        r = self.run_with([0.9, 0.3, 0.1, 0.0])
        self.assertTrue(r["ok"])
        self.assertEqual((r["rank"], r["rival"]), (1, "lupulella_mesomelas"))
        self.assertGreater(r["margin"], 0)

    def test_a_rival_nearer_is_named(self):
        r = self.run_with([0.6, 0.7, 0.1, 0.0])
        self.assertFalse(r["ok"])
        self.assertEqual(r["rank"], 2)
        self.assertIn("lupulella mesomelas", r["why"][0])
        self.assertLess(r["margin"], 0)

    def test_its_own_nearest_but_under_the_species_own_floor_fails(self):
        r = self.run_with([0.4, 0.1, 0.1, 0.9])
        self.assertFalse(r["ok"])
        self.assertEqual(r["rank"], 1)
        self.assertIn("nine in ten", r["why"][0])


class Stage(unittest.TestCase):
    """The likeness in the acceptance rule, on a library model (skipped where its GLB is missing)."""

    def setUp(self):
        try:
            self.reg = json.loads(fm.REGISTRY.read_text())["species"]
        except (OSError, ValueError, KeyError):
            self.skipTest("no model registry")
        self.code = "bison_bison"
        if self.code not in self.reg or not (ROOT / self.reg[self.code]["glb"]).exists():
            self.skipTest("library GLB not present")

    def accept(self, verdict):
        with mock.patch.object(fm, "likeness_check", lambda code, *a, **k: verdict):
            return fm.acceptance(self.code, self.reg[self.code])

    def test_a_model_its_species_photos_do_not_recognise_is_rejected_and_a_photo_refine_is_due(self):
        a = self.accept({"ok": False, "why": ["nearer the photos of bos taurus (0.80) than its own species' (0.70)"], "seen": "the generated source",
                         "recognition": {"own": 0.7, "floor": 0.5, "rival": "bos_taurus", "rival_nearness": 0.8, "margin": -0.1, "photos": 12, "of": 9}, "coat": None})
        st = a["rule"]["stages"]["likeness"]
        self.assertEqual((a["rule"]["decision"], st["ok"], st["judged"], st["rival"]), ("rejected", False, True, "bos_taurus"))
        self.assertTrue(any(w.startswith("likeness:") for w in a["rule"]["why"]))
        self.assertEqual(a["due"]["credits"], fm.COST["refine"])
        self.assertIn("likeness", a["due"]["why"])

    def test_a_recognised_model_passes(self):
        a = self.accept({"ok": True, "why": [], "seen": "the generated source",
                         "recognition": {"own": 0.74, "floor": 0.43, "rival": "alces_alces", "rival_nearness": 0.53, "margin": 0.21, "photos": 17, "of": 10}, "coat": None})
        self.assertTrue(a["rule"]["stages"]["likeness"]["ok"])

    def test_a_species_that_cannot_be_judged_is_not_rejected_for_it(self):
        a = self.accept({"ok": None, "why": ["no reference photos of the species in the store"]})
        st = a["rule"]["stages"]["likeness"]
        self.assertEqual((st["ok"], st["judged"]), (True, False))

    def test_only_four_legged_models_are_judged(self):
        self.assertIsNone(fm.likeness_check("crocodylus_niloticus")["ok"])

    def test_a_mesh_that_cannot_be_read_fails_the_pose_gate(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(fm.pose_check(Path(d))["ok"])


if __name__ == "__main__":
    unittest.main()
