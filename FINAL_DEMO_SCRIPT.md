> Timing is **measured, not estimated**. `npm run test:demo` walks every beat
> in two live browser windows and reports machine time: the action beats consume
> **10–20 seconds** of machine time against an eight-minute budget. Nine
> consecutive clean runs. Everything else on the clock is yours to talk in.

# Final demo script — 10 minutes

## Setup, fifteen minutes before

```bash
cd app
npm run demo:reset          # fresh consistent data — 60 s
npm start                   # leave it running
```

Two Chrome windows side by side, **phone width (~430 px), not full screen**:
- left: `http://localhost:4000/app.html` — the customer
- right: `http://localhost:4000/mechanic.html` — the mechanic

Third tab, unopened until 8:30: `app/docs/SWE4004-MAPPING.md`.

**Run everything locally.** Never demo the off-grid section with the API on a
tunnel — you need to control the network, and conference Wi-Fi will not
cooperate.

---

## 0:00 — The problem

**ACTION:** Slide 2. Nothing on screen but the slide.

**SAY:** "A breakdown is not a software problem — until you realise the app you
would use to fix it needs the network you do not have. On Indian highways,
coverage is worst exactly where a breakdown is most dangerous. Every roadside
app assumes connectivity. We assumed it would fail."

**SHOW:** The framing. Do not rush this — it is what makes the last four
minutes land.

**CLOUD CONNECTION:** Module 1 — cloud risks. Connectivity dependence is the
risk; the rest of this demo is the mitigation.

---

## 0:45 — Customer login

**ACTION:** `/app.html` → phone number → **Send code** → the code auto-fills →
**Verify**.

**SAY:** "Real OTP against the live API. In development the server returns the
code so I can show you sign-in without an SMS account — that is a development
setting the production guard refuses to boot with."

**SHOW:** The connectivity pill reading **online**, green. Point at it now; it
matters at 6:45.

**CLOUD CONNECTION:** Module 1 — SaaS delivered to a citizen tenant.

---

## 1:15 — Vehicle

**ACTION:** Add a registration → **Add vehicle**.

**SAY:** "The vehicle belongs to this account and nobody else's. Every read in
the platform is scoped by user."

**SHOW:** The vehicle card appearing; the Assist tab becoming usable.

**CLOUD CONNECTION:** Module 2 — **multitenancy**. Row-level tenancy on a
shared schema, proven by twelve cross-tenant attacks that are all refused.

---

## 1:45 — Incident

**ACTION:** Assist tab → **Check location** → type *"won't start, clicking
sound"*.

**SAY:** "Location is confirmed, not taken silently. The app asks."

**SHOW:** The numbered step rail marking steps done as they are satisfied.

**CLOUD CONNECTION:** Module 3 — cloud storage: the fix is written as a PostGIS
geometry, which is what makes the next query possible.

---

## 2:15 — AI diagnosis

**ACTION:** **Diagnose**.

**SAY:** "Cause, confidence, severity, do-not-drive, parts. And the badge says
`rules-1.0.0` — this is a deterministic rules engine, not a neural network, and
we label it. It is the permanent fallback any model has to beat. Two things
about it are worth your time: a remote model may make a verdict **stricter,
never laxer** — it can tell you not to drive, it can never overrule us and say
you may — and a CI test **fails the build** if the rule table on the phone ever
diverges from the server's."

**SHOW:** The `rules-1.0.0` pill. Point at it directly.

**CLOUD CONNECTION:** Module 1 — service boundary between what the platform
computes and what a third-party model would.

---

## 2:45 — Severity

**ACTION:** Stay on the result.

**SAY:** "Severity three of five, and a do-not-drive flag. That is what
determines urgency and which service is pre-selected below. We report one to
five because that is what the code returns — not a four-colour scale we invented
for a slide."

**SHOW:** Severity and the pre-selected service.

**CLOUD CONNECTION:** Module 4 — this is the input to scheduling.

---

## 3:15 — Dispatch

**ACTION:** **Request assistance**.

**SAY:** "A PostGIS nearest-neighbour search. Providers who are off duty or
already on a job are excluded **in SQL**, before ranking — then the rest are
scored: proximity sixty per cent, rating thirty-four, plus a bonus for newcomers
so the marketplace does not concentrate on five people. Offered in a wave of
five, ninety-second timeout, and it escalates on its own if nobody answers.
Eighty-three milliseconds at the median."

**SHOW:** Real distances and ETAs on each offer card.

**CLOUD CONNECTION:** Module 4 — **workload distribution and resource pooling,
both genuinely implemented.** This is your strongest Module 4 evidence.

---

## 4:00 — Mechanic

**ACTION:** Accept the offer, then switch to the mechanic window and sign in.

**SAY:** "The job is already there. It arrived over server-sent events the
moment the server wrote it — no refresh, no polling delay. An offer lives ninety
seconds; waiting eight of them for a poll would waste a tenth of the window."

**SHOW:** The badge reading **Live**.

**CLOUD CONNECTION:** Module 3 — cloud usage monitoring and the real-time
mechanism.

---

## 4:45 — Real-time

**ACTION:** On the mechanic side only: **I'm on my way** → **I've arrived** →
**Start work** → **Work complete**. Do not touch the customer window.

**SAY:** "Watch the left-hand window. I am not touching it. Persist first,
publish second — the database is written before anything is announced, so a
dropped connection loses a notification, never a fact. And polling continues
underneath: the stream is an accelerator, never the source of truth."

**SHOW:** The customer's status following each step unaided. Measured at 0.8 to
1.4 seconds.

**CLOUD CONNECTION:** Module 3 — resource replication is *not* here, and say so
if asked: the SSE registry is in-process, which is exactly what a second
instance would break.

---

## 5:30 — Payment

**ACTION:** Customer window → the invoice appears → **Pay invoice**.

**SAY:** "The amount is never taken from the request. It is the invoice total,
computed server-side — labour plus eighteen per cent GST. In this build the
provider is `mock` and it logs *simulated, no money moved*. Production **refuses
to boot** on mock. A forged signature settles nothing, and replaying the
confirmation does not charge twice."

**SHOW:** The status turning **PAID**.

**CLOUD CONNECTION:** Module 2 — service technology: idempotency and
server-side authority.

---

## 6:15 — Completion

**ACTION:** Rate five stars, submit. Then submit again.

**SAY:** "Four-oh-nine, already reviewed. Every replayable operation in this
platform carries an idempotency key."

**SHOW:** The refusal.

---

## 6:45 — Network failure  ·  THE TURN

**ACTION:** **Close the SOS sheet if one is open.** Then tap the connectivity
pill.

**SAY:** "Now the part this project exists for. I am taking the network away."

**SHOW:** The pill turning red, the red rule down the shell, the banner
explaining what still works.

**CLOUD CONNECTION:** Module 1 — cloud risk, realised.

---

## 7:15 — Offline workflow

**ACTION:** Diagnose again. Then hold **SOS**. Then open the Off-grid screen.

**SAY:** "Diagnosis still works — same rule table, running on the device. Now
the emergency. Read what it says: **'Nothing has been transmitted.'** Because
nothing has. No mechanic, no responder, no contact has been alerted, and it says
so instead of showing a spinner. What it *has* done is create a real incident on
this phone, with its own reference — short enough to read aloud over a borrowed
phone — a GPS fix, because GPS is a satellite receiver and needs no internet,
and an encrypted record in IndexedDB with a queued sync entry. And it tells you
to call 112, because voice often works on a signal too weak for data."

**ACTION (the strongest moment):** **Close the tab entirely. Reopen
`/app.html`.**

**SAY:** "Still there."

**SHOW:** The incident surviving. This single action is unanswerable.

**CLOUD CONNECTION:** Module 3 — **cloud storage, client-side tier**: AES-GCM-256
in IndexedDB under a non-extractable key.

---

## 8:00 — Reconnect and sync

**ACTION:** Tap the pill again. Then in DevTools: `await window.__ra.listOffGrid()`.

**SAY:** "Connection restored, synchronising, and the journal empties. Status
SYNCED, with a server id. Now watch — I sync again." *(run it twice)* "No
duplicate. The device reference is unique in the database, so a retry after a
lost response — which is the normal way retries duplicate things — converges on
the incident that already exists. One emergency, not two."

**SHOW:** `status: "SYNCED"`, and the count unchanged after the second sync.

**CLOUD CONNECTION:** Module 4 — **migration and idempotent replication of
state** from device to cloud.

---

## 8:30 — Architecture

**ACTION:** Slides 8 and 9.

**SAY:** "One container serving three surfaces, one PostGIS database, every
external vendor behind an adapter with a local implementation — which is why
this entire demo ran with zero paid accounts. Five modules in one deployable,
and the boundaries are enforced mechanically: a cross-module import fails the
build."

**CLOUD CONNECTION:** Module 1 — roles and boundaries.

---

## 9:15 — Cloud explanation

**ACTION:** `SWE4004-MAPPING.md` or slides 22–23.

**SAY:** "Eight of twenty-one concepts implemented, five partial, eight
designed and not provisioned. The eight are infrastructure we have not bought —
there is no autoscaler, no load balancer, no replica, and I will not show you an
animation and call it a cluster. What we did build is the part that matters most
for this problem: workload distribution and resource pooling in the dispatch
engine, dynamic scheduling with timeout-driven re-scheduling, and a readiness
gate — stop the database and health returns 503 while ping still returns 200,
which is precisely what lets an orchestrator remove an instance."

**SHOW:** The classification table. Let them read the DESIGN rows.

**CLOUD CONNECTION:** All four modules at once.

---

## 9:45 — Conclusion

**SAY:** "Intelligent assistance when the road fails. Resilient software when
the network fails. Five hundred and seventy-eight assertions across six suites,
zero failures — including seventy-four attacks that must fail. Six real bugs
found by tooling we wrote to attack our own project, and fixed. Nothing on
those slides is a claim I cannot show you."

---

## If you have three minutes instead of ten

Login → diagnose → dispatch → **go offline, hold SOS, close the tab, reopen it**
→ reconnect and sync. That is the argument. Everything else is supporting
evidence.
