> Line numbers re-verified 2026-09-12. Open the file — do not describe it.
>
> These move. Lifting the auth and emergency routes out of `server.ts` shifted
> every citation below them and put two of them past the end of the file, which
> a reader only discovers by opening one in front of an examiner. Re-derive them
> after any refactor — grep for the route or the function, not the line.

# Code-to-viva map

| Topic | File | Function / entry | What it does | What to say |
|---|---|---|---|---|
| Authentication | `apps/api/src/auth.ts:131` | `authenticate()` | Verifies the bearer token, attaches `req.user` | "OTP issues a short-lived access token and a rotating refresh token; reuse is treated as theft." |
| Authorization | `apps/api/src/booking-access.ts:17` | `bookingAudience()` | Customer, assigned mechanic, or admin — nobody else | "Ownership is checked on the resource, not inferred from the route." |
| RBAC | `packages/db/src/schema/identity.ts` | `roles`, `role_permissions`, `user_roles` | Role-to-permission mapping | "Permissions come through roles. A citizen cannot register an edge device — 403." |
| Incident creation | `apps/api/src/server.ts:641` | `POST /v1/bookings` | Validates, persists, audits, then dispatches | "Validated by zod, persisted, audited, then dispatch starts — in that order." |
| AI | `apps/api/src/server.ts:615` → `domain/ai-rules.ts` | `POST /v1/diagnose` | Deterministic rule table | "It returns `rules-1.0.0`. I won't call it AI." |
| AI fallback | `apps/api/src/providers.ts:196` | model branch | Rules win when a model is unconfident or fails | "A model may make a verdict stricter, never laxer." |
| Severity | `domain/ai-rules.ts` | rule table | Severity 1–5 and driveability | "One to five, because that is what the code returns." |
| Dispatch | `apps/api/src/dispatch.ts:77` | `findCandidates()` | PostGIS KNN with exclusions **in SQL** | "Off-duty and busy providers are excluded in the query, not filtered afterwards." |
| Concurrency | `apps/api/src/server.ts:945` | `SELECT … FOR UPDATE` inside `db.transaction` | Serialises acceptance on the booking row | "Ten simultaneous accepts: one winner, nine clean refusals." |
| SOS | `apps/api/src/routes/emergency.ts:47` | `POST /v1/sos` | Creates the incident, runs the ladder | "Every rung is reported as fact — contacts alerted shows the real number." |
| Offline queue | `apps/web/offline-store.js` | `createIncident`, `journalOperation` | Encrypted IndexedDB + sync journal | "AES-GCM-256 under a non-extractable key." |
| Sync | `apps/api/src/routes/emergency.ts:363` | `POST /v1/sos/offline-sync` | Idempotent intake keyed on `client_incident_id` | "A retry after a lost response converges on the incident that exists." |
| Realtime | `apps/api/src/realtime.ts:140` | `openStream()` | SSE registry, heartbeat, per-user cap | "Persist first, publish second. Polling continues underneath." |
| Payment | `apps/api/src/routes/payments.ts:125` | `POST /v1/bookings/:id/pay` | Amount is the invoice total | "The client never sends the amount." |
| Webhook | `apps/api/src/routes/payments.ts:374` | `POST /v1/webhooks/razorpay` | Recomputes the signature server-side | "A forged signature settles nothing — 402." |
| Payment guard | `apps/api/src/server.ts:1036` | transition check | Refuses PAID without settlement | "409 `payment_required`." |
| Audit | `apps/api/src/audit.ts:107` / `:148` | `audit()` / `verifyAuditChain()` | Hash-chained append-only log | "Each entry carries the previous digest; Postgres RULES make UPDATE and DELETE no-ops." |
| Database schema | `packages/db/src/schema/` | 6 modules | 56 tables | "Money is integer paise. A unit test enforces it." |
| Monitoring | `apps/api/src/server.ts:360` + `observability.ts` | `/health`, `/v1/ops/overview` | Readiness, live counts, chain verification | "Health separates application from database — that is the readiness gate." |
| Config guard | `apps/api/src/env.ts:347` | `assertProductionSafe()` | Refuses eight unsafe production settings | "Production will not boot on a development secret or a mock gateway." |
| Boundaries | `app/scripts/check-boundaries.mjs` | — | Fails CI on a cross-module import | "Enforced, not agreed." |
