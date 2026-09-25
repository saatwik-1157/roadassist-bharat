> Generated 2026-09-06. Fifteen of these already exist in
> `app/docs/screenshots/`, captured from the **running** application by
> `node scripts/capture-screens.mjs`. That script asserts what is on screen
> before it presses the shutter, so it cannot silently photograph an error
> state — a real hazard, since an earlier version captured three validation
> errors without noticing. Regenerate the whole set in about ninety seconds.

# Final screenshot checklist

```bash
cd app && npm start                     # in one shell
node scripts/capture-screens.mjs        # in another → docs/screenshots/*.png at 2x
```

| # | Screen | Navigation | Test data | Expected visible result | Why it matters for SWE4004 | Slide | Have it? |
|---|---|---|---|---|---|---|---|
| 1 | Landing | `/` | — | Product framing, the off-grid claim | Positioning | 1–2 | ✅ `15-landing.png` |
| 2 | Sign in | `/app.html` | `+917000000000` | Phone + dev OTP auto-filled | SaaS to a citizen tenant | 12 | ✅ `01-login.png` |
| 3 | Customer home | after sign-in | demo customer | Greeting, SOS button, **online** pill | Broad network access | 13 | ✅ `02-home.png` |
| 4 | Vehicle | Home → Add vehicle | `KA05MZ4321` | Vehicle card, Assist now usable | Multitenant data ownership | 13 | ✅ `03-vehicle.png` |
| 5 | AI diagnosis | Assist → describe → Diagnose | "won't start, clicking sound" | Cause, **80%**, severity 3/5, "Do not drive", **`rules-1.0.0`** | Honest AI labelling — the badge *is* the point | 14 | ✅ `04-ai-diagnosis.png` |
| 6 | Dispatch | Request assistance | seeded mechanics | Ranked offers with distance and ETA | **Workload distribution + dynamic scheduling** | 15 | ✅ `05-dispatch.png` |
| 7 | Real-time tracking | after acceptance | — | Provider, rating, live distance, ETA, last-updated | Real-time mechanism | 16 | ✅ `06-tracking.png` |
| 8 | Mechanic console | `/mechanic.html` | assigned mechanic | Job, live badge, command buttons | Second tenant class | 17 | ✅ `13-mechanic-login.png` |
| 9 | Offline banner | toggle the pill | — | Red rule, "what still works" | Cloud risk mitigation | 19 | ✅ `07-offline-banner.png` |
| 10 | Offline diagnosis | Diagnose while offline | same symptoms | **LOCAL OFFLINE DIAGNOSIS** + engine version | Device/cloud parity | 19 | ✅ `08-offline-diagnosis.png` |
| 11 | Off-grid SOS | hold SOS while offline | — | `RA-XXXXXX`, GPS fix, **"Nothing has been transmitted"** | **The single most important slide** | 20 | ✅ `09-offgrid-sos.png` |
| 12 | Off-grid screen | Off-grid screen | queued incident | Two columns — what works, what does not — plus the sync journal | Honest capability matrix | 20 | ✅ `10-offgrid-screen.png` |
| 13 | Sync complete | reconnect | queued incident | "SOS synchronized", journal empty, platform reference | Store-and-forward + idempotency | 21 | ✅ `11-sync-complete.png` |
| 14 | Activity / history | Activity tab | past bookings | Booking list with status | Persistence | 16 | ✅ `12-activity.png` |
| 15 | Authority dashboard | `/raksha.html` | `+919999900001` (local; on the hosted site the admin signs in by email code) | Live counts, NH-48 corridor, road health | Third tenant class, authority scope | 22 | ✅ `14-authority.png` |
| 16 | Invoice + payment | complete a job, then Pay | demo booking | Invoice total, then **PAID** | Server-side amount authority | 18 | ⬜ **capture** |
| 17 | SOS online | hold SOS while online | — | Escalation ladder, each rung a fact | Emergency path | 20 | ⬜ **capture** |
| 18 | Live map | Map tab | seeded data | Clustered mechanics/responders/detections over India — seeded data; on the hosted demo the fleet is labelled "(simulated)" and the 34 real YOLO11 detections sit at simulated NH-48 positions. Caption it that way | Cloud storage + geospatial | 22 | ⬜ **capture** |
| 19 | Health endpoint | `/health` with the DB stopped | — | **503** `database: down` while `/v1/ping` returns 200 | **Readiness gate — dynamic scalability** | 24 | ⬜ **capture** |
| 20 | Database schema | `\dt` in psql | seeded DB | 56 tables | Data tier | 23 | ⬜ **capture** |
| 21 | Test results | `npm run test:security` | running API | `74 passed, 0 failed` | Testing evidence | 26 | ⬜ **capture** |
| 22 | Concurrency proof | `npm run test:concurrency` | running API | Ten simultaneous accepts → one winner | Concurrency guarantee | 26 | ⬜ **capture** |
| 23 | Boundaries check | `npm run boundaries` | — | `✓ module boundaries clean` | Roles and boundaries, enforced | 11 | ⬜ **capture** |
| 24 | Architecture diagram | `app/docs/architecture/` | — | C4 container view | Architecture | 10 | ✅ in deck |

**Six terminal captures (19–23) are the cheapest marks in the list.** They are
screenshots of commands that already pass, and they turn "we tested it" into
evidence a professor can read.

## Rules that produced these

- Never photograph a screen the script has not asserted first.
- Never crop out an error and present the remainder.
- Prefer a 390 px-wide window: the app is designed for a phone and looks sparse
  stretched across a projector.
