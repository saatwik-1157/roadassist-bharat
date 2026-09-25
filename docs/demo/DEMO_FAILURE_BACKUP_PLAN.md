> Generated 2026-09-06. **No backup here fakes a result.** Where a failure
> cannot be recovered live, the honest failure *is* the demonstration — this
> platform's entire argument is that it degrades in public rather than in
> secret.

# Demo failure backup plan

| What fails | First response | Backup | Does it fake anything? |
|---|---|---|---|
| **Internet** | Nothing. The stage demo is local — `localhost:4000` and a local database. Conference Wi-Fi is not in the path. (The hosted copy at `app.roadassistbharat.online` does need the internet — it is the backup, not the stage run) | Say so out loud; it strengthens the point | No |
| **Backend down** | Restart: `npm start`. It boots in ~2 s | The PWA still serves its cached shell; show that instead — it is the offline story | No |
| **Database down** | `npm run infra:up` | **Show it deliberately.** `/health` → 503 `database: down`, `/v1/ping` → 200. This is a *planned* beat, not a disaster | No |
| **Payment gateway** | Provider is `mock` by default — there is no gateway to fail | If payment errors, show the log line and `assertProductionSafe`. **Never claim a payment succeeded** | No |
| **GPS unavailable** | Expected in a lecture theatre | The app falls back to an approximate fix *and says so*. Read that message aloud — it is the honesty argument | No |
| **AI diagnosis** | Rules engine is local; nothing to call | If it ever errors, the on-device engine answers and labels itself `LOCAL OFFLINE DIAGNOSIS` | No |
| **Real-time** | Badge reads **Polling** instead of Live | Press Refresh. The console works on its 6 s poll. Say it: *the stream is an accelerator, never the source of truth* | No |
| **No mechanic offered** | Widen the radius to 60 km | If still none: that is `NO_SUPPLY` with a **named reason**. Show `skippedByState` — the platform says *why*, not just "no". Then continue from the SOS beat, which needs no mechanic | No |
| **Demo account broken** | `npm run demo:reset` — 60 s, restores everything | Any seeded customer works; the OTP is `000000` for all of them | No |
| **Whole laptop dies** | Borrow any device and open the live demo, https://app.roadassistbharat.online — one Render service in Singapore on a free plan, so allow ~1 min to wake after 15 min idle. Ordinary demo accounts use the on-screen OTP; the admin, RAKSHA officer and listed mechanics sign in by email code only | `ppt/RoadAssist-Bharat-FINAL.pdf` (32 pages) plus the 15 screenshots in `app/docs/screenshots/`, each captured from the running app | Screenshots are real captures. **Say they are screenshots.** The hosted demo is real but runs `NODE_ENV=demo` with mock payments and no real SMS — say that too |

## Pre-recorded material

There is none, and none is needed. Every beat runs locally in 10–20 seconds of
machine time.

If you choose to record one as insurance, label it on the slide as a recording.
An unlabelled recording presented as live is the single fastest way to lose the
credibility this project spent two phases earning.

## The rule

If something fails and cannot be recovered in fifteen seconds, **say what
failed, say what it means, and move on.** A demo where one step fails and the
presenter explains it accurately beats a demo where nothing fails and nobody
believes it.
