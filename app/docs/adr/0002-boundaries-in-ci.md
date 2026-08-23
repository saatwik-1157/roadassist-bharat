# ADR-0002 — Module boundaries are enforced by CI, not by convention

**Status:** Accepted · 2026-08-04 · Owner: P4 (Parthavi)

## Context

ADR-0001 depends entirely on the boundaries holding. Every team that has tried to
keep a monolith modular by asking people nicely has failed, usually in the last
two weeks before a deadline when someone imports across a boundary to save an hour.

## Decision

Boundaries are a **build gate**. `scripts/check-boundaries.mjs` runs in CI and fails
the pull request if:

- a schema module imports a module it has not declared a dependency on, or
- anything outside `packages/db` imports a schema file directly instead of the
  package root.

The allowed dependency graph is acyclic and declared in one place:

```
_shared  ←  identity  ←  fleet  ←  service  ←  ops
```

## Consequences

- The dependency direction is a fact, not an intention, and it is checkable in the
  review by running one command.
- Adding a legitimate dependency is a deliberate act: edit `ALLOWED`, and the diff
  shows a reviewer that the architecture changed.
- A cycle becomes impossible to introduce accidentally.
