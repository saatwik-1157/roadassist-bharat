# RoadAssist Bharat — cheat sheet

**Definition.** An AI-assisted, cloud-connected roadside assistance platform for
India whose emergency path keeps working when the network does not.

**One line.** *"RoadAssist doesn't stop when the network stops."*

---

### Architecture
PWA / Android / feature-phone SMS → **Fastify API** (65 routes, 61 under `/v1`,
zod at every boundary) → five modules (identity, fleet, service, ops, RAKSHA)
with **CI-enforced** boundaries → **PostgreSQL 16 + PostGIS 3.4**. Every vendor
behind an adapter with a local implementation → runs on **zero paid accounts**.

### Stack
Node 24 · Fastify 5 · zod · Drizzle · PostgreSQL 16 + PostGIS · plain HTML +
ES modules (no build step) · PWA (service worker, IndexedDB) · **SSE** ·
Leaflet + OSM (keyless) · Docker multi-stage non-root · Kotlin/Compose Android.

### Cloud model
**SaaS** provider (3 surfaces) + consumer (adapters) · **IaaS** partial
(compose) · **PaaS** conceptual · Deployment: public-cloud **target**, Indian
data residency. **Nothing is deployed.**
8 implemented · 5 partial · 8 design, of 21 concepts.

### Database
56 tables · 62 FKs · 138 indexes (5 GiST) · 5 checks · 84 unique indexes ·
5 migrations. Money in **integer paise**. Audit log **hash-chained and
append-only** — Postgres RULES make UPDATE/DELETE change nothing.

### AI
Deterministic rule table → cause, confidence, **severity 1–5**, driveable,
parts, advice. Labelled **`rules-1.0.0`** in every response. Model optional and
may make a verdict **stricter, never laxer**. CI fails if device and server
tables diverge. Separate trained **YOLO11n** for road damage.

### Dispatch
PostGIS KNN. Off-duty + already-committed excluded **in SQL**. Score =
**proximity 60% + rating 34% + newcomer bonus**. Wave of 5, **90 s TTL**,
escalates on timeout. **83.5 ms p50 / 124 ms p95.**
→ M4 **workload distribution + resource pooling + dynamic scheduling**.

### Offline
Connectivity measured (ONLINE / LIMITED / OFF-GRID), not `navigator.onLine`.
**Works:** GPS, diagnosis, cached tiles, local incident `RA-XXXXXX`.
**Queued:** the incident, unique client key.
**Needs network:** dispatch, tracking, ETA, payment, contacting anyone.
Storage: **AES-GCM-256 IndexedDB**, non-extractable key. Survives a tab close.

### SOS
Persist **before** draw. Every rung reported as fact. Offline → *"Nothing has
been transmitted"* + advise **112**. **112 is a stub** and the API says so.
**No satellite, no mesh, no SMS bypass.**

### Security
OTP + per-number/per-IP ceilings · JWT + refresh rotation with **theft
detection** · `bookingAudience()` ownership · RBAC · per-principal rate limits ·
zod everywhere · hash-chained audit · payment signature recomputed server-side.
**101 attacks, all refused. No independent pentest.**

### Payment
Invoice = labour + **18% GST**, server-computed. Amount **never** from the
request. Signature recomputed server-side. Forged → settles nothing. Replay →
no double charge. **Sandbox/stub only.**

### Testing
Unit **61** · E2E **189** · Gateway **26** · Concurrency **65** · Security **74**
· Browser **163** = **626 executed, 0 failures**, run twice. Plus a 15-beat
timed demo rehearsal. A 7th suite (22 payment checks) **needs a Razorpay
account and is not run — say so.**

### Limitations (say these before you are asked)
Nothing deployed · **single instance** (SSE registry, rate limiter, offer
sweeper are in-process) · 112 stubbed · payments stub-only · no backup
*schedule* · rules engine is not a model · no pentest.

### Future
Redis rate limiting → outbox→event bus for SSE → WAL archiving → then a host.
Those three are exactly what blocks a second instance.

---

### The five answers to have word-perfect

1. **"Is it really AI?"** → "The roadside engine is a rule table and we label it
   `rules-1.0.0`. The road-damage detector is a trained YOLO11n with measured
   metrics. I won't call the first one AI."
2. **"Where is the cloud?"** → "Consumed, not operated. Nothing is deployed, and
   I'd rather say that than point at a diagram."
3. **"Two mechanics accept at once?"** → "One wins. `SELECT … FOR UPDATE` on the
   booking row, expiry checked inside the transaction. Ten simultaneous
   accepts: one winner, nine refusals."
4. **"Can SOS reach emergency services offline?"** → "**No.** No satellite, no
   mesh, no SMS bypass. It says nothing was transmitted and tells you to call
   112."
5. **"Biggest limitation?"** → "Single instance. Three in-process components,
   each documented with its fix."

### The answer formula
**Direct answer → RoadAssist example → technical evidence → limitation →
future improvement.** Never answer beyond the implementation.

### Demo must-shows
Diagnosis badge · dispatch offers · real-time without touching the customer
window · **close the tab offline and reopen it** · re-sync creating no duplicate.
