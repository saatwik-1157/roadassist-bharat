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

### mitangshu11 / Indian Roads Dataset — CANDIDATE, LICENSE UNVERIFIED ⚠️

| Property | Value | Label |
|---|---|---|
| Location | kaggle.com/datasets/mitangshu11/indian-roads-dataset | SOURCE FACT |
| Content | 4,000+ images of Indian roads: potholes, marked/unmarked speed-breakers, poorly maintained unpaved roads | SOURCE FACT (from search snippet) |
| Annotation | Labeled with LabelImg, YOLO format | SOURCE FACT (from search snippet) |
| **License** | **UNKNOWN — Kaggle blocks automated access; neither scraping nor search surfaced the license** | UNVERIFIED |

**Action required before ANY training use:** open the Kaggle page in a browser,
read the License field on the dataset card, and record it here. Until then this
dataset must not be used for anything beyond private local experimentation.
Many Kaggle datasets ship with "unknown/other" licensing, which would rule it
out. Its value if cleared: speed-breakers and unpaved-road classes that RDD2022
lacks, on exactly our domain.

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
2. **Hold mitangshu11's dataset** pending a manual license check on Kaggle.
3. **Use an AGPL-tolerant setup now** (public student project) but score at
   least one Apache-2.0 model in the same evaluation so the startup path is
   never blocked on a license.
4. `obstruction` stays rules-first — honestly labeled — until data exists.
