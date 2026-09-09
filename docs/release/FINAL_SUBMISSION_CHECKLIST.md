> Generated 2026-09-06. Ticks mean verified in this phase, not assumed.

# Final submission checklist

| | Item | Where | Status |
|---|---|---|---|
| ✅ | Source code | `app/apps`, `app/packages`, `mobile/`, `ai/` | 57-table schema, 64 routes, 6 web surfaces |
| ✅ | Database migrations | `app/packages/db/drizzle/` | 5, run from empty in this phase |
| ✅ | Seed data | `seed.ts`, `seed-raksha.ts` | ~37k rows; 10 consistency checks return 0 |
| ✅ | README | `README.md`, `app/README.md` | Followed literally; reproduces the app |
| ✅ | Environment instructions | `app/.env.example` | Every setting documented; none required to run |
| ✅ | API documentation | `app/docs/architecture/README.md` | Style guide + envelope + error codes |
| ✅ | Architecture diagram | `app/docs/architecture/`, deck slides 5–6 | C4 container view |
| ✅ | SWE4004 mapping | `SWE4004_IMPLEMENTATION_MAPPING_FINAL.md`, `app/docs/SWE4004-MAPPING.md` | 21 concepts classified |
| ✅ | Testing report | `FINAL_REPOSITORY_STATUS.md`, `app/docs/TESTING.md` | 578 assertions, 0 failures |
| ✅ | Security report | `SECURITY_FINAL_VERIFICATION.md`, `app/docs/SECURITY.md` | 100 attacks refused |
| ✅ | Offline report | `OFFLINE_FINAL_TEST_REPORT.md`, `app/docs/OFFLINE.md` | Includes "NO NETWORK ≠ NO SAFETY" |
| ✅ | Demo script | `FINAL_10_MINUTE_DEMO_SCRIPT.md`, `app/docs/DEMO-SCRIPT.md` | Timing measured, not estimated |
| ✅ | Viva preparation | `ROADASSIST_FINAL_VIVA.md` (35), `app/docs/VIVA.md` (56) | Grounded in code |
| ✅ | PPT | `ppt/RoadAssist-Bharat-FINAL.pptx` | 32 slides, 0 RED claims |
| ✅ | PPT as PDF | `ppt/RoadAssist-Bharat-FINAL.pdf` | 32 pages, fonts embedded |
| ⬜ | Screenshots | `app/docs/screenshots/` | **15 of 24.** Six terminal captures outstanding |
| ⬜ | Demo video | — | Optional. Not recorded |
| ✅ | Deployment information | `app/docs/DEPLOYMENT.md` | Plus exactly which accounts are needed |
| ✅ | Known limitations | Every report; deck slide 27 | Stated first, not buried |
| ✅ | Future scope | Deck slide 28, `RELEASE_NOTES.md` | Labelled as future |
| ✅ | References | `app/docs/adr/` | 10 ADRs |
| ⬜ | Git repository | — | **Nothing committed** |
| ⬜ | Final commit | — | **41 modified, 59 untracked** |
| ⬜ | Release tag | — | `v1.0.0-RC1` recommended, not created |
| ⬜ | Backup ZIP | — | Not created |
| ⬜ | Submission folder | — | Not assembled |

## What is actually outstanding

Five items, and **four of them are yours to authorise, not mine to decide**:

1. **Commit and tag.** The single biggest gap. See below.
2. **Six terminal screenshots** — ten minutes, listed in
   `FINAL_SCREENSHOT_CHECKLIST.md` rows 19–23.
3. **Backup ZIP** and **submission folder** — trivial once committed.
4. **Demo video** — only if your rubric requires one.

---

## Phase 15–16 additions (presentation and defense)

| | Item | Where |
|---|---|---|
| ✅ | 32-slide content plan | `FINAL_PRESENTATION_PLAN.md` |
| ✅ | Demo script with narration | `FINAL_DEMO_SCRIPT.md` |
| ✅ | 100 viva questions | `FINAL_VIVA_100.md` |
| ✅ | Professor defense (claim → code → screen) | `FINAL_PROFESSOR_DEFENSE.md` |
| ✅ | Two-page cheat sheet | `ROADASSIST_FINAL_CHEAT_SHEET.md` |
| ✅ | PPT claim check (0 RED) | `FINAL_PPT_CLAIM_CHECK.md` |
| ✅ | Professor simulation + rubric + verdict | `FINAL_PROFESSOR_SIMULATION.md` |

## Presentation-day rules

**DO NOT:** update dependencies · deploy new code · change the schema · alter
environment variables · try a new API · install packages · modify a working
feature · test a live payment · use real customer data.

**DO:** `npm run demo:reset` the night before · start Docker and the API
fifteen minutes early · run `npm run test:demo` once to confirm · keep the PDF
deck open in a second window · keep `app/docs/screenshots/` reachable · keep the
cheat sheet on paper · rehearse the narration aloud twice · know the
limitations · answer honestly.
