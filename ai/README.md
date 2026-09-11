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
| baseline `yolo11n` | India, 800 | 2 | 30 | 0.426 | 0.173 | 10 MB | ~72 |
| `yolo11s-multi` | 4-country, 3.0k | 2 | 13 | 0.290 | 0.119 | 37 MB | ~135 |
| **`yolo11s-multi-rich`** | 4-country, 3.2k | **4** | 13 | **0.471** | **0.226** | 37 MB | ~135 |
| `yolo11n-multi-edge` | 4-country, 3.0k | 2 | 18 | 0.293 | 0.117 | **10 MB** | **~48** |

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
