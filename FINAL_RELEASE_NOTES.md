# RoadAssist Bharat — v1.0.0-RC1 final release notes

**Frozen 2026-09-06.** Engineering is closed; only verified blockers were fixed
in this phase.

> **Provenance, stated exactly.** This release is the *working tree* on top of
> commit `f771df5` — 41 modified and 59 untracked files, **none committed**, and
> no tag exists. `f771df5` contains none of this work. Everything below was
> executed in that state.

## Version

| | |
|---|---|
| Version | `1.0.0-rc.1` |
| Base commit | `f771df5` (`main`) |
| Recommended tag | `v1.0.0-RC1` — **not created** |
| Node / npm | v24.18.0 / 11.16.0 |
| Database | PostgreSQL 16.4 + PostGIS 3.4, 5 migrations, 57 tables |

## Verified features

Each was executed in this phase, not inferred.

- **Customer journey** — OTP sign-in, vehicle, location, rules diagnosis,
  dispatch, acceptance, live tracking, invoice, payment, review, history.
- **Mechanic journey** — console sign-in, live job arrival, accept, four state
  transitions, completion, history.
- **Dispatch** — PostGIS nearest-neighbour with off-duty and busy exclusion,
  ranked waves with a TTL that escalates. 83.5 ms p50.
- **Real-time** — SSE, persist-first/publish-second, with polling underneath.
  Customer follows a mechanic's action in 0.8–1.4 s.
- **Off-Grid Mode** — connectivity classification, on-device diagnosis,
  encrypted local SOS with its own reference, survives a full tab close and
  reopen, syncs idempotently on reconnect.
- **SOS** — escalation ladder reporting each rung as fact; 112 handoff stubbed
  and labelled.
- **Concurrency** — ten simultaneous accepts produce exactly one winner.
- **Security** — 100 attacks across two suites, all refused.
- **Payments** — server-side amount authority, signature verification, webhook
  handling, duplicate protection — against a signature-exact stub.

## Test results

| Suite | Assertions | Result |
|---|---|---|
| Unit | 61 | 61 passed, 0 failed |
| End-to-end | 189 | 189 passed, 0 failed |
| Gateway security | 26 | 26 passed, 0 failed |
| Concurrency / real-time | 65 | 65 passed, 0 failed |
| Security attacks | 74 | 74 passed, 0 failed |
| Browser journey | 163 | 163 passed, 0 failed |
| **Total executed** | **578** | **578 passed, 0 failed** |
| Demo rehearsal | 15 beats | all completed, 9 consecutive clean runs |
| Payment sandbox | 22 | **not run** — needs a Razorpay account |

Static gates: typecheck, lint, module boundaries, production build — all clean.

## Major fixes in Phases 12–13

0. **Android SOS reported a hard-coded position** (HIGH, emergency path) —
   `lastKnownLocation()` only read a cache another app has to fill, and the
   app never requested a fix, so `gps provider` sat at `ProviderRequest[OFF]`
   and every SOS fell back to the demo coordinates. Now actively requests a
   fix (GPS, then network, then the cache), bounded at 8s.
1. **`trustProxy` hop counts refused** (HIGH, security) — fastify ≤5.12.0
   believed `X-Forwarded-For` by counting hops without checking the sender,
   defeating the per-IP OTP ceiling.
2. **fastify 5.11.2 → 5.12.3, fast-uri 3.1.5 → 3.1.7** — six advisories.
   Runtime dependencies now report **0 vulnerabilities**.
3. **Dropped real-time events** (HIGH) — a poll requested while one was in
   flight was discarded, so the customer's screen could sit at IN_PROGRESS for
   60 s after the job finished.
4. **Command chips lost on the live path** (HIGH) — the Pay button never
   appeared after a live completion.
5. **Production database guard** (MEDIUM) — asked "is `DATABASE_URL` set?",
   which a shipped `.env` satisfied while pointing at localhost.
6. **Seed data contradicted the platform's own rule** (MEDIUM) — 1,789
   bookings marked PAID with no invoice and no payment.
7. **Unsupportable test claim** — "600 assertions, seven suites, all passing"
   corrected to 578 across six, in six documents and the deck.
8. **Demo script** — runtime corrected to 10 minutes; the off-grid beat was
   unperformable after the SOS beat.

## Documentation

24 verification documents at the repository root, 12 living documents in
`app/docs/`, 10 ADRs, a 32-slide deck and its PDF.
`ROADASSIST_FINAL_VERIFICATION_REPORT.md` is the entry point.

## Deployment status

**Not deployed, and not claimed to be.** A production image builds and the full
suite passes against it; `assertProductionSafe` refuses to boot on eight unsafe
settings. No cloud account exists.

## Known limitations

Single instance (in-process SSE registry, rate limiter, offer sweeper) · 112 is
a stub · payments proven only against a stub · no backup schedule · the
roadside diagnosis engine is deterministic rules, labelled `rules-1.0.0` · five
dev-only dependency advisories accepted during freeze · no independent
penetration test.

## Demo readiness

**Ready.** Timing measured, not estimated: eleven action beats consume 10–20
seconds of machine time against an 8:05 budget. Nine consecutive clean runs of
`npm run test:demo`. Every beat has a backup, and no backup fakes a result.
