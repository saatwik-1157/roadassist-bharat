# Attack pack — the answers you memorise

Written for the ten minutes before a viva. Everything here is verifiable in the
repository; nothing is aspirational.

---

## 30-second pitch

> India has 350 million vehicles and highways where coverage is worst exactly
> where a breakdown is most dangerous. RoadAssist Bharat is an emergency
> mobility platform that connects a stranded driver to the nearest available
> mechanic — and keeps working when the driver has no network. The SOS is
> created on the device, stored encrypted, and forwarded when signal returns,
> with no duplicate. Every other roadside app shows you a spinner.
>
> **RoadAssist doesn't stop when the network stops.**

## 60-second explanation

> **Problem.** A breakdown is not a software problem until you notice that the
> app you would use to fix it needs the network you do not have.
>
> **Solution.** One platform from incident to resolution: describe the fault, an
> engine names a likely cause, dispatch ranks nearby mechanics and offers the
> job, and the customer watches it happen live.
>
> **Technology.** Fastify and PostgreSQL with PostGIS — dispatch is one indexed
> geospatial query. Server-sent events for live status. A progressive web app
> with a service worker and IndexedDB for the offline half.
>
> **Innovation.** The connectivity manager classifies the network as ONLINE,
> LIMITED or OFF-GRID from measured evidence. Off-grid, an SOS becomes a real
> incident on the device with its own reference and GPS fix, in encrypted
> storage, and it says plainly that nothing has been transmitted. On reconnect
> it forwards itself, and a unique key makes a duplicate impossible.
>
> **Result.** 578 assertions executed across six suites, no failures, including 74
> attacks that must fail. A seventh suite — 22 payment-gateway checks — needs a
> Razorpay sandbox account and is not run; the same settlement path is covered
> against a signature-exact stub. Every claim on our slides is something I can show you.

## 60-second architecture

> Three surfaces — citizen app, mechanic console, authority dashboard — all
> plain HTML and ES modules served by the same process, so there is no build
> step and no second deployment unit.
>
> They talk to a **Fastify API**: 64 routes, 61 of them under `/v1`, zod validation at
> every boundary, a uniform envelope, and stable error codes.
>
> Behind it, five modules in one deployable — identity, fleet, service, ops and
> RAKSHA — with the boundaries enforced *mechanically*: a fitness function fails
> the build on a cross-module import.
>
> **Dispatch** is a PostGIS nearest-neighbour search that excludes off-duty and
> already-committed providers, ranks the rest, and offers in waves with a
> timeout that escalates. Assignment is settled under a row lock, so exactly one
> mechanic can win. **SOS** has its own state machine where a model can raise a
> signal but only a human can escalate. **Real-time** is server-sent events —
> persist first, publish second, and polling continues underneath because the
> stream is an accelerator, never the truth. **Offline** is a connectivity
> manager, an on-device rules engine and an encrypted IndexedDB journal that
> forwards idempotently. **Payment** never trusts the client: the amount is the
> invoice total and settlement needs a signature the server recomputes.
>
> All of it on **PostgreSQL 16 + PostGIS** — 56 tables, 62 foreign keys, and an
> append-only hash-chained audit log.

## 30 seconds: "How does it work without internet?"

> Precisely: **GPS works** — it is a satellite receiver, it transmits nothing.
> **Diagnosis works** — the same rule table the server uses runs on the device,
> and a CI test fails the build if they ever diverge. **Cached map tiles and the
> last-known service positions render.** **An SOS is created, stored encrypted
> and queued.**
>
> What does **not** work: the SOS reaching dispatch, live mechanic tracking,
> ETAs, and payment. Those need the cloud, and the app says so rather than
> spinning. It tells the user "Nothing has been transmitted" and recommends
> calling 112, because voice often works on a signal too weak for data.

## 30 seconds: "Why is this a cloud computing project?"

> Three layers, and I will keep them apart.
>
> **Actually implemented:** we are a SaaS provider to three user classes and a
> SaaS consumer through adapters — SMS, payments, tiles, email. Container
> virtualization, row-level multitenancy proven by twelve refused cross-tenant
> attacks, cloud storage in three forms, and dynamic scheduling in the dispatch
> engine.
>
> **Cloud-ready:** stateless API, idempotency keys, server-authoritative state,
> a readiness gate that returns 503 when the database is unreachable. Those are
> the preconditions for replication and autoscaling, and they are built.
>
> **Future:** the autoscaler, the load balancer, multi-AZ replication and cloud
> bursting are designed and **not provisioned**. I will not show you an
> animation and call it a cluster.

---

## Marks-loss analysis

| Area | Risk | Severity | Mitigation |
|---|---|---|---|
| **Cloud concepts** | 8 of 21 concepts are DESIGN. An examiner wanting "deployed cloud" may mark down. | **HIGH** | Lead with the two Module 4 architectures that ARE built (workload distribution, resource pooling) and the readiness gate. Then say the rest is designed — precisely, with the three in-process blockers named. Precision reads as competence; vagueness reads as bluffing. |
| **Cloud concepts** | "You have no Kubernetes." | MEDIUM | Correct, and deliberate: ADR-0001 explains why four developers should not operate a cluster. Offer the target diagram. |
| **AI** | "Your AI is if-statements." | MEDIUM | Agree immediately. It is a deterministic rules engine, labelled `rules-1.0.0` in the response. Then pivot to the two genuinely interesting parts: the safety asymmetry, and the device/cloud divergence guard. Mention the real trained YOLO11n with measured mAP50. |
| **Functionality** | A demo step fails live. | MEDIUM | Every step in `DEMO-SCRIPT.md` has a backup, and no backup fakes success. The failure path *is* the argument. |
| **Offline** | "Is the offline part real, or a mock?" | LOW | Close the tab and reopen it. That single action is unanswerable. |
| **Security** | "Have you had a pentest?" | LOW | No. 74 self-written attacks is not the same thing, and I say so. |
| **Testing** | "What is your coverage?" | LOW | 95.68% lines on the pure domain modules; the HTTP layer is tested out-of-process so instrumentation cannot see it. Precise beats impressive. |
| **UI/UX** | Screens look sparse on a projector. | LOW | Demo on a phone-width window; the app is designed for 390px. |
| **Presentation** | PowerPoint reflows text on an unfamiliar machine. | LOW | Closed. `ppt/RoadAssist-Bharat-FINAL.pdf` is exported from the final deck — 32 pages, fonts embedded. Present from the PDF; the .pptx is the backup, not the other way round. |
| **Viva** | An answer contradicts a document. | **HIGH → now LOW** | Every numeric claim was cross-checked this phase; seven stale figures and four cross-document contradictions were found and fixed. |

---

## The five questions most likely to hurt

**1. "Show me the autoscaler."**
There isn't one. The scaling design is on slide 15 and the slide says DESIGN. What
is built is the readiness gate — I can stop Postgres and show `/health` return
503 while `/v1/ping` still returns 200.

**2. "So this is just a CRUD app with a map?"**
Three things a CRUD app does not have: an assignment that is safe under ten
simultaneous accepts, an emergency workflow that runs with the network off and
forwards without duplicating, and a rules engine that provably matches between
device and cloud. I can demonstrate all three in four minutes.

**3. "Is anything actually deployed?"**
No. A production Docker image is built and the entire test suite passes against
it, but no cloud account exists. I would rather say that than point at a diagram.

**4. "What is the weakest part?"**
Single-instance. The SSE registry, the rate limiter and the offer sweeper are
in-process, so replicas would each get their own rate ceiling and their own set
of connected clients. The fix for each is designed — Redis, and the
outbox→Redpanda bus already in the architecture — and it is documented at each
definition, not discovered later.

**5. "Did you find any bugs in your own project?"**
Yes, and they are the best evidence the testing is real. Two mechanics could
both accept one job — the status was read outside the transaction. Three
simultaneous SOS returned 500. 874 bookings sat in an impossible state because
the *seeder* was wrong. Malformed JSON was reported as a server error. And this
week, seven stale numbers and four contradictions between my own documents. All
found by tooling I wrote to attack the project, and all fixed.
