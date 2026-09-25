# Demo command card

## BEFORE DEMO
1. `cd app && npm run demo:reset` — 60 s, fresh consistent data.
2. `npm start` — wait for `RoadAssist API ready`.
3. Two Chrome windows at **~430 px wide**: left `localhost:4000/app.html`, right `localhost:4000/mechanic.html`.
4. `node scripts/demo-rehearsal.mjs` once — confirms all 15 beats before the room fills.

## LIVE DEMO
1. **Login** — `+917000000000`, dev OTP auto-fills. Point at the green **online** pill.
2. **Vehicle** — add a registration; the Assist tab unlocks.
3. **Incident** — Check location, then *"won't start, clicking sound"*.
4. **Diagnose** — point at the **`rules-1.0.0`** badge and say the word "rules".
5. **Request assistance** — ranked offers with real distance and ETA.
6. **Mechanic window** — sign in; the job is already there; badge reads **Live**.
7. **Drive the job** — on my way → arrived → start → complete. **Do not touch the customer window.**
8. **Pay** — invoice appears, tap Pay, status turns **PAID**.
9. **SOS online** — hold 1.5 s; read the ladder aloud. **Then close the sheet.**
10. **Go off-grid** — tap the pill, diagnose, hold SOS, **close the tab, reopen it**, then reconnect and sync twice.

## IF DEMO BREAKS
1. **Database down** → `npm run infra:up`. Or show it deliberately: `/health` 503, `/v1/ping` 200.
2. **No offers** → widen to 60 km. Still none → show `skippedByState`, then jump to SOS (needs no mechanic).
3. **Laptop setup won't come up** → the hosted demo, https://app.roadassistbharat.online (free plan: after 15 min idle the first request takes ~1 min to wake — open it before you start).
4. **Anything else** → say what failed, what it means, move on. `DEMO_FAILURE_BACKUP_PLAN.md`.

## DO NOT SAY
1. "Emergency services were contacted." — **They were not. 112 is a stub.**
2. "It works offline." — Too broad. Give the three-way split.
3. "We use AI to diagnose." — It is a rules engine, and the badge says so.

## MUST SAY
1. "Nothing has been transmitted — because nothing has."
2. "I am not touching the customer window."
3. "Eight cloud concepts are design, not provisioned. The demo is live on one Render instance — there is no cluster, and I won't show you an animation and call it an autoscaler."
