# P2 — Frontend & Mobile Lead

**RoadAssist Bharat · 86 days across 3 reviews**
Owns: React Native app · web, government, admin and fleet portals · design system · offline client · maps UI · accessibility · 8 languages. Backs up **P4**.

**Your three standing rules**
1. The **reference device is the truth**: Android 10, 2 GB RAM, throttled 3G. If it does not work there, it does not work.
2. Every screen ships with **four** states built — loading, empty, error, offline. A happy path alone is not done.
3. No hardcoded user-facing text, ever. Eight languages from the first commit.

---

## REVIEW 1 — Foundation · Weeks 1–5 · 17 days

| Week | Task | Days |
|---|---|---|
| 1 | Device and connectivity study — measure real 2G/3G latency on 3 highway corridors; catalogue the Indian device mix | 2 |
| 1–2 | 20 user interviews (UX focus); competitor teardown; accessibility and literacy findings | 2 |
| 2 | 6 personas + **4 journey maps**: highway breakdown, city no-start, night accident, fleet truck failure | 2 |
| 2 | Information architecture, navigation map, component inventory | 2 |
| 3 | Low-fidelity wireframes for the **12 critical screens** with all four states | 3 |
| 3–4 | Design system foundations: colour, type, spacing, motion, touch targets; app scaffolds | 3 |
| 4 | Local offline database schema and storage budget (≤ 120 MB, with eviction) | 1 |
| 5 | Auth screens: phone entry, OTP with SMS auto-read, profile setup, consent centre | 2 |
| 5 | Secure token storage (Keychain/Keystore), silent refresh with request queueing, biometric gate | — |

### Deliverables
Device matrix · connectivity report · 6 personas · 4 journey maps · information architecture · wireframes for 12 screens · design system foundations · auth screens · secure storage · clickable prototype.

### Your Review 1 demo — 5 minutes
Hold up the **reference device physically**. Show a competitor's app struggling on it — that is the brief. Then walk the clickable prototype of the complete breakdown journey in Hindi. Finish by logging in over throttled 3G with SMS auto-read, then killing the app mid-refresh to show it recovering cleanly.

### Passed when
Wireframes cover loading, empty, error and offline for all 12 screens · design system renders in all 8 languages with no truncation · tokens stored only in Keychain/Keystore, never in plain storage · 10 concurrent 401s trigger exactly **one** refresh.

### Your design constraints (evidence-based, from Week 1)
Works one-handed, in rain, at night, on a highway shoulder · readable in direct sunlight (contrast ≥ 7:1) · comprehensible at low literacy (icon + colour + voice, never text alone) · never a blank screen · never a silent failure · APK ≤ 28 MB · ≤ 30 MB data per month.

---

## REVIEW 2 — Core Product · Weeks 6–12 · 36 days

| Week | Task | Days |
|---|---|---|
| 6–7 | **Design system package** — 42 components, dark + light, 8 languages, motion system | 6 |
| 7–8 | Citizen app: onboarding, garage, **request-help flow**, diagnosis, matching, live tracking, payment, history | 12 |
| 9 | Mechanic app: job feed, accept, navigation, checklist, parts, invoice builder, earnings | 4 |
| 9 | Web PWA parity for the core flows | 2 |
| 10 | AI confidence UI + user feedback capture that feeds P3's training loop | 2 |
| 11–12 | **Offline client** — local database, priority operation queue, sync engine, conflict resolution screen, background sync | 10 |
| 12 | *(within)* `useOfflineQuery` as the **only** data-access pattern in the app — this is what makes offline uniform rather than per-screen | — |

*Note: Admin console and Fleet dashboard moved to P4 to keep this review achievable. Android Auto is the declared first cut if you slip.*

### Deliverables
Design system (42 components) · citizen app (Android + iOS) · mechanic app · web PWA · offline client library · sync status and conflict UI · Storybook · visual regression suite.

### Your Review 2 demo — 8 minutes
The full journey on a real **₹8,000 Android phone**, throttled to 3G, in Hindi, one-handed, at maximum brightness to simulate sunlight. **No simulator.** Then switch to airplane mode: add a vehicle, run an on-device diagnosis, create a help request, view an offline map, cancel and re-create. Reconnect — everything syncs and one deliberate conflict is resolved in a screen that makes the choice obvious.

### Passed when
Full journey works on Android 10 / 2 GB / 3G · every screen has all four states · airplane-mode journey syncs with zero data loss · cold start under 2.5 seconds on the reference device · optimistic writes visibly marked "pending" until confirmed — never a silent revert.

---

## REVIEW 3 — Complete System · Weeks 13–18 · 33 days

| Week | Task | Days |
|---|---|---|
| 13 | Maps UI: MapLibre components, **offline map packs** with resumable download, live tracking, landmark location picker | 7 |
| 13 | *(within)* Diagnosis UI: OBD Bluetooth pairing, guided photo capture, drivability verdict | — |
| 14 | **SOS UI** — long-press button, full-screen crash countdown over the lock screen, incident room | 4 |
| 14–15 | **Government portal** — live incident map (10,000 markers, no jank), blackspot analysis, 6 statutory report generators | 6 |
| 15 | Analytics dashboards; fleet and mechanic earnings screens | 4 |
| 16 | **End-to-end tests** (Detox + Playwright) for 12 journeys; visual regression baseline | 4 |
| 16 | Device farm across 12 Android + 4 iOS; accessibility audit; 8-language QA; bug fixes | 3 |
| 17 | App store submission with staged rollout; over-the-air update channel | 3 |
| 17–18 | **Optimisation** — APK size, startup, jank at 60fps, memory leaks, data usage | 2 |

### Deliverables
Maps components + offline packs · diagnosis flow · SOS and incident room · government portal · analytics dashboards · end-to-end test suites · device compatibility matrix · accessibility report · published apps · performance report.

### Your Review 3 demo — 7 minutes
Download a district map pack over WiFi, go to airplane mode, search a landmark and get directions — fully offline. Then trigger a simulated crash **with the phone locked and in a pocket**: the countdown takes over the screen with alarm and vibration. Then the government portal: find a blackspot, generate the statutory PDF. Close with the killer demo — **the entire booking journey driven by a screen reader with the display switched off**. If a blind user can call for roadside assistance, the app is well built.

### Passed when
Offline navigation works with the device in airplane mode · countdown renders over the lock screen and in Do Not Disturb · government map handles 10,000 incidents without jank · WCAG 2.1 AA passes a real screen-reader walkthrough (not just an automated scan) · APK ≤ 28 MB · cold start ≤ 2.0 seconds · ≤ 30 MB data per month.

---

## Your Key Design Decisions (defend these to the panel)

| Decision | Why |
|---|---|
| **One shared component library across 5 apps** | It is the only way one person ships five clients in 18 weeks. |
| **Three portals, one Next.js app** | Government, admin and fleet share a codebase with role-based routing instead of being three projects. |
| **System fonts, no custom font download** | Saves ~400 KB and renders all 8 Indian scripts correctly. Custom fonts routinely break Devanagari and Tamil. |
| **FlashList everywhere, never FlatList** | Long lists are where low-end Android devices actually fall over. |
| **`useOfflineQuery` as the single data pattern** | Offline becomes a property of the architecture rather than something re-implemented per screen. |
| **Confidence shown as words, not percentages** | "We're fairly sure" versus "this is a guess — a mechanic will confirm." Users cannot calibrate a 0.73. |
| **Animation auto-disabled on low-end devices** | Detected at runtime. Motion is a luxury; responsiveness is not. |
