> Generated 2026-09-06 from the actual repository. Every claim word was searched for across the whole repository — code, docs, UI strings and the deck source.

# Claim verification

Four verdicts: **SUPPORTED** (code backs it) · **PARTIAL** (true with a stated
limit) · **CONCEPTUAL** (designed, labelled as such) · **UNSUPPORTED** (must be
removed or rewritten).

| Claim | Verdict | Basis |
|---|---|---|
| "AI-powered" | **PARTIAL — and labelled everywhere** | The roadside engine is deterministic rules, returned as `rules-1.0.0` in every response and shown on screen. A genuinely trained YOLO11n road-damage detector exists with measured metrics. The project explicitly refuses to call the rules engine AI. |
| "Cloud-native" | **PARTIAL** | Containerised, stateless, config-through-environment, readiness gate. Not deployed to any cloud. |
| "Scalable" | **CONCEPTUAL** | The preconditions are built; the scaling is not provisioned. Three in-process components are named as the blockers. |
| "Real-time" | **SUPPORTED** | SSE, measured: connect → first frame 5.2 ms p50; customer screen follows a mechanic's action in 0.8–1.4 s. Documented as SSE, not WebSocket. |
| "Offline-first" | **SUPPORTED** | Connectivity manager, on-device rules engine, encrypted IndexedDB, sync journal, service worker. Proven by closing the tab and reopening it. |
| "Emergency" | **SUPPORTED, with the limit stated** | A real SOS path with an escalation ladder that reports each rung as fact. 112 is a stub and the API's own response says so. |
| "Secure" | **SUPPORTED** | 100 attack assertions across two suites, all refused. No independent pentest, and the project says so. |
| "Encrypted" | **SUPPORTED** | AES-GCM-256 with a non-extractable `CryptoKey` for offline incidents. Claimed only about client-side storage, which is where it is true. |
| "Highly available" | **ABSENT** | Zero occurrences. Correctly never claimed. |
| "Fault tolerant" | **ABSENT** | Zero occurrences. Correctly never claimed. |
| "Production ready" | **ABSENT** | Zero occurrences. Every document says the opposite. |
| "Deployed" | **PARTIAL** | 48 occurrences, all in the form "not deployed" / "would be deployed" / deployment *instructions*. No claim that anything is running in a cloud. |
| "99.9% uptime" | **CONCEPTUAL — flagged** | 11 occurrences, all inside `docs/01-master-roadmap.md` and `docs/05-devops-qa-lead-roadmap.md` as **SLO target tables** written before the build. They are planning targets, not measurements. See the marks-loss audit — a reader could mistake them for claims. |
| "Zero downtime" | **CONCEPTUAL** | 2 occurrences, both future demo goals in planning documents. |
| "Satellite" | **CONCEPTUAL — correctly labelled** | 20 occurrences, every one saying satellite/mesh is **not implemented** and is future work. |
| "Kubernetes" | **CONCEPTUAL** | 25 occurrences, all as target architecture. ADR-0001 explains why four developers should not operate a cluster. |
| "Auto-scaling" | **CONCEPTUAL** | 32 occurrences, all labelled DESIGN/TARGET. The deck slide says DESIGN. |
| "Load balancing" | **PARTIAL** | 49 occurrences. Infrastructure LB: not built. *Workload distribution* across a provider pool: genuinely built, and that is the syllabus's own framing. |
| "Emergency services contacted" | **CORRECTLY ABSENT** | The string does not exist. Every hit in the repository is a disclaimer stating it is never claimed. |

## Fixed in this phase

**"600 assertions across seven suites, all passing."** This was **UNSUPPORTED**.
Only 626 assertions across six suites actually execute; the seventh — 22
payment-gateway checks — requires a Razorpay sandbox account and refuses to run
without one. Claiming a suite passes when it cannot run is the exact failure
mode this project is otherwise careful about.

Corrected in six places: `README.md`, `app/docs/ATTACK-PACK.md`,
`app/docs/TESTING.md`, `app/docs/DEMO-SCRIPT.md`,
`app/docs/PROJECT_OVERVIEW.md`, `app/docs/VIVA.md`, and the deck source
`ppt/part_final.py` (slide retitled "626 assertions, all executed"). The deck
was rebuilt and re-exported to PDF.

**"64 endpoints under `/v1`."** Imprecise. There are 64 route registrations, 61
of them under `/v1` (the others are `/health` and two tile routes). Corrected in
four documents.

## Nothing else required removal

The project's existing labelling discipline held up under a full-repository
search. The only genuinely unsupported claim was the test count, and it was
introduced by a suite becoming unrunnable rather than by exaggeration.
