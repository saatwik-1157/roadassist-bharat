# ADR-0010 — Real-time over SSE, and one job is assigned exactly once

**Status:** Accepted · 2026-09-06 · Owner: P1 (Saatwik) + P4 (Parthavi)

## Context

Two problems, found by looking rather than by guessing.

**1. A real race.** `POST /v1/offers/:offerId/accept` read the offer's status,
checked it was `SENT`, and *then* opened a transaction to write the assignment.
Two requests arriving in the same millisecond both read `SENT`, both passed the
check, and both wrote `bookings.mechanic_id` — last writer wins. Both mechanics
were told they had the job. One of them drives to a customer expecting somebody
else, and the platform has no record that anything went wrong.

Expiry had the same shape: the mechanic's inbox filtered out offers past
`expires_at`, but the accept handler never checked it. Hiding a button is not a
rule. A replayed request, a stale tab or a direct API call could accept an offer
whose window closed twenty minutes ago and take a job from whoever accepted it
legitimately.

**2. Nothing was pushed.** The customer's screen polled every six seconds; the
mechanic's console polled every eight and only redrew when they touched it. So
"the customer cancelled while I was driving" reached the mechanic whenever they
next happened to look, and a dispatch offer with a 90-second life could sit
unseen for a tenth of it.

## Decision

### 1. The decision is made under a row lock, not before one

Accept now opens a transaction, takes `SELECT … FOR UPDATE` on the **booking**
row, and re-reads the offer under that lock. The status read outside the
transaction survives only as a courtesy — it produces a fast, friendly 409 in
the ordinary case and is not trusted for anything.

Locking the *booking* rather than the *offer* is the part that matters. Every
accept for a job — whichever of its five offers it names — queues on that one
row, so the second request reads the first request's committed result instead of
the state it started from. Locking each offer row would have serialised nothing
across different offers, which is exactly the case that was broken.

Under the lock, four things are checked in order, and each has its own error
code so the loser knows what happened: the offer is still `SENT`; its
`expires_at` has not passed (and if it has, it is marked `EXPIRED` rather than
merely refused, so the ladder can move on); the booking has no `mechanic_id`
yet; and the state machine permits `mechanic.accept` from the **locked**
status — a booking cancelled a moment ago must not be assignable.

Concurrent transitions were already correct (a guarded `UPDATE … WHERE
status = <expected>`) and are unchanged.

### 2. Real-time is SSE, and it is an accelerator, not a source of truth

Every flow here is server→client. The client's writes already have a REST
surface carrying authentication, validation, idempotency and audit, and
duplicating those over a socket would be a second, weaker way in. So: one
long-lived `GET /v1/events` per client.

SSE over WebSockets because it is ordinary HTTP — it survives the corporate
proxies and mobile middleboxes that break upgrades, adds no dependency, no port
and no protocol, and reconnects on its own. On a platform whose thesis is
working on bad networks, "it is just HTTP" is the feature.

**Read with `fetch` and a stream reader, not `EventSource`.** `EventSource`
cannot set headers, so it forces the access token into the query string, where
it lands in every access log, proxy log and `Referer`. A few extra lines on the
client keep it in an `Authorization` header. The same reasoning already governs
how `map.html` receives its token.

**Persist first, publish second — always.** An event is a notification that
something already happened, never the thing itself. Every `publish` call sits
after the write it describes.

**Delivery is at-most-once and in-process, and that is written down at the
definition.** There is no replay buffer and no cross-instance bus, so a client
disconnected at the moment of an event does not receive it. This is acceptable
only because the stream is never the sole path: booking state is
server-authoritative (ADR-0004), the client refetches on reconnect, and polling
continues underneath at a slower cadence (60 s instead of 6 s for the customer,
45 s instead of 8 s for the mechanic). Behind more than one API instance this
needs the `outbox_events` → Redpanda bus already in the architecture.

### 3. Rate limits shaped around the emergency path

Per-principal fixed windows on booking, payment, sync, offer-accept and stream
opening. A fixed window rather than a token bucket: a bucket lets a client save
up an hour of allowance and spend it in one second, which is the traffic shape
being defended against.

The emergency rule is explicit and is a test, not a comment:

- the SOS ceiling (30 per 5 minutes) is far above any plausible human rate;
- a double tap is absorbed by **idempotency**, not by throttling — `POST
  /v1/sos` now accepts an optional `clientIncidentId` and converges on the
  incident it already created;
- and `POST /v1/sos/:id/confirm`, the call that actually summons help, is never
  limited at all.

State is in-process, so behind N instances the effective ceiling is N× the
number. Documented at the definition; the fix is the Redis already in
`docker-compose.yml`. The OTP ceilings are deliberately **not** built on this —
they count rows in Postgres and are correct across instances, because credential
stuffing is the one attack where a per-instance ceiling is worth nothing.

## Consequences

- `incidents.client_incident_id` now serves both the off-grid path (ADR-0009)
  and online double-tap protection. One unique index, two duplicate classes.
- Concurrent replays of an SOS used to return **500** — three taps arriving
  together all read "no such reference", all inserted, and two hit the unique
  index. A person double-tapping SOS getting a server error is the worst
  possible place for that failure, so the insert is now
  `onConflictDoNothing` and the loser reads the winner's row.
- `POST /v1/sync/operations` resolves conflicts instead of journalling blindly:
  a stale booking status is refused, written to `conflict_log` with the rule
  that fired (`server_wins`, per ADR-0004), and the device is handed the
  authoritative value in the same response.
- Audit coverage extended to `auth.login`, `sos.created`, `sos.cancelled`,
  `sos.escalated`, `dispatch.started`, `dispatch.provider_accepted`,
  `dispatch.provider_rejected_race`, `booking.status_changed` and
  `sync.completed`. No secret, token or phone number is written to the chain.
- `scripts/concurrency-test.mjs` exists because none of this is provable
  sequentially. It runs in CI, twice — the second pass against an API booted
  with `OFFER_TTL_SECONDS=2`, which is the only way to reach the expiry branch
  without waiting 90 seconds.
- The compiled build was fixed as a side effect: static roots were resolved
  relative to `src/`, so `npm run build` produced a server that started and
  served nothing. They are found by walking up for a known directory now, and
  the full e2e suite passes against `dist/`.

## What this ADR does not do

- **No cross-instance fan-out.** One API instance. Named above, and in
  `realtime.ts`.
- **No provider GPS.** Live mechanic *position* is not streamed, because the
  platform has no live position to stream — mechanics report a last known
  location, and inventing motion between reports would be exactly the
  fabrication ADR-0009 refuses.
- **No chaos testing of a database outage.** Reasoned in
  `docs/architecture/failure-matrix.md` row 4, and listed there as not covered.
