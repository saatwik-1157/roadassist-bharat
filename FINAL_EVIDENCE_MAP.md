> The minimum set that proves the project. Fifteen already exist in
> `app/docs/screenshots/`, captured from the running app by
> `node scripts/capture-screens.mjs`, which asserts the screen before capturing.

# Final evidence map

| Evidence | Screenshot | What it proves | PPT slide |
|---|---|---|---|
| Dashboard | `02-home.png` ✅ | Signed-in citizen surface, online state | 13 |
| Vehicle | `03-vehicle.png` ✅ | Tenant-owned data | 13 |
| Incident + AI | `04-ai-diagnosis.png` ✅ | Rules engine, confidence, severity, **`rules-1.0.0` label** | 14 |
| Dispatch | `05-dispatch.png` ✅ | Ranked offers with distance and ETA — Module 4 | 15 |
| Mechanic | `13-mechanic-login.png` ✅ | Second tenant class | 17 |
| Realtime | `06-tracking.png` ✅ | Live status, provider state, ETA | 16 |
| SOS | `09-offgrid-sos.png` ✅ | Local incident + **"Nothing has been transmitted"** | 20 |
| Offline | `07-offline-banner.png`, `08-offline-diagnosis.png`, `10-offgrid-screen.png` ✅ | Degraded mode stated honestly; on-device diagnosis | 19–20 |
| Sync | `11-sync-complete.png` ✅ | Store-and-forward completing, journal empty | 21 |
| Payment | ⬜ **capture** | Invoice total then PAID | 18 |
| Security | ⬜ **capture** — `npm run test:security` | 74 attacks refused | 26 |
| Database | ⬜ **capture** — `psql \dt` | 57 tables | 23 |
| Testing | ⬜ **capture** — `npm run test:concurrency` | Ten accepts, one winner | 26 |
| Health / readiness | ⬜ **capture** — `/health` with the DB stopped | 503 vs `/v1/ping` 200 — **dynamic scalability** | 24 |
| Authority | `14-authority.png` ✅ | Third tenant class | 22 |
| Landing | `15-landing.png` ✅ | Positioning | 1 |

**Five captures outstanding, and four of them are terminal commands that already
pass.** They convert "we tested it" into evidence and cost about ten minutes:

```bash
npm run test:security       # screenshot the summary line
npm run test:concurrency    # screenshot "one winner, nine refusals"
docker exec ra-db psql -U roadassist -d roadassist_rc -c "\dt"
docker stop ra-db && curl -i localhost:4000/health && curl -i localhost:4000/v1/ping && docker start ra-db
```
