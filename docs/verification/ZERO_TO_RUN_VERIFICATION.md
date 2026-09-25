> Generated 2026-09-06 by executing the release candidate, not by reading it.
> Base commit `f771df5` on `main`, plus 41 modified and 59 untracked files that
> are **not yet committed**. Every number below came from a run on that state.
> Where something was not measured, this file says so instead of estimating.

# Zero-to-run verification

Executed as written, from a deleted `node_modules` and a database created empty.
Every command below was run; none is transcribed from memory.

## Prerequisites

| | Version used | Required |
|---|---|---|
| Node.js | v24.18.0 | ≥ 20 |
| npm | 11.16.0 | ≥ 10 |
| Docker Desktop | running | for PostgreSQL + PostGIS |
| Chrome | installed | only for `test:ui` / `test:demo` |
| PostGIS | 3.4 (via image) | **required** — dispatch is a geospatial query |

## The whole sequence

```bash
cd app
npm run infra:up          # docker compose up -d  (postgis, redis, redpanda)
npm ci                    # clean install from the lockfile
npm run db:migrate        # → "migrations complete — 56 application tables in public schema"
npm run db:seed           # → "seeded in ~50s", ~37,000 rows
npm run db:seed:raksha    # → demo admin + NH-48 corridor
npm start                 # → http://localhost:4000
```

Open <http://localhost:4000/app.html> and sign in as `+917000000000`. In
development the OTP is `000000` and the API returns it in the response, so no
SMS account is needed. (The hosted demo at <https://app.roadassistbharat.online>
needs none of this; this file is about running it yourself.)

### Environment configuration

**No `.env` is required to run.** Every setting has a development default and
the platform runs end to end on local implementations — that is what makes the
offline demo possible. Copy `app/.env.example` to `app/.env` only when you want
to change something.

## The one instruction that is easy to miss

`npm run db:seed:raksha` is **not optional**. It creates the admin role.

I skipped it on my first pass through this sequence and two suites failed —
`test:e2e` at *"demo admin signs in with an authority role"* and `test:gateway`
at the audit-chain check — because no account had the `admin` role. Both
failures were opaque: neither says "you forgot a seed step".

It **is** documented at `app/README.md:13`. The instruction was correct; the
failure mode was not obvious. Rather than only re-document it, the four steps
are now chained:

```bash
npm run demo:reset        # db:reset → db:migrate → db:seed → db:seed:raksha
```

`db:reset` refuses to run against any host that is not local, and masks the
password if it declines.

## Tests

```bash
npm run verify            # typecheck · lint · boundaries · 223 unit tests
npm start                 # in another shell — the suites below need it running
npm run test:e2e          # 189
npm run test:gateway      # 27
npm run test:concurrency  # 75
npm run test:security     # 74
npm run test:ui           # 163  (drives real Chrome; --headed to watch)
npm run test:demo         # 15 demo beats, two browser windows, timed
npm run perf              # measured latency, not a load test
```

The per-suite counts are the current ones — 751 across the six suites,
measured 2026-09-12 (`app/docs/measured.json`). The 22-check payment suite
(`npm run test:razorpay`) is not in that total and was not executed: it needs
no Razorpay account, but refuses to run unless the API was started separately
with `PAYMENTS_PROVIDER=razorpay` pointed at its local stub.

### Expected output

```
✓ migrations complete — 56 application tables in public schema
  4076 invoices · 1789 settled payments
✓ seeded in 54.6s
✓ RAKSHA seed complete — demo admin ready, 4 segment(s) created
{"msg":"RoadAssist API ready","providers":{"sms":"console","maps":"local",
 "ai":"rules","payments":"mock","email":"console"}}
```

`/health` returns 200 with `{"status":"ok","database":"ok"}`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `db:seed` fails on duplicate keys | It is not idempotent | `npm run demo:reset` |
| Two suites fail on "authority role" | `db:seed:raksha` not run | `npm run demo:reset` |
| `/health` returns 503 | Database unreachable | `npm run infra:up`; `/v1/ping` still returns 200 |
| Server refuses to boot naming 6–8 settings | `NODE_ENV=production` with development config | Intended. Read the list; it names each fix |
| `TRUST_PROXY=2` refuses to boot | Hop counts removed as a CVE | Use the proxy's address: `TRUST_PROXY="127.0.0.1,::1"` |
| Port 4000 in use | An earlier API is still running | Windows: `Get-NetTCPConnection -LocalPort 4000` then `Stop-Process` |
| Android Gradle fails with a bare `25.0.1` | Java 25 is not supported by Gradle 8.13 | `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"` (JDK 21) |

> **The last row's fix went stale on 2026-09-14**, after this file was written.
> Android Studio updated itself and left `Android Studio/jbr` a stub with no
> `lib/jvm.cfg`, so that `JAVA_HOME` now fails with `could not open ...jvm.cfg`
> rather than building; the JBR that replaced it is 25.0.3, which Gradle 8.13
> rejects for the very reason the Cause column gives. The symptom and the cause
> are unchanged — point at any JDK 21 instead. Left as written, because it was
> correct for the build this file records.

## Demo reset

```bash
npm run demo:reset
```

Drops the schema and the migration journal, re-migrates, re-seeds, and recreates
the demo admin. It refuses any non-local database. Verified: guard fires on a
remote host, and the full sequence completes in ~60 s with all suites passing
afterwards.
