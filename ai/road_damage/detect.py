"""Road-damage detector CLI — the real CV capability behind RAKSHA (Phase 5).

Runs a YOLO model over one image or a directory and prints detections as JSON
in exactly the shape POST /v1/raksha/detections expects per item (minus the
device-side fields opId/lat/lng/capturedAt, which the edge process attaches).

Severity heuristic (ENGINEERING ASSUMPTION, documented, not a safety claim):
bounding-box area as a fraction of the frame is a crude proxy for how much of
the carriageway the defect occupies —
  <1% -> 1, <3% -> 2, <7% -> 3, <15% -> 4, else 5; potholes get +1 (cap 5)
because a pothole of equal size is worse than a surface crack.

Usage:
  python detect.py --weights runs/detect/train/weights/best.pt \
                   --source ../data/yolo/images/val --min-conf 0.30 [--limit 20]
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path

from ultralytics import YOLO
from ultralytics.utils import LOGGER

TYPES = {0: "pothole", 1: "road_damage"}
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def severity(cls_name: str, box_frac: float) -> int:
    if box_frac < 0.01:
        s = 1
    elif box_frac < 0.03:
        s = 2
    elif box_frac < 0.07:
        s = 3
    elif box_frac < 0.15:
        s = 4
    else:
        s = 5
    if cls_name == "pothole":
        s = min(5, s + 1)
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--source", required=True, help="image file or directory")
    ap.add_argument("--min-conf", type=float, default=0.30)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--limit", type=int, default=0, help="max images from a directory (0 = all)")
    args = ap.parse_args()

    src = Path(args.source)
    images = [src] if src.is_file() else sorted(
        p for p in src.iterdir() if p.suffix.lower() in IMG_EXTS
    )
    if args.limit:
        images = images[: args.limit]
    if not images:
        raise SystemExit(f"no images at {src}")

    # stdout is a JSON contract: capture every stray library print (the ONNX
    # backend announces itself on stdout) and keep the log level quiet.
    LOGGER.setLevel("ERROR")
    chatter = io.StringIO()
    with contextlib.redirect_stdout(chatter):
        model = YOLO(args.weights, task="detect")
        predictions = model.predict([str(p) for p in images], imgsz=args.imgsz,
                                    conf=args.min_conf, verbose=False)
    if chatter.getvalue().strip():
        print(chatter.getvalue().strip(), file=sys.stderr)

    model_version = f"yolo-rdd2022in-{Path(args.weights).stem}"

    out = []
    for r in predictions:
        h, w = r.orig_shape
        frame = float(w * h)
        dets = []
        for b in r.boxes:
            cls_name = TYPES.get(int(b.cls[0]))
            if cls_name is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0])
            frac = max(0.0, (x2 - x1) * (y2 - y1)) / frame
            dets.append({
                "type": cls_name,
                "confidence": round(float(b.conf[0]), 3),
                "severity": severity(cls_name, frac),
                "boxFraction": round(frac, 4),
                "modelVersion": model_version,
                "usedFallback": False,
            })
        out.append({
            "imageRef": Path(r.path).name,
            "inferenceMs": round(sum(r.speed.values()), 1),
            "detections": dets,
        })

    print(json.dumps({
        "model": model_version,
        "images": len(out),
        "results": out,
        "note": "severity is a documented box-area heuristic, not a safety standard",
    }, indent=1))


if __name__ == "__main__":
    main()
