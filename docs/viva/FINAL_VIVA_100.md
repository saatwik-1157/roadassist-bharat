> 100 questions, answered from the actual repository on 2026-09-06. Every
> "Code" line is a real path. If an answer is "no" or "not implemented", it says
> so — that is the answer that survives a follow-up.

# Final viva — 100 questions

**Format:** *Short* (say this) · *Detail* (if pressed) · *RoadAssist* (the
concrete example) · *Code* (where to open it).

---

# A. Project fundamentals (1–10)

**1. What is RoadAssist Bharat?**
*Short:* An AI-assisted, cloud-connected roadside assistance platform whose emergency path keeps working when the network does not.
*Detail:* One platform from incident to resolution — diagnose, dispatch, track, pay — plus a second path that runs on the device when there is no connectivity.
*RoadAssist:* Three surfaces, one API, one PostGIS database.
*Code:* `app/apps/`, `README.md`

**2. What problem does it solve?**
*Short:* Roadside help is slow, manually coordinated, and depends on the network the stranded driver has lost.
*Detail:* Coverage on Indian highways is worst exactly where a breakdown is most dangerous.
*RoadAssist:* Off-Grid Mode is the answer to the fourth problem, which nobody else solves.
*Code:* `app/docs/OFFLINE.md`

**3. Who are the users?**
*Short:* Customers, mechanics, and an authority/admin role.
*Detail:* Plus the system itself, which may raise a signal but may never dispatch or escalate.
*RoadAssist:* `app.html`, `mechanic.html`, `raksha.html`.
*Code:* `app/apps/web/`, ADR-0005

**4. What is the scope of what actually works?**
*Short:* The full journey end to end, plus the offline emergency path.
*Detail:* Not deployed to a cloud; payments are sandbox-only; 112 is a stub.
*RoadAssist:* 19 customer steps and 16 mechanic steps verified.
*Code:* `CUSTOMER_FINAL_TEST_REPORT.md`

**5. What is your most important innovation?**
*Short:* The emergency path degrades honestly instead of showing a spinner.
*Detail:* It creates the incident locally, encrypts it, states plainly that nothing was transmitted, and forwards it without duplicating.
*RoadAssist:* Close the tab offline and reopen it — the incident is still there.
*Code:* `apps/web/offline-store.js`

**6. Why "Bharat"?**
*Short:* It is designed for Indian highway conditions — patchy coverage, feature phones, UPI, TRAI rules.
*Detail:* The SMS journey exists because not every driver has a smartphone.
*RoadAssist:* `POST /v1/telecom/sms` supports a full booking by SMS.
*Code:* `apps/api/src/server.ts`

**7. Is this a real product or a university project?**
*Short:* A university project. No commercial operation exists and the deck says so.
*Detail:* The business model slide is labelled potential, not current.
*RoadAssist:* Slide 29.
*Code:* `ppt/part_final.py`

**8. How large is the codebase?**
*Short:* About 7,800 lines of TypeScript plus six web surfaces and an Android client.
*Detail:* 16 API files (6,261 lines), 13 database files (1,564), 12 test/tooling scripts.
*RoadAssist:* 65 routes, 56 tables.
*Code:* `FINAL_REPOSITORY_STATUS.md`

**9. What would you do differently?**
*Short:* Move the rate limiter and SSE registry out of process from day one.
*Detail:* They are the three things blocking a second instance, and retrofitting is harder than starting there.
*RoadAssist:* Documented at each definition, not discovered late.
*Code:* `apps/api/src/ratelimit.ts`, `realtime.ts`

**10. What are you most confident about?**
*Short:* That every claim we make is testable, and we found our own bugs.
*Detail:* Six real defects found by tooling we wrote to attack the project.
*RoadAssist:* Double-assignment, duplicate SOS 500s, 874 impossible bookings, 1,789 phantom payments, two real-time defects.
*Code:* `RELEASE-RC1-REPORT.md`

---

# B. Cloud computing (11–25)

**11. Why is this a cloud computing project?**
*Short:* We are a SaaS provider and consumer, dispatch is dynamic scheduling over a pooled resource, and the failure we designed for is a cloud risk.
*Detail:* Three of the four SWE4004 modules have implemented evidence.
*RoadAssist:* Slides 19–23.
*Code:* `SWE4004_IMPLEMENTATION_MAPPING_FINAL.md`

**12. Where exactly is the cloud?**
*Short:* Consumed, not operated. Nothing is deployed.
*Detail:* Containerised services, stateless API, adapters over SaaS vendors, a readiness gate. No cloud account exists.
*RoadAssist:* Say it plainly — it is worth more than a diagram.
*Code:* `docker-compose.prod.yml`

**13. Which cloud characteristics do you demonstrate?**
*Short:* Broad network access and resource pooling, genuinely.
*Detail:* On-demand self-service and measured usage we consume in design only.
*RoadAssist:* One API serves browser, PWA, Android WebView and feature phone over SMS.
*Code:* `apps/api/src/server.ts`

**14. Which service model?**
*Short:* SaaS as provider, SaaS as consumer, IaaS partially, PaaS conceptually.
*Detail:* Every vendor sits behind an adapter with a local implementation.
*RoadAssist:* The whole demo runs on zero paid accounts.
*Code:* `apps/api/src/providers.ts`

**15. Which deployment model?**
*Short:* Target is public cloud with Indian data residency. Current is local.
*Detail:* "No PII leaves India" is a stated constraint, reasoned in the charter.
*RoadAssist:* Nothing deployed.
*Code:* `docs/00-team-charter.md`, ADR-0001

**16. What are the cloud benefits you realise?**
*Short:* Cost proportionality — it runs with no paid account by default.
*Detail:* Elasticity and global reach are benefits we designed for, not ones we have.
*RoadAssist:* `console` SMS, `mock` payments, `local` maps, `rules` AI.
*Code:* `apps/api/src/env.ts`

**17. What are the cloud risks?**
*Short:* Connectivity dependence, reduced operational control, vendor lock-in.
*Detail:* The first is the one we actually mitigated, and it is the whole project.
*RoadAssist:* Off-Grid Mode.
*Code:* ADR-0009

**18. How do you avoid vendor lock-in?**
*Short:* Every external service is an interface with a local implementation.
*Detail:* Swapping Twilio for MSG91 is one environment variable.
*RoadAssist:* `SMS_PROVIDER=console|twilio|msg91`.
*Code:* `apps/api/src/providers.ts`

**19. What is elasticity and do you have it?**
*Short:* Adding and removing capacity with demand. We do not have it.
*Detail:* We built the precondition — a stateless API — and the readiness gate that makes instance removal safe.
*RoadAssist:* `/health` returns 503 when the database is unreachable.
*Code:* `apps/api/src/server.ts`

**20. What is measured usage and do you have it?**
*Short:* Partially. We log operation, duration and result per request.
*Detail:* No billing meter and no external APM.
*RoadAssist:* `/v1/ops/overview` shows live counts and verifies the audit chain.
*Code:* `apps/api/src/observability.ts`

**21. What is on-demand self-service?**
*Short:* Provisioning without human intervention. We consume it in design.
*Detail:* Our users self-serve at the application layer — sign-up needs no operator.
*RoadAssist:* OTP sign-in creates the account.
*Code:* `POST /v1/auth/otp/verify`

**22. What are the roles and boundaries in your system?**
*Short:* Five modules in one deployable, with boundaries enforced by CI.
*Detail:* A cross-module import fails the build — a fitness function, not a convention.
*RoadAssist:* Run `npm run boundaries` live.
*Code:* `app/scripts/check-boundaries.mjs`

**23. Is this cloud-native?**
*Short:* Partially. Containerised, stateless, config through environment. Not deployed, not orchestrated.
*Detail:* We do not claim cloud-native on any slide.
*RoadAssist:* Slide 27 lists it as a limitation.
*Code:* `app/Dockerfile`

**24. What would move you from cloud-ready to cloud-deployed?**
*Short:* Three code changes and an account.
*Detail:* Redis-backed rate limiting, an outbox→bus for SSE fan-out, and WAL archiving.
*RoadAssist:* All three are named in the roadmap slide.
*Code:* `RELEASE_NOTES.md`

**25. What is the shared responsibility model here?**
*Short:* We would own the application, schema, secrets and data; the provider owns hardware, hypervisor and managed-service uptime.
*Detail:* Today we own everything because we run it locally.
*RoadAssist:* `assertProductionSafe` encodes our half — it refuses to boot on eight unsafe settings.
*Code:* `apps/api/src/env.ts`

---

# C. SWE4004 Modules 1–4 (26–45)

**26. Module 1 — which characteristics are implemented?**
*Short:* Broad network access and resource pooling.
*Detail:* Four client types over one API; 600 mechanics allocated by dispatch.
*Code:* `apps/api/src/dispatch.ts`

**27. Module 1 — service models in your project?**
*Short:* SaaS provider and consumer; IaaS partial; PaaS conceptual.
*Code:* `providers.ts`, `docker-compose.yml`

**28. Module 1 — deployment model?**
*Short:* Public cloud target, Indian residency, currently local.
*Code:* ADR-0001

**29. Module 2 — where is virtualization?**
*Short:* OS-level: a four-stage Dockerfile, non-root uid 1000, tini as PID 1, a real HEALTHCHECK.
*Detail:* Hardware virtualization is the layer beneath, which we consume.
*Code:* `app/Dockerfile`

**30. Module 2 — where is multitenancy?**
*Short:* Row-level tenancy on a shared schema. Every read scoped by `user_id`.
*Detail:* Proven, not asserted — twelve cross-tenant attacks, all refused.
*Code:* `app/scripts/security-audit.mjs`

**31. Module 2 — what web technology?**
*Short:* REST with a uniform envelope, SSE for real-time, a PWA with a service worker.
*Detail:* SSE not WebSocket, and ADR-0010 gives the reason.
*Code:* `apps/api/src/realtime.ts`, `apps/web/sw.js`

**32. Module 2 — what service technology?**
*Short:* Versioned `/v1` contract, zod validation at every boundary, stable error codes, idempotency keys.
*Code:* `apps/api/src/errors.ts`

**33. Module 2 — data centre technology?**
*Short:* Partial. A compose stack on a private network; production publishes no database port.
*Code:* `docker-compose.prod.yml`

**34. Module 3 — network perimeter?**
*Short:* Partial. Container isolation and a private network; no VPC because nothing is deployed.
*Code:* `docker-compose.prod.yml`

**35. Module 3 — virtual server?**
*Short:* The container image. The full test suite passes against the image, not just the source.
*Code:* `app/Dockerfile`

**36. Module 3 — cloud storage?**
*Short:* Three real forms: block (database volume), file (upload directory), and client-side encrypted IndexedDB.
*Detail:* The third is the interesting one — AES-GCM-256 under a non-extractable key.
*Code:* `apps/web/offline-store.js`

**37. Module 3 — cloud usage monitor?**
*Short:* Partial. Structured logs with a correlation id, operation timing, `/health`, `/v1/ops/overview`.
*Detail:* No external APM.
*Code:* `apps/api/src/observability.ts`

**38. Module 3 — resource replication?**
*Short:* Not implemented. The precondition is — the API is stateless.
*Detail:* Three in-process components would break replication: SSE registry, rate limiter, offer sweeper.
*Code:* `realtime.ts`, `ratelimit.ts`, `dispatch.ts`

**39. Module 4 — workload distribution?**
*Short:* Implemented. Dispatch ranks and distributes jobs across a provider pool.
*Code:* `apps/api/src/dispatch.ts`

**40. Module 4 — resource pooling?**
*Short:* Implemented. 600 mechanics; off-duty and busy excluded in SQL before ranking.
*Code:* `findCandidates` in `dispatch.ts`

**41. Module 4 — dynamic scalability?**
*Short:* Conceptual, with one real component: the readiness gate.
*Detail:* Stop Postgres — `/health` 503, `/v1/ping` 200. That is what lets an orchestrator act.
*Code:* `apps/api/src/server.ts`

**42. Module 4 — service load balancing?**
*Short:* No infrastructure load balancer. Application-level workload distribution is real.
*Detail:* Distributing work across a pool of providers is the syllabus's own framing.
*Code:* `dispatch.ts`

**43. Module 4 — static vs dynamic scheduling?**
*Short:* Both. Static: the offer sweeper on a fixed interval, the client poll, the SSE heartbeat. Dynamic: the dispatch ladder.
*Detail:* Dynamic scheduling means run-time assignment from a pool by live state with timeout re-scheduling — four properties, all present.
*Code:* `OFFER_SWEEP_SECONDS`, `dispatch.ts`

**44. Module 4 — migration?**
*Short:* Schema migration is implemented and rehearsed; workload migration is future.
*Detail:* Five versioned migrations, run from an empty database during verification, all additive.
*Code:* `packages/db/drizzle/`

**45. Module 4 — redundant storage?**
*Short:* Partial. Backup and restore are rehearsed and measured; redundancy itself is not built.
*Detail:* Dump 1.2 s, restore 7.2 s, audit hash chain verified intact across 639 entries. One node, no replica, no schedule.
*Code:* `app/docs/DEPLOYMENT.md`

---

# D. Architecture (46–55)

**46. Why a modular monolith and not microservices?**
*Short:* Four developers should not operate a distributed system. Boundaries without network calls.
*Detail:* We get module isolation from CI enforcement, and keep transactions.
*Code:* ADR-0001, `scripts/check-boundaries.mjs`

**47. How are module boundaries enforced?**
*Short:* A fitness function in CI. A cross-module import fails the build.
*Code:* `app/scripts/check-boundaries.mjs`

**48. Why Fastify?**
*Short:* Schema-first validation and low overhead; zod at every boundary.
*Code:* `apps/api/src/server.ts`

**49. Why SSE and not WebSocket?**
*Short:* Updates are server→client only. SSE is one long-lived GET — it survives proxies, reconnects natively, needs no second protocol.
*Code:* ADR-0010

**50. What is "persist first, publish second"?**
*Short:* The database is written before anything is announced.
*Detail:* A dropped connection then loses a notification, never a fact.
*Code:* `notifyBooking` in `server.ts`

**51. What are your state machines?**
*Short:* Two closed transition tables — booking and incident.
*Detail:* A client sends a command; only the table decides legality, and every change is audited.
*Code:* `domain/booking-machine.ts`, `domain/incident-machine.ts`

**52. What is the API envelope?**
*Short:* `{data, meta}` on success, `{error:{code,title,retryable}}` on failure.
*Detail:* `retryable` tells a client whether to retry — the client never guesses.
*Code:* `apps/api/src/errors.ts`

**53. How does the PWA work offline?**
*Short:* A service worker precaches the shell, each asset independently so one 404 cannot leave the app with nothing.
*Code:* `apps/web/sw.js`

**54. Why plain HTML instead of React?**
*Short:* No build step, no second deployment unit, and the offline path has fewer moving parts.
*Detail:* Three surfaces served by the same process.
*Code:* `apps/web/`

**55. What runs on the device versus the cloud?**
*Short:* Device: connectivity classification, diagnosis, local incident, encrypted store, sync journal. Cloud: dispatch, tracking, payment, notification.
*Code:* `apps/web/offline-engine.js`

---

# E. Database (56–65)

**56. Why PostgreSQL and PostGIS?**
*Short:* Dispatch is one indexed geospatial query. PostGIS makes it a database concern, not application arithmetic.
*Code:* ADR-0003

**57. How large is the schema?**
*Short:* 56 tables, 62 foreign keys, 138 indexes, 5 check constraints, 84 unique indexes.
*Code:* `DATABASE_FINAL_VERIFICATION.md`

**58. How does the geospatial query work?**
*Short:* `ST_DWithin` for the radius, KNN `<->` for ordering, on a GiST index.
*Code:* `dispatch.ts`

**59. How is money stored?**
*Short:* Integer paise. Never floating point.
*Detail:* A unit test asserts it across the whole schema.
*Code:* `apps/api/test/` schema tests

**60. What is the audit log?**
*Short:* Append-only and hash-chained. Each entry carries the digest of the previous one.
*Detail:* Postgres RULES make UPDATE and DELETE change nothing — silently, which is what an attacker with a connection would discover the hard way.
*Code:* migration `0000`, `apps/api/src/audit.ts`

**61. How do you guarantee one job, one mechanic?**
*Short:* `SELECT … FOR UPDATE` on the booking row with the offer expiry checked inside the transaction.
*Detail:* An earlier version read the status outside it and two mechanics could both win. Our own suite found it.
*Code:* `POST /v1/offers/:id/accept`

**62. How is idempotency enforced?**
*Short:* Unique constraints in the database — `client_incident_id`, per-device `op_id`, `idempotency_key_uq`, `bookings_reference_uq`.
*Detail:* Database-level, not application convention, so it survives a second instance.
*Code:* `packages/db/drizzle/0002_per_device_op_id.sql`

**63. What is optimistic concurrency here?**
*Short:* Every table carries a `version` column, and transitions use a guarded UPDATE on the expected status.
*Code:* `booking-machine.ts`

**64. How do you know the data is consistent?**
*Short:* Ten consistency queries, all returning zero.
*Detail:* One returned 1,789 when this phase started — bookings marked PAID with no invoice or payment. The seeder was wrong, not the app.
*Code:* `DATABASE_FINAL_VERIFICATION.md`

**65. Are migrations reversible?**
*Short:* They are additive, so an older image runs against a newer schema.
*Detail:* Down-migrations are not written; roll-forward is the strategy.
*Code:* `packages/db/drizzle/`

---

# F. AI (66–75)

**66. Is your AI actually AI?**
*Short:* The roadside diagnosis engine is a deterministic rule table, and we label it `rules-1.0.0` in every response. The road-damage detector is a genuinely trained YOLO11n.
*Detail:* We refuse to call the first one AI. That refusal is the answer.
*Code:* `domain/ai-rules.ts`, `ai/`

**67. Why rules instead of a model?**
*Short:* Explainability and a permanent fallback. Every field derives from a rule you can read.
*Detail:* It is the floor any model must beat, and it is what runs offline.
*Code:* `domain/ai-rules.ts`

**68. What is the safety asymmetry?**
*Short:* A remote model may make a verdict **stricter, never laxer**.
*Detail:* It can say "do not drive" when rules said driveable; it can never overrule a do-not-drive.
*Code:* `providers.ts` — `driveable: rules.driveable === false ? false : …`

**69. What happens if the model is unconfident?**
*Short:* Below `AI_MIN_CONFIDENCE` the rules result wins and `usedFallback` is true.
*Code:* `providers.ts`

**70. What happens if the AI service fails?**
*Short:* Timeout, network error or bad payload all return the rules result, labelled `usedFallback: true`.
*Code:* `providers.ts` catch branch

**71. How do you know the device and server agree?**
*Short:* A CI test fails the build if the on-device rule table diverges from the server's.
*Detail:* That guard is the reason offline diagnosis is trustworthy.
*Code:* `apps/api/test/offline-engine.test.ts`

**72. Can the AI dispatch or escalate?**
*Short:* No. A model may raise a signal; only a human may escalate.
*Detail:* Enforced in code, not policy.
*Code:* ADR-0005

**73. What does the diagnosis return?**
*Short:* Cause, confidence, severity 1–5, driveable, parts, advice, model version.
*Code:* `POST /v1/diagnose`

**74. Is the prediction auditable?**
*Short:* Yes, and without storing the input.
*Detail:* A unit test enforces that property.
*Code:* `model_predictions` table

**75. What are the detector's real metrics?**
*Short:* A trained YOLO11n with measured mAP50 — quote from the training run, never estimate.
*Code:* `ai/`

---

# G. Security (76–85)

**76. How is authentication done?**
*Short:* OTP with per-number and per-IP ceilings, short-lived JWT access tokens, refresh rotation.
*Code:* `apps/api/src/auth.ts`

**77. What happens if a refresh token is reused?**
*Short:* Treated as theft — the session is invalidated.
*Code:* e2e §2

**78. How is authorization enforced?**
*Short:* `bookingAudience()` — the customer, the assigned mechanic, or an admin. Nobody else.
*Detail:* Commands are additionally filtered by role.
*Code:* `apps/api/src/server.ts`

**79. Can one customer see another's data?**
*Short:* No. Twelve cross-tenant attempts, all refused.
*Code:* `scripts/security-audit.mjs`

**80. How is rate limiting done?**
*Short:* Per-principal fixed window, with the emergency path given its own higher ceiling.
*Detail:* In-process — a known single-instance limit.
*Code:* `apps/api/src/ratelimit.ts`

**81. How do you resist SQL injection?**
*Short:* Parameterised queries throughout via Drizzle; injection strings are stored as data.
*Code:* security suite

**82. How is medical data protected?**
*Short:* Separate table, restricted access, every read logged; break-glass access recorded rather than blocked.
*Detail:* In an emergency the wrong answer is to block the responder.
*Code:* `break_glass_access`

**83. What was the `trustProxy` vulnerability?**
*Short:* Fastify ≤5.12.0 believed `X-Forwarded-For` by counting hops without checking the sender, defeating the per-IP OTP ceiling.
*Detail:* We now refuse a numeric value outright rather than coerce it to "trust everybody".
*Code:* `apps/api/src/env.ts`, GHSA-3m5p-2c4r-xxw2

**84. Have you had a penetration test?**
*Short:* No. 100 self-written attacks is not the same thing, and I will not claim it is.
*Code:* `SECURITY_FINAL_VERIFICATION.md`

**85. Are any secrets in the repository?**
*Short:* No. Repository-wide search found none; the only `rzp_live_` string is a documentation placeholder.
*Code:* `CLAIM_VERIFICATION_FINAL.md`

---

# H. Offline and SOS (86–95)

**86. How does the app know it is offline?**
*Short:* Measured evidence, not `navigator.onLine`. It probes `/v1/ping` and classifies ONLINE / LIMITED / OFF-GRID.
*Code:* `apps/web/connectivity.js`

**87. What works with no network?**
*Short:* GPS, diagnosis, cached map tiles, and creating a real local incident.
*Code:* `offline-engine.js`

**88. What does not work offline?**
*Short:* Dispatch, live tracking, ETA, payment, and contacting anyone.
*Detail:* The app names each one rather than spinning.
*Code:* `apps/web/app.html` off-grid screen

**89. Can SOS contact emergency services without connectivity?**
*Short:* **No.** No satellite, no mesh, no SMS bypass.
*Detail:* The app says "Nothing has been transmitted" and advises calling 112, because voice often works on a signal too weak for data.
*Code:* `raiseOffGridSos`

**90. Is the local incident encrypted?**
*Short:* Yes — AES-GCM-256 in IndexedDB under a non-extractable `CryptoKey`.
*Code:* `apps/web/offline-store.js`

**91. What is the local incident reference?**
*Short:* `RA-XXXXXX`, from an alphabet with no ambiguous characters, short enough to read aloud over a borrowed phone.
*Code:* `newIncidentId()` in `offline-engine.js`

**92. How does sync work?**
*Short:* Store and forward, with fully jittered exponential backoff.
*Code:* `syncOffGrid`, `backoffMs()`

**93. How do you prevent a duplicate emergency?**
*Short:* `client_incident_id` is unique in the database, so a retry after a lost response converges on the row that exists.
*Code:* `POST /v1/sos/offline-sync`

**94. What if the phone dies mid-SOS?**
*Short:* The incident is written to storage **before** anything is drawn.
*Detail:* The opposite of optimistic UI, and correct here.
*Code:* `raiseOffGridSos`

**95. Does the incident survive closing the app?**
*Short:* Yes. Close the tab entirely and reopen — it is still there. That is the demo's strongest moment.
*Code:* demo beat 12

---

# I. Deployment and scalability (96–100)

**96. Is anything deployed?**
*Short:* No. A production image builds and the full suite passes against it, but no cloud account exists.
*Code:* `app/Dockerfile`

**97. What stops you running two instances today?**
*Short:* Three in-process components: the SSE registry, the rate limiter and the offer sweeper.
*Detail:* Each is documented at its definition with the fix named.
*Code:* `realtime.ts`, `ratelimit.ts`, `dispatch.ts`

**98. How does the production config protect you?**
*Short:* `assertProductionSafe` refuses to boot on eight unsafe settings — dev JWT secret, exposed dev OTP, console SMS, mock payments, unset CORS, plain-http origins, unsigned telecom webhook, and the development database.
*Code:* `apps/api/src/env.ts`

**99. What is your backup and recovery position?**
*Short:* Restore is rehearsed and measured; the schedule is not configured.
*Detail:* Dump 1.2 s, restore 7.2 s, audit chain intact across 639 entries. Real RPO today is "whenever somebody runs it".
*Code:* `app/docs/DEPLOYMENT.md`

**100. What would you build next, in order?**
*Short:* Redis-backed rate limiting, outbox→event bus for SSE fan-out, WAL archiving. Then a host.
*Detail:* Those three are exactly what stands between this and a second instance.
*Code:* `RELEASE_NOTES.md`

---

# Professor attack questions — the twenty that decide the grade

| Question | The answer, in one breath |
|---|---|
| "Why is this a cloud project?" | SaaS provider and consumer, dispatch is dynamic scheduling over a pooled resource, and the risk we mitigated — connectivity loss — is a cloud risk. Three of four modules have implemented evidence. |
| "Where exactly is the cloud?" | Consumed, not operated. Nothing is deployed and I would rather say that than point at a diagram. |
| "Show me your virtualization." | `app/Dockerfile` — four stages, non-root uid 1000, tini as PID 1, a real HEALTHCHECK. The full suite passes against the image, not just the source. |
| "Show me multitenancy." | Row-level tenancy on a shared schema. Twelve cross-tenant attacks, all refused — `npm run test:security`, live. |
| "Where is autoscaling?" | Not provisioned. Slide 22 says DESIGN. What exists is the readiness gate: stop Postgres and `/health` returns 503 while `/v1/ping` returns 200. |
| "Where is replication?" | Nowhere. The precondition is built — stateless API — and I can name the three in-process components that would break it. |
| "Where is load balancing?" | No infrastructure balancer. Workload distribution across a provider pool is real, and that is the syllabus's own framing. |
| "Can it actually work without internet?" | Yes, for the emergency half. Let me close the tab and reopen it. |
| "Can SOS contact emergency services offline?" | **No.** No satellite, no mesh, no SMS bypass. The app says nothing has been transmitted and tells you to call 112. |
| "Is your AI actually AI?" | The roadside engine is a rule table and we label it `rules-1.0.0`. The road-damage detector is a trained YOLO11n with measured metrics. |
| "How is the mechanic selected?" | PostGIS nearest-neighbour, off-duty and busy excluded in SQL, then scored — proximity 60%, rating 34%, newcomer bonus. |
| "Why is this dynamic scheduling?" | Run time, from a pool, by live state, with timeout-driven re-scheduling. Four properties, four matches. |
| "Two mechanics accept simultaneously?" | One wins. `SELECT … FOR UPDATE` on the booking row with expiry checked inside the transaction. Ten simultaneous accepts: one winner, nine refusals. |
| "How do you prevent duplicate payments?" | Settlement is recorded, never asserted, and replaying the confirmation does not charge twice. |
| "What if the database crashes?" | `/health` 503 naming the database, `/v1/ping` still 200, automatic recovery. Twenty seconds to show you. |
| "What if the AI crashes?" | Rules result with `usedFallback: true`. A model may make a verdict stricter, never laxer. |
| "What if GPS fails?" | An approximate position, *labelled* as approximate. Never fabricated silently. |
| "Biggest limitation?" | Single instance. Three in-process components, each documented with its fix. |
| "What would you build next?" | Redis rate limiting, outbox→bus, WAL archiving. Then a host. |
| "Why would anyone use it?" | Because it keeps working where the customer actually is. Every other roadside app shows a spinner when the network dies. |

---

# The timed answers

## 30 seconds — "What is RoadAssist Bharat?"

> RoadAssist Bharat is an AI-assisted, cloud-connected roadside assistance
> platform for India. A stranded driver describes the fault, a rules engine
> names a likely cause, and a PostGIS query dispatches the nearest available
> verified mechanic — tracked live, paid in-app. The part that makes it
> different: when the driver has no network, the emergency path still runs on
> the phone. The SOS becomes a real encrypted incident with its own reference,
> it says plainly that nothing has been transmitted, and it forwards itself
> without duplicating when signal returns. **RoadAssist doesn't stop when the
> network stops.**

## 60 seconds — "Explain your project."

> **Problem.** A breakdown is not a software problem until you realise the app
> you would use to fix it needs the network you do not have. On Indian
> highways, coverage is worst exactly where a breakdown is most dangerous.
>
> **Solution.** One platform from incident to resolution: describe the fault, an
> engine names a likely cause with a severity, dispatch ranks nearby mechanics
> and offers the job in timed waves, and the customer watches it happen live.
>
> **Technology.** Fastify and PostgreSQL with PostGIS — dispatch is one indexed
> geospatial query. Server-sent events for live status. A progressive web app
> with a service worker and encrypted IndexedDB for the offline half.
>
> **Innovation.** Connectivity is classified from measured evidence, not
> assumed. Off-grid, an SOS becomes a real incident on the device, and a unique
> key makes a duplicate impossible on sync.
>
> **Result.** 653 assertions across six suites, zero failures, including 74
> attacks that must fail. Every claim on our slides is something I can show you.

## 3 minutes — architecture

> **Frontend.** Three surfaces — citizen app, mechanic console, authority
> dashboard — plain HTML and ES modules served by the same process. No build
> step, no second deployment unit. It is a PWA: service worker, manifest,
> installable, and it keeps its shell offline.
>
> **API.** Fastify — 65 routes, 61 under `/v1` — with zod validation at every
> boundary, a uniform `{data, meta}` / `{error}` envelope and stable error
> codes. Every error says whether it is retryable, so a client never guesses.
>
> **Services.** Five modules in one deployable — identity, fleet, service, ops
> and RAKSHA — with the boundaries enforced *mechanically*: a fitness function
> fails the build on a cross-module import.
>
> **AI.** A deterministic rule table, labelled `rules-1.0.0` in every response.
> A remote model is optional and may make a verdict stricter, never laxer. The
> same table runs on the device, and CI fails if the two diverge.
>
> **Dispatch.** A PostGIS nearest-neighbour search that excludes off-duty and
> already-committed providers in SQL, ranks the rest, and offers in waves of
> five with a ninety-second timeout that escalates on its own.
>
> **Database.** PostgreSQL 16 with PostGIS — 56 tables, 62 foreign keys, 138
> indexes, and an append-only hash-chained audit log that the database itself
> refuses to let you edit.
>
> **Real-time.** Server-sent events, persisted first and published second, with
> polling continuing underneath so the stream is an accelerator and never the
> truth.
>
> **Payment.** The client never decides that money arrived. The amount is the
> invoice total, the signature is recomputed server-side, and a booking cannot
> be marked paid without a settled payment.
>
> **Offline.** A connectivity manager, an on-device rules engine, and an
> encrypted IndexedDB journal that forwards idempotently.
>
> **Cloud.** Containerised, stateless, config through environment, with a
> readiness gate — and honestly, not deployed.

## 5 minutes — "Why does this qualify as a cloud computing project?"

> I will answer in three layers, and keep them apart, because the difference
> between them is the honest part of this project.
>
> **Layer one — what is genuinely implemented.** We are a **SaaS provider** to
> three user classes and a **SaaS consumer** through adapters — SMS, payments,
> map tiles, email — each with a local implementation, which is why this entire
> demonstration runs with zero paid accounts. **Virtualization** is real at OS
> level: a four-stage container image, non-root, tini as PID 1, a health check,
> and the full test suite passes against the image rather than the source.
> **Multitenancy** is row-level on a shared schema, and it is proven rather than
> asserted — twelve cross-tenant attacks, all refused, and I can run that suite
> now. **Web technology** is REST plus server-sent events plus a PWA.
> **Service technology** is a versioned contract with schema validation at every
> boundary and idempotency keys on every replayable operation. From Module 4,
> two of the eight fundamental architectures are genuinely built: **workload
> distribution** and **resource pooling** — six hundred mechanics, with off-duty
> and already-committed providers excluded in SQL before ranking. And both forms
> of scheduling: **static**, in the offer sweeper on a fixed interval, and
> **dynamic**, in the dispatch ladder — work assigned at run time, from a pool,
> by a score computed from live state, with timeout-driven re-scheduling when
> nobody answers. That is the textbook definition, property for property.
>
> **Layer two — what is cloud-ready but not provisioned.** The API is
> stateless; session state lives in the token, not in memory. Idempotency keys
> mean a retry is safe. State is server-authoritative. There is a readiness gate
> — stop PostgreSQL and `/health` returns 503 while `/v1/ping` still returns
> 200, which is precisely the signal an orchestrator needs to remove an
> instance. Those are the preconditions for replication and autoscaling, and
> they are built.
>
> **Layer three — what is design, and I will not pretend otherwise.** The
> autoscaler, the load balancer, multi-AZ replication and cloud bursting are
> designed and **not provisioned**. Eight of twenty-one concepts sit there. I
> can even tell you precisely what blocks the first step: three in-process
> components — the SSE registry, the rate limiter and the offer sweeper — each
> documented at its own definition with the fix named.
>
> **And the reason this is a cloud project rather than a web project** is the
> risk we chose to engineer against. Cloud computing's defining dependency is
> the network between the user and the service. Every roadside app assumes that
> link. We measured it, classified it, and built a complete emergency workflow
> for when it is gone — local incident, encrypted storage, honest messaging,
> idempotent synchronisation on return. That is a cloud risk, addressed with
> cloud-architecture reasoning, and it is the part of this project I would
> defend hardest.
