# ADR-0007 — RAKSHA is a schema module inside the monolith, not a second system

Status: Accepted · 2026-08-23 · Owner: platform

## Context

RAKSHA (Autonomous Remote Road & Infrastructure Safety Intelligence) adds
edge devices that detect road damage autonomously and sync it to the platform.
The temptation is a separate service with its own database. ADR-0001 allows
exactly one separate deployable — emergency (ADR-0005) — and that exception is
justified by a 99.99% availability target RAKSHA does not have.

## Decision

RAKSHA lives inside the modular monolith as a fifth schema module, `raksha`,
with a declared edge in the boundary checker:

```
_shared ← identity ← fleet ← service ← ops
_shared ← identity ← service ← raksha
```

- Tables: `edge_devices`, `road_segments`, `raksha_detections`,
  `edge_device_telemetry`, `road_health_scores` — all carrying the universal
  columns. (`devices` was already taken by user phone devices, hence
  `edge_devices`.)
- Ingestion is idempotent on a device-generated `op_id`, mirroring the
  `sync_operations` contract (ADR-0004): replaying a batch yields `duplicate`,
  never a second row.
- A high-severity obstruction raises an **incident signal** into the existing
  `incidents` flow — AWAITING_CONFIRMATION, human-gated. RAKSHA can never
  dispatch anything (ADR-0005 applies unchanged).
- Detection inference ships rules-first behind the ADR-0006 envelope; the MVP
  detector is a SIMULATED deterministic generator (`sim-rules-0.1.0`) and every
  inference is logged to `model_predictions` by hash.
- Degraded-mode row: RAKSHA ingestion down → every existing journey unaffected.

## Consequences

One database, one deployable, one CI pipeline; the boundary fitness function
and schema-convention tests extend to RAKSHA automatically. LineString
geometry enters the schema for the first time (road segments) — SRID pinning
for it joins the existing list in `migrate.ts`.
