# ADR-0005 — The emergency path is isolated and the model can never dispatch

**Status:** Accepted · 2026-08-04 · Owner: P1 (Saatwik) + P4 (Parthavi)

## Context

Every other feature can fail for ten minutes and cost money. The emergency path
failing costs something else. It also carries the opposite risk: a false positive
sending a real ambulance to a speed breaker.

## Decision

Two rules, both structural rather than procedural.

**1. Isolation.** Emergency is the one exception to ADR-0001. It gets its own
deployable, its own database connection pool, its own SMS vendor quota and its own
alert channel, spread across three availability zones. It also has a **degraded
path** that shares no runtime dependency with the main platform: if every other
service is scaled to zero, an SOS over SMS still reaches a responder.

**2. The model raises a signal; a human confirms an incident.** On-device crash
detection writes an `incident_signals` row and opens a 30-second cancellable
countdown. Escalation to a public emergency service requires either explicit user
confirmation or a documented two-signal corroboration policy. This is enforced in
code — `incidents.confirmed_by` must be non-null before a 112 handoff — not in a
policy document.

## Consequences

- We can demonstrate the claim: scale the platform to zero, trigger an SOS, it works.
  A chaos test proves it rather than a slide asserting it.
- Emergency is exempt from spot instances and aggressive downscaling. It costs more,
  deliberately.
- If the measured false-positive rate over ≥200 real driving hours misses target,
  crash detection **ships disabled by default** and manual SOS carries the feature.
  Pre-committing this removes the judgement call under demo-day pressure.
