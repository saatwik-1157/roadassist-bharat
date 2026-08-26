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

# MVP contract: potholes + cracks only.
MVP_MAP = {"D40": 0, "D00": 1, "D10": 1, "D20": 1}
MVP_NAMES = ["pothole", "road_damage"]

# Richer road-asset set — adds two well-represented RDD2022 labels:
#   D44 white-line blur -> faded_marking   D50 -> manhole
# (still skips sparse/ambiguous D01/D11/D43/D0w0.)
RICH_MAP = {"D40": 0, "D00": 1, "D10": 1, "D20": 1, "D44": 2, "D50": 3}
RICH_NAMES = ["pothole", "road_damage", "faded_marking", "manhole"]

# convert_one() reads these module globals; main() swaps them per --classes.
CLASS_MAP = MVP_MAP
NAMES = MVP_NAMES


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


def gather(src: Path) -> tuple[list[tuple[Path, list[str]]], Counter]:
    """Usable (image, YOLO-lines) pairs for one RDD2022 country directory."""
    xml_dir = src / "train" / "annotations" / "xmls"
    img_dir = src / "train" / "images"
    usable: list[tuple[Path, list[str]]] = []
    stats: Counter = Counter()
    for x in sorted(xml_dir.glob("*.xml")):
        lines, seen = convert_one(x)
        stats.update(seen)
        if lines:
            img = img_dir / (x.stem + ".jpg")
            if img.exists():
                usable.append((img, lines))
    return usable, stats


def main() -> None:
    ap = argparse.ArgumentParser()
    # Accept one OR many country dirs — multiple sources build a diverse,
    # multi-country detector; a single source reproduces the original behaviour.
    ap.add_argument("--src", required=True, nargs="+",
                    help="one or more RDD2022 country dirs (each with train/images + train/annotations/xmls)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--train", type=int, default=800)
    ap.add_argument("--val", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20260823)
    ap.add_argument("--classes", choices=["mvp", "rich"], default="mvp",
                    help="mvp = pothole+road_damage; rich = +faded_marking+manhole")
    args = ap.parse_args()

    global CLASS_MAP, NAMES
    if args.classes == "rich":
        CLASS_MAP, NAMES = RICH_MAP, RICH_NAMES

    out = Path(args.out)
    rng = random.Random(args.seed)
    want = args.train + args.val

    # Gather usable images per country, shuffled independently.
    per_country: dict[str, list[tuple[Path, list[str]]]] = {}
    label_stats: Counter = Counter()
    for s in args.src:
        src = Path(s)
        if not (src / "train" / "annotations" / "xmls").exists():
            raise SystemExit(f"no annotations under {src}/train/annotations/xmls")
        usable, stats = gather(src)
        rng.shuffle(usable)
        per_country[src.name] = usable
        label_stats.update(stats)
        print(f"  {src.name:16s} usable (mapped) images: {len(usable)}")

    # Balanced round-robin draw across countries so no single split dominates —
    # diversity is the point of a multi-country set, not raw volume from one.
    picked: list[tuple[str, Path, list[str]]] = []
    cursors = {c: 0 for c in per_country}
    while len(picked) < want and any(cursors[c] < len(per_country[c]) for c in per_country):
        for c, items in per_country.items():
            if cursors[c] < len(items) and len(picked) < want:
                picked.append((c, *items[cursors[c]]))
                cursors[c] += 1
    rng.shuffle(picked)   # mix countries within each split

    splits = {"train": picked[: args.train], "val": picked[args.train:]}
    country_mix: Counter = Counter()
    for split, items in splits.items():
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        for country, img, lines in items:
            if split == "train":
                country_mix[country] += 1
            # country-prefix guards against any cross-country filename clash
            stem = f"{country}__{img.stem}"
            shutil.copy2(img, out / "images" / split / f"{stem}{img.suffix}")
            (out / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + "\n")

    names_block = "".join(f"  {i}: {n}\n" for i, n in enumerate(NAMES))
    (out / "dataset.yaml").write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\nval: images/val\n"
        f"names:\n{names_block}"
    )

    print(f"countries: {list(per_country)}")
    print(f"label frequencies (all sources): {dict(sorted(label_stats.items()))}")
    print(f"train country mix: {dict(country_mix)}")
    print(f"written: train={len(splits['train'])} val={len(splits['val'])} -> {out}")
    skipped = {k: v for k, v in label_stats.items() if k not in CLASS_MAP}
    if skipped:
        print(f"labels intentionally skipped (not in the MVP mapping): {skipped}")


if __name__ == "__main__":
    main()
