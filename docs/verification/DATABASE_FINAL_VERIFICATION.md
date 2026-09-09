> Generated 2026-09-06 by executing the release candidate, not by reading it.
> Base commit `f771df5` on `main`, plus 41 modified and 59 untracked files that
> are **not yet committed**. Every number below came from a run on that state.
> Where something was not measured, this file says so instead of estimating.

# Database final verification

PostgreSQL 16.4 + PostGIS 3.4 (`USE_GEOS=1 USE_PROJ=1 USE_STATS=1`), database
`roadassist_rc`, created empty for this verification.

## Structure

| Property | Count |
|---|---|
| Tables | 57 |
| Primary keys | 57 (every table) |
| Foreign keys | 62 |
| Check constraints | 433 |
| Indexes | 138 |
| — of which GiST (PostGIS) | 5 |
| — of which UNIQUE | 84 |
| Migrations applied | 5 (latest `0004_offgrid_incident`) |
| Append-only rules on `audit_log` | 2 (`DO INSTEAD NOTHING` for UPDATE and DELETE) |

Unique indexes carrying the idempotency guarantees include
`idempotency_key_uq`, `bookings_reference_uq` and the per-device `op_id`
constraint from `0002_per_device_op_id`.

## Consistency queries — all zero

Run against the freshly seeded database:

| Check | Result |
|---|---|
| Bookings in an accepted state with no mechanic | 0 |
| Bookings orphaned from their user | 0 |
| Bookings orphaned from their vehicle | 0 |
| Invoices orphaned from their booking | 0 |
| Payments orphaned from their invoice | 0 |
| Duplicate invoice numbers | 0 |
| Duplicate booking references | 0 |
| Incidents orphaned from their user | 0 |
| Duplicate sync `op_id` | 0 |
| **PAID bookings with no settled payment** | **0** |

## A defect this phase found and fixed

The last row above returned **1,789** when this phase started.

The seeder marked bookings `PAID` while creating **no invoices and no payments
at all**. The API refuses exactly that transition — `payment.settled` returns
409 `payment_required` unless a settled payment covers the invoice
(`server.ts:1141`), and `test:gateway` asserts it. So the seeded data
contradicted the platform's own rule, and anyone who ran one join would have
found 1,789 paid jobs with no money behind them.

This is the same class as the 874 impossible-state bookings fixed in an earlier
phase: **the seeder was wrong, not the application.**

`packages/db/src/seed.ts` now mirrors what the API does — an invoice is raised
when a job completes (labour + 18% GST, the same figures `server.ts` uses), and
a PAID booking additionally carries a settled payment for the full amount.
After reseeding: 4,076 invoices, 1,789 settled payments, **0 amount
mismatches**, and 2,287 COMPLETED bookings correctly holding an invoice with no
payment — which is exactly what "payment pending" means on screen.

Full suite re-run against the corrected data: 578 passed, 0 failed.

## Not verified

Backup **scheduling**. The restore procedure itself was rehearsed and measured
in an earlier phase (dump 1.2 s / 750 KB, restore 7.2 s, audit hash chain
re-verified intact across 639 entries), but no automated schedule is
configured, so the real RPO today is "whenever somebody runs the command".
