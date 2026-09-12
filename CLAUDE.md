# CLAUDE.md

Working notes for this repository. Everything here is something that cost
somebody time to find out, or that the code cannot tell you on its own.

## What this is

An offline-first roadside-assistance platform for India. Four ecosystems in one
repo, each with its own toolchain:

| Path | What | Run it with |
|---|---|---|
| `app/` | npm workspace — Fastify API, Drizzle schema, static web surfaces | Node 20+, `npm` |
| `mobile/` | Android client, Kotlin + Compose | Gradle 8.13, AGP 8.13.2 |
| `ai/` | RAKSHA road-damage CV pipeline | Python 3.12 |
| `docs/`, `ppt/`, `review1-ppt/` | Planning docs, dated evidence, decks | — |

`app/` is where nearly all work happens. **Run npm commands from `app/`, not the
repository root.**

## Before you trust a green run

**Check the workspace links exist.** `app/node_modules/@roadassist/db` and
`/api` are npm workspace links. Copying the repo (onto another drive, out of a
zip) destroys them on Windows and leaves empty directories behind.

```bash
ls app/node_modules/@roadassist/db     # must not be empty
```

This matters because it hides behind green signals: `tsc -b` passes (TypeScript
uses project references, not `node_modules`) and `npm test` passes (those files
import relative paths), while the API cannot start at all and every integration
suite is unrunnable. `npm install` in `app/` repairs it. Confirm by booting the
server, not by re-running typecheck.

## Running things

```bash
cd app
docker compose up -d db          # PostGIS on 5434 — 5432/5433 are other projects
npm run demo:reset               # reset + migrate + seed + seed:raksha
npm start                        # API on :4000, serves the web surfaces too
npm run verify                   # typecheck · lint · boundaries · unit tests
```

**`npm run db:seed` is not idempotent.** It inserts roles that the migration
already created and dies on a unique violation. Always `npm run demo:reset`,
which resets first.

**Killing a backgrounded server needs more than `pkill`.** A `node --import tsx
apps/api/src/server.ts` started in the background survives `pkill -f` on Windows
and keeps :4000 bound. Check and kill properly:

```bash
netstat -ano | grep ":4000.*LISTENING"
powershell -NoProfile -Command "Stop-Process -Id <pid> -Force"
```

## The suites, and which ones actually run

Six in `app/`, and the last five need a live server **and** a seeded database:

```bash
npm test                 # 98 unit — no I/O, the only ones that run standalone
npm run test:e2e         # 189
npm run test:concurrency # 65
npm run test:gateway     # 26
npm run test:security    # 74 attacks, every one must be refused
npm run test:ui          # 163, drives real Chrome over CDP (--headed to watch)
```

`npm run test:razorpay` (22) needs a Razorpay sandbox account and refuses to run
without one. It is **not** part of the 615 and must never be described as
passing.

Android: `cd mobile && ./gradlew lint testDebugUnitTest assembleRelease` (18
tests). AI: `python -m unittest discover -s ai/tests` (12, stdlib only).

## Toolchain traps

**Android builds on any JDK 17–25.** Verified on all three. CI pins Temurin 21
for agreement between machines, not compatibility — do not add a version guard,
it would reject a JDK that works. Locally, Android Studio's JBR is JDK 21:
`JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"`.

**Never pipe gradlew and read the exit code.** `./gradlew … | tail` reports the
*pipeline's* status, so a failed build looks like it passed. Use
`${PIPESTATUS[0]}` or redirect to a file.

**This is a CRLF working tree** (`.md`, `.ts`, `.kts`, most things) but
`app/apps/web/*.html` is LF. When editing with a script, read and write with
`newline=""` and match the file's existing ending, or the diff becomes the whole
file.

## Migrations

Drizzle. A migration is **two files plus a journal entry**, and all three must
exist:

```
packages/db/drizzle/0004_name.sql
packages/db/drizzle/meta/0004_snapshot.json     ← easy to forget
packages/db/drizzle/meta/_journal.json          ← entry appended
```

Hand-writing the `.sql` and editing the journal without the snapshot leaves the
next `drizzle-kit generate` diffing against the *previous* snapshot, so it
re-emits the migration you already applied. Always `npm run db:generate`; if you
must hand-write, generate the snapshot in a scratch copy and bring it back.

`migrate.ts` also applies what drizzle-kit cannot express — SRID pinning, GiST
indexes, CHECK constraints, the append-only audit RULES. It is idempotent.

## Counting things in the database

Count through `pg_depend`, never bare `information_schema`:

```sql
SELECT count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
 WHERE c.relkind = 'r' AND d.objid IS NULL;
```

`CREATE EXTENSION postgis` installs `spatial_ref_sys` into `public`, which made
the schema look like 57 tables when it defines **56** — and that inflated number
reached 27 documents and a slide deck. The same mistake inflated the primary-key
and index counts. Separately, `information_schema.check_constraints` emits one
row per `NOT NULL` column, which is how "433 check constraints" was published
when there are **5**. See `app/docs/CLAIMS-AUDIT.md` §4.

## Architecture rules that fail the build

- **Module boundaries** (ADR-0002): schema modules may only import what
  `scripts/check-boundaries.mjs` allows, and nothing outside `packages/db` may
  reach past the package index. Runs in CI as its own job.
- **Money is integer paise.** A unit test enforces it; never introduce a float.
- **Every table** carries the `base` columns, a primary key, snake_case names.
  Enforced by `schema-conventions.test.ts`.
- **The audit log is append-only** — Postgres RULES make UPDATE and DELETE do
  nothing. Do not try to "fix" a row.

## Localisation

All eight: `en hi ta te bn mr kn gu`. `LOCALES` in `apps/api/src/i18n.ts` is the
complete truth; `values-*/` is its Android counterpart.

**The translations are not native-reviewed.** Say so whenever the count is
quoted — the strings exist, the quality is unverified, and those are different
claims.

**Every script but English is outside GSM 03.38**, so all seven are UCS-2 and
one segment holds **70** characters, not 160. Every catalogue entry is held to a
budget by `i18n.test.ts`; exceptions are listed there by name with a reason. An
em dash also forces UCS-2 — that alone made the English command list cost three
segments. Write copy *for SMS* in each language; do not translate the English
and then trim.

Adding a language is: a block in `i18n.ts`, a block in `apps/web/i18n.js`, a
`values-xx/strings.xml`, and the code in `LANG_WORDS`. Android lint fails the
build if the last one is incomplete, which is the check that keeps the others
honest.

`reply()` in the telecom endpoint takes a **catalogue key**, not a string. `t()`
throws on an unknown key rather than texting somebody the key.

## The honesty rules

This project's credibility rests on not over-claiming, and it has a mechanism
for it: `app/docs/CLAIMS-AUDIT.md`. Follow it.

- If you change a number that appears in the docs, **measure it**, then update
  every occurrence — `grep -r` across `*.md`, the deck sources in `ppt/*.py`,
  and rebuild the deck.
- **Dated evidence is not a living document.** `docs/release/` and
  `docs/verification/` record what was true for a given build. If a figure was
  *correct when written* and has since changed, annotate — do not rewrite. If it
  was *wrong when written*, correct it and say so in CLAIMS-AUDIT.
- The decks under `ppt/` are generated: edit `ppt/part_final.py`, then
  `python ppt/make_final.py`. Editing the `.pptx` directly gets overwritten.
  The `.pdf` needs a manual PowerPoint export and goes stale silently.
- Never describe something as shipped because it is on the roadmap. The README's
  team table is explicitly labelled as *planned* ownership for this reason.

## Emergency paths

Non-negotiable #1: they never regress. In practice that means:

- The SOS ladder's decisions live in `mobile/.../SosLadder.kt` as pure functions
  so they can be tested off-device. `Emergency.raise` **calls** them rather than
  restating them — keep it that way, or the two will drift.
- The invariant is that **exactly one channel owns a report**. A confirmed SMS
  must not also queue an API replay; an unconfirmed one must. Getting this wrong
  dispatches two responders to one emergency, or none.
- `POST /v1/telecom/sms` is the feature-phone path and works with no app at all.
  Its SMS body format is a contract with `Emergency.smsBody` on the client and
  `parseSmsCoordinates` on the server; all three change together.
- Never let a model dispatch. ADR-0005. A prediction always waits for human
  confirmation.

## Things that are deliberately not built

Say so rather than implying otherwise: iOS, Android Auto, IVR, USSD, satellite,
mesh networking, ERSS-112 handoff (stubbed, and the API says so in its own
response), Kubernetes, Terraform, autoscaling, multi-zone anything, and six of
the eight named languages. The AI diagnosis is a **rules engine** (ADR-0006);
`AI_BASE_URL` can point at a model and nothing in this repo implements that
endpoint.
