# RAKSHA AI — Road Damage Detection (Phase 5)

The repo's first real computer-vision capability: a YOLO model fine-tuned on
the **RDD2022 India** subset detecting `pothole` and `road_damage`, feeding the
same idempotent ingestion pipeline the simulator uses.

**Honest status:** all metrics below are **real, measured** on held-out data —
no fabricated numbers. The runs in *Models trained* were **CPU-only**, each
bounded by a wall-clock cap and under-trained — the loss curves were still
descending when the cap hit. The current edge model (next section) is the
first run trained to its full schedule, on a laptop GPU. Even so these are
modest detectors, not production ones: read the per-class figures, not just
the mean. `obstruction` has no verified dataset and stays rules-first
(ADR-0006).

### Current edge model: `yolo11n-india-ft-gpu`

The model the web *Live road scan* and the Android *Scan road* screen run
since 2026-10-08 (it replaced `yolo11n-multi-rich-gpu` the same day). It is
that nano fine-tuned for India: warm-started from
`yolo11n-multi-rich-gpu/weights/best.pt`, then 20 epochs on
`data/yolo-india-ft` (every usable RDD2022-India train image relabelled with the
4-class map and oversampled x2, plus the non-India part of `yolo-multi-rich`
train; built by `road_damage/build_india_ft.py`, which refuses to write if any
image of rich val, `yolo-full` val or India-clean is in it, checked by name and
by sha256). 4 classes in index order `pothole, road_damage, faded_marking,
manhole`, output `[1, 8, anchors]`.

| Input | Where it runs | 4-country val (800): P / R / mAP50 / mAP50-95 | India-clean (392): mAP50 / mAP50-95 | ONNX |
|---|---|---|---|---|
| 640 | web (`raksha-yolo11n-india-ft-gpu.onnx`, sha256 `7b26bec8…`) | 0.593 / 0.566 / **0.586** / **0.287** | **0.500** / **0.217** | 10.6 MB |
| 416 | Android (`raksha-yolo11n-india-ft-gpu-416.onnx`, sha256 `04a66285…`) | 0.567 / 0.506 / 0.516 / 0.245 | 0.449 / 0.195 | 10.5 MB |

Per-class mAP50 at 640, 4-country val: pothole **0.389** · road_damage 0.547 ·
faded_marking 0.588 · manhole 0.821; India-clean: pothole **0.422** ·
road_damage 0.578. Potholes are still the weakest class.

How it compares (`ai/runs/yolo11n-india-ft-gpu/compare.json`, every model
scored by `eval_compare.py` on the same two splits):

| Model | 4-country val, 4 classes (mAP50 / mAP50-95) | India-clean, pothole + road_damage | India-clean pothole |
|---|---|---|---|
| **`yolo11n-india-ft-gpu`** @640 (current edge) | **0.586** / 0.287 | **0.500** / **0.217** | **0.422** |
| `yolo11n-india-ft-gpu` @416 | 0.516 / 0.245 | 0.449 / 0.195 | 0.381 |
| `yolo11s-multi-rich-gpu` @640 (best YOLO11s, 38 MB) | 0.578 / 0.287 | 0.414 / 0.169 | 0.366 |
| `yolo11n-multi-rich-gpu` @640 (its parent) | 0.547 / 0.262 | 0.396 / 0.160 | 0.333 |
| `yolo11n-multi-rich-gpu` @416 | 0.499 / 0.236 | 0.360 / 0.151 | 0.289 |
| `yolo11s-multi-rich` @512 (the previous best) | 0.471 / 0.226 | 0.293 / 0.113 | 0.258 |
| `yolo11n-multi-edge` @512 (the previous edge model) | — (2 classes) | 0.299 / 0.119 | 0.263 |
| baseline India-only `yolo11n` @480 | — (2 classes) | 0.441 / 0.183 | 0.411 |

*India-clean* is `yolo-full` val minus every image that appears in any
training split (including `yolo-india-ft`), so no model is graded on an image it
trained on. The fine-tune is the best of every model here on both splits,
including the India-only specialist on India data (0.500 against 0.441;
potholes 0.422 against 0.411, a narrow margin). Its 4-country val rose too
(0.547 to 0.586), so the India data did not cost the other countries. The
specialist's 0.441 on the clean subset reproduces the 0.443 in the table below.
Caveat: each model picked its best checkpoint on its own val split; the
India-only model's was `yolo-full` val, which contains India-clean.

**The runs.** All on an **NVIDIA GeForce RTX 3050 Laptop GPU (4 GB)**, CUDA
12.6, torch 2.14.0, Ultralytics 8.4.126, imgsz 640, AMP, cosine LR, seed 0;
artefacts in `ai/runs/<run>/` (gitignored), each with `metrics.json` (sha256 of
every export) and `compare.json`.

| Run | Start | Optimizer | Batch | Epochs | Best | Wall clock | Log |
|---|---|---|---|---|---|---|---|
| `yolo11n-multi-rich-gpu` | COCO `yolo11n.pt` | auto (AdamW 0.00125) | 16 | 50 of 50 | 50 | 2 h 13 min | `ai/train-gpu-yolo11n.log` |
| `yolo11s-multi-rich-gpu` | `yolo11s-multi-rich/best.pt` | auto (AdamW 0.00125) | 8 | 137 (early stop, patience 25) | 112 | 4 h 54 min | `ai/train-gpu.log` |
| `yolo11n-india-ft-gpu` | `yolo11n-multi-rich-gpu/best.pt` | AdamW, lr0 0.0005, warmup 1 | 16 | 20 of 20 | 20 | 1 h 30 min | `ai/train-gpu-india-ft.log` |

The YOLO11s run converged (25 epochs without improvement), so the
"under-trained" note no longer applies to it; it is not the edge model
because the fine-tuned nano matches it at a quarter of the size.

Reproduce, from `ai/road_damage` with the GPU venv (`ai/.venv-gpu`: torch
CUDA build + ultralytics; `ai/.venv` is CPU-only torch):

```bash
# data/yolo-multi-rich: the 4-country split, --classes rich (Setup & reproduce, step 2)
../.venv-gpu/Scripts/python train.py --data ../data/yolo-multi-rich/dataset.yaml \
    --model yolo11n.pt --name yolo11n-multi-rich-gpu --device 0 \
    --imgsz 640 --batch 16 --epochs 50 --hours 0 --workers 3 --save-period 5
# YOLO11s, warm-started (5 h cap; it early-stopped at epoch 137)
../.venv-gpu/Scripts/python train.py --data ../data/yolo-multi-rich/dataset.yaml \
    --model ../runs/yolo11s-multi-rich/weights/best.pt --name yolo11s-multi-rich-gpu --device 0 \
    --imgsz 640 --batch 8 --epochs 100 --hours 5 --workers 3 --save-period 5
# the India fine-tune of the nano: build the leak-checked set, then 20 epochs at a low LR
../.venv/Scripts/python build_india_ft.py
../.venv-gpu/Scripts/python train.py --data ../data/yolo-india-ft/dataset.yaml \
    --model ../runs/yolo11n-multi-rich-gpu/weights/best.pt --name yolo11n-india-ft-gpu --device 0 \
    --imgsz 640 --batch 16 --epochs 20 --hours 0 --workers 2 --save-period 5 \
    --optimizer AdamW --lr0 0.0005 --warmup-epochs 1
# static ONNX at both sizes, each with a sidecar (classes from the model's metadata),
# then .pt-vs-ONNX box parity through serve.py's decoder
../.venv-gpu/Scripts/python export_onnx.py ../runs/yolo11n-india-ft-gpu/weights/best.pt --imgsz 640 416 --static
../.venv-gpu/Scripts/python onnx_parity.py --pt ../runs/yolo11n-india-ft-gpu/weights/best.pt \
    --onnx ../runs/yolo11n-india-ft-gpu/weights/best-640.onnx --images ../data/yolo-india-clean/images/val
# the same splits for every model (India-clean is built on first use; results resume after a crash)
../.venv-gpu/Scripts/python eval_compare.py --device 0 --out ../runs/yolo11n-india-ft-gpu/compare.json \
    --model india-ft=../runs/yolo11n-india-ft-gpu/weights/best.pt@640,416 \
    --model s-gpu=../runs/yolo11s-multi-rich-gpu/weights/best.pt@640 \
    --model nano-gpu=../runs/yolo11n-multi-rich-gpu/weights/best.pt@640,416 \
    --model base-11s-rich=../runs/yolo11s-multi-rich/weights/best.pt@512 \
    --model base-11n-edge=../runs/yolo11n-multi-edge/weights/best.pt@512 \
    --model base-11n-india=../../runs/runs/full/weights/best.pt@480
python run_record.py ../runs/yolo11n-india-ft-gpu --label india-ft     # metrics.json + sha256
# web: copy beside scan.html, write its sidecar, then the reference scan-check holds the browser to
../.venv-gpu/Scripts/python web_model.py export --weights ../runs/yolo11n-india-ft-gpu/weights/best-640.onnx \
    --name raksha-yolo11n-india-ft-gpu --map50 0.586 --map50-95 0.287 \
    --class-map50 pothole=0.389 road_damage=0.547 faded_marking=0.588 manhole=0.821 \
    --metrics-source "ai/runs/yolo11n-india-ft-gpu/compare.json: ..."
../.venv-gpu/Scripts/python web_model.py reference \
    --weights ../../app/apps/web/assets/models/raksha-yolo11n-india-ft-gpu.onnx \
    --images ../../app/apps/web/assets/scan/*.jpg
# web, WebAssembly fallback: the 416 export of the same weights (scan.js MODEL_SIDECAR_WASM)
../.venv-gpu/Scripts/python web_model.py export --weights ../runs/yolo11n-india-ft-gpu/weights/best-416.onnx \
    --name raksha-yolo11n-india-ft-gpu-416 --map50 0.516 --map50-95 0.245 \
    --class-map50 pothole=0.362 road_damage=0.481 faded_marking=0.550 manhole=0.671 \
    --metrics-source "ai/runs/yolo11n-india-ft-gpu/compare.json: ... at 416; India-clean (392 images) 0.449 / 0.195"
../.venv-gpu/Scripts/python web_model.py reference \
    --weights ../../app/apps/web/assets/models/raksha-yolo11n-india-ft-gpu-416.onnx \
    --images ../../app/apps/web/assets/scan/*.jpg --out ../../app/scripts/scan-reference-416.json
# Android: best-416.onnx into mobile/app/src/main/assets/detector/, named in detector.json, then
../.venv-gpu/Scripts/python ../../mobile/tools/detector_parity_reference.py
```

`--hours 0` runs exactly `--epochs` (a capped run lets Ultralytics resize the
schedule). Only `pothole` and `road_damage` can be reported from either app:
`faded_marking` and `manhole` are shown with the reason, never filed (see
*Serving the model over HTTP* below).

### Models trained (measured on held-out val)

History: the CPU runs before the current edge model, each on its own val
split as first published (the comparison table above re-scores them on shared
splits). `yolo11n-multi-edge` was the web and Android scan model until
2026-10-08.

| Model | Data | Classes | Epochs | mAP50 | mAP50-95 | ONNX | ms/img (CPU) |
|---|---|---|---|---|---|---|---|
| baseline `yolo11n` | India, 2.7k | 2 | 30 | 0.443 | 0.183 | 10 MB | ~72 |
| `yolo11s-multi` | 4-country, 3.0k | 2 | 13 | 0.290 | 0.119 | 37 MB | ~135 |
| **`yolo11s-multi-rich`** | 4-country, 3.2k | **4** | 13 | **0.472** | **0.226** | 37 MB | ~135 |
| `yolo11n-multi-edge` | 4-country, 3.0k | 2 | 18 | 0.293 | 0.117 | **10 MB** | **~48** |

The baseline row is `best.pt` as validated at the end of `ai/train-full.log`
(2,723 train / 500 val India images). It was published here as 0.426 / 0.173 on
"India, 800", which is that log's epoch-28 line, not the best checkpoint; this
YOLO11n model is the one whose detections (`cv-detections-full.json`, model
version `yolo-rdd2022in-best`) the RAKSHA demo shows. Metrics are rounded to
three places from the raw values (0.4717 → 0.472).

Per-class mAP50 (rich model): pothole 0.242 · road_damage 0.431 · faded_marking
0.425 · manhole 0.786. Two honest caveats: the rich model's higher mean is
partly lifted by the easy **manhole** class, and **potholes stay the hard case**
(~0.24 — small objects, under-trained). The **nano edge** model matches the 11s
on the 2-class task (0.293 vs 0.290) at ~1/4 the size and ~1/3 the latency — the
recommended tier for Pi-class hardware at the time. `yolo11s-multi-rich` was the most capable
(4 asset types, best mAP) until `yolo11n-multi-rich-gpu` (above) beat it at a
quarter of the size; `faded_marking`/`manhole` need a server enum
extension before they can be *ingested* (see below), so they are not faked into
the live pipeline yet.

**Multi-country data (diversity, not just India):** India + Czech + Japan +
United States, balanced round-robin so no country dominates. Norway (10.6 GB)
is deliberately skipped. Same class mapping and the same verified license basis
as India (all RDD2022). `fetch_countries.py` pulls only the needed byte ranges
of each country zip from the one figshare archive — never the full 13 GB.

### What is in this repository, and what is not

The table above is the record. The artefacts behind it are local build output
and are **gitignored**: `ai/runs/` (per-epoch `results.csv`, PR and F1 curves,
confusion matrices), the `*.pt` and `*.onnx` weights, and `ai/data/`. A clone
gets the pipeline, the measured figures and the commands that produced them; it
does not get the trained model.

That is deliberate — the alternative is hundreds of megabytes of build output in
git — but it has one consequence worth stating plainly rather than letting a
reader discover it: **"the weights are in `ai/runs/`" is only true on a machine
that has already run the training.** Reproduce them with *Setup & reproduce*
below, or copy the run directory over. Nothing else in the repo depends on the
artefacts being present, because CI deliberately never loads a model — the `ai`
job checks the pipeline logic and that every script parses (see the job comment
in `.github/workflows/ci.yml`).

## Dataset (verified — docs/raksha/05-dataset-license-verification.md)

RDD2022, Arya et al. — India split: 7,706 annotated train images, 1,959
unannotated test images. figshare records **CC BY 4.0**; the maintainers'
GitHub README states **CC BY-SA 4.0** for the images — both permit attributed
use; we honour the stricter reading (share-alike for image derivatives) until
clarified. Class mapping (skipped labels are counted, never folded in):

| RDD2022 | RAKSHA class |
|---|---|
| D40 (pothole) | `pothole` |
| D00 / D10 / D20 (cracks) | `road_damage` |
| D01, D11, D43, D44, D50, … | skipped — outside the MVP contract |

## Tests

```bash
python -m unittest discover -s tests -v     # from ai/, or -s ai/tests from the repo root
```

39 tests, ~0.02s, **stdlib only** — no `ultralytics`, no torch, no `cv2`.
That is the point: they run on every push in CI, which is the only way they stay
honest. They pin the two things that decide what the model is taught and what the
platform is told:

- the **RDD2022 → RAKSHA class mapping** in the table above, including the promise
  that an unmapped label is skipped *and counted*, never quietly folded into a
  class — a mis-mapped label is a training bug nobody can see afterwards;
- the **box maths** that turns VOC pixels into normalised YOLO coordinates,
  including clamping and the sub-2px rejection;
- the **severity heuristic** in `detect.py`, which is an engineering assumption
  that reaches the database through `POST /v1/raksha/detections` — and whose 1–5
  cap is load-bearing, because `raksha_detections` has `CHECK (severity BETWEEN 1
  AND 5)` and a 6 would be refused at ingest.

`detect.py` imports `YOLO` at module scope, so the suite stubs `ultralytics` to
reach `severity()`. The stub *raises* if anything actually calls it, rather than
returning a fake detection.

Training and inference are not in CI and are not meant to be — see the CPU-only
caveat above.

---

## Setup & reproduce

```bash
cd ai
python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt
cd road_damage

# 1. fetch country splits (byte-range pulls from the one 13.26 GB figshare
#    archive — India ~527 MB is step 0; the rest via fetch_countries.py).
#    Norway (10.6 GB) is intentionally skipped.
../.venv/Scripts/python -c "from remotezip import RemoteZip; \
z=RemoteZip('https://ndownloader.figshare.com/files/38030910'); \
z.extract('RDD2022/India.zip','../data'); z.close()"   # then unzip into ../data/
../.venv/Scripts/python fetch_countries.py Czech Japan United_States

# 2. build a balanced multi-country YOLO split (round-robin across countries).
#    --classes mvp = pothole+road_damage ; --classes rich = +faded_marking+manhole
../.venv/Scripts/python convert_voc_to_yolo.py \
    --src ../data/India ../data/Czech ../data/Japan ../data/United_States \
    --out ../data/yolo-multi --train 3000 --val 700 --classes mvp

# 3. train (CPU, 8 threads, tuned schedule, hard wall-clock cap). See train.py.
../.venv/Scripts/python train.py --model yolo11s.pt --imgsz 512 \
    --data ../data/yolo-multi/dataset.yaml --epochs 100 --hours 6 --name yolo11s-multi
#   nano edge tier:  --model yolo11n.pt --name yolo11n-multi-edge --hours 4
#   richer classes:  build with --classes rich, then train on yolo-multi-rich

# 4. run the detector — JSON in the RAKSHA ingest shape (reads class names from
#    the model, so it works for the 2- and 4-class variants alike)
../.venv/Scripts/python detect.py --weights ../runs/yolo11s-multi/weights/best.pt \
    --source ../data/yolo-multi/images/val --imgsz 512 --limit 12 > /tmp/detections.json

# 5. push REAL detections through the platform (locations stay SIMULATED)
cd ../../app && node scripts/raksha-simulator.mjs --from-json /tmp/detections.json
```

`train.py` prints precision / recall / mAP50 / mAP50-95 (and per-class) at the
end and writes `runs/<name>/results.csv` per epoch; latency and model size come
from `detect.py` output and the ONNX file. The severity number is a documented
box-area heuristic — an engineering assumption, not a safety standard.

## The dashboard's hazard frames

The RAKSHA dashboard shows each device detection's frame: the RDD2022 India
image the model ran on, with that model's boxes drawn. `render_frames.py`
re-runs the same weights on the images in `cv-live-show.json` and keeps only
the boxes whose class and confidence match a detection in that report, so every
box on a frame is one the dashboard lists. It exits non-zero if any detection
is not reproduced, which is how a wrong checkpoint is caught. The live set
(46 frames, 65 detections) comes from `runs/runs/full/weights/best.pt`:

```bash
cd ai
.venv/Scripts/python road_damage/render_frames.py --weights ../runs/runs/full/weights/best.pt \
    --report cv-live-show.json --out ../app/apps/web/assets/raksha-frames
```

The frames are a derivative of RDD2022 (Arya et al., CC BY-SA 4.0) under the
same licence, credited in the dashboard's photo viewer.

## Serving the model over HTTP

```bash
python -m venv .venv
./.venv/Scripts/pip install -r requirements-serve.txt
python serve.py --weights runs/yolo11s-multi-rich/weights/best.onnx

curl http://127.0.0.1:8500/health
curl -X POST --data-binary @road.jpg http://127.0.0.1:8500/detect
```

Until now the detectors reached the platform through `detect.py` writing JSON
to a file — a pipeline, not a service. `serve.py` puts the same model behind
`POST /detect`, returning detections in exactly the shape
`POST /v1/raksha/detections` expects.

### It runs on ONNX Runtime, not ultralytics

| | Training (`requirements.txt`) | Serving (`requirements-serve.txt`) |
|---|---|---|
| Stack | ultralytics + PyTorch | onnxruntime + numpy + pillow |
| Installed size | ~2 GB | ~50 MB |
| Licence | **AGPL-3.0** | MIT / BSD-3 / MIT-CMU |

The licence column is the point. This README already recorded that *"an
Apache-2.0 alternative must be scored before any commercial deployment"*
(dataset-licence doc §2). This is that alternative, scored and working: the
path that would actually ship — an edge device, a container — only ever runs
inference, and inference does not need the AGPL dependency. Training keeps
ultralytics, where the AGPL is an internal matter because nothing is
distributed.

It loads the **same** `best.onnx` that `yolo export` already produces. No
second conversion, no second source of truth, and `severity.py` is shared with
`detect.py` so the heuristic cannot drift between the two paths.

### Verified against ground truth, not against itself

A decoder that is merely self-consistent will happily return boxes in the
wrong place — a wrong letterbox does not crash, it silently shifts every
detection, and the output of this system is a pin on an authority's map. So
the check is against RDD2022's own annotations:

```
India_000005.jpg   (720x720, one annotated D40 pothole)
  ground truth   box = [ 20, 473, 368, 576]
  predicted      box = [ 74, 469, 355, 572]   conf 0.308
  IoU 0.753
```

Three edges land within five pixels. That is the evidence the letterbox,
un-letterbox and NMS maths is right; `tests/test_onnx_detector.py` pins that
IoU as a number so a regression shows up as a failure rather than as drift.
Throughput on this CPU is ~140 ms/image for the 512px `yolo11s-multi-rich`.

### What it deliberately does not do

There is **no `/diagnose`**. `AI_BASE_URL` in the API expects one, and no
vehicle-fault model has been trained — the platform's diagnosis is a rules
engine by decision (ADR-0006). A stub returning plausible-looking faults is
exactly what `CLAIMS-AUDIT.md` exists to catch, so `GET /health` says the
endpoint is not implemented rather than leaving someone to wonder why wiring
`AI_BASE_URL` here changes nothing.

`faded_marking` and `manhole` are detected by the rich model and returned
under `notIngestable` — reported so the data is not lost, separated so it is
never sent to an ingest enum that would reject it.

The two scan apps follow the same rule and say why (web `scan-core.js`
`NOT_REPORTABLE`, Android `detector.json` `reportAs`). Neither class maps
honestly onto `pothole|road_damage|obstruction`: `road_damage` is cracking
(D00/D10/D20 in `convert_voc_to_yolo.py`), so a worn line filed under it
would send a pavement crew to repaint; and D50 labels every manhole cover,
closed ones included, so filing it as `obstruction` would pin a hazard on
every intact cover.

---

## Edge runtime (ONNX)

```bash
# the current edge model (static 640 and 416 exports: see "Current edge model" above)
../.venv-gpu/Scripts/python export_onnx.py ../runs/yolo11n-india-ft-gpu/weights/best.pt --imgsz 640 416 --static
../.venv/Scripts/python detect.py --weights ../runs/yolo11n-india-ft-gpu/weights/best-640.onnx --source <images> --imgsz 640
# history: the earlier nano, dynamic 512
../.venv/Scripts/yolo export model=../runs/yolo11n-multi-edge/weights/best.pt format=onnx imgsz=512 dynamic=True
```

The figures in the rest of this section are the earlier `yolo11n-multi-edge`
export's; the current model's CPU latency has not been measured the same way.
That nano ONNX is 10 MB at ~48 ms/image on this CPU — the Pi-class tier. Ingesting
the rich model's `faded_marking`/`manhole` classes needs the server detection
enum (`pothole|road_damage|obstruction`) extended first — not yet wired, so those
classes are trained and measured but not faked into the live ingest path.

Measured on this machine (CPU): `best.onnx` 10.2 MB (dynamic batch),
72.5 ms/image average through ONNX Runtime — the documented runtime for
Pi-class hardware. `detect.py` loads `.pt` and `.onnx` transparently and keeps
stdout pure JSON (library chatter is redirected to stderr).
