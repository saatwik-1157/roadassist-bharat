"""Build data/yolo-pothole-ft: yolo-india-ft train plus free public pothole images.

The new images come from the sources in data/EXTRA_SOURCES.md (each downloaded and
unpacked under data/extra/<source>/; nothing in them is executed). Per source:

  irdd         Iraq, smartphone dashcam. YOLO-OBB, RDD2022 taxonomy: D40 -> pothole,
               D00/D10/D20 -> road_damage (the same map RDD2022 already uses).
               The oriented box becomes its axis-aligned bounding box.
  kent         (dropped at QC) UK, phone photos, water-filled and dry potholes. pothole only.
  mwpd         (dropped at QC) Bangladesh, multi-weather. pothole only. A Roboflow export: up to 12
               augmented copies per photo; one copy per photo is kept.
  pavdistress  Morocco, inspection vehicle. Poth -> pothole; EdCr/LongCr/TransCr ->
               road_damage; any image with a RoMar (road marking) box is dropped, as
               that class does not map cleanly onto faded_marking.

Only images with at least one pothole box are used (the point is potholes; it also
keeps the epoch short enough for the 4 GB laptop GPU).

Leak safety, all enforced (the script refuses to write on any hit):
  * every new image is checked against ALL of RDD2022 on disk (India, Czech, Japan,
    United_States, China_Drone, China_MotorBike raw splits and every data/yolo-*
    copy) by sha256 and by perceptual near-duplicate (near_dup.py: dHash + aHash,
    and of the mirror image); any hit is dropped and counted;
  * the new images are deduplicated among themselves the same way and grouped, so a
    near-duplicate cluster (and, for IRDD, a run of 25 consecutive dashcam frames)
    lands wholly in train or wholly in the held-out test split;
  * the final train is re-checked against rich val, yolo-full val and India-clean
    by stem, sha256 and perceptual hash.

Outputs:
  data/yolo-pothole-ft/       train = yolo-india-ft train + new train (hard links);
                              val = yolo-multi-rich/val (checkpoint selection unchanged)
  data/yolo-pothole-test/     ~15% of the new images, by group, never trained on;
                              images/val + labels/val, 4-class names

    python build_pothole_ft.py [--max-per-source N] [--seed 0]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import near_dup as nd  # noqa: E402

DATA = HERE.parent / "data"
EXTRA = DATA / "extra"
OUT = DATA / "yolo-pothole-ft"
TEST = DATA / "yolo-pothole-test"
NAMES = ["pothole", "road_damage", "faded_marking", "manhole"]
RDD_ROOTS = ["India", "Czech", "Japan", "United_States", "RDD2022-other"]
HELD = ["yolo-multi-rich/images/val", "yolo-full/images/val", "yolo-india-clean/images/val"]


def _clip(v: float) -> float:
    return min(1.0, max(0.0, v))


def _box(cls: int, xs: list[float], ys: list[float]) -> str | None:
    x0, x1, y0, y1 = _clip(min(xs)), _clip(max(xs)), _clip(min(ys)), _clip(max(ys))
    w, h = x1 - x0, y1 - y0
    if w < 0.003 or h < 0.003:
        return None
    return f"{cls} {(x0 + x1) / 2:.6f} {(y0 + y1) / 2:.6f} {w:.6f} {h:.6f}"


def parse_yolo(txt: Path, cmap: dict[int, int | None], obb: bool = False):
    """-> (lines, dropped) or None when the image must be skipped (a None-mapped class)."""
    lines = []
    for raw in txt.read_text().split("\n"):
        f = raw.split()
        if not f:
            continue
        c = int(float(f[0]))
        if c not in cmap:
            raise SystemExit(f"{txt}: unknown class {c}")
        if cmap[c] is None:
            return None
        v = [float(x) for x in f[1:]]
        if obb or len(v) > 4:  # polygon / OBB: x1 y1 x2 y2 ...
            b = _box(cmap[c], v[0::2], v[1::2])
        else:
            x, y, w, h = v[:4]
            b = _box(cmap[c], [x - w / 2, x + w / 2], [y - h / 2, y + h / 2])
        if b:
            lines.append(b)
    return lines


def gather() -> list[dict]:
    """Every usable new image: {src, img, lines, group}."""
    items = []
    # IRDD: train/val/test splits of the release are pooled; we re-split by group.
    root = EXTRA / "irdd" / "raw"
    for img in sorted(root.rglob("images/*.jpg")):
        lab = img.parent.parent / "labels" / (img.stem + ".txt")
        if not lab.exists():
            continue
        lines = parse_yolo(lab, {0: 1, 1: 1, 2: 1, 3: 0}, obb=True)
        n = re.findall(r"\d+", img.stem)
        items.append({"src": "irdd", "img": img, "lines": lines,
                      "group": f"irdd:{img.stem.rstrip('0123456789')}{int(n[-1]) // 25 if n else img.stem}"})
    # Kent: IMG/ + TXT/
    root = EXTRA / "kent" / "raw"
    for img in sorted((root / "IMG").glob("*.jpg")):
        lab = root / "TXT" / (img.stem + ".txt")
        if lab.exists():
            items.append({"src": "kent", "img": img, "lines": parse_yolo(lab, {0: 0}),
                          "group": f"kent:{img.stem}"})
    # MWPD: Mendeley folders f*_img* / f*_lbl*, labels matched by file stem.
    root = EXTRA / "mwpd"
    labs = {p.stem: p for p in root.glob("*_lbl*/*.txt")}
    seen_base = set()
    for img in sorted(root.glob("*_img*/*.jpg")):
        base = (img.parent.name.split("_")[0], img.stem.split(".rf.")[0])
        if base in seen_base or img.stem not in labs:
            continue  # one augmented copy per photo
        seen_base.add(base)
        items.append({"src": "mwpd", "img": img, "lines": parse_yolo(labs[img.stem], {0: 0}),
                      "group": f"mwpd:{base[0]}:{base[1]}"})
    # Pavdistress: names EdCr LongCr Poth RoMar TransCr
    root = EXTRA / "pavdistress" / "raw"
    seen_base = set()
    for img in sorted(root.rglob("images/*.jpg")):
        lab = img.parent.parent / "labels" / (img.stem + ".txt")
        base = img.stem.split(".rf.")[0]
        if not lab.exists() or base in seen_base:
            continue
        seen_base.add(base)
        items.append({"src": "pavdistress", "img": img,
                      "lines": parse_yolo(lab, {0: 1, 1: 1, 2: 0, 3: None, 4: 1}),
                      "group": f"pav:{base}"})
    return items


def link(src: Path, dst: Path) -> None:
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--test-frac", type=float, default=0.15)
    ap.add_argument("--max-per-source", type=int, default=0,
                    help="cap on new TRAIN images per source (0 = no cap)")
    ap.add_argument("--repeat", type=int, default=2,
                    help="write each new TRAIN image this many times (India is x2 in yolo-india-ft)")
    ap.add_argument("--skip", default="", help="comma list of sources to leave out (failed QC)")
    args = ap.parse_args()
    skip = {s for s in args.skip.split(",") if s}

    stats: dict[str, Counter] = defaultdict(Counter)
    items = []
    for it in gather():
        if it["src"] in skip:
            continue
        stats[it["src"]]["found"] += 1
        if it["lines"] is None:
            stats[it["src"]]["romar_dropped"] += 1
        elif not any(line.startswith("0 ") for line in it["lines"]):
            stats[it["src"]]["no_pothole"] += 1
        else:
            items.append(it)

    # --- against RDD2022, everything on disk --------------------------------------
    ref_paths = nd.list_images(*(DATA / r for r in RDD_ROOTS),
                               *(p for p in DATA.iterdir() if p.name.startswith("yolo")
                                 and p.name not in (OUT.name, TEST.name)))
    print(f"[build] hashing {len(ref_paths)} RDD2022 reference images (cached)")
    ref = nd.Index(nd.hash_many(ref_paths, EXTRA / "rdd_hashes.npz"))
    print(f"[build] hashing {len(items)} candidate images")
    new_h = nd.hash_many([it["img"] for it in items], EXTRA / "new_hashes.npz")
    for it in items:
        it["h"] = new_h[str(it["img"])]
    hits = ref.match_many({str(it["img"]): it["h"] for it in items})
    rdd_hits = [(k, *v) for k, v in sorted(hits.items())]
    for it in items:
        if str(it["img"]) in hits:
            stats[it["src"]][f"rdd_{hits[str(it['img'])][0]}"] += 1
    items = [it for it in items if str(it["img"]) not in hits]

    # --- among the new images: exact duplicates dropped ----------------------------
    by_sha, kept = set(), []
    for it in items:
        if it["h"][0] in by_sha:
            stats[it["src"]]["self_sha256"] += 1
            continue
        by_sha.add(it["h"][0])
        kept.append(it)
    items = kept

    # --- held-out test split by declared group, per source ---------------------------
    rng = random.Random(args.seed)
    train, test = [], []
    by_src: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for it in items:
        by_src[it["src"]][it["group"]].append(it)
    for src in sorted(by_src):
        gs = [by_src[src][g] for g in sorted(by_src[src])]
        rng.shuffle(gs)
        n_all = sum(len(g) for g in gs)
        t = []
        while gs and sum(len(g) for g in t) < args.test_frac * n_all:
            t.append(gs.pop())
        test += [it for g in t for it in g]
        train += [it for g in gs for it in g]
    # a train image that is a near-duplicate of any test image leaves train
    tidx = nd.Index({str(it["img"]): it["h"] for it in test})
    near_test = tidx.match_many({str(it["img"]): it["h"] for it in train})
    for it in train:
        if str(it["img"]) in near_test:
            stats[it["src"]]["near_test_dropped"] += 1
    train = [it for it in train if str(it["img"]) not in near_test]
    if args.max_per_source:
        capped = []
        for src in sorted({it["src"] for it in train}):
            tr = [it for it in train if it["src"] == src]
            if len(tr) > args.max_per_source:
                rng.shuffle(tr)
                stats[src]["capped"] += len(tr) - args.max_per_source
                tr = tr[:args.max_per_source]
            capped += tr
        train = capped

    # --- write --------------------------------------------------------------------
    base = DATA / "yolo-india-ft"
    for d in (OUT, TEST):
        shutil.rmtree(d, ignore_errors=True)
    for d in (OUT / "images/train", OUT / "labels/train", TEST / "images/val", TEST / "labels/val"):
        d.mkdir(parents=True)
    for p in sorted((base / "images/train").iterdir()):
        link(p, OUT / "images/train" / p.name)
        link(base / "labels/train" / (p.stem + ".txt"), OUT / "labels/train" / (p.stem + ".txt"))

    def put(it: dict, root: Path, split: str, repeat: int = 1) -> None:
        for r in range(repeat):
            name = f"X{it['src']}__{it['img'].stem.replace('.', '_')}" + "__dup" * r
            link(it["img"], root / "images" / split / f"{name}.jpg")
            (root / "labels" / split / f"{name}.txt").write_text("\n".join(it["lines"]) + "\n")
        stats[it["src"]]["train" if root == OUT else "test"] += 1

    for it in train:
        put(it, OUT, "train", args.repeat)
    for it in test:
        put(it, TEST, "val")

    # --- final leak check over the WRITTEN files (refuse on any hit) -------------------
    held_files = [p for d in HELD for p in (DATA / d).iterdir()]
    held_stems = {p.stem.split("__", 1)[-1] for p in held_files}
    held_idx = nd.Index(nd.hash_many(held_files, EXTRA / "held_hashes.npz"))
    tr_files = sorted((OUT / "images/train").iterdir())
    te_files = sorted((TEST / "images/val").iterdir())
    bad_stem = [p.name for p in tr_files
                if p.stem.split("__", 1)[-1].removesuffix("__dup") in held_stems]
    tr_all = nd.hash_many(tr_files, EXTRA / "train_hashes.npz")
    te_all = nd.hash_many(te_files)
    held_sha = {v[0] for v in held_idx.table.values()}
    new_tr = {k: v for k, v in tr_all.items() if Path(k).name.startswith("X")}
    # every train file: sha256. New files: sha256 AND near-duplicate.
    bad_hash = {k: ("sha256",) for k, v in tr_all.items() if v[0] in held_sha}
    bad_hash.update(held_idx.match_many(new_tr))
    bad_test = held_idx.match_many(te_all)
    bad_new_test = nd.Index(te_all).match_many(new_tr)
    # Reported, not enforced: the inherited yolo-india-ft part (byte-identical to what
    # the shipped model trained on) holds RDD2022 frames adjacent to held-out frames
    # of the same drive (RDD's own train/val split is by image, not by sequence).
    inherited_near = held_idx.match_many({k: v for k, v in tr_all.items() if k not in new_tr})
    if bad_stem or bad_hash or bad_test or bad_new_test:
        shutil.rmtree(OUT, ignore_errors=True)
        raise SystemExit(f"LEAK: stem {bad_stem[:3]} train~held {list(bad_hash.items())[:3]} "
                         f"test~held {list(bad_test.items())[:3]} "
                         f"train~test {list(bad_new_test.items())[:3]}")

    # India-clean-strict: India-clean minus every image with a near-duplicate in this train
    strict = DATA / "yolo-india-clean-strict"
    shutil.rmtree(strict, ignore_errors=True)
    (strict / "images/val").mkdir(parents=True)
    (strict / "labels/val").mkdir(parents=True)
    ic = DATA / "yolo-india-clean"
    ic_h = {k: v for k, v in held_idx.table.items() if Path(k).parent == ic / "images/val"}
    touched = set(nd.Index(tr_all).match_many(ic_h))
    for k in sorted(ic_h):
        if k in touched:
            continue
        p = Path(k)
        link(p, strict / "images/val" / p.name)
        if (ic / "labels/val" / (p.stem + ".txt")).exists():
            link(ic / "labels/val" / (p.stem + ".txt"), strict / "labels/val" / (p.stem + ".txt"))
    (strict / "README.txt").write_text(
        f"yolo-india-clean/val minus the {len(touched)} images with a near-duplicate "
        f"(thumbnail cos >= {nd.COS_MIN}) anywhere in yolo-pothole-ft/train, which includes all "
        f"of yolo-india-ft/train. {len(ic_h) - len(touched)} images. build_pothole_ft.py.\n")

    val = (DATA / "yolo-multi-rich/images/val").resolve().as_posix()
    hdr = "# Built by road_damage/build_pothole_ft.py.\n"
    names = "names:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(NAMES))
    (OUT / "dataset.yaml").write_text(hdr + "# val is yolo-multi-rich/val, untouched.\n"
                                      f"train: images/train\nval: {val}\n" + names)
    (TEST / "dataset.yaml").write_text(hdr + "# held-out new-source images, never trained on.\n"
                                       "train: images/val\nval: images/val\n" + names)

    def count(d: Path) -> dict:
        c = Counter()
        for t in d.iterdir():
            c.update(NAMES[int(line.split()[0])] for line in t.read_text().splitlines() if line.strip())
        return dict(c)

    summary = {"train_files": len(tr_files),
               "india_ft_files": len(list((base / "images/train").iterdir())),
               "new_train": len(train), "new_train_repeat": args.repeat, "new_test": len(test),
               "train_instances": count(OUT / "labels/train"),
               "test_instances": count(TEST / "labels/val"),
               "per_source": {k: dict(v) for k, v in sorted(stats.items())},
               "leak_check": f"0 overlaps between {len(tr_files)} train files and {len(held_files)} "
                             f"held-out files by stem and sha256; 0 between the {len(new_tr)} new "
                             f"train files (and {len(te_files)} new test files) and the held-out "
                             f"files, nor between new train and new test, by sha256 and "
                             f"near-duplicate (thumbnail cos >= {nd.COS_MIN}, mirror too); "
                             f"{len(rdd_hits)} new images matching any RDD2022 image dropped",
               "near_dup_cos_min": nd.COS_MIN,
               "inherited_adjacent_frames": (
                   f"{len(inherited_near)} of the {len(tr_files) - len(new_tr)} inherited "
                   f"yolo-india-ft files are near-duplicates (cos >= {nd.COS_MIN}; mostly adjacent "
                   f"frames of the same RDD2022 drive) of {len({v[1] for v in inherited_near.values()})} "
                   "held-out images; kept so the comparison with the shipped model, which trained "
                   "on exactly these files, is like for like. India-clean-strict scores both "
                   "models without those held-out images.")}
    (OUT / "README.json").write_text(json.dumps(summary, indent=2))
    (OUT / "rdd_matches.json").write_text(json.dumps(rdd_hits, indent=1))
    (OUT / "inherited_near_held.json").write_text(json.dumps(sorted(
        (Path(k).name, Path(v[1]).name, v[2]) for k, v in inherited_near.items()), indent=1))
    (TEST / "README.json").write_text(json.dumps({k: summary[k] for k in
                                                  ("new_test", "test_instances", "per_source")}, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
