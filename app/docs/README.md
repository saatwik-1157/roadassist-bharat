# Documentation index

Every document here describes what the code **currently** does. Where something
is designed rather than built, it is labelled `TARGET` or `DESIGN` in the
document itself — never left to be inferred.

## Start here

| Document | What it answers |
|---|---|
| [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) | What RoadAssist is, in one page |
| [`architecture/README.md`](architecture/README.md) | C4 diagrams, events, degraded modes, API style guide |
| [`architecture/failure-matrix.md`](architecture/failure-matrix.md) | 20 failure modes, each naming the suite that proves it |

## Building and running

| Document | What it answers |
|---|---|
| [`../README.md`](../README.md) | Quick start, scope, feature status |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Deploy, configure, back up, roll back — and exactly what external accounts are still needed |
| [`TESTING.md`](TESTING.md) | Seven suites, what each proves, and what is deliberately not covered |

## The two things this project is actually about

| Document | What it answers |
|---|---|
| [`OFFLINE.md`](OFFLINE.md) | Off-Grid Mode: capability matrix, the three tiers, storage, retention, sync journal |
| [`SECURITY.md`](SECURITY.md) | Every control, the 74 attacks, the findings and the known gaps |

## Course and submission

| Document | What it answers |
|---|---|
| [`SWE4004-MAPPING.md`](SWE4004-MAPPING.md) | Module 1–6 mapping and a 21-row cloud-concept audit, each marked IMPLEMENTED / PARTIAL / DESIGN |
| [`VIVA.md`](VIVA.md) | 56 questions with answers grounded in the code |
| [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) | 10-minute demo, every step with a backup that does not fake success |
| [`CLAIMS-AUDIT.md`](CLAIMS-AUDIT.md) | Every material claim checked against the code that backs it |
| [`ATTACK-PACK.md`](ATTACK-PACK.md) | The 30/60-second answers, marks-loss analysis, and the five questions most likely to hurt |
| [`SUBMISSION.md`](SUBMISSION.md) | Final checklist and what remains |

## Decision records

Ten ADRs in [`adr/`](adr/). The four that matter most:

- [ADR-0004](adr/0004-offline-conflict-rules.md) — offline conflict rules,
  decided before any sync code was written
- [ADR-0005](adr/0005-emergency-isolation.md) — the emergency path is isolated
  and a model can never dispatch
- [ADR-0009](adr/0009-offgrid-mode.md) — Off-Grid Mode
- [ADR-0010](adr/0010-realtime-and-concurrency.md) — SSE, and one job assigned
  exactly once

## Screenshots

[`screenshots/`](screenshots/) — 15 PNGs captured from the **running**
application by `node scripts/capture-screens.mjs`. They are regenerable in
ninety seconds, and the capture script asserts what is on screen before it
presses the shutter, so it cannot silently photograph an error state.
