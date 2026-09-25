# Submission checklist

Ticked only where the artefact exists **and** has been verified in this session.

## Deliverables

| | Item | Where | Status |
|---|---|---|---|
| ✅ | Source code | `app/apps`, `app/packages`, `mobile/`, `ai/` | 56-table schema, 67 routes (64 under `/v1`), 6 web surfaces, native Kotlin Android client |
| ✅ | Database migrations | `app/packages/db/drizzle/` | 7 migrations, run from an **empty** database in this session |
| ✅ | Seed data | `app/packages/db/src/seed.ts` | Two modes — full demo, and `--reference-only` for production (0 demo rows, verified) |
| ✅ | README | `app/README.md`, root `README.md` | |
| ✅ | Project overview | `app/docs/PROJECT_OVERVIEW.md` | |
| ✅ | Architecture | `app/docs/architecture/README.md` | C4, events, degraded modes, API style guide |
| ✅ | Failure matrix | `app/docs/architecture/failure-matrix.md` | 20 rows, each naming its proving suite |
| ✅ | Security documentation | `app/docs/SECURITY.md` | Controls, 74 attacks, findings, known gaps |
| ✅ | Offline documentation | `app/docs/OFFLINE.md` | Capability matrix, tiers, storage, retention |
| ✅ | Deployment instructions | `app/docs/DEPLOYMENT.md` | Docker, config, backup, rollback, DR, cost |
| ✅ | Live deployment | https://app.roadassistbharat.online · showcase https://roadassistbharat.online | One Render web service (Docker, free plan, Singapore) + Neon Postgres/PostGIS (Singapore); showcase on GitHub Pages. `NODE_ENV=demo`, mock payments, on-screen OTP |
| ✅ | Testing report | `app/docs/TESTING.md` | 6 executed suites (757 assertions, 0 failures), coverage, what is not covered; the 22 Razorpay checks are outside the total and not run |
| ✅ | SWE4004 mapping | `app/docs/SWE4004-MAPPING.md` | Modules 1–6, 21-row cloud-concept audit |
| ✅ | Claims audit | `app/docs/CLAIMS-AUDIT.md` | Every claim checked against the code |
| ✅ | Presentation | `ppt/RoadAssist-Bharat-FINAL.pptx` | **32 slides**, generated, 0 over-claims |
| ✅ | Demo script | `app/docs/DEMO-SCRIPT.md` | 10 minutes, every step with a backup |
| ✅ | Viva questions | `app/docs/VIVA.md` | **56 questions**, grouped, grounded in code |
| ✅ | Screenshots | `app/docs/screenshots/` | **15 PNGs** captured from the running app |
| ✅ | Environment example | `app/.env.example` | 141 lines, every variable documented |
| ✅ | CI pipeline | `.github/workflows/ci.yml` | 21 steps incl. chaos + backup rehearsal |
| ⚠️ | Final report | this conversation | Not committed as a file |

## Regenerating any of it

```bash
cd app
npm ci && docker compose up -d
npm run db:migrate && npm run db:seed && npm run db:seed:raksha
npm start                                  # in another shell

node scripts/capture-screens.mjs           # → docs/screenshots/
python ../ppt/make_final.py                # → ppt/RoadAssist-Bharat-FINAL.pptx
python ../ppt/md2pdf.py ../review1-ppt/presentation-script.md out.pdf
```

## Verification, in order

```bash
npm run typecheck && npm run lint && npm run boundaries && npm test
npm run build
npm run test:e2e && npm run test:gateway
npm run test:concurrency && npm run test:security
npm run test:ui
npm run perf                               # measured, not a load test
```

## Manual actions still required

1. `npm run db:migrate` on any other machine before running.

Nothing else. The two items that stood here — the PDF export and the slide
transitions — are done: `ppt/RoadAssist-Bharat-FINAL.pdf` is 32 pages exported
from the final deck through PowerPoint itself, and all 32 slides carry a 0.7 s
fade. Both are reproducible with the script in `ppt/README.md`.

## External accounts — in place, and still required

The first three and the email account exist and run the hosted demo. The rest
genuinely need an account the project does not have; nothing is faked in their
place — the demo says on screen that it has no SMS route and no payment gateway.

| # | What | Needed for | Variables | Status |
|---|---|---|---|---|
| 1 | A host | Any deployment at all | — | **In place** — one Render web service (Docker, free plan, Singapore, `render.yaml`) |
| 2 | Domain + DNS | HTTPS — and Off-Grid Mode needs it for service workers and geolocation | `CORS_ORIGINS` | **In place** — `app.roadassistbharat.online` (platform), `roadassistbharat.online` (GitHub Pages showcase) |
| 3 | PostgreSQL **with PostGIS** | Dispatch is a geospatial query | `DATABASE_URL` | **In place** — Neon, Singapore (ap-southeast-1) |
| 4 | Twilio or MSG91 (MSG91 needs a TRAI DLT template) | OTP sign-in, emergency SMS | `SMS_*`, `TELECOM_WEBHOOK_SECRET` | **Still required** — demo runs `SMS_PROVIDER=console` with the code shown on screen |
| 5 | Razorpay **test** keys first | Payments | `PAYMENTS_*` | **Still required** — demo runs `PAYMENTS_PROVIDER=mock`, no money moves |
| 6 | *(optional)* Hosted model endpoint | Better than the rules engine | `AI_*` | Not configured |
| 7 | Transactional email | Operator alerts, email sign-in codes | `EMAIL_*` | **In place** — Resend (USA), verified domain `send.roadassistbharat.online` |

**Maps need no account** — keyless OpenStreetMap tiles, Leaflet bundled locally.

**Region.** Render and Neon are in Singapore because their free tiers offer no
India region; an India region (e.g. Mumbai) is the production target. So on the
demo every visitor's request does leave India.

## Known limitations carried into submission

1. Deployed as a **demo**, not a production service: one free-plan Render
   service (`NODE_ENV=demo`, sleeps after 15 min idle, ~1 min to wake, uploaded
   photos ephemeral) and a Neon database, both in Singapore rather than India.
   No autoscaling, no cluster, no replication, no load balancer.
2. Single instance only — SSE registry, rate limiter and offer sweeper are
   in-process.
3. ERSS 112 handoff is a stub; the emergency routes run in the same process as
   the API, so emergency isolation (ADR-0005) is a design.
4. Payments: the deployment runs the mock provider. The Razorpay adapter has 22
   checks against a local stub (no account needed), outside the 757 and not
   re-run for this measurement — never a live account.
5. Diagnosis "AI" is a deterministic rules engine, labelled as such everywhere.
6. No load test, no external penetration test, no coverage on the HTTP layer,
   no real SMS gateway.
7. `review1-ppt/` WAS the older Review-1 material, corrected during the audit and
   kept for history; `ppt/RoadAssist-Bharat-FINAL.pptx` is the submission deck.
