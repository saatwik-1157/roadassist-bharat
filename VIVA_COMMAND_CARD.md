# Viva command card

**PROJECT:** An AI-assisted, cloud-connected roadside assistance platform for India whose emergency path keeps working when the network does not.

**CLOUD:** SaaS provider to three user classes and consumer through adapters; dispatch is dynamic scheduling over a pooled resource — consumed, not operated, and nothing is deployed.

**AI:** A deterministic rule table labelled `rules-1.0.0` in every response, with a separately trained YOLO11n for road damage — a remote model may make a verdict stricter, never laxer.

**DISPATCH:** PostGIS nearest-neighbour with off-duty and busy providers excluded in SQL, then scored proximity 60% / rating 34% / newcomer bonus, offered in waves of five with a 90-second timeout that escalates.

**OFFLINE:** Connectivity is measured, not assumed; GPS, diagnosis, cached tiles and a local encrypted incident work — dispatch, tracking, ETA and payment do not, and the app names which.

**SOS:** Creates an incident and reports every escalation rung as fact; off-grid it says *"nothing has been transmitted"* and advises calling 112, because it genuinely cannot reach emergency services without a network.

**SECURITY:** OTP with per-number and per-IP ceilings, refresh rotation with reuse detected as theft, ownership checks on every resource, and 100 attacks across two suites that all fail.

**DATABASE:** PostgreSQL 16 + PostGIS — 57 tables, 62 foreign keys, money in integer paise, and an append-only hash-chained audit log the database itself refuses to let you edit.

**PAYMENT:** The client never decides money arrived — the amount is the server-computed invoice total, the signature is recomputed server-side, and a booking cannot be marked paid without a settled payment.

**LIMITATION:** Single instance — the SSE registry, rate limiter and offer sweeper are in-process, and that is exactly what a second instance would break.

**FUTURE:** Redis-backed rate limiting, an outbox→event bus for SSE fan-out, and WAL archiving — those three are what stand between this and horizontal scale.

---

**Answer formula:** direct answer → RoadAssist example → technical evidence → limitation → future improvement.
**Never** answer beyond the implementation. *"Designed and not provisioned"* costs nothing.
