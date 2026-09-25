> Generated 2026-09-06 from the actual repository. Every claim word was searched for across the whole repository — code, docs, UI strings and the deck source.
> Figures updated to the current ones, measured 2026-09-12 (`app/docs/measured.json`), and to the live demo deployment; occurrence counts are from the 2026-09-06 search.

# Claim verification

Four verdicts: **SUPPORTED** (code backs it) · **PARTIAL** (true with a stated
limit) · **CONCEPTUAL** (designed, labelled as such) · **UNSUPPORTED** (must be
removed or rewritten).

| Claim | Verdict | Basis |
|---|---|---|
| "AI-powered" | **PARTIAL — and labelled everywhere** | The roadside engine is deterministic rules, returned as `rules-1.0.0` in every response and shown on screen. Genuinely trained YOLO11 road-damage detectors exist with measured metrics: best run YOLO11s (`yolo11s-multi-rich`, mAP50 0.472 / mAP50-95 0.226), and the YOLO11n India model (mAP50 0.443, `ai/train-full.log`) whose 34 real detections are seeded into RAKSHA in demo mode with simulated NH-48 positions. The project explicitly refuses to call the rules engine AI. |
| "Cloud-native" | **PARTIAL** | Containerised, stateless, config-through-environment, readiness gate. Deployed as one Render web service (Singapore) with Neon Postgres (Singapore) — a single instance, with no cluster, autoscaling or replication. |
| "Scalable" | **CONCEPTUAL** | The preconditions are built; the scaling is not provisioned. Three in-process components are named as the blockers. |
| "Real-time" | **SUPPORTED** | SSE, measured: connect → first frame 5.2 ms p50; customer screen follows a mechanic's action in 0.8–1.4 s. Documented as SSE, not WebSocket. |
| "Offline-first" | **SUPPORTED** | Connectivity manager, on-device rules engine, encrypted IndexedDB, sync journal, service worker. Proven by closing the tab and reopening it. |
| "Emergency" | **SUPPORTED, with the limit stated** | A real SOS path with an escalation ladder that reports each rung as fact. 112 is a stub and the API's own response says so. |
| "Secure" | **SUPPORTED** | 101 attack assertions across two suites (74 security + 27 gateway security), all refused. No independent pentest, and the project says so. |
| "Encrypted" | **SUPPORTED** | AES-GCM-256 with a non-extractable `CryptoKey` for offline incidents. Claimed only about client-side storage, which is where it is true. |
| "Highly available" | **ABSENT** | Zero occurrences. Correctly never claimed. |
| "Fault tolerant" | **ABSENT** | Zero occurrences. Correctly never claimed. |
| "Production ready" | **ABSENT** | Zero occurrences. Every document says the opposite. |
| "Deployed" | **SUPPORTED, with the limit stated** | The demo is live at <https://app.roadassistbharat.online> — one Render web service (Docker, free plan, Singapore, `NODE_ENV=demo`) with Neon Postgres + PostGIS (Singapore); showcase on GitHub Pages at <https://roadassistbharat.online>. Single instance, mock payments, no real SMS, 112 stubbed. The 2026-09-06 occurrence count predates the deployment and no longer describes the repository. |
| "99.9% uptime" | **CONCEPTUAL — flagged** | 11 occurrences, all inside `docs/01-master-roadmap.md` and `docs/05-devops-qa-lead-roadmap.md` as **SLO target tables** written before the build. They are planning targets, not measurements. See the marks-loss audit — a reader could mistake them for claims. |
| "Zero downtime" | **CONCEPTUAL** | 2 occurrences, both future demo goals in planning documents. |
| "Satellite" | **CONCEPTUAL — correctly labelled** | 20 occurrences, every one saying satellite/mesh is **not implemented** and is future work. |
| "Kubernetes" | **CONCEPTUAL** | 25 occurrences, all as target architecture. ADR-0001 explains why four developers should not operate a cluster. |
| "Auto-scaling" | **CONCEPTUAL** | 32 occurrences, all labelled DESIGN/TARGET. The deck slide says DESIGN. |
| "Load balancing" | **PARTIAL** | 49 occurrences. Infrastructure LB: not built. *Workload distribution* across a provider pool: genuinely built, and that is the syllabus's own framing. |
| "Emergency services contacted" | **CORRECTLY ABSENT** | The string does not exist. Every hit in the repository is a disclaimer stating it is never claimed. |

## Fixed in this phase

**"600 assertions across seven suites, all passing."** This was **UNSUPPORTED**.
Only six suites actually execute — **751 assertions, 0 failures**, measured
2026-09-12 (`app/docs/measured.json`). The seventh — 22 payment checks in
`app/scripts/razorpay-test.mjs` — needs no Razorpay account (it starts its own
local stub of the Orders API and signs webhooks with a stub secret), but it
refuses to run unless the API was started separately with
`PAYMENTS_PROVIDER=razorpay` pointed at that stub. It is outside every npm test
run, was not executed, and is not counted. Claiming a suite passes when it was
not run is the exact failure mode this project is otherwise careful about.

Corrected in six places: `README.md`, `app/docs/ATTACK-PACK.md`,
`app/docs/TESTING.md`, `app/docs/DEMO-SCRIPT.md`,
`app/docs/PROJECT_OVERVIEW.md`, `app/docs/VIVA.md`, and the deck source
`ppt/part_final.py` (the testing slide is now titled "751 assertions, all
executed"). The deck was rebuilt and re-exported to PDF.

**"64 endpoints under `/v1`."** Imprecise when written, because the total and
the `/v1` share were conflated. The current count (`app/docs/measured.json`) is
**67 routes, 64 under `/v1`**, plus three infrastructure routes (`/tiles`,
`/basemap`, `/health`). Corrected in four documents.

## Nothing else required removal

The project's existing labelling discipline held up under a full-repository
search. The only genuinely unsupported claim was the test count, and it was
introduced by a suite becoming unrunnable rather than by exaggeration.
