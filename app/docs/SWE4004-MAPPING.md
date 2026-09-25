# SWE4004 — syllabus mapping and cloud-concept audit

**Rule for this document:** a topic is mapped to a feature only where the
implementation genuinely supports it. Where the project has a *design* and not
an implementation, it says `DESIGN` and points at the file that reasons about
it. Forcing a feature into a syllabus box is how a viva goes wrong.

Course: SWE4004 Cloud Computing and Applications · Dr. Nagendra Panini Challa.
Terminology follows the project's existing decks (Modules 1–6).

---

## Cloud-concept audit

| # | Concept | Status | Where, exactly |
|---|---|---|---|
| 1 | **Cloud characteristics** (on-demand, broad access, pooling, elasticity, measured) | **PARTIAL** | Broad network access and resource pooling are real: one API serves browser, PWA, the native Android app and feature phones over SMS, and dispatch pools providers. On-demand self-service is consumed for real (the Render service and Neon database were provisioned from a dashboard, no ticket); rapid elasticity is not — one free-plan instance, no autoscaling — and we meter nothing ourselves. |
| 2 | **IaaS** | **PARTIAL** | `docker-compose.yml` / `docker-compose.prod.yml` are a local stand-in for the compute + network + storage tier: PostGIS, Redis, Redpanda as separately-provisioned services on a private network. No cloud IaaS is provisioned — the deployment is on PaaS (row 3). |
| 3 | **PaaS** | **IMPLEMENTED (as consumer)** | Deployed: one Render web service (Docker, free plan, region Singapore, `render.yaml`) runs the API and every web surface in one container, on a managed Neon Postgres + PostGIS database (Singapore). Live at `app.roadassistbharat.online`. Single instance, `NODE_ENV=demo`, sleeps after 15 min idle. |
| 4 | **SaaS** | **IMPLEMENTED (as consumer)** | The platform consumes SaaS through adapters: SMS (Twilio/MSG91), payments (Razorpay), tiles (OSM), email (Resend, live on the deployment for operator alerts and email sign-in codes). `providers.ts` — each has a local implementation so the whole system runs with zero third-party accounts. |
| 5 | **Deployment models** (public/private/community/hybrid) | **PARTIAL** | Public cloud, deployed — but in Singapore (Render + Neon), because the free tiers offer no India region. The charter's Indian-region constraint ("No PII leaves India") is the production target (e.g. Mumbai), not true of the demo: every visitor's request reaches the Singapore host. |
| 6 | **Virtualization** | **IMPLEMENTED (container-level)** | OS-level virtualization: `Dockerfile` (multi-stage, non-root, tini PID 1), five service containers. Hardware virtualization is the layer beneath, which we consume rather than operate. |
| 7 | **Multitenancy** | **IMPLEMENTED** | Row-level tenancy on a shared schema. Every read is scoped by `user_id`; `gov_jurisdictions`/`gov_officers` scope the authority tenant. **Proven, not asserted:** `security-audit.mjs` §1 runs 12 cross-tenant attacks, all refused. |
| 8 | **Web technology** | **IMPLEMENTED** | REST over HTTP with a uniform `{data, meta}` / `{error}` envelope; **SSE** for real-time (not WebSocket — reasoned in ADR-0010); a PWA with a service worker and manifest. |
| 9 | **Service technology** | **IMPLEMENTED** | Versioned `/v1` contract, 67 routes (64 under `/v1`), schema validation at every boundary (zod), stable error codes (`errors.ts`), idempotency keys on every replayable operation. |
| 10 | **Cloud storage** | **PARTIAL** | Block storage for the database (Docker volume locally; Neon's managed storage on the deployment), file storage for hazard photos (`UPLOAD_DIR`, ADR-0006 keeps only the reference in the DB — ephemeral on the free Render tier), and **client-side storage** — IndexedDB with AES-GCM at rest, which is the genuinely novel part. Object storage is `DESIGN`. |
| 11 | **Cloud monitoring** | **PARTIAL** | Real: structured JSON logs with a per-request correlation id, operation-level logging with duration/result (`observability.ts`), `/health` (application vs database), `/v1/ping`, `/v1/ops/overview` with live counts and a live audit-chain verification. No external APM. |
| 12 | **Resource replication** | **DESIGN** | Stateless API by design (session state is in the JWT, not in memory), which is the precondition for replication. Nothing is replicated today, and the three things that would break — the in-process SSE registry, the in-process rate limiter and the in-process offer sweeper — are documented at their definitions. |
| 13 | **Dynamic scalability** | **DESIGN** | Reasoned in ADR-0001 and the deck. One real component of it exists: the readiness gate — `/health` answers **503** when the database is unreachable, so an orchestrator removes the instance — and it is Render's configured `healthCheckPath`. Verified. |
| 14 | **Load balancing** | **DESIGN (infrastructure) / IMPLEMENTED (application)** | No infrastructure load balancer. But *workload distribution* — the syllabus's own framing — is exactly what the dispatch engine does: rank providers by proximity, rating, experience and exploration, then distribute the job. That is real, and it is the honest mapping. |
| 15 | **Cloud bursting** | **DESIGN** | A modelled scenario in the deck, now labelled as modelled. |
| 16 | **Elastic resource capacity** | **DESIGN** | — |
| 17 | **Elastic disk provisioning** | **DESIGN** | — |
| 18 | **Redundant storage** | **DESIGN** | Backup and restore are **rehearsed and measured** (dump 1.2 s, restore 7.2 s, audit hash chain verified intact across 639 entries on the restored copy) and automated as a CI step. What is still `DESIGN` is the *redundancy* itself: there is one node, no replica and no failover. RPO stays a **TARGET** because no backup schedule is configured. |
| 19 | **Migration** | **IMPLEMENTED (schema) / DESIGN (workload)** | Schema migration is real and rehearsed: seven versioned migrations, run from an empty database in this audit, all additive (no column dropped or retyped; 0002 rebuilds one unique index to key it per device) so an older image runs against a newer schema. The deployment migrates on every boot. Live workload migration is design. |
| 20 | **Static scheduling** | **IMPLEMENTED** | The offer sweeper on a fixed interval (`OFFER_SWEEP_SECONDS`); the client's booking poll; the SSE heartbeat. |
| 21 | **Dynamic scheduling** | **IMPLEMENTED** | The dispatch ladder is genuine dynamic scheduling: work is assigned at run time from a pool, by a score computed from live state, with timeout-driven re-scheduling to the next wave when a provider does not respond. `dispatch.ts`. |

**Summary:** 9 implemented, 6 partial, 6 design. (It read 8 / 5 / 8 before the
Render + Neon deployment moved PaaS to implemented and deployment models to
partial.) The six `DESIGN` entries are all infrastructure the project has not
provisioned — replication, autoscaling, load balancing, bursting, elastic
capacity and disks, redundant storage — and saying so is the defensible
position.

---

## Module mapping

### Module 1 — Cloud concepts, characteristics, models

| Topic | Feature | Code | Status |
|---|---|---|---|
| Service models | Adapter pattern over SaaS vendors, each with a local fallback | `apps/api/src/providers.ts` | IMPLEMENTED |
| Deployment models | Public cloud, deployed in Singapore (Render + Neon); Indian data residency is the production target | `render.yaml`, `docs/00-team-charter.md`, ADR-0001 | PARTIAL |
| Characteristics | Broad network access — one platform, five client types | `apps/web/`, `mobile/`, `/v1/telecom/sms` | IMPLEMENTED |
| Business drivers | Cost proportionality; the platform runs on zero paid accounts by default | `providers.ts`, `env.ts` | IMPLEMENTED |

**The explanation to give:** RoadAssist is a *cloud consumer* on IaaS and PaaS
and a *cloud provider* to its own users (SaaS). Every third-party dependency is
behind an adapter with a local implementation, so vendor lock-in is an
environment variable rather than a rewrite — that is the practical form of the
portability characteristic.

### Module 2 — Enabling technologies

| Topic | Feature | Code | Status |
|---|---|---|---|
| Virtualization | Multi-stage container, non-root, tini, healthcheck | `app/Dockerfile` | IMPLEMENTED |
| Data-centre technology | Compose stack: PostGIS + Redis + Redpanda on a private network, DB port not published in prod | `docker-compose.prod.yml` | PARTIAL |
| Web technology | REST + SSE + PWA with a service worker | `server.ts`, `realtime.ts`, `sw.js` | IMPLEMENTED |
| Multitenancy | Row-scoped shared schema, 12 cross-tenant attacks refused | `security-audit.mjs` | IMPLEMENTED |
| Service technology | Versioned contract, zod validation, idempotency keys | `server.ts`, `errors.ts` | IMPLEMENTED |

### Module 3 — Infrastructure mechanisms

| Topic | Feature | Code | Status |
|---|---|---|---|
| Virtual server | Container image, runs anywhere Docker runs — including the Render web service it is deployed on | `Dockerfile`, `render.yaml` | IMPLEMENTED |
| Cloud storage device | Postgres volume, upload volume, client IndexedDB | `docker-compose.prod.yml`, `offline-store.js` | IMPLEMENTED |
| Cloud usage monitor | Structured logs, correlation ids, `/v1/ops/overview` | `observability.ts` | PARTIAL |
| Ready-made environment | One-command bring-up: compose → migrate → seed → start | `README.md`, `DEPLOYMENT.md` | IMPLEMENTED |
| Network perimeter | Database has no published port; API on loopback behind a proxy; CORS allowlist enforced in production | `docker-compose.prod.yml`, `env.ts` | PARTIAL |

### Module 4 — Fundamental cloud architectures

| Architecture | Status | Honest position |
|---|---|---|
| Workload distribution | **IMPLEMENTED** | The dispatch engine distributes jobs across a provider pool by computed score |
| Resource pooling | **IMPLEMENTED** | Providers are a pool; state is derived, and busy members are excluded |
| Dynamic scalability | DESIGN | Readiness gate (503 on DB failure) is the one built component |
| Elastic resource capacity | DESIGN | — |
| Service load balancing | DESIGN | — |
| Cloud bursting | DESIGN | Modelled scenario, labelled as modelled |
| Elastic disk provisioning | DESIGN | — |
| Redundant storage | DESIGN | Redundancy itself is design — one node, no replica. The backup/restore procedure IS rehearsed, measured and in CI. |

**Do not claim eight.** Claim two, demonstrate them, and be precise about the
other six. That is a stronger answer.

### Module 5 — Cloud operations, provider and consumer perspectives

| Topic | Feature | Code | Status |
|---|---|---|---|
| SLA thinking | Degraded-mode matrix + a 20-row failure matrix, each row naming the suite that proves it | `docs/architecture/failure-matrix.md` | IMPLEMENTED |
| Monitoring & audit | Hash-chained tamper-evident audit log, verified live | `audit.ts`, `/v1/ops/overview` | IMPLEMENTED |
| Consumer perspective | Managed services consumed through adapters | `providers.ts` | IMPLEMENTED |
| Provider perspective | We are the SaaS provider to citizens, mechanics and authorities | The three web surfaces | IMPLEMENTED |
| Cost | Cost categories documented; no invented prices | `DEPLOYMENT.md` §Cost | IMPLEMENTED |

### Module 6 — Cloud security

| Topic | Feature | Code | Status |
|---|---|---|---|
| Threat modelling | STRIDE, 20 threats mapped to controls | `docs/security/threat-model.md` | IMPLEMENTED |
| Authentication | OTP → JWT, rotating refresh with reuse detection; protected accounts (admin, RAKSHA officer, listed mechanics) sign in by emailed code only — their phone path returns `403 email_signin_required` | `auth.ts`, `domain/email-signin.ts` | IMPLEMENTED |
| Authorization / RBAC | Role gates + per-resource ownership checks | `server.ts` | IMPLEMENTED |
| Encryption | TLS in transit (proxy), AES-GCM-256 at rest on the device | `offline-store.js` | PARTIAL — no column-level encryption at rest in Postgres |
| Auditing | Hash-chained append-only log, DB rules block UPDATE/DELETE | `audit.ts`, `migrate.ts` | IMPLEMENTED |
| Privacy | Log redaction of credentials, OTP, phone numbers, medical fields, coordinates | `observability.ts` + tests | IMPLEMENTED |
| Data residency | `check-data-residency.mjs` fails the build if a page we serve loads a third-party subresource (only `checkout.razorpay.com` is allowed), if a server-side outbound host is undeclared — each is declared with its region: MSG91 and Razorpay India, OSM tiles EU, Open-Meteo Germany, Resend USA (email processor: masked number, role, event, time; sign-in codes to the listed address), Twilio USA (optional), figshare (training time only) — if an analytics/crash SDK appears, or if PII goes into a query string. It does **not** check where the platform itself is hosted: the demo runs in Singapore, so visitors' requests leave India | `scripts/check-data-residency.mjs` | PARTIAL — egress controls implemented; India-region hosting (e.g. Mumbai) is the production target |
| Penetration testing | 74 attacks, all refused — self-written, not an external pen test | `scripts/security-audit.mjs` | IMPLEMENTED (self-audit) |

---

## Current architecture vs target — never mixed

### CURRENT (what runs today, verified)

```
Browser / PWA / native Android app / feature phone (SMS)
        │
        ▼
┌──────────────────────────────────────────────┐
│ ONE container — Render web service           │
│  (free plan, Singapore) · locally roadassist │
│  Fastify API (67 endpoints, 64 under /v1)    │
│  ├─ auth · booking · dispatch · SOS          │
│  ├─ emergency routes (same process)          │
│  ├─ SSE /v1/events (in-process registry)     │
│  ├─ offer sweeper (in-process timer)         │
│  ├─ rate limiter (in-process windows)        │
│  └─ static: citizen app, mechanic, authority │
└───────────────────┬──────────────────────────┘
                    ▼
   PostgreSQL + PostGIS — Neon, Singapore (locally one Docker node)
```

Live at `https://app.roadassistbharat.online`; the static showcase is on GitHub
Pages at `https://roadassistbharat.online`. Email goes out through Resend.

Plus, on the device: connectivity manager, rules engine, encrypted IndexedDB
journal, cached tiles.

### TARGET (designed, not provisioned)

```
Users → CDN → Load balancer (TLS)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   API replicas (N)      Emergency service
   stateless, HPA        separate deployable (ADR-0005)
        │                       │
        ├──── Redis ────────────┤   rate limits + SSE fan-out
        ├──── Redpanda ─────────┤   outbox_events
        ▼                       ▼
   Managed Postgres + PostGIS, multi-AZ, read replicas
        │
   Object storage · WAL archive · APM
```

**The gap between the two is the honest answer to "how would you scale this?"**
Three things block replication today, all named at their definitions: the SSE
registry, the rate limiter and the offer sweeper are in-process. The fix for
each is already designed.
