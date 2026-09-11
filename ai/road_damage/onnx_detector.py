"""Road-damage detection on ONNX Runtime — no PyTorch, no ultralytics.

── why this exists ─────────────────────────────────────────────────────────
`AI_BASE_URL` has always been a real setting in the API pointing at an endpoint
nothing in this repository implemented. The trained detectors reached the
platform through `detect.py` writing JSON to a file, which is a pipeline, not a
service.

── why ONNX Runtime rather than ultralytics ────────────────────────────────
Two reasons, and the second is the important one.

1. Size. `ultralytics` pulls PyTorch: roughly 2 GB installed, which is a great
   deal to ask of an edge device and of CI. `onnxruntime` + `numpy` + `pillow`
   is about 50 MB and runs the *same* `best.onnx` that `train.py` already
   exports.

2. Licence. `ultralytics` is AGPL-3.0. `ai/requirements.txt` says outright that
   "an Apache-2.0 alternative must be scored before any commercial deployment"
   (docs/raksha/05-dataset-license-verification.md §2). ONNX Runtime is
   Apache-2.0 and numpy/pillow are BSD/MIT-style, so this path carries no
   copyleft obligation at all. Training stays on ultralytics, where the AGPL is
   an internal matter; only serving needs to be distributable.

The two paths must agree, so `severity.py` is shared rather than reimplemented,
and `tests/test_onnx_detector.py` checks the geometry against known values.

── the model's own metadata is the source of truth ────────────────────────
Class names and input size are read from the .onnx file, never hardcoded here.
The 2-class MVP detector and the 4-class rich model then work through the same
code, and a model trained with a different class order cannot be silently
mislabelled.
"""
from __future__ import annotations

import ast
import json
from dataclasses import dataclass
from typing import Any, Sequence

from severity import severity

#: Ingested classes. `faded_marking` and `manhole` are detected by the rich
#: model but the server's enum does not accept them yet, so they are reported
#: and flagged rather than quietly dropped or quietly sent.
INGESTABLE = ("pothole", "road_damage")


@dataclass(frozen=True)
class Detection:
    type: str
    confidence: float
    severity: int
    box_fraction: float
    box: tuple[float, float, float, float]   # x1, y1, x2, y2 in source pixels
    ingestable: bool

    def to_ingest(self, model_version: str) -> dict[str, Any]:
        """The shape POST /v1/raksha/detections expects, minus device fields."""
        return {
            "type": self.type,
            "confidence": round(self.confidence, 3),
            "severity": self.severity,
            "boxFraction": round(self.box_fraction, 4),
            "modelVersion": model_version,
            "usedFallback": False,
        }


def letterbox_params(src_w: int, src_h: int, dst_w: int, dst_h: int):
    """Scale and padding for aspect-preserving resize into (dst_w, dst_h).

    Returned as (scale, pad_x, pad_y). Getting this wrong does not crash — it
    silently shifts every box, which is the worst kind of bug in a system whose
    output is a map pin. Hence its own function and its own tests.
    """
    scale = min(dst_w / src_w, dst_h / src_h)
    new_w, new_h = src_w * scale, src_h * scale
    return scale, (dst_w - new_w) / 2, (dst_h - new_h) / 2


def undo_letterbox(box, scale: float, pad_x: float, pad_y: float, src_w: int, src_h: int):
    """Map a box from letterboxed model space back to source pixels, clamped."""
    x1, y1, x2, y2 = box
    x1 = (x1 - pad_x) / scale
    y1 = (y1 - pad_y) / scale
    x2 = (x2 - pad_x) / scale
    y2 = (y2 - pad_y) / scale
    x1 = min(max(x1, 0.0), float(src_w))
    y1 = min(max(y1, 0.0), float(src_h))
    x2 = min(max(x2, 0.0), float(src_w))
    y2 = min(max(y2, 0.0), float(src_h))
    return x1, y1, x2, y2


def iou(a: Sequence[float], b: Sequence[float]) -> float:
    """Intersection over union of two xyxy boxes."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def nms(boxes, scores, iou_threshold: float):
    """Greedy non-maximum suppression. Returns kept indices, best score first.

    Per-class suppression is the caller's job: a pothole inside a cracked patch
    is two real defects, and merging them across classes would lose one.
    """
    order = sorted(range(len(boxes)), key=lambda i: scores[i], reverse=True)
    kept: list[int] = []
    while order:
        best = order.pop(0)
        kept.append(best)
        order = [i for i in order if iou(boxes[best], boxes[i]) <= iou_threshold]
    return kept


def decode(
    output,
    class_names: dict[int, str],
    src_w: int,
    src_h: int,
    model_w: int,
    model_h: int,
    min_conf: float = 0.30,
    iou_threshold: float = 0.45,
) -> list[Detection]:
    """Turn a YOLO11 ONNX output into detections in SOURCE pixel space.

    `output` is [4 + num_classes, anchors]: cx, cy, w, h then one score per
    class. There is no objectness channel in v8/v11 — the class score IS the
    confidence, and treating it as if there were one suppresses everything.
    """
    num_rows = len(output)
    num_classes = num_rows - 4
    if num_classes < 1:
        raise ValueError(f"unexpected model output with {num_rows} rows")

    scale, pad_x, pad_y = letterbox_params(src_w, src_h, model_w, model_h)
    frame = float(src_w * src_h)

    per_class: dict[int, list[tuple[list[float], float]]] = {}
    anchors = len(output[0])
    for a in range(anchors):
        best_cls, best_score = -1, 0.0
        for c in range(num_classes):
            s = float(output[4 + c][a])
            if s > best_score:
                best_cls, best_score = c, s
        if best_cls < 0 or best_score < min_conf:
            continue
        cx, cy = float(output[0][a]), float(output[1][a])
        w, h = float(output[2][a]), float(output[3][a])
        box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
        per_class.setdefault(best_cls, []).append((box, best_score))

    detections: list[Detection] = []
    for cls_id, items in per_class.items():
        boxes = [b for b, _ in items]
        scores = [s for _, s in items]
        for i in nms(boxes, scores, iou_threshold):
            name = class_names.get(cls_id)
            if name is None:
                continue   # a class the model knows and we have no name for
            x1, y1, x2, y2 = undo_letterbox(boxes[i], scale, pad_x, pad_y, src_w, src_h)
            frac = max(0.0, (x2 - x1) * (y2 - y1)) / frame if frame else 0.0
            detections.append(Detection(
                type=name,
                confidence=scores[i],
                severity=severity(name, frac),
                box_fraction=frac,
                box=(x1, y1, x2, y2),
                ingestable=name in INGESTABLE,
            ))

    detections.sort(key=lambda d: d.confidence, reverse=True)
    return detections


def read_class_names(session) -> dict[int, str]:
    """Class names from the .onnx metadata, which ultralytics writes on export.

    Stored as a Python repr — `{0: 'pothole', 1: 'road_damage'}` — whose keys are
    bare integers, so it is not JSON and no amount of quote-swapping makes it so.
    `ast.literal_eval` parses exactly this and nothing executable.

    A model without names is refused rather than guessed at: an assumed class
    order is how `pothole` becomes `manhole` on an authority's map.
    """
    raw = session.get_modelmeta().custom_metadata_map.get("names")
    if not raw:
        raise ValueError("model has no class names in its metadata — refusing to guess")
    parsed = ast.literal_eval(raw)
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError(f"unreadable class names in model metadata: {raw!r}")
    return {int(k): str(v) for k, v in parsed.items()}


def read_input_size(session, fallback: int = 640) -> tuple[int, int]:
    """Input size from metadata, falling back to a square default."""
    raw = session.get_modelmeta().custom_metadata_map.get("imgsz")
    if raw:
        try:
            dims = json.loads(raw)
            if isinstance(dims, list) and len(dims) == 2:
                return int(dims[0]), int(dims[1])
        except (ValueError, TypeError):
            pass
    return fallback, fallback
