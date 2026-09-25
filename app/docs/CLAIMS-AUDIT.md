# Claims audit

Every material claim the project makes, checked against the code that is
supposed to back it. Verified by running the thing, not by reading it.

**Three statuses only.** `IMPLEMENTED` means the code exists, the database
persists it, the frontend consumes it, and a test exercises it. `PARTIAL` means
some of that is true. `DESIGN` means it is architecture and nothing more.

---

## 1. Corrections made to the presentation script

The Review-1 speaker script described the **target** cloud architecture in the
present tense. These were corrected in `review1-ppt/presentation-script.md`,
which was removed from the working tree on 2026-09-16 and lives in history
(`git show 90864e2:review1-ppt/presentation-script.md`).

| # | Original claim | Reality | Corrected to |
|---|---|---|---|
| 1 | *"That is our autoscaler, **running**."* (Slide 15, titled **LIVE**) | No Kubernetes, no HPA, no cluster. The slide is an animation. | "That animation is our scaling **design**… this is not a running cluster." Slide retitled *Dynamic Scalability: the design*. Now points at the one real piece — the `/health` readiness gate returning 503. |
| 2 | *"Two more architectures, **both running**."* (Slide 16, **LIVE**) | Neither load balancing nor redundant storage is deployed. | "Both are designed; neither is deployed." |
| 3 | *"cloud bursting on a **real evening**… we autoscale to twenty-two"* | A worked scenario, not telemetry. | "a **modelled** evening — a worked scenario, not telemetry from a running system… I will not present them as measurements." |
| 4 | *"Cloud infrastructure provisioned — virtual network, subnets, security groups and the Kubernetes cluster"* listed under **"five things are complete"** | None of it exists. | Split into "Running, and I can demonstrate every one of these" and "Not provisioned, and I will not claim it". |
| 5 | *"The database deployed and seeded — **sixty tables, multi-zone**, a hundred thousand rows"* | 56 tables, single node, ~13.7k rows at the seed volume used. | "56 tables on PostgreSQL with PostGIS, migrated from empty and seeded, on Docker." |
| 6 | *"the handoff to ERSS 112 over mutual TLS with a signed payload"* (Slide 26, **LIVE**) | Stubbed. The API's own response says so. | "The handoff to ERSS 112 is **not built**… our own API says so in the response." |
| 7 | *"through the **isolated** emergency service… runs even if the main platform is down"* | ADR-0005 designs isolation; today it is a module in the same process. | "Today it is a module in the same process. The rule it exists to protect — that a model can never dispatch — is enforced regardless." |
| 8 | *"A service that must never fail — answered by multi-zone replication and redundant storage"* | Neither exists. | Re-pointed at what *is* built: "the answer we actually built is not in the cloud at all: it is on the device." |

**Why this mattered.** A professor who asks "show me the autoscaler" would have
found nothing. The corrected script is stronger, not weaker: it trades six
claims that cannot be demonstrated for a list that can be, live, in five minutes.

---

## 2. Product claims, checked

| Claim | Backed by | Test | Status |
|---|---|---|---|
| Android i18n: "zero hardcoded literals left in `MainActivity.kt`" | **WRONG WHEN WRITTEN** — corrected 2026-09-14. The bottom navigation was five English literals (`Tab("Home", ...)`), so every non-English build showed an English nav bar on every screen; four `Heading()` calls, `STATUS`, the `· signed in` suffix and the off-grid paragraph were literals too. Found by running the app under each locale on an emulator, not by reading the code. The nav is now `stringResource` in all 8 locales (63 → 68 keys); the rest is listed in TESTING.md rather than claimed away. | `values-*/strings.xml`, Android lint MissingTranslation | **CORRECTED** |
| "Offline-first" — the app works with no network | `offline-store.js`, `sw.js`, `connectivity.js` | `ui-journey.mjs` §7b drives the whole scenario | **IMPLEMENTED** |
| SOS works with no internet | `raiseOffGridSos()` → IndexedDB → `/v1/sos/offline-sync` | `ui-journey.mjs` §7b, `e2e-journey.mjs` §12b | **IMPLEMENTED** |
| "No duplicate incident" on reconnect | `incidents.client_incident_id` UNIQUE + `onConflictDoNothing` | `concurrency-test.mjs` §4, §5 | **IMPLEMENTED** |
| AI diagnosis works offline | `offline-engine.js`, mirrors the server rule table | `offline-engine.test.ts` divergence guard | **IMPLEMENTED** |
| "AI-powered" | Deterministic rules engine (ADR-0006) + a trained YOLO11 road-damage detector in `ai/` (best: YOLO11s `yolo11s-multi-rich`, mAP50 0.472 on held-out validation) | 225 unit tests; 39 AI-pipeline tests | **PARTIAL** — the diagnosis "AI" is a rules engine, labelled as such in the UI. A remote model is an env change away and none is configured. |
| Two mechanics can't take one job | `SELECT … FOR UPDATE` on the booking row | `concurrency-test.mjs` §1, §2 | **IMPLEMENTED** |
| Real-time status without refresh | SSE `/v1/events` | `concurrency-test.mjs` §8, `ui-journey.mjs` §7c — measured 65 ms | **IMPLEMENTED** |
| Payments are gateway-verified | HMAC signature check, webhook, amount match | `razorpay-test.mjs` (22 checks, outside the 757) | **IMPLEMENTED in code; checks not counted.** The script needs no account — it stubs Razorpay's Orders API locally — but runs only against an API started with `PAYMENTS_PROVIDER=razorpay`, so it is outside every npm test run and was not re-run for the current figures. Never run against a real account, never described as passing. The hosted demo uses the `mock` provider. |
| Tamper-evident audit log | Hash chain, append-only Postgres rules | `gateway-security-test.mjs`, `/v1/ops/overview` verifies it live | **IMPLEMENTED** |
| Break-glass medical access | Role gate + live-incident gate + mandatory reason + audit row | `security-audit.mjs` §2 | **IMPLEMENTED** |
| "Emergency services contacted" | **Never claimed anywhere.** The string does not exist in the codebase. | `grep` | **CORRECTLY ABSENT** |
| 112 handoff | Stub. The response says so. | — | **DESIGN** |
| Feature-phone SMS journey | `POST /v1/telecom/sms` | `e2e-journey.mjs` §13 | **IMPLEMENTED** (inbound); outbound needs a vendor account |
| Emergency service is an isolated deployable (ADR-0005) | Same process today | — | **DESIGN** |
| RAKSHA edge detection | Demo detections are **real** YOLO11 output (34, `ai/cv-detections-full.json`, model version `yolo-rdd2022in-best`) at **SIMULATED** NH-48 positions — RDD2022 images carry no GPS — seeded at boot in demo mode through the ingest route (`demo/raksha-demo-seed.ts`); the device is named as simulated. The simulator's own `sim-rules-0.1.0` events are labelled `SIMULATED` | `raksha-simulator.mjs`, e2e | **PARTIAL, and labelled** — no camera on a road, no live inference on the deployment |
| Cloud deployment | **Corrected 2026-09-25** — was "Nothing is deployed". Live at `app.roadassistbharat.online`: one Render web service (Docker, free plan, Singapore) + Neon Postgres (Singapore); showcase on GitHub Pages. Single instance; no autoscaling, replication or load balancing; free tiers offer no India region, so the demo is hosted outside India | `render.yaml`, `scripts/verify-deployment.mjs` | **PARTIAL** — a real demo deployment, not the target architecture |

---

## 3. Things that could have been over-claimed and were not

Recorded because an audit that only lists faults is not an audit.

- The mock payment provider logs `SIMULATED, no money moved` and
  `assertProductionSafe()` refuses to boot production on it.
- RAKSHA's stats endpoint returns `note: "aggregate counts only — demo build,
  device data SIMULATED"`.
- The off-grid SOS sheet says *"Nothing has been transmitted"* explicitly.
- Offline diagnosis is labelled `LOCAL OFFLINE DIAGNOSIS` with its engine
  version, and never as "AI vehicle diagnosis".
- Offline maps carry `OFFLINE MAP — LAST UPDATED <timestamp>` and no ETA.
- A GPS failure shows `Unknown — denied`, never a fallback coordinate.
- The escalation response reports how many contacts were *actually* alerted.
- Dead-zone risk is labelled "heuristic v1 from this platform's own devices —
  NOT carrier coverage data".

---

## 4. Schema counts, re-measured

Every schema number the project quotes was re-measured against a database
migrated from empty. Five of the seven were wrong, all in our favour, and all
from the same two mistakes.

| Claim | Was | Is | Why it was wrong |
|---|---|---|---|
| Tables | 57 | **56** | `CREATE EXTENSION postgis` installs its own `spatial_ref_sys` into `public`, and the count in `migrate.ts` asked `information_schema` for every base table in the schema rather than for ours. |
| Primary keys | 57 | **56** | The same table, counted again. |
| Indexes | 138 | **137** | And again — its index. |
| Unique indexes | 84 | **83** | And again — its unique index. |
| CHECK constraints | 433 | **5** | A different and worse mistake: `information_schema.check_constraints` emits one row per `NOT NULL` column. 938 of the rows counted were `NOT NULL`. The domain CHECKs we actually wrote are the five in `migrate.ts`: severity 1–5, confidence 0–1, road-health 0–100, rating 1–5, invoice total non-negative. |
| Foreign keys | 62 | 62 | Correct. |
| GiST indexes | 5 | 5 | Correct. |

> **Annotated 2026-09-15, not rewritten.** The two index rows above are a
> record of what was *published* against what was true **then**, and they stay
> that way. The schema has since gained one index — the partial unique
> `payments_invoice_settled_uq` that makes an invoice settle at most once — so
> it now genuinely has **138 indexes and 84 unique ones**, which are the
> figures in `measured.json` today. Read the 138/84 in the *Was* column as the
> 2026-09-12 miscount it was, not as today's total; the two agreeing by
> coincidence is exactly the confusion this note exists to prevent.

**Why this mattered.** The table count is the kind of claim that gets tested
directly — "name the 57th" has no good answer when the honest reply is "it
belongs to PostGIS". The CHECK-constraint figure was the more exposed of the
two: 433 invites "show me one", and the five that exist are worth showing.

**Fixed at the source,** not just in the prose. `migrate.ts` now counts through
`pg_depend` and excludes anything an extension owns, so it reports 56 and the
number in the documents is the number the tool prints. (Drizzle's own
`__drizzle_migrations` was never in the count — it lives in the `drizzle`
schema, not `public`.)

---

## 5. Eight languages — what is and is not verified

The roadmap named eight languages. All eight now ship across the API's SMS and
OTP messages, the Android UI and the web citizen app's critical paths. The
claim needs one qualification every time it is made.

| | |
|---|---|
| **Verified** | The strings exist in all eight, every key in every locale (asserted by test), every message inside its SMS segment budget (asserted by test), and Android lint fails the build on a missing translation (verified by deleting one). Live SMS checked end to end in Tamil, Telugu, Bengali and Kannada; all eight checked in a real browser. |
| **NOT verified** | **Translation quality.** Seven of the eight are machine-translated and have not been read by a native speaker. Register and idiom are where that shows. |

**So say it this way:** *"Eight languages, and the mechanism is tested — every
key present, every SMS inside one segment, the build fails if a translation is
missing. The translations themselves are not yet native-reviewed, and that is
the next thing I would fix."*

Do not say *"supports eight languages"* with no qualifier. It invites the one
question there is no good answer to: *who checked the Tamil?*

---


## 6. Remaining wording risk

**Resolved in Phase 9.** The two decks were examined separately:

- **`ppt/RoadAssist-Bharat-SWE4004.pptx`** (30 slides, generated by
  `ppt/make.py`) was **already honest**. Its own speaker notes say *"Which of
  these eight do you implement? — None as running infrastructure, and I say so
  plainly"* and *"Have you implemented autoscaling? — No. Claiming it would be
  false and easily checked."* No change was needed. My Phase 8 report was wrong
  to lump it in, and that is corrected here.

- **`review1-ppt/RoadAssist-Review1-SWE4004.pptx`** (31 slides, no generator)
  carried the over-claims on the slides themselves, not only in the script.
  **29 shapes were corrected in place** with `python-pptx`, preserving each
  run's formatting. `LIVE` badges on the autoscaling and load-balancing slides
  became `DESIGN`; *"deployed on managed Kubernetes"*, *"Cloud infrastructure
  provisioned"* and *"replicated across 3 availability zones"* became `TARGET`
  statements; and *"WebSocket for live tracking"* was corrected to
  server-sent events, which is what the platform actually uses.

  A re-scan finds **0 remaining over-claims**. The original is preserved as
  `RoadAssist-Review1-SWE4004.pre-audit.pptx`.

**Both closed 2026-09-15.** Each was re-rendered and then checked by pulling the
text back out of the finished PDF, rather than by looking at it:

- `review1-ppt/RoadAssist-Presentation-Script.pdf` — re-rendered from
  `presentation-script.md` with `python ppt/md2pdf.py`. The stale export said
  “57” once where the Markdown says it nowhere; the new render agrees with the
  source on every schema figure. `…pre-audit.pdf` is deliberately left beside
  it as the record of what was corrected.
- `ppt/RoadAssist-Bharat-FINAL.pdf` — re-exported from the `.pptx` through
  PowerPoint, as `ppt/README.md` sets out. It carried “57” five times plus 138
  and 433; it now carries 56 and 137 and none of those three, which is what the
  deck’s own slide text says. The `.pptx` was opened read-only and hashes
  identically afterwards, so the deck itself is untouched — only the render was
  ever wrong.

**Still true:** nothing regenerates either PDF as part of a build, so both can
go stale again silently. §4 holds the figures to check them against.

---

## 7. Toolchain claims, re-measured

`ENGINEERING-NOTES.md` carried **“Android builds on any JDK 17–25. Verified on all three”**
and told the reader not to add a version guard because “it would reject a JDK
that works”. Re-measured against Gradle 8.13, which is the pinned wrapper:

| Daemon JVM | Result |
|---|---|
| JDK 21 (JetBrains Runtime 21.0.9) | `BUILD SUCCESSFUL` |
| JDK 25 (25.0.1) | `FAILURE` — `* What went wrong:` then the bare string `25.0.1` |
| JDK 25 (Android Studio JBR 25.0.3) | `FAILURE`, identically |

JDK 25 was never going to work: it postdates Gradle 8.13. The claim was **wrong
when written** rather than correct-and-drifted, so it is corrected in place. 17
through 24 were *not* re-measured — no such JDK is installed on this machine —
so `ENGINEERING-NOTES.md` now quotes no range at all and names only the JDK 21 that CI pins
and that the build is actually measured on. A narrower claim that is true beats
a wider one that is convenient.

**How it survived.** `JAVA_HOME` loses to `org.gradle.java.home`, which this
machine sets in `~/.gradle/gradle.properties` — outside the repository, and so
invisible to anyone reviewing from inside it. Export `JAVA_HOME` to a rejected
JDK, run the full `lint testDebugUnitTest assembleRelease`, and it still goes
green, because the daemon is quietly running on the other JDK. That is a green
run which verifies nothing about the JDK it appears to test — the same shape as
the workspace-link trap under “Before you trust a green run”. To test a JDK for
real, pass `-Dorg.gradle.java.home=<path>` and read the `Daemon JVM:` line that
`./gradlew -version` prints.

**Dated evidence left standing.** `docs/verification/ZERO_TO_RUN_VERIFICATION.md`
already gave the correct cause — “Java 25 is not supported by Gradle 8.13” — when
it was written on 2026-09-06. Only the `JAVA_HOME` it suggests has gone stale,
after Android Studio updated itself on 2026-09-14 and left that JBR with no
`lib/jvm.cfg`. It is annotated in place, not rewritten.
