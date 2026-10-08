"""Regenerate the fixtures tests/test_preprocess.py and tests/test_onnx_detector.py
compare against. The tests need none of this; generating needs the TRAINING
environment (ultralytics, torch, cv2), because the point of a fixture is that
ultralytics itself produced it:

    ai/.venv/Scripts/python ai/tests/fixtures/make_fixtures.py \
        <a non-square road image> ai/runs/yolo11s-multi-rich/weights/best.pt

  letterbox_*.png   two synthetic images (noise over gradients, so every pixel
                    of a wrong resample shows) and what ultralytics' LetterBox
                    makes of them: cv2 INTER_LINEAR, 114 padding, its rounding.
  decode_raw.json   a real model output on a real road image - every anchor
                    whose best class score is at least 0.02 - and ultralytics'
                    own non_max_suppression + scale_boxes of exactly those anchors.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.data.augment import LetterBox
from ultralytics.utils import nms, ops

HERE = Path(__file__).resolve().parent
CONF, IOU, KEEP = 0.10, 0.7, 0.02


def synthetic(w: int, h: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.stack([xx * 255 / max(1, w - 1), yy * 255 / max(1, h - 1), (xx + yy) % 256], axis=-1)
    return np.clip(base * 0.5 + rng.integers(0, 128, (h, w, 3)), 0, 255).astype(np.uint8)


def letterbox_rgb(rgb: np.ndarray, w: int, h: int) -> np.ndarray:
    bgr = np.ascontiguousarray(rgb[..., ::-1])
    return LetterBox(new_shape=(h, w), auto=False, stride=32)(image=bgr)[..., ::-1]


def write_png(path: Path, rgb: np.ndarray) -> None:
    cv2.imwrite(str(path), np.ascontiguousarray(rgb[..., ::-1]))


def main() -> None:
    image, weights = Path(sys.argv[1]), Path(sys.argv[2])

    for name, (sw, sh), (mw, mh), seed in [("down", (97, 61), (40, 40), 1), ("up", (23, 17), (64, 48), 2)]:
        src = synthetic(sw, sh, seed)
        write_png(HERE / f"letterbox_{name}_src.png", src)
        write_png(HERE / f"letterbox_{name}_expected_{mw}x{mh}.png", letterbox_rgb(src, mw, mh))

    model = YOLO(str(weights))
    net, names = model.model.float().eval(), model.names
    size = int(model.model.args.get("imgsz", 640))
    rgb = cv2.imread(str(image))[..., ::-1]
    src_h, src_w = rgb.shape[:2]
    lb = letterbox_rgb(rgb, size, size).astype(np.float32) / 255.0
    tensor = torch.from_numpy(np.ascontiguousarray(lb.transpose(2, 0, 1)))[None]
    with torch.no_grad():
        raw = net(tensor)[0]                                   # [1, 4 + nc, anchors]
    keep = raw[0, 4:].max(0).values >= KEEP
    columns = np.round(raw[0][:, keep].T.numpy().astype(np.float64), 4)
    # Decoded from exactly the numbers stored, so the fixture is self-consistent.
    stored = torch.from_numpy(columns.T.astype(np.float32))[None]
    (det,) = nms.non_max_suppression(stored, conf_thres=CONF, iou_thres=IOU)
    det[:, :4] = ops.scale_boxes((size, size), det[:, :4], (src_h, src_w))
    expected = [
        {"type": names[int(c)], "confidence": round(float(s), 6), "box": [round(float(v), 3) for v in b]}
        for *b, s, c in det.tolist()
    ]
    (HERE / "decode_raw.json").write_text(json.dumps({
        "_": f"make_fixtures.py: {weights.parent.parent.name}/{weights.name} on {image.name}; "
             f"anchors with a class score >= {KEEP}; expected = ultralytics NMS(conf {CONF}, iou {IOU}) "
             "+ scale_boxes of exactly these anchors",
        "names": {str(k): v for k, v in names.items()},
        "source": [src_w, src_h], "input": [size, size], "minConf": CONF, "iou": IOU,
        "anchors": columns.tolist(),
        "expected": expected,
    }, indent=0), encoding="utf-8")
    print(f"{len(columns)} anchors kept, {len(expected)} expected detections")


if __name__ == "__main__":
    main()
