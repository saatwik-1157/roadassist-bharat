> Generated 2026-09-06 by extracting all 32 slides from
> `ppt/RoadAssist-Bharat-FINAL.pptx` and checking each claim against code.
> This supersedes nothing — it is the presentation-day check. The full
> slide-by-slide table is in `PPT_CLAIM_CHECKLIST.md`.

# Final PPT claim check

**Verdict: 0 RED across 32 slides.** The deck is safe to present as it stands.

## The five claims most likely to be challenged, and what backs each

| Claim on the deck | Challenge | What you show |
|---|---|---|
| "AI-Powered" (slide 1) | *"Is it really AI?"* | Slide 8 already labels it a rules engine and every API response carries `rules-1.0.0`. Agree instantly, then pivot: the safety asymmetry (a model may make a verdict stricter, never laxer) and the CI guard that fails the build if the device and server rule tables diverge. Then mention the trained YOLO11n with measured metrics. |
| "Dispatch is dynamic scheduling" (10) | *"Justify that term."* | Work assigned **at run time**, from a **pool**, by a score from **live state**, with **timeout-driven re-scheduling**. `dispatch.ts`. That is the textbook definition, four properties for four. |
| "626 assertions, all executed" (24) | *"Show me."* | `npm run test:security` live — 74 passed, 0 failed, in about a minute. Volunteer that a seventh suite needs a Razorpay account and does not run. |
| "Two are built. Six are design." (22) | *"Where is autoscaling?"* | Not provisioned; the slide says DESIGN. Show the one real component — stop Postgres, `/health` returns 503 while `/v1/ping` returns 200. |
| "Nothing has been transmitted" (7, 15) | *"Can SOS reach emergency services offline?"* | **No.** No satellite, no mesh, no SMS bypass. The app says exactly that and advises calling 112. Even online, 112 is a stub and the API response says so. |

## Claims that are absent, and should stay absent

"Highly available" · "fault tolerant" · "production ready" · "99.9% uptime" ·
"zero downtime" · "emergency services contacted". None appears on any slide.
Do not add any of them verbally.

## The one correction already applied

Slide 24 read **"600 assertions, all executed"** with a footer of "600  <!-- claims-check:ignore: quotes the corrected-away figure on purpose -->
assertions · 7 suites". Only 626 across six execute. Corrected, deck rebuilt,
PDF re-exported (32 pages, verified). Had it gone unfixed, *"show me the seventh
suite"* would have exposed an unrunnable suite mid-viva.

## Present from the PDF

`ppt/RoadAssist-Bharat-FINAL.pdf` — 32 pages, fonts embedded. PowerPoint
reflows text on an unfamiliar machine; the PDF cannot. Keep the .pptx as the
backup, not the other way round.
