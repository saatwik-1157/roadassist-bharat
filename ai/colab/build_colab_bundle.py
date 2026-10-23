"""Pack everything the Colab fine-tune needs into one zip.

The zip is self-contained: Colab has no access to S:, so every split is copied
in and the notebook writes its own dataset YAMLs with Colab paths.

  data/train/{images,labels}       yolo-india-ft train (8,373 images, leak-checked)
  data/val/{images,labels}         yolo-multi-rich val (800 images, 4 countries) -- the "rich" split
  data/india-clean/{images,labels} 392 India images no model trained on -- the "india-clean" split
  weights/yolo11s-multi-rich-gpu.pt  the start point (YOLO11s, rich val mAP50 0.578)
  weights/yolo11n-india-ft-gpu.pt    the shipped edge model, scored beside the new one
  manifest.json                    file counts and sha256 of both weights, checked in Colab

Images are stored, not deflated: JPEGs do not compress, and storing them
keeps the build and the Colab unzip fast.

Usage (from ai/colab):
  python build_colab_bundle.py                      # full bundle, ~0.6 GB
  python build_colab_bundle.py --limit 64 --out ../runs/colab-smoke.zip   # tiny bundle for a local trial
"""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

AI = Path(__file__).resolve().parents[1]
DATA = AI / "data"
RUNS = AI / "runs"

SPLITS = {
    "train": DATA / "yolo-india-ft" / "{kind}" / "train",
    "val": DATA / "yolo-multi-rich" / "{kind}" / "val",
    "india-clean": DATA / "yolo-india-clean" / "{kind}" / "val",
}
WEIGHTS = {
    "yolo11s-multi-rich-gpu.pt": RUNS / "yolo11s-multi-rich-gpu" / "weights" / "best.pt",
    "yolo11n-india-ft-gpu.pt": RUNS / "yolo11n-india-ft-gpu" / "weights" / "best.pt",
}
NAMES = {0: "pothole", 1: "road_damage", 2: "faded_marking", 3: "manhole"}
IMAGE_EXT = {".jpg", ".jpeg", ".png"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def pairs(split: str, limit: int | None) -> list[tuple[Path, Path | None]]:
    """Every image with its label file. An image with no label is a background image."""
    images = sorted(p for p in Path(str(SPLITS[split]).format(kind="images")).iterdir()
                    if p.suffix.lower() in IMAGE_EXT)
    if limit:
        images = images[:limit]
    labels = Path(str(SPLITS[split]).format(kind="labels"))
    out = []
    for img in images:
        lbl = labels / (img.stem + ".txt")
        out.append((img, lbl if lbl.exists() else None))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(RUNS / "raksha_colab_data.zip"))
    ap.add_argument("--limit", type=int, default=None,
                    help="images per split; for a quick local trial of the notebook")
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": 1, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "limit": args.limit, "names": NAMES, "splits": {}, "weights": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        for split in SPLITS:
            items = pairs(split, args.limit)
            n_labels = 0
            for img, lbl in items:
                zf.write(img, f"data/{split}/images/{img.name}")
                if lbl is not None:
                    zf.write(lbl, f"data/{split}/labels/{lbl.name}")
                    n_labels += 1
            manifest["splits"][split] = {"images": len(items), "labels": n_labels}
            print(f"{split:12s} {len(items):5d} images  {n_labels:5d} labels")
        for name, src in WEIGHTS.items():
            if not src.exists():
                raise SystemExit(f"missing weights: {src}")
            zf.write(src, f"weights/{name}")
            manifest["weights"][name] = {"sha256": sha256(src), "bytes": src.stat().st_size}
            print(f"weights      {name}")
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    print(f"wrote {out} ({out.stat().st_size / 2**20:.0f} MB)")


if __name__ == "__main__":
    main()
