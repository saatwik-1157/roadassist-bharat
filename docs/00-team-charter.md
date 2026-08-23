# RoadAssist Bharat — Team Charter & Engineering Constitution

> "One Platform. Every Vehicle. Every Phone. Every Road."
> Document owner: CTO · Version 1.0 · Status: Baseline (frozen at Sprint 0 exit)

---

## 1. Team Composition

Four engineers. Every person is a **Lead** — meaning they own an architectural vertical end-to-end, not a ticket queue. No one is a "helper."

| ID | Role | Owns | Secondary (backup) |
|----|------|------|--------------------|
| **D1** | Backend & Data Lead | All Node/NestJS services, PostgreSQL/PostGIS schema, Kafka event bus, API contracts, payments | Backs up D3 on AI-gateway plumbing |
| **D2** | Frontend & Mobile Lead | React Native app, Next.js portals (Gov / Mechanic / Admin), design system, offline UI, Android Auto | Backs up D4 on E2E test authoring |
| **D3** | AI & Data Science Lead | All 9 AI subsystems, model training/serving, on-device TFLite, telemetry feature store, IVR/NLU | Backs up D1 on analytics service |
| **D4** | DevOps, QA & Security Lead | Kubernetes, Terraform, CI/CD, observability, load/security testing, SMS/IVR gateway ops, compliance | Backs up D2 on portal builds |

**Rotating hats** (1 sprint each, round-robin):
- **Release Captain** — owns the sprint's release train, cuts the tag, writes release notes.
- **Incident Commander** — on-call for staging/prod, runs postmortems.
- **Scribe** — keeps ADRs and the decision log current.

**Named slots** (fill in):
```
D1 = ____________________   D2 = ____________________
D3 = ____________________   D4 = ____________________
```

---

## 2. Ownership Matrix (RACI)

| Area | D1 | D2 | D3 | D4 |
|------|----|----|----|----|
| System architecture / ADRs | **A** | C | C | C |
| Database schema & migrations | **A/R** | I | C | C |
| API contract (OpenAPI/proto) | **A/R** | C | C | I |
| Auth, RBAC, token lifecycle | **A/R** | C | I | C |
| Booking / Dispatch engine | **A/R** | C | C | I |
| Mobile app (RN) | C | **A/R** | I | C |
| Web portals (Next.js) | C | **A/R** | I | C |
| Design system & a11y | I | **A/R** | I | I |
| Offline DB + sync client | C | **A/R** | C | I |
| Sync conflict resolution (server) | **A/R** | C | I | I |
| AI models & training | I | I | **A/R** | C |
| On-device inference (TFLite/ONNX) | I | C | **A/R** | I |
| Voice assistant / IVR NLU | I | C | **A/R** | C |
| Maps, routing, geofencing | C | C | C | **A/R** shared with D1 |
| Emergency (112 / SOS) engine | **A/R** | C | C | C |
| Government dashboard | C | **A/R** | C | I |
| Analytics / ClickHouse | C | I | **A/R** | C |
| Kubernetes, Terraform, CI/CD | I | I | I | **A/R** |
| Observability & SLOs | C | C | C | **A/R** |
| Security testing & pentest | C | C | C | **A/R** |
| Load & chaos testing | C | I | C | **A/R** |
| DPDP / compliance evidence | C | I | C | **A/R** |
| Pitch deck / business model | C | C | C | C — **A** = CTO |

A = Accountable · R = Responsible · C = Consulted · I = Informed

---

## 3. Cadence

### Daily
- **09:45 IST — Standup (12 min, hard stop).** Format below. Async in Slack `#ra-standup` if anyone is travelling.
- **Focus block 10:00–13:00.** No meetings, no PR review, notifications off.
- **16:30 — PR sweep.** Every open PR must be reviewed or explicitly deferred with a reason.
- **18:00 — Green build gate.** `main` must be green at EOD. Whoever broke it fixes it or reverts it.

**Standup format (each person, 3 lines max):**
```
Yesterday : <shipped thing + PR link>
Today     : <one primary outcome>
Blocked   : <blocker + who unblocks it, or "none">
```
Discussion is deferred to a "parking lot" after the 12 minutes with only the affected people.

### Weekly
| Day | Ritual | Duration | Who |
|-----|--------|----------|-----|
| Mon | Sprint planning (odd weeks) / Mid-sprint checkpoint (even weeks) | 60 min | All |
| Tue | Architecture review — ADRs raised last week | 45 min | All |
| Wed | Design review — Figma → build parity | 30 min | D2 + 1 |
| Thu | Risk & security review — new threats, dependency CVEs | 30 min | D4 + all |
| Fri | Demo (recorded, 20 min) + Retro (25 min) | 45 min | All |

### Sprint
2 weeks. 10 working days. Capacity per person per sprint: **8 ideal days** (2 days reserved for review, support, and unplanned work). Team velocity target: **32 ideal days/sprint**.

Sprint ends with:
1. A recorded demo of working software (never slides).
2. A tagged release `v0.<sprint>.0` deployed to staging.
3. A retro with at most **2 action items**, each with an owner and a due date.

---

## 4. Sprint Calendar & Milestones

| Sprint | Weeks | Phases covered | Milestone |
|--------|-------|----------------|-----------|
| S0 | 1–2 | P0 Research, P1 Planning | **M0 — Baseline frozen**: PRD, ADR-000..010, repo scaffolded, CI green |
| S1 | 3–4 | P2 Architecture, P3 Database | **M1 — Skeleton alive**: all services boot, migrations run, ER diagram signed off |
| S2 | 5–6 | P4 Auth, P5 Backend APIs (I) | **M2 — Login works**: OTP → JWT → RBAC across 3 client types |
| S3 | 7–8 | P5 Backend APIs (II), P6 Frontend (I) | **M3 — First booking**: end-to-end request → mechanic accept → complete |
| S4 | 9–10 | P6 Frontend (II), P7 AI (I) | **M4 — Vertical slice**: mobile app + live dispatch on a map |
| S5 | 11–12 | P7 AI (II), P8 Offline Engine | **M5 — Works with no internet**: airplane-mode booking that syncs |
| S6 | 13–14 | P9 Maps, P10 Vehicle Diagnostics | **M6 — Diagnose & route**: OBD/photo diagnosis + offline routing |
| S7 | 15–16 | P11 Emergency, P12 Gov Dashboard | **M7 — Crash to responder**: auto-detect → SOS → 112 handoff → gov map |
| S8 | 17–18 | P13 Analytics, P14 Testing | **M8 — Quality bar**: ≥80% coverage, load test 10k RPS passed |
| S9 | 19–20 | P15 Deployment, P16 Optimization | **M9 — Production**: multi-AZ prod, DR drill passed, p95 < 300 ms |
| S10 | 21–22 | P17 Future Roadmap + GA hardening | **M10 — GA + pitch**: public beta, pitch deck, pilot MoU draft |

---

## 5. Git Workflow

### Branching model — Trunk-based with short-lived branches
```
main ──────●────────●────────●────────●──────►  (always deployable, protected)
            \      / \      / \      /
             feat/  ..  feat/  ..  fix/        (max 3 days alive)
release/v1.0 ──────────●───────────────────►   (cut only for GA; hotfix source)
```

- `main` is protected. No direct pushes. Squash-merge only.
- Branch lifetime **≤ 3 days**. If it lives longer, it was scoped wrong — split it.
- Feature flags (`unleash`) over long-lived branches. Always.
- `release/vX.Y` cut at GA. Hotfixes branch from it and cherry-pick back to `main`.

### Branch naming
```
<type>/<phase>-<owner>-<short-kebab-summary>

feat/p05-d1-booking-state-machine
fix/p08-d2-sync-conflict-toast
chore/p15-d4-argocd-bootstrap
model/p07-d3-crash-detect-v2
docs/p02-d1-adr-012-event-bus
spike/p10-d3-obd-ble-feasibility
```
Types: `feat` `fix` `chore` `refactor` `perf` `test` `docs` `model` `spike` `hotfix`

### Commit naming — Conventional Commits, enforced by commitlint
```
<type>(<scope>): <imperative summary, ≤72 chars>

<body: why, not what — wrap at 100>

Refs: RA-142
BREAKING CHANGE: booking.status enum renamed PENDING→REQUESTED
```
Scopes: `auth` `booking` `dispatch` `vehicle` `maps` `emergency` `notify` `sync` `analytics` `gov` `ai` `mobile` `web` `infra` `db`

Good:
```
feat(dispatch): rank mechanics by ETA-adjusted acceptance probability
fix(sync): drop tombstoned rows before applying remote patch
```
Bad: `update code`, `fixes`, `WIP`, `final final`

---

## 6. Pull Request Rules

**Hard rules — CI blocks the merge:**
1. PR diff ≤ **400 changed lines** (excluding lockfiles, generated code, snapshots). Larger needs an explicit `size/xl` label plus CTO approval.
2. **1 approving review minimum, 2 for**: DB migrations, auth/crypto, payment flows, emergency service, anything touching PII.
3. The reviewer must **not** be the author's backup for that area on trivial PRs — rotate reviewers so knowledge spreads.
4. All CI gates green: lint, typecheck, unit, integration, coverage delta ≥ 0, SAST, dependency audit, license check, container scan.
5. PR description uses the template. An empty template body = automatic request-changes.
6. Migrations must include a tested **down** path or an explicit "forward-only, approved by D1" note.
7. No `TODO` without a ticket ID. No commented-out code. No `console.log` in shipped paths.
8. Review SLA: **first response within 4 working hours**. If you can't, reassign — don't sit on it.

**PR template:**
```markdown
## What
One paragraph. What changed, in user terms.

## Why
Link the ticket / ADR. What problem does this solve?

## How
Notable design decisions and anything a reviewer would otherwise have to reverse-engineer.

## Risk
- Blast radius:  [ ] single service  [ ] cross-service  [ ] data migration  [ ] auth/PII
- Rollback plan: 
- Feature flag:  `flag.name` (default OFF)

## Verification
- [ ] Unit tests added/updated
- [ ] Integration test covers the happy path + 1 failure path
- [ ] Manually verified on: [ ] Android [ ] iOS [ ] Web [ ] low-end device [ ] airplane mode
- [ ] Screenshots / recording attached (UI changes)
- [ ] Load impact considered (new N+1? new hot query? index present?)

## Docs
- [ ] OpenAPI updated  [ ] ADR written  [ ] Runbook updated  [ ] README updated  [ ] N/A + reason
```

---

## 7. Code Review Checklist

The reviewer works this list. It's the contract — no vibes-based reviews.

**Correctness**
- [ ] Does it actually do what the PR says? Read the test, not just the code.
- [ ] Edge cases: empty list, null, zero, negative, duplicate, concurrent, timezone, `NULL` vs missing.
- [ ] Error paths: what happens on network failure, DB timeout, partial write?
- [ ] Idempotency: can this be safely retried? (All write APIs must be — `Idempotency-Key` header.)

**Data**
- [ ] Migration is backwards-compatible with the currently-deployed code (expand → migrate → contract).
- [ ] New query has a supporting index; `EXPLAIN ANALYZE` attached for anything on a hot path.
- [ ] Soft delete respected (`deleted_at IS NULL` in every read path).
- [ ] Audit log entry written for anything state-changing on a regulated entity.

**Security**
- [ ] AuthZ check present at the resource level, not just the route level (no IDOR).
- [ ] Input validated with a schema (Zod / class-validator) at the boundary.
- [ ] No raw string SQL concatenation. Parameterized or query-builder only.
- [ ] No secrets, keys, tokens, or PII in code, logs, or error messages.
- [ ] Rate limit applied to any unauthenticated or expensive endpoint.

**Performance**
- [ ] No N+1. No unbounded query (every list endpoint is paginated, max page size enforced).
- [ ] Payload size sane for a 2G connection — is this shipping fields the client never reads?
- [ ] Caching considered; cache invalidation path is explicit.

**Frontend-specific**
- [ ] Works offline or degrades honestly (never a silent failure — always a visible state).
- [ ] Loading / empty / error / offline states all implemented.
- [ ] Touch targets ≥ 44×44 dp; contrast ≥ 4.5:1; screen-reader labels present.
- [ ] Tested on a 2 GB RAM Android device profile, not just the simulator.
- [ ] i18n: no hardcoded user-facing strings.

**AI-specific**
- [ ] Model version pinned; model card updated; eval metrics reported vs. previous version.
- [ ] Fallback path when the model is unavailable or confidence is below threshold.
- [ ] No PII in training data or feature store without a documented lawful basis.
- [ ] Latency and model size budget respected (on-device: ≤ 15 MB, ≤ 120 ms p95).

**Craft**
- [ ] Naming reads like the domain, not like the implementation.
- [ ] The code matches the conventions of the file it lives in.
- [ ] Comments explain *why*, and only where the why isn't obvious.
- [ ] No speculative generality — no abstraction with exactly one caller.

---

## 8. Definition of Done

A story is Done only when **all** of these are true. Not "done except tests."

1. Acceptance criteria in the ticket are all demonstrably met.
2. Code merged to `main` via a reviewed PR.
3. Unit tests written; branch coverage on new code ≥ **80%**.
4. At least one integration test covers the happy path and one failure path.
5. OpenAPI / proto contract updated and the generated client regenerated.
6. Feature flag defined, default OFF, and the ON path tested.
7. Observability: at least one metric, one structured log event, and a trace span exist for the new path.
8. Alert defined if the feature has an SLO.
9. Docs updated: API reference, and the runbook if it can page someone.
10. Deployed to staging and smoke-tested there.
11. Works on the **low-end reference device** (Android 10, 2 GB RAM, 3G throttled) if user-facing.
12. Accessibility pass (WCAG 2.1 AA) if user-facing.
13. Security checklist signed off by D4 if it touches auth, PII, payments, or emergency.
14. Demoed in the Friday demo.

**Definition of Ready** (before a story enters a sprint): has acceptance criteria, has a design/API contract, has no unresolved external dependency, is estimated, and is ≤ 3 ideal days.

---

## 9. Documentation Standards

```
docs/
├── 00-team-charter.md          ← this file
├── 01-master-roadmap.md        ← all 18 phases, cross-team
├── 02-backend-lead-roadmap.md  ← D1
├── 03-frontend-lead-roadmap.md ← D2
├── 04-ai-lead-roadmap.md       ← D3
├── 05-devops-qa-lead-roadmap.md← D4
├── adr/                        ← Architecture Decision Records, numbered, immutable
│   └── 0012-event-bus-redpanda-over-kafka.md
├── api/                        ← generated OpenAPI + proto, never hand-edited
├── runbooks/                   ← one per alert; every alert links to its runbook
├── models/                     ← one model card per deployed model
└── decisions.md                ← running decision log (date, decision, who, why)
```

**Rules**
- Every non-obvious technical choice gets an **ADR**. Format: Context → Options considered → Decision → Consequences → Status. ADRs are never edited after acceptance; they're superseded by a new one.
- Every alert has a **runbook** with: what it means, how to confirm, how to mitigate, how to escalate. An alert without a runbook gets deleted.
- Every deployed model has a **model card**: purpose, training data + provenance, metrics, known failure modes, bias evaluation, fallback behaviour, owner.
- Diagrams are **Mermaid in markdown**, not images. Diagrams that can't be diffed rot.
- READMEs answer exactly four questions: what is this, how do I run it, how do I test it, who owns it.
- Docs are updated **in the same PR** as the code. A follow-up docs PR never happens.

---

## 10. Communication Protocol

| Channel | Use for | Response expectation |
|---------|---------|---------------------|
| `#ra-standup` | Async standups | Post by 09:45 |
| `#ra-dev` | Technical discussion | Best effort |
| `#ra-prs` | PR notifications | 4 working hours |
| `#ra-alerts` | Automated alerts only, no chat | On-call: 15 min ack |
| `#ra-incidents` | Live incident coordination | Immediate |
| ADR + PR | Any decision anyone will ask "why?" about in 3 months | 2 working days |

**Escalation:** blocked > 2 hours → say so in `#ra-dev`. Blocked > 4 hours → escalate to CTO. Sitting quietly on a blocker is the only genuinely unacceptable behaviour on this team.

---

## 11. Quality Gates (enforced in CI, not by goodwill)

| Gate | Threshold | Blocks |
|------|-----------|--------|
| ESLint / Ruff | 0 errors | PR |
| TypeScript / mypy | strict, 0 errors | PR |
| Unit coverage (new code) | ≥ 80% branch | PR |
| Integration suite | 100% pass | PR |
| SAST (Semgrep, CodeQL) | 0 high/critical | PR |
| Dependency audit (osv-scanner) | 0 critical, high needs waiver | PR |
| Container scan (Trivy) | 0 high/critical in final image | Release |
| License check | no GPL/AGPL in distributed code | PR |
| API contract diff | no breaking change without version bump | PR |
| Bundle size (web) | ≤ 180 KB gz initial route | PR |
| APK size | ≤ 28 MB base | Release |
| Load test | p95 < 300 ms @ 10k RPS | Release |
| Lighthouse (portals) | Perf ≥ 90, A11y ≥ 95 | Release |
| DAST (ZAP) | 0 high | Release |

---

## 12. Risk Register (top 10, reviewed every Thursday)

| # | Risk | Impact | Prob | Owner | Mitigation |
|---|------|--------|------|-------|------------|
| R1 | Offline sync conflicts corrupt booking state | Critical | Med | D1+D2 | CRDT-style LWW per-field + server-authoritative state machine; conflict test suite from S5 |
| R2 | SMS/IVR gateway DLT approval delays (TRAI) | High | High | D4 | Start DLT template registration in S0; keep 2 gateway vendors integrated |
| R3 | Crash-detection false positives dispatch real 112 units | Critical | Med | D3 | Two-stage confirm (sensor + 30s user cancel window + call-back); never auto-dispatch on model alone |
| R4 | Map/routing licensing cost at national scale | High | Med | D4 | OSM + self-hosted Valhalla/MapLibre as the default; commercial tiles only as premium fallback |
| R5 | DPDP Act non-compliance (consent, localization) | Critical | Med | D4 | Consent ledger from P4; all data in-India regions; DPIA before beta |
| R6 | On-device AI too heavy for 2 GB devices | High | Med | D3 | Hard budget: ≤15 MB, INT8 quantized, ONNX/TFLite; server fallback |
| R7 | Mechanic supply density too low for ETA promises | High | High | PM/D1 | Dispatch honestly surfaces "no mechanic within X"; pre-seed partner network per pilot city |
| R8 | 4-person team under-capacity for 18 phases | High | High | CTO | Phases 12/13/17 are deliberately thin-sliced; feature flags let scope drop without branch surgery |
| R9 | Emergency service outage during a real emergency | Critical | Low | D4 | Multi-AZ + degraded SMS-only path that works with the whole app stack down |
| R10 | Key-person dependency (single lead per vertical) | High | Med | All | Mandatory backup owner (§1), rotating reviewers, ADRs, no undocumented tribal knowledge |

---

## 13. Non-Negotiables

1. **Emergency paths never regress.** Any change touching SOS/112 needs 2 approvals, a dedicated test run, and a staged rollout.
2. **Offline is a first-class mode, not a fallback.** If a feature can't degrade, it needs an explicit, visible offline state.
3. **Feature phones are users.** Every core journey (request help, track, cancel, confirm) must be completable over SMS/IVR.
4. **No PII leaves India.** Ever. Including logs, backups, error reports, and third-party analytics.
5. **We never fake it in a demo.** If it's mocked, we say it's mocked, on the slide.
