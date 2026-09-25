# Engineering notes

Working notes for this repository. Everything here is something that cost
somebody time to find out, or that the code cannot tell you on its own.

## What this is

An offline-first roadside-assistance platform for India. Four ecosystems in one
repo, each with its own toolchain:

| Path | What | Run it with |
|---|---|---|
| `app/` | npm workspace — Fastify API, Drizzle schema, static web surfaces | Node 22+, `npm` |
| `mobile/` | Android client, Kotlin + Compose | Gradle 8.13, AGP 8.13.2 |
| `ai/` | RAKSHA road-damage CV pipeline | Python 3.12 |
| `docs/`, `ppt/` | Planning docs, dated evidence, the deck | — |

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
npm run verify                   # typecheck · lint · boundaries · claims · citations · no-llm · residency · unit tests
```

**`demo:reset` leaves the RAKSHA dashboard EMPTY.** It seeds the corridor and
the demo admin, but not a single detection — those arrive over the API from an
edge device, so they cannot be seeded before the server is up. A reset half an
hour before a demo therefore produces an authority dashboard with four dashes
and a blank map, which looks like a broken feature rather than an empty table.

```bash
npm start          # the simulator posts to :4000, so the API must be running
npm run demo:raksha   # 65 REAL detections from ai/cv-live-show.json
```

`demo:raksha` replays genuine `yolo-rdd2022in-best` output through the ingest
path, twice, to show the replay is idempotent. Their GPS is simulated along the
corridor and the dashboard says so. `node scripts/raksha-simulator.mjs` with no
arguments walks a synthetic patrol instead — six events, `sim-rules-0.1.0`.

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
npm test                 # 177 unit — no I/O, the only ones that run standalone
npm run test:e2e         # 189
npm run test:concurrency # 75
npm run test:gateway     # 27
npm run test:security    # 74 attacks, every one must be refused
npm run test:ui          # 163, drives real Chrome over CDP (--headed to watch)
```

**The concurrency suite degrades on a database it has already run against.**
It needs free, verified providers near the test point, and every run — plus any
booking you dispatch by hand for a demo — leaves some of the pool occupied. The
failure is legible once you know it: `0 offers — only 0 free provider(s) in
range; skipped: {"OFFLINE":39,"BUSY":30}`, and it gets worse each time. Measured
across four consecutive runs on one database: 75 passed, then 65, then 44, then
44. A fresh seed returns it to 75 immediately.

So it is not a flaky test and not a regression — it is state. Reset before you
trust a concurrency run, and especially before a demo:

```bash
docker compose -f docker-compose.demo.yml down -v
docker compose -f docker-compose.demo.yml up -d
```

`npm run test:razorpay` (22) needs a Razorpay sandbox account and refuses to run
without one. It is **not** part of the 636 and must never be described as
passing.

Android: `cd mobile && ./gradlew lint testDebugUnitTest assembleRelease` (87
tests). AI: `python -m unittest discover -s ai/tests` (39, stdlib only).

## Toolchain traps

**Gradle 8.13 rejects JDK 25**, with the least useful message in this repo: `*
What went wrong:` followed by the bare version, `25.0.1`, naming nothing. Build
on JDK 21 — what CI pins (Temurin 21), and the only JDK this is measured on.
This note used to claim "any JDK 17–25, verified on all three", which JDK 25
cannot satisfy: it postdates Gradle 8.13, and
`docs/verification/ZERO_TO_RUN_VERIFICATION.md` had said so all along.

**A green Gradle build does not verify the JDK you set.** `JAVA_HOME` loses to
`org.gradle.java.home` in `~/.gradle/gradle.properties` — machine-local, so it
is invisible from inside the repo — and that is how the claim above survived:
point `JAVA_HOME` at a rejected JDK and the build still goes green, on the
other one. Read the `Daemon JVM:` line of `./gradlew -version`; to actually
test a JDK, pass `-Dorg.gradle.java.home=<path>`. Android Studio's JBR is no
longer the pointer it was either — Studio updated itself and left `Android
Studio/jbr` a stub with no `lib/jvm.cfg`, and its replacement is 25.0.3.

**Android Studio picks its Gradle JVM separately, and `org.gradle.java.home`
does not reach it.** The IDE setting is `gradleJvm` in `mobile/.idea/gradle.xml`
(Settings › Build Tools › Gradle › Gradle JDK). Left at
`#GRADLE_LOCAL_JAVA_HOME` it resolves to the `java` on PATH — 25.0.1 here — and
Studio validates that JVM *before* Gradle ever reads `gradle.properties`, so
sync dies while `./gradlew` from a terminal builds perfectly. That split is the
confusing part: the command line is not evidence that the IDE works, and the
IDE failing is not evidence the toolchain is broken. Point `gradleJvm` at a JDK
21 entry by name.

Studio's failure is the one worth reading, because it names the range the bare
`25.0.1` does not:

```
The project's Gradle version 8.13 is incompatible with the Gradle JVM version
25 currently selected to run Gradle build. Gradle 8.13 supports Java versions
between 1.8 and 23.
```

`.idea/` is gitignored, so that setting cannot be carried in the repository —
and should not be: it names a JDK entry from one machine's Studio install, which
would resolve to nothing on anybody else's. It is written down here instead.

**Never pipe gradlew and read the exit code.** `./gradlew … | tail` reports the
*pipeline's* status, so a failed build looks like it passed. Use
`${PIPESTATUS[0]}` or redirect to a file.

**This is a CRLF working tree** (`.md`, `.ts`, `.kts`, most things) but
`app/apps/web/*.html` is LF. When editing with a script, read and write with
`newline=""` and match the file's existing ending, or the diff becomes the whole
file.

## Reaching the API from the Android client

Sign-in asks for a phone number and a six-digit code. It does **not** ask for
the server address, on purpose — that is a developer's question on a citizen's
first screen.

**Long-press the RoadAssist wordmark on the sign-in screen** to show the API
base URL field, and long-press again to hide it. This is the only way in on a
developer who wants a local server instead of the live one. A fresh install
talks to https://app.roadassistbharat.online; an install that had saved the old
built-in default, the emulator alias `10.0.2.2:4000`, is moved to it once on
launch. The Server card in **More** changes it after sign-in.

It is written here rather than drawn on the screen, which is the whole point —
so it has to be written here. The field is only committed when it is visible, so
a stale value cannot overwrite what `MainActivity.onCreate` restored.

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
the schema look like 57 tables when it defines **56** — and that inflated number  <!-- claims-check:ignore -->
reached 27 documents and a slide deck. The same mistake inflated the primary-key
and index counts. Separately, `information_schema.check_constraints` emits one
row per `NOT NULL` column, which is how "433 check constraints" was published  <!-- claims-check:ignore -->
when there are **5**. See `app/docs/CLAIMS-AUDIT.md` §4.

**That query counts tables, and only tables.** Pointing it at `relkind = 'i'`
does *not* exclude `spatial_ref_sys_pkey`, because `pg_depend` records extension
membership for the **table**; an index depends on its table, not on the
extension, so the filter matches nothing and quietly passes everything through.
Following the recipe literally gives 139 indexes and 85 unique ones against a  <!-- claims-check:ignore -->
schema that has 138 and 84 — the failure looks like the documents drifted, so
the temptation is to "correct" every document to the wrong figure. For indexes,
filter on `i.indrelid`; the working queries are written out in
`app/docs/measured.json` under `schema.how`.

**138 and 84 are the correct numbers now, and they used to be the wrong ones.**
This paragraph illustrated the trap with 138/84 against a true 137/83 until
`payments_invoice_settled_uq` was added and moved both by one. Anybody who
half-remembers the old warning will “fix” a correct 138 back to 137 and be sure
they are undoing the PostGIS inflation. What is stable is the SHAPE, not the
totals: `spatial_ref_sys` contributes exactly one index, and it is unique, so
the wrong answer is always the right one plus one. Re-measure rather than
reason from any number written in this file.

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
  and rebuild the deck. `npm run claims` is the gate; it reads
  `app/docs/measured.json` and checks the total, every individual suite, and the
  `npm run … # N` comments the command lists are written as.
- **A `file.ts:123` in the docs is a claim too.** `npm run citations` checks that
  every one still resolves. `docs/viva/CODE_TO_VIVA_MAP.md` and
  `FINAL_PROFESSOR_DEFENSE.md` tell the reader to *open* the file rather than
  describe it, so a rotted line number is discovered in front of an examiner —
  lifting the auth and emergency routes out of `server.ts` shifted ten of them
  and pushed two past the end of the file. After any refactor, re-derive them by
  grepping for the route or the function; never nudge the number.
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
