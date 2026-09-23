# Documentation index

Fifty-six files live under `docs/`, and until this index existed the root README
linked six of them. The rest were reachable only by knowing the filename.

**The first thing to know is which kind of document you are reading**, because
two kinds live here and they age differently.

| | |
|---|---|
| **Living** | Kept current. If it disagrees with the code, the document is wrong and should be fixed. The planning set below, plus everything in [`app/docs/`](../app/docs/). |
| **Dated evidence** | A record of what was true for one build, usually v1.0.0-RC1. It is **not** updated when the code moves on — rewriting it would falsify the record. `docs/release/`, `docs/verification/`, and the claim-check files under `docs/demo/`. |

So: a figure in `docs/release/` that disagrees with today's code is not
necessarily a bug. A figure in `app/docs/TESTING.md` that disagrees with today's
code *is*. When a number changes, correct the living documents and annotate the
dated ones — [`app/docs/CLAIMS-AUDIT.md`](../app/docs/CLAIMS-AUDIT.md) §4 is the
worked example.

---

## Start here

| Document | For |
|---|---|
| [`../README.md`](../README.md) | What the platform is, what exists today, what is roadmap |
| [`../ENGINEERING-NOTES.md`](../ENGINEERING-NOTES.md) | How to run and change this repo — toolchain traps, migration rules, the honesty rules |
| [`../app/docs/PROJECT_OVERVIEW.md`](../app/docs/PROJECT_OVERVIEW.md) | The system in one read |
| [`../app/docs/adr/`](../app/docs/adr/) | Eleven ADRs. Every non-obvious decision, with the alternative that was rejected |

## Reference — kept current

| Document | Contents |
|---|---|
| [`../app/docs/TESTING.md`](../app/docs/TESTING.md) | Every suite, what only each can prove, what is deliberately not covered, localisation coverage |
| [`../app/docs/DEPLOYMENT.md`](../app/docs/DEPLOYMENT.md) | Production stack, secrets, HTTPS, backup and restore |
| [`../app/docs/SECURITY.md`](../app/docs/SECURITY.md) · [`security/threat-model.md`](../app/docs/security/threat-model.md) | Threats, and what answers each |
| [`../app/docs/OFFLINE.md`](../app/docs/OFFLINE.md) | Off-Grid Mode end to end (ADR-0009) |
| [`../app/docs/CLAIMS-AUDIT.md`](../app/docs/CLAIMS-AUDIT.md) | **Every claim checked against the code.** Read before writing a slide |
| [`PROJECT-STRUCTURE.md`](PROJECT-STRUCTURE.md) | Directory-by-directory map |

## Planning — the 18-phase roadmap

| Document | Contents |
|---|---|
| [`00-team-charter.md`](00-team-charter.md) | RACI, rituals, git/PR rules, Definition of Done, risk register |
| [`01-master-roadmap.md`](01-master-roadmap.md) | All 18 phases, target architecture, business model |
| [`02-backend-lead-roadmap.md`](02-backend-lead-roadmap.md) | Schema, APIs, state machines, dispatch, auth |
| [`03-frontend-lead-roadmap.md`](03-frontend-lead-roadmap.md) | Design system, screens, offline client, maps, a11y, i18n |
| [`04-ai-lead-roadmap.md`](04-ai-lead-roadmap.md) | The nine AI systems, metrics, on-device bundle |
| [`05-devops-qa-lead-roadmap.md`](05-devops-qa-lead-roadmap.md) | K8s, Terraform, CI/CD, observability, telecom, DR |

These describe the **plan**, in the present tense, for all 18 phases. Much of
what they name is not built. `../README.md` is the authority on what exists.

## RAKSHA

| Document | Contents |
|---|---|
| [`raksha/00-requirements.md`](raksha/00-requirements.md) | The road-monitoring extension's requirements |
| [`raksha/05-dataset-license-verification.md`](raksha/05-dataset-license-verification.md) | RDD2022 licensing, and the class mapping the CV tests enforce |
| [`../ai/README.md`](../ai/README.md) | Trained models with measured metrics, and the honest CPU-only caveat |

---

## Dated evidence — v1.0.0-RC1

Not updated as the code moves. Useful as a record, and as a worked example of
auditing your own claims.

### `release/` — the release decision
`RELEASE-RC1-REPORT.md` (the full report) · `FINAL_GO_NO_GO.md` (the decision
and its blockers) · `RELEASE_NOTES.md` / `FINAL_RELEASE_NOTES.md` ·
`FINAL_REPOSITORY_STATUS.md` · `FINAL_EVIDENCE_MAP.md` (claim → where to show
it) · `FINAL_SUBMISSION_CHECKLIST.md` · `FINAL_SUBMISSION_PACKAGE.md`

### `verification/` — per-area test reports
One per area, each recording a run rather than an intention:
`ROADASSIST_FINAL_VERIFICATION_REPORT.md` (the umbrella) ·
`DATABASE_FINAL_VERIFICATION.md` · `SECURITY_FINAL_VERIFICATION.md` ·
`SOS_FINAL_TEST_REPORT.md` · `OFFLINE_FINAL_TEST_REPORT.md` ·
`PAYMENT_FINAL_TEST_REPORT.md` · `CONCURRENCY_FINAL_TEST_REPORT.md` ·
`REALTIME_FINAL_TEST_REPORT.md` · `CUSTOMER_FINAL_TEST_REPORT.md` ·
`MECHANIC_FINAL_TEST_REPORT.md` · `FAILURE_MODE_FINAL_REPORT.md` ·
`PERFORMANCE_FINAL_REPORT.md` · `FINAL_BUILD_VERIFICATION.md` ·
`ZERO_TO_RUN_VERIFICATION.md` (clone to running) · `FINAL_DEMO_SMOKE_TEST.md` ·
`CLAIM_VERIFICATION_FINAL.md`

### `demo/` — running the demo
`FINAL_10_MINUTE_DEMO_SCRIPT.md` and `FINAL_DEMO_SCRIPT.md` (the beats) ·
`DEMO_COMMAND_CARD.md` (commands to hand) · `FINAL_STARTUP_CHECKLIST.md` ·
`PRESENTATION_DAY_CHECKLIST.md` · `DEMO_FAILURE_BACKUP_PLAN.md` (what to do
when it breaks live) · `FINAL_SCREENSHOT_CHECKLIST.md` ·
`FINAL_PRESENTATION_PLAN.md` · `PPT_CLAIM_CHECKLIST.md`,
`FINAL_PPT_CLAIM_CHECK.md`, `FINAL_PPT_FACT_CHECK.md` (slide-by-slide claim
audits)

### `viva/` — defending it
`ROADASSIST_FINAL_CHEAT_SHEET.md` (one page) · `VIVA_COMMAND_CARD.md` ·
`PROFESSOR_TRAP_QUESTIONS.md` (the 20 hardest) · `FINAL_PROFESSOR_DEFENSE.md`
and `FINAL_PROFESSOR_SIMULATION.md` (a rehearsed grilling) ·
`FINAL_VIVA_100.md` · `ROADASSIST_FINAL_VIVA.md` · `CODE_TO_VIVA_MAP.md`
(question → file) · `SWE4004_IMPLEMENTATION_MAPPING_FINAL.md` and
`FINAL_SWE4004_DEFENSE_MAP.md` (syllabus mapping) ·
`FINAL_MARKS_LOSS_AUDIT.md` (where marks were being lost, and why)

---

*Substantial overlap exists between the dated files — several were written in
the same sitting and restate each other. They are kept as the record rather than
merged, but do not read them as independent confirmations of the same fact.*
