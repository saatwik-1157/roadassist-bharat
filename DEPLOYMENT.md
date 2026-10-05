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

**Hazard photos are kept in the database on this deployment.** Render's
persistent disks need a paid instance type, so `UPLOAD_DIR` is ephemeral: a file
there does not survive a restart or redeploy. Under `NODE_ENV=demo` the API
therefore defaults to `PHOTO_STORE=db` and keeps each photo in the
`raksha_photos` table, capped at 600 KiB. Both clients shrink photos to about
1280 px before upload
([ADR-0013](app/docs/adr/0013-hazard-photos-in-the-database.md)). This takes
effect from the first deploy that runs migration 0008. Photos uploaded before
that lived on the ephemeral disk and are gone; the dashboard says so rather than
showing a broken image. The cost is Neon storage: 0.5 GB on the free plan, which
is roughly 750 photos at the cap. Object storage in an Indian region is still
the production answer.

**The free plan sleeps after 15 minutes idle and takes about a minute to wake.**
That is fine for a demo. It is *not* fine for the emergency response times this
platform describes, so say so if anyone asks rather than letting a sleeping free
tier be mistaken for the architecture.

## 2 · Seed the demo once — **YOU**

The production image ships production dependencies only, so it can migrate but
cannot seed: `@faker-js/faker` is a devDependency and stays out. That is the
right shape — a production artefact has no business being able to fabricate four
thousand users.

Seed once from your machine, against the Neon database (Neon → **Connection
Details**, the direct string used for `DATABASE_URL`):

```bash
cd app
DATABASE_URL="<external-connection-string>" npm run seed -w @roadassist/db
DATABASE_URL="<external-connection-string>" npm run seed:raksha -w @roadassist/db
```

`npm run seed` is **not** idempotent — it inserts roles the migration already
created and dies on a unique violation. Run it exactly once, on a freshly
migrated database.

**`seed:raksha` does not insert detections**, by design: detections arrive over
the API from an edge device, so they cannot be seeded ahead of the server. The
deployment fills RAKSHA itself instead: with `SEED_DEMO_FLEET=true` (set in
`render.yaml`, refused under `NODE_ENV=production`), the API registers a demo
patrol device at boot and posts the 34 real YOLO11n detections from
`ai/cv-detections-full.json` through the real ingest route
(`app/apps/api/src/demo/raksha-demo-seed.ts`). The detections are model output;
their NH-48 **positions are simulated**, because RDD2022 images carry no GPS.
It runs only when the table is empty, so a restart is a no-op.

**Do not point `npm run demo:raksha` at the hosted API.** The simulator signs in
as the demo admin (`+919999900001`) with the on-screen phone code, and the hosted
demo refuses that on the phone path: the number is outside the demo ranges
(`403 demo_number_required`), and an admin is email-only whatever its number
(`403 email_signin_required`). To upload
detections by hand, sign in to RAKSHA by email, **Register an edge device**,
copy the `deviceId` and `deviceSecret` it shows once, and run:

```powershell
powershell -ExecutionPolicy Bypass -File app\scripts\raksha-upload.ps1
```

It reads the secret with hidden input and uploads through that device; a
repeat run is counted as duplicates.

## Optional · Email alerts to the owner — **YOU**

The API can email you when something worth knowing happens: every sign-in
(capped at six an hour, with the rest counted into the next email), the first
sign-in of a new number, an admin or authority sign-in, a burst of wrong OTP
codes for one number, a confirmed SOS, and an off-grid SOS that reaches the
server late, with how long it waited on the device.

It is sent from the server through [Resend](https://resend.com) (a US email
processor, declared in `check-data-residency.mjs`), so the key is never in a
page and no visitor's IP address reaches Resend. Every email carries a number
masked to its last three digits, a role, an event and a time; never a name, a
position, an IP address or a device.

1. Create a free Resend account with the address you want alerts at, and create
   an API key (**API Keys → Create**, "Sending access").
2. In Render → **roadassist → Environment**, set `EMAIL_API_KEY` to that key and
   `ALERT_EMAIL_TO` to the same address you signed up with. The free plan only
   delivers to that address, which is exactly this use.
3. Save and deploy. The boot log prints `alerts: to a…@example.com via http`, or
   `alerts: off (ALERT_EMAIL_TO unset)`, so the state is never a guess.

**More than one recipient.** `ALERT_EMAIL_TO` takes a comma-separated list
(up to 50). Resend's free sender, `onboarding@resend.dev`, only delivers to the
account's own address, so a team list needs a verified domain first: in Resend,
**Domains → Add domain**, add the DNS records it shows (at the domain's DNS
host), wait for **Verified**, then set `EMAIL_FROM` to an address on that
domain, e.g. `RoadAssist-Bharat <alerts@send.roadassistbharat.online>` (this project's verified sending domain).

Web3Forms was considered and not used: its API only allows server-side sending
on a paid plan with a whitelisted server IP, and sending from the browser
would put a key in the page and every visitor's IP address abroad.

## Optional · Email sign-in for the team — **YOU**

The demo shows the phone OTP on screen, because there is no SMS gateway. That
makes it usable, and it also means anyone who types a demo number becomes that
account. Under `NODE_ENV=demo` the phone path already refuses every number
outside the demo ranges and every admin or officer
(`apps/api/src/domain/demo-numbers.ts`); email sign-in closes it for the
demo-range accounts you name, such as a team member's mechanic.

Set `EMAIL_SIGNIN` in Render → **Environment** to `email=+91XXXXXXXXXX` pairs,
comma-separated, each pointing an address at an existing account:

```
you@example.com=+919999900001, teammate@example.com=+919600000000
```

- That address can now choose **Sign in with email**; a random 6-digit code is
  emailed through the provider configured above and is never shown on screen.
- That account's number stops accepting the on-screen phone code (it answers
  `email_signin_required`), so the email is the only way in while the demo
  code is exposed.
- An address that is not listed gets the same reply and no email, so the
  form cannot be used to discover who has an account.
- Delivery uses the same email provider as the alerts, so on Resend's free
  sender only your own address receives codes until a domain is verified.

The boot log prints `email sign-in: N account(s)`, and any malformed entry is
logged as ignored rather than half-applied.

## Optional · Location services — on by default, **YOU** decide

The citizen app's "Near you" card, the road ETA on a live rescue, the RAKSHA
"Corridor conditions" panel and the corridor report's air quality come from open
data, fetched by the server: OpenStreetMap Nominatim and Overpass, the OSRM demo
router, Open-Meteo air quality and the USGS earthquake feed
([ADR-0012](app/docs/adr/0012-open-map-location-services.md)). None needs an
account or a key.

`GEO_SERVICES` controls them:

| Value | Effect |
|---|---|
| unset | **Off** under `NODE_ENV` `development`, `test` or `ci`; **on** anywhere else. The blueprint runs `demo`, so the live service has them on |
| `on` | On, whatever `NODE_ENV` says. Use it to try them on a development machine |
| `off` | Off. `/v1/geo/*` answer `503 geo_disabled`, the corridor report has no air quality, and the screens say the lookup is unavailable |

Two things to know before leaving them on:

- Every host is outside India, and Nominatim, Overpass and OSRM receive a
  signed-in user's position, coarsened to about 110 m or 1 km. That is a stated
  exception to non-negotiable #4; set `off` for any deployment with real users
  until self-hosted instances in an Indian region replace them.
- `docker-compose.demo.yml` also runs `NODE_ENV=demo`, so the one-command demo
  calls these services too. It does not pass `GEO_SERVICES` through from your
  shell, so to keep it offline add `GEO_SERVICES: "off"` to the api service's
  `environment` block in that file.

The boot log does not report the setting. A lookup's answer is how to tell:
`geo_disabled` means off; `geo_unavailable` means on, with the provider not
answering.

## Least-privilege database role — **done on 5 Oct 2026**

The hosted API now connects as `roadassist_app`; `pg_stat_activity` on the live
database shows it. The steps below are kept for a new environment or a rebuilt
database. Without them the API connects as the Neon owner, so a flaw that let
someone run SQL through the API could drop tables or the audit log's
append-only rules. Only the owner can apply it.

[`app/packages/db/sql/least-privilege-role.sql`](app/packages/db/sql/least-privilege-role.sql)
creates `roadassist_app` with no password: `CONNECT`, `USAGE` on `public`,
`SELECT/INSERT/UPDATE/DELETE` on the application tables (`audit_log`: `SELECT`
and `INSERT` only), `USAGE/SELECT` on sequences, and default privileges so
tables that later migrations add are covered too. It gets no `CREATE`,
`TEMPORARY`, `TRUNCATE`, `REFERENCES` or ownership of anything. Migrations keep
running as the owner through `MIGRATION_DATABASE_URL`, which `docker-start.sh`
uses for the migrate step only and then drops, so the server never holds it.

1. **Neon → SQL editor**, connected as the owner (`neondb_owner`, the role
   migrations run as): paste the whole file and run it. It ends with a table
   of what was granted; `create_in_schema` and `temp_in_database` must be
   `false`. Running it again is safe. Do **not** create the role with Neon's
   **New role** button first: console-created roles join `neon_superuser`, and
   the file refuses such a role.
2. **Neon → Roles → `roadassist_app` → Reset password**, and copy the value
   shown. If the console does not offer it for this role, run
   `ALTER ROLE roadassist_app WITH PASSWORD '<long random value>';` in the SQL
   editor instead (Neon requires a strong one). Never put it in the repository.
3. **Render → roadassist → Environment**:
   - `MIGRATION_DATABASE_URL` = the current owner string (the value
     `DATABASE_URL` holds today);
   - `DATABASE_URL` = the same **direct** string with the user and password
     replaced by `roadassist_app` and its password:
     `postgresql://roadassist_app:<password>@<same direct host>/<same db>?sslmode=require`.
4. **Save and redeploy.** The deploy log should read
   `→ migrating (as the migration role in MIGRATION_DATABASE_URL)` and then
   `→ starting api`, and `/health` should answer 200 with `"database":"ok"`.

To undo it, put the owner string back in `DATABASE_URL` and delete
`MIGRATION_DATABASE_URL`. Seeding by hand (section 2) still uses the owner
string. To check a role from your own machine, run
`LEAST_PRIVILEGE_DB_URL=<app role string> node --import tsx --test packages/db/test/least-privilege.test.ts`
from `app/`: it asserts that the role cannot drop or alter `audit_log`, drop
its rules, truncate, or create anything, and rolls every attempt back.

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

## Search engines · Google Search Console — **YOU**

What is already in place:

| | Showcase (`roadassistbharat.online`) | Platform (`app.roadassistbharat.online`) |
|---|---|---|
| Sitemap | `/sitemap.xml`: the page plus 20 image entries | `/sitemap.xml`: landing, showcase, 3D layers, app, map, mechanic, RAKSHA |
| robots.txt | everything allowed | pages allowed; `/v1/`, `/tiles/`, `/basemap/`, `/media/`, `/health` kept out |
| On-page | title and description sized for results, canonical, Open Graph and Twitter cards, `robots` meta, JSON-LD (`WebSite` + `SoftwareApplication`, with no ratings or reviews) | the pages' own titles |

**Done on 2026-09-30.** Both sites are URL-prefix properties in the owner's
Search Console account (`https://roadassistbharat.online/` and
`https://app.roadassistbharat.online/`). Both are verified by Google's HTML file,
and both sitemaps are submitted. The homepage was already indexed, and a
re-crawl was requested for the new titles. **Do not delete
`googlee923ee0decf8e5e0.html`** from `pages/` or `app/apps/web/`: Google
re-checks it, and removing it unverifies the property. No tracking script is
involved, which keeps non-negotiable #4 intact.

To cover the apex, `www` and `app` under one Domain property instead, follow
the steps below. Those need a DNS record at Hostinger.

1. Open <https://search.google.com/search-console> and choose **Add property**.
2. Pick **Domain** and enter `roadassistbharat.online`. One Domain property
   covers the apex, `www` and `app`.
3. Google shows a TXT record (`google-site-verification=…`). Add it at Hostinger:
   **DNS / Nameservers → DNS records → Add record**, type `TXT`, name `@`, and
   the value exactly as shown. Keep the existing CNAME and A records.
4. Back in Search Console, choose **Verify**. DNS can take from a few minutes
   to an hour. If it fails, wait and retry; do not remove the record.
5. Go to **Sitemaps** and submit both URLs:
   `https://roadassistbharat.online/sitemap.xml` and
   `https://app.roadassistbharat.online/sitemap.xml`.
6. In **URL inspection**, enter `https://roadassistbharat.online/` and choose
   **Request indexing**.

If you prefer the HTML-tag method (URL-prefix property for the showcase only),
paste Google's `<meta name="google-site-verification" …>` tag into
`pages/index.html`, replacing the comment `google-site-verification: not set
yet`. For the HTML-file method, add Google's `google….html` to `pages/`: the
Pages workflow publishes any `pages/google*.html` next to the sitemap.

---

## Before you share the URL

Two settings in `render.yaml` are deliberate, and one of them is a door.

**`EXPOSE_DEV_OTP=true`.** With no SMS provider there is no way to receive a
code, so the API returns it in the response. That is what makes the demo usable
and it also means **anyone with the URL can sign in as any demo-number account
that is not listed in `EMAIL_SIGNIN`**: `+91 70000 00000` to `+91 70000 09999`,
`+91 98765 43210` and `+91 96000 00000` to `+91 96000 00099`. Every other
number answers `403 demo_number_required`, and an admin or RAKSHA officer is
refused on the phone path whatever its number, so those accounts and the
listed mechanics can only be entered with a code emailed to their address (see
*Email sign-in for the team* above). For the remaining
throwaway demo accounts that is a reasonable trade. It would not be acceptable against real data, and the moment
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

- 246 end-to-end assertions and 106 security attacks, `API=` pointed at the
  container
- every surface answers 200: `/app.html`, `/mechanic.html`, `/raksha.html`,
  `/map.html`, `/health`, `/v1/ping`
- a page planted in `site/` must **not** be served at `/media`, while a demo
  video beside it must — `site/` is mounted at `/media` for demo video, and
  mounting it whole once published prototype pages that pulled webfonts from
  Google, so a 200 for the page is a privacy regression. Those pages have since
  been deleted from `site/` (it now holds two videos and a photo), which is why
  the check plants its own page rather than asking for `/media/app.html`

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
