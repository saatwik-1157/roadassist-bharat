"""Export a trained .pt to ONNX at one or more input sizes, each with a sidecar JSON.

    ../.venv-gpu/Scripts/python export_onnx.py ../runs/yolo11n-multi-rich-gpu/weights/best.pt \
        --imgsz 640 416 --static --metrics ../runs/yolo11n-multi-rich-gpu/metrics.json

Writes weights/best-<imgsz>.onnx and weights/best-<imgsz>.json beside the .pt. The
JSON carries the class list IN MODEL INDEX ORDER, read back from the exported file's
own metadata (never typed), plus the input size, the sha256 of the .onnx and, if
--metrics is given, the measured numbers from that file. Nothing is estimated.

--static fixes the input to 1x3xSxS, which is what a phone or a browser feeds anyway
and lets ONNX Runtime plan memory up front. Without it the export is dynamic in
batch/height/width, the same as the best.onnx files serve.py has always loaded.
Opset is left at ultralytics' default (20 on 8.4.126), as for every earlier export.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import shutil
from pathlib import Path


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("weights")
    ap.add_argument("--imgsz", type=int, nargs="+", required=True)
    ap.add_argument("--static", action="store_true")
    ap.add_argument("--metrics", help="JSON of measured metrics to copy into the sidecar")
    ap.add_argument("--suffix", default="", help="e.g. -interim-ep15")
    args = ap.parse_args()

    import onnx
    from ultralytics import YOLO

    pt = Path(args.weights).resolve()
    metrics = json.loads(Path(args.metrics).read_text()) if args.metrics else None
    for s in args.imgsz:
        out = YOLO(str(pt)).export(format="onnx", imgsz=s, dynamic=not args.static,
                                   simplify=True, device="cpu")
        dst = pt.with_name(f"{pt.stem}{args.suffix}-{s}.onnx")
        shutil.move(out, dst)
        meta = {p.key: p.value for p in onnx.load(str(dst)).metadata_props}
        names = ast.literal_eval(meta["names"])
        side = {
            "model": dst.name,
            "source_weights": str(pt.relative_to(pt.parents[3])).replace("\\", "/"),
            "sha256": sha256(dst),
            "bytes": dst.stat().st_size,
            "classes": [names[i] for i in sorted(names)],
            "inputSize": list(ast.literal_eval(meta["imgsz"])),
            "dynamic": not args.static,
            "opset": onnx.load(str(dst)).opset_import[0].version,
            "ultralytics": meta.get("version"),
            "exportedAt": meta.get("date"),
            "metrics": metrics,
        }
        dst.with_suffix(".json").write_text(json.dumps(side, indent=2))
        print(f"[export] {dst}  {side['bytes']} bytes  sha256 {side['sha256']}")


if __name__ == "__main__":
    main()
