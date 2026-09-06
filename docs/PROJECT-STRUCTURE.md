# RoadAssist Bharat — Project Structure

Every part of the codebase, divided by layer. The repository is already
physically organized this way (npm workspaces + separate `mobile/` and `ai/`
trees); this file is the map. Paths are relative to the repo root.

```
roadassist-bharat/
├── app/                  ← the platform (backend + web + database + docs + infra)
├── mobile/               ← native Android app (Kotlin + Compose)
├── ai/                   ← computer-vision toolchain (Python)
├── site/                 ← marketing & showcase pages (static)
├── docs/                 ← planning corpus + RAKSHA design docs
└── .github/workflows/    ← CI
```

---

## 1. BACKEND — `app/apps/api/`  (TypeScript · Fastify)

The HTTP API and all domain logic. One deployable, modular inside.

| File | Responsibility |
|---|---|
| `src/server.ts` | Route registration, error envelope, static + media serving, tile proxy, boot |
| `src/raksha.ts` | RAKSHA routes: device auth, detection ingest, road health, Trip Guardian, stats |
| `src/auth.ts` | OTP hashing, JWT issue/verify, rotating refresh, per-MSISDN & per-IP rate limits |
| `src/providers.ts` | SMS (console/Twilio/MSG91), maps, AI, payments adapters |
| `src/domain/booking-machine.ts` | Booking state machine (13 states, 15 commands) |
| `src/domain/ai-rules.ts` | Rules-based diagnosis + mechanic ranker (the AI fallback). Mirrored on-device by `apps/web/offline-engine.js`; a CI test fails the build if they diverge |
| `test/offline-engine.test.ts` | Off-Grid Mode's pure core: the device/cloud divergence guard, connectivity tiers, ids, digests, backoff |
| `src/realtime.ts` | SSE fan-out (ADR-0010) — one long-lived stream per client; persist first, publish second. At-most-once and in-process, stated at the definition |
| `src/ratelimit.ts` | Per-principal fixed windows on booking, payment, sync, offer-accept and stream opening. Shaped so a limit can never be what stops an SOS |
| `src/env.ts` | Config surface + `assertProductionSafe()` boot guards |
| `src/db.ts` | Drizzle client wiring |

## 2. DATABASE / MODELS — `app/packages/db/`  (Drizzle ORM · PostgreSQL + PostGIS)

The data models and everything that shapes the schema.

| Path | Responsibility |
|---|---|
| `src/schema/_shared.ts` | Base columns (id, timestamps, soft-delete, version), `geoPoint` helper |
| `src/schema/identity.ts` | users, otp_challenges, devices, sessions, roles, consents, emergency_contacts |
| `src/schema/fleet.ts` | vehicles, telemetry, DTC codes, diagnostic sessions/findings |
| `src/schema/service.ts` | service types, mechanics, bookings, offers, invoices, payments |
| `src/schema/ops.ts` | incidents (incl. off-grid: `client_incident_id`, `occurred_at`, `emergency_type`, `synced_at`), sync_operations, outbox, audit_log, gov tenancy, model_predictions |
| `src/schema/raksha.ts` | edge_devices, road_segments, raksha_detections, telemetry, road_health_scores |
| `src/migrate.ts` · `seed.ts` · `seed-raksha.ts` · `reset.ts` | Migration runner, seeders, reset guard |
| `drizzle/` | SQL migrations (0000–0004) + journal. `0004` adds the off-grid incident columns and the UNIQUE `client_incident_id` that makes a sync retry idempotent |
| `test/schema-conventions.test.ts` | Fitness tests that keep every model consistent |

## 3. FRONTEND (web) — `app/apps/web/`  (vanilla JS, served by the API)

| File | Responsibility |
|---|---|
| `ds.css` | Shared design system — light + dark tokens, type, motion, components |
| `sw.js` · `manifest.webmanifest` · `icon*.svg` | Service worker + PWA manifest — the app shell and map tiles survive a dead network |
| `index.html` | Demo client — full journey + offline queue |
| `offline-engine.js` | **Off-Grid Mode's pure core** (ADR-0009) — local rules diagnosis, ONLINE/LIMITED/OFF-GRID classification, incident + operation ids, canonical hashing, jittered backoff. No DOM, no network, no storage; unit-tested in Node |
| `offline-store.js` | On-device incidents + the encrypted store-and-forward sync journal (IndexedDB, AES-GCM-256 under a non-extractable device key), retention and purge |
| `connectivity.js` | The connectivity manager — probes `/v1/ping`, folds in `navigator.onLine`, the Network Information API and transport failures, and emits one tier for the whole app |
| `app.html` | Citizen app — OTP, diagnose, booking, hold-to-SOS, **off-grid SOS + off-grid incident screen**, live map, hazard reports, activity, contacts, Trip Guardian, offline queue |
| `map.html` | Live map — Leaflet, clustering, theme-aware basemap; embedded by the app and the Android WebView. Offline it draws the last cached snapshot under an "OFFLINE MAP — LAST UPDATED …" badge, and never presents stale pins as live |
| `mechanic.html` | Mechanic console — dispatch inbox, accept, drive the job to payment |
| `raksha.html` | Authority dashboard — live 3D map, road health, verify/close, offline export |
| `showcase.html` | Live 3D showcase — parallax hero, live stats, model-annotated feed, demo film |
| `assets/` | Real screenshots + model-annotated feed frames |

## 4. FRONTEND (mobile) — `mobile/`  (Kotlin · Jetpack Compose)

| Path | Responsibility |
|---|---|
| `app/src/main/java/in/roadassist/app/MainActivity.kt` | All screens: sign-in, home/SOS, booking, tracking |
| `app/src/main/java/in/roadassist/app/Api.kt` | API client (HttpURLConnection + org.json, zero deps) |
| `app/src/main/java/in/roadassist/app/Emergency.kt` | SOS fallback ladder: data → SMS → 112 → offline queue; real GPS |
| `app/src/main/java/in/roadassist/app/Theme.kt` | Light + dark palettes, `LocalRa`, `RoadAssistTheme` — the Kotlin twin of `ds.css` |
| `app/src/main/AndroidManifest.xml` · `res/` | Permissions, day/night themes, launcher icon, strings |
| `build.gradle.kts` · `settings.gradle.kts` · `gradle/` | Build config + wrapper |

## 5. AI / MODELS — `ai/`  (Python · Ultralytics + ONNX Runtime)

| Path | Responsibility |
|---|---|
| `road_damage/convert_voc_to_yolo.py` | RDD2022 VOC→YOLO conversion with the RAKSHA class mapping |
| `road_damage/detect.py` | Detector CLI → JSON in the ingest shape (loads .pt or .onnx) |
| `road_damage/annotate_feed.py` | Renders real model boxes onto real frames for the showcase |
| `requirements.txt` · `README.md` | Toolchain pin + reproduce steps |
| `runs/` (gitignored) | Trained weights (best.pt / best.onnx) |

## 6. DOCS — `app/docs/` and `docs/`

| Path | Responsibility |
|---|---|
| `app/docs/adr/0001–0008` | Architecture decisions (monolith, boundaries, PostGIS, offline, emergency, AI-first, RAKSHA module, device identity) |
| `app/docs/architecture/README.md` | C4 diagrams, event catalogue, degraded-mode matrix, API style |
| `app/docs/security/threat-model.md` | STRIDE threats → controls |
| `docs/raksha/00-requirements.md` | RAKSHA Phase-0 requirements + scenarios |
| `docs/raksha/05-dataset-license-verification.md` | Dataset/model license verification + measured results |
| `docs/00–05-*.md` | Team charter, master roadmap, four lead roadmaps |
| `docs/PROJECT-STRUCTURE.md` | This file |

## 7. DEVOPS / INFRA

| Path | Responsibility |
|---|---|
| `.github/workflows/ci.yml` | 3 CI jobs: verify (lint/typecheck/test/scan), integration (e2e + gateway vs real PostGIS), boundaries |
| `app/docker-compose.yml` | Local PostGIS + Redis + Redpanda |
| `app/scripts/check-boundaries.mjs` | Architecture fitness function |
| `app/scripts/e2e-journey.mjs` | 126-assertion end-to-end suite |
| `app/scripts/gateway-security-test.mjs` | 8-check gateway/OTP security suite |
| `app/scripts/raksha-simulator.mjs` | Edge simulator (SIMULATED / real-CV modes) |
| `app/.env.example` | All config keys, documented, no secrets |

---

### Why the layers are not merged into one tree

Each layer has a different toolchain (npm/TypeScript, Gradle/Kotlin, pip/Python)
and its own build, test, and dependency graph. Keeping them separate is what
lets CI test them independently, the boundary checker enforce module rules, and
each app build stay lean. The division above is the intended architecture, not
an accident of history.
```
