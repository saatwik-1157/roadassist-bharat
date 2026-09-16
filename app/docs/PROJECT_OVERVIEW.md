# RoadAssist Bharat — project overview

**AI-powered · cloud-connected · network-resilient emergency mobility platform.**

> *"RoadAssist doesn't stop when the network stops."*

SWE4004 Cloud Computing and Applications · VIT-AP University ·
Dr. Nagendra Panini Challa.

---

## The problem, in one paragraph

A breakdown on an Indian highway is not a software problem until you notice that
the app you would use to fix it needs the network you do not have. Coverage is
worst exactly where a breakdown is most dangerous, and a roadside-assistance app
that shows a spinner is worse than no app at all — because the person believes
help is coming.

## What we built

One platform from incident to resolution, and one thing nobody else in the
cohort has: an emergency workflow that runs entirely on the device.

```
DRIVER → ROADASSIST → AI + INCIDENT INTELLIGENCE → DISPATCH → MECHANIC → RESOLUTION
                              │
                    (no network?)  →  LOCAL EMERGENCY ENGINE
                                       GPS · rules diagnosis · cached maps
                                       encrypted journal → sync on reconnect
```

## Capabilities, with status

`IMPLEMENTED` means the code exists, the database persists it, the UI consumes
it, **and** a test exercises it.

| Capability | Status | Evidence |
|---|---|---|
| OTP auth, rotating refresh with theft detection | **IMPLEMENTED** | e2e §2, security §6 |
| Vehicles, bookings, invoicing, payment, reviews | **IMPLEMENTED** | e2e, browser |
| AI-assisted diagnosis | **PARTIAL** | Deterministic rules engine — labelled as such. A trained YOLO11n for road damage does exist (mAP50 0.443, measured) |
| Dynamic dispatch — rank, wave, timeout, escalate | **IMPLEMENTED** | concurrency §1, §2, §9b, §9c |
| Race-safe assignment | **IMPLEMENTED** | ten simultaneous accepts, exactly one wins |
| Emergency SOS — online | **IMPLEMENTED** | e2e §12 |
| **Emergency SOS — offline** | **IMPLEMENTED** | browser §7b, end to end |
| Offline storage, survives app restart | **IMPLEMENTED** | IndexedDB + AES-GCM-256 |
| Store-and-forward sync, no duplicates | **IMPLEMENTED** | concurrency §4, §5 |
| Real-time status (SSE) | **IMPLEMENTED** | measured 65 ms |
| Secure payments | **IMPLEMENTED** | sandbox only — never a live account |
| Tamper-evident audit trail | **IMPLEMENTED** | hash chain, verified live and after restore |
| Feature-phone SMS journey | **IMPLEMENTED** | inbound; outbound needs a vendor |
| RAKSHA road monitoring | **PARTIAL** | detector labelled `SIMULATED` |
| Fleet / analytics | **PARTIAL** | schema and roles exist; ops counts only |
| Cloud autoscaling, replication, load balancing | **TARGET** | designed; no cluster provisioned |
| ERSS 112 handoff | **TARGET** | stub — the API response says so |
| Satellite, mesh, gov-network integration | **FUTURE** | not implemented, not claimed |

## The system, as it runs today

One container serving three web surfaces plus the API, and one PostGIS database.

- **56 tables**, 62 foreign keys, 138 indexes, 5 GiST spatial indexes,
  5 migrations
- **64 routes**, 61 of them under `/v1`, uniform `{data, meta}` / `{error}` envelope
- **6 web surfaces**: citizen app, mechanic console, authority dashboard, live
  map, landing, showcase
- **10 ADRs**, an enforced module-boundary check, and a 20-row failure matrix

## Verification

**636 assertions executed across six suites, no failures** (a seventh, 22 payment-gateway checks, needs a Razorpay sandbox account), against a real
PostgreSQL + PostGIS and a real Chrome:

| Suite | Assertions |
|---|---|
| Unit | 61 |
| End-to-end | 189 |
| Concurrency + real-time | 65 |
| Security (attacks that must fail) | 74 |
| Gateway security | 26 |
| Payment sandbox | 22 |
| Browser / offline | 163 |

Plus: clean typecheck, zero lint errors, module boundaries clean, a production
Docker image that the full suite passes **against**, and a rehearsed
backup/restore in which the audit hash chain verified intact.

## Measured performance

Single-user, local database — **not** a load test:

booking detail 31 ms · **dispatch ~100 ms** (the heaviest path) · off-grid sync
51 ms · live status delivery **65 ms**.

Ping, health, diagnose, the booking list, map and SSE-first-frame are **under
15 ms and not quoted as figures**. `npm run perf` probes its own measurement
floor and marks them: on this machine `/v1/ping` medians ~15 ms while its
fastest sample is ~1 ms, so a "14 ms" there describes the measurement, not the
endpoint. Only numbers clear of that floor are stated.

## What is honestly not done

1. Nothing is deployed to a cloud — no account, no domain, no cluster.
2. Single instance only: SSE registry, rate limiter and offer sweeper are
   in-process.
3. The 112 handoff is a stub; emergency isolation (ADR-0005) is a design.
4. Payments verified against a local stub, never a real Razorpay account.
5. No load test, no external penetration test.

Each of these is stated in the code, the documentation **and** the slides.

## Where to go next

[`docs/README.md`](README.md) is the index. For the fastest picture of what
makes this project different, read [`OFFLINE.md`](OFFLINE.md).
