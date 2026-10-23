# RAKSHA on Google Colab: YOLO11s India fine-tune

The laptop's RTX 3050 has 4 GB, which held YOLO11s to batch 8. A free Colab T4 has
15 GB. This folder runs the one fine-tune the laptop has not done: YOLO11s
(`yolo11s-multi-rich-gpu`, rich mAP50 0.578) on the leak-checked India set. It then
scores the result beside the shipped edge model (`yolo11n-india-ft-gpu`: rich 0.586,
India-clean 0.500) on the same held-out splits, and writes a report.

## Run it

1. **Build the data bundle** (from `ai/colab`, about 0.6 GB):
   ```bash
   ../.venv-gpu/Scripts/python build_colab_bundle.py
   ```
   This writes `ai/runs/raksha_colab_data.zip`.
2. **Upload** that zip to Google Drive as `MyDrive/raksha-colab/raksha_colab_data.zip`.
3. **Open** `raksha_colab_train.ipynb` in Colab: *File → Upload notebook*.
4. **Choose a GPU:** *Runtime → Change runtime type → T4 GPU*.
5. **Run:** *Runtime → Run all*, and allow Drive access when asked.

Expect roughly 1.5–2 hours for 20 epochs on a T4. The last cell downloads
`yolo11s-india-ft-colab-results.zip`, which holds:

- `REPORT.md`: the verdict, training summary, held-out comparison and per-class table
- `compare.json`: every number in the report, machine-readable
- `weights/best.pt`, `weights/last.pt`, `results.csv`, and the curves and confusion matrix

### If Colab disconnects

Checkpoints are written to Drive (`MyDrive/raksha-colab/runs/`) every 5 epochs, plus
`last.pt` every epoch. Reconnect, choose the T4 again and *Run all*. An interrupted run
resumes from its last epoch, and a finished run skips straight to evaluation.

## Files

| File | What it does |
|---|---|
| `build_colab_bundle.py` | Packs the three splits and both weights, with a manifest the notebook verifies (file counts and sha256) |
| `make_notebook.py` | Generates `raksha_colab_train.ipynb`. Edit the cells here, not in the notebook |
| `raksha_colab_train.ipynb` | The Colab notebook |
| `run_notebook_local.py` | Runs the notebook unchanged on the laptop against a small bundle (a smoke test, so its numbers mean nothing) |
| `interrupt_test.py` | Kills a local run after epoch 1, reruns it, and asserts that it resumed and finished |

To test a change before spending a Colab session:

```bash
../.venv-gpu/Scripts/python make_notebook.py
../.venv-gpu/Scripts/python build_colab_bundle.py --limit 48 --out ../runs/colab-smoke/bundle.zip
../.venv-gpu/Scripts/python run_notebook_local.py 2
../.venv-gpu/Scripts/python interrupt_test.py
```

## What the splits are

The same splits as `ai/road_damage/eval_compare.py`:

- **rich:** `yolo-multi-rich` val, 800 images from India, Czech, Japan and the US, all 4 classes.
- **india-clean:** 392 India images that appear in no training split. Only pothole and
  road_damage are labelled there, and ultralytics averages AP over the classes with
  ground truth.

The training set is `yolo-india-ft` train (8,373 images, 0 overlaps with the held-out
files by stem or sha256; see its `README.txt`). Training settings match the shipped
nano's India fine-tune: AdamW, lr0 0.0005, warmup 1, cosine LR, 20 epochs, seed 0, and
the augmentation of `ai/road_damage/train.py`.

To ship a winning model, export ONNX on the laptop with `export_onnx.py`, check it with
`onnx_parity.py`, and follow the web and Android steps in `ai/README.md`.
