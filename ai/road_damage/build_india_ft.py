"""Build data/yolo-india-ft: an India-heavy, leak-free training set for the nano fine-tune.

train = every usable RDD2022-India train image (labels re-derived from the VOC XML
        with the 4-class RICH mapping, so faded_marking / manhole are labelled on
        India too rather than taught as background), written TWICE (India oversampled
        x2 by physical copy), plus the non-India part of yolo-multi-rich/train.
val   = yolo-multi-rich/val, unchanged (checkpoint selection stays on the 4-country split).

Excluded from train, by filename stem AND by sha256 of the image bytes:
  * every image of yolo-multi-rich/val      (the rich comparison split)
  * every image of yolo-full/val            (superset of the leak-free India subset)
  * every image of yolo-india-clean/val     (the India comparison split)
The script fails if any overlap survives.

    python build_india_ft.py
"""
from __future__ import annotations

import hashlib
import shutil
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import convert_voc_to_yolo as cv  # noqa: E402

DATA = HERE.parent / "data"
OUT = DATA / "yolo-india-ft"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def stem(name: str) -> str:
    n = Path(name).stem
    n = n.split("__", 1)[1] if "__" in n else n
    return n.removesuffix("__dup")


def main() -> None:
    cv.CLASS_MAP, cv.NAMES = cv.RICH_MAP, cv.RICH_NAMES
    held = [DATA / "yolo-multi-rich/images/val", DATA / "yolo-full/images/val",
            DATA / "yolo-india-clean/images/val"]
    held_files = [p for d in held for p in d.iterdir()]
    held_stems = {stem(p.name) for p in held_files}
    held_hash = {sha(p) for p in held_files}

    india, stats = cv.gather(DATA / "India")
    india = [(img, lines) for img, lines in india if img.stem not in held_stems]
    rich_train = DATA / "yolo-multi-rich/images/train"
    others = [p for p in sorted(rich_train.iterdir()) if not p.name.startswith("India__")]

    shutil.rmtree(OUT, ignore_errors=True)
    (OUT / "images/train").mkdir(parents=True)
    (OUT / "labels/train").mkdir(parents=True)
    for img, lines in india:
        for suffix in ("", "__dup"):
            shutil.copy2(img, OUT / "images/train" / f"India__{img.stem}{suffix}.jpg")
            (OUT / "labels/train" / f"India__{img.stem}{suffix}.txt").write_text("\n".join(lines) + "\n")
    for p in others:
        shutil.copy2(p, OUT / "images/train" / p.name)
        shutil.copy2(DATA / "yolo-multi-rich/labels/train" / (p.stem + ".txt"),
                     OUT / "labels/train" / (p.stem + ".txt"))

    train = list((OUT / "images/train").iterdir())
    bad_stem = [p.name for p in train if stem(p.name) in held_stems]
    bad_hash = [p.name for p in train if sha(p) in held_hash]
    if bad_stem or bad_hash:
        raise SystemExit(f"LEAK: {len(bad_stem)} by name, {len(bad_hash)} by hash: "
                         f"{(bad_stem + bad_hash)[:5]}")

    val = (DATA / "yolo-multi-rich/images/val").resolve().as_posix()
    (OUT / "dataset.yaml").write_text(
        "# Built by road_damage/build_india_ft.py. val is yolo-multi-rich/val, untouched.\n"
        f"train: images/train\nval: {val}\nnames:\n"
        + "".join(f"  {i}: {n}\n" for i, n in enumerate(cv.RICH_NAMES)))
    cls = Counter()
    for t in (OUT / "labels/train").iterdir():
        cls.update(line.split()[0] for line in t.read_text().splitlines() if line.strip())
    summary = (f"india unique {len(india)} (x2 = {2 * len(india)}), other countries {len(others)}, "
               f"train files {len(train)}; held-out {len(held_files)} files, "
               f"0 overlaps by stem or sha256. instances per class "
               f"{ {cv.RICH_NAMES[int(k)]: v for k, v in sorted(cls.items())} }")
    (OUT / "README.txt").write_text(summary + "\n")
    print(summary)


if __name__ == "__main__":
    main()
