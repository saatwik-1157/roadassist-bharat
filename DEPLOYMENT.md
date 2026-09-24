# Deploying RoadAssist Bharat

Target: **https://app.roadassistbharat.online** (the platform), beside the
showcase at **https://roadassistbharat.online** (GitHub Pages).

Everything below has been verified against the real production image on a real
PostGIS, except the three steps that need an account only you can open. Those
are marked **YOU**.

---

## What ships

One container. The Fastify API and every web surface — citizen app, mechanic
console, authority dashboard, live map — are served by the same process
(ADR-0001), because the surfaces are plain files with no build step. A second
container would add a deployment unit, a network hop and a CORS boundary in
exchange for nothing.

| | |
|---|---|
| Image | built from `app/Dockerfile`, **context is the repository root** |
| Base | `node:22-alpine` — matches `"node": ">=22"` and CI |
| Published to | `ghcr.io/saatwik-1157/roadassist-bharat` on every push to `main` |
| Database | PostgreSQL 16 **with PostGIS** — not optional, see below |
| Port | `PORT` env, binds `0.0.0.0` |
| Readiness | `GET /health` — 503 while the database is unreachable |

### PostGIS is a hard requirement

`migrate.ts` runs `CREATE EXTENSION postgis`, the incident and mechanic tables
carry SRID-pinned geometry, and dispatch ranks providers with `ST_DWithin`. A
managed Postgres that will not install the extension fails on the first
migration. This rules out several free tiers that otherwise look equivalent —
check for PostGIS before choosing a host, not after.

---

## 1 · Create the services — **YOU**

The blueprint is committed as [`render.yaml`](render.yaml): one web service on
Render's free plan in the Singapore region (closest to India), with the database
hosted separately.

**The database is not Render's.** Render allows exactly one free PostgreSQL per
account, and applying a blueprint that asks for a second fails with *"cannot
have more than one active free tier database"* — the web service is then
cancelled too, correctly, rather than left pointing at nothing. So the database
lives on Neon, whose free tier supports the PostGIS this schema requires.

1. Create a free Postgres at [neon.tech](https://neon.tech), then in its SQL
   editor run once:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
   `migrate.ts` also issues this, but it needs rights the pooled role may not
   have, so doing it by hand removes the doubt.
2. Copy Neon's **direct** connection string — not the pooled one. The pooler
   does not keep session state, and both the migrations and the SSE streams
   want a real session.
3. In Render: **New → Blueprint**, select `saatwik-1157/roadassist-bharat`.
4. Render will prompt for `DATABASE_URL` (it is `sync: false` in the blueprint,
   so it is never committed). Paste the Neon string. `JWT_SECRET` is generated
   by Render.

The service migrates on boot — `migrate.ts` is idempotent — so there is no
separate migration step for the first deploy.

**Hazard photos are not durable on the free plan.** Render's persistent disks
need a paid instance type, so `UPLOAD_DIR` is ephemeral: an upload does not
survive a restart or redeploy. ADR-0006 keeps only a reference in the database,
so the row outlives the file and the photo endpoint 404s rather than corrupting
anything — but say that out loud rather than letting anyone assume otherwise.

**The free plan sleeps after 15 minutes idle and takes about a minute to wake.**
That is fine for a demo. It is *not* fine for the emergency response times this
platform describes, so say so if anyone asks rather than letting a sleeping free
tier be mistaken for the architecture.

## 2 · Seed the demo once — **YOU**

The production image ships production dependencies only, so it can migrate but
cannot seed: `@faker-js/faker` is a devDependency and stays out. That is the
right shape — a production artefact has no business being able to fabricate four
thousand users.

Seed once from your machine, against the Render database URL (Render → database
→ **External Connection String**):

```bash
cd app
DATABASE_URL="<external-connection-string>" npm run seed -w @roadassist/db
DATABASE_URL="<external-connection-string>" npm run seed:raksha -w @roadassist/db
```

`npm run seed` is **not** idempotent — it inserts roles the migration already
created and dies on a unique violation. Run it exactly once, on a freshly
migrated database.

**`seed:raksha` leaves the authority dashboard empty**, by design: detections
arrive over the API from an edge device, so they cannot be seeded ahead of the
server. To fill it, point the simulator at the deployed API:

```bash
cd app
API=https://app.roadassistbharat.online npm run demo:raksha
```

## 3 · Point the domain — **YOU**

In Render: **Settings → Custom Domains → Add** `app.roadassistbharat.online`.
Render shows the exact target host; it looks like `roadassist-xxxx.onrender.com`.

Then in Hostinger, **Domains → roadassistbharat.online → DNS / Nameservers →
DNS records**, add one record and leave the existing ones alone - the four `A`
records and the `www` CNAME are what keep the showcase on GitHub Pages:

| Type | Name | Target | TTL |
|---|---|---|---|
| CNAME | `app` | the `*.onrender.com` host Render shows | 300 |

Render issues the certificate by itself once the record resolves, usually
within minutes; its Custom Domains page turns green when it has.

The showcase finds the platform through `pages/live.json`. Once
`https://app.roadassistbharat.online/health` answers, set its `origin` to that
address and push; every visitor's frames then connect to it with no browser
permission, because it is a public https address rather than their localhost.

`CORS_ORIGINS` in `render.yaml` allows `https://roadassistbharat.online` (the
showcase reads `/health` before it frames the platform) and the platform's own
address. If you deploy under a different name, change it there - an unset value
reflects any Origin, which is why it is pinned rather than omitted.

---

## Before you share the URL

Two settings in `render.yaml` are deliberate, and one of them is a door.

**`EXPOSE_DEV_OTP=true`.** With no SMS provider there is no way to receive a
code, so the API returns it in the response. That is what makes the demo usable
and it also means **anyone with the URL can sign in as any seeded account,
including the authority dashboard**. For a throwaway demo database that is a
reasonable trade. It would not be acceptable against real data, and the moment
this holds anything real, set it to `false` and configure MSG91.

**`NODE_ENV=demo`, not `production`.** The production guard in `env.ts` refuses
to boot without a real payment gateway, a real SMS provider and webhook secrets.
That guard is correct and running as `demo` keeps it meaningful rather than
weakening it. The consequence is that payments are mocked and SMS goes to the
console — both of which the UI already labels on screen (non-negotiable #5).

---

## What is verified, and how

The image is not trusted because it built. `.github/workflows/publish-image.yml`
boots it against a real PostGIS and runs the suites **against the running
container** before publishing:

- 189 end-to-end assertions and 74 security attacks, `API=` pointed at the
  container
- every surface answers 200: `/app.html`, `/mechanic.html`, `/raksha.html`,
  `/map.html`, `/health`, `/v1/ping`
- `/media/app.html` must **not** answer 200 — `site/` is mounted at `/media` for
  demo video, and mounting it whole once published prototype pages that pulled
  webfonts from Google, so a 200 there is a privacy regression

An image that boots but cannot take a booking is not a passing build, and only
running the suites against it can tell the difference.

## Two bugs this found

Written down because both were invisible from the source tree and would have
surfaced on a first deploy, against an empty database — the worst moment.

1. **The image could not migrate its own database.** `migrationsFolder:
   "./drizzle"` resolved against the *process* working directory, which is only
   correct when npm runs the script from `packages/db`. The container starts at
   `/repo/app`, so it resolved to nothing. It now resolves relative to the
   module, walking up for `drizzle/meta/_journal.json` — the same fix
   `server.ts` already carries for its static roots.

2. **The image ran Node 20 while the project declares `"node": ">=22"`** and CI
   uses 22. `npm ci` did not object because engine-strict is off, so the
   deployed artefact ran on a runtime the project says it does not support.

## Hosts that cannot run this

Said plainly, because the question comes up and the answer is not obvious from
the outside: **Netlify, Vercel and any function-per-request host cannot run this
API.** Three things need a long-lived process —

- `realtime.ts` holds open `text/event-stream` connections; a function
  terminates and takes the stream with it.
- `dispatch.ts` runs the offer-expiry sweeper on an interval, and `ratelimit.ts`
  sweeps the limiter. Neither runs between invocations, so offers would never
  expire — and offer expiry is load-bearing for the concurrency guarantees.
- The Postgres pool is persistent, and PostGIS is required.

Hosting the surfaces there and the API elsewhere would also split what ADR-0001
deliberately keeps in one process, adding a CORS boundary and a second
deployment unit in exchange for nothing — and the API would still need a home.

[`fly.toml`](fly.toml) is a ready alternative to Render; both run the same
image, so nothing about the application changes between them.

## Checking a deployment

The suites prove the code. This proves the thing on the internet, which is a
different claim — a deployment can serve a perfect application over a broken
certificate, or reintroduce the `/media` privacy leak, or quietly expose an OTP
that lets anyone sign in as the authority:

```bash
cd app
npm run verify:deployment https://app.roadassistbharat.online
```

It fails on: unreachable or suspended, a database the app cannot see, any
surface not answering 200, `/media/*.html` being served again, a third-party
subresource in any served page (read from the live HTML, not from the
repository), and plain http. It warns — without failing — on a cold start, a
missing HSTS or CSP header, and an exposed dev OTP, because those are facts
about the tier and the configuration rather than defects, and they are exactly
the ones that get forgotten.

## Rolling back

Images are tagged by commit SHA, so a bad deploy rolls back to a known artefact
rather than to a rebuild of an older commit:

```
ghcr.io/saatwik-1157/roadassist-bharat:sha-<short-sha>
```
