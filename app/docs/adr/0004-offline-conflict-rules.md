# ADR-0004 — Offline conflict rules are decided before any sync code is written

**Status:** Accepted · 2026-08-04 · Owner: P1 (Saatwik) + P2 (Nirisha)

## Context

Offline-first is the project's differentiator and its largest technical risk. Two
devices can edit the same booking while both are disconnected. If we discover the
rules while implementing, we will encode whichever behaviour was easiest.

## Decision

The resolution rule for every synced field is decided **now** and lives in
`docs/architecture/README.md`. The governing principle:

> **Booking state is always server-authoritative.** A client can request a
> transition; it can never assert one. Everything else resolves per field.

| Entity | Field class | Rule | Why |
|---|---|---|---|
| `bookings` | `status` | **Server wins** | State machine integrity is not negotiable |
| `bookings` | notes, photos | Merge (union) | Additive; losing either is worse than keeping both |
| `bookings` | `scheduled_at` | Last-write-wins by hybrid clock | Simple, and the user sees the result |
| `vehicles` | profile fields | Per-field last-write-wins | Independent fields must not clobber each other |
| `vehicles` | `odometer_km` | **Max wins** | Odometers only increase; max is always correct |
| `users` | emergency contacts | **User decides** | Too important to guess |
| `incidents` | anything | **Server wins** | Life-safety; the server has the fullest picture |

## Consequences

- `sync_operations.op_id` is a client-generated idempotency key, so replay is safe.
- Every resolution is written to `conflict_log` with the rule that fired, which makes
  a wrong rule findable after the fact instead of invisible.
- Anything genuinely ambiguous is surfaced to the user rather than guessed.
- Clock skew cannot corrupt ordering: we compare hybrid logical clocks, not wall time.
