# RAKSHA AI — Road Damage Detection (Phase 5)

The repo's first real computer-vision capability: a YOLO model fine-tuned on
the **RDD2022 India** subset detecting `pothole` and `road_damage`, feeding the
same idempotent ingestion pipeline the simulator uses.

**Honest status:** the checked-in workflow produces a *smoke-scale* model —
a few CPU epochs on a 1,000-image subset to prove the pipeline end to end with
real measured metrics. It is a baseline, not a production detector. Serious
training (full 3,223-image mapped set, more epochs, GPU) is the documented
next step. `obstruction` has no verified dataset and stays rules-first
(ADR-0006).

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

## Setup & reproduce

```bash
cd ai
python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt

# 1. fetch ONLY India.zip (~527 MB) out of the 13.26 GB figshare archive
./.venv/Scripts/python -c "from remotezip import RemoteZip; \
z=RemoteZip('https://ndownloader.figshare.com/files/38030910'); \
z.extract('RDD2022/India.zip','data'); z.close()"
# then unzip data/RDD2022/India.zip into data/

# 2. convert + split (800 train / 200 val smoke subset, fixed seed)
cd road_damage
../.venv/Scripts/python convert_voc_to_yolo.py --src ../data/India --out ../data/yolo --train 800 --val 200

# 3. smoke fine-tune (CPU; AGPL-licensed ultralytics — see requirements.txt)
../.venv/Scripts/yolo detect train data=../data/yolo/dataset.yaml model=yolo11n.pt \
    epochs=3 imgsz=480 batch=8 device=cpu project=../runs name=smoke

# 4. run the detector — JSON in the RAKSHA ingest shape
../.venv/Scripts/python detect.py --weights ../runs/smoke/weights/best.pt \
    --source ../data/yolo/images/val --limit 12 > /tmp/detections.json

# 5. push REAL detections through the platform (locations stay SIMULATED)
cd ../../app && node scripts/raksha-simulator.mjs --from-json /tmp/detections.json
```

Metrics (precision / recall / mAP50 / mAP50-95) are printed by the training
run and recorded in `docs/raksha/05-dataset-license-verification.md` addendum
after each accepted run; latency and model size come from `detect.py` output
and the weights file. The severity number is a documented box-area heuristic —
an engineering assumption, not a safety standard.

## Edge runtime (ONNX)

```bash
../.venv/Scripts/yolo export model=../runs/runs/smoke/weights/best.pt format=onnx imgsz=480 dynamic=True
../.venv/Scripts/python detect.py --weights ../runs/runs/smoke/weights/best.onnx --source <images> --imgsz 480
```

Measured on this machine (CPU): `best.onnx` 10.2 MB (dynamic batch),
72.5 ms/image average through ONNX Runtime — the documented runtime for
Pi-class hardware. `detect.py` loads `.pt` and `.onnx` transparently and keeps
stdout pure JSON (library chatter is redirected to stderr).
