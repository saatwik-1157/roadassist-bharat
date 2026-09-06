# Failure-mode matrix

**Status:** Owner P4 (Parthavi) · reviewed by P1 · last verified 2026-09-06

Every row is a failure that will happen in production, with four columns that
have to be answerable: **how it is detected**, **what the user sees**, **what
happens to their data**, and **how it recovers**. The final column names the
suite that proves the row, so this document ages with the code rather than
drifting away from it.

Where a row says *not covered*, that is a statement of fact, not an omission
that was hoped nobody would notice.

| # | Failure | Detected by | User experience | Data preservation | Recovery | Proven by |
|---|---|---|---|---|---|---|
| 1 | **Internet disconnected** | `navigator.onLine`, `/v1/ping` failure, transport errors from `api()` | Indicator turns red and reads **Off-grid**; a banner says what still works; SOS, local diagnosis, GPS and cached maps remain usable | Off-grid incidents and journal entries written to IndexedDB, encrypted, in one transaction | Automatic on reconnect | `ui-journey.mjs` §7b |
| 2 | **Internet restored** | `online` event + a successful probe | "Connection restored" → "Synchronizing emergency information…" → "SOS synchronized" | Nothing discarded; entries only leave the journal on a server acknowledgement | Automatic, immediate | `ui-journey.mjs` §7b, §7c |
| 3 | **Backend unreachable, network up** | `/v1/ping` fails while `navigator.onLine` is true | Tier **LIMITED**, then **OFF-GRID** after repeated failures — distinct from "no network" | Requests that fail are queued or stored; none are lost | Probe cadence tightens to 6 s; recovers automatically | `offline-engine.test.ts` (classifier), `concurrency-test.mjs` §8 |
| 4 | **Database unavailable** | `/health` returns **503** with `database: "down"`; `/v1/ping` still returns 200 | Requests return a `500 internal` envelope with a request id — an error, never an infinite spinner | No client-side loss — the journal keeps unsent work | **Automatic.** Verified by stopping the Postgres container: `/health` 503 → restart → 200 and queries served again, with no API restart | **Verified manually** (`docker stop ra-db`, this audit). Production suppression of the SQL `detail` verified against the container with `NODE_ENV=production`. Still not automated in CI |
| 5 | **No provider in range** | Dispatch finds zero candidates | Booking moves to `NO_SUPPLY` with "Widen the radius to try again" | Booking preserved; nothing half-created | The customer re-dispatches with a larger radius | `e2e-journey.mjs` §6 |
| 6 | **Provider rejects** | Offer marked `DECLINED` | The next-ranked mechanic is offered | Booking untouched | Ladder continues | `e2e-journey.mjs` §6 |
| 7 | **Provider does not respond** | `expires_at` passes | Offer disappears from the mechanic's inbox and cannot be accepted | Booking untouched | Ladder continues; a late accept is refused `409 offer_expired` | `concurrency-test.mjs` §3 (run with `OFFER_TTL_SECONDS=2`) |
| 8 | **GPS unavailable or denied** | Geolocation error code | The incident says **"Unknown — denied"**; no coordinate is invented | Incident stored without a location rather than with a false one | Retried on the next fix | `ui-journey.mjs` §7b, `app.html` `locate()` |
| 9 | **Payment fails** | Gateway error or a failed signature check | Invoice stays unpaid; booking does not move to `PAID` | Booking and invoice intact | The customer retries checkout | `e2e-journey.mjs` §9, `razorpay-test.mjs` |
| 10 | **Payment webhook delivered twice** | `payments.status` already `SETTLED` | No visible effect | Nothing double-settled — the update is conditional on `PENDING` | Idempotent by construction | `razorpay-test.mjs` |
| 11 | **Duplicate SOS** | Unique `incidents.client_incident_id` | The replay returns the incident that already exists | One incident, never two | Idempotent; the loser of the race reads the winner's row | `concurrency-test.mjs` §4 |
| 12 | **Sync fails** | Non-2xx or transport error during a flush | "Sync retry pending — N still waiting"; the incident stays visible | Never deleted. Past the automatic retry ceiling the entry remains for a manual "Sync now" | Exponential backoff with full jitter | `ui-journey.mjs` §7b, `offline-engine.test.ts` (backoff) |
| 13 | **Access token expired** | `401` on any call | Nothing visible — one refresh, then the call is replayed | Session preserved; concurrent 401s share one refresh so the family is not burned | Automatic | `e2e-journey.mjs` §2, `ui-journey.mjs` §5 |
| 14 | **Unauthorised resource access** | Ownership checks on every handler | `403 forbidden` | No data disclosed; the live stream is per-user and leaks nothing | N/A — this is the intended outcome | `e2e-journey.mjs` §11, `concurrency-test.mjs` §9 |
| 15 | **Two providers accept simultaneously** | `SELECT … FOR UPDATE` on the booking row inside the transaction | One is assigned; the other is told "Another mechanic has already accepted this job" | Exactly one `mechanic_id`; no partial assignment | The loser returns to their inbox | `concurrency-test.mjs` §1, §2 |
| 16 | **Two commands on one booking at once** | Guarded `UPDATE … WHERE status = <expected>` | One applies; the other gets `409 conflict` with "Reload and retry" | State machine never skips a state | The client refetches | `concurrency-test.mjs` §6 |
| 17 | **Stale client state after a long offline spell** | Server compares the asserted status with its own | The device is handed the authoritative value in the same response | `conflict_log` records the rule that fired | The client applies the server's value | `e2e-journey.mjs` §11b |
| 18 | **Request flood / abuse** | Per-principal fixed-window limiter | `429` with `retryAfterSeconds` | Nothing lost | The client backs off using the value returned | `concurrency-test.mjs` §7 |
| 19 | **Live stream drops** | Reader ends or the fetch throws | The mechanic console's badge flips **Live → Polling**; the customer app returns to its 6 s poll | No loss — the stream is an accelerator, never the source of truth | Reconnects with jittered backoff | `ui-journey.mjs` §7c |
| 20 | **Browser without IndexedDB / WebCrypto** | Feature detection at boot | The off-grid screen says storage is unavailable, or that payloads are **not** encrypted and why | No silent downgrade | N/A — the limitation is stated | `offline-store.js` `encryption()`, `renderOffGrid()` |

## Not covered, and why

- **Database outage under load.** Row 4 is now verified *manually* — the
  Postgres container was stopped, `/health` returned 503 with `database: "down"`
  while `/v1/ping` still returned 200, in-flight requests returned a safe 500
  envelope with a request id, and the API recovered on its own when the database
  came back with no restart. What is still missing is doing it **under load**
  and **in CI**: a chaos step against the compose stack.
- **Multi-instance behaviour.** The rate limiter and the SSE registry are both
  in-process. Behind N instances the effective rate ceiling is N× and a client
  only receives events published by the instance it is connected to. Both are
  documented at their definitions; the fix is Redis for the first and the
  already-planned `outbox_events` → Redpanda bus for the second.
- **Real SMS, real payments, real 112.** All three are adapter-gated and run
  against local implementations by default. `assertProductionSafe()` refuses to
  boot production on the mock payment provider.
