> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work.

# Real-time — final verification

## What the transport actually is

**Server-sent events, not WebSockets.** One-directional server → client over
plain HTTP, at `GET /v1/events`. Stated here because the distinction is exactly
the sort of thing a viva asks about.

Delivery is **persist-first, publish-second**, and **polling continues
underneath** — the stream is an accelerator, never the source of truth. With
the stream alive the client's fallback poll is 60 s; without it, 6 s.

| Check | Result | Evidence |
|---|---|---|
| SSE connect → first frame | 5.2 ms p50, 10.0 ms p95 | `npm run perf` |
| Assignment reaches the console live | **PASS** — badge reads **Live** | demo beat 7 |
| Status change reaches the customer untouched | **PASS** — COMPLETED in 0.8–1.4 s | demo beat 8 |
| Four rapid transitions all land | **PASS** | demo beat 8 |
| Per-user stream isolation | **PASS** — one user's stream and incidents stay their own | concurrency §9 |
| Stream cap per user | **PASS** — `MAX_STREAMS_PER_USER = 4` | `realtime.ts` |
| No stream leak | **PASS** — 20 opened → 0 remaining | earlier chaos check |
| Reconnect / stale connection | **PASS** — 25 s heartbeat; poll floor continues regardless | `realtime.ts` |
| Duplicate events | **PASS** — render only on a real change; re-render is idempotent | `pollBooking` |

## Two real defects found here and fixed

The two-window rehearsal found both. The 163-assertion browser suite could not:
it drives a **single tab** and reaches the payment screen by *loading* it, which
goes through `refreshBooking()`. The broken path only runs when a customer
screen and a mechanic console are open at once — which is what a demo does.

**1. Dropped events under rapid transitions.** Every SSE booking event calls
`pollBooking()`, which returned early whenever a poll was already in flight. A
mechanic tapping through four states seconds apart had the last event routinely
discarded, with nothing to reschedule it. With the stream alive the fallback
tick is 60 s, so the customer could watch the job sit at IN_PROGRESS for a full
minute after it was finished. Fixed with a `pollAgain` flag that honours a
mid-flight request once the current one completes.

**2. Command chips lost on the live path.** The permitted commands travel in
`meta.nextCommands`. `refreshBooking()` copied them onto the booking as
`_next`; `pollBooking()` did not — so every live redraw rendered an empty
command list and **the Pay button never appeared**. Both paths now agree.

Before: beat 8 failed on 2 of 3 runs. After: 9 of 9 runs pass, reaching
COMPLETED in 0.8–1.4 s.

## Known limitation

The SSE registry is **in-process**. Replicas would each hold their own set of
connected clients, so a second instance needs the outbox → Redis/Redpanda bus
already in the architecture. Documented at the definition, not discovered later.
