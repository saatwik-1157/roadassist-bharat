# RoadAssist — Application

> AI-powered · cloud-connected · **network-resilient** roadside assistance for India.
> *"RoadAssist doesn't stop when the network stops."*
> SWE4004 Cloud Computing and Applications · Review 1

**Current status: the Review 2 vertical slice runs end to end.** One complete
journey — sign in, add a vehicle, diagnose, dispatch, track, complete, pay, plus
offline replay and the emergency path — against real PostgreSQL + PostGIS.

```bash
npm run infra:up && npm run db:migrate && npm run db:seed   # once (Docker Desktop running)
npm run db:seed:raksha                                      # demo admin + NH-48 corridor
npm start                                                   # → http://localhost:4000
npm run share                                               # → public HTTPS url, for real phones
npm run verify && npm run test:e2e                          # 61 unit + 189 end-to-end
npm run test:gateway                                        # 26 gateway-security checks
npm run test:concurrency                                    # 65 race / idempotency / real-time
npm run test:security                                       # 74 attacks, all must be refused
npm run test:ui                                             # 163 browser-journey checks
npm run test:razorpay                                       # 22 payment-gateway checks
```

> `db:seed` is not idempotent — against an already-seeded database run
> `npm run db:reset && npm run db:migrate` first.

`test:ui` drives real Chrome over the DevTools protocol — no headless-browser
dependency is added — and covers what only a client can prove: that the app boots
without a console error, that a session survives a reload, that an offline payment
is refused rather than queued, that the mechanic's actions reach the customer's
screen without a refresh, and that nothing overflows between 320px and 768px. It
also drives the whole Off-Grid Mode scenario below, end to end. Run it with
`--headed` to watch it happen.

### Putting it on a phone

`npm run share` opens a Cloudflare quick tunnel (no account, no cost) and prints a
public HTTPS URL. HTTPS is not cosmetic here — a phone browser withholds
geolocation, service-worker registration and "Add to home screen" over plain
HTTP, so a phone hitting `http://<lan-ip>:4000` gets an app that cannot find you,
cannot work offline and cannot install.

Set `TRUST_PROXY=true` when running behind any tunnel, load balancer or CDN.
Without it every visitor arrives as the proxy's own address and the per-IP OTP
ceiling becomes one bucket the whole room shares. It is off by default on
purpose: trusting `X-Forwarded-For` when nothing upstream rewrites it lets a
client forge the header and skip the ceiling entirely.

> **The dev OTP is returned in the response** (`EXPOSE_DEV_OTP=true`), so anyone
> with the URL can sign in as any number. That is what makes the demo one tap;
> it also means the link should go to people you chose, not a public post. For a
> shared-passcode demo instead, set `EXPOSE_DEV_OTP=false` and `DEV_OTP=<six
> digits>` and tell your testers the code.

### Payments — Razorpay

`PAYMENTS_PROVIDER=mock` is the default and settles locally with no gateway and
no money. Switching to Razorpay needs four values in `.env`, all from your own
Razorpay dashboard:

```
PAYMENTS_PROVIDER=razorpay
PAYMENTS_KEY_ID=rzp_live_xxx        # Settings -> API Keys
PAYMENTS_KEY_SECRET=xxx             # shown once, at key generation
PAYMENTS_WEBHOOK_SECRET=xxx         # Settings -> Webhooks (a DIFFERENT secret)
```

Then add a webhook in the dashboard pointing at
`https://<your-host>/v1/webhooks/razorpay` subscribed to **`payment.captured`**.

Two settlement paths exist on purpose:

1. **Browser callback** — after checkout, the client posts the gateway's signed
   payload to `POST /v1/payments/:id/confirm`. The server re-computes
   `HMAC-SHA256(order_id|payment_id)` and settles only if it matches.
2. **Webhook** — `POST /v1/webhooks/razorpay`, authenticated by
   `x-razorpay-signature` over the raw body. This is the path that matters: a
   customer can pay and immediately close the tab, and the money has still
   moved. Razorpay retries until it gets a 2xx, and every path here is
   idempotent because delivery is at-least-once.

The amount is never taken from the request — it is the invoice total, and the
webhook additionally refuses a captured amount that does not match it. The key
*secret* never reaches a client; only the key id does.

Production refuses to boot on a real gateway with no webhook secret, because
settlement would then depend entirely on the payer's browser surviving.

`npm run test:razorpay` proves all of the above against a local stub of the
Orders API — no account, no money. Start the API with:

```
PAYMENTS_PROVIDER=razorpay PAYMENTS_KEY_ID=rzp_test_stub PAYMENTS_KEY_SECRET=stub_secret PAYMENTS_WEBHOOK_SECRET=stub_webhook_secret PAYMENTS_BASE_URL=http://localhost:4599 npm start
```

Surfaces once running: `/` demo client · `/app.html` citizen app ·
`/mechanic.html` mechanic console ·
`/raksha.html` authority dashboard (sign in `+919999900001`, dev OTP `000000`) ·
`/showcase.html` live 3D showcase. CI runs all of the above plus the full e2e
against a fresh PostGIS container on every push.

---

## Scope

| Phase | Deliverable | Status |
|---|---|---|
| 0 · Research | Problem validation, integration feasibility, constraints | ✅ [`../docs/`](../docs/) |
| 1 · Planning | Backlog, repo scaffold, CI pipeline, quality gates | ✅ |
| 2 · Architecture | C4 diagrams, 10 ADRs, event catalogue, API style guide, failure matrix, threat model | ✅ [`docs/`](docs/) |
| 3 · Database | 57 tables migrated, ~38k seeded rows, GiST + partial indexes | ✅ |
| 4 · Auth | OTP → JWT, rotating refresh with reuse detection, RBAC + device identity (ADR-0008) | ✅ |
| 5 · APIs | Booking state machine, PostGIS dispatch, diagnosis, sync, SOS, gateway-verified payments | ◐ slice complete, full surface pending |
| 6 · Frontend | Demo client at `/`, citizen app at `/app.html`, RAKSHA map at `/raksha.html` | ◐ web only; no React Native app |
| 7 · AI | Rules engine + trained CV model: YOLO11n on RDD2022-India full set (5.4 MB, mAP50 0.443, see ai/) | ◐ baseline model live; GPU training is the path up |
| R · RAKSHA | Edge simulator → offline queue → idempotent sync → segments → road health → authority verify/close | ◐ MVP slice live, detector SIMULATED (ADR-0007) |
| O · Off-Grid | Connectivity manager (ONLINE/LIMITED/OFF-GRID), offline SOS, on-device diagnosis, encrypted sync journal, cached maps | ✅ (ADR-0009); satellite/mesh explicitly NOT implemented |
| H · Hardening | Live SSE stream, row-locked dispatch, offer expiry, SOS idempotency, sync conflict resolution, rate limits, audit coverage | ✅ (ADR-0010); single-instance only |
| 8+ | SMS/IVR gateway, government portal, analytics, real CV model | ⏸ not started |

### Off-Grid Mode — RoadAssist Rescue Link ([ADR-0009](docs/adr/0009-offgrid-mode.md))

> *"RoadAssist doesn't stop when the network stops."*

The platform keeps working when **the user's** connection fails, which is the
failure that actually happens on a rural highway. Three tiers, an on-device
engine and a store-and-forward journal built for emergencies specifically.

| | State | What the app does |
|---|---|---|
| 🟢 | `ONLINE` | Everything |
| 🟠 | `LIMITED` | Requests still attempted; whatever fails is stored, not lost |
| 🔴 | `OFF-GRID` | Local emergency mode — see below |

**Connectivity is measured, not assumed.** `navigator.onLine` reports whether the
OS has a network *interface*, so a phone camped on a cell with no backhaul says
`true`. The connectivity manager combines it with the Network Information API, a
database-free `GET /v1/ping` probe (success + RTT) and the running count of
transport failures — and `navigator.onLine` can only ever make the verdict
*worse*, never better.

**An off-grid SOS is created, stored, and *said* to be stored.** It mints a local
reference (`RA-K7P2QX`, short enough to read aloud over a borrowed phone),
captures the GPS fix — a satellite receiver needs no internet — the timestamp,
vehicle and emergency type, and writes the incident and its journal entry to
IndexedDB in one transaction. Then it says, in these words:

> **OFF-GRID SOS CREATED.** No network connection detected. Your emergency
> information is stored securely on this device and will be synchronized
> automatically when connectivity returns.

It never claims transmission, states that nobody has been alerted, and recommends
calling 112 — voice often works on a signal too weak for data.

**Sync is store-and-forward and genuinely idempotent.**

```
OFFLINE JOURNAL → AUTHENTICATE → SEND → SERVER VALIDATION →
IDEMPOTENCY CHECK → DATABASE UPDATE → MARK SYNCHRONIZED
```

`incidents.client_incident_id` is UNIQUE, so a retry after a lost response — the
normal way retries duplicate things — collides and creates nothing. Retries use
exponential backoff with **full jitter**, so a convoy leaving a tunnel does not
stampede the platform. Syncing **records** the incident; escalation stays an
explicit `POST /v1/sos/:id/confirm` step, because an incident that may be hours
old must not silently SMS a family at 3am on reconnect (ADR-0005).

**Diagnosis runs on the device.** `apps/web/offline-engine.js` mirrors the
server's rule table, and `apps/api/test/offline-engine.test.ts` diagnoses a
corpus through *both* and fails the build on any divergence. The local answer is
always labelled **LOCAL OFFLINE DIAGNOSIS** with its engine version, lists the
runners-up (offline there is no second opinion to ask for) and leads with a
recommended safety action.

**Local data.** AES-GCM-256 under a non-extractable device key held in IndexedDB
— which protects a copy of the storage taken off the device, and *not* code
running on this origin; the UI says exactly that. Where WebCrypto is unavailable
the store falls back to plaintext and says so on screen. No token, no payment
credential, no server secret is ever stored. A synchronised incident is deleted
after 24 hours; an unsynchronised one is never deleted, at any age.

| Endpoint | What |
|---|---|
| `GET /v1/ping` | Database-free connectivity probe. `/health` still hits the DB, so "no network" and "sick platform" stay distinguishable |
| `POST /v1/sos/offline-sync` | Batch intake for device-stored incidents. Authenticated, re-validated as hostile input, idempotent on `clientIncidentId`, audited, and it alerts nobody |

**Try it:** open `/app.html`, tap the connectivity pill to simulate off-grid,
hold SOS. `npm run test:ui` drives the same scenario end to end — online →
network lost → SOS → local reference → GPS → local diagnosis → network restored
→ automatic sync → incident in the database → replay produces no duplicate.

**Implemented:** offline detection, local storage, offline incident creation,
store-and-forward sync, local diagnosis, cached maps and last-known service
positions. **Future, and labelled as such everywhere in the product:** satellite
communication, mesh networking, government emergency-network integration,
multi-network routing, on-device ML beyond the rules engine.

### Real-time operations & concurrency safety ([ADR-0010](docs/adr/0010-realtime-and-concurrency.md))

**Two mechanics can no longer both accept the same job.** Acceptance used to
read the offer status *outside* its transaction, so two requests arriving
together both passed the check and both wrote `bookings.mechanic_id` — both
mechanics told they had the job. The decision now happens under
`SELECT … FOR UPDATE` on the **booking** row, so every accept for a job queues
on one row whichever of its offers it names. Offer expiry is enforced there too:
hiding an expired offer from the inbox was never a rule, and a replayed request
could take a job twenty minutes late.

`scripts/concurrency-test.mjs` proves it with `Promise.all` — ten simultaneous
accepts, exactly one winner, every loser a 409 and never a 500. Nothing
sequential can make that check.

**Live updates, over SSE.** One long-lived `GET /v1/events` per client carries
every change that concerns them: a booking status, a dispatch offer, an SOS
escalation. Read with `fetch` + a stream reader rather than `EventSource`, so
the access token stays in a header instead of the query string. Persist first,
publish second — always. Measured delivery in the browser suite: **65 ms**,
against a 6-second poll.

Polling is not removed. It drops to a background heartbeat while the stream is
alive (60 s for the customer, 45 s for the mechanic) and returns to its old
cadence when it is not, because the stream is at-most-once and in-process — an
accelerator, never the source of truth.

| | Before | After |
|---|---|---|
| Two mechanics accept at once | both succeed | one wins, other gets `409 already_assigned` |
| Expired offer accepted | honoured | `409 offer_expired` |
| Three SOS taps at once | **500** on two of them | one incident, replays answered `200` |
| Customer sees an assignment | up to 6 s | 65 ms |
| Mechanic sees an offer | up to 8 s | immediately |
| Stale device status on reconnect | journalled blindly | `conflict`, `server_wins`, authoritative value returned |

**Rate limits shaped around the emergency path.** Per-principal windows on
booking, payment, sync, offer-accept and stream opening. The SOS ceiling sits
far above any human rate, a double tap is absorbed by *idempotency* rather than
throttling (`POST /v1/sos` accepts a `clientIncidentId`), and
`POST /v1/sos/:id/confirm` — the call that summons help — is never limited at
all. State is in-process, so behind N instances the ceiling is N×; that is
written at the definition and in the failure matrix, not glossed over.

**Every failure has an answer.** [`docs/architecture/failure-matrix.md`](docs/architecture/failure-matrix.md)
lists twenty failure modes with how each is detected, what the user sees, what
happens to their data, how it recovers, and **which suite proves it** — plus a
short list of what is genuinely not covered.

### RAKSHA — autonomous road monitoring (MVP slice)

Every RAKSHA event on this build is **SIMULATED** — the detector is a labeled
deterministic generator (`sim-rules-0.1.0`), not a trained model.

```bash
npm run db:seed:raksha                  # demo admin (+919999900001) + NH-48 segments
node scripts/raksha-simulator.mjs       # offline patrol → sync → replay (idempotent) → road health
# dashboard: http://localhost:4000/raksha.html  ·  citizen app: /app.html
```

**Citizen input + live map** — the network also takes crowdsourced input and
renders live geospatial state:

| Endpoint | Who | What |
|---|---|---|
| `POST /v1/raksha/report` | any signed-in citizen | flag a hazard (type, severity, GPS, note, optional photo). Rate-limited per user; enters the same pipeline as a device sighting, tagged `source:"citizen"`, never auto-raising an incident (ADR-0005). |
| `GET /v1/me/reports` | reporter | own reports + live verification status |
| `GET /v1/raksha/detections/:id/photo` | reporter **or** authority | the report photo (stored on disk per ADR-0006, only a ref in the DB) |
| `GET /v1/raksha/detections?source=citizen` | authority | triage the crowdsourced queue |
| `GET /v1/map/live?lat&lng&radiusKm` | any signed-in user | nearby mechanics, responders and detections for the map |
| `GET /tiles/...` · `/basemap/...` | — | cached, keyless OpenStreetMap tile proxies (whole-India basemap) |

The map (`/map.html`, embedded in the Android app) bundles Leaflet +
markercluster locally (`app/apps/web/vendor/`) rather than a CDN — and so are
the two typefaces (`vendor/fonts/`, SIL OFL). No third-party dependency at
runtime, on any page.

### Closing the loops

Four subsystems the schema had always described but no endpoint reached. Each
one closes a loop that was left open rather than adding a new idea:

| | What was open | Endpoints |
|---|---|---|
| **Reviews** | The dispatch ranker weights a mechanic's `rating` at 34% of their score — and nothing in the platform ever wrote that column. | `POST /v1/bookings/:id/review` · `GET /v1/mechanics/:id/reviews` |
| **Medical profile** | The emergency path could reach a responder but not tell them the victim's blood group. | `GET`/`PUT /v1/me/medical` · `GET /v1/me/medical/access-log` |
| **Break-glass** | `break_glass_access` existed as a table and as an intention. | `GET /v1/incidents/:id/medical?reason=…` |
| **Vehicle documents** | An expired PUC is a fine at the next checkpoint; the dates lived nowhere. | `POST /v1/vehicles/:id/documents` · `GET /v1/me/documents` |
| **Audit trail** | `audit_log` carried `prev_hash`/`hash` columns nothing populated. | `GET /v1/admin/audit` |

**Ratings are shrunk, not averaged.** A raw mean is unusable at low volume: the
first 2★ would move a mechanic from 4.6 to 2.0 and effectively remove them from
dispatch. Each mechanic starts with five imaginary reviews at the platform mean
and real ones dilute that prior, so one harsh rating lands at 3.8 rather than
2.0 while fifty ratings govern almost completely. Pinned in
[`apps/api/test/rating.test.ts`](apps/api/test/rating.test.ts).

**Break-glass is designed around the fact that consent is impossible mid-crash.**
The answer is not to refuse the read but to make it impossible to hide: authority
role only, only while the incident is live, a written reason that is stored
verbatim, a row in `break_glass_access`, an entry in the audit chain, and an SMS
telling the subject it happened. The subject can read the whole access log.

**The audit log is tamper-evident in two independent layers.** The migration
installs `DO INSTEAD NOTHING` rules, so an `UPDATE` or `DELETE` against
`audit_log` silently changes nothing — not even for the application. `INSERT` is
the one mutation an append-only log must allow, so that is the gap the hash
chain covers: every entry hashes its content together with its predecessor's
hash, and `GET /v1/admin/audit` re-verifies the whole chain on every read. The
gateway suite proves both layers, including that a forged entry spliced past the
rules is caught as a broken link.

### Payments

`PAID` is a fact about money, not a state a client may assert. The booking
state machine still records the transition, but it no longer *creates* the
settlement it records:

| Endpoint | What |
|---|---|
| `POST /v1/bookings/:id/pay` | Settle a COMPLETED booking's invoice. The amount is the invoice total, never a number from the request. Returns `200` + `PAID` when the provider settles synchronously; `202` + a checkout handle when a real gateway needs a client step. |
| `POST /v1/payments/:id/confirm` | Verify what the gateway handed back and settle. A signature that does not verify returns `402` and leaves the invoice unpaid. |
| `POST /v1/bookings/:id/transition` `{command:"payment.settled"}` | Still the recorded transition, but now `409 payment_required` unless settled payments already cover the invoice. |

`PAYMENTS_PROVIDER=mock` (the default) settles locally with no gateway and no
money — and `assertProductionSafe` refuses to boot a production server that is
still on it. `razorpay` is a verified adapter: Orders API over HTTP Basic, and
checkout verified as `HMAC-SHA256(order_id|payment_id)` keyed with the secret.
Cash never reaches a gateway and only the assigned mechanic or an admin may
record it — the person holding the money is the one who gets to say it arrived.
The gateway suite proves all of this against a stub vendor endpoint.

**Measured, not asserted** (single-user, local database — run `npm run perf`):
the dispatch candidate query executes in **29 ms**, the whole dispatch endpoint
in **113 ms** p50 (PostGIS KNN, provider-state exclusions, offer inserts, SSE
fan-out and audit writes) · emergency escalation **37 ms** median, measured end
to end through the API · **189** end-to-end assertions covering illegal transitions,
idempotent replay, refresh-token theft detection, cross-tenant isolation, the
full citizen-report loop (submit → photo → authority verify → status), and
settlement that no client can assert for itself.

---

## Layout

```
app/
├── docs/
│   ├── adr/                  10 architecture decision records
│   ├── architecture/         C4 diagrams · events · degraded modes · failure matrix · API style guide
│   └── security/             STRIDE threat model, 20 threats mapped to controls
├── apps/
│   ├── api/                  Fastify server; `test/` holds the unit suites
│   │   ├── realtime.ts         SSE fan-out — persist first, publish second
│   │   └── ratelimit.ts        per-principal windows, shaped around the SOS path
│   └── web/                  Served at the API root
│       ├── offline-engine.js   pure on-device engine: rules, tiers, ids, backoff
│       ├── offline-store.js    IndexedDB incidents + encrypted sync journal
│       ├── connectivity.js     ONLINE · LIMITED · OFF-GRID manager
│       └── sw.js               service worker (app shell + map tiles)
├── packages/
│   └── db/                   Drizzle schema (6 modules, 57 tables)
├── scripts/
│   └── check-boundaries.mjs  Architecture fitness function (ADR-0002)
├── .github/workflows/ci.yml  lint · typecheck · test · secret scan · boundaries
└── docker-compose.yml        PostGIS · Redis · Redpanda
```

---

## Quick start

```bash
npm install
npm run typecheck                    # schema compiles
node scripts/check-boundaries.mjs    # module boundaries hold
```

When you reach Phase 3, bring up the local cloud stand-in and apply the schema:

```bash
npm run infra:up
npm run db:generate && npm run db:migrate && npm run db:seed
```

> Requires Docker Desktop running. Postgres is published on **5434** so it does not
> collide with other local projects already using 5432 and 5433.

---

## Architecture in one paragraph

One modular-monolith deployable with five enforced modules, plus **one exception**:
the emergency service is deployed separately with its own quota and a degraded SMS
path that shares no runtime dependency with the platform — so an SOS survives a full
platform outage ([ADR-0005](docs/adr/0005-emergency-isolation.md)). All AI ships
rules-first behind a stable contract, so killing the AI service leaves a working
product ([ADR-0006](docs/adr/0006-ai-rules-first.md)). Offline conflict rules were
decided before any sync code was written, and booking state is always
server-authoritative ([ADR-0004](docs/adr/0004-offline-conflict-rules.md)). And
because the connection that fails on a highway is the *user's*, not ours, the
client carries its own tier logic, emergency store and rules engine, so an SOS
with no signal becomes a real stored incident rather than an error message
([ADR-0009](docs/adr/0009-offgrid-mode.md)).

Start with [`docs/architecture/README.md`](docs/architecture/README.md).

---

## Team

| | Owner | Area |
|---|---|---|
| P1 | V Saatwik Sairaam (24MIC7131) | Backend, database, API contracts |
| P2 | P Sai Nirisha Chowdary (24MIC7122) | Frontend, mobile, offline client |
| P3 | T V S Jignesh (24MIC7190) | AI services, data pipeline |
| P4 | G Parthavi (24MIC145) | DevOps, QA, security, CI/CD |
