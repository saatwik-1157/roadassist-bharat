# ADR-0006 — Every AI capability ships rules-first, behind a stable contract

**Status:** Accepted · 2026-08-04 · Owner: P3 (Jignesh) + P1 (Saatwik)

## Context

We have no proprietary training data at project start. If the product waits for
models, the product does not exist for two reviews. If the product depends on
models, a bad model becomes an outage.

## Decision

Every AI capability is defined as an endpoint with a fixed request and response
envelope, and is **implemented with deterministic rules first**. Models replace the
rules behind the unchanged contract, one capability at a time.

```
POST /ai/v1/{capability}
  → { result, confidence, modelVersion, fallbackUsed, latencyMs }
```

Each capability registers a deterministic fallback. The caller wraps every AI call
in a timeout and a circuit breaker; on timeout, error, or a confidence below
threshold, the fallback runs and `fallbackUsed` is set.

## Consequences

- AI is never on the critical path for correctness. Killing the AI service leaves a
  working product — a demonstrable claim, and a test we run deliberately.
- The rules are not throwaway scaffolding; they are the permanent production fallback
  and get the same test coverage as the models.
- The rules also define the baseline each model must beat, which is recorded before
  training starts.
- Safety asymmetry is explicit: a model may *downgrade* a drivability verdict to
  unsafe, never upgrade one to safe.
