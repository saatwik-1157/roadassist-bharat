"""Score several detectors on the SAME held-out splits and write one JSON record.

Two splits:

  rich        data/yolo-multi-rich val: 800 images, 4 countries, 4 classes. The split
              every multi-rich model reports, so baseline-vs-new on it is fair.

  india-clean data/yolo-full val (RDD2022 India, pothole + road_damage) with every image
              that appears in ANY training split removed. That subtraction matters:
              of yolo-full's 523 val images, 23 are also in yolo-full/train and 114
              are in yolo-multi-rich/train, so scoring a multi-rich model on the raw
              folder would grade it partly on images it was trained on. The subset is
              built once into data/yolo-india-clean/ (gitignored, like all of data/).

Only classes 0 (pothole) and 1 (road_damage) are labelled on india-clean, so a 4-class
model's faded_marking / manhole predictions do not touch its India numbers: ultralytics
averages AP over the classes that have ground truth.

Usage (from ai/road_damage):
  ../.venv-gpu/Scripts/python eval_compare.py --device 0 --out ../runs/compare.json \
      --model base=../runs/yolo11s-multi-rich/weights/best.pt@512 \
      --model new=../runs/yolo11s-multi-rich-gpu/weights/best.pt@640
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

AI = Path(__file__).resolve().parent.parent
DATA = AI / "data"
TRAIN_SPLITS = ["yolo", "yolo-full", "yolo-multi", "yolo-multi-rich"]


def _stem(name: str) -> str:
    """Multi-country splits prefix the country ('India__India_000038.jpg')."""
    return name.split("__", 1)[1] if "__" in name else name


def build_india_clean() -> Path:
    out = DATA / "yolo-india-clean"
    src = DATA / "yolo-full"
    trained = set()
    for split in TRAIN_SPLITS:
        d = DATA / split / "images" / "train"
        if d.is_dir():
            trained |= {_stem(p.name) for p in d.iterdir()}
    keep = sorted(p for p in (src / "images" / "val").iterdir() if p.name not in trained)
    if (out / "images" / "val").is_dir() and len(list((out / "images" / "val").iterdir())) == len(keep):
        return out
    shutil.rmtree(out, ignore_errors=True)
    (out / "images" / "val").mkdir(parents=True)
    (out / "labels" / "val").mkdir(parents=True)
    for img in keep:
        shutil.copy2(img, out / "images" / "val" / img.name)
        lab = src / "labels" / "val" / (img.stem + ".txt")
        if lab.exists():
            shutil.copy2(lab, out / "labels" / "val" / lab.name)
    (out / "README.txt").write_text(
        f"yolo-full/val minus every image in {', '.join(TRAIN_SPLITS)} train.\n"
        f"{len(keep)} images. Built by road_damage/eval_compare.py.\n")
    return out


def yaml_for(root: Path, names: dict[int, str], tag: str) -> Path:
    y = root / f"dataset-{tag}.yaml"
    body = "train: images/val\nval: images/val\nnames:\n" + "".join(
        f"  {i}: {n}\n" for i, n in names.items())
    y.write_text(body)
    return y


def score(model, data: Path, imgsz: int, device: str, project: Path, name: str,
          workers: int = 2) -> dict:
    m = model.val(data=str(data), imgsz=imgsz, device=device, batch=16, workers=workers,
                  plots=True, project=str(project), name=name, exist_ok=True, verbose=False)
    b = m.box
    gt = {int(c) for c in b.ap_class_index}
    per = {}
    for j, c in enumerate(b.ap_class_index):
        p, r, ap50, ap = b.class_result(j)
        per[m.names[int(c)]] = {"precision": round(float(p), 4), "recall": round(float(r), 4),
                                "mAP50": round(float(ap50), 4), "mAP50-95": round(float(ap), 4)}
    return {"imgsz": imgsz,
            "precision": round(float(b.mp), 4), "recall": round(float(b.mr), 4),
            "mAP50": round(float(b.map50), 4), "mAP50-95": round(float(b.map), 4),
            "classes_with_gt": sorted(m.names[c] for c in gt), "per_class": per}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="append", required=True,
                    help="label=path.pt@imgsz[,imgsz...]  (repeatable)")
    ap.add_argument("--device", default="0")
    ap.add_argument("--splits", default="rich,india-clean")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=2,
                    help="0 avoids spawning torch workers; use it when commit memory is short")
    args = ap.parse_args()

    from ultralytics import YOLO

    india = build_india_clean()
    n_india = len(list((india / "images" / "val").iterdir()))
    rich_yaml = DATA / "yolo-multi-rich" / "dataset.yaml"
    project = Path(args.out).resolve().parent / (Path(args.out).stem + "-val")

    result = {"splits": {"rich": f"{rich_yaml.relative_to(AI)} (val, 800 images)",
                         "india-clean": f"data/yolo-india-clean ({n_india} images, "
                                        "yolo-full/val minus every training image)"},
              "models": {}}
    out = Path(args.out)
    if out.exists():  # resume: keep results already measured (a crash loses one entry)
        result["models"] = json.loads(out.read_text()).get("models", {})
    for spec in args.model:
        label, rest = spec.split("=", 1)
        path, sizes = rest.rsplit("@", 1)
        model = YOLO(path)
        names = dict(model.names)
        entry = result["models"].get(label) or {"weights": path, "classes": list(names.values()),
                                                "results": {}}
        result["models"][label] = entry
        for imgsz in (int(s) for s in sizes.split(",")):
            for split in args.splits.split(","):
                if split == "rich":
                    if len(names) != 4:
                        continue  # a 2-class model cannot be scored on 4-class labels
                    data = rich_yaml
                else:
                    data = yaml_for(india, names, f"{len(names)}c")
                key = f"{split}@{imgsz}"
                if key in entry["results"]:
                    continue
                print(f"[eval] {label} {key}")
                entry["results"][key] = score(model, data, imgsz, args.device, project,
                                              f"{label}-{split}-{imgsz}", args.workers)
                r = entry["results"][key]
                print(f"[eval] {label} {key}: P {r['precision']} R {r['recall']} "
                      f"mAP50 {r['mAP50']} mAP50-95 {r['mAP50-95']}")
                out.write_text(json.dumps(result, indent=2))
    out.write_text(json.dumps(result, indent=2))
    print(f"[eval] wrote {args.out}")


if __name__ == "__main__":
    main()
