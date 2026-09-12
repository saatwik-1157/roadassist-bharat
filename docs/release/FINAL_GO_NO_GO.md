> Every row was executed on 2026-09-06 against a database created empty for the
> purpose. No row is inherited from an earlier phase without re-running it.

# Final GO / NO-GO

| Area | Status | Evidence | Blocker? |
|---|---|---|---|
| Build | **PASS** | typecheck, lint, boundaries, build all clean after deleting the incremental cache | No |
| Backend | **PASS** | Boots with zero error-level logs; `/health` 200, `dbLatencyMs: 2` | No |
| Frontend | **PASS** | Three surfaces served by the same process; 163 browser assertions | No |
| Database | **PASS** | 56 tables, 62 FKs, 137 indexes, 5 migrations; 10 consistency checks all 0 | No |
| Authentication | **PASS** | OTP + rotation; reuse detected as theft (e2e §2) | No |
| Authorization | **PASS** | `bookingAudience()`; 12 cross-tenant attacks refused | No |
| Customer | **PASS** | 19 steps, all pass (`CUSTOMER_FINAL_TEST_REPORT.md`) | No |
| Mechanic | **PASS** | 16 steps, all pass (`MECHANIC_FINAL_TEST_REPORT.md`) | No |
| Incident | **PASS** | Created, audited, dispatched; guarded state machine | No |
| AI | **PASS** *(rules)* | Labelled `rules-1.0.0`; fallback asserted `usedFallback: true` | No |
| Incident intelligence | **PASS** | Severity 1–5, driveability, parts, recommended service | No |
| Dispatch | **PASS** | 5 offers in 0.5 s; 83.5 ms p50 server-side | No |
| Realtime | **PASS** | SSE 5.2 ms to first frame; customer follows untouched in 1.5 s | No |
| SOS | **PASS** | 10 scenarios; ladder reports each rung as fact | No |
| Offline | **PASS** | 16 checks; incident survives a full tab close | No |
| Synchronization | **PASS** | `SYNCED` with server id; re-sync creates nothing | No |
| Payment | **PASS** *(stub)* | 26 gateway checks; live sandbox **NOT VERIFIED** — needs your account | No |
| Security | **PASS** | 100 attacks refused; runtime deps 0 vulnerabilities | No |
| Testing | **PASS** | 626 executed, 0 failures, run twice | No |
| Deployment | **PARTIAL** | Image builds, suite passes against it; **nothing deployed** | No — declared, not hidden |
| SWE4004 mapping | **PASS** | 13 implemented / 8 partial / 3 conceptual / 3 target | No |
| Documentation | **PASS** | 30+ documents, 10 ADRs, master report as the entry point | No |
| PPT | **PASS** | 32 slides, 0 RED claims, PDF exported | No |
| Demo | **PASS** | 23/23 smoke-test steps; 9 clean rehearsals | No |
| Viva | **PASS** | 100 questions with code paths; cards and traps prepared | No |

---

## BLOCKERS

**None.**

The one blocker this phase identified — that nothing was committed and no tag
existed, so a `git checkout` would have lost the entire release candidate — was
resolved on 2026-09-06:

- Release commit **`c2be42c`** on `main`: 198 files, 29,996 insertions.
- One defect fixed after it and folded into the tag: the Android SOS sent
  hard-coded demo coordinates because nothing ever requested a GPS fix.
  The tag was moved to include it.
- Annotated tag **`v1.0.0-RC1`** pointing at it.
- Working tree clean; 333 files in the tag; `.env` confirmed absent; no live
  keys, no private keys, no `node_modules`, no build output.

Committed on `main` rather than a release branch, deliberately: this is a
submission repository, and a tag on a side branch would leave the default
branch — the one an examiner clones — without any of the work.

## HIGH PRIORITY

1. **Five screenshots outstanding** (`FINAL_EVIDENCE_MAP.md`) — four are
   terminal commands that already pass. Ten minutes, and the cheapest marks
   available.
2. **Backup the deck off the laptop** — USB and email. The PDF is the artifact
   that survives someone else's PowerPoint.

## OPTIONAL POLISH

1. Eight academic slides the current deck lacks (Motivation, Existing System,
   Objectives, Users & Roles, Tech Stack, Service Model, Deployment Model,
   Customer Workflow). Content is written in `FINAL_PRESENTATION_PLAN.md`; the
   deck passes its claim audit without them.
2. A recorded demo video, only if your rubric requires one.
3. Root directory now holds 40+ markdown files. `ROADASSIST_FINAL_VERIFICATION_REPORT.md`
   is the entry point; a `docs/final/` folder would tidy it, at the cost of
   breaking the paths every other document cites. Not worth it during a freeze.

## Fixes applied in this phase

Two, both small and both verified afterwards:

1. **Seed data contradicted the platform's own rule** — 1,789 bookings marked
   `PAID` with no invoice and no payment, while the API refuses that exact
   transition. The seeder now mirrors the API. Re-verified: 4,076 invoices,
   1,789 settled payments, 0 mismatches, all 10 consistency checks at 0.
2. **README claimed iOS, Android Auto, IVR and USSD.** None exists. Corrected to
   name the three surfaces that do — PWA, Android, SMS — and to label the rest
   as designed.

Nothing else was changed. Application code was untouched by Phases 15–17.
