"""RDD2022 (PASCAL-VOC XML) -> YOLO txt, with the RAKSHA class mapping.

Official RDD2022 labels (label_map.pbtxt):
  D00 longitudinal crack, D10 transverse crack, D20 alligator crack, D40 pothole.
RAKSHA MVP mapping (docs/raksha/05-dataset-license-verification.md §3):
  D40                -> 0 pothole
  D00 / D10 / D20    -> 1 road_damage
Any other label (some RDD releases carry extras like D43/D44/D50) is skipped
and counted, never silently folded into a class.

The India *test* split ships without annotations (challenge server held them),
so train/val are carved from the annotated train split with a fixed seed.

Usage:
  python convert_voc_to_yolo.py --src ../data/India --out ../data/yolo \
         --train 800 --val 200 [--seed 20260823]
"""
from __future__ import annotations

import argparse
import random
import shutil
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

CLASS_MAP = {"D40": 0, "D00": 1, "D10": 1, "D20": 1}
NAMES = ["pothole", "road_damage"]


def convert_one(xml_path: Path) -> tuple[list[str], Counter]:
    """Return YOLO lines for one VOC file plus a per-label counter."""
    seen: Counter = Counter()
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    w = float(size.findtext("width"))
    h = float(size.findtext("height"))
    if w <= 0 or h <= 0:
        return [], seen

    lines: list[str] = []
    for obj in root.iter("object"):
        label = (obj.findtext("name") or "").strip()
        seen[label] += 1
        cls = CLASS_MAP.get(label)
        if cls is None:
            continue
        box = obj.find("bndbox")
        xmin = float(box.findtext("xmin")); ymin = float(box.findtext("ymin"))
        xmax = float(box.findtext("xmax")); ymax = float(box.findtext("ymax"))
        # clamp, normalise, guard degenerate boxes
        xmin, xmax = max(0.0, min(xmin, w)), max(0.0, min(xmax, w))
        ymin, ymax = max(0.0, min(ymin, h)), max(0.0, min(ymax, h))
        bw, bh = xmax - xmin, ymax - ymin
        if bw < 2 or bh < 2:
            continue
        cx, cy = (xmin + bw / 2) / w, (ymin + bh / 2) / h
        lines.append(f"{cls} {cx:.6f} {cy:.6f} {bw / w:.6f} {bh / h:.6f}")
    return lines, seen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="India/ directory (train/images + train/annotations/xmls)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--train", type=int, default=800)
    ap.add_argument("--val", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20260823)
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    xml_dir = src / "train" / "annotations" / "xmls"
    img_dir = src / "train" / "images"
    xmls = sorted(xml_dir.glob("*.xml"))
    if not xmls:
        raise SystemExit(f"no XML annotations under {xml_dir}")

    # keep only images that have at least one mapped object — a smoke-scale
    # training run should not drown in pure-background frames
    usable: list[tuple[Path, list[str]]] = []
    label_stats: Counter = Counter()
    for x in xmls:
        lines, seen = convert_one(x)
        label_stats.update(seen)
        if lines:
            img = img_dir / (x.stem + ".jpg")
            if img.exists():
                usable.append((img, lines))

    rng = random.Random(args.seed)
    rng.shuffle(usable)
    want = args.train + args.val
    picked = usable[:want]
    splits = {"train": picked[: args.train], "val": picked[args.train:]}

    for split, items in splits.items():
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        for img, lines in items:
            shutil.copy2(img, out / "images" / split / img.name)
            (out / "labels" / split / (img.stem + ".txt")).write_text("\n".join(lines) + "\n")

    (out / "dataset.yaml").write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\nval: images/val\n"
        f"names:\n  0: {NAMES[0]}\n  1: {NAMES[1]}\n"
    )

    print(f"annotated XMLs: {len(xmls)} · with mapped objects + image: {len(usable)}")
    print(f"label frequencies in source: {dict(sorted(label_stats.items()))}")
    print(f"written: train={len(splits['train'])} val={len(splits['val'])} -> {out}")
    skipped = {k: v for k, v in label_stats.items() if k not in CLASS_MAP}
    if skipped:
        print(f"labels intentionally skipped (not in the MVP mapping): {skipped}")


if __name__ == "__main__":
    main()
