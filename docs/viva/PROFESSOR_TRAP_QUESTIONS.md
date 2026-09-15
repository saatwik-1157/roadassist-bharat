# The 20 trap questions

Ranked by how much they cost if answered badly.

| # | Rank | Question | Safe answer | Evidence | Never claim |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | "Can SOS contact emergency services offline?" | "No. No satellite, no mesh, no SMS bypass. It says nothing was transmitted and advises calling 112." | `raiseOffGridSos`; the string is absent repo-wide | That any message leaves the device |
| 2 | **CRITICAL** | "Is your AI actually AI?" | "The roadside engine is a deterministic rule table labelled `rules-1.0.0`. The road-damage detector is a trained YOLO11n." | `domain/ai-rules.ts`, `ai/` | That the diagnosis engine is a model |
| 3 | **CRITICAL** | "Is anything deployed?" | "No. The image builds and the whole suite passes against it, but no cloud account exists." | `app/Dockerfile` | Any live URL or uptime figure |
| 4 | **CRITICAL** | "Where is autoscaling?" | "Not provisioned — slide 22 says DESIGN. The readiness gate is real: `/health` 503, `/v1/ping` 200." | `apps/api/src/server.ts:360` | That scaling is automatic |
| 5 | **CRITICAL** | "Two mechanics accept at the same instant?" | "One wins. `SELECT … FOR UPDATE` on the booking row, expiry checked inside the transaction." | `apps/api/src/server.ts:945` | That it is handled "in the code" |
| 6 | **HIGH** | "Where is replication?" | "Nowhere. Precondition built — stateless API. Three in-process components block it." | `realtime.ts`, `ratelimit.ts` | Any high-availability claim |
| 7 | **HIGH** | "Where is load balancing?" | "No infrastructure balancer. Workload distribution across a pool is real, and that is the syllabus's framing." | `dispatch.ts` | An L7 balancer |
| 8 | **HIGH** | "Show me multitenancy." | "Row-level on a shared schema — twelve cross-tenant attacks refused. I can run it now." | `security-audit.mjs` | Separate databases per tenant |
| 9 | **HIGH** | "Show me virtualization." | "Four-stage image, non-root uid 1000, tini PID 1 — and the full suite passes against the image." | `app/Dockerfile` | Hypervisor-level work |
| 10 | **HIGH** | "Does it really work offline?" | "The emergency half does. Let me close the tab and reopen it." Then the three-way split. | demo beat 12 | That everything works |
| 11 | **HIGH** | "What is your uptime / availability?" | "Not measured. Nothing is deployed, so there is nothing to measure." | — | 99.9% — those tables are planning targets |
| 12 | **HIGH** | "Have you load-tested it?" | "No. What I have is single-user measured latency — no operation above 400 ms at p95." | `PERFORMANCE_FINAL_REPORT.md` | Any throughput or concurrent-user figure |
| 13 | **HIGH** | "Have you had a penetration test?" | "No. 100 self-written attacks is not the same thing." | — | That it is independently audited |
| 14 | **MEDIUM** | "How is the mechanic selected?" | "PostGIS KNN, off-duty and busy excluded in SQL, then proximity 60% / rating 34% / newcomer bonus." | `apps/api/src/dispatch.ts:77` | That severity is in the ranking score |
| 15 | **MEDIUM** | "Why is that dynamic scheduling?" | "Run time, from a pool, by live state, with timeout-driven re-scheduling. Four properties, four matches." | `dispatch.ts` | — |
| 16 | **MEDIUM** | "How do you prevent duplicate payments?" | "Settlement is recorded, never asserted; replaying the confirmation does not charge twice." | `apps/api/src/server.ts:1026` | Live gateway experience |
| 17 | **MEDIUM** | "What if the database crashes?" | "`/health` 503 naming the database, `/v1/ping` 200, automatic recovery. Twenty seconds to show you." | `apps/api/src/server.ts:360` | Failover to a replica |
| 18 | **MEDIUM** | "What if GPS fails?" | "An approximate position, labelled as approximate. Never fabricated silently." | `locate()` | Precise positioning |
| 19 | **MEDIUM** | "Is this production ready?" | "No, and no document claims it is. It is demo and submission ready." | slide 27 | Production readiness |
| 20 | **MEDIUM** | "Show me your iOS app." | "There isn't one. The surfaces that exist are the PWA, an Android client and an SMS path." | `README.md` | iOS, Android Auto, IVR, USSD |

**The pattern in all twenty:** the safe answer starts with the limitation and
then offers the nearest real thing. "Designed and not provisioned" costs nothing.
A claim you cannot show costs the room.
