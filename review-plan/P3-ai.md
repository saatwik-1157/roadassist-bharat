# P3 — AI & Data Lead

**RoadAssist Bharat · 70 days across 3 reviews**
Owns: 9 AI subsystems · model training and serving · on-device inference · feature store · voice and NLU · analytics pipeline. Backs up **P1**.

**Your three standing rules**
1. **Record the baseline before you train.** A model with no documented baseline cannot be said to work.
2. Every model ships with a **model card** and a **fallback**. No exceptions, including for models you are proud of.
3. No model is ever on the critical path for correctness or safety. **Models advise; rules decide.**

*Your total is lower than the others on purpose. Model work is research-shaped and estimates are less reliable — the slack absorbs the experiments that fail, and some will.*

---

## The 9 AI Systems

| # | System | Input → Output | Method | Runs on | Baseline to beat |
|---|---|---|---|---|---|
| 1 | Vehicle Diagnosis | Symptoms, DTC codes, history → ranked causes + severity + parts | Retrieval + gradient boosting; LLM only writes the explanation | Server + device | Rules on DTC lookup: top-3 = 0.62 |
| 2 | Image Diagnosis | Photos → damage type, part, severity | MobileViT / EfficientNetV2, multi-label + severity head | Server + device | Non-expert labelling: top-3 = 0.55 |
| 3 | Voice Assistant | Speech (8 languages) → intent + slots | Whisper fine-tuned on Indian speech → MuRIL intent classifier | Server; keyword on device | Keyword matching: 0.48 |
| 4 | Predictive Maintenance | Telemetry + history → failure probability at 30/90 days | Survival analysis + LightGBM per component | Server, nightly | Fixed service interval: recall = 0.31 |
| 5 | Mechanic Matching | Request + mechanic features → ranked list | LambdaMART ranker + separate ETA regressor | Server, <300 ms | Distance + rating sort: 0.41 |
| 6 | **Crash Detection** | Accelerometer, gyroscope, GPS at 100 Hz → crash probability | 1D CNN + GRU, INT8 quantised, ~1.5 MB | **Device only** | Peak-G threshold: 1 false alarm per 12 hours |
| 7 | Fraud Detection | Booking graph, payments, GPS traces → risk score + reasons | Graph features + isolation forest + gradient boosting | Server, async | Manual rules: precision 0.34 |
| 8 | Government Analytics | Incidents, weather, road geometry → risk forecast, blackspots | Spatial clustering + temporal fusion model | Server, batch | Historical average by location |
| 9 | **Offline AI Bundle** | Symptoms, sensors → diagnosis + crash detection with no signal | Quantised and distilled versions of 1, 3 and 6 | **Device, ≤ 15 MB** | The alternative is nothing |

---

## REVIEW 1 — Foundation · Weeks 1–5 · 13 days

| Week | Task | Days |
|---|---|---|
| 1 | **Data availability audit** — what exists, what can be acquired, what must be synthetic | 2 |
| 1–2 | Feasibility spikes: crash detection from public sensor data; speech recognition on Indian-accented audio | 2 |
| 2 | **Honest classification of all 9 systems**: trainable now / trainable later / rules-only in v1 | 1 |
| 2 | AI backlog (~35 stories), labelling plan and cost, evaluation protocol with **baselines recorded** | 2 |
| 3 | AI Gateway design: capability routing by model version, shadow mode, guardrails, fallback contract with P1 | 3 |
| 3–4 | Feature store schema + **label capture design** (this is the highest-leverage decision of the whole review) | 2 |
| 5 | Fraud signal catalogue handed to P1; privacy-respecting device fingerprinting design | 1 |

### Deliverables
Data audit · feasibility report with the 9-system classification · labelling plan · evaluation protocol with recorded baselines · AI Gateway design · feature store schema · label taxonomy · model card template.

### Your Review 1 demo — 5 minutes
Present the **honest classification**: which of the 9 systems are genuinely models in v1, which are rules wearing an AI label, and exactly what data would change that. Then run an end-to-end toy pipeline — data → train → registry → export → serve → prediction. The plumbing works before any real model exists. *This candour is what makes everything you claim later credible.*

### Passed when
Every one of the 9 systems is classified honestly · every model has a **baseline recorded before training begins** · label capture is designed even though it will not be used for months · the training/serving feature parity test exists and fails when a feature is changed in only one place.

---

## REVIEW 2 — Core Product · Weeks 6–12 · 33 days

| Week | Task | Days |
|---|---|---|
| 6–7 | **AI Gateway live with rule-based logic for all 8 capabilities** — so P1 and P2 integrate on day one, months before any model exists | 4 |
| 7 | AI presentation contract with P2: confidence bands as **plain language**, not percentages | 1 |
| 8–9 | **Vehicle Diagnosis model** — retrieval + re-ranker + constrained LLM explanation | 4 |
| 9 | **Image Diagnosis model** — with augmentation for rain, night, motion blur, low-end cameras | 3 |
| 9–10 | **Voice Assistant** — speech recognition fine-tuning, intent + slots, code-switched Hinglish | 3 |
| 10 | **Predictive Maintenance** — survival analysis per component | 3 |
| 10 | **Mechanic Matching** — ranker + ETA regressor with an explicit **fairness constraint** | 2 |
| 11 | **Crash Detection** — the highest-stakes model in the project | 3 |
| 11 | **Fraud Detection** — graph features + anomaly detection | 2 |
| 12 | Model registry, shadow mode, one-config rollback | 2 |
| 12 | **On-device bundle ≤ 15 MB** — quantisation, distillation, benchmarking on 5 real devices | 4 |
| 12 | Vehicle-class rule packs (two-wheeler, auto, tractor) + EV diagnostics | 2 |

### Deliverables
AI Gateway with rules **and** models · 7 trained models · 7 model cards · evaluation harness · on-device bundle ≤ 15 MB · rule packs per vehicle class · EV diagnostics module.

### Your Review 2 demo — 8 minutes
For each model: **the baseline, the model, the delta, and the failure modes.** Then a live diagnosis — photograph a real damaged part, get the fault, severity, parts list and a "do not drive" verdict in Hindi. Then unplug the models entirely and show the rules fallback keeping the product working. Finish in **airplane mode on a ₹8,000 phone**: describe a symptom, get a diagnosis in under 200 ms, nothing touching the network.

### Passed when
Every model beats its recorded baseline on a held-out set · on-device inference under 120 ms · on-device bundle ≤ 15 MB · **measured false "safe to drive" rate is zero** · every model has a confidence threshold and a working fallback · quantisation accuracy loss reported, not assumed.

> **Rule packs are not a shortcut.** Most Indian two-wheelers have no OBD port. For those vehicles, structured symptom questioning built with real mechanics is the *correct* engineering choice, not a fallback.

---

## REVIEW 3 — Complete System · Weeks 13–18 · 24 days

| Week | Task | Days |
|---|---|---|
| 13 | **Crash detection to production quality** — threshold tuning against real dogfooding data; severity model | 3 |
| 14 | Blackspot detection (spatial clustering with significance testing); incident forecasting for government | 3 |
| 15–16 | **Analytics** — event taxonomy, ClickHouse schema, **metric dictionary**, anomaly alerting | 5 |
| 16 | **Bias audit across all models** — performance by vehicle class, language, region and device tier | 2 |
| 16 | Adversarial testing: prompt injection, adversarial images, sensor spoofing, GPS spoofing | 2 |
| 17 | Model serving in production; promotion pipeline with **automatic rollback** on metric regression | 3 |
| 17–18 | Inference optimisation: batching, caching, distillation, cost per million inferences | 3 |
| 18 | AI roadmap and the **data flywheel** — which model improves first, at what data volume | 3 |

### Deliverables
Production crash detection with measured false-positive rate · blackspot + forecasting models · ClickHouse analytics · metric dictionary · 9 finalised model cards with bias audits · model serving with auto-rollback · AI roadmap.

### Your Review 3 demo — 6 minutes
Present the **real false-positive number** from 200 hours of driving. Then drive over a speed breaker on camera — nothing happens. That is the demo. Then run blackspot detection on a state's historical data and overlay the official blackspot list — show the overlap **and the new candidates you found**. Close by promoting a deliberately bad model and watching it roll back automatically in under 2 minutes.

### Passed when
Crash false-positive rate ≤ 1 per 1,000 driving hours over **real** driving · the model raises a signal and can never auto-dispatch · every model has a bias audit · every metric has exactly one definition · a bad model rolls back automatically.

> **The pre-committed decision on crash detection.** If the measured false-positive rate over ≥ 200 real driving hours does not meet the target, crash detection **ships disabled by default** and manual SOS carries the feature. This is decided now so it is not a judgement call under demo-day pressure.

---

## Your Key Design Decisions (defend these to the panel)

| Decision | Why |
|---|---|
| **Rules ship first, models replace them** | All 8 AI endpoints go live in Review 2 as rules. Models then upgrade them behind an unchanged contract. AI is never a blocker, and the rules remain the permanent production fallback. |
| **The LLM never chooses the diagnosis** | It explains a structured result selected by a classifier. This removes hallucination from the safety path entirely. |
| **Crash detection runs on-device only** | It must work with no connectivity — which is exactly the condition of a highway crash. |
| **The matching model has a fairness constraint** | A ranker optimised purely for acceptance concentrates all jobs on a few mechanics and destroys the marketplace. Job distribution is tracked as a first-class metric. |
| **Fraud detection never auto-suspends** | It queues for human review with mandatory reason codes. A false accusation destroys a mechanic's livelihood. |
| **Precision over recall on maintenance alerts** | A user who ignores three false warnings will ignore the real one. |
| **Minimal MLOps stack** | Tracking, versioning and plain containers. No orchestration platform — one person cannot operate that. |
