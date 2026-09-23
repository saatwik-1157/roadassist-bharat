# ADR-0011 — An unconfirmed incident has a review deadline, and it escalates attention rather than responders

**Status:** Accepted · 2026-09-23 · Owner: platform

## Context

[ADR-0005](0005-emergency-isolation.md) settles the dangerous half of the
question: a model raises a *signal*, a human confirms an *incident*, and there is
no path from `AWAITING_CONFIRMATION` to `RESPONDING` that skips a person. That
rule is right and is not being relaxed. A false positive that dispatches a real
ambulance to a speed breaker is worse than a false negative that asks.

It leaves the mirror failure unanswered, and the state machine could not express
it. `AWAITING_CONFIRMATION` offers exactly two commands, `confirm` and `cancel`,
and both need a human:

```
AWAITING_CONFIRMATION: { confirm: "CONFIRMED", cancel: "CANCELLED" }
```

So a RAKSHA signal raised at 3am on an empty corridor waits. If nobody is
watching the dashboard, it waits until somebody happens to look — with no bound,
no record that it was ignored, and nothing anywhere that says it is being
ignored. "A model never dispatches" was enforced in code; "a human always comes"
was not enforced at all, and was not even measured.

This was found by reading the transition table, not by a test failing. Nothing
failed, because nothing asked.

## Decision

**An unconfirmed incident has a review deadline derived from its severity, and
breaching it changes what the platform shows, never what the platform does.**

Three parts:

1. **A review window per severity**, in `domain/incident-review.ts`:
   CRITICAL 5 minutes, HIGH 15, MEDIUM 60, LOW 240. These are review targets,
   not response targets. They are not derived from field data, because there is
   none — this is an undeployed student project, and saying so is cheaper than
   implying a study.

2. **"Overdue" is derived, never stored.** No new status, no new transition, no
   migration. An overdue incident has not changed; our obligation to look at it
   has. Deriving it is what keeps ADR-0005 true *by construction*: there is
   still no command that moves an incident without a human, so nothing added
   here can dispatch anyone even by mistake.

3. **`GET /v1/raksha/incidents/review-queue`** (admin and gov_officer only)
   surfaces what is waiting, ordered most-neglected first, with the overdue
   count in the response meta. Ordering puts *overdue* ahead of *serious*: a
   HIGH ignored for fifty minutes outranks a CRITICAL raised ten seconds ago,
   because the queue exists to surface what has been forgotten, not to re-rank
   by seriousness. Severity breaks ties and nothing more.

## Alternatives rejected

**Auto-confirm after a timeout.** This is the obvious reading of "escalate", and
it is exactly the thing ADR-0005 exists to forbid. It would let a model dispatch
by waiting, which is worse than letting it dispatch outright, because the
mechanism is invisible.

**A new `OVERDUE` status.** It would need a migration, a sixth stage in
`PUBLIC_STAGE`, and two new transitions — and it would encode the passage of time
as a property of the emergency rather than of our response to it. A stored flag
also goes stale the moment a sweeper misses a tick; a derived one cannot.

**A background sweeper writing rows.** More moving parts, a scheduler this
project does not otherwise have, and a second source of truth for a fact that
is a subtraction of two timestamps.

## Consequences

- An ignored emergency signal is now visible and countable rather than silent.
  On a seeded database the queue immediately surfaced two CRITICAL signals left
  unconfirmed by a test run, thirty-six minutes past their deadline.
- The numbers are demonstrable: `assessReview` is pure, so the behaviour is
  tested without waiting five minutes for a CRITICAL to breach.
- ADR-0005 gains a test that asserts it is *not* weakened here — the allowed
  commands from `AWAITING_CONFIRMATION` are still exactly `confirm` and `cancel`.
- The windows are a judgement, not a measurement, and are labelled as such. If
  this were ever deployed they would be the first thing to revisit against real
  operator response times.
- Nothing pages anybody. There is no alerting infrastructure in this project and
  adding a queue does not pretend otherwise; the queue has to be looked at.
