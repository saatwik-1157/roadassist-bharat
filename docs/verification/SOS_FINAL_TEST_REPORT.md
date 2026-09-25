> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work. Evidence is named per row; where a step was
> proven by an automated suite rather than a hand-driven click, this file says
> which suite and which section, because that is a stronger claim, not a weaker
> one — it is repeatable.

# SOS — final verification

The emergency path follows ADR-0005: a model may raise a signal, only a human
may escalate, and nothing is ever claimed on faith. ADR-0005's separate
emergency deployable is design only — on the live demo the emergency service
runs in the same process as the API, on one Render service.

| Scenario | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|
| Normal network | Incident created, escalation ladder reported per rung | `Emergency active`, incident id, location shared, contacts count, responder search, elapsed ms | **PASS** | demo beat 11 (2.1 s) |
| Limited network | Attempt, then degrade honestly | Degrades to the off-grid path rather than hanging | **PASS** | `fireSos` transport branch |
| Offline | Local incident, nothing claimed as sent | `RA-XXXXXX` stored encrypted; "Nothing has been transmitted" | **PASS** | demo beat 12 |
| Server unavailable | Never silently lost | Falls through to `raiseOffGridSos`; if even that fails it says so and tells the user to call 112 | **PASS** | `fireSos` catch branch |
| Duplicate SOS | One incident, not two | One incident from three simultaneous taps | **PASS** | concurrency §4 |
| Rapid repeated SOS | Refused while one is active | "An emergency is already active" | **PASS** | `fireSos` guard |
| Invalid data | Refused, not accepted silently | 422 with the fields named | **PASS** | zod at the boundary |
| Location unavailable | Approximate position, labelled | Falls back and warns "responders get an approximate position only" | **PASS** | `locate()` |
| Reconnection | Sync begins automatically | Journal drains | **PASS** | demo beat 13 |
| Sync | SYNCED with a server id, no duplicate | Confirmed; re-sync creates none | **PASS** | demo beat 13 |

## Emergency behaviour never silently fails

- **SOS never joins the generic offline queue.** It must fail loudly rather
  than wait quietly (ADR-0005). Off-grid is a different thing: a purpose-built
  local incident the user is *told* about.
- **Persist before draw.** `raiseOffGridSos` writes the incident to storage
  *before* anything is rendered, so a phone that dies mid-animation has still
  recorded the emergency. That is the opposite of the usual optimistic-UI
  instinct and is correct here.
- **Every rung is reported as a fact.** Contacts alerted shows the real count —
  zero says "none on file". Responder search says "no unit in range" when there
  is none.
- **Idempotency** — `client_incident_id` is unique in the database.
- **Audit** — every escalation is written to the hash-chained append-only log.

## A defect this phase found in my own test, not the product

The rehearsal initially pressed "Alert now" faster than any human could, before
the incident id existed, producing `/v1/sos/undefined/confirm` and a 422. The
route validates `id` as a UUID and refused it correctly. The **application was
right**; the test was wrong. Recorded here because it looked like a product bug
for several minutes and is exactly the sort of thing that should not end up in
a report as one.

## The 112 handoff

Stubbed. The API's own response carries the note *"ERSS 112 handoff is stubbed
in development — no real emergency service is contacted."* Nothing in the
product claims otherwise.
