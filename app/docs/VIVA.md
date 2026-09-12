# Viva defence

Every answer is grounded in code that exists in this repository. Where the
honest answer is "designed, not built", it says so — and then says what *is*
built instead, which is usually the stronger answer.

Format: **Short** → **Technical** → **In RoadAssist** → **Status**.

**56 questions.** Q1-40 are the core set, in the order a viva usually walks.
Q41-56 are grouped by topic and cover what an examiner pushes on once the core
answers land.

| Group | Questions |
|---|---|
| Cloud computing | 1-20, 41-43 |
| Architecture | 3, 21, 38, 44-45 |
| Database | 29, 39, 46-47 |
| AI | 34-35, 48 |
| Offline | 22-26, 49-50 |
| SOS | 23, 26, 51 |
| Dispatch | 21, 32-33, 52 |
| Security | 27-28, 53-54 |
| Payment | 28, 55 |
| Real-time | 12, 56 |
| Testing and deployment | 30, 36-37, 40 |

---

### 1. What is cloud computing?

**Short.** On-demand access to a shared pool of computing resources you do not
own, provisioned and released quickly, and paid for by use.

**Technical.** NIST's five characteristics: on-demand self-service, broad
network access, resource pooling, rapid elasticity, measured service.

**In RoadAssist.** We are a consumer of IaaS/PaaS and a provider of SaaS to
three user classes. Broad network access is the one we lean on hardest: one API
serves a browser, an installed PWA, an Android WebView and a feature phone over
SMS.

**Status.** Consumed in design; the SaaS-provider side is built.

### 2. Why does RoadAssist need cloud computing?

**Short.** Demand is unpredictable and national; the alternative is buying for
the worst hour of the monsoon and idling the rest of the year.

**Technical.** Load is spiky and correlated with weather and festivals — the
classic elasticity case. It is also geographically spread, which argues for
regional presence rather than one machine.

**In RoadAssist.** Dispatch is a PostGIS nearest-neighbour query over a national
provider pool; that pool and its index have to live somewhere reachable from
everywhere.

**Status.** The argument is sound; the elastic infrastructure is not deployed.

### 3. Why did you choose this architecture?

**Short.** A modular monolith with one deliberate exception, because boundaries
we cannot enforce are boundaries we will lose.

**Technical.** ADR-0001. Microservices at four developers means distributed
transactions, five deployment pipelines and a network hop between every module —
paid up front, for scale we do not have. Instead: one deployable, five modules,
and the boundaries enforced *mechanically* by `scripts/check-boundaries.mjs`,
which fails the build on a cross-module import.

**In RoadAssist.** The exception is the emergency service (ADR-0005), designed
as a separate deployable because its failure mode is different from everything
else's.

**Status.** Monolith IMPLEMENTED and boundary-checked in CI. Emergency isolation
is DESIGN — today it is a module in the same process.

### 4. What cloud service model does RoadAssist use?

**Short.** All three, in different roles.

**In RoadAssist.** **IaaS** — we would size compute, storage and the virtual
network; `docker-compose.yml` is the local stand-in. **PaaS** — managed Postgres
and a managed container platform. **SaaS** — we *consume* Twilio/MSG91,
Razorpay, OSM tiles; and we *are* SaaS to citizens, mechanics and authorities.

**Status.** SaaS-consumer IMPLEMENTED (`providers.ts`, every vendor behind an
adapter with a local fallback). IaaS/PaaS DESIGN.

### 5. What deployment model is appropriate?

**Short.** Public cloud, Indian region, single tenant per deployment.

**Technical.** The constraint that decides it is regulatory, not technical: "No
PII leaves India" — including logs, backups and crash reports.

**Status.** DESIGN. Nothing is deployed.

### 6. Where is virtualization used?

**Short.** OS-level virtualization — containers — is what we actually operate.

**Technical.** `app/Dockerfile` is a four-stage build: dependencies, compile,
production-dependencies-only, runtime. The runtime runs as `node` (uid 1000),
not root, with tini as PID 1 so SIGTERM reaches the process.

**In RoadAssist.** Five containers in development (API, PostGIS, Redis,
Redpanda, and the migration job). Hardware virtualization is the layer beneath,
which we consume.

**Status.** IMPLEMENTED and verified — the image was built and the full test
suite run against it.

### 7. What is multitenancy?

**Short.** One running instance serving many isolated tenants.

**Technical.** Three models: separate database, separate schema, shared schema
with row-level scoping. We use the third.

### 8. How is multitenancy represented?

**In RoadAssist.** Every query is scoped by `user_id`; the authority tenant is
scoped by `gov_jurisdictions`/`gov_officers`. Crucially, scoping is enforced at
the *resource*, not just by a role gate — `bookingAudience()` checks ownership on
every booking read and write.

**Proven, not asserted.** `scripts/security-audit.mjs` §1 fires twelve
cross-tenant attacks — read another customer's booking, cancel it, pay it,
review it, cancel their SOS, book against their vehicle, rename their vehicle —
and every one is refused with 403.

**Status.** IMPLEMENTED.

### 9. What is cloud storage?

**Short.** Storage consumed as a service, in block, file or object form.

**In RoadAssist.** Block — the Postgres volume. File — hazard photos on a
mounted volume (`UPLOAD_DIR`; ADR-0006 keeps only the reference in the database).
Object storage is DESIGN. The interesting one is **client-side** storage:
IndexedDB with AES-GCM-256 at rest, which is what makes off-grid work.

**Status.** Block/file IMPLEMENTED, object DESIGN, client-side IMPLEMENTED.

### 10. What is cloud monitoring?

**In RoadAssist.** Structured JSON logs with a correlation id on every request;
operation-level logs carrying operation, duration, result, and the booking or
incident id (`observability.ts`); `/health` reporting application and database
separately; `/v1/ping` with no database at all; and `/v1/ops/overview` — live
counts of active and critical incidents, provider states by name, failed syncs,
stale payments, and a **live verification of the audit hash chain**.

**Every figure is a live count.** The response says so: *"Nothing here is
sampled, cached or estimated."*

**Status.** PARTIAL — no external APM. `logOp` is the integration point.

### 11. What is resource replication?

**Short.** Multiple instances of a resource for availability or capacity.

**In RoadAssist.** Not done. The precondition is met — the API is stateless,
session state lives in the JWT — but three things would break under replication
and each is documented where it is defined: the SSE registry, the rate limiter
and the offer sweeper are all in-process.

**Status.** DESIGN. Saying this precisely is better than claiming it.

### 12. What is dynamic scalability?

**Short.** Adding and removing capacity automatically in response to load.

**In RoadAssist.** Designed as an HPA on queue depth rather than CPU, because
our workload is I/O-bound — we measured it: dispatch spends its 113 ms in
PostGIS, not in Node. One component is built: the **readiness gate**. `/health`
returns **503** when the database is unreachable, so an orchestrator removes the
instance rather than sending traffic to a server that cannot serve. Verified.

**Status.** DESIGN, with the readiness gate IMPLEMENTED.

### 13. How can RoadAssist scale?

Stateless API replicas behind a load balancer; Postgres read replicas for the
map and history reads; PostGIS partitioning by region when the provider table
grows. Three blockers first, in order: Redis-backed rate limiting, an event bus
for SSE fan-out (`outbox_events` → Redpanda, already in the architecture), and
moving the offer sweeper to a single worker.

### 14. What is load balancing?

**Short.** Distributing requests across instances by some policy.

**In RoadAssist.** No infrastructure load balancer. But the syllabus's
*workload distribution* is exactly what dispatch does: rank a pool of providers
by proximity (60%), rating (34%) and an exploration bonus for newcomers, then
distribute. That is real code (`rankMechanics`) and I can run it.

**Status.** Infrastructure DESIGN; application-level workload distribution
IMPLEMENTED.

### 15. What is cloud bursting?

Overflowing from baseline capacity into on-demand capacity at a peak, then
releasing it. **Status: DESIGN.** The deck's evening timeline is a modelled
scenario and is now labelled as modelled.

### 16. What is elastic resource capacity?

Adjusting the resources allocated to an instance (or the number of nodes) as
demand moves. **Status: DESIGN.**

### 17. What is redundant storage?

A secondary replica with failover. **Status: DESIGN.** A backup and restore
procedure is documented in `DEPLOYMENT.md` with RPO 24 h and RTO 30 min both
**rehearsed and measured**: dump 1.2 s, restore 7.2 s, row counts identical, PostGIS geometry intact, and the audit hash chain re-verified intact across all 639 entries on the restored copy. It runs as a CI step.

What is still `DESIGN` is the *redundancy*: one node, no replica, no failover. And RPO stays a **TARGET** at 24 hours because no backup **schedule** is configured — which for an emergency platform is not good enough, and I would fix it with WAL archiving before anything else.

### 18. What is migration?

**Schema migration is real and rehearsed.** Five versioned migrations; this
audit ran `db:reset → db:migrate → db:seed` from empty and then the whole test
suite. All five are additive — new columns and indexes, no drops, no retypes —
so an older image runs against a newer schema, which is what makes a rollback
safe. Workload/live migration is DESIGN.

### 19. Static vs dynamic scheduling?

**Static** decides before run time on a fixed schedule; **dynamic** decides at
run time from live state.

**In RoadAssist.** Static — the offer sweeper on a fixed interval, the client
poll, the SSE heartbeat. Dynamic — dispatch.

### 20. Where is dynamic scheduling used?

The dispatch ladder (`dispatch.ts`). Work is assigned at run time from a pool,
by a score computed from live state (distance, rating, workload, availability),
with **timeout-driven rescheduling**: if nobody in a wave answers before
`expires_at`, the sweeper closes those offers and escalates to the next wave.
A decline escalates immediately. **Status: IMPLEMENTED**, tested in
`concurrency-test.mjs` §9b.

### 21. How does your dispatch engine work?

1. PostGIS `ST_DWithin` finds providers in range of the booking's point.
2. **In SQL**, exclude anyone off duty, anyone already committed to a customer
   (`ASSIGNED` onward), and anyone already offered this job.
3. Rank the survivors: proximity 60%, rating 34%, plus an exploration bonus for
   providers under 20 jobs so the marketplace does not concentrate.
4. Offer to the top *wave* (`DISPATCH_WAVE_SIZE`, default 5; set 1 for a strict
   one-at-a-time ladder). Push to each mechanic's console over SSE.
5. Wait. On accept — assign under a row lock. On decline — escalate now. On
   expiry — the sweeper closes the offers and escalates.
6. Only when nobody is left does the booking become `NO_SUPPLY`, and the
   customer is told *why*: how many nearby were off duty versus on another job.

**Two bugs this audit found and fixed:** the exclusion in step 2 did not exist —
`is_available` is a duty toggle, so a mechanic mid-job kept getting offers; and
there was no decline endpoint and no ladder at all.

### 22. How does offline mode work?

A connectivity manager classifies the network as `ONLINE`, `LIMITED` or
`OFF-GRID` from four inputs: `navigator.onLine`, the Network Information API, a
database-free `/v1/ping` probe with its round-trip time, and the running count
of transport failures. `navigator.onLine` can only make the verdict *worse* —
it reports whether the OS has an interface, so a phone on a cell with no
backhaul says `true`.

Off-grid, the service worker serves the shell, the rules engine diagnoses on the
device, cached tiles render, and writes go to an encrypted IndexedDB journal.

### 23. How does SOS work without internet?

It creates a real incident **on the device** and says exactly that. It mints a
local reference (`RA-K7P2QX`, readable aloud), captures GPS, timestamp, vehicle
and emergency type, and writes the incident and its journal entry in **one**
IndexedDB transaction. Then it says: *"No network connection detected. Your
emergency information is stored securely on this device and will be synchronized
automatically when connectivity returns"* — and, explicitly, *"Nothing has been
transmitted."*

The string "Emergency services contacted" does not exist anywhere in the
codebase. That is deliberate and greppable.

### 24. Can GPS work without internet?

Yes. GPS is a satellite *receiver* — the phone listens; it transmits nothing and
needs no network. The caveat we state in the UI: a cold start without assistance
data can take minutes, and indoors it may never fix. When there is no fix the
app shows `Unknown — denied` or `Unknown — unavailable`, never a fallback
coordinate. A fabricated location in an emergency is worse than none.

### 25. What happens when the network returns?

`Connection restored` → `Synchronizing emergency information…` → the journal
authenticates with the ordinary session, sends, the server validates and checks
idempotency, and only on acknowledgement does the entry leave the journal →
`SOS synchronized. RoadAssist dispatch can now process your incident.` If it
fails: `Sync retry pending`, and the incident stays on the device.

**Syncing records an incident; it does not alert anybody.** Escalation is a
separate explicit call, because an incident that may be three hours old must not
silently SMS a family at 3am.

### 26. How do you prevent duplicate synchronization?

`incidents.client_incident_id` is **UNIQUE**, and the insert is
`onConflictDoNothing`. A retry after a lost response — the normal way retries
duplicate things — collides and the loser reads the winner's row and returns it.
Retries use exponential backoff with **full jitter**, so a convoy leaving a
tunnel does not reconnect in lockstep.

**Tested:** three simultaneous SOS with one reference produce one incident.
Before this audit's fix, two of the three returned **500**.

### 27. How do you secure user data?

Ownership at the resource, not just a role gate. Rotating refresh tokens with
reuse detection that burns the whole family. A hash-chained, append-only audit
log — Postgres rules block UPDATE and DELETE, and `/v1/ops/overview` re-verifies
the chain live. Break-glass medical access requires a role, a *live* incident, a
written reason of 10–300 characters, and writes an audit row. Logs redact
credentials, OTP codes, phone numbers, medical fields and coordinates — tested.

**74 attacks in `security-audit.mjs`, all refused.**

### 28. How do you secure payments?

The amount is never taken from the request — it is the invoice total. Settlement
requires an HMAC-SHA256 signature the server recomputes. Two paths: the browser
callback and the **webhook**, and the webhook is the one that matters because a
customer can pay and close the tab. Delivery is at-least-once, so every path is
idempotent. Production refuses to boot on a real gateway with no webhook secret.

**Tested against a local stub of Razorpay's API:** forged signature, replayed
delivery, wrong amount, wrong order, unconfigured secret — each fails closed.
Never run against a real account.

### 29. Why PostgreSQL/PostGIS?

Dispatch is *"the nearest available mechanic to this point"*. In PostGIS that is
one indexed query with a GiST index and `ST_DWithin` doing true metres-on-a-
sphere; without it, it is fetching every mechanic and computing haversine in
application code. Transactions matter too: `SELECT … FOR UPDATE` is what stops
two mechanics taking one job.

### 30. Why Docker?

Reproducibility and parity. The same image runs on a laptop and a server, and
we verified that literally — the full test suite passes against the container,
which is how we caught a packaging bug (`UPLOAD_DIR` resolving inside the
read-only application directory, EACCES on photo upload).

### 31. What happens if the backend fails?

The client detects it — the probe fails while `navigator.onLine` is still true,
which is `LIMITED`, then `OFF-GRID` after repeated failures. The UI says so
rather than spinning. Local work is preserved in the journal; nothing is
discarded. On recovery the client reconnects and syncs automatically. The
distinction the UI draws — "you have no network" versus "the platform is
unreachable" — is why `/health` and `/v1/ping` are separate endpoints.

### 32. What happens if a mechanic rejects a request?

`POST /v1/offers/:id/decline` closes the offer and escalates the ladder
**immediately**, so a refusal costs the customer a round trip rather than the
full 90-second timeout. Before this audit that endpoint did not exist —
`DECLINED` was in the enum with nothing able to write it.

### 33. What happens if all mechanics are unavailable?

The booking becomes `NO_SUPPLY` — but only after every provider in range has
actually been asked. The customer is told *why*: how many nearby were off duty
versus already on a job, by name of state. "Everyone is busy" and "nobody is
here" are different problems with different answers.

### 34. How does AI diagnosis work?

A deterministic rules engine (ADR-0006): keyword and OBD-II trouble-code
matching over nine fault rules, producing a cause, a confidence, a severity, a
drivability verdict, parts and advice. It is the permanent fallback and the
baseline any future model must beat.

**Be precise in the viva:** this is not machine learning. It is labelled
"rules-1.0.0" in the response and `LOCAL OFFLINE DIAGNOSIS` in the UI when it
runs on the device. There *is* a trained model in the project — YOLO11n on
RDD2022-India for road damage, mAP50 0.443 — and its metrics are real and
measured, not claimed.

A remote model can be configured (`AI_BASE_URL`), and the merge has a **safety
asymmetry**: a model may make a drivability verdict stricter, never laxer.

### 35. What happens when AI is unavailable?

Nothing visible. The rules result is *always* computed; a remote model is
consulted only if configured and its answer used only if it clears
`AI_MIN_CONFIDENCE` and does not contradict the safety asymmetry. Killing the AI
service leaves a working product — that is the whole point of ADR-0006.

### 36. What are the limitations?

Stated plainly, in order of importance:

1. **Nothing is deployed to a cloud.** No account, no domain, no cluster.
2. **Single instance only** — SSE registry, rate limiter and offer sweeper are
   in-process.
3. **112 handoff is a stub**; emergency isolation is a design, not a deployment.
4. **Payments verified against a stub**, never a real Razorpay account.
5. **No backup *schedule*** is configured. The restore procedure itself is rehearsed and measured; what is missing is automation, so the real RPO today is "whenever somebody runs the command".
6. **No load test, no coverage metric, no external penetration test.**
7. **Diagnosis "AI" is a rules engine.**
8. Encryption at rest on the device does not protect against script on the same
   origin, and the UI says so.

### 37. What would you improve in production?

Redis-backed rate limiting and the event bus for SSE fan-out (both already
designed), WAL archiving to get the RPO under a day, object storage for photos,
an external APM, and a `--reference-only` seed so production can be seeded
without demo data — that last one is a real gap flagged in `DEPLOYMENT.md`.

### 38. How would you horizontally scale RoadAssist?

Stateless replicas behind a load balancer — the API already qualifies. Then, in
order: move rate limits to Redis; move SSE fan-out to the outbox → Redpanda path
already in the architecture; run the offer sweeper on exactly one worker;
Postgres read replicas for map and history reads. The reason this order matters
is that replicas *without* those three changes would silently give each instance
its own rate ceiling and its own set of connected clients.

### 39. How would you add database replication?

Streaming replication with a synchronous standby for the emergency tables and
asynchronous replicas for reads. The application change is smaller than it
sounds because reads and writes are already separable — but it is not zero:
read-after-write on a replica would break the tracking screen, so those reads
stay on the primary.

### 40. How would you implement disaster recovery?

`DEPLOYMENT.md` §6 has the full matrix. In summary: nightly `pg_dump -Fc` plus
WAL archiving for point-in-time recovery; restore into a *new* database, never
over a live one; image tags for application rollback in seconds; and every
external integration behind an adapter so a failing vendor is switched off with
an environment variable rather than a deploy. The restore **has** been rehearsed and measured; RPO remains a TARGET because no backup schedule is configured.

---

## Three questions to be ready for

**"Show me the autoscaler."** — There isn't one. The scaling design is on the
slide; what is built is the readiness gate, and I can show you `/health`
returning 503 with the database stopped. *(The presentation script previously
claimed a running autoscaler. It was corrected — see `CLAIMS-AUDIT.md`.)*

**"Is this real AI?"** — The diagnosis engine is deterministic rules, and the UI
labels it as such. The road-damage model is a genuinely trained YOLO11n with
measured metrics. I will not call the first one AI.

**"Did you actually test it, or does it just look right?"** — 626 assertions
across six suites, all executed with no failures, including 74 attacks that must
fail and a concurrency suite that fires ten simultaneous accepts. A seventh
suite of 22 payment-gateway checks needs a Razorpay sandbox account, so it is
not run and I do not count it. Three real
vulnerabilities were found by that suite during this audit and fixed.

---

# Part two — grouped follow-ups (41–56)

The questions an examiner reaches for once the core answers hold up.

## Cloud computing

### 41. Is RoadAssist a cloud application, or a web application you would like to put in the cloud?

**Short.** Today it is a cloud-*ready* application that consumes cloud services;
it is not a cloud-*deployed* one.

**Technical.** The properties that make cloud adoption possible without a
rewrite are built and testable: the API is stateless (session state lives in the
JWT, not in memory), every external dependency sits behind an adapter, writes
carry idempotency keys, and state is server-authoritative. The properties that
require infrastructure — replication, autoscaling, load balancing — are designed
and not provisioned.

**The framing to use.** "We built the application-side preconditions and can
demonstrate every one. We did not provision the infrastructure, and I will not
claim we did." Three things block replication today and each is documented where
it is defined.

### 42. Which parts of this are *actually* cloud, then?

Consumed as SaaS through adapters: SMS, payments, tiles, email — real
integrations with real wire formats, each with a local implementation so the
platform runs on zero paid accounts. Container virtualization is real and
verified. Multitenancy is real and attack-tested. Cloud storage is real in three
forms including the on-device encrypted store. Cloud monitoring is partial —
structured logs with correlation ids and a live operations view, but no external
APM. Everything past that is design.

### 43. What is measured service, and do you have it?

**Short.** Usage metered per consumer so it can be billed or throttled.

**In RoadAssist.** Partially. Rate limiting meters per principal and returns
`x-ratelimit-*` headers; the operations view counts live incidents, provider
states and failed syncs. There is no billing meter and no per-tenant cost
attribution. **Status: PARTIAL.**

## Architecture

### 44. Why a modular monolith rather than microservices?

Four developers. Microservices would have bought distributed transactions, five
deployment pipelines and a network hop between every module, in exchange for
scale we do not have. ADR-0001. The boundaries are real because they are
enforced **mechanically** — `scripts/check-boundaries.mjs` fails the build on a
cross-module import, and it runs in CI. A boundary you cannot enforce is a
boundary you will lose within weeks.

### 45. Why server-sent events instead of WebSockets?

Every flow here is server to client. The client's writes already have a REST
surface carrying authentication, validation, idempotency and audit; duplicating
those over a socket would be a second, weaker way in. SSE is ordinary HTTP, so
it survives the proxies and mobile middleboxes that break upgrades, adds no
dependency and reconnects itself. On a platform whose thesis is bad networks,
"it is just HTTP" is the feature. ADR-0010.

## Database

### 46. What stops the database ending up in an impossible state?

Four things, in order of strength: foreign keys (62), unique constraints — most
importantly `client_incident_id`, which is the whole duplicate-emergency
defence — CHECK constraints (money non-negative, ratings 1 to 5, severity 1 to
5), and guarded UPDATEs that only apply when the row is still in the state the
transition was computed from.

**And it is verified, not assumed.** This audit queried for orphans and
inconsistencies and found a real one: 874 bookings in an accepted state with no
mechanic. Zero were application-created — **the seeder was wrong**, and it was
fixed. A fresh seed now yields zero.

### 47. How do you handle schema migrations safely?

Five versioned migrations, applied by a runner that also creates the extensions
and the constraints drizzle-kit cannot express. All five are **additive** — new
columns and indexes, no drops, no retypes — so an older image runs against a
newer schema, which is what makes an application rollback safe. The rule that
keeps it true: never drop or retype a column in the same release that stops
using it. Add, deploy, stop using, drop later.

## AI

### 48. Your diagnosis runs both on the server and on the phone. How do you know they agree?

Because the build fails if they do not. `apps/api/test/offline-engine.test.ts`
diagnoses a corpus of 27 inputs through **both** implementations and asserts they
match on cause, confidence, severity, drivability, parts and advice. It also
compares the rule tables directly, so a rule present in one and missing from the
other is caught even if the corpus happens not to hit it.

The alternative — a comment saying "keep these in sync" — rots. The app tells
users its offline answer is what the platform would have said; that is only true
while the tables match, so it is enforced rather than hoped for.

## Offline

### 49. What happens if the user closes the app with an unsent SOS in it?

Nothing is lost. The incident and its journal entry are in IndexedDB, written in
one transaction, and they survive the tab closing, the browser closing and a
device restart. On the next launch the app reopens the store, finds the pending
entry and syncs it as soon as connectivity allows. **This is in the demo
script** — closing the tab and reopening it is the strongest single moment.

### 50. What if synchronisation is interrupted halfway?

The journal entry only leaves on a server acknowledgement, so an interrupted
sync leaves it exactly where it was. The next attempt is scheduled with
exponential backoff and **full jitter** — a convoy leaving a tunnel must not
retry in lockstep. If the server did receive it and the response was lost, the
retry collides on the unique `client_incident_id` and converges on the incident
that already exists. Past the automatic retry ceiling the entry stays for a
manual "Sync now"; it is never dropped.

## SOS

### 51. How do you stop a panicking user creating five emergencies by tapping five times?

Three layers, in order of strength. The UI holds a `firing` guard so the hold
gesture, the keyboard path and a second press cannot all raise one. The client
mints a `clientIncidentId` and sends it. The database has a UNIQUE index on that
column and the insert is `onConflictDoNothing`.

Only the third is a guarantee. Tested: three simultaneous SOS with one reference
produce **one** incident — and before this audit's fix, two of the three
returned a **500**, which is the worst possible failure at that moment.

## Dispatch

### 52. What if two customers break down next to each other and there is one mechanic?

The first to have an offer accepted gets them. The second customer's dispatch
excludes that mechanic — provider state is derived from live data, so the moment
the booking is `ASSIGNED` they are `BUSY` and not offerable. If nobody else is in
range the second booking becomes `NO_SUPPLY`, and the customer is told *why*: how
many nearby were off duty versus already on a job. "Everyone is busy" and
"nobody is here" are different problems with different answers.

## Security

### 53. Could a mechanic read a customer's medical details?

Not through any route. Break-glass requires the `admin` or `gov_officer` role, a
**live** incident, and a written reason of 10 to 300 characters, and it writes a
row to the tamper-evident chain that the subject is told about. A mechanic has
none of those roles. The security suite fires this as an attack and it is
refused with 403; an anonymous caller gets 401.

### 54. What is the weakest part of your security?

Three, honestly. Rate limiting is in-process, so behind N instances the effective
ceiling is N times the number — the OTP ceilings are deliberately **not** built
that way, because credential stuffing is the one attack where a per-instance
ceiling is worth nothing. There has been no external penetration test; 74
self-written attacks is not the same thing. And the on-device encryption protects
a storage dump, not script running on the same origin — the UI says exactly that
rather than implying more.

## Payment

### 55. A user says they paid but the booking is unpaid. What do you check?

The webhook, not the browser. Settlement has two paths and the webhook is the
authoritative one, because a customer can pay and immediately close the tab. So:
did Razorpay deliver it, did the signature verify, and did the captured amount
match the invoice total? The amount is never taken from the request — a mismatch
is refused with `409 amount_mismatch`. Every settlement writes an audit row with
the order id and payment reference.

## Real-time

### 56. A customer had the app open, lost signal for ten minutes, and came back. What did they miss?

Possibly several events — delivery is at-most-once and there is no replay
buffer, and that is written down at the definition rather than glossed over.
What they did not miss is any *state*: on reconnect the client refetches the
authoritative booking, and the poll underneath was running the whole time. The
stream is an accelerator; the refetch is what is correct. That is the design
rule, and it is why losing the stream degrades the experience rather than
corrupting it.
