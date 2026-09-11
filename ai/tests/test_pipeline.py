"""Unit tests for the RAKSHA CV pipeline's pure logic.

Deliberately stdlib-only (`unittest`, no pytest) and deliberately free of
`ultralytics`, `torch` and `cv2`: those take minutes to install and hundreds of
megabytes, and none of the logic checked here needs them. That keeps this suite
runnable on every push, which is the only way it stays honest.

What is covered is the part that decides what the model is TAUGHT and what the
platform is TOLD:

  * the RDD2022 -> RAKSHA class mapping, which is a licensing and correctness
    claim in ai/README.md and docs/raksha/05-dataset-license-verification.md;
  * the promise that an unmapped label is skipped AND COUNTED, never silently
    folded into a class, because a quietly mis-mapped label is a training bug
    nobody can see afterwards;
  * the box maths that turns VOC pixels into YOLO normalised coordinates;
  * the severity heuristic, which is an explicit engineering assumption that
    reaches the database through POST /v1/raksha/detections.

Run:  python -m unittest discover -s ai/tests -v
"""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

ROAD_DAMAGE = Path(__file__).resolve().parent.parent / "road_damage"
sys.path.insert(0, str(ROAD_DAMAGE))

import convert_voc_to_yolo as conv  # noqa: E402


def _stub_ultralytics() -> None:
    """Let detect.py import without torch present.

    detect.py imports YOLO at module scope, which is right for a CLI and wrong
    for a test that only wants `severity()`. Stubbing the module is honest here
    because nothing under test touches it - if that ever stops being true, the
    stub raises rather than silently returning a fake detection.
    """
    if "ultralytics" in sys.modules:
        return

    class _Unavailable:
        def __init__(self, *a, **k):
            raise RuntimeError(
                "ultralytics is stubbed in unit tests - install it to run inference"
            )

    mod = types.ModuleType("ultralytics")
    mod.YOLO = _Unavailable
    utils = types.ModuleType("ultralytics.utils")
    utils.LOGGER = types.SimpleNamespace(setLevel=lambda *_: None)
    sys.modules["ultralytics"] = mod
    sys.modules["ultralytics.utils"] = utils


_stub_ultralytics()
import detect  # noqa: E402


def voc(tmp, w, h, objects):
    """Write one PASCAL-VOC annotation file and return its path."""
    objs = "".join(
        "<object><name>{}</name><bndbox>"
        "<xmin>{}</xmin><ymin>{}</ymin><xmax>{}</xmax><ymax>{}</ymax>"
        "</bndbox></object>".format(n, a, b, c, d)
        for n, a, b, c, d in objects
    )
    p = tmp / "sample.xml"
    p.write_text(
        "<annotation><size><width>{}</width><height>{}</height></size>{}</annotation>".format(
            w, h, objs
        ),
        encoding="utf-8",
    )
    return p


class _Tmp(unittest.TestCase):
    """Shared scratch directory + a reset of the module globals convert_one reads."""

    def setUp(self):
        self.tmp = Path(__file__).resolve().parent / "_tmp"
        self.tmp.mkdir(exist_ok=True)
        conv.CLASS_MAP, conv.NAMES = conv.MVP_MAP, conv.MVP_NAMES

    def tearDown(self):
        for f in self.tmp.glob("*"):
            f.unlink()
        self.tmp.rmdir()


class ClassMapping(_Tmp):
    """The mapping documented in ai/README.md, asserted rather than described."""

    def test_d40_is_pothole_and_cracks_are_road_damage(self):
        lines, _ = conv.convert_one(voc(self.tmp, 100, 100, [
            ("D40", 10, 10, 30, 30),
            ("D00", 10, 10, 30, 30),
            ("D10", 10, 10, 30, 30),
            ("D20", 10, 10, 30, 30),
        ]))
        self.assertEqual([ln.split()[0] for ln in lines], ["0", "1", "1", "1"])

    def test_unmapped_labels_are_skipped_but_counted(self):
        # The claim: "skipped labels are counted, never folded in."
        lines, seen = conv.convert_one(voc(self.tmp, 100, 100, [
            ("D40", 10, 10, 30, 30),
            ("D43", 10, 10, 30, 30),
            ("D50", 10, 10, 30, 30),
            ("D01", 10, 10, 30, 30),
        ]))
        self.assertEqual(len(lines), 1, "only D40 should survive the MVP mapping")
        self.assertEqual(seen["D43"], 1)
        self.assertEqual(seen["D50"], 1)
        self.assertEqual(seen["D01"], 1)

    def test_rich_mapping_adds_two_classes_without_disturbing_the_first_two(self):
        conv.CLASS_MAP, conv.NAMES = conv.RICH_MAP, conv.RICH_NAMES
        lines, _ = conv.convert_one(voc(self.tmp, 100, 100, [
            ("D40", 10, 10, 30, 30),
            ("D00", 10, 10, 30, 30),
            ("D44", 10, 10, 30, 30),
            ("D50", 10, 10, 30, 30),
        ]))
        self.assertEqual([ln.split()[0] for ln in lines], ["0", "1", "2", "3"])
        self.assertEqual(conv.RICH_NAMES[:2], conv.MVP_NAMES,
                         "the rich model must not renumber the MVP classes")

    def test_mvp_and_rich_agree_on_every_shared_label(self):
        for label, cls in conv.MVP_MAP.items():
            self.assertEqual(conv.RICH_MAP[label], cls,
                             "{} renumbered between maps".format(label))


class BoxMaths(_Tmp):
    def test_pixels_become_normalised_centre_and_size(self):
        # 200x100 image, box x 50..150, y 25..75 -> centre (0.5, 0.5), size (0.5, 0.5)
        lines, _ = conv.convert_one(voc(self.tmp, 200, 100, [("D40", 50, 25, 150, 75)]))
        cls, cx, cy, bw, bh = lines[0].split()
        self.assertEqual(cls, "0")
        self.assertAlmostEqual(float(cx), 0.5, places=5)
        self.assertAlmostEqual(float(cy), 0.5, places=5)
        self.assertAlmostEqual(float(bw), 0.5, places=5)
        self.assertAlmostEqual(float(bh), 0.5, places=5)

    def test_coordinates_outside_the_frame_are_clamped(self):
        lines, _ = conv.convert_one(voc(self.tmp, 100, 100, [("D40", -40, -40, 500, 500)]))
        _, cx, cy, bw, bh = lines[0].split()
        self.assertAlmostEqual(float(bw), 1.0, places=5)
        self.assertAlmostEqual(float(bh), 1.0, places=5)
        self.assertTrue(0.0 <= float(cx) <= 1.0 and 0.0 <= float(cy) <= 1.0)

    def test_degenerate_boxes_are_dropped(self):
        lines, seen = conv.convert_one(voc(self.tmp, 100, 100, [("D40", 10, 10, 11, 11)]))
        self.assertEqual(lines, [], "a sub-2px box is noise, not a label")
        self.assertEqual(seen["D40"], 1, "it is still counted - we saw it, we rejected it")

    def test_an_image_with_no_size_yields_nothing(self):
        p = self.tmp / "sample.xml"
        p.write_text(
            "<annotation><size><width>0</width><height>0</height></size>"
            "<object><name>D40</name><bndbox><xmin>1</xmin><ymin>1</ymin>"
            "<xmax>9</xmax><ymax>9</ymax></bndbox></object></annotation>",
            encoding="utf-8",
        )
        lines, _ = conv.convert_one(p)
        self.assertEqual(lines, [])


class SeverityHeuristic(unittest.TestCase):
    """detect.py's documented assumption. It reaches the database, so it is pinned."""

    def test_bands_follow_the_documented_thresholds(self):
        for frac, expected in [(0.005, 1), (0.02, 2), (0.05, 3), (0.10, 4), (0.50, 5)]:
            self.assertEqual(detect.severity("road_damage", frac), expected,
                             "frac={}".format(frac))

    def test_a_pothole_is_one_band_worse_than_a_crack_of_equal_size(self):
        for frac in (0.005, 0.02, 0.05, 0.10):
            self.assertEqual(
                detect.severity("pothole", frac),
                detect.severity("road_damage", frac) + 1,
                "frac={}".format(frac),
            )

    def test_severity_never_leaves_the_range_the_database_accepts(self):
        # raksha_detections has CHECK (severity BETWEEN 1 AND 5); a 6 would be
        # rejected by Postgres at ingest, so the cap is load-bearing.
        for i in range(0, 101):
            frac = i / 100.0
            for name in ("pothole", "road_damage", "faded_marking", "manhole"):
                s = detect.severity(name, frac)
                self.assertGreaterEqual(s, 1)
                self.assertLessEqual(s, 5)

    def test_the_largest_pothole_is_capped_not_wrapped(self):
        self.assertEqual(detect.severity("pothole", 0.99), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
