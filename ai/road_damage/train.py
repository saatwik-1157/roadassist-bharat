"""Serious CPU training run for the RAKSHA road-damage detector.

Upgrades the checked-in smoke baseline (yolo11n, 480px, 800 imgs, 3 epochs) to a
larger model on the full mapped RDD2022-India set, tuned for CPU:

  * model:   yolo11s (≈3.4× the params of yolo11n) — more capacity
  * data:    full mapped set (~3,223 imgs) instead of the 800-image smoke subset
  * imgsz:   640 — small potholes survive downsampling better
  * threads: torch pinned to $RAKSHA_THREADS (default 8); on this box that is a
             ~4× CPU speedup over torch's 1-thread default
  * schedule: cosine LR, warmup, strong augmentation, early stopping (patience)
  * budget:  a hard wall-clock cap (`time` hours) so the run always converges to
             a saved best.pt regardless of how slow the CPU is

Everything measured (metrics, epoch time) is real — no fabricated numbers.

Usage:
  ../.venv/Scripts/python train.py --model yolo11s.pt --imgsz 640 \
      --data ../data/yolo-full/dataset.yaml --epochs 100 --hours 6 --name yolo11s-full
"""
from __future__ import annotations

import argparse
import os


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../data/yolo-full/dataset.yaml")
    ap.add_argument("--model", default="yolo11s.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--hours", type=float, default=6.0, help="hard wall-clock cap")
    ap.add_argument("--patience", type=int, default=25)
    ap.add_argument("--threads", type=int, default=int(os.environ.get("RAKSHA_THREADS", "8")))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--project", default="../runs")
    ap.add_argument("--name", default="yolo11s-full")
    ap.add_argument("--fallback", default="yolo11n.pt",
                    help="used if the requested model can't be fetched offline")
    ap.add_argument("--resume", action="store_true",
                    help="true resume of <project>/<name>/weights/last.pt: epoch counter, "
                         "optimizer state and LR schedule all continue. Only possible on a "
                         "checkpoint from an INTERRUPTED run. Ultralytics strips the optimizer "
                         "out when a run ENDS, so a finished run cannot be resumed — warm-start "
                         "from its weights with --model <best.pt> instead, and read the note "
                         "this flag prints before you rely on that.")
    args = ap.parse_args()

    # Pin CPU threads BEFORE importing torch-heavy code so the pools size right.
    os.environ.setdefault("OMP_NUM_THREADS", str(args.threads))
    import torch
    torch.set_num_threads(args.threads)

    from ultralytics import YOLO

    ckpt = os.path.join(args.project, args.name, "weights", "last.pt")
    if args.resume:
        if not os.path.exists(ckpt):
            raise SystemExit(f"[train] --resume needs {ckpt}, which does not exist")
        # Refuse loudly rather than let ultralytics silently restart.
        #
        # Given a checkpoint with no optimizer state it prints one WARNING line
        # and begins again at epoch 1. That line is trivial to miss in a training
        # log, and the cost is a whole run: you believe you are continuing while
        # the LR schedule is actually being re-rolled from scratch.
        state = torch.load(ckpt, map_location="cpu", weights_only=False)
        if state.get("optimizer") is None or state.get("epoch", -1) < 0:
            best = os.path.join(os.path.dirname(ckpt), "best.pt")
            raise SystemExit("\n".join([
                f"[train] {ckpt} is a FINISHED checkpoint "
                f"(epoch={state.get('epoch')}, optimizer stripped) and cannot be resumed.",
                f"        Warm-start from its weights instead:  --model {best}",
                "        That restarts the LR schedule. Measured on this project: one warm-start",
                "        epoch took mAP50 from 0.472 down to 0.364. It needs many epochs to climb",
                "        back past where it began - give it a real budget, or a GPU.",
            ]))
        print(f"[train] resuming {ckpt} from epoch {state.get('epoch')}")
        model = YOLO(ckpt)
    else:
        try:
            model = YOLO(args.model)
        except Exception as e:  # offline / download blocked → honest fallback
            print(f"[train] could not load {args.model} ({e}); falling back to {args.fallback}")
            model = YOLO(args.fallback)

    print(f"[train] device=cpu threads={args.threads} model={args.model} imgsz={args.imgsz} "
          f"epochs≤{args.epochs} cap={args.hours}h data={args.data}")

    model.train(
        data=args.data,
        resume=args.resume,
        device="cpu",
        imgsz=args.imgsz,
        epochs=args.epochs,
        time=args.hours,          # hard cap; ultralytics stops + saves best
        patience=args.patience,   # early stop on plateau
        batch=args.batch,
        workers=args.workers,
        project=args.project,
        name=args.name,
        exist_ok=True,
        # schedule
        optimizer="auto",
        cos_lr=True,
        warmup_epochs=3.0,
        # augmentation — a small dataset benefits from aggressive aug
        mosaic=1.0,
        close_mosaic=10,          # turn mosaic off for the last 10 epochs to sharpen
        mixup=0.1,
        copy_paste=0.1,
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        degrees=0.0, translate=0.1, scale=0.5, fliplr=0.5,
        plots=True,
        verbose=True,
    )

    # Report real validation metrics on the held-out split.
    metrics = model.val(data=args.data, imgsz=args.imgsz, device="cpu", workers=args.workers)
    box = metrics.box
    print("\n[train] ── final validation (measured) ──")
    print(f"  precision {box.mp:.4f}  recall {box.mr:.4f}  "
          f"mAP50 {box.map50:.4f}  mAP50-95 {box.map:.4f}")
    for i, name in metrics.names.items():
        print(f"  class {name:12s}  mAP50 {box.ap50[i]:.4f}")


if __name__ == "__main__":
    main()
