"""Write runs/<run>/metrics.json: measured metrics + sha256 of every shipped file.

    python run_record.py ../runs/yolo11n-multi-rich-gpu --label nano-gpu

Reads the run's own args.yaml and results.csv, and compare.json written by
eval_compare.py (the label picks this run's entry). Nothing here is typed in by
hand, so the record can only say what the artefacts say.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--label", required=True, help="this run's key in compare.json")
    ap.add_argument("--compare", default=None, help="default: <run>/compare.json")
    args = ap.parse_args()

    run = Path(args.run)
    rows = list(csv.DictReader((run / "results.csv").open()))
    key = "metrics/mAP50-95(B)"
    best = max(rows, key=lambda r: 0.1 * float(r["metrics/mAP50(B)"]) + 0.9 * float(r[key]))
    cargs = {}
    for line in (run / "args.yaml").read_text().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            cargs[k.strip()] = v.strip()
    compare = json.loads(Path(args.compare or run / "compare.json").read_text())
    files = sorted(p for p in (run / "weights").iterdir()
                   if p.name.startswith("best") and p.suffix in (".pt", ".onnx", ".json"))
    record = {
        "run": run.name,
        "train": {k: cargs.get(k) for k in ("model", "data", "epochs", "time", "batch", "imgsz",
                                            "device", "workers", "patience", "cos_lr",
                                            "warmup_epochs", "close_mosaic", "save_period")},
        "epochs_completed": len(rows),
        "wall_seconds": float(rows[-1]["time"]),
        "best_epoch": int(best["epoch"]),
        "best_epoch_val": {"precision": float(best["metrics/precision(B)"]),
                           "recall": float(best["metrics/recall(B)"]),
                           "mAP50": float(best["metrics/mAP50(B)"]),
                           "mAP50-95": float(best[key])},
        "evaluation": {"splits": compare["splits"],
                       "this_run": compare["models"][args.label],
                       "baselines": {k: v for k, v in compare["models"].items() if k != args.label}},
        "files": {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in files},
    }
    (run / "metrics.json").write_text(json.dumps(record, indent=2))
    print(f"wrote {run / 'metrics.json'}")
    for n, f in record["files"].items():
        print(f"  {n:16s} {f['bytes']:>10d}  {f['sha256']}")


if __name__ == "__main__":
    main()
