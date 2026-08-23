# RAKSHA — Phase 0: Research & Requirements

> **RAKSHA — Autonomous Remote Road & Infrastructure Safety Intelligence**
> "Every Vehicle. Every Road. Even Where Nobody Is Watching."
>
> Status: MVP requirements baseline · 2026-08-23
> Everything simulated in the MVP is labeled **SIMULATED**. Nothing here claims
> official government classification, guaranteed prediction, or field-proven
> battery life. Those claims require measurement and verification we have not done.

---

## 1. Problem statement

Large parts of India's road network — remote highways, forest and mountain
roads, flood-prone corridors, mining roads — have no permanent personnel, no
CCTV, poor cellular coverage, unreliable power, and long response times. Road
damage and obstructions in these places go unreported until a vehicle hits
them. RoadAssist Bharat reacts when a *person* asks for help; RAKSHA adds the
layer that notices problems **when nobody is present to report them**.

## 2. Objectives

1. Detect road-surface problems (potholes, damage, obstructions) autonomously
   from camera imagery on an edge device, with GPS attached to every event.
2. Keep operating with zero connectivity: detect, store, and queue locally;
   synchronize idempotently when a network returns.
3. Give authorities a map view, a transparent Road Health Score, and a
   verify → maintain → close workflow.
4. Never regress an existing RoadAssist Bharat journey (booking, SOS, SMS).

## 3. Scope (MVP) and non-goals

**MVP scope:** pothole / road-damage / obstruction detections · GPS attach ·
offline local storage and queue · idempotent sync into the existing platform ·
web map · rule-based Road Health Score 0–100 · device identity · authority
verify/close actions · an **edge simulator** so no hardware purchase is needed.

**Non-goals (MVP):** wildlife/species classification, fire detection,
landslide/rockfall prediction, satellite links, LoRa, real 112 dispatch,
automatic repair verification, any claim of official road-safety scoring.
These arrive in later phases (11–13) or remain out of scope.

## 4. Personas

| Persona | Need |
|---|---|
| Highway authority engineer | See where the road is failing without driving it |
| Road maintenance worker | A prioritized, located list of confirmed defects |
| RoadAssist dispatcher | Avoid routing tow trucks through blocked/damaged segments |
| Citizen driver (existing) | Their journeys must keep working, unchanged |
| RAKSHA device (machine principal) | Authenticate, upload detections, heartbeat — never anonymously |

## 5. Remote-area scenarios & acceptance criteria

| # | Scenario | Acceptance criteria |
|---|---|---|
| 1 | Pothole detected at night on a remote highway | Detection created with type, confidence, severity 1–5, GPS, device id, capture timestamp; visible on the authority map after sync |
| 2 | Fallen tree blocks a forest road | Obstruction detection; if severity ≥ 4 and confidence ≥ 0.75, an incident is raised in AWAITING_CONFIRMATION — **never auto-dispatched** (ADR-0005) |
| 3 | Heavy rain causes waterlogging | Phase 11 — out of MVP; recorded as environmental event when sensors exist |
| 4 | Possible accident, no person nearby | Phase 13 — must integrate with the existing incident confirm-before-dispatch flow |
| 5 | Wildlife on the road | Phase 12 — out of MVP; no harmful control mechanisms, ever |
| 6 | Network disappears | Detection, GPS, and local storage continue; events queue locally with original timestamps; system stays up |
| 7 | Power becomes limited | Design duty-cycle modes NORMAL / LOW_POWER / EMERGENCY; MVP simulator reports battery in heartbeats; real consumption is **measured, not claimed**, in the hardware phase |
| 8 | Connectivity returns | Queue replays automatically in batches; every operation carries a device-generated `opId`; replaying the same batch produces `duplicate`, never a second row; capture timestamps preserved |

## 6. Functional requirements (MVP)

- FR1 Device registration by an authorized human (ADMIN or GOV_OFFICER role); a one-time credential is issued; hash-only storage.
- FR2 Device token exchange (deviceId + secret → short-lived JWT with role `device`).
- FR3 Batched detection upload (≤200/batch), idempotent on `opId`, each with type, confidence 0–1, severity 1–5, lat/lng, capture time, model version, fallback flag, optional image reference (never the raw frame in the DB).
- FR4 Device heartbeat: battery %, storage %, uptime, queue depth, position.
- FR5 Detections auto-attach to the nearest road segment within 250 m (PostGIS).
- FR6 Road Health Score 0–100 per segment, recomputed on demand, with a factor breakdown that shows exactly why.
- FR7 Authority actions: verify, reject, close a detection (role-gated).
- FR8 Map dashboard: detection markers, segment lines colored by health, device list, filters.
- FR9 Every model inference logged to `model_predictions` (hash of input, never the input).
- FR10 High-severity obstruction raises an incident **signal** for human confirmation — reuses the existing ADR-0005 flow.

## 7. Non-functional requirements

- Offline is first-class: no RAKSHA feature may require live connectivity on the device side except sync itself.
- Sync of 100 queued detections must meet the platform target (p95 < 8 s on 3G).
- No PII leaves India (inherited, absolute). Camera frames may contain faces/plates: the MVP stores **no imagery** server-side, only references; the privacy pipeline (blurring, retention) is a Phase 17 gate before any real camera deployment.
- Devices can never upload anonymously (FR1/FR2); per-device attribution on every row.
- Emergency paths never regress: RAKSHA adds zero runtime dependencies to the SOS/SMS degraded path.

## 8. Hardware requirements (staged — nothing purchased for MVP)

| Stage | Hardware | Status |
|---|---|---|
| STUDENT PROTOTYPE (now) | None. Software simulator + sample imagery + mock GPS/sensors | **SIMULATED** — this is the MVP |
| FIELD PILOT | Raspberry Pi-class computer + camera + GPS module + ESP32 + basic sensors (temp/humidity/rain/water/IMU) | verify current prices before purchase |
| PRODUCTION CANDIDATE | Jetson-class edge computer, industrial camera, solar + battery (duty-cycled), 4G + LoRa fallback, rugged enclosure | requirements only; no cost or battery-life claims without measurement |

## 9. AI requirements

- Detection classes (MVP): `pothole`, `road_damage`, `obstruction`.
- Ships **rules-first** behind the ADR-0006 contract; the MVP "model" is a
  deterministic simulated detector labeled `sim-rules-0.1.0` (SIMULATED).
- A real CV model (YOLO-family or comparable) enters at Phase 5 only after
  dataset and license verification with live sources. **Note:** the candidate
  dataset reference "mitangshu11" is UNVERIFIED — source, license, classes and
  suitability must be checked before any training claim. Ultralytics YOLOv8/11
  is AGPL-3.0, which constrains commercial deployment; permissively-licensed
  alternatives must be evaluated alongside it.
- Metrics to track from Phase 5: precision, recall, F1, mAP, inference latency, FPS, model size (target ≤ 15 MB for edge).

## 10. IoT / GIS / offline / data requirements

- Sensors are behind hardware-abstraction interfaces; mock implementations first (Phase 10).
- All geometry in PostGIS: points as `geometry(Point,4326)`, segments as `geometry(LineString,4326)`, GiST-indexed; dual referencing lat/lng + linear marker ("NH-48, KM 212") matching the platform convention.
- Device-side storage: append-only local queue keyed by `opId`; survives restart; tolerates full storage by dropping lowest-severity oldest events first (documented, logged).
- Clock skew: device `capturedAt` is preserved as data; server `createdAt` is authority for ordering disputes.

## 11. Security & privacy requirements

- Device credentials: 32-byte random secret, shown once, stored as SHA-256; constant-time comparison; rotation by re-registration (MVP) → dedicated rotation endpoint (Phase 3 hardening).
- RBAC: `device` is a claim-level role; verify/close require ADMIN or GOV_OFFICER.
- Rate limiting for device ingestion and a per-device flood defence: Phase 17 (documented gap until then).
- DPDP Act 2023: a `road_monitoring` consent purpose is added; k-anonymity (k ≥ 10) applies to any government-facing aggregate (Phase 14), building on the existing `gov_queries` suppression fields.

## 12. Deployment requirements

MVP runs on the existing local stack (docker-compose PostGIS/Redis/Redpanda + the Fastify API). No Kubernetes. First Dockerfile and CI integration tests arrive in Phase 17.
