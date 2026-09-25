> Deck text extracted from `ppt/RoadAssist-Bharat-FINAL.pptx` (32 slides) and
> checked term by term against the code on 2026-09-06, re-measured 2026-09-12.
> The wording in the last column is what to say on the day, so it tracks the
> code rather than the deck build it was first written against.

# Final PPT fact check

**Result: no FALSE statements remained at the 2026-09-12 check.** One was found
and corrected during Phase 13; the platform-list overclaim in the root README
was found and corrected in this phase. Since then the demo has gone live, so
slide 27's old "nothing is deployed" became FALSE; the deck was rebuilt on
2026-09-25 and slide 27 now states the Singapore demo deployment — see the
**Deployment** row.

| Term | Where it appears | Verdict | Correct wording (use this) |
|---|---|---|---|
| **AI** | Slide 1 "AI-Powered"; slide 8 | **PARTIAL** | Keep, because slide 8 labels it: *"a deterministic rules engine, `rules-1.0.0`"*, and names the trained YOLO11 road-damage detectors. If pressed: *"the YOLO11n India model scored mAP50 0.443; our best run, YOLO11s, reached 0.472."* Never say "the AI diagnoses". |
| **Cloud** | Slides 1, 19–23 | **PARTIAL** | *"Cloud-connected"* is accurate, and the demo is now deployed: one Render service + Neon Postgres, both in Singapore. **Never** upgrade it to "cloud-native" — it is a single instance with no orchestration. |
| **Offline** | Slides 7, 15, 22 | **TRUE** | *"The emergency workflow runs locally; dispatch, tracking, ETA and payment need connectivity."* Never the bare "it works offline". |
| **SOS** | Slides 7, 15 | **TRUE** | *"Creates a local encrypted incident and states that nothing has been transmitted."* |
| **Emergency services** | Slide 7 footnote | **TRUE as written** | The deck already says *"We never claim emergency services were contacted. The 112 handoff is a stub and the API says so."* Leave it exactly as it is. |
| **Scalability** | Slide 22 | **PARTIAL** | *"Stateless and cloud-ready; autoscaling designed and not provisioned."* |
| **Real-time** | Slide 12 | **TRUE** | *"Server-sent events — persist first, publish second, with polling underneath."* Never say WebSocket. |
| **Security** | Slide 17 | **TRUE** | *"74 attacks that must fail, plus 27 gateway checks."* Add: *"no independent penetration test."* |
| **Deployment** | Slides 5, 19, 27 | **TRUE after the 2026-09-25 rebuild** *(old slide 27 "nothing is deployed" was FALSE)* | *"Deployed as a demo: one Render web service (Docker, free plan, Singapore) at app.roadassistbharat.online, Neon Postgres in Singapore, a showcase on GitHub Pages. Single instance — no cluster, no autoscaling, no replication. Hosted in Singapore because the free tiers have no India region; an India region is the production target."* |
| **Predictive maintenance** | Slide 28 (roadmap) | **PARTIAL — labelled FUTURE** | Correct as-is. Do not describe it in the present tense. |
| **Autoscaling** | Slide 22 | **PARTIAL — labelled DESIGN** | *"Designed, not provisioned. The readiness gate is the one piece that is real."* |
| **Replication** | Slide 21 | **PARTIAL — labelled CONCEPTUAL** | *"Not built. The API is stateless, but three in-process components would break it."* |
| **Load balancing** | Slide 22 | **PARTIAL** | *"No infrastructure balancer. Workload distribution across a provider pool is real."* |
| **Satellite** | Slide 28 | **PARTIAL — labelled FUTURE** | Correct as-is. If asked offline: *"No satellite link exists."* |
| **757 assertions** | Slide 24 | **TRUE** *(was FALSE)* | Corrected from the old "600 across seven suites". Volunteer that 22 payment checks sit outside the total: they need no Razorpay account (local stub), but were not executed because they need the API started separately in Razorpay mode. |

## Corrected in this phase — root README

**Was:** *"It spans cars … across Android, iOS, web, Android Auto and feature
phones (SMS/IVR/USSD)"*.

**Verdict: FALSE.** There is no iOS project, no Android Auto integration, and no
IVR or USSD endpoint. Only the PWA, the Android client and `POST
/v1/telecom/sms` exist.

**Now reads:** the surfaces that exist are listed explicitly, and *"iOS, Android
Auto, IVR and USSD are designed and not built."* A professor asking "show me the
iOS app" would previously have found nothing.

## The three phrases to never say aloud

1. "Emergency services were contacted."
2. "It's hosted in India" or "it autoscales." (It runs on one instance in Singapore.)
3. "Our AI predicts the fault."
