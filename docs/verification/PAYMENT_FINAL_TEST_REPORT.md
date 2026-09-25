> Generated 2026-09-06 by executing the release candidate. Base commit
> `f771df5` plus uncommitted work.

# Payment — final verification

Stub only. The live demo runs `PAYMENTS_PROVIDER=mock` — no real gateway, no
real money. **No live credentials exist in this repository, and none were
invented.**

## Two tiers, stated plainly

1. **`npm run test:gateway` — 27 checks, all executed, 0 failures** (measured
   2026-09-12, `app/docs/measured.json`). Runs against a stub that speaks
   Razorpay's actual wire format, with signatures computed the same way. This
   is what proves the settlement logic.
2. **`npm run test:razorpay` — 22 checks, NOT EXECUTED, not counted in the 751.**
   `app/scripts/razorpay-test.mjs` needs no Razorpay account: it starts its own
   local stub of the Orders API and signs webhooks with a stub secret. It
   refuses to run (exit 2) unless the API was started separately with
   `PAYMENTS_PROVIDER=razorpay` and `PAYMENTS_BASE_URL` pointed at that stub,
   so it sits outside every npm test run and was not run for this measurement.

| Check | Result | Evidence |
|---|---|---|
| Invoice raised on completion, labour + 18% GST | **PASS** | gateway; ₹411.82 in demo beat 9 |
| Amount is server-side authority, never the client's number | **PASS** | amount is the invoice total; `amount=47082` sent in paise, unconverted |
| Booking cannot be marked PAID without a settled payment | **PASS** | 409 `payment_required` |
| Gateway order created; invoice not yet settled | **PASS** | 202, `payment=PENDING` |
| Checkout handle carries the gateway's order id | **PASS** | `order_STUB0000000001` |
| Adapter hits the correct endpoint | **PASS** | `POST /v1/orders` |
| HTTP Basic auth = base64(key_id:key_secret) | **PASS** | gateway |
| Forged signature settles nothing | **PASS** | 402 `payment_unverified`; booking stays COMPLETED |
| Genuine signature settles the invoice and pays the booking | **PASS** | 200, PAID |
| Replayed confirmation does not charge twice | **PASS** | idempotent |
| Unsigned webhook rejected | **PASS** | gateway |
| Wrong-signature webhook rejected | **PASS** | gateway |
| Correctly signed webhook accepted | **PASS** | gateway |
| Failed payment shows no false success | **PASS** | error surfaced; booking unchanged |

## Secrets are not reachable from the browser

`PAYMENTS_KEY_SECRET` and `PAYMENTS_WEBHOOK_SECRET` are read server-side only.
Repository-wide search found no live key of any form; the only `rzp_live_`
string is the placeholder `rzp_live_xxx` in `app/README.md` documentation. The
Razorpay checkout script is loaded lazily and only when a real gateway is
configured — the default `mock` provider never pulls it.

## The mock provider is loud about itself

It logs `[payments:mock] … — SIMULATED, no money moved`, and production
(`NODE_ENV=production`; the live demo runs `NODE_ENV=demo`) **refuses to boot**
on `mock`, or on a real gateway missing its key pair or its
webhook secret. Without that webhook secret the only settlement signal would be
the payer's own browser surviving checkout, which is a money bug rather than a
configuration nit.

## Not verified

Real Razorpay sandbox round-trip, refunds, settlement reconciliation, and
chargebacks. None is claimed anywhere in the project.
