# ADR-0001 — Modular monolith, not microservices

**Status:** Accepted · 2026-08-04 · Owner: P1 (Saatwik)

## Context

The architecture slide shows twelve services. A four-person team presenting in
eighteen weeks has to *operate* whatever it builds — every independently deployed
service adds a pipeline, a dashboard, an alert route and a failure mode.

## Options considered

1. **Twelve independently deployed microservices.** Matches the diagram literally.
   Costs twelve deploy pipelines and a service mesh we cannot staff.
2. **Single application, no internal boundaries.** Cheapest to run, but the module
   boundaries in the design would erode within weeks and the Module 4 architectures
   would become untrue.
3. **Modular monolith with enforced boundaries, split-ready.** One deployable, twelve
   modules with hard import rules, each owning its own schema.

## Decision

Option 3, with one exception: **the emergency service is a separate deployable**
(ADR-0005). Modules communicate through explicit interfaces and never reach into
each other's tables.

## Consequences

- One pipeline, one dashboard, one on-call rotation — operable by four people.
- The Module 4 architectures still hold: pods scale horizontally, the load balancer
  distributes across replicas, and the database replicates across zones.
- Splitting a module later is a deployment change, not a rewrite, **because**
  boundaries are enforced in CI (`scripts/check-boundaries.mjs`).
- We must be honest in the review: this is one deployable with twelve modules, not
  twelve running services. Claiming otherwise fails the first follow-up question.
