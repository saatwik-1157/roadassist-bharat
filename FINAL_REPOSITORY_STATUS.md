> Generated 2026-09-06 by executing the release candidate, not by reading it.
> Base commit `f771df5` on `main`, plus 41 modified and 59 untracked files that
> are **not yet committed**. Every number below came from a run on that state.
> Where something was not measured, this file says so instead of estimating.

# Final repository status

## Structure

```
roadassist-bharat/
├── app/                        the platform
│   ├── apps/api/src/           Fastify API — 16 files, 6,261 lines TypeScript
│   ├── apps/web/               6 HTML surfaces + offline engine/store/connectivity
│   ├── packages/db/            Drizzle schema, migrations, seeders — 13 files, 1,564 lines
│   ├── scripts/                12 .mjs — tests, capture, perf, boundaries, share
│   ├── docs/                   12 markdown + 10 ADRs + 15 screenshots
│   ├── Dockerfile              4-stage, non-root uid 1000, tini PID 1, HEALTHCHECK
│   ├── docker-compose.yml      dev: postgis, redis, redpanda
│   └── docker-compose.prod.yml prod: no published database port
├── mobile/                     Kotlin + Compose Android client
├── ppt/                        generated 32-slide deck + PDF
├── ai/                         road-damage detector training
└── docs/                       programme-level roadmaps (planning, not claims)
```

## Version

| | |
|---|---|
| Version | `1.0.0-rc.1` (`app/package.json`) |
| Branch | `main` |
| Base commit | `f771df5` |
| Working tree | **41 modified, 59 untracked — uncommitted** |
| Node / npm | v24.18.0 / 11.16.0 |

**This is the single most important caveat in this document.** The release
candidate exists only as a working tree. `f771df5` contains none of the Phase 12
or 13 fixes. Nothing is committed and no tag exists.

## Build status — PASS

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | 0 errors (after deleting `.tsbuildinfo`; the incremental cache has hidden real errors twice) |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Module boundaries | `npm run boundaries` | clean — a cross-module import fails the build |
| Production build | `npm run build` | clean |
| Android release | `./gradlew :app:assembleRelease` | BUILD SUCCESSFUL, 1.1 MB APK (R8 + resource shrinking) |

## Test status — PASS

| Suite | Assertions | Result |
|---|---|---|
| Unit (`npm test`) | 61 | 61 passed, 0 failed |
| End-to-end (`test:e2e`) | 189 | 189 passed, 0 failed |
| Gateway security (`test:gateway`) | 26 | 26 passed, 0 failed |
| Concurrency / real-time (`test:concurrency`) | 65 | 65 passed, 0 failed |
| Security attacks (`test:security`) | 74 | 74 passed, 0 failed |
| Browser journey (`test:ui`) | 163 | 163 passed, 0 failed |
| **Executed total** | **578** | **578 passed, 0 failed** |
| Demo rehearsal (`test:demo`) | 15 beats | all 15 completed |
| Payment sandbox (`test:razorpay`) | 22 | **not run** — needs a Razorpay account |

## Database status — PASS

57 tables · 62 foreign keys · 57 primary keys · 433 check constraints ·
138 indexes (5 GiST for PostGIS) · 84 unique indexes · 5 migrations applied ·
2 append-only rules on `audit_log`.

Current seeded volume: 6,038 bookings, 4,628 users, 600 mechanics,
4,081 invoices, 1,794 payments. Ten consistency queries all return 0.

## Deployment status — PARTIAL, and this is deliberate

- A production image builds and the full suite passes against it.
- `assertProductionSafe` refuses to boot on eight distinct unsafe settings.
- **No cloud account exists and nothing is deployed.** Eight of 21 cloud
  concepts remain `DESIGN`.

## Known warnings

| Warning | Assessment |
|---|---|
| `npm audit`: 5 dev-only advisories (`@faker-js/faker`, `esbuild` via `drizzle-kit`) | Accepted. Both need breaking majors; neither ships in the runtime image. Runtime dependencies report **0 vulnerabilities**. |
| 3 packages have uncovered install scripts (esbuild) | Standard npm 11 notice, not a defect. |
| `docs/01-master-roadmap.md`, `docs/05-devops-qa-lead-roadmap.md` carry 99.9%/99.99% SLO tables | **Planning targets, not measurements.** They predate the build. A reader who mistakes them for claims would be misled — flagged in `FINAL_MARKS_LOSS_AUDIT.md`. |

## Known blockers

**None for demo.** The blockers for *production* are unchanged and all require
your accounts, not more engineering: no host, no domain, no SMS provider, no
payment gateway.

## Known limitations

Single instance (SSE registry, rate limiter and offer sweeper are in-process);
112 is a stub; payments proven only against a signature-exact stub; no backup
*schedule*; the roadside diagnosis engine is deterministic rules, labelled
`rules-1.0.0` in every response.
