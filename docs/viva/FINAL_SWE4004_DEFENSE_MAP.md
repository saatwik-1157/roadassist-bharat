> Answer "where is this implemented?" in under ten seconds.
> Full reasoning: `SWE4004_IMPLEMENTATION_MAPPING_FINAL.md`.

# Final SWE4004 defense map

| Module | Topic | Status | Code | Screenshot | One sentence |
|---|---|---|---|---|---|
| 1 | Cloud characteristics | PARTIAL | `server.ts`, `/v1/telecom/sms` | 03-home | "Broad network access is real — browser, PWA, Android and a feature phone over SMS on one API." |
| 1 | Service models | IMPLEMENTED | `providers.ts` | — | "SaaS to three user classes, and a SaaS consumer through adapters that each have a local implementation." |
| 1 | Deployment model | PARTIAL | ADR-0001, `render.yaml` | — | "Public cloud: the demo runs on one Render service with Neon Postgres, both in Singapore because the free tiers have no India region. An India region is the production target." |
| 1 | Benefits | IMPLEMENTED | `env.ts` | — | "Cost proportionality: the whole platform runs on zero paid accounts." |
| 1 | Risks | IMPLEMENTED | ADR-0009 | 09-offgrid-sos | "Connectivity dependence is the risk, and Off-Grid Mode is the mitigation." |
| 1 | Roles / boundaries | IMPLEMENTED | `check-boundaries.mjs` | terminal | "A cross-module import fails the build." |
| 2 | Data centre | PARTIAL | `docker-compose.prod.yml` | — | "Private network; the database port is not published in production." |
| 2 | Virtualization | IMPLEMENTED | `app/Dockerfile` | terminal | "Four-stage image, non-root, tini as PID 1 — and the suite passes against the image." |
| 2 | Web technology | IMPLEMENTED | `realtime.ts`, `sw.js` | 07-offline-banner | "REST plus SSE plus a PWA with a service worker." |
| 2 | Multitenancy | IMPLEMENTED | `security-audit.mjs` | terminal | "Row-level tenancy, proven by twelve refused cross-tenant attacks." |
| 2 | Service technology | IMPLEMENTED | `errors.ts` | — | "Versioned contract, zod at every boundary, idempotency keys." |
| 3 | Network perimeter | PARTIAL | `docker-compose.prod.yml` | — | "Container isolation and a private network locally; the demo is one Render web service with no VPC or security groups of our own." |
| 3 | Virtual server | IMPLEMENTED | `app/Dockerfile` | terminal | "The container image is the virtual server, and it is tested as one." |
| 3 | Cloud storage | PARTIAL | `offline-store.js` | 10-offgrid-screen | "Three forms — block, file, and encrypted client-side IndexedDB." |
| 3 | Usage monitoring | PARTIAL | `observability.ts` | `/v1/ops/overview` | "Correlation ids, operation timing, health, live counts — no external APM." |
| 3 | Resource replication | CONCEPTUAL | `realtime.ts` | — | "Not built. The API is stateless, but three in-process components would break it." |
| 4 | **Workload distribution** | **IMPLEMENTED** | `apps/api/src/dispatch.ts:77` | 05-dispatch | "Dispatch ranks and distributes jobs across the provider pool." |
| 4 | **Resource pooling** | **IMPLEMENTED** | `findCandidates()` | 05-dispatch | "Six hundred mechanics; off-duty and busy excluded in SQL before ranking." |
| 4 | Dynamic scalability | CONCEPTUAL | `apps/api/src/server.ts:360` | health 503 | "Only the readiness gate is real — health 503 while ping stays 200." |
| 4 | Elastic capacity | TARGET | — | — | "Not built." |
| 4 | Service load balancing | PARTIAL | `dispatch.ts` | 05-dispatch | "No infrastructure balancer; workload distribution across a pool is real." |
| 4 | Cloud bursting | TARGET | — | — | "Modelled on a slide, labelled modelled." |
| 4 | Elastic disk | TARGET | — | — | "Not built." |
| 4 | Redundant storage | PARTIAL | `DEPLOYMENT.md` | — | "Restore is rehearsed and measured; redundancy and scheduling are not built." |
| 4 | Migration | IMPLEMENTED | `packages/db/drizzle/` | terminal | "Seven versioned additive migrations, run from an empty database." |
| 4 | **Static scheduling** | **IMPLEMENTED** | `OFFER_SWEEP_SECONDS` | — | "The offer sweeper on a fixed interval." |
| 4 | **Dynamic scheduling** | **IMPLEMENTED** | `dispatch.ts` | 05-dispatch | "Run time, from a pool, by live state, re-scheduled on timeout." |

**Tally: 14 implemented · 8 partial · 2 conceptual · 3 target** (27 rows).
Lead with the four bolded Module 4 rows — they are the strongest evidence you have.
