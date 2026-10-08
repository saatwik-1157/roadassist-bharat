"""Package a detector for the browser's live road scan, and pin what it must output.

    # 1. copy the ONNX next to the page and write its sidecar JSON
    python web_model.py export --weights ../runs/yolo11n-multi-rich-gpu/weights/best-640.onnx \
        --name raksha-yolo11n-multi-rich-gpu --map50 0.547 --map50-95 0.262 \
        --class-map50 pothole=0.324 road_damage=0.531 faded_marking=0.539 manhole=0.793 \
        --metrics-source "ai/runs/yolo11n-multi-rich-gpu/compare.json: ..."

    # 2. the Python detections the browser must reproduce on the same images
    python web_model.py reference --weights ../../app/apps/web/assets/models/raksha-yolo11n-multi-rich-gpu.onnx \
        --images ../../app/apps/web/assets/scan/*.jpg

── why a sidecar JSON ──────────────────────────────────────────────────────
onnxruntime-web does not expose the model's custom metadata, so the page
cannot read `names` and `imgsz` from the .onnx the way `onnx_detector.py`
does. This script reads them FROM the model's metadata (the same
`read_class_names` / `read_input_size` the server path uses) and writes them
beside it, so the class order the browser shows is the order the model was
exported with, never a list somebody typed. The sha256 lets the page and the
check script refuse a sidecar that does not belong to the .onnx beside it.

── why a reference file ────────────────────────────────────────────────────
The browser re-implements letterbox, decode and NMS in JavaScript
(app/apps/web/scan-core.js). A port that is merely self-consistent can still
shift every box. The reference is what `serve.py`'s Detector returns for the
same images, and app/scripts/scan-check.mjs fails unless the page's boxes
match it (IoU > 0.9, same class).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from onnx_detector import NMS_IOU, model_version, read_class_names, read_input_size  # noqa: E402

REPO = HERE.parent.parent
WEB_MODELS = REPO / "app" / "apps" / "web" / "assets" / "models"
REFERENCE = REPO / "app" / "scripts" / "scan-reference.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export(args) -> None:
    import onnxruntime as ort

    weights = Path(args.weights)
    session = ort.InferenceSession(str(weights), providers=["CPUExecutionProvider"])
    names = read_class_names(session)
    w, h = read_input_size(session)
    meta = session.get_modelmeta().custom_metadata_map

    classes = [names[i] for i in sorted(names)]
    per_class = {}
    for item in args.class_map50 or []:
        name, sep, value = item.partition("=")
        if not sep or name not in classes:
            raise SystemExit(f"--class-map50 {item!r}: expected NAME=VALUE with NAME one of {classes}")
        per_class[name] = float(value)
    if per_class and set(per_class) != set(classes):
        raise SystemExit(f"--class-map50 must give every class or none; missing {sorted(set(classes) - set(per_class))}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_out = out_dir / f"{args.name}.onnx"
    if weights.resolve() != onnx_out.resolve():
        shutil.copyfile(weights, onnx_out)

    sidecar = {
        "_": "Written by ai/road_damage/web_model.py from the model's own metadata. Do not edit by hand.",
        "model": onnx_out.name,
        "sha256": sha256(onnx_out),
        "bytes": onnx_out.stat().st_size,
        # Index order matters: output row 4 + i is classes[i].
        "classes": classes,
        "inputSize": [w, h],
        # The string serve.py and detect.py report for these same weights (run
        # directory + weights hash), so a report filed from the browser names
        # the network exactly as a device detection would.
        "modelVersion": args.model_version or model_version(weights),
        "architecture": meta.get("description", "").split(" model trained")[0],
        "exportedAt": meta.get("date"),
        "minConfidence": args.min_conf,
        "iouThreshold": args.iou,
        "metrics": {
            "mAP50": args.map50,
            "mAP50_95": args.map50_95,
            "source": args.metrics_source,
        },
    }
    if per_class:
        # In class order. The page shows them, so a mean lifted by one easy
        # class is never the only figure a person sees.
        sidecar["metrics"]["perClassMAP50"] = {c: per_class[c] for c in classes}
    json_out = out_dir / f"{args.name}.json"
    json_out.write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {onnx_out} ({sidecar['bytes']} bytes) and {json_out}")
    print(f"classes={sidecar['classes']} input={w}x{h}")


def reference(args) -> None:
    from serve import Detector

    det = Detector(Path(args.weights), args.min_conf, args.iou)
    images = []
    for p in args.images:
        path = Path(p)
        detections, ms, (w, h) = det.detect(path.read_bytes())
        images.append({
            "image": path.name,
            "size": [w, h],
            "detections": [
                {
                    "type": d.type,
                    "confidence": round(d.confidence, 4),
                    "severity": d.severity,
                    "boxFraction": round(d.box_fraction, 5),
                    "box": [round(v, 2) for v in d.box],
                }
                for d in detections
            ],
        })
        print(f"{path.name}: {len(detections)} detections ({ms:.0f} ms)", file=sys.stderr)

    out = {
        "_": "serve.py's Detector on these images. scan-check.mjs holds the browser to it.",
        "weights": Path(args.weights).name,
        "sha256": sha256(Path(args.weights)),
        "minConfidence": args.min_conf,
        "iouThreshold": args.iou,
        "images": images,
    }
    Path(args.out).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("export", help="copy the ONNX beside the page and write its sidecar JSON")
    e.add_argument("--weights", required=True)
    e.add_argument("--name", required=True, help="file stem under assets/models/")
    e.add_argument("--out-dir", default=str(WEB_MODELS))
    e.add_argument("--model-version", default=None, help="default: onnx_detector.model_version(weights)")
    e.add_argument("--map50", type=float, required=True, help="measured, from ai/README.md")
    e.add_argument("--map50-95", type=float, required=True)
    e.add_argument("--metrics-source", required=True, help="where the figures were measured")
    e.add_argument("--class-map50", nargs="*", metavar="NAME=VALUE",
                   help="measured per-class mAP50, every class or none (e.g. pothole=0.324)")
    e.add_argument("--min-conf", type=float, default=0.30)
    e.add_argument("--iou", type=float, default=NMS_IOU)
    e.set_defaults(fn=export)

    r = sub.add_parser("reference", help="Python detections the browser must reproduce")
    r.add_argument("--weights", required=True)
    r.add_argument("--images", nargs="+", required=True)
    r.add_argument("--out", default=str(REFERENCE))
    r.add_argument("--min-conf", type=float, default=0.30)
    r.add_argument("--iou", type=float, default=NMS_IOU)
    r.set_defaults(fn=reference)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
