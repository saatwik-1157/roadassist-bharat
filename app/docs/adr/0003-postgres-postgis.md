# ADR-0003 — PostgreSQL with PostGIS as the single operational database

**Status:** Accepted · 2026-08-04 · Owner: P1 (Saatwik)

## Context

The domain is transactional (bookings, invoices, state transitions) and heavily
geospatial (nearest-mechanic dispatch, service zones, highway markers). Telemetry
is a high-volume time series with different access patterns.

## Options considered

1. **PostgreSQL + PostGIS for everything.** One engine, one operational burden.
2. **PostgreSQL + a document store for telemetry.** Better fit for telemetry, but a
   second engine to run, back up and monitor.
3. **A document database as primary.** Loses the constraints that keep money and
   booking state correct.

## Decision

Option 1 for Review 1 and Review 2. Telemetry lives in a normal table now; it moves
to a time-partitioned hypertable when volume justifies it, which is a migration
rather than a new database.

## Consequences

- Real referential integrity, `CHECK` constraints and transactions on the paths where
  correctness is not negotiable.
- `GIST` indexes on geography columns make "nearest available mechanic" a sub-50 ms
  query rather than an application-side scan.
- One backup and restore procedure, one failover story, one thing to explain.
- We accept that telemetry at national scale will eventually need partitioning; the
  column layout is already designed for it.
