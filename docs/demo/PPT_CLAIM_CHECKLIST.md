> Generated 2026-09-06 by extracting the text of all 32 slides from
> `ppt/RoadAssist-Bharat-FINAL.pptx` and checking each claim against the code.
> GREEN = supported · AMBER = partial or conceptual, and labelled · RED = unsupported.

# PPT claim checklist

**Result: 0 RED after the 2026-09-25 rebuild.** The deck's labelling
discipline holds. One claim was RED at the start of this phase and was fixed;
slide 27 went RED when the demo went live, and it and the stale figures listed
at the end were corrected in `ppt/part_final.py` and the deck rebuilt and
re-exported to PDF on 2026-09-25.

| Slide | Claim | Actual implementation | Evidence | Status | Change required |
|---|---|---|---|---|---|
| 1 | "AI-Powered · Cloud-Connected · Network-Resilient" | Rules engine (labelled), cloud consumed and the demo deployed on one Render service + Neon (Singapore), off-grid path real | slides 8, 19, 22 qualify each | **AMBER** | None — every term is qualified within three slides |
| 2 | "A breakdown is not a software problem…" | Framing, not a technical claim | — | **GREEN** | None |
| 3 | "One platform, from incident to resolution" | End-to-end journey runs | demo beats 3–10 | **GREEN** | None |
| 5 | "One container, one PostGIS database — live on Render + Neon in Singapore" | Exactly true | `Dockerfile`, `render.yaml` | **GREEN** | None |
| 6 | "Two paths, and the second one is the product" | Off-grid path real | ADR-0009 | **GREEN** | None |
| 7 | "No internet does not mean the emergency workflow disappears. It means it runs here instead." | Precisely what the code does | `offline-store.js` | **GREEN** | None |
| 8 | "Diagnosis: rules first, model optional" | Rules always computed; a model may make a verdict stricter, never laxer. The panel names the trained detectors: best YOLO11s mAP50 0.472, the YOLO11n behind RAKSHA 0.443 | `providers.ts`, `ai/README.md`, `ai/train-full.log` | **GREEN** | None |
| 9 | "Every field is derived from a rule you can read" | Deterministic table | `domain/ai-rules.ts` | **GREEN** | None |
| 10 | "Dispatch is dynamic scheduling" | Run-time assignment from a pool, live score, timeout re-scheduling | `dispatch.ts` | **GREEN** | None — this is the textbook definition |
| 11 | "Two guarded state machines" | Closed transition tables, guarded UPDATE | `booking-machine.ts`, `incident-machine.ts` | **GREEN** | None |
| 12 | "Real-time, but never the source of truth… persist first, publish second" | Exactly the implementation; polling continues underneath | `realtime.ts` | **GREEN** | None |
| 13–14 | "Real screenshots — captured from the running app" | True; `capture-screens.mjs` asserts before capturing | `docs/screenshots/` | **GREEN** | None |
| 15 | "Three states, three honest answers" | ONLINE / LIMITED / OFF-GRID from measured evidence | `connectivity.js` | **GREEN** | None |
| 16 | "The client never decides that money arrived" | Amount is the invoice total; signature recomputed server-side. The 22 Razorpay checks are labelled "Checked, not counted" | gateway suite | **GREEN** | None |
| 17 | "Seven layers, and 74 attacks that fail" | 74 executed, all refused | `security-audit.mjs` | **GREEN** | None |
| 18 | "56 tables · 62 foreign keys · 138 indexes" | Verified exactly against the live database | this phase | **GREEN** | None |
| 19 | "Consumer of IaaS and PaaS, provider of SaaS to three user classes" | Accurate | `providers.ts`, three surfaces | **GREEN** | None |
| 20 | "Four genuinely built; one is partial and says so" | Matches the mapping | `SWE4004-MAPPING.md` | **GREEN** | None |
| 21 | "Full test suite passes AGAINST the image" | True — verified in an earlier phase | — | **GREEN** | None |
| 22 | "Two are built. Six are design. I will not show you an animation and call it an autoscaler." | Workload distribution + resource pooling built; rest design | `dispatch.ts` | **GREEN** | None — the strongest slide in the deck |
| 23 | "Static vs dynamic scheduling" | Both real | `OFFER_SWEEP_SECONDS`, `dispatch.ts` | **GREEN** | None |
| 24 | **"757 assertions, all executed"** | 757 execute across six suites; 22 payment checks sit outside the total, not executed | `app/docs/measured.json` | **GREEN** *(was RED)* | **Already fixed** — see below |
| 25 | "Twenty rows in the failure matrix" | `architecture/failure-matrix.md` has 20 | — | **GREEN** | None |
| 26 | "Marked from the code, not from intent" | Consistent with the mapping | — | **GREEN** | None |
| 27 | "The demo is one free-tier instance in Singapore (Render + Neon) — no India region, no cluster." | True — live at `app.roadassistbharat.online` | `render.yaml` | **GREEN** *(was RED: "Nothing is deployed")* | **Fixed 2026-09-25.** Volunteering the limits is still worth marks |
| 28 | "Future — labelled as such" | Correctly labelled | — | **GREEN** | None |
| 29 | "Potential, not current. No commercial operation exists" | Honest | — | **GREEN** | None |
| 30 | "Not 'we are better than X' — we have not benchmarked anyone" | Honest | — | **GREEN** | None |
| 31–32 | Demo running order and close | Matches the rehearsed script | `test:demo` | **GREEN** | None |

## The one RED, and its fix

**Slide 24 previously read "600 assertions, all executed"**, with a footer  <!-- claims-check:ignore: quotes the corrected-away figure on purpose -->
reading "600 assertions · 7 suites · 0 failures".  <!-- claims-check:ignore: quotes the corrected-away figure on purpose -->

Only **six** suites actually execute — **757** assertions as re-measured on
2026-09-12 (unit 225 · e2e 191 · concurrency 77 · security 74 · gateway
security 27 · browser 163). The seventh — 22 payment-gateway checks in
`razorpay-test.mjs` — needs no Razorpay account (it starts its own local stub),
but it refuses to run unless the API was started separately in Razorpay mode
pointing at that stub, so it sits outside every `npm test` run and was not
executed. Presenting it as passing is precisely the failure this deck otherwise
avoids, and a professor who asked *"show me the seventh suite"* would have found
it was never part of the run.

**Applied:** slide retitled **"757 assertions, all executed"**; the footer should
read "757 assertions · 6 suites · 0 failures · 56 tables · 67 routes · 11 ADRs".
The deck was rebuilt (`python ppt/make_final.py`) and re-exported to PDF (32 pages,
verified). The same correction was applied to six documents — see
`CLAIM_VERIFICATION_FINAL.md`.

## Stale on 2026-09-25 — fixed and rebuilt the same day

The deck sources (`ppt/part_final.py`) carried these on 2026-09-25. Each was
corrected in the source, the deck rebuilt with `python ppt/make_final.py` and
the PDF re-exported (32 pages; text checked with `pypdf`):

| Deck text (old) | Correct |
|---|---|
| Slide 27: "Nothing is deployed to a cloud — no account, no domain, no cluster." | Demo live at `app.roadassistbharat.online` — one Render service + Neon Postgres (Singapore); still no cluster |
| Footer "65 routes · 10 ADRs"  <!-- claims-check:ignore: quotes the stale deck footer on purpose --> | 67 routes (64 under `/v1`) · 11 ADRs |
| Testing slide "Unit 101" | Unit 225 |

## Wording to use if asked about the seventh suite

> "There are 22 more payment-gateway checks. They need no Razorpay account — the
> script starts its own local stub of the Orders API — but they only run when
> the API is started separately in Razorpay mode, so they are outside our test
> runs, weren't executed, and I don't count them. Webhook signatures and the
> Razorpay adapter's wire format are covered inside the total by the 27
> gateway-security checks, which run against a stub vendor endpoint."
