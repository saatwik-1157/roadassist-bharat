# Demo script — 10 minutes

The fifteen beats below budget 10 min 25 s in total. It was titled
"8 minutes" while the individual timings already summed past ten, which is
the kind of error that only shows up when somebody is standing in front of a
class with a clock running.

Every step has been executed. Each has a **backup** for when it does not
cooperate, and no backup fakes a result: if something fails, the honest failure
*is* the demo, because this platform's whole argument is that it degrades in
public rather than in secret.

## Before you start (10 minutes ahead)

```bash
cd app
docker start ra-db                       # or: npm run infra:up
npm run db:migrate                       # idempotent
npm start                                # http://localhost:4000
```

Then, in a second terminal, warm the state so the demo has something to show:

```bash
node scripts/perf-audit.mjs 5            # confirms every path answers
```

**Checklist.** `/health` says `"database":"ok"` · two browser windows, one
normal (customer, `/app.html`), one incognito (mechanic, `/mechanic.html`) ·
DevTools open on the customer window, Network tab visible · geolocation allowed
· phone numbers ready: customer any `+91…`, operator `+919999900001`, dev OTP
`000000`.

**Never demo from a laptop on conference Wi-Fi with the API on a tunnel.** Run
everything locally; the off-grid section needs you to control the network.

---

## 1 · The problem (30s)

> A breakdown on a highway is not a software problem until you realise the app
> you would use to fix it needs the network you do not have. Coverage on Indian
> highways is worst exactly where breakdowns are most dangerous.

**Backup:** none needed — this is speech.

## 2 · The solution (30s)

> RoadAssist Bharat: AI-powered, cloud-connected, **network-resilient**.
> The claim we defend is the third one. *"RoadAssist doesn't stop when the
> network stops."*

## 3 · Login (30s)

**Action.** `/app.html` → phone number → **Send code** → the dev OTP appears in
the response → **Verify**.

**Expected.** Home screen, greeting, the connectivity pill reads **Online**
green, SOS button visible.

**Backup.** If the OTP is not returned, `EXPOSE_DEV_OTP` is false — say so and
read the code from the server log; it prints on the `[sms:console]` line.

## 4 · Vehicle (20s)

**Action.** Registration + type → **Add vehicle**.

**Expected.** Vehicle card appears; the Assist tab is now usable.

**Backup.** A duplicate registration returns 409 — use a different one. Say the
uniqueness constraint is doing its job.

## 5 · Incident and AI diagnosis (45s)

**Action.** Assist tab → symptoms *"won't start, clicking sound"* → optionally a
fault code chip → **Diagnose**.

**Expected.** *Battery discharged or terminals loose*, 80% confidence, severity
3/5, "Do not drive", parts, recommended safety action, `rules-1.0.0` pill, and
the right service pre-selected below.

**Say this.** > This is a deterministic rules engine, not a neural network, and
> the pill says so. It is the permanent fallback that any model has to beat —
> and it is the same rule table that runs on the phone offline.

**Backup.** If it errors, the fallback IS the story: it will fall back to the
on-device engine and label itself `LOCAL OFFLINE DIAGNOSIS`.

## 6 · Dispatch (45s)

**Action.** **Request assistance**.

**Expected.** Status → `MATCHING`, an offer list with distance, ETA and score;
the response meta shows the wave, the offer TTL, and `skippedByState`.

**Say this.** > Nearest-neighbour in PostGIS, then ranked: proximity 60%, rating
> 34%, plus a bonus for newcomers so the marketplace does not concentrate.
> Providers already on a job are excluded — and it tells the customer how many
> nearby were off duty versus busy.

**Backup.** If zero offers, widen the radius to 60 km. If still zero, that is
`NO_SUPPLY` with a named reason — show the `skippedByState` object and explain
that the platform says *why*, not just "no". Then continue from §12 (SOS), which
does not need a mechanic.

## 7 · Mechanic accepts (45s)

**Action.** Incognito window → `/mechanic.html` → sign in as the offered
mechanic (or the operator `+919999900001`) → the offer is **already there** →
**Accept**.

**Expected.** The badge reads **Live**. The offer arrived without a refresh.

**Say this.** > That offer was pushed over server-sent events the moment the
> server wrote it. An offer lives ninety seconds; waiting eight of them for a
> poll wasted a tenth of the window.

**Backup.** If the badge says **Polling**, the stream did not connect — press
Refresh; the console still works on its 8-second poll. Say that out loud: the
stream is an accelerator, never the source of truth.

## 8 · Real-time on the customer side (30s)

**Action.** Switch to the customer window **without touching it**. Then, on the
mechanic side: **En route** → **Arrived** → **Start** → **Complete**.

**Expected.** The customer's screen follows each step on its own. Provider name,
rating, live distance, ETA, provider state, last-updated time.

**Say this.** > Nobody refreshed anything. Measured at 65 milliseconds against a
> six-second poll. And note the ETA is null unless the mechanic is actually
> travelling — we do not invent one.

**Backup.** If the customer screen does not move, wait: the poll still catches
it within 60 seconds. Do not reload — reloading hides whether it worked.

## 9 · Invoice and payment (45s)

**Action.** Customer → invoice appears on completion → **Pay** → UPI.

**Expected.** Booking → `PAID`, invoice settled.

**Say this.** > The amount is never taken from the request — it is the invoice
> total. In this build the provider is `mock` and it logs *"SIMULATED, no money
> moved"*. Production refuses to boot on it.

**Backup.** If payment errors, show the log line and the `assertProductionSafe`
guard instead. Do not claim a payment succeeded.

## 10 · Review (15s)

**Action.** Rate 5 → comment → submit. Then submit again.

**Expected.** Accepted once; the second attempt is `409 already_reviewed`.

## 11 · Online SOS (30s)

**Action.** Home → **hold SOS 1.5s** → let the countdown run or press **Alert
now**.

**Expected.** Escalation card: incident created, location shared, contacts
notified (with the real count), responder search, elapsed milliseconds.

**Say this.** > Every rung says whether it actually happened. If no contact was
> reached it says zero — it never says "help is on the way" on faith. And the
> 112 handoff is stubbed; our own API response says so.

## 12 · THE MOMENT — go off-grid (2 min)

**Action first: close the SOS sheet from §11** (the button under the
escalation card). An emergency is still active until you do, and holding SOS
again answers *"An emergency is already active"* rather than creating the
off-grid incident — correct behaviour, and a confusing thing to meet live.
The timed rehearsal walked into exactly this.

**Action.** Tap the connectivity pill (or DevTools → Network → Offline).

**Expected.** Pill turns **red / Off-grid**, a red rule appears down the shell,
the banner explains what still works.

**Action.** Diagnose again with the network off.

**Expected.** **LOCAL OFFLINE DIAGNOSIS** with the engine version, the same
cause, plus alternative causes and a safety action.

**Action.** Hold **SOS**.

**Expected.**
```
OFF-GRID SOS CREATED
No network connection detected.
Your emergency information is stored securely on this device and
will be synchronized automatically when connectivity returns.
Nothing has been transmitted.
```
with a readable reference `RA-XXXXXX` and the real GPS fix.

**Action.** Open the **Off-grid** screen. Show the incident, the two columns —
what works and what certainly does not — and the sync journal with its operation
id and retry count.

**Say this.** > No mechanic, responder or contact has been alerted, and it says
> so. The reference is short enough to read aloud over a borrowed phone.

**Action (the strongest single moment).** **Close the tab entirely. Reopen
`/app.html`.**

**Expected.** The incident is still there — it is in IndexedDB, encrypted.

**Backup.** If IndexedDB is unavailable (private window), the off-grid screen
says storage is unavailable and *why*. Show that instead — it is the same point:
the app never pretends.

## 13 · Reconnect and sync (60s)

**Action.** Tap the pill again.

**Expected.** `Connection restored` → *Synchronizing emergency information…* →
**SOS synchronized. RoadAssist dispatch can now process your incident.** The
journal empties; the incident shows a platform reference.

**Action (the closer).** In DevTools console:
```js
await window.__ra.listOffGrid()      // status: "SYNCED", serverId set
```
Then re-post the same reference and show `status: "duplicate"`, `created: 0`.

**Say this.** > The device reference is unique in the database. A retry after a
> lost response — which is the normal way retries duplicate things — converges
> on the incident that already exists. One emergency, not two.

**Backup.** If sync fails, that is still a demonstration: it says **Sync retry
pending**, the incident stays, and it retries with jittered backoff. Say so.

## 14 · Architecture and honesty (60s)

**Action.** Show `docs/SWE4004-MAPPING.md` — the two diagrams, CURRENT and
TARGET, side by side.

**Say this.** > Eight cloud concepts are implemented, five partial, eight are
> design. The eight are infrastructure we have not provisioned, and I would
> rather tell you that than show you an animation and call it an autoscaler.
> What we did build is the part that matters most for this problem: the
> platform keeps working when *the user's* network fails, which is the failure
> that actually happens on a highway.

**Action.** `npm run test:concurrency` or `node scripts/security-audit.mjs` —
one of them, live, if there is time.

## 15 · Close (20s)

> An AI-powered, cloud-connected, network-resilient emergency mobility platform
> that keeps protecting people when connectivity becomes unreliable.
> 615 assertions executed across six suites, no failures (a seventh needs a
> payment-gateway account). Three real vulnerabilities found by
> our own security suite during the audit, and fixed. Nothing on that list is a
> claim I cannot show you.

---

## Demo safety — the rules

1. **Never fake a payment.** If it fails, show the guard that refuses to boot
   production on a mock provider.
2. **Never claim an emergency was transmitted.** The off-grid screen's whole
   value is that it does not.
3. **Never invent a location, an ETA or a mechanic position.** If GPS is denied
   the app says `Unknown — denied`; show that.
4. **If the network section fails**, use the pill toggle rather than DevTools —
   it drives the same code path, and the UI labels it *simulated*.
5. **If the database dies**, `/health` returns **503** with `database: down`
   while `/v1/ping` still answers 200. That contrast is a better demo than the
   happy path.
6. **If everything fails**, run the test suites. They are the evidence, and
   they run without the UI.

## If you have only 3 minutes

Login → diagnose → **go off-grid** → SOS → close the tab → reopen → reconnect →
sync → show the duplicate refused. That is the whole product argument, and it is
the part nobody else will have.
