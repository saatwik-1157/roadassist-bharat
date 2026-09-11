# RoadAssist Bharat

> **One Platform. Every Vehicle. Every Phone. Every Road.**
>
> **AI-powered · cloud-connected · network-resilient.**
> *"RoadAssist doesn't stop when the network stops."*

An AI-powered, cloud-connected, network-resilient emergency mobility platform for
India — designed to keep protecting and assisting people when connectivity becomes
unreliable. It covers cars, two-wheelers, autos, trucks, buses, tractors and EVs,
and is built for the roads where coverage is worst: highways, rural routes, remote areas,
mountains, disaster zones, monsoon disruption and low-connectivity regions.

**Client surfaces that exist today:** a progressive web app (citizen, mechanic and
authority consoles), a native Android client, and a feature-phone path over SMS —
`POST /v1/telecom/sms` supports a complete booking without a smartphone. iOS,
Android Auto, IVR and USSD are **designed and not built**; they are named in the
roadmap, not in this release.

**[Off-Grid Mode](app/docs/adr/0009-offgrid-mode.md)** is the architectural answer.
The client distinguishes `ONLINE`, `LIMITED` and `OFF-GRID`; an SOS with no signal
becomes a real incident stored on the device with its own reference, GPS fix and
encrypted sync journal, and it says so plainly rather than pretending it was sent.
Diagnosis runs on-device against the same rule table the server uses. When
connectivity returns, the journal forwards itself — idempotently, so a retry never
becomes a second ambulance.

---

## Documentation

**[docs/README.md](docs/README.md) indexes all 56 documents** and says which are
kept current and which are dated evidence for v1.0.0-RC1 — they age differently.
[CLAUDE.md](CLAUDE.md) covers running and changing the repo.

## Planning documents

| Document | Contents |
|----------|----------|
| [Team Charter](docs/00-team-charter.md) | Team composition, RACI, rituals, sprint calendar, git/PR/commit rules, code review checklist, Definition of Done, documentation standards, quality gates, risk register |
| [Master Roadmap](docs/01-master-roadmap.md) | All 18 phases with objectives/tasks/dependencies/deliverables/acceptance criteria, target architecture, why each service exists, business model |
| [D1 — Backend & Data Lead](docs/02-backend-lead-roadmap.md) | Per-phase plan: schema (60 tables planned; 56 shipped), 140 APIs, booking state machine, dispatch, auth/RBAC, sync conflict resolution, emergency engine |
| [D2 — Frontend & Mobile Lead](docs/03-frontend-lead-roadmap.md) | Per-phase plan: design system, 48 screens, 42 components, offline client, maps, gov portal, accessibility, 8 languages |
| [D3 — AI & Data Science Lead](docs/04-ai-lead-roadmap.md) | Per-phase plan: 9 AI systems with inputs/outputs/algorithms/training data/metrics/baselines, on-device bundle, analytics |
| [D4 — DevOps, QA & Security Lead](docs/05-devops-qa-lead-roadmap.md) | Per-phase plan: K8s/Terraform/CI-CD, observability, telecom gateway, load/chaos/security testing, deployment, DR |

---

## Team

Ownership across all 18 phases of the plan — **not** a description of what
ships today. Several things named here are roadmap (React Native, Next.js,
Android Auto, Kubernetes, Terraform, 8 languages, the 9-subsystem AI suite);
what actually exists is the list at the top of this file, and the shipped web
surfaces are plain HTML/CSS/JS served by the API with no build step.

| ID | Role | Owns (planned) |
|----|------|------|
| D1 | Backend & Data Lead | Services, PostgreSQL/PostGIS, event bus, API contracts, auth, booking/dispatch, emergency, payments |
| D2 | Frontend & Mobile Lead | React Native app, Next.js portals, design system, offline client, maps UI, Android Auto, a11y, i18n |
| D3 | AI & Data Science Lead | 9 AI subsystems, model training/serving, on-device inference, feature store, voice/NLU, analytics |
| D4 | DevOps, QA & Security Lead | Kubernetes, Terraform, CI/CD, observability, all testing, security, telecom gateway, compliance |

---

## Timeline

22 weeks · 11 sprints of 2 weeks · 18 phases · 10 milestones

| Sprint | Weeks | Phases | Milestone |
|--------|-------|--------|-----------|
| S0 | 1–2 | Research, Planning | M0 — Baseline frozen |
| S1 | 3–4 | Architecture, Database | M1 — Skeleton alive |
| S2 | 5–6 | Auth, Backend APIs (I) | M2 — Login works |
| S3 | 7–8 | Backend APIs (II), Frontend (I) | M3 — First booking |
| S4 | 9–10 | Frontend (II), AI (I) | M4 — Vertical slice |
| S5 | 11–12 | AI (II), Offline Engine | M5 — Works with no internet |
| S6 | 13–14 | Maps, Vehicle Diagnostics | M6 — Diagnose & route |
| S7 | 15–16 | Emergency, Gov Dashboard | M7 — Crash to responder |
| S8 | 17–18 | Analytics, Testing | M8 — Quality bar |
| S9 | 19–20 | Deployment, Optimization | M9 — Production |
| S10 | 21–22 | Future Roadmap, GA hardening | M10 — GA + pitch |

---

## Non-negotiables

1. **Emergency paths never regress.** Two approvals, dedicated test run, staged
   rollout — and, since the ladder's decisions moved into `SosLadder.kt`, 18
   tests that run on every push.
2. **Offline is a first-class mode, not a fallback.** And we never claim something
   reached the cloud when it did not — the app says "stored on this device", with a
   reference, or it says nothing at all.
3. **Feature phones are users.** Every core journey completable over SMS — in
   English or Hindi, switched by texting `LANG HI`. (IVR is not built.)
4. **No PII leaves India.** Including logs, backups, and crash reports.
5. **We never fake it in a demo.** If it's mocked, we say so.

---

*Status: the Review-2 vertical slice runs end to end (see [app/](app/)) — 615 assertions executed across six suites with no failures — 98 unit, 189 e2e, 65 concurrency/real-time, 74 security, 26 gateway security, 163 browser. A seventh suite, 22 payment-gateway checks, runs only against a Razorpay sandbox account and is deliberately not run here. **Off-Grid Mode** ships the network-resilient emergency path end to end (ADR-0009); satellite communication, mesh networking and government emergency-network integration are named as future work and are not implemented. The **RAKSHA** autonomous road-monitoring extension (edge devices, offline detection sync, road health, authority map) has its MVP slice live; requirements in [docs/raksha/](docs/raksha/00-requirements.md), decisions in ADR-0007/0008.*
