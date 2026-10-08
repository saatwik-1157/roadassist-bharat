"""Check an exported ONNX against the .pt it came from, box by box, on real images.

    ../.venv-gpu/Scripts/python onnx_parity.py --pt ../runs/<run>/weights/best.pt \
        --onnx ../runs/<run>/weights/best-640.onnx --images ../data/yolo-india-clean/images/val --n 8

The .pt runs through ultralytics predict; the .onnx runs through serve.py's own
Detector (onnx_detector.decode: letterbox, decode, NMS), i.e. the path that ships.
Each .pt box is matched to the best same-class ONNX box by IoU. Exit 1 if any
.pt box above --min-conf has no ONNX partner with IoU >= --min-iou.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from onnx_detector import iou  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pt", required=True)
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--images", required=True)
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--min-conf", type=float, default=0.30)
    ap.add_argument("--min-iou", type=float, default=0.90)
    args = ap.parse_args()

    from serve import Detector
    from ultralytics import YOLO

    det = Detector(Path(args.onnx), args.min_conf, 0.7)
    imgsz = det.model_w
    model = YOLO(args.pt)
    imgs = sorted(Path(args.images).glob("*.jpg"))[: args.n]
    worst, missing, total = 1.0, 0, 0
    for p in imgs:
        onnx_dets, _, _ = det.detect(p.read_bytes())
        r = model.predict(str(p), imgsz=imgsz, conf=args.min_conf, iou=0.7,
                          device="cpu", verbose=False)[0]
        pt_boxes = [(model.names[int(c)], float(s), [float(v) for v in b])
                    for b, s, c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist())]
        for name, conf, box in pt_boxes:
            total += 1
            cands = [d for d in onnx_dets if d.type == name]
            best = max((iou(box, list(d.box)) for d in cands), default=0.0)
            worst = min(worst, best)
            if best < args.min_iou:
                missing += 1
        print(f"{p.name}: pt {len(pt_boxes)} boxes, onnx {len(onnx_dets)} boxes")
    print(f"[parity] {total} .pt boxes, worst matched IoU {worst:.3f}, unmatched (<{args.min_iou}) {missing}")
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
