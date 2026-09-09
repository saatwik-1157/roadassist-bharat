> Executed 2026-09-06 by `npm run test:demo` — real Chrome, two windows, every
> step asserted before it is timed. Total machine time for the eleven action
> steps: **15.0 seconds**.

# Final demo smoke test

## Customer journey

| Step | Result | Evidence |
|---|---|---|
| Login | **PASS** | Home reached in 1.3 s, connectivity pill asserted `ONLINE` |
| Vehicle | **PASS** | `RC14DM3622` linked in 0.2 s |
| Incident | **PASS** | Location confirmed, symptoms accepted |
| Location | **PASS** | Step marked done; geometry written |
| AI | **PASS** | 80% confidence, engine label asserted present |
| Severity | **PASS** | Severity shown on the readout |
| Dispatch | **PASS** | **5 mechanics offered** in 0.5 s |
| Mechanic | **PASS** | Console signed in as `+919600000512`, job present |
| Accept | **PASS** | Exactly one assignment |
| Realtime | **PASS** | Customer reached COMPLETED **untouched**, 1.5 s |
| Service | **PASS** | Four transitions each confirmed before the next |
| Invoice | **PASS** | ₹411.82 |
| Payment | **PASS** | Settled — provider `mock`, logged SIMULATED |
| Completion | **PASS** | Status PAID |
| History | **PASS** | Review submitted; repeat refused |

## Offline journey

| Step | Result | Evidence |
|---|---|---|
| Network off | **PASS** | Tier left `ONLINE`, asserted |
| Offline mode | **PASS** | Banner and red rule shown |
| Local operation | **PASS** | On-device diagnosis answered; SOS created |
| Local incident | **PASS** | **`RA-AM3EJJ`** with GPS fix, encrypted |
| **Tab closed and reopened** | **PASS** | Incident survived — count unchanged |
| Network on | **PASS** | Connectivity restored |
| Sync | **PASS** | 1 incident `SYNCED` with a server id |
| Verify server state | **PASS** | **Re-sync created nothing** — no duplicate |

## Database state after the run

Ten consistency queries, all returning **0**: no orphan bookings, invoices or
payments; no duplicate references, invoice numbers or sync `op_id`s; no booking
in an accepted state without a mechanic; **no PAID booking without a settled
payment**.

## Verdict

**PASS — 23 of 23 steps.** Nine consecutive clean runs of this rehearsal across
the release. The machine is never the constraint: 15 seconds of work inside an
eight-minute budget.

One observation worth knowing on the day: the console badge read **Polling**
rather than **Live** on this run. That is the documented fallback — the stream
is an accelerator, never the source of truth — and the beat still passed in
2.4 s. If it happens live, say exactly that.
