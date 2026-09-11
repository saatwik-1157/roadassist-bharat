# Submission checklist

Ticked only where the artefact exists **and** has been verified in this session.

## Deliverables

| | Item | Where | Status |
|---|---|---|---|
| ✅ | Source code | `app/apps`, `app/packages`, `mobile/`, `ai/` | 56-table schema, 64 routes, 6 web surfaces |
| ✅ | Database migrations | `app/packages/db/drizzle/` | 5 migrations, run from an **empty** database in this session |
| ✅ | Seed data | `app/packages/db/src/seed.ts` | Two modes — full demo, and `--reference-only` for production (0 demo rows, verified) |
| ✅ | README | `app/README.md`, root `README.md` | |
| ✅ | Project overview | `app/docs/PROJECT_OVERVIEW.md` | |
| ✅ | Architecture | `app/docs/architecture/README.md` | C4, events, degraded modes, API style guide |
| ✅ | Failure matrix | `app/docs/architecture/failure-matrix.md` | 20 rows, each naming its proving suite |
| ✅ | Security documentation | `app/docs/SECURITY.md` | Controls, 74 attacks, findings, known gaps |
| ✅ | Offline documentation | `app/docs/OFFLINE.md` | Capability matrix, tiers, storage, retention |
| ✅ | Deployment instructions | `app/docs/DEPLOYMENT.md` | Docker, config, backup, rollback, DR, cost |
| ✅ | Testing report | `app/docs/TESTING.md` | 7 suites, coverage, what is not covered |
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

## External accounts still required

Nothing below is stubbed, guessed or faked — each genuinely needs an account.

| # | What | Needed for | Variables |
|---|---|---|---|
| 1 | A host (Fly / Render / Railway / VM) | Any deployment at all | — |
| 2 | Domain + DNS | HTTPS — and Off-Grid Mode needs it for service workers and geolocation | `CORS_ORIGINS` |
| 3 | PostgreSQL **with PostGIS** | Dispatch is a geospatial query | `DATABASE_URL` |
| 4 | Twilio or MSG91 (MSG91 needs a TRAI DLT template) | OTP sign-in, emergency SMS | `SMS_*`, `TELECOM_WEBHOOK_SECRET` |
| 5 | Razorpay **test** keys first | Payments | `PAYMENTS_*` |
| 6 | *(optional)* Hosted model endpoint | Better than the rules engine | `AI_*` |
| 7 | *(optional)* Transactional email | Authority notifications | `EMAIL_*` |

**Maps need no account** — keyless OpenStreetMap tiles, Leaflet bundled locally.

## Known limitations carried into submission

1. Nothing is deployed to a cloud.
2. Single instance only — SSE registry, rate limiter and offer sweeper are
   in-process.
3. ERSS 112 handoff is a stub; emergency isolation is a design.
4. Payments verified against a local stub, never a live account.
5. Diagnosis "AI" is a deterministic rules engine, labelled as such everywhere.
6. No load test, no external penetration test, no coverage on the HTTP layer.
7. `review1-ppt/` is the older Review-1 material, corrected during the audit and
   kept for history; `ppt/RoadAssist-Bharat-FINAL.pptx` is the submission deck.
