> Every line numbers a real file, re-checked on 2026-09-12. Open the file, do not
> describe it — a professor who sees the code stops asking whether it exists.
>
> Which is exactly why these have to be re-derived after a refactor: when the
> emergency routes moved out of `server.ts`, the SOS and sync citations pointed
> at unrelated code and one past the end of the file.

# Final professor defense

## Claim → evidence → code → demo screen → SWE4004 topic

| Claim | Evidence | Code location | Demo screen | SWE4004 |
|---|---|---|---|---|
| Users authenticate with OTP and rotating tokens | 189 e2e assertions incl. refresh-reuse theft detection | `apps/api/src/auth.ts:131` `authenticate()` | Sign-in, 0:45 | M1 SaaS |
| A user can only reach their own data | 12 cross-tenant attacks refused | `apps/api/src/booking-access.ts:17` `bookingAudience()` | — (run the suite) | **M2 multitenancy** |
| Diagnosis is a labelled rules engine, not a model | Response carries `rules-1.0.0` | `apps/api/src/server.ts:615` → `domain/ai-rules.ts` | Diagnosis, 2:15 | M1 service boundary |
| A remote model may make a verdict stricter, never laxer | `driveable: rules.driveable === false ? false : …` | `apps/api/src/providers.ts:196` | Diagnosis badge | M1 risk control |
| Device and cloud rule tables cannot diverge | CI test fails the build | `apps/api/test/offline-engine.test.ts` | — | M2 service tech |
| Dispatch excludes off-duty and busy providers **in SQL** | Ranked offers with real distances | `apps/api/src/dispatch.ts:77` `findCandidates()` | Dispatch, 3:15 | **M4 resource pooling** |
| Dispatch is dynamic scheduling | Run-time, pooled, live score, timeout re-scheduling | `apps/api/src/dispatch.ts` + `OFFER_SWEEP_SECONDS` | Dispatch, 3:15 | **M4 dynamic scheduling** |
| One job is assigned exactly once | 10 simultaneous accepts → 1 winner | `apps/api/src/server.ts:945` — `SELECT … FOR UPDATE` inside `db.transaction` | Mechanic accept, 4:00 | M4 workload distribution |
| Real-time is SSE, persist-first | 5.2 ms to first frame | `apps/api/src/realtime.ts:140` `openStream()` | Real-time, 4:45 | M3 usage monitoring |
| SOS creates an incident and reports each rung as fact | Escalation card shows real counts | `apps/api/src/routes/emergency.ts:47` | Online SOS, 6:15 | M1 SaaS |
| Off-grid SOS is stored encrypted on the device | AES-GCM-256, non-extractable key | `apps/web/offline-store.js` | Offline, 7:15 | **M3 cloud storage (client tier)** |
| Nothing is transmitted off-grid, and it says so | UI string; no satellite/mesh/SMS bypass exists | `apps/web/app.html` `raiseOffGridSos` | Offline, 7:15 | M1 cloud risk |
| Sync is idempotent | Re-sync creates nothing | `apps/api/src/routes/emergency.ts:363` + unique `client_incident_id` | Sync, 8:00 | M4 migration |
| The client never decides money arrived | Amount is the invoice total; signature recomputed | `apps/api/src/routes/payments.ts:125` (pay), `:374` (webhook) | Payment, 5:30 | M2 service tech |
| A booking cannot be PAID without a settled payment | 409 `payment_required` | `apps/api/src/server.ts:1036` | Payment, 5:30 | M2 service tech |
| History cannot be edited | Postgres RULES make UPDATE/DELETE no-ops | `apps/api/src/audit.ts:107` `audit()`, `:148` `verifyAuditChain()` | `/v1/ops/overview` | M3 monitoring |
| Readiness is real | DB down → `/health` 503, `/v1/ping` 200, auto-recovery | `apps/api/src/server.ts:360` | Chaos, optional | **M4 dynamic scalability** |
| Production refuses unsafe config | Boots refused on 8 settings | `apps/api/src/env.ts:358` `assertProductionSafe()` | Terminal | M1 boundaries |
| Module boundaries are enforced, not agreed | Cross-module import fails CI | `app/scripts/check-boundaries.mjs` | Terminal | M1 roles/boundaries |
| Virtualization is real | Suite passes **against the image** | `app/Dockerfile` | Terminal | **M2 virtualization** |
| 662 assertions, 0 failures | Six suites, executed twice | `FINAL_REPOSITORY_STATUS.md` | Terminal | — |

## The three files to have open before you walk in

1. `apps/api/src/dispatch.ts` — pooling, distribution, dynamic scheduling. Three Module 4 answers from one file.
2. `apps/api/src/server.ts` around line **1057** — the row lock. This is the single most impressive twenty lines in the project.
3. `apps/web/offline-store.js` — encrypted client-side storage, the Module 3 answer nobody expects.

## What to say when you cannot show something

> "That one is design, not built. What is built is *[the nearest real thing]*,
> and the blocker is *[the specific component]*."

Never fill a gap with an adjective. "Designed and not provisioned" costs you
nothing; "scalable" without evidence costs you the room.
