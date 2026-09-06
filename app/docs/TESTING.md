# Testing

Six suites, 578 assertions, all executed against a real PostgreSQL + PostGIS and a
real Chrome, with no failures. A seventh — 22 payment-gateway checks — runs only
against a Razorpay sandbox account and refuses to run without one. Nothing here is mocked except the third-party vendors, and each
of those has a stub that speaks the vendor's actual wire format.

## Running everything

```bash
# once
docker compose up -d && npm ci && npm run db:migrate && npm run db:seed && npm run db:seed:raksha

npm run verify            # typecheck · lint · module boundaries · unit tests
npm start                 # in another shell
npm run test:e2e          # API journey
npm run test:concurrency  # races, idempotency, real-time
npm run test:gateway      # gateway security
npm run test:ui           # browser journey (drives real Chrome; --headed to watch)
npm run test:demo         # timed rehearsal of the demo, two windows at once
```

`npm run test:razorpay` needs the API started with the sandbox variables printed
in the header of `scripts/razorpay-test.mjs`.

### Why `test:demo` exists as well as `test:ui`

`test:ui` drives one browser tab. That is enough for almost everything, and it
is precisely why it could not see the worst bug found in the release candidate:
a customer screen and a mechanic console have to be **open at the same time**
for the real-time path to be exercised the way a demo exercises it. `test:ui`
reaches the payment screen by loading it, which goes through `refreshBooking()`;
the live path goes through `pollBooking()`, and that is where the defect was.

`test:demo` opens two tabs, walks `DEMO-SCRIPT.md` beat by beat, asserts the
expected outcome of each, and times it. It fails if any beat fails.

## The suites, and what only each of them can prove

| Suite | Assertions | What it exists for |
|---|---|---|
| `npm test` (node:test) | **61** | Pure logic with no I/O: the diagnosis rules, the booking, incident and provider state machines, connectivity classification, backoff, integrity digests, log redaction, and the **device/cloud divergence guard** that fails the build if the on-device rule table drifts from the server's. |
| `scripts/e2e-journey.mjs` | **189** | The whole API journey against real Postgres — auth, refresh rotation and theft detection, vehicles, diagnosis, dispatch, payment, reviews, tenant isolation, the emergency path, the SMS feature-phone journey, off-grid sync and conflict resolution. |
| `scripts/concurrency-test.mjs` | **65** | What a sequential suite structurally cannot: `Promise.all` on two accepts, ten simultaneous accepts, three SOS taps at once, concurrent syncs, concurrent transitions, live SSE delivery, per-user stream isolation, the dispatch ladder, and provider busy-exclusion. |
| `scripts/gateway-security-test.mjs` | **26** | Webhook signatures, the append-only audit rules, OTP ceilings per number and per IP. |
| `scripts/razorpay-test.mjs` | **22** | Payment negative space: forged signature, replayed delivery, wrong amount, wrong order, unconfigured secret — each must fail closed. |
| `scripts/security-audit.mjs` | **74** | Application-level penetration checks — every case is an attack that must FAIL: cross-tenant reads and writes, role escalation, id manipulation, SQL injection, forged and `alg:none` tokens, unsigned webhooks, oversized input, error-body leakage, rate limits. Three real vulnerabilities were found by this suite and fixed. |
| `scripts/ui-journey.mjs` | **163** | What only a browser can prove: the app boots without a console error, a session survives a reload, an offline payment is refused rather than queued, live updates arrive without polling, and the complete Off-Grid Mode scenario end to end. |

## Verified against the production image, not just the source

Every integration suite has been run against the container built by
`app/Dockerfile`, not only against `tsx` on the source tree:

```
E2E vs container image          189 passed, 0 failed
Concurrency vs container image   64 passed, 0 failed
Gateway vs container image       26 passed, 0 failed
Browser vs container image      163 passed, 0 failed
```

This is the check that caught a real packaging bug: `UPLOAD_DIR` defaulted to a
path inside the read-only application directory, so photo upload failed with
EACCES in the container while passing on the host.

## The suites are self-cleaning, on purpose

Dispatch (correctly) refuses to offer work to a provider already committed to a
customer. A suite that leaves bookings in `ASSIGNED` therefore removes providers
from the pool permanently — repeated runs drained the seeded pool until dispatch
had nobody left and the race tests had nothing to race.

`concurrency-test.mjs` releases each provider as soon as the section that
borrowed them is finished, sweeps up at the end, and — via
`unhandledRejection` / `uncaughtException` handlers — releases them even when
the run dies. Without that last part, one failed run poisoned every run after it.

## What is deliberately not covered

Stated here rather than discovered later.

- **Coverage is measured for the pure domain modules only.** `node --test
  --experimental-test-coverage` reports **95.68% lines / 95.88% branches** across
  the files the unit suite targets — the diagnosis rules, the booking, incident
  and provider state machines, the error vocabulary and log redaction
  (`provider-state.ts` and `errors.ts` are at 100%). The HTTP layer shows near-zero
  because the integration suites run **out of process** against a live server, so
  the instrumentation cannot see them. The honest summary: the logic is
  measured, the transport is tested but unmeasured.
- **No load test.** Latency is measured (`npm run perf`) but only single-user,
  against a local database, on one machine.
- **No multi-instance test.** The SSE registry and rate limiter are in-process;
  the limitation is documented rather than exercised.
- **No real SMS, payment or 112 handoff.** All three are adapter-gated and run
  against local implementations or local stubs.
- **Offer expiry needs a short TTL.** The branch is unreachable in under 90
  seconds otherwise, so CI runs the concurrency suite a second time against an
  API booted with `OFFER_TTL_SECONDS=2`.

## Chaos and recovery, automated

Two steps that used to be prose are now CI steps:

- **Database loss and recovery** — stops Postgres under a running API, asserts
  `/health` returns **503** with `database: "down"` while `/v1/ping` still
  returns 200, asserts an API call fails with a safe 500 rather than crashing,
  then restarts Postgres and asserts the API recovers **with no restart of its
  own**.
- **Backup and restore rehearsal** — `pg_dump -Fc` into a fresh database, then
  asserts the audit row count matches and the append-only rules survived.
  Matching row counts prove the rows arrived; the chain re-hash proves they
  arrived unaltered.

Measured locally during the Phase 9 remediation: dump 1.2 s / 750 KB, restore
7.2 s, audit hash chain intact across all 639 entries.

## Performance

`npm run perf` measures p50/p95/max per endpoint. Single-user, local database —
**not** a load test, and it says so on every run. Current figures: ping 14 ms ·
health 15 ms · diagnose 16 ms · booking detail 31 ms · map 16 ms · **dispatch
113 ms (the heaviest path)** · off-grid sync 51 ms · SSE first frame 6 ms.

## CI

`.github/workflows/ci.yml` runs all of it on every push: install, typecheck,
lint, unit tests, secret scan, dependency audit, then a full PostGIS container
with migrate, seed, and every integration suite — including the second
short-TTL pass, the security audit, the database-loss chaos step and the
backup/restore rehearsal — plus the module-boundary fitness function.
