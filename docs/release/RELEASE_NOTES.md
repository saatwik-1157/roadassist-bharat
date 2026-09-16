# RoadAssist Bharat — v1.0.0-RC1

**Release candidate.** Frozen 2026-09-06.

> **Provenance, stated exactly.** This candidate is the *working tree* on top
> of commit `f771df5` — 41 modified and 59 untracked files that are not in any
> commit. Everything tested below was tested in that state. It is not yet a
> taggable revision, and calling `f771df5` the release would be wrong: that
> commit contains none of this phase's fixes.

Everything below was executed against a database created empty for this
release, on the machine named in [Build identification](#build-identification).
Nothing here is inferred from a previous run, and nothing is claimed that a
suite does not prove.

---

## Build identification

| | |
|---|---|
| Version | `1.0.0-rc.1` (`app/package.json`) |
| Base commit | `f771df58dac21c6f6341a5ff336ed31a7a0f18dc` (plus uncommitted work — see above) |
| Build date | 2026-09-06T14:30:57Z |
| Node / npm | v24.18.0 / 11.16.0 |
| PostgreSQL | 16.4 + PostGIS 3.4 (`USE_GEOS=1 USE_PROJ=1 USE_STATS=1`) |
| Migrations | 5 applied, latest `0004_offgrid_incident` |
| Schema | 56 tables |
| Android | `in.roadassist.app` 0.1.0, minSdk 26, targetSdk 35 |

---

## What is in this release

### Off-Grid Mode

The feature the project is named for. With no network the app still
classifies connectivity from measured evidence (ONLINE / LIMITED / OFF-GRID),
runs the same diagnosis rule table the server runs, renders cached map tiles,
and creates a real SOS incident on the device — with its own reference, GPS
fix and encrypted IndexedDB record.

It says plainly that **nothing has been transmitted**, and recommends calling
112, because voice often works on a signal too weak for data. On reconnect the
incident forwards itself, and a unique client key makes a duplicate impossible.

### Real-time and dispatch

Server-sent events, persisted first and published second, with polling
continuing underneath so the stream is an accelerator and never the truth.
Dispatch is a PostGIS nearest-neighbour search that excludes off-duty and
already-committed providers and offers in timed waves that escalate on their
own.

### Assignment safety

One job is assigned exactly once, settled under `SELECT … FOR UPDATE` on the
booking row with the expiry checked inside the transaction. Ten simultaneous
accepts produce one winner and nine clean refusals.

---

## Fixed in this candidate

| Fix | Why it mattered |
|---|---|
| **The customer's screen no longer sticks on a stale state** | Every live booking event calls `pollBooking()`, which returned early if a poll was already running — so a mechanic tapping through four states in a few seconds had the last event silently dropped. With the stream alive the fallback tick is 60 s, so the screen could show IN_PROGRESS for a minute after the job finished, and the **Pay button never appeared**. Requests made mid-flight are now honoured. |
| **Command chips restored on the live path** | The permitted commands arrive in `meta.nextCommands`. `refreshBooking()` carried them across; `pollBooking()` did not, so every live redraw rendered an empty command list. Both paths now agree. |
| **`trustProxy` hop counts rejected** | Fastify ≤5.12.0 decided how much of `X-Forwarded-For` to believe by counting hops, without checking who sent it — so a client reaching the port directly could pad the header and land on any address, walking through the per-IP OTP ceiling. Hop counts are now refused at startup with a message naming the replacement. |
| **fastify 5.11.2 → 5.12.3** | Closes GHSA-3m5p-2c4r-xxw2 (the above) and GHSA-w2qp-rph6-63g4 (schema validation bypass via root primitive coercion). |
| **`fast-uri` 3.1.5 → 3.1.7** | Four transitive advisories: SSRF via malformed IPv6 normalisation and via repeated hostname percent-decoding, plus two host-confusion paths. |

Runtime dependencies now report **0 vulnerabilities**.

---

## Testing

Every suite below was run against the database created empty for this release,
after `npm ci` from the lockfile. Counts are what the runners printed.

| Suite | Command | Assertions | Result |
|---|---|---|---|
| Unit | `npm test` | 61 | 61 passed, 0 failed |
| End-to-end | `npm run test:e2e` | 189 | 189 passed, 0 failed |
| Gateway security | `npm run test:gateway` | 26 | 26 passed, 0 failed |
| Concurrency / real-time | `npm run test:concurrency` | 65 | 65 passed, 0 failed |
| Security attacks | `npm run test:security` | 74 | 74 passed, 0 failed |
| Browser journey (real Chrome) | `npm run test:ui` | 163 | 163 passed, 0 failed |
| Demo rehearsal (two live windows) | `npm run test:demo` | 15 beats | 15 completed, 0 failed |
| **Total executed** | | **578** | **578 passed, 0 failed** |
| Payment gateway (live sandbox) | `npm run test:razorpay` | 22 | **not run** — needs your Razorpay sandbox account |

`test:razorpay` exercises Razorpay's real sandbox and refuses to run without
credentials rather than inventing them. The same settlement path — order,
checkout handle, signature verification, webhook, duplicate webhook, forged
signature — is covered by `test:gateway` against a signature-exact stub, which
is why payment is not an untested area.

Static gates: `typecheck` clean, `lint` 0 problems, module boundaries clean,
production build clean.

Chaos: with PostgreSQL stopped, `/health` returns **503** (`database: down`,
no credentials in the body) while `/v1/ping` still returns **200**; restarting
PostgreSQL returns `/health` to 200 on its own, with no API restart.

---

## Known limitations

These are real and stated deliberately. None is hidden behind a diagram.

1. **Nothing is deployed to a cloud provider.** A production container image is
   built and the whole suite passes against it, but no hosting account exists.
   The eight `DESIGN`-marked cloud concepts in `docs/SWE4004-MAPPING.md` are
   designed and not provisioned.
2. **Single instance.** The SSE registry, the rate limiter and the offer
   sweeper are in-process, so replicas would each keep their own rate ceiling
   and their own set of connected clients. The fix for each is documented at
   its definition.
3. **112 is a stub.** The ERSS handoff logs and returns a note saying so. The
   app never claims emergency services were contacted.
4. **Payments are sandbox-only.** Settlement is proven against a
   signature-exact stub gateway, not against Razorpay's servers — that needs an
   account (see below).
5. **No backup *schedule*.** The restore procedure is rehearsed and measured
   (dump 1.2 s, restore 7.2 s, audit chain intact across 639 entries); what is
   missing is automation, so today's real RPO is "whenever somebody runs it".
6. **The AI is a deterministic rules engine**, labelled `rules-1.0.0` in every
   response. A trained YOLO11n detector exists for road damage with measured
   metrics; the roadside diagnosis path is rules, and says so.
7. **Dev-only dependency advisories remain**: `@faker-js/faker` (seeding) and
   `esbuild` via `drizzle-kit` (migration generation). Both need breaking major
   upgrades and neither ships in the runtime image, so they were not forced
   during a release freeze.

---

## External services still required

Nothing below is stubbed, guessed or faked. Each genuinely needs an account,
and the platform runs end to end without any of them.

| What | Needed for | Variables |
|---|---|---|
| A host (Fly / Render / Railway / VM) | Any deployment at all | — |
| Domain + DNS | HTTPS — Off-Grid Mode needs it for service workers and geolocation | `CORS_ORIGINS` |
| PostgreSQL **with PostGIS** | Dispatch is a geospatial query | `DATABASE_URL` |
| Twilio or MSG91 (MSG91 needs a TRAI DLT template) | OTP sign-in, emergency SMS | `SMS_*`, `TELECOM_WEBHOOK_SECRET` |
| Razorpay **test** keys | Running `npm run test:razorpay` against the real sandbox | `PAYMENTS_*` |
| *(optional)* Hosted model endpoint | Better than the rules engine | `AI_*` |
| *(optional)* Transactional email | Authority notifications | `EMAIL_*` |

**Maps need no account** — keyless OpenStreetMap tiles, Leaflet bundled locally.

---

## Demo environment

Seeded by `npm run db:seed` + `npm run db:seed:raksha`. All data is generated;
none of it is real customer information.

| Role | Sign in with | What it opens |
|---|---|---|
| Customer | `+917000000000` | `/app.html` — two vehicles already linked (`KA05MZ4321` car, `AP16TJ1000` EV) |
| Authority / admin | `+919999900001` | `/raksha.html` — the RAKSHA dashboard and the NH-48 corridor |
| Mechanic | `+919600000461` | `/mechanic.html` — the mechanic console |

In development the OTP is `000000` and the API returns it in the response, so
no SMS account is needed to demonstrate sign-in.

**Resetting the demo** — one command, and it refuses to run against anything
that is not a local database (`packages/db/src/reset.ts` checks the host before
dropping anything):

```bash
npm run demo:reset      # db:reset → db:migrate → db:seed → db:seed:raksha
```

---

## Upgrading from an earlier checkout

```bash
cd app
npm ci                      # fastify 5.12.3 + fast-uri 3.1.7
npm run db:migrate          # no new migrations in this candidate
```

If your `.env` sets `TRUST_PROXY` to a number, change it before starting — the
server now refuses to boot and tells you what to use instead:

```bash
TRUST_PROXY="127.0.0.1,::1"     # behind a local tunnel
TRUST_PROXY="10.0.0.0/8"        # behind a cloud load balancer
```
