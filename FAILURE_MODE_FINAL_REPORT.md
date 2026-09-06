> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work.

# Failure-mode verification

| Failure | Expected behaviour | Actual behaviour | Verdict |
|---|---|---|---|
| Internet unavailable | Offline mode | Tier leaves ONLINE; red rule and banner; local diagnosis, local SOS, cached tiles; "Nothing has been transmitted" | **PASS** (demo beat 12) |
| Backend unavailable | Graceful error / local handling | Service worker serves the cached shell; each asset cached independently so one 404 cannot leave the app with no shell; SOS degrades to the off-grid path rather than hanging | **PASS** (`sw.js`, `fireSos`) |
| Database unavailable | Graceful failure | `/health` → **503** `{"database":"down"}` with no credentials in the body; `/v1/ping` still **200**; recovery is automatic with no API restart | **PASS** (chaos test) |
| GPS unavailable | Clear location state | Falls back to an approximate position and *says so*: "responders get an approximate position only". Never fabricated silently | **PASS** (`locate()`) |
| Mechanic unavailable | Retry / escalation | Wave escalates on a timer; exhausted → `NO_SUPPLY` with a named reason and a widen-radius action | **PASS** (e2e §7) |
| Sync failure | Retry without duplication | Stays queued, retries with fully jittered backoff; unique client key prevents a duplicate | **PASS** (demo beat 13) |
| Payment failure | No false success | Error surfaced; booking stays COMPLETED; nothing marked PAID | **PASS** (gateway) |
| Duplicate payment | Idempotent | Replay does not charge twice | **PASS** (gateway) |
| Duplicate SOS | Idempotent / safe | Three simultaneous taps → one incident | **PASS** (concurrency §4) |
| Real-time disconnect | Reconnect / fallback | 25 s heartbeat; polling continues underneath at 6 s without a stream | **PASS** |
| AI unavailable | Safe fallback | Timeout, network error or bad payload → rules result with `usedFallback: true`, `modelVersion: "rules-1.0.0"`. A model may make a verdict **stricter, never laxer** | **PASS** (`providers.ts`; e2e asserts `usedFallback === true`) |
| Maps unavailable | Graceful fallback | Leaflet and tiles are bundled locally and precached; `MAPS_PROVIDER=local` needs no account, so there is no third party to fail | **PASS** |
| Invalid authorization | Denied | 403 with `requestId`, no internals | **PASS** (security suite) |

## The two failure modes worth demonstrating live

**Database down.** Stop PostgreSQL and refresh: `/health` turns 503 and names
the database as the cause, while `/v1/ping` keeps answering 200 — the process
is alive, its dependency is not, and the readiness gate can tell them apart.
Start PostgreSQL again and it recovers on its own.

**Network down.** The whole off-grid path. This is the project's argument.

## The failure mode that is not handled

**A second instance.** The SSE registry, the rate limiter and the offer sweeper
are in-process. Replicas would each keep their own rate ceiling and their own
connected clients. This is a known architectural limit, documented at each
definition, not a bug — and it is why the deployment section says single
instance rather than "scales horizontally".
