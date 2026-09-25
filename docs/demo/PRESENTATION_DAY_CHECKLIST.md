# Presentation-day checklist

## Night before

- [ ] Code committed and backed up (**currently uncommitted — do this first**)
- [ ] `ppt/RoadAssist-Bharat-FINAL.pdf` copied to a USB stick **and** emailed to yourself
- [ ] `ppt/RoadAssist-Bharat-FINAL.pptx` backed up alongside it
- [ ] Screenshots backed up — `app/docs/screenshots/` (15 files)
- [ ] Demo video backed up *(optional — none recorded; only if your rubric needs one)*
- [ ] Repository ZIP created — see `FINAL_SUBMISSION_PACKAGE.md`
- [ ] `npm run demo:reset` run, so the data is fresh
- [ ] Demo accounts tested — `+917000000000` and `+919999900001` both sign in locally (on the hosted site the admin signs in by email code)
- [ ] Database tested — `/health` returns `database: ok`
- [ ] Environment tested — `npm start` boots with no error-level log line
- [ ] **`npm run test:demo` run once end to end — all 15 beats pass**
- [ ] Offline demo tested — pill toggle, tab close, reopen, sync
- [ ] Laptop charged · charger packed
- [ ] Internet backup available *(not needed for the local stage demo; needed if you fall back to the hosted demo at https://app.roadassistbharat.online — open it once beforehand, the free plan takes ~1 min to wake)*

## Before presenting

- [ ] Docker Desktop running
- [ ] `npm run infra:up` → three containers up
- [ ] `npm start` → `RoadAssist API ready`
- [ ] `curl http://localhost:4000/health` → 200, `database: ok`
- [ ] Customer window open at ~430 px — `app.html`, signed in
- [ ] Mechanic window open at ~430 px — `mechanic.html`, signed out (you sign in live)
- [ ] Payments — provider is `mock` on the live demo; nothing to verify, and **do not test a live payment**
- [ ] Network toggle tested — tap the pill once, confirm red, tap back
- [ ] PPT open **as the PDF**, not PowerPoint (PowerPoint reflows on unfamiliar machines)
- [ ] Backup evidence reachable — `app/docs/screenshots/`
- [ ] Close Slack, mail, notifications, and any other browser windows
- [ ] `ROADASSIST_FINAL_CHEAT_SHEET.md` printed or on a second device

## The two things people forget

1. **Close the SOS sheet** after the online SOS beat, before going off-grid.
2. **Do not touch the customer window** while the mechanic drives the job — that
   is the whole point of the real-time beat.
