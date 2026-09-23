> Generated 2026-09-06 from the actual repository. Classifications are
> consistent with `app/docs/SWE4004-MAPPING.md`, which carries the full
> reasoning; this file adds the one thing that document does not — exactly
> where to point during the viva.

# SWE4004 — implementation mapping, Modules 1–4

Four labels, used strictly:
**IMPLEMENTED** — runs, and can be shown ·
**PARTIAL** — real in part, with the missing half named ·
**CONCEPTUAL** — reasoned and documented, not built ·
**TARGET** — future work.

---

## Module 1 — Fundamentals

| Topic | Status | Where to show the professor |
|---|---|---|
| Cloud characteristics | **PARTIAL** | Broad network access is real and demonstrable: one API serves a browser, a PWA, an Android WebView and a **feature phone over SMS**. Show `apps/web/`, `mobile/`, and `POST /v1/telecom/sms` in `server.ts`. On-demand self-service and measured usage are consumed in design only. |
| Service models — SaaS | **IMPLEMENTED (as provider and consumer)** | Provider to three user classes: `app.html`, `mechanic.html`, `raksha.html`. Consumer through adapters: `apps/api/src/providers.ts` — SMS, payments, tiles, email, each with a local implementation so the platform runs on zero paid accounts. |
| Service models — IaaS | **PARTIAL** | `docker-compose.yml` / `docker-compose.prod.yml`: PostGIS, Redis, Redpanda as separately provisioned services on a private network. No cloud IaaS is provisioned. |
| Service models — PaaS | **CONCEPTUAL** | Managed Postgres + managed container platform, reasoned in ADR-0001. Nothing deployed. |
| Deployment model | **CONCEPTUAL** | Public cloud with an Indian data-residency constraint ("no PII leaves India") — `docs/00-team-charter.md`, ADR-0001. |
| Cloud benefits | **IMPLEMENTED (cost)** | Cost proportionality is real: the whole platform runs with no paid account by default. Show `providers.ts` and `env.ts` defaults. |
| Cloud risks | **IMPLEMENTED (mitigated)** | The project's whole thesis. Show Off-Grid Mode: `offline-engine.js`, `offline-store.js`, `connectivity.js`, and ADR-0009. Reduced operational control and connectivity dependence are the risks; the offline path is the mitigation. |
| Roles and boundaries | **IMPLEMENTED** | Five modules in one deployable with **CI-enforced** boundaries: `scripts/check-boundaries.mjs` fails the build on a cross-module import. Run it live. |

---

## Module 2 — Cloud-enabling technology

| Topic | Status | Where to show the professor |
|---|---|---|
| Data centre technology | **PARTIAL** | `docker-compose.prod.yml` — private network, **database port not published**. Point at that line specifically; it is a deliberate decision, not an omission. |
| Virtualization | **IMPLEMENTED (OS-level)** | `app/Dockerfile`: four stages, non-root uid 1000, `tini` as PID 1, a real `HEALTHCHECK`. Hardware virtualization is the layer beneath, which we consume. |
| Web technology | **IMPLEMENTED** | REST with a uniform `{data, meta}` / `{error}` envelope; **SSE** for real-time — not WebSocket, and ADR-0010 says why; a PWA with `sw.js` and `manifest.webmanifest`. |
| Multitenancy | **IMPLEMENTED** | Row-level tenancy on a shared schema, every read scoped by `user_id`. **Proven, not asserted:** `scripts/security-audit.mjs` runs 12 cross-tenant attacks and all are refused. Run it in front of them. |
| Service technology | **IMPLEMENTED** | Versioned `/v1` contract — 65 routes, 61 under `/v1` — zod validation at every boundary, stable error codes in `errors.ts`, idempotency keys on every replayable operation. |

---

## Module 3 — Infrastructure mechanisms

| Topic | Status | Where to show the professor |
|---|---|---|
| Network perimeter / virtual server | **PARTIAL** | Container isolation and a private compose network; production publishes no database port. No VPC, no security groups — nothing is deployed. |
| Cloud storage | **PARTIAL** | Three real forms: block (the database volume), file (`UPLOAD_DIR` for hazard photos, ADR-0006 keeps only the reference in the database), and **client-side** — IndexedDB encrypted with AES-GCM-256 under a non-extractable key. The third is the interesting one and it is genuinely implemented. Object storage is TARGET. |
| Cloud usage monitoring | **PARTIAL** | Structured JSON logs with a per-request correlation id; `observability.ts` logs operation, duration and result with a redaction denylist; `/health` separates application from database; `/v1/ops/overview` shows live counts and verifies the audit hash chain. No external APM. |
| Resource replication | **CONCEPTUAL** | The *precondition* is built — the API is stateless, session state lives in the JWT. Say plainly that the three things which would break replication today are the in-process SSE registry, rate limiter and offer sweeper, each documented at its definition. Naming them is stronger than claiming replication. |

---

## Module 4 — Specialised mechanisms

| Topic | Status | Where to show the professor |
|---|---|---|
| **Workload distribution** | **IMPLEMENTED** | This is the strongest Module 4 card. Dispatch ranks providers by proximity, rating, experience and an exploration bonus, then distributes the job — `apps/api/src/dispatch.ts`. Measured at 83.5 ms p50 / 124 ms p95. |
| **Resource pooling** | **IMPLEMENTED** | 600 mechanics are a pool; `findCandidates` excludes off-duty and already-committed providers in SQL, then allocates. Show the query. |
| Dynamic scalability | **CONCEPTUAL** | One real component exists: the readiness gate. Stop PostgreSQL and show `/health` return **503** while `/v1/ping` still returns 200 — that is what lets an orchestrator remove an instance. The autoscaler itself is not provisioned. |
| Elastic resource capacity | **TARGET** | Not built. Say so. |
| Service load balancing | **CONCEPTUAL (infra) / IMPLEMENTED (application)** | No infrastructure load balancer. But the syllabus's own framing — distributing work across a pool of service providers — is exactly what dispatch does. That is the honest mapping and it is defensible. |
| Cloud bursting | **TARGET** | A modelled scenario on the deck, labelled as modelled. |
| Elastic disk provisioning | **TARGET** | Not built. |
| **Redundant storage** | **PARTIAL** | Backup and restore are **rehearsed and measured** — dump 1.2 s, restore 7.2 s, audit hash chain re-verified intact across 639 entries on the restored copy. What is still design is the *redundancy*: one node, no replica, no failover, and no backup schedule. |
| **Migration** | **IMPLEMENTED (schema)** | Five versioned migrations, run from an empty database during this verification, all additive so an older image runs against a newer schema. Show `npm run db:migrate` on a fresh database. Workload migration is TARGET. |
| **Static scheduling** | **IMPLEMENTED** | The offer sweeper on a fixed interval (`OFFER_SWEEP_SECONDS`), the client booking poll, the 25 s SSE heartbeat. |
| **Dynamic scheduling** | **IMPLEMENTED** | The dispatch ladder: work assigned at run time from a pool, by a score computed from live state, with **timeout-driven re-scheduling** to the next wave when a provider does not answer. This is the textbook definition, and it is real. |

---

## The honest summary to give in one sentence

> Eight concepts are implemented, five partial, eight designed and not
> provisioned. The eight are infrastructure we have not bought. What we did
> build is the part that matters most for this problem: the platform keeps
> working when *the user's* network fails, which is the failure that actually
> happens on a highway.
