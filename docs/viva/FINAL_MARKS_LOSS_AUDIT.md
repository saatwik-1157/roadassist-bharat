> Generated 2026-09-06, written adversarially. The job of this file is to find
> what a strict examiner would deduct for — not to reassure.

# Final marks-loss audit

| # | Problem | Why a professor may penalise | Exact fix | Status |
|---|---|---|---|---|
| 1 | **Nothing is committed.** 41 modified + 59 untracked files; no tag; `f771df5` contains none of the work | "Show me the repository" produces a working tree that a `git checkout` would destroy. A submission with no commit and no tag looks unfinished regardless of quality | `git checkout -b release/v1.0.0-rc1`, commit, `git tag v1.0.0-RC1` | **OPEN — needs your go-ahead** |
| 2 | **Six terminal screenshots missing** (health 503, test output, concurrency proof, boundaries, schema, live map) | "We tested it" is worth far less than a picture of `74 passed, 0 failed`. These are the cheapest marks available | Run each command and screenshot it — see `FINAL_SCREENSHOT_CHECKLIST.md` rows 16–23 | **OPEN — 10 minutes of your time** |
| 3 | **99.9% / 99.99% SLO tables** in `docs/01-master-roadmap.md` and `docs/05-devops-qa-lead-roadmap.md` | A reader who opens those files sees availability figures that were never measured. They are planning targets from before the build, but nothing on the page says so | Add a one-line banner at the top of both: *"Planning targets written before implementation. Not measurements. See `PERFORMANCE_FINAL_REPORT.md` for what was actually measured."* | **FIXED this phase** |
| 4 | Test-count claim said 600 across seven suites | One unrunnable suite made a headline number unsupportable | Corrected to 578 across six, in six documents and the deck | **FIXED** |
| 5 | "64 endpoints under `/v1`" | 61 are under `/v1`; 64 is the total including `/health` and two tile routes. Small, but a professor who counts will find it | Reworded in four documents | **FIXED** |
| 6 | Seeded data contradicted the platform's own rule — 1,789 PAID bookings with no invoice or payment | One join exposes it, and it undercuts the "money is recorded, never asserted" claim precisely where that claim matters | Seeder now raises invoices on completion and settled payments on PAID | **FIXED** |
| 7 | Demo script said 8 minutes; its beats summed to 10:25 | Running over time in a graded slot | Retitled; timing verified by measured rehearsal | **FIXED** |
| 8 | Demo §12 was unperformable after §11 | The best beat in the demo would have failed live | §12 now opens by closing the SOS sheet | **FIXED** |
| 9 | Customer screen could sit on a stale state for 60 s; Pay button never appeared | The payment beat would have stalled in front of the class | Two fixes in `pollBooking` | **FIXED** |
| 10 | **No independent penetration test** | "Have you had a pentest?" — no | Say so plainly: 100 self-written attacks is not the same thing. Do not dress it up | **ACCEPTED — answer prepared** |
| 11 | **Eight cloud concepts are DESIGN** | An examiner wanting "deployed cloud" may mark down regardless of quality | Lead with the two Module 4 architectures that *are* built and the readiness gate; then name the three in-process blockers precisely. Precision reads as competence; vagueness reads as bluffing | **ACCEPTED — answer prepared** |
| 12 | **The AI is if-statements** | "Your AI is a lookup table" | Agree immediately, then pivot to the two genuinely interesting parts: the safety asymmetry (a model may make a verdict stricter, never laxer) and the device/cloud divergence guard that fails CI. Mention the real trained YOLO11n with measured mAP50 | **ACCEPTED — answer prepared** |
| 13 | Coverage number is modest | "What is your coverage?" | 95.68% lines on the pure domain modules; the HTTP layer is tested out-of-process so instrumentation cannot see it. Precise beats impressive | **ACCEPTED** |
| 14 | Screens look sparse on a projector | UI evidence marks | Demo in a 390 px window — the app is designed for a phone | **ACCEPTED** |
| 15 | Root directory now holds ~24 verification documents | Hard to navigate; a marker may not find the one that matters | `ROADASSIST_FINAL_VERIFICATION_REPORT.md` is the single entry point and links the rest | **MITIGATED** |
| 16 | Payments never touched a real gateway | "Did you actually take a payment?" | No — sandbox stub only, and the deck says so. The stub speaks Razorpay's real wire format and signatures are recomputed server-side | **ACCEPTED** |
| 17 | Android app is not part of the graded web deliverable but exists | Could read as scope padding | Present it as one extra client of the same API — it demonstrates broad network access, which is a Module 1 topic | **ACCEPTED** |

## The three answers most likely to decide the grade

1. **"Is anything deployed?"** — No. A production image builds and the full
   suite passes against it, but no cloud account exists. I would rather say
   that than point at a diagram.
2. **"So it's a CRUD app with a map?"** — Three things a CRUD app does not
   have: an assignment safe under ten simultaneous accepts, an emergency
   workflow that runs with the network off and forwards without duplicating,
   and a rules engine that provably matches between device and cloud. All three
   are demonstrable in four minutes.
3. **"Did you find bugs in your own project?"** — Yes, and they are the best
   evidence the testing is real. Two mechanics could both accept one job. Three
   simultaneous SOS returned 500. 874 bookings sat in an impossible state.
   1,789 were marked paid with no money record. The customer's screen could
   miss the last real-time event and never show the Pay button. Every one was
   found by tooling written to attack the project, and every one is fixed.
