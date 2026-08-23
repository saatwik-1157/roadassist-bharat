"""Render real model detections onto real RDD2022-India frames for the
showcase's live-feed panel. Output frames carry the boxes the trained model
actually predicted — nothing is hand-drawn. Images are CC BY(-SA) 4.0
(RDD2022, Arya et al.) and are attributed on the page that shows them.

Usage: python annotate_feed.py --weights <pt> --source <val images> --out <dir> --count 8
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
from ultralytics import YOLO
from ultralytics.utils import LOGGER

ap = argparse.ArgumentParser()
ap.add_argument("--weights", required=True)
ap.add_argument("--source", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--count", type=int, default=8)
ap.add_argument("--conf", type=float, default=0.35)
args = ap.parse_args()

LOGGER.setLevel("ERROR")
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
model = YOLO(args.weights, task="detect")

images = sorted(Path(args.source).glob("*.jpg"))
saved = 0
for img in images:
    if saved >= args.count:
        break
    r = model.predict(str(img), conf=args.conf, imgsz=640, verbose=False)[0]
    if len(r.boxes) == 0:
        continue
    frame = r.plot(line_width=3, font_size=6)          # real boxes, real labels
    h, w = frame.shape[:2]
    if w > 960:                                        # web-friendly size
        frame = cv2.resize(frame, (960, int(h * 960 / w)), interpolation=cv2.INTER_AREA)
    dest = out / f"feed-{saved:02d}.jpg"
    cv2.imwrite(str(dest), frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
    print(f"{dest.name}  <- {img.name}  ({len(r.boxes)} detection(s))")
    saved += 1

print(f"done: {saved} annotated frames")
