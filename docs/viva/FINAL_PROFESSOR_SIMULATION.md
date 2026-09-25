> Written after inspecting the actual repository on 2026-09-06 and re-measured
> against it on 2026-09-12 — 56 tables, 65 routes, 705 executed assertions.
> Nothing here is assumed. This is prep to be spoken aloud, not a dated record:
> when the code moves, the numbers here move with it.
>
> **Scope note, stated rather than hidden:** the *content* answers for
> architecture, AI, offline, security, database, dispatch and payment already
> exist in `FINAL_VIVA_100.md`, question by question with code paths. Repeating
> them here would create a second copy that can drift from the first. So this
> document carries what that one does not: **graded answers** (what a good one
> sounds like versus a weak one), the **traps** in each round, rapid-fire
> drilling, demo interruptions, an honest rubric, and a verdict.

# Final professor simulation

---

# Round 1 — Fundamentals (20 questions, graded)

**1. What is RoadAssist Bharat?**
- **Expected:** A roadside assistance platform whose emergency path survives network loss.
- **Good:** "AI-assisted, cloud-connected roadside assistance for India. Describe a fault, a rules engine names a cause, PostGIS dispatches the nearest available mechanic, tracked live and paid in-app. The difference: with no network, the emergency half runs on the phone."
- **Weak:** "It's an app that helps people whose car breaks down." *(True of every competitor. Says nothing.)*
- **Follow-up:** *"Every roadside app does that. What is different?"* → the offline path, and offer to demonstrate it.

**2. What problem does it solve?**
- **Expected:** Slow, manually coordinated help — and the connectivity dependence nobody addresses.
- **Good:** "Coverage on Indian highways is worst exactly where a breakdown is most dangerous. Three problems are common: delay, fragmentation, no visibility. The fourth — the app needs the network you have lost — is the one we built for."
- **Weak:** "People wait a long time for mechanics."
- **Follow-up:** *"Is that a software problem or a logistics problem?"* → "Logistics, until the software fails too. We fixed the software half."

**3. Who are the users?**
- **Expected:** Customer, mechanic, authority/admin — plus the system, which may signal but never dispatch.
- **Good:** Name all four and the permission rule: `bookingAudience()` allows the customer, the assigned mechanic, or an admin.
- **Weak:** "Drivers and mechanics."
- **Follow-up:** *"Can a mechanic cancel a booking?"* → "No. Commands are filtered by role; cancel is customer-only."

**4. What is the main workflow?**
- **Expected:** Login → vehicle → incident → location → diagnosis → dispatch → accept → live tracking → invoice → payment → review.
- **Good:** The above, plus "and it branches at incident: with no network it becomes a local incident and a queued sync operation."
- **Weak:** Reciting screens without the branch.
- **Follow-up:** *"Where does it branch?"* — have the answer ready.

**5. What technologies?**
- **Expected:** Node/Fastify, PostgreSQL + PostGIS, plain HTML PWA, SSE, Docker.
- **Good:** Add *why*: "PostGIS because dispatch is one indexed geospatial query. SSE not WebSocket because updates are server-to-client only."
- **Weak:** A list with no reasons.
- **Follow-up:** *"Why no React?"* → "No build step, no second deployment unit, fewer moving parts in the offline path."

**6. Why this architecture?**
- **Expected:** Modular monolith — boundaries without distributed-system cost.
- **Good:** "Four developers should not operate a distributed system. We get isolation from a CI fitness function that fails the build on a cross-module import, and we keep transactions."
- **Weak:** "Monolith is simpler."
- **Follow-up:** *"Show me the enforcement."* → `scripts/check-boundaries.mjs`. **Run it.**

**7. Role of the backend?**
- **Expected:** Sole authority for state, money and assignment.
- **Good:** "Server-authoritative. The client never decides that money arrived, that a job is assigned, or that a transition is legal."
- **Weak:** "It handles the API requests."
- **Follow-up:** *"Prove the client can't set the amount."* → the pay route uses the invoice total.

**8. Role of the database?**
- **Expected:** Both store and enforcer — the guarantees live here, not in application code.
- **Good:** "Uniqueness for idempotency, row locks for assignment, RULES making the audit log append-only. Database-level, so it survives a second instance."
- **Weak:** "It stores the data."
- **Follow-up:** *"Why not enforce in the app?"* → "An in-process guard doesn't survive replication."

**9. Role of AI?**
- **Expected:** A labelled rules engine that triages; a separate trained detector for road damage.
- **Good:** Volunteer the limitation first: "It's a deterministic rule table and every response says `rules-1.0.0`."
- **Weak:** "We use AI to diagnose the problem." *(Invites the worst follow-up in the viva.)*
- **Follow-up:** *"So it isn't AI?"* → "The roadside engine isn't, and we don't claim it is. The YOLO11n detector is, with measured metrics."

**10. Role of dispatch?**
- **Expected:** Assign the right provider at run time from a pool.
- **Good:** Name the score and the ladder: proximity 60%, rating 34%, newcomer bonus; wave of 5; 90 s TTL; escalation.
- **Weak:** "It finds the nearest mechanic." *(Loses the Module 4 marks.)*
- **Follow-up:** *"Why is that dynamic scheduling?"* — four properties, four matches.

**11. Role of real-time?**
- **Expected:** SSE as an accelerator over a polling floor.
- **Good:** "Persist first, publish second. Polling continues underneath, so a dropped stream loses a notification, never a fact."
- **Weak:** "We use WebSockets." *(Factually wrong — do not say this.)*
- **Follow-up:** *"Why not WebSocket?"* → ADR-0010.

**12. What happens when an incident is created?**
- **Expected:** Validated, persisted, audited, then dispatch is started.
- **Good:** Trace it: zod → row insert → `booking_events` → audit entry → dispatch wave → SSE publish.
- **Weak:** "It goes into the database."
- **Follow-up:** *"What if the same request arrives twice?"* → idempotency key.

**13. How is a mechanic selected?**
- **Expected:** PostGIS KNN with exclusions in SQL, then scored.
- **Good:** "Off-duty and already-committed providers are excluded **in the query**, not filtered afterwards — an earlier version filtered after a LIMIT and starved the wave."
- **Weak:** "By distance."
- **Follow-up:** *"What if none are free?"* → `NO_SUPPLY` with a named reason and a widen action.

**14. How does payment work?**
- **Expected:** Server-computed invoice → order → signature verified server-side → webhook → settlement.
- **Good:** "The booking cannot be marked PAID without a settled payment — 409 `payment_required`."
- **Weak:** "We use Razorpay."
- **Follow-up:** *"Is it live?"* → "No. Sandbox and a signature-exact stub. Production refuses to boot on mock."

**15. How is SOS handled?**
- **Expected:** Incident + escalation ladder, each rung reported as fact.
- **Good:** "It persists before it draws — a phone that dies mid-animation has still recorded the emergency."
- **Weak:** "It alerts emergency services." *(**Untrue.** Never say this.)*
- **Follow-up:** *"Does it contact 112?"* → "No. Stubbed, and the API response says so."

**16. What is offline mode?**
- **Expected:** Measured connectivity classification plus a local emergency workflow.
- **Good:** Give the three-way split — works / queued / needs network — without being asked.
- **Weak:** "It works offline." *(Too broad; invites a takedown.)*
- **Follow-up:** *"So everything works offline?"* → "No —" and name what does not.

**17. What happens after reconnect?**
- **Expected:** The journal drains; the incident gains a server id; no duplicate.
- **Good:** "The device reference is unique in the database, so a retry after a lost response converges on the incident that exists."
- **Weak:** "It syncs."
- **Follow-up:** *"Prove no duplicate."* → sync twice, live.

**18. Major limitations?**
- **Expected:** Not deployed; single instance; 112 stubbed; payments stub-only.
- **Good:** Answer without hesitating, and name the three in-process blockers.
- **Weak:** "None really" or a vague "scaling".
- **Follow-up:** *"Which would you fix first?"* → Redis-backed rate limiting.

**19. Main innovation?**
- **Expected:** The emergency path degrades honestly.
- **Good:** "Every other roadside app shows a spinner when the network dies. Ours creates the incident, encrypts it, tells you exactly what has and has not happened, and forwards it without duplicating."
- **Weak:** "The AI."
- **Follow-up:** *"Is that engineering or product?"* → "Both — and the engineering is the idempotent sync."

**20. Why is this useful?**
- **Expected:** It works where the customer actually is.
- **Good:** Tie to the geography: coverage is worst where breakdowns are most dangerous.
- **Weak:** Market-size claims you cannot support.
- **Follow-up:** *"Have you validated demand?"* → "No. The business slide says potential, not current."

---

# Round 2 — Cloud computing (25 questions: ACTUAL vs TARGET)

| # | Question | **ACTUAL implementation** | **Production target** |
|---|---|---|---|
| 1 | What makes this a cloud application? | SaaS provider to 3 classes + consumer via adapters; dispatch = dynamic scheduling over a pool; readiness gate | Managed platform, orchestrated |
| 2 | Which characteristics? | Broad network access (4 client types), resource pooling (600 mechanics) | On-demand self-service, measured usage/billing |
| 3 | Service model? | SaaS both ways; IaaS partial via compose | PaaS: managed Postgres + container platform |
| 4 | Deployment model? | Local, single instance | Public cloud, Indian data residency |
| 5 | Where is virtualization? | OS-level: 4-stage image, non-root uid 1000, tini PID 1, HEALTHCHECK; **suite passes against the image** | Managed nodes |
| 6 | Where is multitenancy? | Row-level on a shared schema; **12 cross-tenant attacks refused** | Same model, per-tenant encryption keys |
| 7 | Where is resource pooling? | `findCandidates()` — off-duty and busy excluded in SQL, then allocate | Multi-region pools |
| 8 | Where is workload distribution? | Dispatch ranks and distributes across the pool | Plus infra load balancing |
| 9 | Where is dynamic scheduling? | Run-time, pooled, live score, timeout re-scheduling | Same, with priority classes |
| 10 | Where is dynamic scalability? | **Only** the readiness gate: `/health` 503, `/v1/ping` 200 | HPA on CPU + queue depth |
| 11 | Where is elasticity? | **Not implemented.** Precondition built (stateless API) | Autoscaling group |
| 12 | Where is load balancing? | Application-level workload distribution only | L7 balancer, health-checked |
| 13 | Where is cloud bursting? | **Not implemented.** Modelled on a slide, labelled modelled | Burst to a second region at threshold |
| 14 | Where is replication? | **Not implemented.** API is stateless; 3 in-process blockers named | Read replicas + Redis-backed shared state |
| 15 | Where is redundant storage? | Restore **rehearsed and measured** (dump 1.2 s, restore 7.2 s, audit chain intact across 639 entries) | Multi-AZ, WAL archiving, scheduled |
| 16 | Elastic disk provisioning? | **Not implemented** | Auto-expanding volumes |
| 17 | Where is migration? | Schema migration real: 5 versioned, additive, run from empty | Live workload migration |
| 18 | Database fails? | `/health` 503 naming the database, `/v1/ping` 200, **automatic recovery, no restart** | Failover to replica |
| 19 | Backend fails? | Service worker serves the cached shell; SOS degrades to the local path | Replicas behind a balancer |
| 20 | Scale to 1M users? | Not attempted; no load test run | Read replicas, Redis, partition `bookings` by time, CDN for static |
| 21 | Make it highly available? | **Not today** — single instance | Multi-AZ, ≥2 replicas, managed Postgres failover |
| 22 | Introduce autoscaling? | Readiness gate exists as the precondition | HPA + externalise the 3 in-process components |
| 23 | Multi-region? | Not attempted; data-residency constraint documented | Region-pinned data, geo-routing |
| 24 | Biggest bottleneck? | **The database, then the three in-process components** | Replicas + Redis + outbox bus |
| 25 | Which topics are only conceptual? | 8 of 21: PaaS, deployment models, replication, dynamic scalability, elastic capacity, elastic disk, bursting, infra load balancing | — |

**How to deliver Round 2:** always say the ACTUAL column first. A professor who
hears "not implemented, and here is exactly what blocks it" marks higher than
one who hears a target described in the present tense.

---

# Rounds 3–10 — the traps

Full answers with code paths are in `FINAL_VIVA_100.md` (questions 46–100).
What follows is what actually loses marks in each round.

### Round 3 — Architecture (Q46–55)
- **Trap:** saying "WebSocket". It is **SSE**, and ADR-0010 gives the reason.
- **Trap:** claiming microservices. It is a modular monolith with **CI-enforced** boundaries — a stronger answer, because it is enforced rather than agreed.
- **Must show:** `scripts/check-boundaries.mjs` running.

### Round 4 — AI (Q66–75)
- **Trap:** letting "AI-powered" stand unqualified. Volunteer "deterministic rule table, labelled `rules-1.0.0`" before you are pushed.
- **Strongest two answers:** the **safety asymmetry** (a model may make a verdict stricter, never laxer) and the **CI divergence guard** between device and server tables.
- **"Can the AI decide autonomously?"** → **No.** A model may raise a signal; only a human escalates (ADR-0005).
- **"How would you evaluate accuracy?"** → Labelled outcome data — what the mechanic actually found versus what we predicted. We do not have it, so we do not quote an accuracy figure.
- **Ethical risk:** a wrong "safe to drive". That is exactly why the asymmetry exists.

### Round 5 — Offline and SOS (Q86–95) — **highest risk**
- **Never say** SOS reaches emergency services offline. **No satellite, no mesh, no SMS bypass.**
- Have the three-way split ready without hesitation: **works** (GPS, diagnosis, cached tiles, local incident) · **queued** (the incident) · **needs network** (dispatch, tracking, ETA, payment, contacting anyone).
- **"Can GPS work without internet?"** → Yes. It is a satellite receiver; it transmits nothing.
- **"Can maps work?"** → Cached tiles only — 25 of 25 for the prepared corridor, and the UI shows the count.
- **"If the same operation reaches the server twice?"** → Unique `client_incident_id`; the second converges on the first.
- **"If sync fails?"** → Stays queued, jittered backoff, UI says *sync retry pending*. It never claims success.

### Round 6 — Security (Q76–85)
- **"What is HMAC?"** → Keyed hash proving a message came from someone holding the secret. We recompute the payment signature server-side and compare.
- **"Where are secrets stored?"** → Environment only. Never in the frontend; repository-wide search found none.
- **"Why hash chaining?"** → Each audit entry carries the previous digest, so removing or editing one breaks the chain. Plus Postgres RULES make UPDATE/DELETE silently no-op.
- **Volunteer:** no independent penetration test.

### Round 7 — Database (Q56–65)
- **"Two requests update the same incident?"** → Guarded `UPDATE … WHERE status = <expected>`. If the row moved, the update matches nothing and the command loses.
- **"How would you replicate?"** → Managed read replicas; but first externalise the three in-process components.
- **"Backups?"** → Restore rehearsed and measured; **no schedule** — real RPO is "whenever somebody runs it".

### Round 8 — Dispatch (Q39–43)
- **"Is severity considered?"** → Severity drives urgency and pre-selects the service; the **ranking** score is proximity, rating and exploration. Do not claim severity is in the score — it is not.
- **"Two providers respond?"** → Row lock; one wins.
- **"Scale geographically?"** → The GiST index already scopes by radius; regional pools would come with multi-region.

### Round 9 — Payment (Q14, 26)
- **"Can the frontend modify the amount?"** → No. The amount is the invoice total, server-computed.
- **"Webhook arrives twice?"** → Idempotent; no double charge.
- **"Payment succeeds but the client disconnects?"** → The webhook settles it server-side. That is exactly why `PAYMENTS_WEBHOOK_SECRET` is mandatory in production — without it the only settlement signal is the payer's browser surviving checkout, which is a money bug.

### Round 10 — "Show me the code"
→ `FINAL_PROFESSOR_DEFENSE.md` has the full table: claim → file → line → demo screen → SWE4004 topic.

---

# Rapid-fire — 50 questions, 5–15 seconds each

| # | Q | A |
|---|---|---|
| 1 | IaaS? | Rented compute, network and storage; you manage the OS upward. |
| 2 | PaaS? | Managed runtime; you deploy code, not servers. |
| 3 | SaaS? | Software delivered as a service over the network. |
| 4 | Elasticity? | Capacity follows demand automatically. |
| 5 | Scalability? | Capacity can grow — manually or automatically. |
| 6 | Elasticity vs scalability? | Elasticity is automatic and bidirectional; scalability is capability. |
| 7 | Virtualization? | Running isolated environments on shared hardware. |
| 8 | Containers vs VMs? | Containers share the host kernel; VMs virtualise hardware. |
| 9 | Multitenancy? | One instance serving many tenants with isolated data. |
| 10 | Resource pooling? | Serving many consumers from a shared, dynamically assigned pool. |
| 11 | Replication? | Keeping synchronised copies for availability or read scale. |
| 12 | Load balancing? | Distributing requests across instances. |
| 13 | Workload distribution? | Distributing *work* across a pool — what our dispatch does. |
| 14 | Idempotency? | Repeating an operation changes nothing further. |
| 15 | RBAC? | Permissions granted through roles, not to individuals. |
| 16 | HMAC? | Keyed hash proving origin and integrity. |
| 17 | PostGIS? | Geospatial extension for PostgreSQL — indexed distance queries. |
| 18 | GiST index? | The index type that makes geospatial search fast. |
| 19 | Webhook? | A server-to-server callback carrying an event. |
| 20 | PWA? | A web app that installs, caches its shell and works offline. |
| 21 | Service worker? | A background script intercepting requests to serve cache. |
| 22 | Offline-first? | Designed so the local path is primary, not a fallback. |
| 23 | Dynamic scheduling? | Run-time assignment from a pool by live state. |
| 24 | Static scheduling? | Decided in advance, on a fixed interval. |
| 25 | Cloud bursting? | Overflowing into extra capacity at peak. |
| 26 | RTO? | How long recovery may take. |
| 27 | RPO? | How much data you may lose. |
| 28 | Our RPO? | A target only — no backup schedule is configured. |
| 29 | SSE? | Server-to-client stream over one long-lived HTTP GET. |
| 30 | SSE vs WebSocket? | SSE is one-directional and simpler; we only push server→client. |
| 31 | JWT? | Signed token carrying claims; no server session needed. |
| 32 | Refresh rotation? | Each refresh issues a new token; reuse signals theft. |
| 33 | Rate limiting? | Bounding requests per principal per window. |
| 34 | Our rate limiter's limit? | In-process — each replica would get its own ceiling. |
| 35 | Optimistic concurrency? | Detect conflict at write time via a version or guarded update. |
| 36 | Row lock? | `SELECT … FOR UPDATE` — serialises writers on that row. |
| 37 | ACID? | Atomicity, consistency, isolation, durability. |
| 38 | Why integer paise? | Floating point cannot represent money exactly. |
| 39 | Migration? | Versioned, ordered schema change. |
| 40 | Additive migration? | Adds without removing, so old code still runs. |
| 41 | Audit log? | Immutable record of who changed what, when. |
| 42 | Hash chain? | Each entry carries the previous digest; tampering breaks it. |
| 43 | Zero trust? | Verify every request; never trust by network position. |
| 44 | Stateless API? | No per-client state in memory — a precondition for replication. |
| 45 | Readiness vs liveness? | Ready = can serve; live = process alive. Ours: `/health` vs `/v1/ping`. |
| 46 | Circuit breaker? | Stop calling a failing dependency; fail fast. |
| 47 | Backoff with jitter? | Retry after growing, randomised delays to avoid thundering herds. |
| 48 | Our AI model version? | `rules-1.0.0`. |
| 49 | Our test total? | 626 executed, 0 failures, six suites. |
| 50 | Our biggest limitation? | Single instance — three in-process components. |

---

# Live demo interruption simulation

| Interruption | Ideal response | Where |
|---|---|---|
| "Stop. Explain this screen." | Name the screen, the endpoint behind it, and the one guarantee it demonstrates. | any |
| "Where is the cloud?" | "Consumed, not operated — nothing is deployed. What is built is containerisation, a stateless API and a readiness gate." | slide 9 |
| "Show me the database." | `docker exec ra-db psql -U roadassist -d roadassist_rc -c "\dt"` → 56 tables. | terminal |
| "Show me the API." | `apps/api/src/server.ts` — point at a route and its zod schema. | editor |
| "Why did *this* mechanic get selected?" | "Nearest available after excluding off-duty and busy — proximity 60%, rating 34%, newcomer bonus. The card shows the distance the ranking used." | dispatch screen |
| "What if this mechanic rejects?" | "The offer closes and the ladder escalates to the next wave on the sweeper's interval — that is the timeout-driven re-scheduling." | `dispatch.ts` |
| "Turn off the internet." | Tap the pill. Say: "I'm taking the network away now." | customer window |
| "What happens now?" | Give the three-way split — works / queued / needs network. | off-grid screen |
| "Why is this still working?" | "Diagnosis runs on the device from the same rule table, and CI fails the build if the two ever diverge." | `offline-engine.js` |
| "Can you prove synchronization?" | `await window.__ra.listOffGrid()` → `SYNCED` with a server id. Then sync again — count unchanged. | DevTools |
| "Show me the audit record." | `/v1/ops/overview` — live counts plus a chain verification. | browser |
| "Show me payment verification." | `apps/api/src/routes/payments.ts:374` webhook — signature recomputed server-side; forged signature returns 402. | editor |
| "Show me the security implementation." | Run `npm run test:security` — 74 passed, 0 failed, live. | terminal |
| "Is that real data?" | "Generated seed data — no real customer information. 6,038 bookings, 600 mechanics." | — |

**If something breaks mid-demo:** say what failed, what it means, and move on.
`DEMO_FAILURE_BACKUP_PLAN.md` has a per-failure answer, and none of them fakes a
result.

---

# Marks-loss simulation — honest rubric (100)

Not inflated. This is my estimate as an examiner, given the evidence that exists.

| Area | Weight | Likely | Evidence | Risk | How to maximise |
|---|---|---|---|---|---|
| Project idea | 8 | **7–8** | Genuine, specific problem; clear differentiator | Sounds like an aggregator if pitched badly | Lead with the connectivity failure, not the marketplace |
| Architecture | 10 | **8–9** | Modular monolith, CI-enforced boundaries, ADRs | Monolith read as unambitious | Say "enforced, not agreed" and run the check |
| Cloud concepts | 15 | **10–12** | 8 implemented, 5 partial, 8 design | **Highest risk** — 8 are design | Lead with pooling + distribution + scheduling; name blockers precisely |
| Implementation | 15 | **13–14** | 705 assertions, 6 real bugs found and fixed | Little | Show the row lock |
| AI | 10 | **6–7** | Rules engine, labelled; trained YOLO11n separate | "Not real AI" | Agree instantly, pivot to asymmetry + CI guard |
| Database | 10 | **9** | 56 tables, hash-chained audit, PostGIS | Little | Show the append-only RULES |
| Security | 10 | **8–9** | 101 attacks refused; real CVE fixed | No pentest | Volunteer that before asked |
| Testing | 8 | **8** | 626 executed, twice, plus timed rehearsal | Little | Run a suite live |
| UI/UX | 5 | **4** | Real screenshots, phone-first | Sparse on a projector | Demo at 430 px |
| Offline resilience | 10 | **9–10** | The strongest area; unanswerable demo | Overclaiming offline reach | Give the three-way split unprompted |
| Demo | 5 | **4–5** | Rehearsed, timed, 9 clean runs | Live failure | Backups ready |
| Viva | 10 | **8–9** | 100 answers with code paths | Bluffing under pressure | "Designed and not provisioned" costs nothing |
| Documentation | 4 | **4** | 30+ documents, 10 ADRs | Sprawl | Point to the master report |
| **Total** | **100** | **≈ 82–89** | | | |

**The single biggest lever:** capture the six terminal screenshots
(`FINAL_SCREENSHOT_CHECKLIST.md` rows 19–23). They convert "we tested it" into
evidence and cost ten minutes.

---

# The 5-minute oral defense

**0:00 — Problem.** "A breakdown is not a software problem — until you realise
the app you'd use to fix it needs the network you don't have. On Indian
highways coverage is worst exactly where a breakdown is most dangerous. Every
roadside app assumes connectivity. We assumed it would fail."

**0:30 — Solution.** "RoadAssist Bharat: one platform from incident to
resolution. Describe the fault, an engine names a likely cause with a severity,
dispatch ranks nearby mechanics and offers the job in timed waves, and the
customer watches it happen live. And when the network goes, the emergency half
keeps running on the phone."

**1:00 — Architecture.** "Three surfaces — citizen app, mechanic console,
authority dashboard — plain HTML and ES modules served by one process, so
there's no build step and no second deployment unit. Behind them a Fastify API,
65 routes, zod validation at every boundary, a uniform envelope. Five modules in
one deployable, and the boundaries are enforced mechanically: a cross-module
import fails the build. Underneath, PostgreSQL 16 with PostGIS — 56 tables, and
an append-only hash-chained audit log the database itself won't let you edit."

**1:45 — Cloud.** "We're a SaaS provider to three user classes and a consumer
through adapters — every vendor has a local implementation, which is why this
demo runs on zero paid accounts. Virtualization is real: a four-stage container,
non-root, and the full suite passes against the image, not just the source.
Multitenancy is row-level and proven — twelve cross-tenant attacks, all refused.
From Module 4, two of the eight architectures are genuinely built: workload
distribution and resource pooling. Eight are design, and I'll say which."

**2:30 — AI and dispatch.** "The diagnosis engine is a deterministic rule table
and every response says `rules-1.0.0`. I won't call it AI. Two things about it
are worth defending: a remote model may make a verdict stricter, never laxer;
and CI fails the build if the rule table on the phone diverges from the
server's. Dispatch is a PostGIS nearest-neighbour search that excludes off-duty
and committed providers in SQL, then ranks — proximity sixty per cent, rating
thirty-four, plus a newcomer bonus. Offered in waves of five with a ninety-second
timeout that escalates on its own. That's dynamic scheduling: run time, from a
pool, by live state, re-scheduled on timeout."

**3:15 — Offline and SOS.** "Connectivity is measured, not assumed. Off-grid,
diagnosis still runs, GPS still works — it's a satellite receiver — and an SOS
becomes a real encrypted incident on the device with its own short reference.
It says *nothing has been transmitted*, because nothing has, and it tells you to
call 112. It cannot reach emergency services offline: there's no satellite, no
mesh, no SMS bypass. On reconnect it forwards itself, and a unique device key
makes a duplicate impossible."

**4:00 — Security and payment.** "OTP with per-number and per-IP ceilings,
refresh rotation with reuse detected as theft, ownership checks on every
resource. A hundred attacks across two suites, all refused — and we fixed a real
CVE class in this release. Payment: the client never decides money arrived. The
amount is the invoice total, the signature is recomputed server-side, and a
booking can't be marked paid without a settled payment."

**4:30 — Testing.** "705 assertions across six suites, zero failures, run twice
— once on a fresh database and again after a full reset. Plus a timed demo
rehearsal that walks all fifteen beats in two browser windows. Six real bugs
were found by tooling we wrote to attack our own project, including two
mechanics who could both accept the same job."

**4:45 — Limitations.** "Nothing is deployed to a cloud. It's a single instance
— the SSE registry, rate limiter and offer sweeper are in-process, and that's
what a second instance would break. 112 is stubbed. Payments are sandbox-only.
No independent penetration test."

**5:00 — Conclusion.** "Intelligent assistance when the road fails. Resilient
software when the network fails. Nothing on our slides is a claim I can't show
you."

---

# The answer formula

**Direct answer → RoadAssist example → technical evidence → limitation → future
improvement.**

> *"Is your system scalable?"*
>
> "The application layer is designed for horizontal scaling because it's
> stateless — session state is in the token, not in memory. What's built is the
> readiness gate: stop Postgres and health returns 503 while ping stays 200,
> which is what lets an orchestrator remove an instance. But autoscaling isn't
> deployed, and three in-process components would break a second instance today
> — the SSE registry, the rate limiter and the offer sweeper. In production I'd
> move those to Redis and an outbox bus, then add managed replicas and a load
> balancer."

Never answer beyond the implementation. "Designed and not provisioned" costs
nothing. A claim you cannot show costs the room.

---

# Professor final verdict

| Dimension | Score |
|---|---|
| Technical understanding | **9**/10 |
| Cloud understanding | **7**/10 |
| Architecture | **9**/10 |
| Implementation | **9**/10 |
| AI understanding | **7**/10 |
| Security | **8**/10 |
| Database | **9**/10 |
| Offline / SOS | **10**/10 |
| Testing | **9**/10 |
| Presentation | **8**/10 |
| Viva readiness | **8**/10 |
| **Total** | **≈ 85/100** |

Cloud is 7 not because the understanding is weak but because eight of twenty-one
concepts are honestly unbuilt — and no amount of rehearsal changes that without
a deployment. AI is 7 for the same reason: correctly labelled, genuinely modest.

**Strongest areas**
1. Offline / off-grid resilience — the tab-close demo is unanswerable.
2. Concurrency and data integrity — row lock, idempotency, hash-chained audit.
3. Testing honesty — 705 assertions and six self-found bugs.

**Weakest areas**
1. Nothing deployed — eight cloud concepts remain design.
2. The diagnosis engine is rules, not a model.
3. Single instance, with three in-process blockers.

**Most dangerous questions**
1. "Is your AI actually AI?"
2. "Where is autoscaling / replication / load balancing?"
3. "Can SOS contact emergency services offline?"
4. "Is anything actually deployed?"
5. "Two mechanics accept at the same instant — what happens?"

**Must memorise**
1. `rules-1.0.0`, and the safety asymmetry.
2. Dispatch score: proximity 60% / rating 34% / newcomer bonus; wave 5; 90 s TTL.
3. `SELECT … FOR UPDATE` on the booking row, expiry checked inside the transaction.
4. The offline three-way split: works / queued / needs network.
5. 705 assertions, six suites, zero failures — and that a seventh needs an account.

**Must show in the demo**
1. The `rules-1.0.0` badge.
2. Ranked dispatch offers with real distances.
3. The customer screen following the mechanic **untouched**.
4. **Closing the tab off-grid and reopening it.**
5. Re-syncing and creating no duplicate.

## Final status

**READY — with two hours of practice.**

The implementation defends itself; the risk is delivery. Rehearse the demo
twice end to end, drill the five dangerous questions until the answers are
reflexes, and capture the six outstanding terminal screenshots.

The one thing that is not practice: **nothing is committed and no tag exists.**
