# RoadAssist Bharat

> **One Platform. Every Vehicle. Every Phone. Every Road.**
>
> An offline-first emergency mobility platform for India — built for the roads
> where coverage is worst.

**A four-person team project for SWE4004 — Cloud Computing and Applications**,
presented at Review 1 with the workstreams below.

| Member | Workstream |
|---|---|
| [V. Saatwik Sairaam](https://github.com/saatwik-1157) | Backend · APIs · Database |
| P. Nirisha Chowdary | Auth · Security · Real-time |
| T. V. S. Jignesh | Frontend · Customer app |
| G. Parthavi | Mechanic & admin surfaces · Cloud DevOps |

The `docs/0X-*-roadmap.md` files are written as four lead roadmaps because that
is how the 18-phase plan divides the work; D1–D4 map onto the four members in
that order.

The repository is pushed from a single account, so `git log` shows one
committer. That is how the code reached GitHub, not how the work was split —
said here rather than left for someone to infer from the commit list.

---

## Which half is AI

This is the first thing to say about the project, so it is the first thing in
this file.

**RAKSHA road-damage detection is a genuinely trained YOLO11 model.** Best
`mAP50` is **0.471** (`mAP50-95` 0.226) on held-out validation, trained on
RDD2022 across four countries. Weights and per-epoch metrics live in `ai/runs/`,
which is gitignored — a clone gets the pipeline, the measured figures and the
commands that produced them, not the artefacts. See [ai/README.md](ai/README.md).

**The roadside diagnosis is not a model.** It is a deterministic rule table
(ADR-0006) that returns `rules-1.0.0`, and every screen that shows it is
labelled as a rules engine. `AI_BASE_URL` can point at a model; nothing in this
repository implements that endpoint.

**No language model is involved anywhere.** There is no LLM or GPT dependency
in any manifest and no chat endpoint called from any source file — not in the
API, the Android client, the web surfaces or the CV pipeline. That is an
architectural property rather than a promise, so `npm run no-llm` enforces it
and CI fails if one ever appears.

Saying "AI-powered" without those three paragraphs is marketing, which is why
they are here and not in a footnote. The claim is recorded as **PARTIAL** in
[app/docs/CLAIMS-AUDIT.md](app/docs/CLAIMS-AUDIT.md).

---

## What actually runs

| Surface | Path | State |
|---|---|---|
| Citizen progressive web app | `/app.html` | Ships |
| Mechanic console | `/mechanic.html` | Ships |
| RAKSHA authority dashboard | `/raksha.html` | Ships |
| Live operational map | `/map.html` | Ships |
| Native Android client | `mobile/` | Ships — Kotlin + Compose |
| Feature phone over SMS | `POST /v1/telecom/sms` | Ships — a complete booking with no app at all |
| iOS · Android Auto · IVR · USSD | — | **Designed, not built** |

The web surfaces are plain HTML, CSS and JavaScript served by the API itself.
There is no build step and no second runtime: a bundler would add a deployment
unit, a network hop and a CORS boundary in exchange for nothing.

---

## The five decisions worth defending

Most of this project is ordinary work. These five are the parts that were
decided rather than defaulted into, and each one is enforced by something that
fails the build if it regresses.

### 1 · The build refuses to let the documents lie

`app/docs/measured.json` is the single source of every number, and it records
*how* each was obtained, not just what it is. Five gates guard the claims:

- **`npm run claims`** fails when any document disagrees with it.
- **`npm run citations`** checks that every `file.ts:123` reference in the viva
  packs still points at real code — those documents tell the reader to *open*
  the file, so a rotted line number is discovered in front of an examiner.
- **`npm run boundaries`** enforces module boundaries, the offline shell's
  completeness, and the app shell's load order.
- **`npm run no-llm`** refuses to let a language model into the system, so
  "the AI here is a trained detector and a rule table" stays true by
  construction rather than by memory.
- **`npm run residency`** refuses to let personal data leave India. It found a
  live leak the day it was written: half a dozen dead prototype pages under
  `site/` were reachable at `/media/*.html`, and every one pulled webfonts from
  Google, so a visitor's IP address left the country to render a page nothing
  linked to.

This exists because the same wrong number reached twenty-odd documents three
separate times, and a human caught it each time. A human catching it is not a
mechanism.

### 2 · A model is never allowed to dispatch

ADR-0005. A crash signal raises an incident that waits in
`AWAITING_CONFIRMATION` until a recorded human — or a corroborating second
signal — moves it on. A false positive that dispatches is worse than a false
negative that asks.

### 3 · Exactly one channel owns an emergency

The SOS ladder falls back `data → SMS → 112 → offline queue`. The invariant is
that precisely one of them owns the report: a confirmed SMS must **not** also
queue an API replay; an unconfirmed one **must**. Getting this wrong sends two
responders to one accident, or none.

Those decisions live in `mobile/.../SosLadder.kt` as pure functions so they can
be tested off-device — 21 of the Android tests cover this file alone.

### 4 · Races are settled by Postgres, not by timing

- Two mechanics accepting one job: `SELECT … FOR UPDATE` on the booking row
  inside the transaction, with offer expiry re-checked under the lock.
- A duplicate SOS: a unique index on a client-minted reference, with
  `ON CONFLICT DO NOTHING` — not a check-then-write.
- Double settlement: a **partial unique index** over settled payments, so
  "paid once" is true even when two confirmations arrive together.
- The audit log: hash-chained, with Postgres `RULES` making `UPDATE` and
  `DELETE` no-ops.

Anything that is only true because two things did not happen at the same instant
is not true.

### 5 · Off-Grid Mode is the architecture, not a fallback

[ADR-0009](app/docs/adr/0009-offgrid-mode.md). The client distinguishes
`ONLINE`, `LIMITED` and `OFF-GRID`. An SOS raised with no signal becomes a real
incident stored on the device with its own reference and GPS fix — and says
*"stored on this device"* rather than pretending it was sent. Diagnosis runs
on-device against the same rule table the server uses. When connectivity
returns the journal replays itself idempotently, so a retry never becomes a
second ambulance.

---

## Measured, not estimated

Every figure below was obtained by running the thing it describes, against a
database migrated from empty and seeded.

| | |
|---|---|
| **672 assertions**, six suites, zero failures | 144 unit · 189 e2e · 75 concurrency · 74 attacks · 27 gateway security · 163 browser |
| Android | 66 tests, zero lint errors, release APK under R8 |
| AI pipeline | 39 tests, standard library only |
| **Not run** | 22 Razorpay sandbox checks — they need an account, and are never counted or described as passing |
| Schema | 56 tables · 138 indexes · 5 migrations |
| API | 65 routes |
| Localisation | 8 languages — **not native-reviewed** |

The security suite is 74 attacks that must every one be refused: cross-tenant
reads and writes, role escalation, id manipulation, SQL injection, forged and
`alg:none` tokens, unsigned webhooks, oversized input, error-body leakage. A
green run means the attack was attempted and failed, which is a stronger
statement than "the code looks right".

CI additionally kills PostgreSQL under a running API and asserts the platform is
honest about it — `/health` returns 503 naming the database while `/v1/ping`
still returns 200, so a client can tell *"you have no network"* from *"the
platform is unwell"* — then rehearses a backup and restore and re-verifies the
audit hash chain on the restored copy.

---

## Running it

**One command, nothing to install but Docker:**

```bash
docker compose -f docker-compose.demo.yml up
```

That pulls the published image, brings up PostGIS, migrates, seeds and serves
every surface on <http://localhost:4000>. Running it twice is a no-op rather
than an error. Every server-side suite passes against that stack — end-to-end,
security, concurrency, gateway and browser — and it is the same image the
registry holds, not a rebuild of it.

Or from source:

```bash
cd app
docker compose up -d db      # PostGIS on 5434
npm run demo:reset           # reset · migrate · seed
npm start                    # API on :4000, serves every web surface too
npm run demo:raksha          # second terminal: 65 real detections into RAKSHA
```

Sign in with `+919876543210` (citizen), `+919999900001` (authority) or
`+919600000000` (mechanic). The OTP is returned by the server in development and
auto-fills.

```bash
npm run verify               # typecheck · lint · boundaries · claims · citations · no-llm · residency · unit
```

Android: `cd mobile && ./gradlew lint testDebugUnitTest assembleRelease` (66
tests). Build on **JDK 21** — Gradle 8.13 rejects 25.

[ENGINEERING-NOTES.md](ENGINEERING-NOTES.md) carries everything that cost time to find out: the
toolchain traps, the migration rules, how to count things in the database
without the PostGIS extension inflating the answer, and why `demo:reset` leaves
the authority dashboard empty.

---

## Repository layout

| Path | What | Toolchain |
|---|---|---|
| `app/apps/api` | Fastify API — 65 routes, modular monolith (ADR-0001) | Node 22+, TypeScript |
| `app/apps/web` | Citizen, mechanic, authority and map surfaces | Plain HTML/CSS/JS |
| `app/packages/db` | Drizzle schema, migrations, seeds | PostgreSQL 16 + PostGIS |
| `app/scripts` | Six test runners, the claims and citation gates, the RAKSHA simulator | Node |
| `mobile` | Android client | Kotlin, Compose, Gradle 8.13 |
| `ai` | RAKSHA CV pipeline — training, ONNX export, serving | Python 3.12 |
| `docs`, `app/docs` | Plan, ADRs, dated evidence, viva packs | — |
| `ppt` | The deck. Generated — edit `ppt/part_final.py`, never the `.pptx` | Python |

---

## Non-negotiables

1. **Emergency paths never regress.** Two approvals, a dedicated test run, and
   21 tests over `SosLadder.kt` that run on every push.
2. **Offline is a first-class mode.** And it is never claimed that something
   reached the cloud when it did not.
3. **Feature phones are users.** Every core journey is completable over SMS, in
   all eight languages, switched by texting `LANG TA`. Translations are not yet
   native-reviewed — see
   [TESTING.md](app/docs/TESTING.md#localisation-and-exactly-how-far-it-goes).
4. **No PII leaves India.** Including logs, backups and crash reports.
5. **Nothing is faked in a demo.** If it is mocked, it says so on screen.

---

## Deliberately not built

Said plainly rather than implied otherwise: iOS, Android Auto, IVR, USSD,
satellite, mesh networking, ERSS-112 handoff (stubbed, and the API says so in
its own response), Kubernetes, Terraform, autoscaling, and multi-zone anything.
There is no load test — latency is measured single-user, on one machine.

---

## Documentation

[docs/README.md](docs/README.md) indexes every document and says which are kept
current and which are dated evidence for a given build — they age differently,
and conflating the two is how a correct figure gets "fixed" into a wrong one.

| Document | Contents |
|---|---|
| [Master Roadmap](docs/01-master-roadmap.md) | All 18 phases: objectives, dependencies, acceptance criteria, target architecture |
| [Backend workstream](docs/02-backend-lead-roadmap.md) | Schema (60 tables planned; 56 shipped) <!-- claims-check:ignore -->, booking state machine, dispatch, auth, sync conflict resolution |
| [Frontend workstream](docs/03-frontend-lead-roadmap.md) | Design system, screens, offline client, maps, accessibility, localisation |
| [AI workstream](docs/04-ai-lead-roadmap.md) | The 9 planned AI systems with inputs, algorithms, metrics and baselines |
| [DevOps / QA workstream](docs/05-devops-qa-lead-roadmap.md) | CI/CD, observability, telecom gateway, load and chaos testing, DR |
| [ADRs](app/docs/adr/) | Eleven decision records, including the five above |
| [CLAIMS-AUDIT](app/docs/CLAIMS-AUDIT.md) | Every over-claim found, what it was, and what it actually is |

Those roadmap documents describe the **plan**, in the present tense, including
things that were never built. The list at the top of this file is the authority
on what exists today.
