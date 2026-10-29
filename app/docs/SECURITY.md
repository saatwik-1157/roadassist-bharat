# Security

Threat model: [`security/threat-model.md`](security/threat-model.md) — STRIDE,
20 threats mapped to controls.
Penetration suite: [`../scripts/security-audit.mjs`](../scripts/security-audit.mjs) —
**144 attacks, every one refused.**

Everything below has been executed. A control described here without a test
beside it says so.

---

## The one-line summary

`npm run test:security` fires 135 application-level attacks at a running server.
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

**In the code** (paths from `app/`, checked by `npm run citations`):

- The code is stored only as its hash: `apps/api/src/routes/auth.ts:102`.
- Both ceilings and the insert are one step under two advisory locks — per
  number at `apps/api/src/auth.ts:450`, per IP at `:451`.
- A guess spends an attempt **before** the compare, in one conditional UPDATE
  (`apps/api/src/routes/auth.ts:179`); the compare is constant-time
  (`apps/api/src/routes/auth.ts:188`), and the consume just below it is
  conditional, so two correct submissions cannot both get a session.
- Rotation is `rotateSession()` at `apps/api/src/auth.ts:165`. The claim is the
  conditional UPDATE at `apps/api/src/auth.ts:216`, so of two simultaneous
  presentations of one token exactly one wins; presenting a token that was
  already rotated burns the family at `apps/api/src/auth.ts:202`.

### Email sign-in for protected accounts

The hosted demo has no SMS gateway, so the phone code is shown on screen
(`EXPOSE_DEV_OTP`) — which on its own would let anyone who types the admin's
number become the admin. Email sign-in closes that for the accounts that matter
(`apps/api/src/domain/email-signin.ts`, `apps/api/src/routes/email-auth.ts`):

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
  slip under the cap; `apps/api/src/routes/email-auth.ts:123`), a constant-time hash compare, and a conditional consume
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

### Telegram alerts for emergency contacts

Free SOS alerts over the Telegram Bot API, off unless `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` are all set
(`apps/api/src/routes/telegram.ts`, rules in `apps/api/src/domain/telegram.ts`):

- **Consent is the contact's own act.** The user gets a one-time invite link
  per contact; nobody is messaged until that contact opens it and presses
  Start in their own chat, and `/stop` there unlinks it. Group chats are
  refused, so an emergency is never broadcast to a group.
- **Invite codes** are 144 random bits, stored only as a SHA-256 hash, valid
  7 days, and claimed by one conditional UPDATE (unused, unexpired, not
  withdrawn), so a replayed, expired or replaced code links nothing and two
  Starts cannot both win. A new invite withdraws the previous one; 20 invites
  an hour per account.
- **The webhook** believes only a request carrying our secret in
  `X-Telegram-Bot-Api-Secret-Token` (set through `setWebhook`), compared in
  constant time; anything else gets 401 before the body is read for a command.
- **What a message carries**: the user's first name (letters only, so a number
  typed as a name cannot leak) or "a RoadAssist user", the incident reference,
  the time and a map link. Never a phone number. The chat id never leaves the
  server: the contact list says only `telegramLinked`.
- **In the user's language.** The alert is written in the app language the
  app sends with the confirm (`lang` on `POST /v1/sos/:id/confirm`; the SMS
  path uses the language the account set with `LANG`), else English, and the
  bot's replies (`/start`, `/stop`, `/help`, a bad link) in the language the
  invite was made in (`telegram_link_codes.lang`, copied to the contact as
  `telegram_lang`). All eight app languages, machine-translated and not yet
  native-reviewed (`domain/telegram-i18n.ts`, `docs/translations/review-telegram.csv`).
  A missing translation falls back to English per message; an unknown `lang`
  is ignored, never refused. The structure is identical in every language:
  who, the reference, the IST time, the two map links, "automated demo alert;
  call 112" and `/stop`.
- **The SOS is never held hostage.** Sends run in parallel with a 4-second
  timeout per attempt, up to three attempts, and a 7-second budget; failures
  are logged (without the chat id or the token) and the answer's
  `contactsAlertedTelegram` counts only messages Telegram accepted. They share
  the per-owner `sosAlerts` ceiling with SMS.

**Verified by:** `telegram.test.ts` (hashing, expiry, single use, commands, the
secret compare, the configuration gate, retries, no token in an error, no phone
number in any message), `e2e-journey.mjs` §41 and `security-audit.mjs` §14
(no secret or a wrong one: 401; replayed, expired, withdrawn and group-chat
codes refused; `/stop` unlinks), both against a local stub of the Bot API —
never `api.telegram.org`. Telegram is outside India and receives the first name
and position in an alert: declared in `scripts/check-data-residency.mjs`.

### Sign in with Google

Off unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`
are all set; a partial set refuses to boot (`GOOGLE_ANDROID_CLIENT_ID` adds the
Android path). Routes: `apps/api/src/routes/google-auth.ts`. Rules, with no
database or network of their own: `apps/api/src/domain/google-signin.ts`.

**Threat model.** What we defend, against whom:

| Threat | Defence |
|---|---|
| **Login CSRF.** An attacker's own callback URL (their code, their state) is opened in the victim's browser, so the victim works in the attacker's account and their SOS data goes there. | The `state` is sealed in the browser's own cookie at `/start` and compared in constant time at `/callback`. A callback without that browser's cookie is refused. PKCE backs it: the code only redeems with the verifier sealed in the cookie of the browser that started the flow, and the nonce in the token must be the one sealed in that cookie. |
| **Code interception or replay.** The callback URL leaks through a log, history or Referer. | PKCE S256: the code is useless without the verifier, which never leaves the server and the sealed cookie. The code works once at Google. The nonce row is spent once. The callback's query is dropped from the access log (`urlForLog`). Every hop sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and the outcome goes in the fragment, which is never sent to a server. |
| **Forged or misaddressed ID token.** A token from another key, issuer or app, or one we did not request. | RS256 only (`none` and HS256 refused). The signature is checked against Google's JWKS, cached as long as its `Cache-Control` allows, with unknown `kid`s refetched at most every 30 s. `iss` must be Google. `aud` must be **our** web client. `azp` must be our client (on Android it must be present and name the Android client, so a web token is not an app token). `exp`/`iat`/`nbf` are checked with 60 s of skew. The `nonce` must be one this server issued for this purpose (and, for a link, this account). It is spent last, by one conditional UPDATE, so a forged token cannot burn a real nonce and two racing requests cannot both use one. |
| **Unverified address.** A Google account whose email Google has not verified. | `email_verified` must be true. The email is still never used to find an account. |
| **Account takeover by email.** A Google account with the same address as an existing account, including an `EMAIL_SIGNIN` one. | Accounts are keyed on `sub` only (`users.google_sub`, unique index). There is no lookup by email anywhere in the flow. An unknown `sub` always creates a **new** citizen account. |
| **Privilege escalation.** A Google identity reaching an admin, officer, mechanic, fleet, support or `EMAIL_SIGNIN` account. | `googleAccountRefusal`: a Google sign-in or link is refused (403 `privileged_account` / `email_signin_account`) for any account holding a role other than `citizen`, or whose number is in `EMAIL_SIGNIN`. This also covers an account that gained a role after Google was linked. Sign-up only ever grants `citizen`. |
| **Linking somebody else's account.** | Link needs the account's own session (Bearer) **and** a fresh Google token carrying a nonce issued to that account. The web hands that account id to `/start` only in a five-minute sealed cookie that the Bearer-authenticated `/v1/me/google/web-link` sets. A Google account already linked to another account that has a phone is refused (`google_in_use`). It may only move off an empty Google-only sign-up with no phone, which the same person has just proven by the token. That empty account is then closed and its sessions ended. |
| **Phone collision.** A Google sign-up "adds" a number that belongs to someone else's account. | The number must be proven by the ordinary OTP (same limits and attempt cap, consumed once). If it belongs to another account, the answer is 409 `phone_in_use` and **neither account changes**: no merge, no hand-over, no sign-in. The unique index on `users.msisdn` decides a race. The refusal comes only after the OTP is proven, so the route cannot be used to test which numbers are registered. To join the two, sign in with the number and use Link Google. |
| **Feature off, half-configured, or pointed at a stub.** | All or none at boot. `GOOGLE_API_BASE` (the test stub) is refused outside development, test and CI. The secret is never echoed in a configuration error, and `/health` shows the public client id, never the secret. |

**What is stored.** `users.google_sub` and `users.google_email`, nothing else
from Google: no name, photo, access token or refresh token. Only the ID token's
claims are read; the access token Google returns is discarded unused. Nonces
are kept only as SHA-256 hashes, for ten minutes, and removed a day later.

**What a phone-less account can do.** Everything except booking a mechanic
(409 `phone_required`): SOS, emergency contacts, medical details, vehicles,
reports and the map all work. **SOS is never gated.** It works signed out, so
it works here.

**The browser and residency.** No page loads Google script, iframe, font or
image. The button is a link to our own `/start`, and the visitor's browser
reaches `accounts.google.com` only by following our 302 after they click. The
CSP is unchanged. `scripts/check-data-residency.mjs` declares that host as a
click-through **navigation** (neither page egress nor server egress), declares
`oauth2.googleapis.com` and `www.googleapis.com` as server-side egress, and
fails the build if any page so much as names a Google sign-in host.

**Verified by:** `google-signin.test.ts` (configuration gate, RFC 7636 PKCE
vector, sealed cookies, JWKS cache, every token check including replay and
`email_verified`, privileged and `EMAIL_SIGNIN` refusals, phone collision, the
web page's fragment parser), `e2e-journey.mjs` §42 and `security-audit.mjs` §15
(planted callback, replayed callback, tampered cookie, token replay, invented
nonce, forged signature, wrong aud/iss/azp, expired, unverified, admin and
mechanic refused, email never the key, phone collision, link nonce bound to its
account, link cookie required, Google account in use), the browser suite §41
(the page loads nothing from Google; round trip, phone, Link Google, cancel),
and `GoogleSignInTest.kt` on Android. All of them run against a local stub of
Google (`scripts/google-stub.mjs`), never Google. The security cases were
proven by reverting their guards: with nonce single-use, signature, `aud`,
`iss`, `azp`, `email_verified`, the role and `EMAIL_SIGNIN` refusal, and the
phone-owner check removed, 11 of §15's cases fail. The planted callback is
refused by the state, PKCE and the nonce **each on its own**: with any one of
them in place the case still passes, and with all three removed the victim is
signed in to the attacker's account and the case fails.

### Deleting an account and unlinking Google

`POST /v1/me/delete` and `DELETE /v1/me/google` (`apps/api/src/routes/account.ts`,
rules in `apps/api/src/domain/account-deletion.ts`), on the web under Settings
-> Account and on Android under More.

- **Citizen accounts only.** Any other role (admin, mechanic, support, fleet,
  `gov_officer` for RAKSHA), an account with no role at all, and any number in
  `EMAIL_SIGNIN` are refused (`privileged_account`, `email_signin_account`)
  and keep the by-request path in privacy.html: they hold other people's work.
  On a deployment that shows the phone code on screen, a published demo number
  is refused too (`shared_demo_account`): everyone shares it.
- **A deliberate confirmation, two parts.** The body must carry the exact
  phrase `DELETE MY ACCOUNT` (else `confirmation_required`), and the sign-in
  must be **fresh**: the session's refresh-token family began less than 10
  minutes ago (else `reauth_required`). Freshness was chosen over an OTP
  re-verification because it works for every way a citizen signs in (a
  Google sign-up with no phone has no number to send a code to), costs no SMS
  and adds no second code path to rate-limit, and is measured from the
  family's FIRST session: a refresh mints a new session row in the same
  family, so a stolen refresh token, which rotates for 30 days, never makes a
  session fresh. Only signing in again does.
- **Nothing open.** A booking that is not `PAID` or `CANCELLED`
  (`active_booking`: a mechanic may be on the way or is owed) or an incident
  that is not `CANCELLED` or `RESOLVED` (`active_sos`) blocks it, checked again
  under the row lock.
- **One transaction, idempotent.** The user row is locked `FOR UPDATE`; a
  second delete waits, finds `deleted_at` set and changes nothing. Afterwards
  every session carries `revoked_reason = account_deleted`, so the old access
  token answers 401 `AUTH_REVOKED` (`reason: account_deleted`) and the refresh
  token 401 `account_deleted`, never "reuse detected". The session rows are
  kept (scrubbed of IP and user agent) precisely so a still-unexpired access
  token finds its sid refused. The audit entry `account.deleted` (subject id
  and row counts, no number or name) is written after the commit by the audit
  chain's own serial writer, as every route's is.

What happens to each table:

| | Tables | Why |
|---|---|---|
| **Deleted** | `emergency_contacts` (with `telegram_chat_id`), `telegram_link_codes`, `devices` (push tokens), `medical_profiles`, `notification_channels`, `google_auth_nonces`, `idempotency_keys`, `otp_challenges` for the number, `vehicle_documents`, `user_vehicles` | Personal data nobody else needs |
| **Scrubbed** | `users` (msisdn, full name, email, `google_sub`, `google_email` set NULL, so the phone and the Google account can sign up again as a NEW account; `deleted_at` set), `sessions` (revoked, IP and user agent NULL), `vehicles` only this account had (plate replaced with `DEL-<id>` so it can be registered again, nickname NULL), `bookings` (address, symptoms, highway marker, position NULL), `reviews` (comment NULL), `diagnostic_sessions` (detached, symptom text NULL), `sync_operations` (payload emptied), `incident_signals` (typed `note` and texted `text` removed) | The row is still needed; the personal part is not |
| **Detached** | `incidents` (`user_id`, `vehicle_id` NULL; status, times and position stay), citizen `raksha_detections` (`raw.reportedBy` removed) | SOS history is the record whoever responded relies on; a hazard report is public road data |
| **Kept** | `bookings`, `booking_events`, `invoices`, `payments`, review ratings, `consents`, `break_glass_access`, `sms_opt_outs`, `audit_log` | The mechanic's record of work and money and their score; proof that processing had a basis; who read the medical notes; a STOP keeps protecting the number; the audit log is append-only and hash-chained, so rewriting it would break the chain that proves nothing else was rewritten. They refer to the account by an id that no longer leads to a person. |

**Unlink Google** is allowed only when the account has a verified phone (else
409 `phone_required`, or the person could not sign in again), and the UPDATE is
conditional on that phone still being there.

**Verified by:** `account-deletion.test.ts` (phrase, roles, freshness, order of
refusals, unlink rule, plate), `e2e-journey.mjs` §44 (a real deletion: contacts
and Telegram links gone, Google link gone, the vehicle plate free again, the
incident detached, the old access and refresh tokens refused, the phone signing
up again as a NEW account that sees none of the old data, a bystander's data
untouched, a repeat changing nothing) and `security-audit.mjs` §16 (wrong
phrase, stale session, an admin and a mechanic refused, unlink without a phone
refused, another account's token cannot delete this one). The freshness check,
the phrase check, the role check, the session revocation and the unlink phone
check were each reverted in turn: each made at least one case fail.

## Authorization

Two independent layers, and the second is the one that matters.

1. **Role gates** — `requireRole("admin", "gov_officer")` and friends on every
   operator surface.
2. **Resource ownership**, checked *at the resource*. `bookingAudience()` is
   consulted on every booking read and write (the rule itself is one line,
   `apps/api/src/booking-access.ts:28`), so the read path is never more
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

**Collections are capped, and the cap is enforced.** zod keeps one issue per
failing array element (GHSA-mrhx-c7xc-m3w5). Measured against this API: a
1 MiB body of 524,000 failing elements cost 172 MB of heap on zod 3 and
301 MB on zod 4.6.7 when the array had no cap. With a `.max(n)` on the array,
4.6.6+ refuses the same body at the cap, with one issue, about 0 MB and 10 ms.
So zod is pinned at `^4.6.7`, every request array is capped, and
`scripts/check-bounded-collections.mjs` fails the build on any `z.array`,
`z.set` or `.array()` without `.max()` or `.length()`. Its unit test also
checks that zod still stops at the cap.

**XSS.** The API is a JSON service and stores what it is given, byte-identical;
escaping is the client's job and the browser suite asserts the DOM does it.
Responses are served as `application/json`, so a payload cannot execute in the
API origin.

## Rate limiting

Per-principal fixed windows on booking, payment, sync, offer-accept and stream
opening. A fixed window rather than a token bucket, because a bucket lets a
client save up an hour of allowance and spend it in one second.

**The emergency rule, which is a test and not a comment:**

- the SOS ceiling sits far above any human rate — 30 in five minutes
  (`LIMITS.sos`), applied to `POST /v1/sos` at
  `apps/api/src/routes/emergency.ts:65`;
- a double tap is absorbed by **idempotency**, not throttling;
- and `POST /v1/sos/:id/confirm` — the call that actually summons help — is
  **never rate limited at all**: its route carries `authenticate` and nothing
  else (`apps/api/src/routes/emergency.ts:390`).

Verified: ten genuine SOS in a row are all accepted; a booking flood is
throttled; every 429 carries `retryAfterSeconds` so a client can back off
correctly.

**Limitation.** This state is in-process. Behind N instances the effective
ceiling is N×. Redis is already in `docker-compose.yml` for exactly this.

## Payment verification

The client never decides that money arrived.

- The amount is **never** taken from the request — it is the invoice total, and
  the webhook refuses a captured amount that does not match
  (`apps/api/src/routes/payments.ts:431`).
- Settlement requires an HMAC-SHA256 signature the server recomputes over the
  raw body (`apps/api/src/routes/payments.ts:386`), compared in constant time
  three lines below.
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
`"UNSIGNED INTAKE — … Development only."` (`apps/api/src/routes/telecom.ts:289`).
Production cannot reach that state; `assertProductionSafe()` refuses to boot
without the secret. *(This was a real
finding: the code comment claimed the state was "flagged" and it was not.)*

## Audit trail

`audit_log` is a **hash chain**: each entry hashes its own content together with
its predecessor's hash, so editing or deleting any historical row invalidates
every hash after it — detectable without trusting the database it lives in.
The hash is `digest()` at `apps/api/src/audit.ts:60`.

Postgres `RULES` block `UPDATE` and `DELETE` on the table outright
(`packages/db/src/migrate.ts:179`, the delete rule three lines below). The
chain is re-verified **live** by `/v1/ops/overview` through
`verifyAuditChain()`, and again on any restored backup —
during this audit it verified intact across all 639 entries on a restore.

Audited actions: `auth.login`, `sos.created`, `sos.cancelled`, `sos.escalated`,
`sos.resolved`, `sos.offgrid_synced`, `dispatch.started`,
`dispatch.provider_offered`, `dispatch.provider_accepted`,
`dispatch.provider_rejected`, `dispatch.escalated`, `booking.status_changed`,
`payment.webhook.captured`, `sync.completed`, `medical.break_glass_read`,
`mechanic.on_duty` / `off_duty`, `telegram.invite_created`, `telegram.linked`,
`telegram.unlinked`.

## Sensitive data

**Break-glass medical access** requires all of: the `admin` or `gov_officer`
role, an incident that is **currently live**, and a written reason of 10–300
characters. It writes a `break_glass_access` row and the subject is told it
happened. There is no route to it for any other role. The role gate and the
reason's length sit at the top of the route; the live-incident check is
`apps/api/src/server.ts:1908`.

**Logging.** A log aggregator is not a place to build a movement history of
somebody who called for help, so no log line carries a position, a phone
number or a client address (`apps/api/src/logging.ts`,
`apps/api/src/domain/log-redaction.ts`):

- **The access log** records the method, the path and the host. Not the IP or
  port, and not the query string: only allow-listed keys that are never
  personal (`link`, `limit`, `type`, `source`, `overdueOnly`, `radiusKm`,
  `detail`) are kept, and the URL ends in `[redacted]` when anything was
  dropped. Before this, every `/v1/map/live?lat=..&lng=..`, `/v1/geo/*` and
  break-glass `?reason=` was logged in full beside the caller's address. Map
  tiles (`/tiles/z/x/y`, `/basemap/z/x/y`) are logged by zoom only, since x/y
  name the square somebody was looking at; the tile-failure line likewise.
- **Errors** are serialized as type, scrubbed message and stack, and code:
  never a driver's `query` / `parameters`, and Drizzle's `params: ...` line in
  a failed query's message is replaced. Outside development the console copy
  of an unhandled error is the scrubbed message only.
- **Every line, from any call site** (ours or Fastify's), passes a formatter
  that replaces personal field names at any depth (lat/lng and the route's
  `fromLat`..., msisdn/phone, Telegram chat ids, Google sub and email, ID
  tokens, nonces, tokens, cookies, passwords, IPs, full names) and scrubs every
  string, the message included: phone numbers to their last four digits,
  emails masked, coordinates, IPv4 addresses to their /24, bearer tokens, JWTs
  and bot tokens.
- **A coarse address only where it earns its place**: the rate limiter's
  "limit exceeded" line, which is what an abuse report starts from, logs the
  principal as an account id, an address truncated to its /24 (IPv4) or /48
  (IPv6), or a sending number cut to its last four digits. A truncated prefix
  rather than a daily-salted hash because the action an investigation leads to
  is blocking a range at the edge, which a hash cannot express; it needs no
  secret to keep or rotate, and a /24 is shared by up to 256 addresses (on
  Indian mobile networks, by a carrier NAT pool), so it does not single out a
  person.
- `observability.ts` still redacts, at any depth, the wider list for operation
  logs (tokens, OTP codes, signatures, API keys, phone numbers, email
  addresses, coordinates, medical fields, symptoms and notes).

Pinned by `logging.test.ts`: a Fastify instance with the server's exact logger
configuration is sent a request carrying coordinates, a phone number and an
email from a public address, and a failing query with bound values; none of
them appears in any line. With the old serializer put back (full URL,
`remoteAddress`), the test fails. Sessions (`sessions.ip`) and the audit log
still store the full address in the database, for the session list and the
audit trail; that is storage with access control, not a log stream.

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
without one (`apps/api/src/env.ts:423`) — reflecting the caller's `Origin` is
functionally "any website may call this API with your users' credentials". Verified: an allowed origin is
reflected, any other gets no allow-origin header.

`TRUST_PROXY` is **off by default and never inferred**. Trusting every hop lets
any client forge `X-Forwarded-For` and walk through the per-IP OTP ceiling; the
server logs a warning if it is set to `true`. The prepared (not live) India VM
in `deploy/oci-india` has no Cloudflare in front, so it does the opposite of
Render: `CLIENT_IP_HEADER` is empty, `TRUST_PROXY` names only Caddy's fixed
address on the compose network, and Caddy overwrites `X-Forwarded-For` and
strips `CF-Connecting-IP`, `X-Real-IP` and `True-Client-IP` from callers.

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
region is the production answer, and is not built. An India-region option for
the platform and its database is prepared but **not yet live**
([`deploy/oci-india`](../../deploy/oci-india/README.md)); moving to it would end
the "already in Singapore" premise, and this exception would then need its own
justification or the coarsened look-ups turned off.

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
| With the OTP echoed on the hosted demo, **any** number — including a privileged one — could be signed into | High | Outside local environments an echoed or fixed code is accepted only for the published demo numbers, and never for a privileged role (`apps/api/src/domain/demo-numbers.ts:135`) | `demo-numbers.test.ts`; live: a non-demo number is refused |
| The inbound-SMS webhook with no secret accepted any number on the hosted demo, so a stranger could act as a real phone | High | 503 `webhook_not_configured` except for demo numbers; a set secret is required of everyone; limited per sending number (`apps/api/src/domain/webhook-intake.ts:60`) | `webhook-intake.test.ts`, `gateway-security-test.mjs` |
| `/v1/notify/email` would send an operator-written message to any address | High | Plain text only, and only to the platform's own alert and sign-in recipients — else 403 `recipient_not_allowed` | `e2e-journey.mjs` §25 |
| Behind Cloudflare, the client address came from `X-Forwarded-For`, which the caller writes — every per-IP limit could be dodged | High | `CLIENT_IP_HEADER=cf-connecting-ip`: the address the edge saw, used only when it is a valid IP, and the socket peer (never `X-Forwarded-For`) when it is absent (`client-ip.ts`); the access log's `ipHeaders` shows which header arrives, as booleans and a count | `route-limits.test.ts`, `client-ip.test.ts` |
| No security headers | Medium | CSP (`object-src 'none'`, `frame-ancestors` limited to the showcase, `base-uri`/`form-action 'self'`, inline scripts by hash only), nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS over HTTPS; `no-store` on the API (CSP built at `apps/api/src/security-headers.ts:89`) | `security-headers.test.ts`, `e2e-journey.mjs` §25 |
| No sign-out on the server — a stolen refresh token outlived "sign out" | Medium | `POST /v1/auth/logout` revokes the whole session family; its access tokens are refused as `AUTH_REVOKED` | `security-audit.mjs` (9 checks) |
| A repeated SOS confirm re-texted every emergency contact | Medium | Confirm is idempotent per incident — a compare-and-swap into RESPONDING, `apps/api/src/routes/emergency.ts:442`; at most 10 alert batches an hour per account (the escalation itself is never limited); at most 5 contacts, each number once | Contacts: `e2e-journey.mjs` §25. Confirm idempotency and the alert cap: a manual probe (10 simultaneous confirms, one send) — **not yet in a counted suite** |
| The generic transition route let a non-admin issue `mechanic.accept` and other system commands | Medium | 409 `command_not_allowed`; only the customer or an admin may cancel | `e2e-journey.mjs` §25 |
| Another user's idempotency key replayed *their* booking | Medium | 409 `idempotency_key_in_use` | `e2e-journey.mjs` §25 |
| The tile proxies would fetch any tile, anywhere, unlimited | Low | Only tiles that exist, over the region, 1,200 a minute | `route-limits.test.ts` |
| A foreign `vehicleId` could be attached to an SOS or a diagnosis | Low | Dropped, and the response says so | Manual probe — **not yet in a counted suite** |
| The console SMS log printed full numbers and live sign-in codes on the hosted demo | Low | Masked outside development (`+91******3210`, `••••••`); the same for the console email provider | `log-redaction.test.ts` |
| Weak or default JWT secret accepted outside development; the local demo compose shipped a fixed one | Low | Refused below 32 characters; the demo generates a random one per boot | `jwt-secret.test.ts` |
| Database connections to a remote host did not require TLS | Low | `ssl: "require"` unless the URL says otherwise or the host is local | `database-tls.test.ts` |
| Pages: `innerHTML` with server strings, CSV formula injection, a token left in the map URL | Low | Escaped, neutralised, cleared | Code review; the browser suite still passes |
| Android: map WebView could navigate anywhere and its bridge answered any page; app data was backed up | Low | Origin allow-list for navigation, bridge and geolocation; file access off; `allowBackup=false` | `MapWebGuardTest.kt` |
| A device-supplied `imageRef` was joined onto the upload folder unchecked: the photo route could read, and an officer's reject could delete, a file outside it | High | Any path that resolves outside `UPLOAD_DIR` is refused (`apps/api/src/domain/upload-path.ts:22`) | `upload-path.test.ts`, `security-audit.mjs` §12 |
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
Since 5 Oct 2026 the hosted API connects as the least-privilege role
(`packages/db/sql/least-privilege-role.sql`: a DML-only `roadassist_app` that
cannot alter the audit log or its rules), and migrations alone run as the
owner through `MIGRATION_DATABASE_URL`, which `docker-start.sh` drops after the
migrate step (DEPLOYMENT.md, "Least-privilege database role"). Checked on the
live database: `pg_stat_activity` shows the running service connected as
`roadassist_app`.

## Known gaps

1. **No external penetration test.** 144 self-written attacks is not the same
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
7. **Telegram alerts, when turned on, send a first name and a position to
   Telegram**, outside India. Off unless the three `TELEGRAM_*` variables are
   set; see "Telegram alerts for emergency contacts" above.
8. **Google sign-in, when turned on, is Google's account system.** The
   visitor's browser goes to Google's sign-in page (outside India) when they
   press the button, and the server fetches Google's token endpoint and keys.
   A Google account compromised at Google is a compromised citizen account
   here. That is why Google can never reach a privileged account. Off unless
   the `GOOGLE_*` variables are set; see "Sign in with Google" above.
