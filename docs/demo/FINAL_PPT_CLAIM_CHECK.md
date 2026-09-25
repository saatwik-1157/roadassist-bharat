> Generated 2026-09-06 by extracting all 32 slides from
> `ppt/RoadAssist-Bharat-FINAL.pptx` and checking each claim against code.
> This supersedes nothing — it is the presentation-day check. The full
> slide-by-slide table is in `PPT_CLAIM_CHECKLIST.md`.

# Final PPT claim check

**Verdict: 0 RED across 32 slides after the 2026-09-25 rebuild.** Since the
2026-09-06 audit the demo went live and the figures were re-measured, which made
some deck text stale — see *Stale since the demo went live* below; all of it was
corrected in the source and the deck rebuilt on 2026-09-25.

## The five claims most likely to be challenged, and what backs each

| Claim on the deck | Challenge | What you show |
|---|---|---|
| "AI-Powered" (slide 1) | *"Is it really AI?"* | Slide 8 already labels it a rules engine and every API response carries `rules-1.0.0`. Agree instantly, then pivot: the safety asymmetry (a model may make a verdict stricter, never laxer) and the CI guard that fails the build if the device and server rule tables diverge. Then mention the trained YOLO11 road-damage detectors: best run YOLO11s (`yolo11s-multi-rich`), mAP50 0.472 / mAP50-95 0.226, undertrained at epoch 13; the YOLO11n India model whose detections RAKSHA shows scored mAP50 0.443. |
| "Dispatch is dynamic scheduling" (10) | *"Justify that term."* | Work assigned **at run time**, from a **pool**, by a score from **live state**, with **timeout-driven re-scheduling**. `dispatch.ts`. That is the textbook definition, four properties for four. |
| "757 assertions, all executed" (24) | *"Show me."* | `npm run test:security` live — 74 passed, 0 failed, in about a minute. Volunteer that 22 payment checks sit **outside** the 757: they need no Razorpay account (they run against a local stub), but they only run when the API is started separately in Razorpay mode, so they were not executed for this measurement. |
| "Two are built. Six are design." (22) | *"Where is autoscaling?"* | Not provisioned; the slide says DESIGN. Show the one real component — stop Postgres, `/health` returns 503 while `/v1/ping` returns 200. |
| "Nothing has been transmitted" (7, 15) | *"Can SOS reach emergency services offline?"* | **No.** No satellite, no mesh, no SMS bypass. The app says exactly that and advises calling 112. Even online, 112 is a stub and the API response says so. |

## Claims that are absent, and should stay absent

"Highly available" · "fault tolerant" · "production ready" · "99.9% uptime" ·
"zero downtime" · "emergency services contacted". None appears on any slide.
Do not add any of them verbally.

## The one correction already applied

Slide 24 read **"600 assertions, all executed"** with a footer of "600  <!-- claims-check:ignore: quotes the corrected-away figure on purpose -->
assertions · 7 suites" — the old, wrong figure. Only six suites execute; re-measured
on 2026-09-12 they total 757. Corrected, deck rebuilt,
PDF re-exported (32 pages, verified). Had it gone unfixed, *"show me the seventh
suite"* would have exposed 22 payment checks that were never part of the run.

## Stale since the demo went live — re-check before presenting

On 2026-09-25 the deck sources (`ppt/part_final.py`) still carried three items
that were no longer true. They were corrected, the deck rebuilt and the PDF
re-exported that day. If a PDF you are handed still shows any of them, it is an
old export and **RED**:

| Deck text (old) | Correct |
|---|---|
| "Nothing is deployed to a cloud — no account, no domain, no cluster." | The demo is live at https://app.roadassistbharat.online — one Render service + Neon Postgres, both Singapore. Still no cluster, no autoscaling, no replication |
| Footer "65 routes · 10 ADRs"  <!-- claims-check:ignore: quotes the stale deck footer on purpose --> | 67 routes (64 under `/v1`) · 11 ADRs |
| Testing slide "Unit 101" | Unit 225 (six suites: 225 · 191 · 77 · 74 · 27 · 163 = 757) |

## Present from the PDF

`ppt/RoadAssist-Bharat-FINAL.pdf` — 32 pages, fonts embedded. PowerPoint
reflows text on an unfamiliar machine; the PDF cannot. Keep the .pptx as the
backup, not the other way round.
