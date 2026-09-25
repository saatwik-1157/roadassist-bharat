> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work.

# Concurrency — final verification

`npm run test:concurrency` — **75 assertions, 75 passed, 0 failed** (measured
2026-09-12, `app/docs/measured.json`), executed against the running API and a
real PostgreSQL. This suite exists to test what a
sequential suite structurally cannot.

| Scenario | Expected | Result |
|---|---|---|
| Two mechanics accept the same job simultaneously (`Promise.all`) | Exactly one wins | **PASS** — one assignment, one clean refusal |
| **Ten** simultaneous accepts | Exactly one wins | **PASS** — one winner, nine refusals |
| Expired offer accepted | Refused, not honoured | **PASS** |
| Three SOS taps at once | One incident | **PASS** |
| Concurrent off-grid syncs | De-duplicated | **PASS** |
| Two commands on one booking at once | Only one applies | **PASS** |
| Duplicate payment confirmation | Charged once | **PASS** (gateway) |
| Duplicate webhook | Idempotent | **PASS** (gateway) |
| Repeated completion | Second refused | **PASS** — guarded UPDATE |
| Rate limits under burst | Bound abuse, spare the emergency path | **PASS** |
| Provider pool released | No provider left occupied | **PASS** — 9 bookings created, 0 still holding |

## How the guarantee is actually made

- **Assignment** — `SELECT … FOR UPDATE` on the *booking* row, with the offer's
  expiry checked **inside** the transaction. An earlier version read the status
  outside it, and two mechanics could both win. That was a real bug, found by
  this suite, and fixed.
- **Transitions** — guarded `UPDATE … WHERE status = <the state the decision
  was computed from>`. If the row moved underneath, the update matches nothing
  and the command loses.
- **Duplicate SOS** — `onConflictDoNothing` plus read-the-winner. An earlier
  read-then-insert raced the unique index and returned 500 for three
  simultaneous taps.
- **Offline sync** — `client_incident_id` and per-device `op_id` are unique in
  the database, so a retry after a lost response converges on the row that
  already exists.
- **Payment** — settlement is recorded, never asserted; `payment.settled` is
  refused unless a settled payment covers the invoice.

Every one of these is a database-level guarantee, not an application-level
convention. That distinction is the point: an in-process lock would not survive
the second instance this design is heading toward.
