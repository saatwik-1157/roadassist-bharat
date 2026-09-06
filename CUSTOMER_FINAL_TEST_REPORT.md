> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work. Evidence is named per row; where a step was
> proven by an automated suite rather than a hand-driven click, this file says
> which suite and which section, because that is a stronger claim, not a weaker
> one — it is repeatable.

# Customer journey — final test report

Driven twice: by `npm run test:demo` (real Chrome, two windows, timed) and by
`npm run test:e2e` / `npm run test:ui` against the live API and database.

| # | Step | Expected | Actual | Verdict | Evidence | Endpoint | Database |
|---|---|---|---|---|---|---|---|
| 1 | Request OTP | Code issued; returned in dev | `devOtp` in `meta`, auto-filled | **PASS** | demo beat 3; e2e §1 | `POST /v1/auth/otp/request` | `otp_challenges` |
| 2 | Verify OTP | Access + refresh tokens | Signed in, home screen | **PASS** | demo beat 3 (1.0 s) | `POST /v1/auth/otp/verify` | `sessions`, `users` |
| 3 | Connectivity state | Pill reads ONLINE | `__ra.tier() === "ONLINE"` | **PASS** | demo beat 3 asserts it | `GET /v1/ping` | — |
| 4 | Profile | Name/phone shown, editable | Rendered from `/v1/me` | **PASS** | ui §6; e2e §3 | `GET /v1/me`, `PATCH /v1/me` | `users` |
| 5 | Add vehicle | Vehicle linked, Assist usable | `RC…DM…` linked in 0.2 s | **PASS** | demo beat 4 | `POST /v1/vehicles` | `vehicles`, `user_vehicles` |
| 6 | Duplicate registration | Refused, not duplicated | 409 | **PASS** | e2e §4 | `POST /v1/vehicles` | unique index |
| 7 | Location | Confirmed, never taken silently | Step marked done | **PASS** | demo beat 5; ui §9 | client geolocation | `bookings.location` |
| 8 | Diagnosis | Cause, confidence, severity, engine label | 80%, severity shown, `rules-1.0.0` | **PASS** | demo beat 5 asserts the label | `POST /v1/diagnose` | `diagnostic_sessions`, `model_predictions` |
| 9 | Incident/booking creation | Booking created with reference | `RA…` created | **PASS** | demo beat 6; e2e §6 | `POST /v1/bookings` | `bookings` |
| 10 | Dispatch | Ranked nearby mechanics with ETA | 4–5 offers, real distances | **PASS** | demo beat 6 (0.3 s) | `POST /v1/bookings/:id/dispatch` | `dispatch_offers` |
| 11 | Acceptance | Exactly one assignment | Moves to live tracking | **PASS** | demo beat 7; concurrency §1–2 | `POST /v1/offers/:id/accept` | `bookings.mechanic_id` |
| 12 | Real-time status | Screen follows without a refresh | COMPLETED in 0.8–1.4 s, untouched | **PASS** | demo beat 8 | `GET /v1/events` (SSE) | `booking_events` |
| 13 | ETA / distance | Real values, or null — never invented | `km away · ETA n min`; null when not travelling | **PASS** | ui §10 | `GET /v1/bookings/:id` | `mechanics.last_location` |
| 14 | Invoice | Total with labour + 18% GST | ₹411.82 shown, marked pending | **PASS** | demo beat 9 | `GET /v1/bookings/:id` | `invoices` |
| 15 | Payment | Booking → PAID only on settlement | PAID, provider `mock`, logged SIMULATED | **PASS** | demo beat 9; gateway suite | `POST /v1/bookings/:id/pay` | `payments` |
| 16 | Review | Accepted once; second refused | Submitted; repeat → 409 | **PASS** | demo beat 10; e2e §20 | `POST /v1/bookings/:id/review` | `reviews` |
| 17 | History | Past bookings listed | Activity screen lists them | **PASS** | ui §10 | `GET /v1/bookings` | `bookings` |
| 18 | Notifications | Status changes announced | Toast per transition | **PASS** | demo beat 8 | SSE | — |
| 19 | Logout / sign in again | Session restored, no data loss | Survives reload and relaunch | **PASS** | ui §4, §5 | `POST /v1/auth/refresh` | `sessions` |

**Failures: none.** Two defects were found and fixed during this journey — see
`REALTIME_FINAL_TEST_REPORT.md`; both were caught by the two-window rehearsal
and neither was visible to the single-tab browser suite.
