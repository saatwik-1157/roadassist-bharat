# Testing

Six suites, 626 assertions, all executed against a real PostgreSQL + PostGIS and a
real Chrome, with no failures. A seventh — 22 payment-gateway checks — runs only
against a Razorpay sandbox account and refuses to run without one. Nothing here is mocked except the third-party vendors, and each
of those has a stub that speaks the vendor's actual wire format.

## Running everything

```bash
# once
docker compose up -d && npm ci && npm run db:migrate && npm run db:seed && npm run db:seed:raksha

npm run verify            # typecheck · lint · boundaries · claims · citations · unit tests
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
| `npm test` (node:test) | **108** | Pure logic with no I/O: the diagnosis rules, the booking, incident and provider state machines, connectivity classification, backoff, integrity digests, log redaction, and the **device/cloud divergence guard** that fails the build if the on-device rule table drifts from the server's. |
| `scripts/e2e-journey.mjs` | **189** | The whole API journey against real Postgres — auth, refresh rotation and theft detection, vehicles, diagnosis, dispatch, payment, reviews, tenant isolation, the emergency path, the SMS feature-phone journey, off-grid sync and conflict resolution. |
| `scripts/concurrency-test.mjs` | **65** | What a sequential suite structurally cannot: `Promise.all` on two accepts, ten simultaneous accepts, three SOS taps at once, concurrent syncs, concurrent transitions, live SSE delivery, per-user stream isolation, the dispatch ladder, and provider busy-exclusion. |
| `scripts/gateway-security-test.mjs` | **27** | Webhook signatures, the append-only audit rules, OTP ceilings per number and per IP. |
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

- **Android TESTS are the SOS ladder and nothing else.** `SosLadderTest` is 18
  tests over the decisions in `SosLadder.kt` — which rung fires, whether a backup
  is queued, and the SMS body's contract with the server. The Compose UI, the API
  client and the local queue are still untested: they need a device or
  Robolectric, and neither is wired up. (Localisation is a separate axis and is
  complete — see below.)
- **No CV inference or training runs in CI.** The `ai` job checks the pipeline
  logic and that every script parses; loading a model and running a frame stays
  a local, GPU-shaped activity. A syntax error in `train.py` used to surface
  only when someone started a multi-hour run — that part is now caught.

## Fitness functions — the rules that fail the build

Four, all in the `boundaries` CI job, all added because a rule nobody can
enforce is a suggestion.

| Check | Guards against |
|---|---|
| `check-boundaries.mjs` rules 1–2 | A schema module importing what ADR-0002 forbids, or anything reaching past the `@roadassist/db` index |
| `check-boundaries.mjs` rule 3 | **A cached page loading a script that is not itself cached.** Off-Grid Mode fails in the quietest possible way — the page boots, one file is missing, the feature is gone. It caught `i18n.js`: `app.html` loaded it, `SHELL_ASSETS` did not list it, and every off-grid user silently fell back to English |
| `check-claims.mjs` | A number in the documents disagreeing with `docs/measured.json`. The same figure went stale in twenty-odd files three separate times before this existed. It gates the total, each individual suite, and the `npm run … # N` comments the command lists are written as — the per-suite numbers were ungated at first and drifted while the total beside them stayed right |
| `check-citations.mjs` | A `file.ts:123` in the documents that no longer points at code. The viva packs tell the reader to *open* the file, so a rotted line number is found in front of an examiner — lifting the auth and emergency routes out of `server.ts` shifted ten citations and pushed two past the end of the file |

Every one of them was mutation-tested — the rule was broken on purpose and the
build failed — because a check that has never failed has not been shown to work.
For `check-claims.mjs` that meant faking a suite size in `measured.json` and
confirming it fails on both the prose and the `npm run … # N` forms; for
`check-citations.mjs`, nudging one citation past the end of its file and another
onto a blank line.

---


## Localisation, and exactly how far it goes

**All eight languages the roadmap names now ship**: English, Hindi, Tamil,
Telugu, Bengali, Marathi, Kannada and Gujarati. `LOCALES` in
`apps/api/src/i18n.ts` remains the whole truth about which ones exist, and
`values-*/` under `mobile/app/src/main/res` is its Android counterpart.

### The caveat that belongs in the same breath

> **These translations have not been reviewed by native speakers.** English and
> the technical content are sound; the other seven are careful but unreviewed,
> and register and idiom are where that shows. Saying "eight languages" without
> saying this would be precisely the sort of claim
> [CLAIMS-AUDIT.md](CLAIMS-AUDIT.md) exists to catch — the strings exist, the
> quality is unverified, and those are different statements.
>
> What that buys is still real: a reviewer now corrects rather than translates,
> which is a much smaller job. `docs/raksha/` is the model — one reviewer per
> language, working from a diff.

What is covered was chosen the way the rest of this product is: the messages
that reach the people with the worst connections and the cheapest phones, first.

| Surface | Covered | Not covered |
|---|---|---|
| API (SMS + OTP) | **Everything the platform sends**, in all 8 — OTP, every `/v1/telecom/sms` reply, the emergency-contact alert | — |
| Android | **The whole UI**, in all 8 — 63 strings per locale, zero hardcoded literals left in `MainActivity.kt` | Toast text assembled from server responses, which arrives already localised |
| Web citizen app | SOS control, connectivity tiers, sign-in, primary nav, booking verbs — 30 keys, in all 8 | Long explanatory prose; `I18N.coverage()` reports the real numbers |
| Mechanic / authority consoles | Nothing | Both are operator tools used by staff |

That is **126 server strings, 441 Android strings and 210 web strings** for the
seven non-English locales.

A feature phone has no settings screen, so **`LANG <code>` over SMS** is the
switch — `LANG TA`, `LANG BN`, and each language's own name is accepted too
(`LANG தமிழ்`, `LANG বাংলা`). The confirmation comes back in the NEW language,
which is the only proof a reader who cannot check a menu will get.

The stored preference lives in `users.preferred_language`, a column the schema
always had and nothing ever read: the seeder picked from these same eight codes
while every message went out in English. Every one of them now resolves to
itself, and a test asserts exactly that.

On the web the control **cycles** rather than toggles — with eight languages a
two-way switch cannot reach six of them — and its label is always the next
language's own name in its own script, because the person who wants it is the
one who cannot read the current one.

Android needs no control at all: it picks `values-ta`, `values-bn` and the rest
from the device locale, which the owner already set once.

**Every script here except English is outside GSM 03.38** — Devanagari, Tamil,
Telugu, Bengali, Kannada and Gujarati alike — so all seven non-English locales
are UCS-2 at 70 characters a segment. The copy was written to that ceiling
rather than translated and then trimmed, and `i18n.test.ts` holds all eight
languages to the same per-key budget.

**Android translation completeness is enforced by the build.** Every UI string
lives in `values/strings.xml`, and Android lint's `MissingTranslation` is an
error — verified by deleting one Hindi string, which failed the build. So a new
string cannot ship English-only without someone noticing, which is the failure
mode every half-finished localisation dies of. `app_name` is marked
`translatable="false"`: it is the brand, and it is what a user looks for on a
home screen.

**The trap is encoding, and it is tested.** Devanagari is outside GSM 03.38, so a
Hindi SMS is UCS-2 and one segment holds 70 characters, not 160. `i18n.test.ts`
holds every catalogue entry to a segment budget; two messages are allowed two
segments and are named there, because one carries a 60-character URL and the
others interpolate a mechanic's full name. Everything else is one segment, which
is why the Hindi is written for SMS rather than translated from the English.

---

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

`.github/workflows/ci.yml` runs all of it on every push, in five jobs:

| Job | What it does |
|---|---|
| `verify` | install, typecheck, lint, unit tests, secret scan, dependency audit |
| `integration` | a full PostGIS container — migrate, seed, every integration suite, the second short-TTL pass, the security audit, the database-loss chaos step and the backup/restore rehearsal |
| `boundaries` | four fitness functions: module boundaries, the offline-shell completeness check, the documented-claims check and the code-citation check |
| `android` | lint, 18 unit tests, debug APK and the R8-minified release APK, on a pinned JDK 21 |
| `ai` | syntax-checks every CV script and runs the pipeline unit tests |

`android` and `ai` were added because `mobile/` and `ai/` ship as real artefacts
and previously had **no automated check at all** — a broken Gradle build or a
lint regression was found only by building by hand. The first `android` run
caught one: `SEND_SMS` was declared without a telephony `<uses-feature
android:required="false">`, so Google Play would have treated a radio as
mandatory and hidden the app from every tablet — the opposite of what this
product claims.

The `ai` job deliberately does **not** install `ultralytics`. Pulling torch costs
minutes and hundreds of megabytes per push and proves nothing about a commit;
the logic worth protecting — the RDD2022 class mapping and the severity
heuristic that reaches `raksha_detections` — is pure Python and runs in 0.02s.
Twelve tests, `python -m unittest discover -s ai/tests`.
