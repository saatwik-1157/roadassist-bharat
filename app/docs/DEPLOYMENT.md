# Deployment

**Status of this document:** every command below has been executed against the
repository at the commit it ships with, except where a section is explicitly
labelled **NOT VERIFIED** — which means it needs an account or a credential
this project does not have.

---

## Honest summary first

| | Status |
|---|---|
| Production Docker image builds | ✅ **Verified** — `docker build`, 321 MB, runs as `node` (uid 1000) |
| Image runs and serves the whole platform | ✅ **Verified** — API, citizen app, mechanic console, authority dashboard, media |
| Full test suite passes **against the image** | ✅ **Verified** — 189 e2e + 75 concurrency + 27 gateway + 163 browser |
| Health check reports the database honestly | ✅ **Verified** — 503 with `database: "down"` when Postgres is unreachable |
| Graceful shutdown | ✅ **Verified** — SIGTERM → exit code 0, no force kill |
| Production CORS allowlist | ✅ **Verified** — allowed origin reflected, other origins refused |
| Startup configuration validation | ✅ **Verified** — refuses to boot and names the variable |
| Reference-only production seed | ✅ **Verified** — 0 demo rows, API boots and signs in against it |
| Backup and restore | ✅ **Scheduled, verified and measured** — nightly `backup` sidecar that restores each dump before trusting it; rehearsal 8.4 s, audit hash chain intact across 639 entries |
| **Deployed to a cloud provider** | ❌ **NOT DONE.** No cloud account or credentials are configured in this repository. See [What I need from you](#what-i-need-from-you). |
| **HTTPS / custom domain** | ❌ **NOT VERIFIED.** Configuration is written and reasoned below; it has never terminated a real certificate. |
| **Live payment** | ❌ **Deliberately not enabled.** Sandbox verified (22 assertions). Production keys must be a conscious act. |

Nothing in this document claims a deployment that did not happen.

---

## 1. Architecture

One image, one process, one database. That is the whole system.

```
                    ┌──────────────────────────────┐
   Browser / PWA ──▶│  Reverse proxy (TLS, HTTP/2) │
   Android WebView  │  Caddy or nginx              │
                    └───────────────┬──────────────┘
                                    │ 127.0.0.1:4000
                    ┌───────────────▼──────────────┐
                    │  roadassist:<tag>            │
                    │  ├─ Fastify API   /v1/*      │
                    │  ├─ SSE stream    /v1/events │
                    │  ├─ Static web    /*.html    │
                    │  ├─ Media proxy   /media/*   │
                    │  ├─ Tile proxy    /tiles/*   │
                    │  └─ Offer sweeper (in-proc)  │
                    └───────────────┬──────────────┘
                                    │ private compose network
                    ┌───────────────▼──────────────┐
                    │  PostgreSQL 16 + PostGIS     │
                    │  NO published port           │
                    │  volumes: pgdata, pgbackup   │
                    └──────────────────────────────┘

  External, all adapter-gated and optional:
    SMS      Twilio | MSG91          (falls back to console)
    Payments Razorpay                 (falls back to a local mock)
    Maps     OpenStreetMap tiles      (keyless; no account needed)
    AI       any HTTP model endpoint  (falls back to the rules engine)
    Email    any transactional API    (falls back to console)
```

**Why the web app is not a separate service.** The citizen app, mechanic console
and authority dashboard are plain HTML and ES modules with no build step and no
runtime of their own. A second container would add a deployment unit, a network
hop and a CORS boundary in exchange for nothing. `@fastify/static` serves them
from the same process.

**Why there is no Kubernetes, no Redis, no message broker in the deployment.**
Because nothing here needs them yet, and each would be infrastructure to operate
for a benefit that has not been measured. The three in-process components that
*will* need them — the SSE registry, the rate limiter and the offer sweeper —
are named in [Known limits](#7-known-limits-of-this-deployment).

**Background work.** The dispatch offer sweeper runs in-process on a timer
(`OFFER_SWEEP_SECONDS`, default 10s). It is idempotent — it claims rows with
`UPDATE … RETURNING`, so two instances cannot double-escalate the same expiry —
but it is not distributed. With more than one API replica, run exactly one with
the sweeper (a dedicated worker) or move it to a job runner.

---

## 2. Deploy

### Prerequisites

- Docker with Compose v2 (`docker compose version` ≥ 2.20)
- A host with 2 GB RAM (1 GB for Postgres, 512 MB for the API, headroom)
- A domain and a TLS certificate if you want HTTPS (§4)

### Steps

```bash
git clone <this repository>
cd roadassist-bharat/app

# 1. Configuration. Never commit this file.
cp .env.example .env.production
$EDITOR .env.production        # see §3 for what is required

# 2. Build and start. Migrations run as their own unit, before the API,
#    so replicas never race to migrate the same database.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 3. Confirm.
docker compose -f docker-compose.prod.yml ps
curl -sf http://127.0.0.1:4000/health | jq .
```

A healthy response has `"status":"ok"` and `"database":"ok"`. **If the database
is unreachable the endpoint answers 503**, so a load balancer takes the instance
out of rotation rather than sending traffic to a server that cannot serve.

### Seeding

Production starts empty, deliberately. Development seed data must never reach it.

```bash
# Service types only — the reference rows the app cannot work without.
docker compose -f docker-compose.prod.yml exec api \
  node packages/db/dist/src/seed.js --reference-only
```

**Verified.** Run against a fresh database in this audit: 56 tables, 7 roles,
8 service types, 10 DTC codes, 12 vehicle models — and **0 users, 0 mechanics,
0 bookings, 0 incidents**. The API was then started against it, `/health`
returned 200, the service catalogue served, and a first account signed in and
received the `citizen` role. No fabricated user can reach production this way.

The first operator account is created by signing in — the SIM is the identity.
Grant it `admin` once, directly in the database; there is deliberately no
endpoint that promotes an account to admin.

---

## 3. Configuration

`.env.example` is the complete list with prose for each variable. What follows
is only what **production refuses to start without**, and why — each of these is
enforced by `assertProductionSafe()` in `apps/api/src/env.ts`.

| Variable | Why it is mandatory |
|---|---|
| `DATABASE_URL` | Without it the API falls back to a *localhost development* database, starts cleanly, passes its health check, and serves an empty platform. |
| `JWT_SECRET` | The development default is a literal string in the repository. Anyone could mint a token for any account. Use 32+ random bytes: `openssl rand -base64 32`. |
| `CORS_ORIGINS` | Unset means "reflect whatever Origin you are sent", which is functionally "every website may call this API with your users' credentials". |
| `EXPOSE_DEV_OTP=false` | When true the OTP is returned in the response body. Anyone with the URL signs in as anyone. |
| `SMS_PROVIDER` | `console` logs the OTP instead of sending it — nobody could sign in, and the emergency SMS path would be silent. |
| `TELECOM_WEBHOOK_SECRET` | Without it the inbound SMS webhook accepts unsigned requests, so anyone can raise an SOS as any phone number. |
| `PAYMENTS_PROVIDER` | `mock` settles invoices with no money moving — jobs marked PAID for free. |
| `PAYMENTS_KEY_ID` / `_SECRET` | Required by any real gateway. |
| `PAYMENTS_WEBHOOK_SECRET` | Without it, settlement depends entirely on the payer's browser surviving checkout. A customer who pays and closes the tab is charged for a booking that stays COMPLETED. |

**`TRUST_PROXY` deserves its own paragraph.** Behind a reverse proxy it must name
the proxy (`127.0.0.1,::1`), never `true`. Trusting every hop lets any client set
`X-Forwarded-For` itself, mint a fresh address per request, and walk straight
through the per-IP OTP ceiling. It is off by default and the server logs a
warning if you set it to `true`.

### Verified failure behaviour

```
$ OFFER_TTL_SECONDS=abc node apps/api/dist/src/server.js
Error: Configuration is not usable:
  - OFFER_TTL_SECONDS="abc" is not a positive number — expected seconds, e.g. 90

Fix these in your .env (see app/.env.example) and start again.
```

```
$ NODE_ENV=production ... node apps/api/dist/src/server.js
Error: Refusing to start in production:
  - CORS_ORIGINS is unset — production would reflect any Origin. Set it to your
    front-end origins, e.g. CORS_ORIGINS="https://app.example.in"
```

Both outputs are real, captured from this build.

### Secrets

Secrets must never be in source, in the image, in Git or in logs. The image
contains no secret — every one arrives as an environment variable at run time.
For a real deployment use your platform's secret store (AWS Secrets Manager,
GCP Secret Manager, Fly secrets, Render environment groups) rather than a
`.env` file on disk. `.gitignore` already excludes `.env*` except `.env.example`.

The audit log and the operation logger both redact credentials, OTP codes,
phone numbers, medical fields and coordinates — see `apps/api/src/observability.ts`
and its tests in `apps/api/test/state-machines.test.ts`.

---

## 4. HTTPS and domain — **NOT VERIFIED**

The API is published on `127.0.0.1:4000` only. TLS belongs to a reverse proxy
in front of it. This configuration is reasoned but has never terminated a real
certificate in this project.

HTTPS is not cosmetic here: a phone browser withholds geolocation, service-worker
registration and "Add to home screen" over plain HTTP — so **Off-Grid Mode does
not work without it.**

```caddy
# Caddyfile — Caddy obtains and renews Let's Encrypt certificates itself.
app.roadassist.in {
    encode zstd gzip
    # SSE must not be buffered or the stream arrives all at once, when it closes.
    reverse_proxy 127.0.0.1:4000 {
        flush_interval -1
    }
}
```

With nginx, the equivalents are `proxy_buffering off;` and
`proxy_set_header Connection "";` on the `/v1/events` location. The application
already sends `X-Accel-Buffering: no`, which nginx honours.

Then set `CORS_ORIGINS=https://app.roadassist.in` and
`TRUST_PROXY=127.0.0.1,::1`.

**What you must configure yourself:** the domain, its DNS A/AAAA record, and the
proxy. This repository cannot do any of it without an account.

---

## 5. Backups and recovery — **SCHEDULED AND VERIFIED**

This section used to say *"no backup schedule is configured"* while the compose
file mounted a `pgbackup` volume that nothing ever wrote to. The procedure was
documented and did not run. It runs now.

### The `backup` service

`docker-compose.prod.yml` carries a `backup` sidecar running
[`scripts/backup.sh`](../scripts/backup.sh) beside the database. It takes one
dump on boot — so a fresh deployment is covered from minute one rather than
from the first time the clock reaches the scheduled hour — and one nightly
thereafter.

| Variable | Default | |
|---|---|---|
| `BACKUP_AT_HOUR` | `2` | Hour of day, **UTC** |
| `BACKUP_KEEP_DAYS` | `14` | Dumps older than this are pruned |
| `BACKUP_VERIFY` | `1` | Restore and check each dump before trusting it |

Three decisions in it are deliberate:

- **Every dump is verified by restoring it.** Into a scratch database, comparing
  `audit_log` row counts and confirming the append-only rules survived — the
  same check the CI rehearsal makes. An unrestored dump is a hypothesis, not a
  backup.
- **A dump is written to `.partial` and renamed only on success.** A run
  interrupted by a restart must never leave a file that looks usable.
- **Retention runs only after a good dump.** A run of failures can therefore
  never delete the last known-good copy, which is the failure mode that turns a
  bad week into a lost business.

Failures are loud and the loop continues, so one bad night does not stop the
next one. Watch it with `docker compose -f docker-compose.prod.yml logs -f backup`.

**Verified on 2026-09-11** against a seeded database: dump 2.7 MB, restored into
a scratch database, 233 audit rows matched, both append-only rules intact. The
failure path was exercised too — pointed at a database that does not exist, it
reported failure, returned non-zero, and left only a `.partial`.

**Still your job:** these dumps live on the same host as the database. Sync the
`pgbackup` volume somewhere else — a backup that burns with the server is not a
backup. Nothing in this repository does that, because where it should go is a
deployment decision.

### Taking one by hand

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "/backups/roadassist-$(date +%F).dump"
```

`-Fc` (custom format) is required: it restores with `pg_restore`, supports
parallel restore, and preserves the PostGIS types correctly.

### Restore

```bash
# Into a NEW database. Never restore over a live one to "check something".
docker compose -f docker-compose.prod.yml exec -T db \
  createdb -U "$POSTGRES_USER" roadassist_restore
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U "$POSTGRES_USER" -d roadassist_restore --clean --if-exists \
  /backups/roadassist-2026-09-06.dump
# Then point DATABASE_URL at it and run the health check before switching over.
```

PostGIS must exist in the target before restore (`CREATE EXTENSION postgis`);
`migrate.js` does this, so running migrations against the empty target first is
the reliable order.

| | Value | Status |
|---|---|---|
| **RPO** | 24 hours | **TARGET.** A nightly dump loses up to a day — and no schedule is configured, so the real RPO today is "whenever somebody runs the command". Continuous WAL archiving would bring it to minutes. |
| **RTO** | < 5 minutes at this data volume | **MEASURED.** 8.4 s for the restore itself (dump 1.2 s + restore 7.2 s) plus a container restart — see the rehearsal below. It scales with data size and has never been measured on a production-sized database, so treat the *number* as indicative and the *procedure* as rehearsed. |

### Rehearsed in this audit — not a paper procedure

Measured against the development database (56 tables, 666 users, 1,601 bookings,
638 audit entries):

| Step | Result |
|---|---|
| `pg_dump -Fc` | **1.2 s**, 750 KB |
| `createdb` + extensions + `pg_restore` | **7.2 s** |
| Row counts after restore | identical on every table checked |
| PostGIS geometry | intact — a live `ST_DWithin` radius query returned 50 mechanics |
| Append-only audit rules | both restored (`audit_log_no_update`, `audit_log_no_delete`) |
| **Audit hash chain** | **verified intact across all 639 entries on the restored database** |
| API against the restore | started, `/health` 200, sign-in succeeded |

The audit-chain check is the one that matters. Matching row counts prove the
rows arrived; re-hashing the chain proves they arrived *unaltered*, which is the
only thing that makes a tamper-evident log meaningful after a restore.

For a platform handling emergencies, a 24-hour RPO is not good enough. WAL
archiving to object storage is the correct next step and is listed in
[Remaining work](#8-remaining-work).

---

## 6. Disaster recovery

| Failure | Detection | Fallback | Recovery | What the user sees |
|---|---|---|---|---|
| **API process dies** | Docker healthcheck, 3 × 15s | `restart: unless-stopped` | Automatic | Off-grid mode; SOS stored locally, synced on return |
| **Database unreachable** | `/health` → 503 | None — the API is honest rather than degraded | Restart Postgres; the API recovers with no change | Errors with a request id, not an infinite spinner |
| **Host lost** | External monitoring (not configured) | None | Rebuild from image + restore backup | Off-grid mode throughout |
| **Network partition (user side)** | Client connectivity manager | **Full off-grid mode** (ADR-0009) | Automatic sync on reconnect | Explicit "off-grid", nothing pretended |
| **SMS vendor down** | Send throws | Emergency contacts are not alerted; the escalation response says how many *actually* were | Retry; the incident is on record | The SOS screen shows "0 alerted", never a false success |
| **Payment gateway down** | Order creation throws | Invoice stays unpaid; booking stays COMPLETED | Customer retries checkout | "The payment did not go through" |
| **Map tiles unavailable** | Tile proxy 502 | Cached tiles; the map draws its own ground | Automatic | "OFFLINE MAP — LAST UPDATED …" |
| **AI endpoint down** | Timeout (`AI_TIMEOUT_MS`) | Rules engine (ADR-0006) | Automatic | Nothing — diagnosis just works |
| **Deploy is bad** | Smoke test fails | Previous image tag | §Rollback below | Brief 502 from the proxy |

`docs/architecture/failure-matrix.md` carries twenty client-side failure modes
with the suite that proves each one.

---

## 7. Rollback

Images are tagged; the database is the thing that cannot be rolled back casually.

```bash
# Application rollback — seconds.
IMAGE_TAG=<previous-tag> docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --no-build api

# Disable a feature without a deploy: every external integration is
# adapter-gated, so switching a provider back to its local implementation is a
# restart, not a code change.
PAYMENTS_PROVIDER=mock   # settles nothing, and refuses to boot in production
AI_PROVIDER=rules        # the permanent fallback, always safe
```

**Migration rollback.** Migrations `0000`–`0004` are all additive — new columns,
new indexes, no drops and no type changes — so an older image runs against a
newer schema. That is true today and is **not** a guarantee for future
migrations. The rule to keep it true: never drop or retype a column in the same
release that stops using it. Add, deploy, stop using, then drop in a later
release.

Before any migration that is not additive: take a dump (§5), apply to a restored
copy first, and verify the health check there.

## 7. Known limits of this deployment

1. **Single instance.** The SSE registry and the rate limiter are both
   in-process. With N replicas the effective rate ceiling is N× and a client
   only receives events published by the instance it is connected to. Fix:
   Redis for the limiter, the already-designed `outbox_events` → Redpanda bus
   for events. Both are documented at their definitions.
2. **The offer sweeper is in-process.** Safe to run on one instance; on several,
   run it on exactly one.
3. **No object storage.** Hazard photos go to a Docker volume. Fine for one
   host, wrong for more than one.
4. **No error-monitoring service.** Structured JSON logs on stdout are the whole
   story. `logOp` is the integration point for Sentry or equivalent.
5. **No load test.** Latency figures in the reports are single-user
   measurements against a local database.

---

## 8. Remaining work

- WAL archiving to bring the RPO below 24 hours.
- An automated backup **schedule** (the restore procedure itself is now rehearsed and measured).
- External uptime monitoring and error reporting.
- Redis-backed rate limiting before running more than one replica.

---

## 9. What I need from you

Everything below needs an account this project does not have. **None of it has
been guessed or stubbed.**

| # | What | Why | Where it goes |
|---|---|---|---|
| 1 | **A host** — VM, Fly.io, Render, Railway, an EC2 instance | Nothing can be deployed without somewhere to deploy it | — |
| 2 | **A domain + DNS** | HTTPS, and Off-Grid Mode needs HTTPS for service workers and geolocation | `CORS_ORIGINS`, the proxy config |
| 3 | **Managed Postgres with PostGIS**, or the compose `db` service | PostGIS is not optional — dispatch is a geospatial query | `DATABASE_URL` |
| 4 | **Twilio or MSG91 account** (MSG91 needs a TRAI DLT-registered template for India) | OTP sign-in and emergency SMS | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_TEMPLATE_ID` |
| 5 | **Razorpay account** — **test keys first** | Payments. The suite verifies the sandbox flow against a local stub; real keys have never been used here | `PAYMENTS_KEY_ID`, `PAYMENTS_KEY_SECRET`, `PAYMENTS_WEBHOOK_SECRET` |
| 6 | *(optional)* A hosted model endpoint | Better diagnosis than the rules engine | `AI_BASE_URL`, `AI_API_KEY` |
| 7 | *(optional)* A transactional email provider | Authority notifications | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_BASE_URL` |

Maps need **no** account: the tile proxy uses OpenStreetMap's keyless tiles, and
the client bundles Leaflet locally. That was a deliberate design choice and it
still holds.

### Cost categories

Real prices change and are not invented here. The categories are:

| Category | Driver | Note |
|---|---|---|
| Host | 1 small VM (2 GB) | The whole application is one container |
| Database | Managed Postgres + PostGIS, or self-hosted on the same VM | PostGIS support narrows the managed options |
| Object storage | Hazard photos | Not yet used; a volume today |
| Maps | **₹0** | Keyless OSM tiles; respect their tile-usage policy at scale |
| AI | **₹0** | Rules engine by default |
| Payments | Per-transaction gateway fee | Razorpay's published rate |
| SMS | Per-message | The dominant variable cost — one OTP per sign-in, plus emergency alerts |
| Monitoring | Free tier is usually enough at this size | Not configured |
