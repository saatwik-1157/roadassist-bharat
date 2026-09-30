# Security

Threat model: [`security/threat-model.md`](security/threat-model.md) — STRIDE,
20 threats mapped to controls.
Penetration suite: [`../scripts/security-audit.mjs`](../scripts/security-audit.mjs) —
**106 attacks, every one refused.**

Everything below has been executed. A control described here without a test
beside it says so.

---

## The one-line summary

`npm run test:security` fires 87 application-level attacks at a running server.
The suite passes when the platform **refuses** — "we tried and could not get in"
is a materially different claim from "the code looks right". It runs in CI.

---

## Authentication

| Control | Detail | Verified by |
|---|---|---|
| OTP over SMS | Hashed with SHA-256, never stored in the clear; per-number and per-IP ceilings | `gateway-security-test.mjs` |
| Short-lived access token | JWT, 10 minutes | `e2e-journey.mjs` §2 |
| Rotating refresh token | Every use rotates; **reuse burns the whole family** — reuse is treated as theft, not as a mistake | `security-audit.mjs` §6, `e2e-journey.mjs` §2 |
| Forged signature | Refused | `security-audit.mjs` §6 |
| Subject swap | A token whose `sub` is edited to another account is refused | `security-audit.mjs` §6 |
| `alg: none` downgrade | Refused | `security-audit.mjs` §6 |
| Concurrent 401s | Share one in-flight refresh, so an ordinary expiry cannot burn the family | `ui-journey.mjs` §5 |

The OTP ceilings are counted in **Postgres**, not in process memory. That is
deliberate: credential stuffing is the one attack where a per-instance ceiling
would be worth nothing.

### Email sign-in for protected accounts

The hosted demo has no SMS gateway, so the phone code is shown on screen
(`EXPOSE_DEV_OTP`) — which on its own would let anyone who types the admin's
number become the admin. Email sign-in closes that for the accounts that matter
(`apps/api/src/domain/email-signin.ts`, `routes/email-auth.ts`):

- `EMAIL_SIGNIN` maps an address to an **existing** account's number
  (`email=+91XXXXXXXXXX` pairs). It is set in the host's environment, never in
  the repository. On the demo it lists the admin, the RAKSHA officer and the
  listed mechanics.
- `POST /v1/auth/email/request` emails a **random** 6-digit code (`randomInt`),
  valid 5 minutes, one use. It is never returned in the response, even with the
  console provider, and never the fixed development code.
- A protected number's **phone** path is refused with
  `403 email_signin_required` whenever the phone code is not a random one only
  the handset receives — echoed on screen, or the fixed dev code with echo off.
- An unlisted address gets the same answer and no email, still records a
  challenge so the per-address and per-IP ceilings answer identically, and a
  real send happens after the response — so neither the answer, its timing nor a
  429 reveals which addresses are listed.
- `POST /v1/auth/email/verify` repeats the phone path's checks: expiry, an
  attempt slot taken **before** the compare (so simultaneous guesses cannot all
  slip under the cap), a constant-time hash compare, and a conditional consume
  so two correct submissions cannot both get a session. A code that failed to
  send is deleted, so it cannot be redeemed.
- Challenges are stored under `e:` + 14 hex characters of the address's SHA-256,
  so the address itself is not in `otp_challenges`.

**Verified by:** `email-signin.test.ts` (mapping, malformed entries reported by
position, key collision and masking, the phone-refusal rule) and
`otp-policy.test.ts` (a code guarding an account is never fixed and never
echoed). The two email routes themselves are **not yet exercised** by the e2e or
security suites.

### Operator alerts

`apps/api/src/alerts.ts` emails the project owner on sign-ins (capped per hour,
the rest counted into the next email), a first sign-in, admin/authority
sign-ins, bursts of wrong codes, a confirmed SOS and an off-grid SOS that synced
late. Sent **server-side** through Resend (`api.resend.com`, USA) from
`RoadAssist-Bharat <alerts@send.roadassistbharat.online>`, so the key never
reaches a browser. Each email carries a number masked to its last three digits,
a role, an event and a time — never a name, position, IP address or device
(`alerts.test.ts` fails if the number leaks). Delivery is fire-and-forget, so a
failing provider cannot delay a sign-in or an SOS. Off unless `ALERT_EMAIL_TO`
is set. Resend is therefore an email **processor** for alerts and for sign-in
codes, which go to the listed address.

## Authorization

Two independent layers, and the second is the one that matters.

1. **Role gates** — `requireRole("admin", "gov_officer")` and friends on every
   operator surface.
2. **Resource ownership**, checked *at the resource*. `bookingAudience()` is
   consulted on every booking read and write, so the read path is never more
   permissive than the write path — an earlier version had exactly that bug: an
   assigned mechanic could drive a job they were not allowed to look at.

**Attacks fired and refused (all 403 or 404):**

- read another customer's booking or its timeline
- cancel, dispatch, pay or review another customer's booking
- cancel, escalate or resolve another customer's SOS
- book against, or rename, another customer's vehicle
- reach the audit log, operations overview, email endpoint, device registry or
  road-health recompute as a citizen
- reach any mechanic surface as a citizen
- break-glass into medical data as a citizen (403) or anonymously (401)

A listing endpoint returns only the caller's own rows — checked with a booking
of the caller's own present, so the assertion cannot pass vacuously.

## Input validation and injection

Every boundary is a zod schema: required fields, types, ranges, string lengths,
UUID formats. Queries are parameterised through Drizzle or tagged `sql` — no
string concatenation reaches the database.

**Tested:** four SQL-injection payloads in path parameters (all `400`), an
injection payload inside free text (stored as text, not executed), and the
database confirmed intact afterwards. Oversized fields, malformed JSON, wrong
types and out-of-range coordinates all return `400`.

**XSS.** The API is a JSON service and stores what it is given, byte-identical;
escaping is the client's job and the browser suite asserts the DOM does it.
Responses are served as `application/json`, so a payload cannot execute in the
API origin.

## Rate limiting

Per-principal fixed windows on booking, payment, sync, offer-accept and stream
opening. A fixed window rather than a token bucket, because a bucket lets a
client save up an hour of allowance and spend it in one second.

**The emergency rule, which is a test and not a comment:**

- the SOS ceiling sits far above any human rate;
- a double tap is absorbed by **idempotency**, not throttling;
- and `POST /v1/sos/:id/confirm` — the call that actually summons help — is
  **never rate limited at all**.

Verified: ten genuine SOS in a row are all accepted; a booking flood is
throttled; every 429 carries `retryAfterSeconds` so a client can back off
correctly.

**Limitation.** This state is in-process. Behind N instances the effective
ceiling is N×. Redis is already in `docker-compose.yml` for exactly this.

## Payment verification

The client never decides that money arrived.

- The amount is **never** taken from the request — it is the invoice total, and
  the webhook refuses a captured amount that does not match.
- Settlement requires an HMAC-SHA256 signature the server recomputes, compared
  in constant time.
- Two paths exist and the **webhook** is authoritative, because a customer can
  pay and immediately close the tab.
- Delivery is at-least-once, so every path is idempotent; the settlement UPDATE
  is conditional on `PENDING`.
- Production refuses to boot on a real gateway with no webhook secret.

**Checks written, not counted (`razorpay-test.mjs`, 22 checks):** forged
signature, replayed delivery, wrong amount, wrong order, unconfigured secret —
each must fail closed. The script needs no Razorpay account: it starts a local
stub of Razorpay's Orders API and signs webhooks with a stub secret. It refuses
to run unless the API was started with `PAYMENTS_PROVIDER=razorpay` and
`PAYMENTS_BASE_URL` pointed at that stub, so it is outside the six counted
suites and was not re-run for the current figures. **Never run against a real
account**, and the hosted demo uses the `mock` provider.

## Webhooks

Both inbound webhooks verify a signature over the raw bytes, and the raw body is
preserved for exactly that reason.

The **inbound SMS** webhook can raise an SOS for any phone number it is handed,
so when `TELECOM_WEBHOOK_SECRET` is unset it now **says so on every response**:
`"UNSIGNED INTAKE — … Development only."` Production cannot reach that state;
`assertProductionSafe()` refuses to boot without the secret. *(This was a real
finding: the code comment claimed the state was "flagged" and it was not.)*

## Audit trail

`audit_log` is a **hash chain**: each entry hashes its own content together with
its predecessor's hash, so editing or deleting any historical row invalidates
every hash after it — detectable without trusting the database it lives in.

Postgres `RULES` block `UPDATE` and `DELETE` on the table outright. The chain is
re-verified **live** by `/v1/ops/overview`, and again on any restored backup —
during this audit it verified intact across all 639 entries on a restore.

Audited actions: `auth.login`, `sos.created`, `sos.cancelled`, `sos.escalated`,
`sos.resolved`, `sos.offgrid_synced`, `dispatch.started`,
`dispatch.provider_offered`, `dispatch.provider_accepted`,
`dispatch.provider_rejected`, `dispatch.escalated`, `booking.status_changed`,
`payment.webhook.captured`, `sync.completed`, `medical.break_glass_read`,
`mechanic.on_duty` / `off_duty`.

## Sensitive data

**Break-glass medical access** requires all of: the `admin` or `gov_officer`
role, an incident that is **currently live**, and a written reason of 10–300
characters. It writes a `break_glass_access` row and the subject is told it
happened. There is no route to it for any other role.

**Logging.** `observability.ts` redacts, at any depth: tokens, authorization
headers, passwords, secrets, OTP codes, signatures, API keys, phone numbers,
email addresses, **coordinates**, blood group, allergies, conditions,
medications, symptoms and free-text notes. A log aggregator is not a place to
build a movement history of somebody who called for help. The redaction is
unit-tested, including the nested case where a whole row is spread into a log
call.

**Error bodies** carry `code`, `title`, `retryable` and `requestId` — never a
stack trace, an internal path or SQL. The developer `detail` field exists only
outside production, verified by running the container with
`NODE_ENV=production` against a dead database: the body came back with the four
safe fields and nothing else.

**On-device storage.** AES-GCM-256 under a **non-extractable** `CryptoKey`. That
protects a copy of the storage taken off the device. It does **not** protect
against script running on the same origin, and the UI says exactly that. Where
WebCrypto is unavailable the store falls back to plaintext and **says so on
screen**. No token, payment credential or server secret is ever stored there.

## Transport and origins

Production requires an explicit `CORS_ORIGINS` allowlist and refuses to boot
without one — reflecting the caller's `Origin` is functionally "any website may
call this API with your users' credentials". Verified: an allowed origin is
reflected, any other gets no allow-origin header.

`TRUST_PROXY` is **off by default and never inferred**. Trusting every hop lets
any client forge `X-Forwarded-For` and walk through the per-IP OTP ceiling; the
server logs a warning if it is set to `true`.

`/health` returns only liveness and readiness to anonymous callers. Provider
names, environment, uptime and live stream counts moved behind `?detail=1` plus
an operator role — that detail is useful to an operator and equally useful to
somebody mapping the deployment.

### Outbound calls for location services

`apps/api/src/routes/geo.ts` ([ADR-0012](adr/0012-open-map-location-services.md))
adds five egress hosts, each declared with its region and what it receives in
`scripts/check-data-residency.mjs`: `nominatim.openstreetmap.org`,
`overpass-api.de`, `router.project-osrm.org`, `air-quality-api.open-meteo.com`
and `earthquake.usgs.gov`. All five are outside India.

- **Server-side only.** The pages call `/v1/geo/*` on this platform, so no
  visitor's IP address reaches a provider. The routes require a signed-in
  caller and share a per-principal limit of 40 requests a minute.
- **Coarsened first.** Address and route lookups round to 3 decimal places
  (about 110 m), a nearby search to 2 (about 1 km). Air quality is asked only
  at the RAKSHA corridor's fixed segment midpoints, and the earthquake query
  carries only a fixed bounding box and a date. A point outside India is
  refused with `400 outside_region` before any provider is asked.
- **Paced and cached.** One request at a time per provider, at least about a
  second apart (two for Overpass), with a bounded queue that answers
  `503 geo_unavailable` when full rather than growing. Caches: address 24 h,
  nearby 6 h, route 10 min, earthquakes 15 min, air quality 30 min. Every call
  carries an identifying User-Agent, as the providers' terms ask.
- **Off by default where tests run.** `GEO_SERVICES` unset means off under
  `NODE_ENV` `development`, `test` and `ci`, and on anywhere else; `on`/`off`
  override it. Off answers `503 geo_disabled`, so no test run or CI job sends a
  position anywhere.

**Still open:** coarsening reduces what leaves but does not anonymise it. A
position rounded to about 110 m is still personal data, sent outside India.
That is a stated exception to non-negotiable #4, acceptable only because the
demo already runs in Singapore. Self-hosted Nominatim and OSRM in an Indian
region is the production answer, and is not built.

## Secrets

No secret is in source, in the image, in Git or in logs. The production image
contains none; every one arrives as an environment variable at run time.
`.gitignore` excludes `.env*` except `.env.example`, and CI runs **gitleaks** on
every push with a full-history fetch.

---

## Findings from the Phase 8 audit, and what happened to them

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | 401 responses carried no `requestId` — the two most common failures were the only ones a user could not quote a reference for | Low | **Fixed**, regression test added |
| 2 | Malformed JSON returned **500** — any error carrying a `statusCode` fell through to the 500 branch, so bad client input was counted as an outage | Medium | **Fixed**, regression test added |
| 3 | Unsigned SMS intake was silently open; the code comment claimed it was "flagged" | Medium | **Fixed**, warns on every response, regression test added |
| 4 | `/health` exposed providers, environment, uptime and stream counts anonymously | Low | **Fixed**, gated behind an operator role |

One reported finding was a **test bug, not a vulnerability**: the subject-swap
check set the subject to the token's *own* account, so the 200 it earned was
correct. Corrected to swap to a different account, which is refused.

## The September 2026 hardening pass

A checklist review (keys, env, admin routes, auth, access control, input,
XSS, rate limits, CORS, headers, debug mode, dependencies, exposed files,
database, passwords, leaked secrets). Git history, the live hosts and every
source file were searched for secrets first: **none was found**, and every
probe for an exposed file (`/.env`, `/.git/config`, source maps, backups)
answers 404 on the live hosts. What changed:

| Finding | Severity | Fix | Verified by |
|---|---|---|---|
| With the OTP echoed on the hosted demo, **any** number — including a privileged one — could be signed into | High | Outside local environments an echoed or fixed code is accepted only for the published demo numbers, and never for a privileged role (`domain/demo-numbers.ts`) | `demo-numbers.test.ts`; live: a non-demo number is refused |
| The inbound-SMS webhook with no secret accepted any number on the hosted demo, so a stranger could act as a real phone | High | 503 `webhook_not_configured` except for demo numbers; a set secret is required of everyone; limited per sending number (`domain/webhook-intake.ts`) | `webhook-intake.test.ts`, `gateway-security-test.mjs` |
| `/v1/notify/email` would send an operator-written message to any address | High | Plain text only, and only to the platform's own alert and sign-in recipients — else 403 `recipient_not_allowed` | `e2e-journey.mjs` §25 |
| Behind Cloudflare, the client address came from `X-Forwarded-For`, which the caller writes — every per-IP limit could be dodged | High | `CLIENT_IP_HEADER=cf-connecting-ip`: the address the edge saw, used only when it is a valid IP (`client-ip.ts`) | `route-limits.test.ts` |
| No security headers | Medium | CSP (`object-src 'none'`, `frame-ancestors` limited to the showcase, `base-uri`/`form-action 'self'`, inline scripts by hash only), nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS over HTTPS; `no-store` on the API (`security-headers.ts`) | `security-headers.test.ts`, `e2e-journey.mjs` §25 |
| No sign-out on the server — a stolen refresh token outlived "sign out" | Medium | `POST /v1/auth/logout` revokes the whole session family; its access tokens are refused as `AUTH_REVOKED` | `security-audit.mjs` (9 checks) |
| A repeated SOS confirm re-texted every emergency contact | Medium | Confirm is idempotent per incident; at most 10 alert batches an hour per account (the escalation itself is never limited); at most 5 contacts, each number once | Contacts: `e2e-journey.mjs` §25. Confirm idempotency and the alert cap: a manual probe (10 simultaneous confirms, one send) — **not yet in a counted suite** |
| The generic transition route let a non-admin issue `mechanic.accept` and other system commands | Medium | 409 `command_not_allowed`; only the customer or an admin may cancel | `e2e-journey.mjs` §25 |
| Another user's idempotency key replayed *their* booking | Medium | 409 `idempotency_key_in_use` | `e2e-journey.mjs` §25 |
| The tile proxies would fetch any tile, anywhere, unlimited | Low | Only tiles that exist, over the region, 1,200 a minute | `route-limits.test.ts` |
| A foreign `vehicleId` could be attached to an SOS or a diagnosis | Low | Dropped, and the response says so | Manual probe — **not yet in a counted suite** |
| The console SMS log printed full numbers and live sign-in codes on the hosted demo | Low | Masked outside development (`+91******3210`, `••••••`); the same for the console email provider | `log-redaction.test.ts` |
| Weak or default JWT secret accepted outside development; the local demo compose shipped a fixed one | Low | Refused below 32 characters; the demo generates a random one per boot | `jwt-secret.test.ts` |
| Database connections to a remote host did not require TLS | Low | `ssl: "require"` unless the URL says otherwise or the host is local | `database-tls.test.ts` |
| Pages: `innerHTML` with server strings, CSV formula injection, a token left in the map URL | Low | Escaped, neutralised, cleared | Code review; the browser suite still passes |
| Android: map WebView could navigate anywhere and its bridge answered any page; app data was backed up | Low | Origin allow-list for navigation, bridge and geolocation; file access off; `allowBackup=false` | `MapWebGuardTest.kt` |
| A device-supplied `imageRef` was joined onto the upload folder unchecked: the photo route could read, and an officer's reject could delete, a file outside it | High | Any path that resolves outside `UPLOAD_DIR` is refused (`domain/upload-path.ts`) | `upload-path.test.ts`, `security-audit.mjs` §12 |
| A refresh racing a sign-out could still mint a working session | Medium | Sign-out and rotation serialise on a per-family advisory lock; the loser gets `signed_out` | `concurrency-test.mjs` §7a |
| The five-contact cap was count-then-insert: eight parallel adds stored eight | Medium | Count and insert in one transaction under a per-user lock | `concurrency-test.mjs` §6e |
| Three parallel dispatches each sent a wave (12 offers to 4 mechanics) | Medium | The booking is claimed by compare-and-swap before a wave is sent | `concurrency-test.mjs` §6d |
| A failed SMS reply or a Razorpay capture on an already-settled invoice returned 500, so the vendor redelivered | Low | Logged and answered 200; the payment is kept for reconciliation and audited | `gateway-security-test.mjs` |
| A client that disconnected mid-authentication kept its live-stream slot, locking the account out after four | Low | The subscriber is dropped when the response is already closed | `realtime.test.ts` |
| Officer (`gov_officer`) sign-ins were not alerted as privileged | Low | Added to the privileged set | `alerts.test.ts` |
| Android sign-out only cleared the phone; the session stayed valid on the server | Low | The app calls `POST /v1/auth/logout` | Emulator run |

Dependencies were updated within their ranges (Fastify 5.12.5, Drizzle ORM
0.45.3) and an unused direct dependency was removed. `npm audit` still
reports 4 moderate advisories, all in `drizzle-kit`'s development-only
`esbuild` chain, which never ships in the image. Passwords: the platform has
none — sign-in is a one-time code, stored as a SHA-256 hash.

**Closed since:** the web pages' refresh tokens left `localStorage`. A page
that sends `X-RA-Client: web-<page>` gets its refresh token as an HttpOnly
cookie on `Path=/v1/auth` (`SameSite=None; Secure; Partitioned` over HTTPS,
so the showcase's frames keep it; `SameSite=Lax` on local http), one cookie
per page so the three consoles stay separate sessions. Refresh and sign-out
read the cookie only with that header — a cross-site form cannot send it and
a cross-site fetch needs the CORS allow-list — and a cookie without it is
refused (403 `client_header_required`). The Android app and the test scripts
keep the JSON body token unchanged. A session stored before the change is
exchanged once and its stored token dropped (`session.js`). And the CSP no
longer allows `'unsafe-inline'` scripts: each inline `<script>` in the served
pages is allowed by its SHA-256 hash, computed from the files when the server
starts, and no page uses a handler attribute or `javascript:` URL. Verified by
`security-audit.mjs` §13, `refresh-cookie.test.ts` and
`security-headers.test.ts` (which fails if any served page's inline script is
not covered or a handler attribute appears).

**Still open, said plainly:** the access token (ten minutes) is in
`sessionStorage`, so a script that did get into a page could use it — or call
refresh itself — while the tab is open; the cookie only stops it carrying the
30-day token away. `style-src` keeps `'unsafe-inline'`: the pages set
`style=""` throughout, and injected CSS can restyle a page but not run code.
The hosted database still runs as its owner role. The least-privilege setup is
prepared and verified locally (`packages/db/sql/least-privilege-role.sql`, a
DML-only `roadassist_app` that cannot alter the audit log or its rules;
migrations keep the owner through `MIGRATION_DATABASE_URL`); applying it is an
owner action in Neon and Render that is still pending (DEPLOYMENT.md,
"Least-privilege database role").

## Known gaps

1. **No external penetration test.** 106 self-written attacks is not the same
   thing.
2. **Rate limiting is per-instance.** See above.
3. **No column-level encryption at rest in Postgres.** Medical data is protected
   by access control and audit, not by encryption in the database.
4. **No live payment gateway** has ever been exercised.
5. **No WAF, no DDoS protection** — those belong to infrastructure that is not
   provisioned.
6. **Location lookups send coarsened positions outside India** (Nominatim,
   Overpass, OSRM) wherever `GEO_SERVICES` is on. That is the default under
   `NODE_ENV=demo`, which is what the live demo and `docker-compose.demo.yml`
   run.
   See "Outbound calls for location services" above.
