> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work.

# Security final verification

Two suites, **100 assertions**, every one an attack that must fail:
`npm run test:security` (74) and `npm run test:gateway` (26). Both re-run
against the final build: **74 passed / 0 failed**, **26 passed / 0 failed**.

The full control-by-control write-up lives in `app/docs/SECURITY.md` and is
current; this file records what was *executed* in this phase.

| Area | Verified | Result |
|---|---|---|
| Authentication | OTP request/verify, per-number and per-IP ceilings | **PASS** |
| Refresh rotation | Rotation, and reuse detected as theft | **PASS** (e2e §2) |
| Expired / invalid tokens | Refused with `requestId`, no stack | **PASS** |
| Authorization | `bookingAudience()` — customer, assigned mechanic, or admin | **PASS** |
| RBAC | `roles` / `role_permissions`; citizen cannot register a device (403) | **PASS** (e2e §14) |
| Resource ownership | 12 cross-tenant attempts between Customer A/B and Mechanic A/B | **PASS**, all refused (e2e §11) |
| Modified resource IDs | Another user's booking/incident by UUID | **PASS**, 403 |
| Role escalation | Citizen → admin routes | **PASS**, refused |
| Rate limiting | Per-principal fixed window; emergency path spared | **PASS** (concurrency §7) |
| Input validation | zod at every boundary; malformed JSON → 400 not 500 | **PASS** |
| SQL injection | Parameterised throughout (Drizzle); injection strings stored as data | **PASS** |
| XSS | Output escaped (`esc()`); no `innerHTML` of user text unescaped | **PASS** |
| Secret exposure | `/health` carries no credentials or connection string | **PASS** |
| Error leakage | Uniform `{error:{code,title,retryable}}`; no internals | **PASS** |
| Medical data | Restricted; access recorded | **PASS** (e2e §21) |
| Break-glass | Emergency access logged to `break_glass_access` | **PASS** (e2e §21) |
| Audit log | Hash-chained; `UPDATE`/`DELETE` silently change nothing (Postgres RULES) | **PASS** (gateway) |
| Payment signature | Forged signature settles nothing (402) | **PASS** |
| Webhook verification | Unsigned rejected, wrong signature rejected, correct accepted | **PASS** |
| Duplicate payment | Replaying the confirmation does not charge twice | **PASS** |

## Cross-access matrix — all refused

| Actor | Target | Result |
|---|---|---|
| Customer A | Customer B's booking / incident / invoice / medical profile | 403 |
| Customer A | Any mechanic-only command (`arrive`, `work.complete`) | refused |
| Mechanic A | Mechanic B's assigned job | 403 |
| Mechanic A | Customer-only commands (`cancel`, `payment.settled`) | refused |
| Citizen | Admin routes (`/v1/admin/audit`, device registration) | 403 |

## Fixed this release

`TRUST_PROXY` hop counts are refused at startup. Fastify ≤ 5.12.0 decided how
much of `X-Forwarded-For` to believe by counting hops without checking who sent
the header (GHSA-3m5p-2c4r-xxw2) — so a client reaching the port directly could
pad the header and defeat the per-IP OTP ceiling. A numeric value is now
rejected outright rather than coerced to `true`; silently widening a narrow
setting into "trust everybody" is the failure the option exists to prevent.

Dependencies: fastify 5.11.2 → 5.12.3, `fast-uri` 3.1.5 → 3.1.7 (four
transitive SSRF/host-confusion advisories). **Runtime dependencies report 0
vulnerabilities.** Five dev-only advisories remain and are accepted — see
`FINAL_REPOSITORY_STATUS.md`.

## Not done, and not claimed

**No independent penetration test.** 100 self-written attacks is a different
thing from an adversary who did not write the code, and this project does not
pretend otherwise.
