"""The ONNX serving path's geometry and decoding.

Stdlib only, like the rest of ai/tests — no onnxruntime, no numpy, no image.
`decode()` takes plain nested lists, so the whole decoder is exercised without
loading a 37 MB model, which is what keeps it running on every push.

The geometry is the part worth protecting. A wrong letterbox does not crash and
does not look wrong in a JSON dump; it silently shifts every box, and the output
of this system is a pin on an authority's map. The synthetic cases below are
self-consistent by construction, so `RealModelOutput` holds `decode()` to
ultralytics itself: a stored raw output of the trained model on a padded road
image (tests/fixtures/decode_raw.json, made by tests/fixtures/make_fixtures.py)
must decode to the boxes ultralytics' own NMS and scale_boxes gave for it.
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "road_damage"))

from onnx_detector import (  # noqa: E402
    INGESTABLE,
    NMS_IOU,
    decode,
    iou,
    letterbox_params,
    model_version,
    nms,
    read_input_size,
    undo_letterbox,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class Letterbox(unittest.TestCase):
    def test_a_square_image_into_a_square_input_needs_no_padding(self):
        scale, px, py = letterbox_params(720, 720, 512, 512)
        self.assertAlmostEqual(scale, 512 / 720)
        self.assertAlmostEqual(px, 0.0)
        self.assertAlmostEqual(py, 0.0)

    def test_a_wide_image_is_padded_top_and_bottom(self):
        # 1280x720 into 512x512: scale by width, then centre vertically.
        scale, px, py = letterbox_params(1280, 720, 512, 512)
        self.assertAlmostEqual(scale, 0.4)
        self.assertAlmostEqual(px, 0.0)
        self.assertAlmostEqual(py, (512 - 288) / 2)

    def test_a_tall_image_is_padded_left_and_right(self):
        scale, px, py = letterbox_params(720, 1280, 512, 512)
        self.assertAlmostEqual(scale, 0.4)
        self.assertAlmostEqual(px, (512 - 288) / 2)
        self.assertAlmostEqual(py, 0.0)

    def test_the_round_trip_is_the_identity(self):
        # The property that actually matters: a box placed into model space and
        # brought back must land where it started.
        for src in [(720, 720), (1280, 720), (720, 1280), (4032, 3024)]:
            w, h = src
            scale, px, py = letterbox_params(w, h, 512, 512)
            original = (0.1 * w, 0.2 * h, 0.4 * w, 0.6 * h)
            forward = tuple(
                v * scale + (px if i % 2 == 0 else py) for i, v in enumerate(original)
            )
            back = undo_letterbox(forward, scale, px, py, w, h)
            for a, b in zip(original, back):
                self.assertAlmostEqual(a, b, places=4, msg=f"{src}")

    def test_boxes_are_clamped_into_the_frame(self):
        # The model can predict past the padding; a negative coordinate would
        # travel all the way to a map pin off the coast.
        x1, y1, x2, y2 = undo_letterbox((-500, -500, 9999, 9999), 1.0, 0.0, 0.0, 720, 720)
        self.assertEqual((x1, y1), (0.0, 0.0))
        self.assertEqual((x2, y2), (720.0, 720.0))


class IoU(unittest.TestCase):
    def test_identical_boxes(self):
        self.assertAlmostEqual(iou((0, 0, 10, 10), (0, 0, 10, 10)), 1.0)

    def test_disjoint_boxes(self):
        self.assertEqual(iou((0, 0, 10, 10), (20, 20, 30, 30)), 0.0)

    def test_touching_edges_do_not_overlap(self):
        self.assertEqual(iou((0, 0, 10, 10), (10, 0, 20, 10)), 0.0)

    def test_half_overlap(self):
        # Two 10x10 boxes sharing a 5x10 strip: 50 / (100 + 100 - 50).
        self.assertAlmostEqual(iou((0, 0, 10, 10), (5, 0, 15, 10)), 50 / 150)

    def test_the_measured_ground_truth_case(self):
        # The IoU recorded in ai/README.md, recomputed. This checks iou()'s
        # arithmetic on those two boxes and nothing else; the geometry that
        # produced the predicted box is RealModelOutput's job.
        self.assertAlmostEqual(iou((74, 469, 355, 572), (20, 473, 368, 576)), 0.753, places=3)

    def test_a_degenerate_box_has_no_area(self):
        self.assertEqual(iou((5, 5, 5, 5), (0, 0, 10, 10)), 0.0)


class NonMaximumSuppression(unittest.TestCase):
    def test_keeps_the_strongest_of_a_cluster(self):
        boxes = [(0, 0, 10, 10), (1, 1, 11, 11), (2, 2, 12, 12)]
        kept = nms(boxes, [0.5, 0.9, 0.6], 0.45)
        self.assertEqual(kept, [1], "the 0.9 box should absorb its neighbours")

    def test_keeps_genuinely_separate_defects(self):
        boxes = [(0, 0, 10, 10), (100, 100, 110, 110)]
        self.assertEqual(sorted(nms(boxes, [0.5, 0.9], 0.45)), [0, 1])

    def test_returns_best_first(self):
        boxes = [(0, 0, 10, 10), (100, 100, 110, 110), (200, 200, 210, 210)]
        self.assertEqual(nms(boxes, [0.1, 0.9, 0.5], 0.45), [1, 2, 0])

    def test_an_empty_input_is_not_an_error(self):
        self.assertEqual(nms([], [], 0.45), [])


def output(rows):
    """Build a [4 + classes, anchors] output from per-anchor tuples."""
    anchors = len(rows)
    grid = [[0.0] * anchors for _ in range(4 + len(rows[0][4]))]
    for a, (cx, cy, w, h, scores) in enumerate(rows):
        grid[0][a], grid[1][a], grid[2][a], grid[3][a] = cx, cy, w, h
        for c, s in enumerate(scores):
            grid[4 + c][a] = s
    return grid


NAMES = {0: "pothole", 1: "road_damage", 2: "faded_marking", 3: "manhole"}


class Decode(unittest.TestCase):
    def test_a_centred_box_decodes_to_the_centre_of_the_source(self):
        # 512x512 model, 512x512 source: no scaling, no padding.
        out = output([(256, 256, 100, 100, [0.9, 0, 0, 0])])
        (d,) = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual(d.type, "pothole")
        self.assertAlmostEqual(d.box[0], 206)
        self.assertAlmostEqual(d.box[2], 306)

    def test_the_class_score_is_the_confidence(self):
        # YOLO v8/v11 have no objectness channel. Reading one would multiply the
        # score by a coordinate and suppress everything.
        out = output([(256, 256, 50, 50, [0.42, 0, 0, 0])])
        (d,) = decode(out, NAMES, 512, 512, 512, 512)
        self.assertAlmostEqual(d.confidence, 0.42, places=5)

    def test_the_highest_scoring_class_wins(self):
        out = output([(256, 256, 50, 50, [0.3, 0.8, 0.1, 0.2])])
        (d,) = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual(d.type, "road_damage")

    def test_below_threshold_anchors_are_dropped(self):
        out = output([
            (100, 100, 20, 20, [0.10, 0, 0, 0]),
            (300, 300, 20, 20, [0.80, 0, 0, 0]),
        ])
        found = decode(out, NAMES, 512, 512, 512, 512, min_conf=0.30)
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0].confidence, 0.80, places=5)

    def test_overlapping_anchors_of_one_class_collapse(self):
        out = output([
            (256, 256, 100, 100, [0.70, 0, 0, 0]),
            (258, 258, 100, 100, [0.90, 0, 0, 0]),
        ])
        found = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0].confidence, 0.90, places=5)

    def test_a_pothole_inside_a_cracked_patch_stays_two_detections(self):
        # Suppression is per class on purpose: these are two real defects and
        # merging them across classes would lose one.
        out = output([
            (256, 256, 100, 100, [0.80, 0.00, 0, 0]),
            (256, 256, 110, 110, [0.00, 0.75, 0, 0]),
        ])
        found = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual(sorted(d.type for d in found), ["pothole", "road_damage"])

    def test_results_come_back_strongest_first(self):
        out = output([
            (50, 50, 20, 20, [0.40, 0, 0, 0]),
            (400, 400, 20, 20, [0.95, 0, 0, 0]),
            (200, 200, 20, 20, [0.60, 0, 0, 0]),
        ])
        found = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual([round(d.confidence, 2) for d in found], [0.95, 0.60, 0.40])

    def test_severity_comes_from_the_shared_heuristic(self):
        # Half the frame, and a pothole, so the cap applies.
        out = output([(256, 256, 362, 362, [0.9, 0, 0, 0])])
        (d,) = decode(out, NAMES, 512, 512, 512, 512)
        self.assertEqual(d.severity, 5)
        self.assertGreater(d.box_fraction, 0.4)

    def test_classes_the_server_cannot_accept_are_flagged_not_dropped(self):
        # faded_marking and manhole are real detections the ingest enum does not
        # take yet. Silently discarding them would lose data; silently sending
        # them would be rejected at the API. So: reported, and marked.
        out = output([
            (100, 100, 30, 30, [0.9, 0, 0, 0]),
            (300, 300, 30, 30, [0, 0, 0, 0.9]),
        ])
        found = decode(out, NAMES, 512, 512, 512, 512)
        by_type = {d.type: d.ingestable for d in found}
        self.assertTrue(by_type["pothole"])
        self.assertFalse(by_type["manhole"])
        self.assertEqual(set(INGESTABLE), {"pothole", "road_damage"})

    def test_the_two_class_mvp_model_decodes_through_the_same_code(self):
        out = output([(256, 256, 60, 60, [0.1, 0.85])])
        (d,) = decode(out, {0: "pothole", 1: "road_damage"}, 512, 512, 512, 512)
        self.assertEqual(d.type, "road_damage")

    def test_an_output_with_no_class_rows_is_refused(self):
        with self.assertRaises(ValueError):
            decode([[0.0], [0.0], [0.0], [0.0]], NAMES, 512, 512, 512, 512)

    def test_the_ingest_payload_matches_the_endpoint_contract(self):
        out = output([(256, 256, 100, 100, [0.876543, 0, 0, 0])])
        (d,) = decode(out, NAMES, 512, 512, 512, 512)
        payload = d.to_ingest("yolo-rdd2022in-best")
        self.assertEqual(
            sorted(payload),
            ["boxFraction", "confidence", "modelVersion", "severity", "type", "usedFallback"],
        )
        self.assertEqual(payload["confidence"], 0.877)   # rounded, as detect.py does
        self.assertFalse(payload["usedFallback"])
        self.assertTrue(1 <= payload["severity"] <= 5)


class RealModelOutput(unittest.TestCase):
    """decode() against ultralytics' own decode of the same raw model output.

    The fixture is yolo11s-multi-rich on a 720x400 crop letterboxed into
    512x512, so 114 rows of padding top and bottom, a scale of 0.711, four
    classes and overlapping boxes for NMS to settle. Before this, nothing here
    compared decode() with anything but itself.
    """

    @classmethod
    def setUpClass(cls):
        cls.fx = json.loads((FIXTURES / "decode_raw.json").read_text(encoding="utf-8"))

    def decoded(self):
        fx = self.fx
        rows = [list(r) for r in zip(*fx["anchors"])]          # anchors x 8 -> 8 x anchors
        names = {int(k): v for k, v in fx["names"].items()}
        (sw, sh), (mw, mh) = fx["source"], fx["input"]
        # iou left at decode()'s default on purpose: it must be the threshold
        # ultralytics used for the expected boxes.
        return decode(rows, names, sw, sh, mw, mh, min_conf=fx["minConf"])

    def test_the_fixture_was_decoded_with_the_shared_nms_threshold(self):
        self.assertEqual(self.fx["iou"], NMS_IOU)

    def test_the_same_detections_in_the_same_order(self):
        got, want = self.decoded(), self.fx["expected"]
        self.assertGreaterEqual(len(want), 5)
        self.assertEqual([d.type for d in got], [e["type"] for e in want])
        for d, e in zip(got, want):
            self.assertAlmostEqual(d.confidence, e["confidence"], places=4)

    def test_every_box_lands_where_ultralytics_put_it(self):
        # 0.05 source pixels: a fractional letterbox pad (113.78 instead of the
        # 114 rows actually painted) moves every box 0.31 px and fails this.
        for d, e in zip(self.decoded(), self.fx["expected"]):
            for got, want in zip(d.box, e["box"]):
                self.assertAlmostEqual(got, want, delta=0.05, msg=f"{d.type} {d.box} vs {e['box']}")


class _Session:
    """Just enough of an onnxruntime session for the metadata readers."""

    def __init__(self, meta):
        self._meta = meta

    def get_modelmeta(self):
        return type("Meta", (), {"custom_metadata_map": self._meta})()


class ModelMetadata(unittest.TestCase):
    def test_imgsz_is_height_then_width(self):
        # ultralytics writes [h, w]; a 384x640 (h x w) export is 640 wide.
        self.assertEqual(read_input_size(_Session({"imgsz": "[384, 640]"})), (640, 384))

    def test_a_square_or_missing_size(self):
        self.assertEqual(read_input_size(_Session({"imgsz": "[512, 512]"})), (512, 512))
        self.assertEqual(read_input_size(_Session({})), (640, 640))


class ModelVersion(unittest.TestCase):
    def weights(self, root: Path, run: str, content: bytes, name: str = "best.onnx") -> Path:
        p = root / "runs" / run / "weights" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)
        return p

    def test_names_the_run_the_weights_and_their_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self.weights(Path(tmp), "yolo11s-multi-rich", b"weights-a")
            want = "yolo11s-multi-rich-best-" + hashlib.sha256(b"weights-a").hexdigest()[:8]
            self.assertEqual(model_version(p), want)

    def test_two_runs_or_two_exports_never_share_a_version(self):
        # Every model used to report "yolo-rdd2022in-best".
        with tempfile.TemporaryDirectory() as tmp:
            a = self.weights(Path(tmp), "yolo11s-multi", b"a")
            b = self.weights(Path(tmp), "yolo11n-multi-edge", b"b")
            c = self.weights(Path(tmp), "yolo11s-multi", b"c", "last.onnx")
            self.assertEqual(len({model_version(a), model_version(b), model_version(c)}), 3)

    def test_fits_the_40_character_column_keeping_the_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = self.weights(Path(tmp), "a-very-long-experiment-name-for-the-yolo11-rich-run", b"x")
            v = model_version(p)
            self.assertLessEqual(len(v), 40)
            self.assertTrue(v.endswith("-best-" + hashlib.sha256(b"x").hexdigest()[:8]), v)


if __name__ == "__main__":
    unittest.main(verbosity=2)
