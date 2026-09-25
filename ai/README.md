# RAKSHA AI — Road Damage Detection (Phase 5)

The repo's first real computer-vision capability: a YOLO model fine-tuned on
the **RDD2022 India** subset detecting `pothole` and `road_damage`, feeding the
same idempotent ingestion pipeline the simulator uses.

**Honest status:** all metrics below are **real, measured** on held-out data —
no fabricated numbers. Training is **CPU-only on this box** (no CUDA), so every
run is bounded by a wall-clock cap and is under-trained relative to what a GPU
would reach — the loss curves were still descending when the cap hit. These are
strong baselines and a working multi-country/multi-class pipeline, not converged
production detectors; the single biggest lever left is simply **more epochs (a
GPU or a longer run)**. `obstruction` has no verified dataset and stays
rules-first (ADR-0006).

### Models trained (measured on held-out val)

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
recommended tier for Pi-class hardware. `yolo11s-multi-rich` is the most capable
(4 asset types, best mAP); `faded_marking`/`manhole` need a server enum
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

Twelve tests, ~0.02s, **stdlib only** — no `ultralytics`, no torch, no `cv2`.
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

---

## Edge runtime (ONNX)

```bash
../.venv/Scripts/yolo export model=../runs/yolo11n-multi-edge/weights/best.pt format=onnx imgsz=512 dynamic=True
../.venv/Scripts/python detect.py --weights ../runs/yolo11n-multi-edge/weights/best.onnx --source <images> --imgsz 512
```

The nano ONNX is 10 MB at ~48 ms/image on this CPU — the Pi-class tier. Ingesting
the rich model's `faded_marking`/`manhole` classes needs the server detection
enum (`pothole|road_damage|obstruction`) extended first — not yet wired, so those
classes are trained and measured but not faked into the live ingest path.

Measured on this machine (CPU): `best.onnx` 10.2 MB (dynamic batch),
72.5 ms/image average through ONNX Runtime — the documented runtime for
Pi-class hardware. `detect.py` loads `.pt` and `.onnx` transparently and keeps
stdout pure JSON (library chatter is redirected to stderr).
