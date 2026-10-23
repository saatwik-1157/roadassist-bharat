"""Run raksha_colab_train.ipynb on this laptop, cell by cell, unchanged.

The notebook reads its settings from globals() when they are set, so the Colab
code runs here as written against a small bundle. It is a smoke test of the
notebook, not a training run: the numbers it reports mean nothing.

Usage (from ai/colab, with the GPU venv):
  ../.venv-gpu/Scripts/python build_colab_bundle.py --limit 48 --out ../runs/colab-smoke/bundle.zip
  ../.venv-gpu/Scripts/python run_notebook_local.py
"""
import json
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SMOKE = HERE.parent / "runs" / "colab-smoke"


def main() -> None:
    nb = json.loads((HERE / "raksha_colab_train.ipynb").read_text(encoding="utf-8"))
    keep = "--keep" in sys.argv  # rerun on the same state: the resume and skip paths
    if not keep:
        shutil.rmtree(SMOKE / "work", ignore_errors=True)
        shutil.rmtree(SMOKE / "runs", ignore_errors=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ns = {
        "__name__": "__main__",
        "DRIVE_DIR": str(SMOKE),
        "DATA_ZIP": str(SMOKE / "bundle.zip"),
        "WORK_DIR": str(SMOKE / "work"),
        "OUT_DIR": str(SMOKE / "runs"),
        "EPOCHS": int(args[0]) if args else 2,
        "BATCH": 8,
        # Worker processes on Windows each reload torch and CUDA; with little free RAM one
        # dies ("DataLoader worker exited unexpectedly"). Load in-process for the smoke test.
        "WORKERS": 0,
    }
    started = time.time()
    for i, cell in enumerate(nb["cells"]):
        if cell["cell_type"] != "code":
            continue
        print(f"=== cell {i} ({time.time() - started:.0f}s)", flush=True)
        exec(compile("".join(cell["source"]), f"<cell {i}>", "exec"), ns)
    print(f"=== all cells done in {time.time() - started:.0f}s", flush=True)


# Windows starts dataloader workers by re-importing this file; without the guard
# each worker would run the whole notebook again and training never starts.
if __name__ == "__main__":
    main()
