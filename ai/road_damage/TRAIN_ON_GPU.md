# Finishing the RAKSHA detector on a GPU

The checked-in detector is **undertrained, not converged**. Its best run stopped
at epoch 13 of a requested 100 with mAP50 still climbing steeply — 0.443, 0.464,
0.472 across its last three epochs, no plateau. `results.csv` in
`ai/runs/yolo11s-multi-rich/` is the evidence.

| | precision | recall | mAP50 | mAP50-95 |
|---|---|---|---|---|
| `yolo11s-multi-rich`, epoch 13 — **the baseline to beat** | 0.535 | 0.450 | **0.472** | **0.226** |
| `yolo11n-multi-edge`, epoch 18 | — | — | 0.288 | 0.117 |
| `yolo11s-multi`, epoch 13 | — | — | 0.290 | 0.119 |

The jump from `multi` (0.290) to `multi-rich` (0.472) came from the richer
dataset at the *same* epoch count, not from more training. Use `yolo-multi-rich`.

## Why not CPU

Measured on the original machine: **27.9 min/epoch** (13 epochs took 6.04 h),
and only when nothing else was running. The 87 remaining epochs are ~40 hours.

A single overnight attempt was made and is worth recording so nobody repeats it:
two runs were killed by memory pressure, one epoch completed, and that epoch
scored **mAP50 0.364 — a 23% regression against the 0.472 baseline**. That is
not a bug. It is what a truncated warm restart looks like: `lr0=0.01` with
warmup knocks converged weights off their optimum, and climbing back takes many
epochs. A partial run is worse than no run.

A free Colab or Kaggle T4 does the remaining epochs in roughly 1–2 hours.

## Why you cannot `--resume`

Ultralytics strips the optimizer out of the weights it writes when a run *ends*.
`last.pt` here has `epoch: -1` and no optimizer state, so the epoch counter and
LR schedule cannot continue. `train.py --resume` now detects this and refuses
with an explanation rather than silently restarting at epoch 1, which is what
ultralytics does on its own with a single easily-missed WARNING line.

You are therefore **warm-starting**: the learned weights carry over, the
schedule does not. Give it enough epochs to get back past 0.472 and beyond —
that is the whole point of using a GPU.

## Colab / Kaggle

Runtime → Change runtime type → **T4 GPU**. Then:

```python
# 1. Get the repo and the dataset. The dataset is ~4000 images; if the repo does
#    not carry it, upload ai/data/yolo-multi-rich/ to Drive and point at it.
!git clone <your-repo-url> roadassist
%cd roadassist/ai/road_damage

# 2. Ultralytics brings its own torch on Colab; do not install a CPU wheel here.
!pip install -q ultralytics

# 3. Keep outputs inside the repo. Ultralytics stores a global runs_dir that has
#    bitten this project before — it pointed at a machine that no longer exists.
from ultralytics.utils import SETTINGS
from pathlib import Path
ai = Path.cwd().parent
SETTINGS.update({"runs_dir": str(ai / "runs"), "datasets_dir": str(ai / "data")})

# 4. Warm-start from the 13-epoch weights and let the schedule actually finish.
!python train.py \
    --data ../data/yolo-multi-rich/dataset.yaml \
    --model ../runs/yolo11s-multi-rich/weights/best.pt \
    --name yolo11s-multi-rich-gpu \
    --imgsz 512 --batch 16 --epochs 100 --hours 3 \
    --project ../runs
```

`--hours` is a hard wall-clock cap; the run always stops and saves a `best.pt`.
`device` is pinned to CPU inside `train.py` — **change that line to `"0"` for the
GPU**, or the T4 sits idle.

## Afterwards — do not skip this

1. **Compare honestly.** New `results.csv` against the 0.472 / 0.226 baseline.
   If it did not beat that, say so; a worse model is not an improvement.
2. **Re-export the ONNX.** `serve.py` loads
   `runs/yolo11s-multi-rich/weights/best.onnx`. Nothing you train changes what is
   served until you export and repoint it.
   ```python
   from ultralytics import YOLO
   YOLO("../runs/yolo11s-multi-rich-gpu/weights/best.pt").export(format="onnx", imgsz=512)
   ```
3. **Re-measure the claims.** `app/docs/CLAIMS-AUDIT.md` and
   `docs/verification/CLAIM_VERIFICATION_FINAL.md` both rest on "a trained
   detector with measured metrics". New training means new numbers, and every
   place quoting them has to change with it.
4. **Say which model is served.** Both docs say "YOLO11n". A yolo11n run does
   exist, so that is not false — but `serve.py` serves **yolo11s**. Make the docs
   name the one actually deployed.
