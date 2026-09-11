> Content for all 32 slides, written from the actual implementation on
> 2026-09-06. Every number here was produced by a run. Where the current deck
> already carries a slide, the mapping column says which one — I have not
> rebuilt a verified artifact to reorder it. See **Gap analysis** at the end.

# Final presentation plan — 32 slides

## The positioning line

> **"RoadAssist Bharat is an AI-powered, cloud-connected, network-resilient
> roadside assistance platform."**

**Use it — with one qualification you must make within the first three
minutes.** "AI-powered" is only defensible because the deck labels the roadside
engine as a deterministic rule table (`rules-1.0.0`) on slide 18, and because a
genuinely trained YOLO11n road-damage detector exists with measured metrics.
Say "AI-powered" on slide 1 and you owe the room slide 18. Deliver it and the
claim stands; skip it and it is marketing.

"Cloud-connected" is accurate. "Cloud-native" or "cloud-deployed" would not be.

---

| # | Slide | Content | In current deck |
|---|---|---|---|
| 1 | **Title** | RoadAssist Bharat · AI-Powered, Cloud-Connected, Network-Resilient Roadside Assistance · SWE4004 | **1** ✅ |
| 2 | **The problem** | Breakdowns are dangerous where help is slowest. Assistance is delayed and manually coordinated. Providers are fragmented — no shared availability. **Connectivity is worst exactly where breakdowns are most dangerous.** No triage: a flat tyre and a crash enter the same queue. | **2** ✅ |
| 3 | **Motivation** | Four things roadside assistance lacks: **intelligence** (triage before dispatch), **coordination** (one pool, not scattered numbers), **visibility** (the driver knows nothing after the call), **resilience** (the app needs the network the driver has lost). The fourth is the one nobody solves. | ⬜ **add** |
| 4 | **Existing system** | Manual phone coordination · static or nearest-only assignment · no live status · total network dependence · fragmented, unverified providers · no audit trail. | ⬜ **add** |
| 5 | **Proposed system** | Driver → Incident → AI diagnosis → Dynamic dispatch → Mechanic → Resolution → Payment. With a second path branching at Incident: **no network → local incident → queue → sync**. | **3** ✅ |
| 6 | **Objectives** | Rapid assistance · intelligent incident handling · dynamic provider matching · real-time visibility · secure server-authoritative payment · **offline resilience** · cloud-ready architecture. | ⬜ **add** |
| 7 | **Users and roles** | **Customer** — own vehicles, bookings, incidents, payments; cannot issue mechanic commands. **Mechanic** — assigned jobs only; cannot cancel or pay. **Admin/authority** — RAKSHA dashboard, audit log, device registration. **System/AI** — may raise a signal, **may never dispatch or escalate** (ADR-0005). Enforced by `bookingAudience()` and role filters, proven by 12 refused cross-tenant attacks. | ⬜ **add** |
| 8 | **High-level architecture** | PWA / Android / feature phone → Fastify API (64 routes, 61 under `/v1`, zod at every boundary) → five modules (identity, fleet, service, ops, RAKSHA) with **CI-enforced** boundaries → PostgreSQL 16 + PostGIS. External vendors behind adapters, each with a local implementation. | **5** ✅ |
| 9 | **Cloud architecture — CURRENT vs TARGET** | **CURRENT:** one container, one PostGIS database, compose stack (PostGIS + Redis + Redpanda) on a private network, structured logs, `/health` readiness gate. **TARGET:** managed Postgres, container platform, load balancer, replicas, object storage. Two columns, clearly separated. | **6** partial — add the two-column split |
| 10 | **Technology stack** | Frontend: plain HTML + ES modules, PWA (service worker, manifest) — no framework, no build step. Backend: Node 24, Fastify 5, zod, Drizzle ORM. DB: PostgreSQL 16 + PostGIS 3.4. Maps: Leaflet + OpenStreetMap, bundled locally, **no account needed**. Auth: OTP + JWT with refresh rotation. Real-time: **Server-Sent Events**. AI: deterministic rules engine + trained YOLO11n. Payment: Razorpay adapter (sandbox/stub). Containers: Docker multi-stage, non-root, tini. Mobile: Kotlin + Jetpack Compose. | ⬜ **add** |
| 11 | **Cloud service model** | **SaaS — provider**: three surfaces to three user classes. **SaaS — consumer**: SMS, payments, tiles, email behind adapters (`providers.ts`). **IaaS — partial**: compose stands in for the compute/network/storage tier; none provisioned in a cloud. **PaaS — conceptual**: managed Postgres + container platform, reasoned in ADR-0001. | ⬜ **add** |
| 12 | **Deployment model** | **CURRENT:** local/development — containerised, single instance, no cloud account. **TARGET:** public cloud, Indian data residency ("no PII leaves India"), managed Postgres, replicas. Say plainly: *nothing is deployed.* | ⬜ **add** |
| 13 | **Module 1** | Characteristics: broad network access **IMPLEMENTED** (browser, PWA, Android, feature phone over SMS); resource pooling **IMPLEMENTED** (600 mechanics). Benefits: cost proportionality — runs on zero paid accounts. Risks: connectivity dependence — **and the off-grid path is the mitigation**. Roles/boundaries **IMPLEMENTED** — CI fails on a cross-module import. | **19** ✅ |
| 14 | **Module 2** | Data centre **PARTIAL** · Virtualization **IMPLEMENTED** (4-stage Dockerfile, non-root uid 1000, tini PID 1, HEALTHCHECK) · Web technology **IMPLEMENTED** (REST + SSE + PWA) · Multitenancy **IMPLEMENTED** (row-scoped, 12 attacks refused) · Service technology **IMPLEMENTED** (versioned contract, zod, idempotency keys). | **20** ✅ |
| 15 | **Module 3** | Network perimeter **PARTIAL** (private compose network, DB port unpublished in prod) · Virtual server **IMPLEMENTED** (image; full suite passes against it) · Cloud storage **PARTIAL** — three real forms: block, file, and **client-side AES-GCM-256 IndexedDB** · Usage monitoring **PARTIAL** (correlation ids, `observability.ts`, `/health`, `/v1/ops/overview`) · Resource replication **CONCEPTUAL** — and name the three in-process blockers. | **21** ✅ |
| 16 | **Module 4** | **Workload distribution IMPLEMENTED** · **Resource pooling IMPLEMENTED** · **Static scheduling IMPLEMENTED** · **Dynamic scheduling IMPLEMENTED** · **Migration IMPLEMENTED (schema)** · Redundant storage PARTIAL (restore rehearsed, redundancy absent) · Dynamic scalability CONCEPTUAL (readiness gate is the one real piece) · Elastic capacity / disk / bursting / infra load balancing **TARGET**. | **22 + 23** ✅ |
| 17 | **Customer workflow** | Login → Vehicle → Incident → Location (confirmed, never taken silently) → AI diagnosis → Dispatch → Mechanic → Live tracking → Payment → History. 19 steps verified end to end. | ⬜ **add** |
| 18 | **AI diagnosis** | Input: free-text symptoms + optional OBD codes → zod validation → deterministic rule table → cause, confidence, severity, driveability, parts, advice → `modelVersion: "rules-1.0.0"` shown on screen. Two things worth defending: a remote model may make a verdict **stricter, never laxer**; and a CI test **fails the build** if the on-device table diverges from the server's. | **8** ✅ |
| 19 | **Incident intelligence** | Incident data → severity **1–5** → driveable / do-not-drive → recommended service pre-selected. Say 1–5, not LOW/MEDIUM/HIGH/CRITICAL — that is what the code returns. | **9** ✅ |
| 20 | **Dynamic dispatch** | Available providers (off-duty and already-committed excluded **in SQL**) → PostGIS KNN by distance → score = proximity 60% + rating 34% + newcomer bonus → wave of 5, 90 s TTL → escalate on timeout. Measured 83.5 ms p50 / 124 ms p95. | **10** ✅ |
| 21 | **Real-time** | Customer ↔ API ↔ Mechanic over **Server-Sent Events** — one long-lived GET, server→client only. **Not WebSocket**, and ADR-0010 says why. Persist first, publish second. Polling continues underneath: the stream is an accelerator, never the truth. 5.2 ms to first frame; customer follows a mechanic action in 0.8–1.4 s. | **12** ✅ |
| 22 | **Offline / off-grid** | ONLINE → network lost → OFF-GRID → local safety workflow → encrypted local storage + sync journal → network restored → sync → cloud. **"NO NETWORK ≠ NO SAFETY"** — then immediately the honest split: **works** (GPS, diagnosis, cached maps, local incident with its own reference); **queued** (the incident, with a unique client key); **needs network** (dispatch, tracking, ETA, payment, contacting anyone). | **7 + 15** ✅ |
| 23 | **SOS** | Normal → incident + escalation ladder, each rung reported as fact. Limited → attempt, then degrade. Offline → local incident, *"Nothing has been transmitted"*, advise calling 112. Reconnect → sync, no duplicate. **112 is a stub and the API response says so.** | **7 + 15** ✅ |
| 24 | **Database** | 56 tables · 62 foreign keys · 137 indexes (5 GiST) · 5 check constraints · 83 unique indexes. Names to show: `users`, `vehicles`, `bookings`, `incidents`, `mechanics`, `dispatch_offers`, `invoices`, `payments`, `audit_log`, `sync_operations`, `idempotency_keys`. Audit log is hash-chained and append-only — Postgres RULES make UPDATE and DELETE change nothing. | **18** ✅ |
| 25 | **Security** | OTP with per-number and per-IP ceilings · refresh rotation with reuse detected as theft · `bookingAudience()` ownership · RBAC · per-principal rate limiting · zod validation everywhere · hash-chained audit · payment signature recomputed server-side · webhook verification. **100 attacks across two suites, all refused.** | **17** ✅ |
| 26 | **Payment** | Invoice (server-computed: labour + 18% GST) → order created server-side **with that amount** → checkout → signature recomputed server-side → webhook → settlement. `payment.settled` is refused unless a settled payment covers the invoice. **Sandbox/stub only — no live gateway.** | **16** ✅ |
| 27 | **Failure handling** | Internet down → off-grid mode. Backend down → cached PWA shell; SOS degrades locally. **Database down → `/health` 503 while `/v1/ping` stays 200, automatic recovery.** GPS unavailable → approximate position, *labelled*. AI unavailable → rules fallback, `usedFallback: true`. Payment failed → no false success. Provider unavailable → `NO_SUPPLY` with a named reason. Real-time disconnected → 6 s poll floor. Sync failed → jittered retry, no duplicate. | **25** ✅ |
| 28 | **Testing** | Unit 98 · E2E 189 · Gateway security 26 · Concurrency/real-time 65 · Security attacks 74 · Browser journey 163 → **615 executed, 0 failures**. Plus a 15-beat timed demo rehearsal, nine clean runs. Performance measured (no p95 above 400 ms, 0% errors). **A seventh suite of 22 payment checks needs a Razorpay account and is not run — say so.** | **24** ✅ |
| 29 | **Implementation status** | GREEN implemented · AMBER partial · BLUE target. 8 implemented, 5 partial, 8 design across the 21 cloud concepts. | **26** ✅ |
| 30 | **Limitations** | Nothing deployed to a cloud · single instance (in-process SSE registry, rate limiter, offer sweeper) · 112 stubbed · payments stub-only · no backup schedule · rules engine is not a model · no independent penetration test. | **27** ✅ |
| 31 | **Future + startup potential** | Fleet command · predictive maintenance · provider network · insurer integration · road intelligence (RAKSHA) · Redis-backed rate limiting → replicas · multi-region · disaster recovery. **All labelled FUTURE.** | **28 + 29 + 30** ✅ |
| 32 | **Conclusion** | **"Intelligent assistance when the road fails. Resilient software when the network fails."** AI + Cloud + Dynamic Dispatch + Real-time + Offline Resilience. | **32** ✅ |

---

## Gap analysis — the honest recommendation

The current deck carries **25 of the 32** topics, several of them better than a
generic version would. Seven conventional academic slides are genuinely absent:
**Motivation (3), Existing System (4), Objectives (6), Users & Roles (7),
Technology Stack (10), Cloud Service Model (11), Deployment Model (12),
Customer Workflow (17)** — eight, counting slide 9's missing CURRENT/TARGET
split.

The deck also carries slides the requested structure does not ask for: Core
Idea, Why RoadAssist is different, Incident lifecycle, two screenshot slides,
Business model, Competitive advantage, and a demo slide.

**Recommendation: add the missing slides rather than rebuild.** The existing
deck passed a full claim audit at **0 RED** and its screenshots are real
captures asserted before the shutter. Rebuilding to reorder risks a verified
artifact for presentation convention. If your rubric requires the exact
sequence, the eight additions are mechanical — the content is written above,
ready to paste — and `python ppt/make_final.py` regenerates the deck.

**If you only add two, add Users & Roles (7) and Technology Stack (10).** Those
are the two an examiner most often looks for and the current deck genuinely
lacks.
