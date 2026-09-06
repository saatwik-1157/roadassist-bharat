# Final startup checklist

Follow top to bottom. No step needs Claude.

```bash
# 1–2. Terminal, then the repository
cd C:\Users\Asus\project_nirdhan\roadassist-bharat\app

# 3. Start the database (Docker Desktop must already be running)
npm run infra:up
#    → ra-db, ra-cache, ra-bus start

# 4–5. Migrate and seed — one command does reset, migrate, seed and the demo admin
npm run demo:reset
#    → "migrations complete — 57 tables"
#    → "4076 invoices · 1789 settled payments"
#    → "seeded in ~55s"
#    → "RAKSHA seed complete — demo admin ready"

# 6. Start the backend (it also serves the frontend — there is no separate frontend server)
npm start
#    → {"msg":"RoadAssist API ready","providers":{...}}

# 8. Verify health (new terminal)
curl http://localhost:4000/health
#    → {"data":{"status":"ok","application":"ok","database":"ok",...}}
```

**7. Frontend** — there is nothing separate to start. Three surfaces are served
by the same process:
- customer `http://localhost:4000/app.html`
- mechanic `http://localhost:4000/mechanic.html`
- authority `http://localhost:4000/raksha.html`

**9–11. Open and sign in.** In development the OTP is `000000` and the API
returns it, so it auto-fills.

| Role | Number |
|---|---|
| Customer | `+917000000000` (two vehicles already linked) |
| Authority / admin | `+919999900001` |
| Mechanic | whichever number the tracking screen shows after acceptance |

**12. Run the demo** — `DEMO_COMMAND_CARD.md`.

**13. Test offline** — tap the connectivity pill in the app header. Diagnose,
hold SOS, then **close the tab and reopen it**.

**14. Restore network** — tap the pill again.

**15. Verify sync** — in DevTools console:
```js
await window.__ra.listOffGrid()     // → status "SYNCED", serverId set
await window.__ra.syncOffGrid()     // run twice — the count must not change
```

## If something is wrong

| Symptom | Fix |
|---|---|
| `/health` 503 | `npm run infra:up`; `/v1/ping` still returns 200 |
| Port 4000 busy | PowerShell: `Get-NetTCPConnection -LocalPort 4000` then `Stop-Process -Id <pid> -Force` |
| Seed errors on duplicates | `npm run demo:reset` (it is not idempotent by design) |
| Two suites fail on "authority role" | You skipped `db:seed:raksha` — `npm run demo:reset` |
