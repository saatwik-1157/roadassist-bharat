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
| `src/domain/ai-rules.ts` | Rules-based diagnosis + mechanic ranker (the AI fallback) |
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
| `src/schema/ops.ts` | incidents, sync_operations, outbox, audit_log, gov tenancy, model_predictions |
| `src/schema/raksha.ts` | edge_devices, road_segments, raksha_detections, telemetry, road_health_scores |
| `src/migrate.ts` · `seed.ts` · `seed-raksha.ts` · `reset.ts` | Migration runner, seeders, reset guard |
| `drizzle/` | Generated SQL migrations (0000–0003) + journal |
| `test/schema-conventions.test.ts` | Fitness tests that keep every model consistent |

## 3. FRONTEND (web) — `app/apps/web/`  (vanilla JS, served by the API)

| File | Responsibility |
|---|---|
| `index.html` | Demo client — full journey + offline queue |
| `app.html` | Citizen app — OTP, booking, SOS, Trip Guardian, offline maps |
| `raksha.html` | Authority dashboard — live 3D map, road health, verify/close, offline export |
| `showcase.html` | Live 3D showcase — parallax hero, live stats, model-annotated feed, demo film |
| `assets/` | Real screenshots + model-annotated feed frames |

## 4. FRONTEND (mobile) — `mobile/`  (Kotlin · Jetpack Compose)

| Path | Responsibility |
|---|---|
| `app/src/main/java/in/roadassist/app/MainActivity.kt` | All screens: sign-in, home/SOS, booking, tracking |
| `app/src/main/java/in/roadassist/app/Api.kt` | API client (HttpURLConnection + org.json, zero deps) |
| `app/src/main/java/in/roadassist/app/Emergency.kt` | SOS fallback ladder: data → SMS → 112 → offline queue; real GPS |
| `app/src/main/AndroidManifest.xml` · `res/` | Permissions, theme, launcher icon, strings |
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
| `app/scripts/e2e-journey.mjs` | 87-assertion end-to-end suite |
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
