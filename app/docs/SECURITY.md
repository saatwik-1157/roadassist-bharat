# Security

Threat model: [`security/threat-model.md`](security/threat-model.md) — STRIDE,
20 threats mapped to controls.
Penetration suite: [`../scripts/security-audit.mjs`](../scripts/security-audit.mjs) —
**74 attacks, every one refused.**

Everything below has been executed. A control described here without a test
beside it says so.

---

## The one-line summary

`npm run test:security` fires 74 application-level attacks at a running server.
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

**Tested (22 assertions, local stub of Razorpay's API):** forged signature,
replayed delivery, wrong amount, wrong order, unconfigured secret — each fails
closed. **Never run against a real account.**

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

## Known gaps

1. **No external penetration test.** 74 self-written attacks is not the same
   thing.
2. **Rate limiting is per-instance.** See above.
3. **No column-level encryption at rest in Postgres.** Medical data is protected
   by access control and audit, not by encryption in the database.
4. **No live payment gateway** has ever been exercised.
5. **No WAF, no DDoS protection** — those belong to infrastructure that is not
   provisioned.
