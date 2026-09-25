# RoadAssist Bharat — final verification report

> **Start here.** This is the single entry point for the Phase 13 verification.
> Every technical claim below is traceable to the repository or to a test run
> performed on 2026-09-06 against a database created empty for the purpose.
> Test, route, schema and deployment figures are the current ones, measured
> 2026-09-12 (`app/docs/measured.json`); they supersede the 2026-09-06 counts.

---

## 1. Executive summary

RoadAssist Bharat is an emergency roadside-assistance platform whose defining
property is that its emergency path keeps working when the user's network does
not. It was taken from "release candidate" to "verified" by executing it: a
clean dependency install, an empty database, 751 test assertions across six
suites (measured 2026-09-12, `app/docs/measured.json`), a timed two-window demo
rehearsal, and a full-repository claim audit.

**Result: RELEASE READY for demonstration and submission.** Not production.
The demo is live at <https://app.roadassistbharat.online> — one Render web
service (Singapore, `NODE_ENV=demo`, free plan) with Neon Postgres + PostGIS
(Singapore) — and the showcase is on GitHub Pages at
<https://roadassistbharat.online>. It is a single instance: no cluster, no
autoscaling, no replication, 112 stubbed, mock payments, no real SMS.

Seven defects were found and fixed across Phases 12–13, four of them by tooling
written specifically to attack the project. Two were security issues. Two would
have broken the demo in front of the class.

The administrative gap recorded on 2026-09-06 is closed: the work is committed
on `main` and tagged `v1.0.0-RC1`.

## 2. Product overview

One platform, three surfaces, one API, one database. A driver reports a fault;
a rules engine names a likely cause; a PostGIS query ranks nearby mechanics and
offers the job in waves; the customer watches it happen live; the invoice is
raised on completion and settled server-side. With no network, the emergency
half of that runs on the device instead.

## 3. Actual architecture

Modular monolith — five modules in one deployable, with boundaries enforced by
CI (`scripts/check-boundaries.mjs` fails the build on a cross-module import).
Fastify + zod, Drizzle ORM, PostgreSQL 16 + PostGIS 3.4. Three web surfaces of
plain HTML and ES modules served by the same process — no build step, no second
deployment unit. Real-time is SSE, not WebSocket (ADR-0010). Every external
vendor sits behind an adapter with a local implementation, which is why the
platform runs on zero paid accounts.

**67 routes, 64 under `/v1` (plus `/tiles`, `/basemap`, `/health`). 56 tables,
62 foreign keys, 138 indexes, 5 GiST. 11 ADRs.**

## 4. Customer workflow → `CUSTOMER_FINAL_TEST_REPORT.md`
19 steps, all PASS.

## 5. Mechanic workflow → `MECHANIC_FINAL_TEST_REPORT.md`
16 steps, all PASS, with authorisation and concurrency verified explicitly.

## 6. AI / incident intelligence
A deterministic rule table, returned as `rules-1.0.0` in every response and
labelled on screen. Two things about it are genuinely interesting: a model may
make a verdict **stricter, never laxer**, and a CI test fails the build if the
on-device table diverges from the server's. Separately trained YOLO11
road-damage detectors exist with measured metrics: the best run is YOLO11s
(`yolo11s-multi-rich`, mAP50 0.472 / mAP50-95 0.226, undertrained at epoch 13),
and the YOLO11n India model (mAP50 0.443, `ai/train-full.log`) produced the 34
real detections seeded into RAKSHA at boot in demo mode — the detections are
model output, their NH-48 positions are simulated. The project refuses to call the rules
engine AI.

## 7. Dynamic dispatch
Run-time assignment from a pool of 600 providers, scored on live state, with
timeout-driven re-scheduling. 83.5 ms p50 / 124 ms p95. This is the strongest
Module 4 evidence in the project.

## 8. Offline / off-grid → `OFFLINE_FINAL_TEST_REPORT.md`
16 checks, all PASS, including closing the tab entirely and reopening it.
Contains the **NO NETWORK ≠ NO SAFETY** section that states exactly what works
locally, what is queued, what needs connectivity, and what happens on reconnect.

## 9. SOS → `SOS_FINAL_TEST_REPORT.md`
10 scenarios, all PASS. Persist-before-draw; every ladder rung reported as fact;
112 stubbed and labelled.

## 10. Real-time → `REALTIME_FINAL_TEST_REPORT.md`
SSE, measured at 5.2 ms to first frame. **Two real defects found and fixed
here** — both invisible to the single-tab browser suite.

## 11. Payment → `PAYMENT_FINAL_TEST_REPORT.md`
27 gateway-security checks against a signature-exact stub. A separate 22-check
payment suite (`app/scripts/razorpay-test.mjs`) was not executed and is outside
the 751: it needs no Razorpay account — it starts its own local stub of the
Orders API — but refuses to run unless the API was started separately with
`PAYMENTS_PROVIDER=razorpay` pointed at that stub. No credentials were invented.

## 12. Security → `SECURITY_FINAL_VERIFICATION.md`
101 attacks across two suites (74 security + 27 gateway security), all refused. No independent pentest, and the
project does not pretend otherwise.

## 13. Database → `DATABASE_FINAL_VERIFICATION.md`
56 tables, 62 FKs, 5 check constraints, 84 unique indexes, hash-chained
append-only audit log with Postgres RULES blocking UPDATE/DELETE. Ten
consistency queries all return 0 — one of them returned 1,789 when this phase
started.

## 14–15. Cloud computing and SWE4004 Modules 1–4
→ `SWE4004_IMPLEMENTATION_MAPPING_FINAL.md`, with a "where to show the
professor" pointer for every topic. Eight implemented, five partial, eight
design and not provisioned.

## 16. Testing
751 assertions across six suites, 0 failures — measured 2026-09-12
(`app/docs/measured.json`) against a database migrated from empty and seeded by
`demo:reset`: unit 223 · e2e 189 · concurrency 75 · security 74 · gateway
security 27 · browser 163. The 22 payment checks are not executed and not in
that total. Plus a 15-beat timed demo rehearsal, nine consecutive clean runs.

## 17. Failure handling → `FAILURE_MODE_FINAL_REPORT.md`
13 failure modes, all PASS. The two worth demonstrating live are database-down
and network-down.

## 18. Performance → `PERFORMANCE_FINAL_REPORT.md`
Measured, single-user, local. No operation exceeds 400 ms at p95; error rate 0.
p99, throughput and formal frontend load time are explicitly **not measured**.

## 19. Deployment
**Live demo deployment.** <https://app.roadassistbharat.online> is one Render
web service (Docker, free plan, Singapore) running the API and every web
surface in one process, with `NODE_ENV=demo`, `PAYMENTS_PROVIDER=mock` and no
real SMS. Database: Neon Postgres + PostGIS, Singapore. Showcase: GitHub Pages
at <https://roadassistbharat.online>. Singapore because the free tiers offer no
India region; an India region (e.g. Mumbai) is the production target. The
config guard is verified to refuse eight unsafe settings under
`NODE_ENV=production`. Not done: cluster, autoscaling, replication, load
balancing.

## 20. Limitations
Single instance · 112 stubbed · payments mock on the deployment, stub-only in
tests · no real SMS · free plan sleeps after 15 min idle · no backup schedule ·
rules engine not a model · five dev-only advisories · no pentest.

## 21. Future scope
Redis-backed rate limiting, outbox → event bus for SSE fan-out, WAL archiving.
Those three stand between this and a second instance.

## 22. Business potential
Stated as potential, not current, on slide 29. No commercial operation exists.

## 23. Demo plan → `FINAL_10_MINUTE_DEMO_SCRIPT.md` and `DEMO_FAILURE_BACKUP_PLAN.md`
Timing measured. Every beat has a backup, and no backup fakes a result.

## 24. Viva defence → `ROADASSIST_FINAL_VIVA.md`
35 questions, answered from the repository.

## 25. Final release status

**RELEASE READY** for demo, viva and submission — committed on `main`, tagged
`v1.0.0-RC1`, and running as a single-instance demo deployment rather than a
production service.
