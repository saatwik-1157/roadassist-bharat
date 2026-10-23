"""Write raksha_colab_train.ipynb from the cells below.

The notebook is generated rather than hand-edited so its JSON is always valid
and the code lives in one reviewable place. run_notebook_local.py executes the
same cells on this laptop with a tiny bundle, which is how the notebook is
tested before it costs a Colab session.

Usage (from ai/colab):  python make_notebook.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

INTRO = """\
# RAKSHA road-damage detector: YOLO11s India fine-tune on a Colab GPU

Fine-tunes **YOLO11s** (`yolo11s-multi-rich-gpu`, rich val mAP50 0.578) on the
leak-checked India set (8,373 images) and scores it beside the shipped edge model
`yolo11n-india-ft-gpu` (rich 0.586, India-clean 0.500) on the same two held-out splits.

**Before you run**
1. Put `raksha_colab_data.zip` in Google Drive at `MyDrive/raksha-colab/`
   (build it with `ai/colab/build_colab_bundle.py`).
2. *Runtime → Change runtime type → T4 GPU*.
3. *Runtime → Run all*. Allow Drive access when asked.

Checkpoints, results and the report are written to `MyDrive/raksha-colab/runs/`, so a
disconnected session loses at most 5 epochs: run all again and it resumes.
"""

CONFIG = '''\
# Settings. run_notebook_local.py sets these first to trial the notebook on a laptop.
import os, sys
g = globals()
DRIVE_DIR = g.get("DRIVE_DIR", "/content/drive/MyDrive/raksha-colab")
DATA_ZIP  = g.get("DATA_ZIP", f"{DRIVE_DIR}/raksha_colab_data.zip")
WORK_DIR  = g.get("WORK_DIR", "/content/raksha")      # fast local disk for the images
OUT_DIR   = g.get("OUT_DIR", f"{DRIVE_DIR}/runs")     # on Drive, so checkpoints survive a disconnect
RUN_NAME  = g.get("RUN_NAME", "yolo11s-india-ft-colab")
EPOCHS    = g.get("EPOCHS", 20)    # matches the shipped nano's India fine-tune
BATCH     = g.get("BATCH", 32)     # a T4 has 15 GB; the laptop's 4 GB needed 8 for YOLO11s
IMGSZ     = g.get("IMGSZ", 640)
DEVICE    = g.get("DEVICE", 0)
WORKERS   = g.get("WORKERS", 2)    # Colab gives 2 CPU cores
ULTRALYTICS = "8.4.126"            # the version every local run used
IN_COLAB = "google.colab" in sys.modules
print(f"run {RUN_NAME}: {EPOCHS} epochs, batch {BATCH}, imgsz {IMGSZ}, colab={IN_COLAB}")
'''

SETUP = '''\
# Drive, the pinned ultralytics, and a GPU check.
import subprocess
if IN_COLAB:
    from google.colab import drive
    drive.mount("/content/drive")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", f"ultralytics=={ULTRALYTICS}"], check=True)

import torch, ultralytics
print(f"torch {torch.__version__}, ultralytics {ultralytics.__version__}")
if not torch.cuda.is_available():
    raise SystemExit("No GPU. Runtime > Change runtime type > T4 GPU, then Run all again.")
print("GPU:", torch.cuda.get_device_name(0))
if ultralytics.__version__ != ULTRALYTICS:
    print(f"warning: ultralytics {ultralytics.__version__}, the local runs used {ULTRALYTICS}")
'''

UNPACK = '''\
# Unpack the bundle once, then check it is the bundle the manifest describes.
import hashlib, json, zipfile
from pathlib import Path

work = Path(WORK_DIR)
marker = work / ".unpacked"
if not Path(DATA_ZIP).exists():
    raise SystemExit(f"{DATA_ZIP} not found. Upload raksha_colab_data.zip to MyDrive/raksha-colab/.")
if not marker.exists():
    work.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DATA_ZIP) as zf:
        zf.extractall(work)
    marker.write_text(DATA_ZIP)
manifest = json.loads((work / "manifest.json").read_text())

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()

for split, want in manifest["splits"].items():
    got_i = len(list((work / "data" / split / "images").iterdir()))
    got_l = len(list((work / "data" / split / "labels").glob("*.txt")))
    assert (got_i, got_l) == (want["images"], want["labels"]), f"{split}: {got_i}/{got_l} files, manifest {want}"
    print(f"{split:12s} {got_i:5d} images  {got_l:5d} labels  ok")
for name, want in manifest["weights"].items():
    assert sha256(work / "weights" / name) == want["sha256"], f"{name}: sha256 mismatch"
    print(f"weights      {name}  sha256 ok")
'''

YAMLS = '''\
# Dataset YAMLs with this machine's paths. Same 4 class ids as every RAKSHA model.
names = {int(k): v for k, v in manifest["names"].items()}
names_block = "names:\\n" + "".join(f"  {i}: {n}\\n" for i, n in sorted(names.items()))

def write_yaml(name, train, val):
    p = work / name
    p.write_text(f"path: {work.as_posix()}\\ntrain: {train}\\nval: {val}\\n{names_block}")
    return str(p)

TRAIN_YAML = write_yaml("train.yaml", "data/train/images", "data/val/images")
RICH_YAML = write_yaml("rich.yaml", "data/val/images", "data/val/images")
INDIA_YAML = write_yaml("india-clean.yaml", "data/india-clean/images", "data/india-clean/images")
print(Path(TRAIN_YAML).read_text())
'''

TRAIN = '''\
# Train, or resume an interrupted run from its last checkpoint on Drive.
import csv
from ultralytics import YOLO

run_dir = Path(OUT_DIR) / RUN_NAME
last = run_dir / "weights" / "last.pt"
# ultralytics stamps epoch -1 into last.pt when a run completes, so only an
# interrupted run is resumed; a finished one goes straight to evaluation.
ckpt_epoch = torch.load(last, map_location="cpu", weights_only=False).get("epoch", -1) if last.exists() else None

if ckpt_epoch == -1:
    print(f"{RUN_NAME} already finished; skipping to evaluation "
          f"(to train again, set RUN_NAME to a new name)", flush=True)
elif ckpt_epoch is not None:
    print(f"resuming {RUN_NAME} after epoch {ckpt_epoch + 1}", flush=True)
    YOLO(str(last)).train(resume=True)
else:
    model = YOLO(str(work / "weights" / "yolo11s-multi-rich-gpu.pt"))
    model.train(
        data=TRAIN_YAML, epochs=EPOCHS, imgsz=IMGSZ, batch=BATCH, device=DEVICE, workers=WORKERS,
        project=OUT_DIR, name=RUN_NAME, exist_ok=True, save_period=5, patience=25, seed=0,
        # the schedule of the shipped nano's India fine-tune (ai/README.md, "The runs")
        optimizer="AdamW", lr0=0.0005, warmup_epochs=1.0, cos_lr=True,
        # the augmentation of ai/road_damage/train.py
        mosaic=1.0, close_mosaic=10, mixup=0.1, copy_paste=0.1,
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4, degrees=0.0, translate=0.1, scale=0.5, fliplr=0.5,
        plots=True, verbose=True,
    )
BEST = run_dir / "weights" / "best.pt"
assert BEST.exists(), f"no {BEST}: training did not produce a checkpoint"
'''

EVALUATE = '''\
# Score every model on the same held-out splits, as ai/road_damage/eval_compare.py does.
# india-clean labels only pothole and road_damage; ultralytics averages AP over the
# classes that have ground truth, so the other two classes do not touch it.
MODELS = {
    "yolo11s-india-ft-colab (new)": (str(BEST), [640, 416]),
    "yolo11n-india-ft-gpu (shipped)": (str(work / "weights" / "yolo11n-india-ft-gpu.pt"), [640, 416]),
    "yolo11s-multi-rich-gpu (start)": (str(work / "weights" / "yolo11s-multi-rich-gpu.pt"), [640]),
}
SPLITS = {"rich": RICH_YAML, "india-clean": INDIA_YAML}

def score(model, data, imgsz, name):
    m = model.val(data=data, imgsz=imgsz, device=DEVICE, batch=16, workers=WORKERS, plots=True,
                  project=str(run_dir / "eval"), name=name, exist_ok=True, verbose=False)
    b = m.box
    per = {}
    for j, c in enumerate(b.ap_class_index):
        p, r, ap50, ap = b.class_result(j)
        per[m.names[int(c)]] = {"precision": round(float(p), 4), "recall": round(float(r), 4),
                                "mAP50": round(float(ap50), 4), "mAP50-95": round(float(ap), 4)}
    return {"precision": round(float(b.mp), 4), "recall": round(float(b.mr), 4),
            "mAP50": round(float(b.map50), 4), "mAP50-95": round(float(b.map), 4),
            "speed_ms": round(float(m.speed["inference"]), 2), "per_class": per}

compare = {"run": RUN_NAME, "epochs_requested": EPOCHS, "gpu": torch.cuda.get_device_name(0),
           "ultralytics": ultralytics.__version__, "manifest": manifest, "models": {}}
for label, (path, sizes) in MODELS.items():
    model = YOLO(path)
    entry = {"weights": Path(path).name, "mb": round(Path(path).stat().st_size / 2**20, 1), "results": {}}
    for imgsz in sizes:
        for split, data in SPLITS.items():
            key = f"{split}@{imgsz}"
            entry["results"][key] = r = score(model, data, imgsz, f"{label.split()[0]}-{key}")
            print(f"{label:32s} {key:16s} P {r['precision']:.3f} R {r['recall']:.3f} "
                  f"mAP50 {r['mAP50']:.3f} mAP50-95 {r['mAP50-95']:.3f}")
    compare["models"][label] = entry
(run_dir / "compare.json").write_text(json.dumps(compare, indent=2))
'''

REPORT = '''\
# Write REPORT.md beside the weights.
import datetime
with open(run_dir / "results.csv") as f:
    rows = list(csv.DictReader(f))
rows = [{k.strip(): v for k, v in r.items()} for r in rows]
best_row = max(rows, key=lambda r: float(r["metrics/mAP50(B)"]))
minutes = float(rows[-1].get("time", 0) or 0) / 60

new_e = compare["models"]["yolo11s-india-ft-colab (new)"]
old_e = compare["models"]["yolo11n-india-ft-gpu (shipped)"]
new, old = new_e["results"], old_e["results"]
d_rich = new["rich@640"]["mAP50"] - old["rich@640"]["mAP50"]
d_india = new["india-clean@640"]["mAP50"] - old["india-clean@640"]["mAP50"]
if d_rich > 0 and d_india > 0:
    verdict = (f"The YOLO11s fine-tune beats the shipped nano on both held-out splits "
               f"(rich {d_rich:+.3f}, India-clean {d_india:+.3f} mAP50). It is "
               f"{new_e['mb'] / old_e['mb']:.1f}x the size ({new_e['mb']} MB against {old_e['mb']} MB), "
               f"so it suits the server path; the nano stays the on-device model.")
else:
    verdict = (f"The YOLO11s fine-tune does not beat the shipped nano on both held-out splits "
               f"(rich {d_rich:+.3f}, India-clean {d_india:+.3f} mAP50). Keep yolo11n-india-ft-gpu.")

lines = [f"# {RUN_NAME}: report", "",
         f"Generated {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M} UTC on "
         f"{compare['gpu']}, ultralytics {compare['ultralytics']}.", "",
         "## Verdict", "", verdict, "",
         "## Training", "",
         f"- Start: `yolo11s-multi-rich-gpu` (YOLO11s, 4 classes)",
         f"- Data: India fine-tune set, {manifest['splits']['train']['images']} images; "
         f"validated each epoch on the rich split ({manifest['splits']['val']['images']} images)",
         f"- AdamW lr0 0.0005, warmup 1, cosine LR, batch {BATCH}, imgsz {IMGSZ}, seed 0",
         f"- Epochs run: {len(rows)} of {EPOCHS}; best epoch {int(float(best_row['epoch']))} "
         f"(rich mAP50 {float(best_row['metrics/mAP50(B)']):.3f}); wall clock {minutes:.0f} min", "",
         "## Held-out comparison (same splits for every model)", "",
         "| Model | MB | Split | Precision | Recall | mAP50 | mAP50-95 | ms/img |",
         "|---|---|---|---|---|---|---|---|"]
for label, e in compare["models"].items():
    for key, r in e["results"].items():
        lines.append(f"| {label} | {e['mb']} | {key} | {r['precision']:.3f} | {r['recall']:.3f} | "
                     f"**{r['mAP50']:.3f}** | {r['mAP50-95']:.3f} | {r['speed_ms']} |")
lines += ["", "## Per class, rich@640", "", "| Model | " + " | ".join(names.values()) + " |",
          "|---|" + "---|" * len(names)]
for label, e in compare["models"].items():
    pc = e["results"]["rich@640"]["per_class"]
    lines.append(f"| {label} | " + " | ".join(f"{pc[n]['mAP50']:.3f}" if n in pc else "-" for n in names.values()) + " |")
lines += ["", "## Notes", "",
          f"- `rich`: {manifest['splits']['val']['images']} images from 4 countries, all 4 classes. "
          f"`india-clean`: {manifest['splits']['india-clean']['images']} India images that appear in "
          "no training split; only pothole and road_damage are labelled there.",
          f"- ms/img is GPU inference time on {compare['gpu']}, not the phone or browser.",
          "- To ship a model, export ONNX on the laptop with `ai/road_damage/export_onnx.py` and run "
          "`onnx_parity.py`, as in ai/README.md.", ""]
(run_dir / "REPORT.md").write_text("\\n".join(lines))
print("\\n".join(lines))
'''

PACKAGE = '''\
# One zip of everything worth keeping: weights, curves, comparison and report.
import shutil
keep = ["weights/best.pt", "weights/last.pt", "results.csv", "args.yaml", "compare.json", "REPORT.md",
        "results.png", "confusion_matrix.png", "BoxPR_curve.png"]
pack = run_dir / f"{RUN_NAME}-results"
shutil.rmtree(pack, ignore_errors=True)
for rel in keep:
    src = run_dir / rel
    if src.exists():
        (pack / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, pack / rel)
archive = shutil.make_archive(str(run_dir / f"{RUN_NAME}-results"), "zip", pack)
shutil.rmtree(pack)
print(f"saved {archive}")
if IN_COLAB:
    from google.colab import files
    files.download(archive)
'''

CELLS = [("markdown", INTRO), ("code", CONFIG), ("code", SETUP), ("code", UNPACK), ("code", YAMLS),
         ("code", TRAIN), ("code", EVALUATE), ("code", REPORT), ("code", PACKAGE)]


def main() -> None:
    nb = {"nbformat": 4, "nbformat_minor": 5,
          "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                       "kernelspec": {"name": "python3", "display_name": "Python 3"},
                       "language_info": {"name": "python"}},
          "cells": []}
    for i, (kind, src) in enumerate(CELLS):
        cell = {"cell_type": kind, "id": f"cell-{i}", "metadata": {},
                "source": src.splitlines(keepends=True)}
        if kind == "code":
            cell.update(execution_count=None, outputs=[])
        nb["cells"].append(cell)
    out = HERE / "raksha_colab_train.ipynb"
    out.write_text(json.dumps(nb, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
