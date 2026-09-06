> Generated 2026-09-06 by executing the release candidate, not by reading it.
> Base commit `f771df5` on `main`, plus 41 modified and 59 untracked files that
> are **not yet committed**. Every number below came from a run on that state.
> Where something was not measured, this file says so instead of estimating.

# Performance final report

Measured by `npm run perf` against the running API and the seeded database.

**Read this first.** These are single-user latencies on one developer machine
with a local database. This is **not** a load test, there is no concurrency,
and no throughput figure is claimed. Anyone presenting these as capacity
numbers would be wrong.

## Measured latency — 30 samples per operation

| Operation | p50 | p95 | max | n | failures |
|---|---|---|---|---|---|
| `GET /v1/ping` (no database at all) | 14.7 ms | 16.2 ms | 16.3 ms | 30 | 0 |
| `GET /health` (one round trip to Postgres) | 14.9 ms | 16.9 ms | 17.7 ms | 30 | 0 |
| `POST /v1/diagnose` (rules engine) | 15.6 ms | 34.0 ms | 40.2 ms | 30 | 0 |
| `GET /v1/bookings/:id` (booking + events + mechanic + provider state) | 30.6 ms | 37.3 ms | 40.6 ms | 30 | 0 |
| `GET /v1/bookings` (the caller's list) | 15.5 ms | 20.5 ms | 29.0 ms | 30 | 0 |
| `GET /v1/map/live` (3 PostGIS radius queries) | 17.0 ms | 38.1 ms | 62.9 ms | 30 | 0 |
| `GET /v1/service-types` (small reference read) | 15.3 ms | 16.7 ms | 17.8 ms | 30 | 0 |
| `POST /v1/bookings/:id/dispatch` (PostGIS KNN + exclusions) | 83.5 ms | 124.2 ms | 124.2 ms | 8 | 0 |
| `POST /v1/sos/offline-sync` (validate + insert + signal + journal + audit) | 54.9 ms | 65.4 ms | 65.4 ms | 15 | 0 |
| `GET /v1/events` (SSE connect → first frame) | 5.2 ms | 10.0 ms | 10.0 ms | 10 | 0 |

No operation exceeds 400 ms at p95. Error rate across every operation: **0**.

Database latency, reported by `/health`: **2 ms**.

## p99

**Not measured.** 30 samples cannot support a p99; quoting one would be
arithmetic dressed up as evidence. The p95 column is the strongest tail figure
this sample size honestly supports.

## Throughput

**Not measured.** No load generator was run, and the user's standing
instruction not to perform destructive load tests was followed.

## Frontend load time

**Not measured as a formal metric.** What *was* measured, in real Chrome:
the demo rehearsal's eleven action beats complete in **10–20 seconds of machine
time** against an 8:05 budget, and the customer's tracking screen reaches
COMPLETED **0.8–1.4 s** after the mechanic's final tap.

Android cold start, `am start -W`, 6 runs each: release build **~1.66 s**
steady state versus **~2.4 s** debug. Frame-rate on the emulator was **not**
reliably measurable — three identical runs gave 25%, 36% and 58% janky frames
with `90th gpu percentile: 4950 ms`, which is the emulator's GPU stalling, not
the app.
