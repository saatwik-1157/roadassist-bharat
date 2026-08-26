# RAKSHA Phase 5 — Dataset & Model License Verification

> Verified against live sources on **2026-08-23**. Every claim below is labeled
> SOURCE FACT (checked), UNVERIFIED (could not be confirmed — action required),
> or ENGINEERING ASSUMPTION. Nothing here is invented.

## 1. Candidate datasets

### RDD2022 — RECOMMENDED PRIMARY ✅

| Property | Value | Label |
|---|---|---|
| Full name | RDD2022 — The multi-national Road Damage Dataset (CRDDC'2022, IEEE BigData Cup) | SOURCE FACT |
| License | **CC BY 4.0** — confirmed from the figshare API license record | SOURCE FACT |
| DOI | 10.6084/m9.figshare.21431547.v1 · published 2022-10-29 | SOURCE FACT |
| Size | 47,420 road images, >55,000 annotated damage instances | SOURCE FACT |
| Countries | Japan, **India**, Czech Republic, Norway, USA, China | SOURCE FACT |
| Classes | Longitudinal cracks, transverse cracks, alligator cracks, **potholes** | SOURCE FACT |
| Annotation | Bounding boxes, PASCAL-VOC-style XML | SOURCE FACT |
| Authors to credit | Arya, Maeda, Sekimoto, Omata, Ghosh, Toshniwal et al. | SOURCE FACT |

**Why primary:** CC BY 4.0 permits use, modification and redistribution —
including commercial use — with attribution. The India subset matches our
deployment domain, and the class set covers the MVP's `pothole` and
`road_damage` types directly. `obstruction` is NOT covered (see §3).

Sources: figshare API record (api.figshare.com/v2/articles/21431547),
[figshare item](https://figshare.com/articles/dataset/RDD2022_-_The_multi-national_Road_Damage_Dataset_released_through_CRDDC_2022/21431547),
[arXiv:2209.08538](https://arxiv.org/abs/2209.08538),
[Geoscience Data Journal](https://rmets.onlinelibrary.wiley.com/doi/10.1002/gdj3.260).

### mitangshu11 / Indian Roads Dataset — RULED OUT ❌ (license "Unknown")

| Property | Value | Label |
|---|---|---|
| Location | kaggle.com/datasets/mitangshu11/indian-roads-dataset | SOURCE FACT |
| Content | 4,000+ images of Indian roads: potholes, marked/unmarked speed-breakers, poorly maintained unpaved roads | SOURCE FACT (from search snippet) |
| Annotation | Labeled with LabelImg, YOLO format | SOURCE FACT (from search snippet) |
| **License** | **"Unknown" — read from the rendered dataset card in a browser on 2026-08-23** | SOURCE FACT |

**Verdict:** a Kaggle license of "Unknown" grants no usage rights, so this
dataset is **excluded from training and evaluation** in this project. If the
author later attaches a real license, re-open this entry. Consequence: the
speed-breaker and unpaved-road classes currently have **no licensed data** —
they become a data-collection item (own dashcam footage, labeled in-house)
or await another verified source.

## 2. Model licensing

### Ultralytics YOLO11 / YOLOv8 — AGPL-3.0 ⚠️

SOURCE FACT (Ultralytics' own license page and docs): released under
**AGPL-3.0**. Compliance requires publicly releasing the complete corresponding
source of the derivative work — including the surrounding application and,
where applicable, model weights. Ultralytics sells an **Enterprise License**
that removes this obligation for commercial products.

- **Student project (now):** compatible — this repository is already public
  coursework, and open-sourcing is acceptable. Usable for the MVP evaluation.
- **Startup path (later):** AGPL is a real constraint. Either budget for the
  Enterprise License or choose a permissively-licensed model before
  commercialization.

Sources: [ultralytics.com/license](https://www.ultralytics.com/license),
[docs.ultralytics.com](https://docs.ultralytics.com/),
[Ultralytics/YOLO11 on Hugging Face](https://huggingface.co/Ultralytics/YOLO11).

### Permissive alternatives to evaluate alongside

ENGINEERING ASSUMPTION (well-known licensing, to be re-verified at evaluation
time): YOLOX (Apache-2.0, Megvii) and RT-DETR within PaddleDetection
(Apache-2.0, Baidu) are the usual permissive candidates in this accuracy/speed
class; ONNX Runtime (MIT) serves any of them on Raspberry-Pi-class hardware.
The Phase 5 evaluation harness must score whichever candidates are shortlisted
on the mandated metrics: precision, recall, F1, mAP, latency, FPS, and model
size (≤ 15 MB target for the edge bundle).

## 3. Gap analysis vs the MVP classes

| MVP class | RDD2022 | Indian Roads (if cleared) | Plan |
|---|---|---|---|
| pothole | ✅ | ✅ | train/fine-tune directly |
| road_damage | ✅ (3 crack types) | partly (unpaved) | map crack classes → road_damage |
| obstruction | ❌ | ❌ | keep rules/heuristic fallback (ADR-0006) until an obstruction dataset is verified or our own data is collected and labeled |

## 4. Decision

1. **Proceed with RDD2022 (CC BY 4.0)** as the training/evaluation base for
   `pothole` + `road_damage`; attribute the authors in docs and any published
   model card.
2. **mitangshu11's dataset is ruled out** — its Kaggle card reads License
   "Unknown" (verified in-browser 2026-08-23), which grants no usage rights.
   Speed-breaker/unpaved classes need own data collection or another source.
3. **Use an AGPL-tolerant setup now** (public student project) but score at
   least one Apache-2.0 model in the same evaluation so the startup path is
   never blocked on a license.
4. `obstruction` stays rules-first — honestly labeled — until data exists.

## 5. Measured results — smoke run (2026-08-23)

MEASURED, NOT ASSERTED. YOLO11n fine-tuned on the 800/200 RDD2022-India smoke
subset, 3 epochs, imgsz 480, CPU (AMD Ryzen 5 7535HS), 12.9 minutes total.

| Metric | all | pothole | road_damage |
|---|---|---|---|
| Precision | 0.208 | 0.259 | 0.158 |
| Recall | 0.268 | 0.134 | 0.402 |
| mAP50 | 0.134 | 0.105 | 0.162 |
| mAP50-95 | 0.044 | 0.032 | 0.057 |

Model size **5.4 MB** (target ≤15 MB ✅) · inference **65–114 ms/image on CPU**.
These are pipeline-proof baseline numbers from 3 CPU epochs on 800 images —
NOT production quality (published RDD2022 baselines with full data and proper
training reach several times this mAP). Next step: full 3,223-image mapped set,
more epochs, GPU, and an Apache-2.0 model scored alongside.

## 6. Measured results — full run (2026-08-23, MEASURED NOT ASSERTED)

YOLO11n on the full mapped set (2,723 train / 500 val), 30 epochs, imgsz 480,
CPU — 5h50m wall time. Validated on 500 images / 1,051 instances:

| Metric | all | pothole | road_damage |
|---|---|---|---|
| Precision | 0.535 | 0.537 | 0.534 |
| Recall | 0.422 | 0.389 | 0.455 |
| mAP50 | **0.443** | 0.412 | 0.474 |
| mAP50-95 | 0.183 | 0.152 | 0.215 |

**3.3× the smoke baseline** (mAP50 0.134 → 0.443). Weights 5.4 MB (.pt) /
10.4 MB dynamic-batch ONNX · 65.4 ms/image CPU inference. In the useful range
for a first field pilot with human verification in the loop (which the
authority workflow enforces anyway); still below published GPU-trained
RDD2022 baselines — the documented path up is GPU training, larger imgsz,
and hyperparameter/threshold tuning. End-to-end re-proof: 34 detections
(25 road_damage, 9 pothole at conf ≥0.35) from validation images ingested
through the live platform — 34 applied, replay 34 duplicates (idempotent).

End-to-end proof: detect.py output (34 detections over 40 val images at
conf ≥0.30) was ingested through the live platform via
`raksha-simulator.mjs --from-json` — 34 applied, replay returned 34
duplicates (idempotent), all 34 auto-attached to NH-48 segments, road health
recomputed. Detections carry `usedFallback=false` and the real model
version; their GPS locations are SIMULATED (RDD2022 images carry no geodata)
and labeled as such.

## Addendum — multi-country expansion + model family (2026-08-26)

Extended beyond India to a diverse, balanced multi-country set. Added splits:
**Czech, Japan, United States** (Norway skipped — 10.6 GB). All are RDD2022
country splits from the same figshare archive under the same license basis as
India (figshare: CC BY 4.0; maintainers' GitHub: CC BY-SA 4.0 — we honour the
stricter share-alike reading). `fetch_countries.py` pulls only the needed
byte-ranges, never the full 13.26 GB. Balanced round-robin sampling (~750–810
train images per country) so no single country dominates.

Three models trained (CPU-only box, each capped by wall-clock, hence
under-trained — all metrics REAL, measured on held-out val):

| Model | Data | Classes | Epochs | mAP50 | mAP50-95 |
|---|---|---|---|---|---|
| `yolo11s-multi` | 4-country 3.0k | 2 | 13 | 0.290 | 0.119 |
| `yolo11s-multi-rich` | 4-country 3.2k | 4 | 13 | 0.471 | 0.226 |
| `yolo11n-multi-edge` | 4-country 3.0k | 2 | 18 | 0.293 | 0.117 |

Rich model per-class mAP50: pothole 0.242 · road_damage 0.431 ·
faded_marking 0.425 (D44) · manhole 0.786 (D50). The rich mean is lifted by the
easy manhole class; potholes remain hardest. The nano edge model matches the
11s on the 2-class task at ~1/4 size (10 MB ONNX) and ~48 ms/img — the Pi-class
tier. Ingesting `faded_marking`/`manhole` requires extending the server
detection enum (`pothole|road_damage|obstruction`) — documented, not yet wired,
and not faked into the live path.
