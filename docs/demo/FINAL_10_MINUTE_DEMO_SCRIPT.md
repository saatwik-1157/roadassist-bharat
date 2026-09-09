> Generated 2026-09-06. Timing is **measured**, not estimated:
> `npm run test:demo` walks all fifteen beats in two live browser windows and
> reports machine time per beat. The eleven action beats consume **10–20
> seconds** of machine time against an 8:05 budget, so every remaining second
> is yours to talk in. Nine consecutive clean runs.

# Final 10-minute demo script

The detailed per-beat script — with a backup for every step — lives in
`app/docs/DEMO-SCRIPT.md` and is current. This file is the running order and
the clock.

## Before you start

```bash
cd app
npm run demo:reset        # fresh, consistent data — 60s
npm start
node scripts/demo-rehearsal.mjs --headed    # optional: watch it once
```

Two browser windows, side by side: customer `/app.html`, mechanic
`/mechanic.html`. Phone-width, not full screen. **Run everything locally** —
never demo the off-grid section over conference Wi-Fi with the API on a tunnel.

## Running order

| Time | Beat | Action | The line that matters |
|---|---|---|---|
| 0:00–0:45 | **Problem** | speak | "A breakdown is not a software problem until you notice the app you'd use to fix it needs the network you don't have." |
| 0:45–1:15 | **Solution** | speak | "AI-powered, cloud-connected, network-resilient. The third one is the claim we defend." |
| 1:15–1:45 | **Customer login** | `/app.html`, phone, Send code, Verify | "Real OTP against the live API." |
| 1:45–2:05 | **Vehicle** | add registration | — |
| 2:05–2:50 | **Incident + AI** | symptoms → Diagnose | "Deterministic rules, and the badge says `rules-1.0.0`. It is the fallback any model must beat — and it is the same table that runs on the phone offline." |
| 2:50–3:35 | **Dispatch** | Request assistance | "PostGIS nearest-neighbour, then ranked: proximity 60%, rating 34%, plus a newcomer bonus. Providers already on a job are excluded." |
| 3:35–4:20 | **Mechanic** | console → Accept | "That offer arrived over server-sent events the moment the server wrote it." |
| 4:20–4:50 | **Real-time** | En route → Arrived → Start → Complete | "Nobody refreshed anything. Watch the customer window — I'm not touching it." |
| 4:50–5:35 | **Payment** | invoice → Pay | "The amount is never taken from the request — it's the invoice total. Provider is `mock` and it logs *SIMULATED, no money moved*. Production refuses to boot on it." |
| 5:35–5:50 | **Review** | rate, submit, submit again | "Second attempt: 409 already reviewed." |
| 5:50–6:20 | **Online SOS** | hold SOS 1.5 s | "Every rung says whether it actually happened. Contacts alerted shows the real number. The 112 handoff is stubbed and our own API response says so." |
| 6:20–8:20 | **THE MOMENT — offline** | **close the SOS sheet**, tap the pill, diagnose, hold SOS, open the off-grid screen, **close the tab and reopen it** | "Nothing has been transmitted. It says so, because it hasn't. And the reference is short enough to read aloud over a borrowed phone." |
| 8:20–9:20 | **Reconnect + sync** | tap the pill; then in the console `await window.__ra.listOffGrid()` | "`status: SYNCED`. Sync again — no duplicate. One emergency, not two." |
| 9:20–10:00 | **Cloud + close** | `SWE4004-MAPPING.md`, then close | "Eight implemented, five partial, eight designed and not provisioned. I'd rather tell you that than show you an animation and call it an autoscaler." |

## The two beats that win marks

1. **Closing the tab and reopening it while off-grid.** Unanswerable. It is
   either there or it is not, and it is there.
2. **Stopping PostgreSQL** if you have a spare minute: `/health` turns 503 and
   names the database, while `/v1/ping` still answers 200. That is the
   readiness gate, and it is the one piece of dynamic scalability that is real.

## One step people forget

**Close the SOS sheet after the online SOS, before going off-grid.** An
emergency is still active until you do, and holding SOS again answers *"An
emergency is already active"* — correct behaviour, confusing on stage. The
timed rehearsal walked straight into it.
