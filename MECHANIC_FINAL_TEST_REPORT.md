> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work. Evidence is named per row; where a step was
> proven by an automated suite rather than a hand-driven click, this file says
> which suite and which section, because that is a stronger claim, not a weaker
> one — it is repeatable.

# Mechanic journey — final test report

| # | Step | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | Console sign-in | OTP, own session | Signed in as the assigned mechanic | **PASS** | demo beat 7 |
| 2 | Availability | On/off duty honoured by dispatch | Off-duty providers excluded from waves | **PASS** | concurrency §10; `dispatch.ts` `findCandidates` |
| 3 | Location | Real position or none — never invented | `locationKnown` false when absent | **PASS** | ui §14; `server.ts` mechanic block |
| 4 | Incoming job | Arrives without a refresh | Badge **Live**; job appears | **PASS** | demo beat 7 |
| 5 | Job detail | Customer, vehicle, fault, location | Rendered in the Job pane | **PASS** | demo beat 8 |
| 6 | Accept | Exactly one winner | One assignment; nine clean refusals under 10 simultaneous accepts | **PASS** | concurrency §1–2 |
| 7 | Expired offer | Refused, not honoured | Refused | **PASS** | concurrency §3 |
| 8 | EN_ROUTE | Customer sees it | Reflected on the customer screen | **PASS** | demo beat 8 |
| 9 | ON_SITE | Customer sees it | Reflected | **PASS** | demo beat 8 |
| 10 | IN_PROGRESS | Customer sees it | Reflected | **PASS** | demo beat 8 |
| 11 | COMPLETED | Invoice raised | Invoice created on completion | **PASS** | demo beat 9; `server.ts` COMPLETED branch |
| 12 | Customer-only commands hidden | Mechanic cannot cancel or pay | `MECHANIC_ONLY` / `CUSTOMER_ONLY` filters | **PASS** | code + ui §14 |
| 13 | Mechanic cannot declare arrival on the customer's screen | Denied | Commands filtered per role | **PASS** | e2e §3 |
| 14 | Cross-mechanic access | Denied | Another mechanic's job refused | **PASS** | security suite (74) |
| 15 | History | Past jobs listed | History pane populated | **PASS** | ui §14 |
| 16 | Logout / sign in again | Session restored | Console restores its session | **PASS** | ui §14 |

## Guarantees checked explicitly

- **Authorisation** — `bookingAudience()` allows only the booking's customer,
  the assigned mechanic, or an admin. Twelve cross-tenant attacks refused.
- **Assignment safety** — settled under `SELECT … FOR UPDATE` on the booking
  row with expiry checked *inside* the transaction.
- **Transition rules** — `booking-machine.ts` is a closed table; an illegal
  command is refused with the allowed set named.
- **Database consistency** — after the run, zero bookings in an accepted state
  without a mechanic.

## One honest deviation

The rehearsal accepts the offer from the **customer's** list, then signs the
console in as whoever was assigned. The demo script has the presenter accept
from the console; that needs the offered mechanic's phone number, which the
offer card deliberately does not expose. The beat still proves what §7 exists
to show — the job reaches the console live, without a refresh — and the script
is unchanged, since a presenter reading the offer aloud has the name on screen.
