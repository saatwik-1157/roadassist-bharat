# RoadAssist Bharat

> **One Platform. Every Vehicle. Every Phone. Every Road.**

An offline-first, AI-powered roadside assistance and vehicle-safety platform for India — spanning cars, two-wheelers, autos, trucks, buses, tractors, and EVs, across Android, iOS, web, Android Auto, and feature phones (SMS/IVR/USSD).

---

## Planning documents

| Document | Contents |
|----------|----------|
| [Team Charter](docs/00-team-charter.md) | Team composition, RACI, rituals, sprint calendar, git/PR/commit rules, code review checklist, Definition of Done, documentation standards, quality gates, risk register |
| [Master Roadmap](docs/01-master-roadmap.md) | All 18 phases with objectives/tasks/dependencies/deliverables/acceptance criteria, target architecture, why each service exists, business model |
| [D1 — Backend & Data Lead](docs/02-backend-lead-roadmap.md) | Per-phase plan: schema (60 tables), 140 APIs, booking state machine, dispatch, auth/RBAC, sync conflict resolution, emergency engine |
| [D2 — Frontend & Mobile Lead](docs/03-frontend-lead-roadmap.md) | Per-phase plan: design system, 48 screens, 42 components, offline client, maps, gov portal, accessibility, 8 languages |
| [D3 — AI & Data Science Lead](docs/04-ai-lead-roadmap.md) | Per-phase plan: 9 AI systems with inputs/outputs/algorithms/training data/metrics/baselines, on-device bundle, analytics |
| [D4 — DevOps, QA & Security Lead](docs/05-devops-qa-lead-roadmap.md) | Per-phase plan: K8s/Terraform/CI-CD, observability, telecom gateway, load/chaos/security testing, deployment, DR |

---

## Team

| ID | Role | Owns |
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

1. **Emergency paths never regress.** Two approvals, dedicated test run, staged rollout.
2. **Offline is a first-class mode, not a fallback.**
3. **Feature phones are users.** Every core journey completable over SMS/IVR.
4. **No PII leaves India.** Including logs, backups, and crash reports.
5. **We never fake it in a demo.** If it's mocked, we say so.

---

*Status: the Review-2 vertical slice runs end to end (see [app/](app/)) — 9 unit + 82 e2e assertions. The **RAKSHA** autonomous road-monitoring extension (edge devices, offline detection sync, road health, authority map) has its MVP slice live; requirements in [docs/raksha/](docs/raksha/00-requirements.md), decisions in ADR-0007/0008.*
