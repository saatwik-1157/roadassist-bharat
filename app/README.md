# RoadAssist — Application

> Cloud-native, offline-first roadside assistance platform for India.
> SWE4004 Cloud Computing and Applications · Review 1

**Current status: the Review 2 vertical slice runs end to end.** One complete
journey — sign in, add a vehicle, diagnose, dispatch, track, complete, pay, plus
offline replay and the emergency path — against real PostgreSQL + PostGIS.

```bash
npm run infra:up && npm run db:migrate && npm run db:seed   # once
npm start                                                   # → http://localhost:4000
npm run verify && npm run test:e2e                          # 9 unit + 84 end-to-end
```

---

## Scope

| Phase | Deliverable | Status |
|---|---|---|
| 0 · Research | Problem validation, integration feasibility, constraints | ✅ [`../docs/`](../docs/) |
| 1 · Planning | Backlog, repo scaffold, CI pipeline, quality gates | ✅ |
| 2 · Architecture | C4 diagrams, 6 ADRs, event catalogue, API style guide, threat model | ✅ [`docs/`](docs/) |
| 3 · Database | 56 tables migrated, ~38k seeded rows, GiST + partial indexes | ✅ |
| 4 · Auth | OTP → JWT, rotating refresh with reuse detection, RBAC + device identity (ADR-0008) | ✅ |
| 5 · APIs | Booking state machine, PostGIS dispatch, diagnosis, sync, SOS | ◐ slice complete, full surface pending |
| 6 · Frontend | Demo client at `/`, citizen app at `/app.html`, RAKSHA map at `/raksha.html` | ◐ web only; no React Native app |
| 7 · AI | Rules engine + trained CV model: YOLO11n on RDD2022-India full set (5.4 MB, mAP50 0.443, see ai/) | ◐ baseline model live; GPU training is the path up |
| R · RAKSHA | Edge simulator → offline queue → idempotent sync → segments → road health → authority verify/close | ◐ MVP slice live, detector SIMULATED (ADR-0007) |
| 8+ | SMS/IVR gateway, government portal, analytics, real CV model | ⏸ not started |

### RAKSHA — autonomous road monitoring (MVP slice)

Every RAKSHA event on this build is **SIMULATED** — the detector is a labeled
deterministic generator (`sim-rules-0.1.0`), not a trained model.

```bash
npm run db:seed:raksha                  # demo admin (+919999900001) + NH-48 segments
node scripts/raksha-simulator.mjs       # offline patrol → sync → replay (idempotent) → road health
# dashboard: http://localhost:4000/raksha.html  ·  citizen app: /app.html
```

**Measured, not asserted:** nearest-mechanic dispatch at 19.8 ms · emergency
escalation at ~30 ms · 84 end-to-end assertions covering illegal transitions,
idempotent replay, refresh-token theft detection and cross-tenant isolation.

---

## Layout

```
app/
├── docs/
│   ├── adr/                  6 architecture decision records
│   ├── architecture/         C4 diagrams · events · degraded modes · API style guide
│   └── security/             STRIDE threat model, 20 threats mapped to controls
├── packages/
│   └── db/                   Drizzle schema (5 modules, ~45 tables) — Phase 3 draft
├── scripts/
│   └── check-boundaries.mjs  Architecture fitness function (ADR-0002)
├── .github/workflows/ci.yml  lint · typecheck · test · secret scan · boundaries
└── docker-compose.yml        PostGIS · Redis · Redpanda
```

---

## Quick start

```bash
npm install
npm run typecheck                    # schema compiles
node scripts/check-boundaries.mjs    # module boundaries hold
```

When you reach Phase 3, bring up the local cloud stand-in and apply the schema:

```bash
npm run infra:up
npm run db:generate && npm run db:migrate && npm run db:seed
```

> Requires Docker Desktop running. Postgres is published on **5434** so it does not
> collide with other local projects already using 5432 and 5433.

---

## Architecture in one paragraph

One modular-monolith deployable with five enforced modules, plus **one exception**:
the emergency service is deployed separately with its own quota and a degraded SMS
path that shares no runtime dependency with the platform — so an SOS survives a full
platform outage ([ADR-0005](docs/adr/0005-emergency-isolation.md)). All AI ships
rules-first behind a stable contract, so killing the AI service leaves a working
product ([ADR-0006](docs/adr/0006-ai-rules-first.md)). Offline conflict rules were
decided before any sync code was written, and booking state is always
server-authoritative ([ADR-0004](docs/adr/0004-offline-conflict-rules.md)).

Start with [`docs/architecture/README.md`](docs/architecture/README.md).

---

## Team

| | Owner | Area |
|---|---|---|
| P1 | V Saatwik Sairaam (24MIC7131) | Backend, database, API contracts |
| P2 | P Sai Nirisha Chowdary (24MIC7122) | Frontend, mobile, offline client |
| P3 | T V S Jignesh (24MIC7190) | AI services, data pipeline |
| P4 | G Parthavi (24MIC145) | DevOps, QA, security, CI/CD |
