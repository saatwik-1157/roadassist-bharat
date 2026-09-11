> Executed 2026-09-06 as the final gate. Caches deleted first, database dropped
> and rebuilt, every suite run. Commands and output are transcribed, not summarised.

# Final build verification

## 1. Clean build

```bash
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
rm -rf apps/api/dist packages/db/dist
```

Deleting `.tsbuildinfo` matters: the incremental cache has twice hidden real
compile errors in this project, so a "clean" build that reuses it proves nothing.

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run boundaries` | **PASS** — `✓ module boundaries clean` |
| `npm run build` | **PASS** — both workspaces compiled |

Dependencies: installed earlier this phase with `npm ci` from the lockfile.
`npm audit --omit=dev` → **0 vulnerabilities** in runtime dependencies. Five
dev-only advisories (`@faker-js/faker`, `esbuild` via `drizzle-kit`) are
accepted during freeze — both need breaking majors and neither ships in the
runtime image.

**Frontend build:** there is none. The three surfaces are plain HTML and ES
modules served by the API process — no bundler, no build step, no second
deployment unit.

## 2. Clean database

```bash
npm run demo:reset     # db:reset → db:migrate → db:seed → db:seed:raksha
```

```
✓ schema and migration journal reset
✓ migrations complete — 56 application tables in public schema
  4076 invoices · 1789 settled payments
✓ seeded in 65.7s
✓ RAKSHA seed complete — demo admin ready, 4 segment(s) created
```

## 3. Application startup

```bash
npm start
```

```
{"msg":"Server listening at http://127.0.0.1:4000"}
{"msg":"RoadAssist API ready","providers":{"sms":"console","maps":"local",
 "ai":"rules","payments":"mock","email":"console"}}
```

Zero error-level log lines at startup. `/health` → 200 with `database: ok`,
`dbLatencyMs: 2`.

## 4. Tests

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | **PASS** — 61 pass, 0 fail |
| End-to-end | `npm run test:e2e` | **PASS** — 189 passed, 0 failed |
| Gateway security | `npm run test:gateway` | **PASS** — 26 passed, 0 failed |
| Security attacks | `npm run test:security` | **PASS** — 74 passed, 0 failed |
| Concurrency / real-time | `npm run test:concurrency` | **PASS** — 65 passed, 0 failed |
| Browser journey | `npm run test:ui` | **PASS** — 163 passed, 0 failed |
| **Total executed** | | **578 passed, 0 failed** |
| Demo rehearsal | `npm run test:demo` | **PASS** — all 15 beats |
| Payment sandbox | `npm run test:razorpay` | **NOT RUN** — needs a Razorpay account |

## One reporting correction

My own summary script printed `unit FAIL`. That was a shell bug — the pattern
`^. fail 0` could not match the multibyte `ℹ` that Node's test runner prefixes
its summary with. The log itself reads `ℹ pass 61 / ℹ fail 0`. The tests passed;
my grep did not. Recorded because a wrong FAIL in a verification report is worse
than no report.
