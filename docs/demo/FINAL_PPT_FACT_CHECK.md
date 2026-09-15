> Deck text extracted from `ppt/RoadAssist-Bharat-FINAL.pptx` (32 slides) and
> checked term by term against the code on 2026-09-06, re-measured 2026-09-12.
> The wording in the last column is what to say on the day, so it tracks the
> code rather than the deck build it was first written against.

# Final PPT fact check

**Result: no FALSE statements remain.** One was found and corrected during
Phase 13; the platform-list overclaim in the root README was found and corrected
in this phase.

| Term | Where it appears | Verdict | Correct wording (use this) |
|---|---|---|---|
| **AI** | Slide 1 "AI-Powered"; slide 8 | **PARTIAL** | Keep, because slide 8 labels it: *"a deterministic rules engine, `rules-1.0.0`, plus a separately trained YOLO11n for road damage."* Never say "the AI diagnoses". |
| **Cloud** | Slides 1, 19–23 | **PARTIAL** | *"Cloud-connected"* is accurate. **Never** upgrade it to "cloud-native" or "cloud-deployed" — nothing is deployed. |
| **Offline** | Slides 7, 15, 22 | **TRUE** | *"The emergency workflow runs locally; dispatch, tracking, ETA and payment need connectivity."* Never the bare "it works offline". |
| **SOS** | Slides 7, 15 | **TRUE** | *"Creates a local encrypted incident and states that nothing has been transmitted."* |
| **Emergency services** | Slide 7 footnote | **TRUE as written** | The deck already says *"We never claim emergency services were contacted. The 112 handoff is a stub and the API says so."* Leave it exactly as it is. |
| **Scalability** | Slide 22 | **PARTIAL** | *"Stateless and cloud-ready; autoscaling designed and not provisioned."* |
| **Real-time** | Slide 12 | **TRUE** | *"Server-sent events — persist first, publish second, with polling underneath."* Never say WebSocket. |
| **Security** | Slide 17 | **TRUE** | *"74 attacks that must fail, plus 27 gateway checks."* Add: *"no independent penetration test."* |
| **Deployment** | Slides 21, 27 | **TRUE** | *"Not deployed. The image builds and the suite passes against it."* |
| **Predictive maintenance** | Slide 28 (roadmap) | **PARTIAL — labelled FUTURE** | Correct as-is. Do not describe it in the present tense. |
| **Autoscaling** | Slide 22 | **PARTIAL — labelled DESIGN** | *"Designed, not provisioned. The readiness gate is the one piece that is real."* |
| **Replication** | Slide 21 | **PARTIAL — labelled CONCEPTUAL** | *"Not built. The API is stateless, but three in-process components would break it."* |
| **Load balancing** | Slide 22 | **PARTIAL** | *"No infrastructure balancer. Workload distribution across a provider pool is real."* |
| **Satellite** | Slide 28 | **PARTIAL — labelled FUTURE** | Correct as-is. If asked offline: *"No satellite link exists."* |
| **631 assertions** | Slide 24 | **TRUE** *(was FALSE)* | Corrected from "600 across seven suites". Volunteer that a seventh suite needs a Razorpay account. |

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
2. "It's deployed on the cloud."
3. "Our AI predicts the fault."
