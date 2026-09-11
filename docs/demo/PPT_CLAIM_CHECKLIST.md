> Generated 2026-09-06 by extracting the text of all 32 slides from
> `ppt/RoadAssist-Bharat-FINAL.pptx` and checking each claim against the code.
> GREEN = supported · AMBER = partial or conceptual, and labelled · RED = unsupported.

# PPT claim checklist

**Result: 0 RED.** The deck's labelling discipline holds. One claim was RED at
the start of this phase and has been fixed.

| Slide | Claim | Actual implementation | Evidence | Status | Change required |
|---|---|---|---|---|---|
| 1 | "AI-Powered · Cloud-Connected · Network-Resilient" | Rules engine (labelled), cloud consumed not deployed, off-grid path real | slides 8, 19, 22 qualify each | **AMBER** | None — every term is qualified within three slides |
| 2 | "A breakdown is not a software problem…" | Framing, not a technical claim | — | **GREEN** | None |
| 3 | "One platform, from incident to resolution" | End-to-end journey runs | demo beats 3–10 | **GREEN** | None |
| 5 | "One container serving three surfaces, one PostGIS database" | Exactly true | `Dockerfile`, `apps/web/` | **GREEN** | None |
| 6 | "Two paths, and the second one is the product" | Off-grid path real | ADR-0009 | **GREEN** | None |
| 7 | "No internet does not mean the emergency workflow disappears. It means it runs here instead." | Precisely what the code does | `offline-store.js` | **GREEN** | None |
| 8 | "Diagnosis: rules first, model optional" | Rules always computed; a model may make a verdict stricter, never laxer | `providers.ts` | **GREEN** | None |
| 9 | "Every field is derived from a rule you can read" | Deterministic table | `domain/ai-rules.ts` | **GREEN** | None |
| 10 | "Dispatch is dynamic scheduling" | Run-time assignment from a pool, live score, timeout re-scheduling | `dispatch.ts` | **GREEN** | None — this is the textbook definition |
| 11 | "Two guarded state machines" | Closed transition tables, guarded UPDATE | `booking-machine.ts`, `incident-machine.ts` | **GREEN** | None |
| 12 | "Real-time, but never the source of truth… persist first, publish second" | Exactly the implementation; polling continues underneath | `realtime.ts` | **GREEN** | None |
| 13–14 | "Real screenshots — captured from the running app" | True; `capture-screens.mjs` asserts before capturing | `docs/screenshots/` | **GREEN** | None |
| 15 | "Three states, three honest answers" | ONLINE / LIMITED / OFF-GRID from measured evidence | `connectivity.js` | **GREEN** | None |
| 16 | "The client never decides that money arrived" | Amount is the invoice total; signature recomputed server-side | gateway suite | **GREEN** | None |
| 17 | "Seven layers, and 74 attacks that fail" | 74 executed, all refused | `security-audit.mjs` | **GREEN** | None |
| 18 | "56 tables · 62 foreign keys · 137 indexes" | Verified exactly against the live database | this phase | **GREEN** | None |
| 19 | "Consumer of IaaS and PaaS, provider of SaaS to three user classes" | Accurate | `providers.ts`, three surfaces | **GREEN** | None |
| 20 | "Four genuinely built; one is partial and says so" | Matches the mapping | `SWE4004-MAPPING.md` | **GREEN** | None |
| 21 | "Full test suite passes AGAINST the image" | True — verified in an earlier phase | — | **GREEN** | None |
| 22 | "Two are built. Six are design. I will not show you an animation and call it an autoscaler." | Workload distribution + resource pooling built; rest design | `dispatch.ts` | **GREEN** | None — the strongest slide in the deck |
| 23 | "Static vs dynamic scheduling" | Both real | `OFFER_SWEEP_SECONDS`, `dispatch.ts` | **GREEN** | None |
| 24 | **"615 assertions, all executed"** | 615 execute; 22 more need a Razorpay account | this phase | **GREEN** *(was RED)* | **Already fixed** — see below |
| 25 | "Twenty rows in the failure matrix" | `architecture/failure-matrix.md` has 20 | — | **GREEN** | None |
| 26 | "Marked from the code, not from intent" | Consistent with the mapping | — | **GREEN** | None |
| 27 | "Nothing is deployed to a cloud" | True and stated first | — | **GREEN** | None — volunteering this is worth marks |
| 28 | "Future — labelled as such" | Correctly labelled | — | **GREEN** | None |
| 29 | "Potential, not current. No commercial operation exists" | Honest | — | **GREEN** | None |
| 30 | "Not 'we are better than X' — we have not benchmarked anyone" | Honest | — | **GREEN** | None |
| 31–32 | Demo running order and close | Matches the rehearsed script | `test:demo` | **GREEN** | None |

## The one RED, and its fix

**Slide 24 previously read "600 assertions, all executed"**, with a footer
reading "600 assertions · 7 suites · 0 failures".

Only **615** assertions across **six** suites actually execute. The seventh —
22 payment-gateway checks — requires a Razorpay sandbox account and refuses to
run without one. Presenting a suite as passing when it cannot run is precisely
the failure this deck otherwise avoids, and a professor who asked *"show me the
seventh suite"* would have found it unrunnable.

**Applied:** slide retitled **"615 assertions, all executed"**; footer now reads
"615 assertions · 6 suites · 0 failures · 56 tables · 64 routes · 10 ADRs". The
deck was rebuilt (`python ppt/make_final.py`) and re-exported to PDF (32 pages,
verified). The same correction was applied to six documents — see
`CLAIM_VERIFICATION_FINAL.md`.

## Wording to use if asked about the seventh suite

> "There is a seventh suite — 22 payment-gateway checks against Razorpay's real
> sandbox. It needs an account we don't have, so it doesn't run, and I don't
> count it. The same settlement path — order, signature, webhook, duplicate
> webhook, forged signature — is covered by 26 checks against a stub that
> speaks Razorpay's actual wire format."
