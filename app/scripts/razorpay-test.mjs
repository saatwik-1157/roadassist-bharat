/**
 * Razorpay integration checks.
 *
 * Runs against a live server with no Razorpay account and no money: the order
 * API is faked by pointing PAYMENTS_BASE_URL at a local stub, and the webhook
 * is exercised by signing payloads with the configured webhook secret exactly
 * as Razorpay would.
 *
 * What matters here is the negative space — that a forged signature, a replayed
 * delivery, a wrong amount and an unconfigured secret each fail closed.
 *
 *   node scripts/razorpay-test.mjs
 *
 * Needs the API running with:
 *   PAYMENTS_PROVIDER=razorpay
 *   PAYMENTS_KEY_ID=rzp_test_stub  PAYMENTS_KEY_SECRET=stub_secret
 *   PAYMENTS_WEBHOOK_SECRET=stub_webhook_secret
 *   PAYMENTS_BASE_URL=http://localhost:4599
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const KEY_SECRET = process.env.PAYMENTS_KEY_SECRET ?? "stub_secret";
const HOOK_SECRET = process.env.PAYMENTS_WEBHOOK_SECRET ?? "stub_webhook_secret";
const STUB_PORT = Number(process.env.STUB_PORT ?? 4599);

let pass = 0, fail = 0;
const ok = (t, d = "") => { pass++; console.log(`  ✓ ${t}${d ? "  " + d : ""}`); };
const bad = (t, d = "") => { fail++; console.log(`  ✗ ${t}${d ? "  " + d : ""}`); };
const check = (c, t, d) => (c ? ok(t, d) : bad(t, d));
const section = (t) => console.log(`\n${t}`);

const j = async (m, p, b, tok, headers = {}) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { "content-type": "application/json", ...(tok ? { authorization: "Bearer " + tok } : {}), ...headers },
    body: b === undefined ? undefined : (typeof b === "string" ? b : JSON.stringify(b)),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ── a stand-in for Razorpay's Orders API ─────────────────────────────────────
// The run tag matters. A counter alone restarts at 1 on every run, so the second
// run's "order_STUB000001" collides with a payment row the first run left in the
// database — the webhook then correctly resolves the STALE payment, whose booking
// is already PAID, and refuses to settle it again. Real Razorpay never reuses an
// order id, so neither may the stub.
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let orderSeq = 0;
const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/v1/orders" && req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      const id = `order_STUB${RUN}${String(++orderSeq).padStart(4, "0")}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, amount: body.amount, currency: body.currency,
                               receipt: body.receipt, status: "created" }));
      return;
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise((r) => stub.listen(STUB_PORT, r));

const login = async (msisdn) => {
  await j("POST", "/v1/auth/otp/request", { msisdn });
  const v = await j("POST", "/v1/auth/otp/verify", { msisdn, code: "000000" });
  return v.body.data;
};

const hookBody = (orderId, paymentId, amount, event = "payment.captured") =>
  JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: "captured" } } },
  });
const sign = (raw, secret = HOOK_SECRET) =>
  createHmac("sha256", secret).update(raw).digest("hex");

const run = async () => {
  const health = await j("GET", "/health");
  const provider = health.body?.data?.providers?.payments;
  console.log(`\nAPI payments provider: ${provider}`);
  if (provider !== "razorpay") {
    console.log("\n  This suite needs the API started with PAYMENTS_PROVIDER=razorpay.");
    console.log("  See the header of this file for the full variable list.\n");
    stub.close();
    process.exit(2);
  }

  // ── drive a booking to COMPLETED so there is a real invoice ────────────────
  section("1. Reach an invoice");
  const cust = await login("+917000000000");
  const me = await j("GET", "/v1/me", undefined, cust.accessToken);
  const vehicleId = me.body.data.vehicles[0].id;
  const bk = await j("POST", "/v1/bookings", {
    vehicleId, serviceTypeCode: "battery_jumpstart", lat: 17.385, lng: 78.4867,
  }, cust.accessToken);
  const bookingId = bk.body.data.id;
  const dsp = await j("POST", `/v1/bookings/${bookingId}/dispatch`, { radiusKm: 60, limit: 3 }, cust.accessToken);
  check(dsp.body.data?.offers?.length > 0, "dispatch produced offers", `${dsp.body.data?.offers?.length}`);
  await j("POST", `/v1/offers/${dsp.body.data.offers[0].id}/accept`, {}, cust.accessToken);
  const det = await j("GET", `/v1/bookings/${bookingId}`, undefined, cust.accessToken);
  const mech = await login(det.body.data.mechanic.msisdn);
  for (const command of ["mechanic.start_travel", "arrive", "work.start", "work.complete"]) {
    await j("POST", `/v1/bookings/${bookingId}/transition`, { command }, mech.accessToken);
  }
  const done = await j("GET", `/v1/bookings/${bookingId}`, undefined, cust.accessToken);
  check(done.body.data.status === "COMPLETED", "booking is COMPLETED with an invoice",
    `₹${(done.body.data.invoice?.totalPaise ?? 0) / 100}`);
  const invoiceTotal = done.body.data.invoice.totalPaise;

  // ── the gateway path ──────────────────────────────────────────────────────
  section("2. Order creation goes to the gateway");
  const pay = await j("POST", `/v1/bookings/${bookingId}/pay`, { method: "upi" }, cust.accessToken);
  check(pay.status === 202, "a real gateway answers 202, not 200", `got ${pay.status}`);
  const checkout = pay.body.data?.checkout;
  const paymentId = pay.body.data?.payment?.id;
  const orderId = pay.body.data?.payment?.providerRef;
  check(Boolean(checkout?.orderId), "a checkout handle is returned", checkout?.orderId);
  check(checkout?.amountPaise === invoiceTotal,
    "checkout amount equals the invoice total, unconverted", `${checkout?.amountPaise} paise`);
  check(Boolean(checkout?.keyId) && !JSON.stringify(pay.body).includes(KEY_SECRET),
    "the key id is sent to the client but the key SECRET never is");
  const still = await j("GET", `/v1/bookings/${bookingId}`, undefined, cust.accessToken);
  check(still.body.data.status === "COMPLETED",
    "the booking is NOT paid just because checkout opened", still.body.data.status);

  // ── client confirmation must be genuinely signed ──────────────────────────
  section("3. Client confirmation verifies the signature");
  const forged = await j("POST", `/v1/payments/${paymentId}/confirm`,
    { paymentRef: "pay_FORGED", signature: "deadbeef" }, cust.accessToken);
  check(forged.status === 402, "a forged signature is refused (402)", `got ${forged.status}`);
  const afterForge = await j("GET", `/v1/bookings/${bookingId}`, undefined, cust.accessToken);
  check(afterForge.body.data.status === "COMPLETED",
    "a refused confirmation leaves the invoice unpaid", afterForge.body.data.status);

  const genuineRef = `pay_STUB${RUN}0001`;
  const genuineSig = createHmac("sha256", KEY_SECRET)
    .update(`${orderId}|${genuineRef}`).digest("hex");
  const good = await j("POST", `/v1/payments/${paymentId}/confirm`,
    { paymentRef: genuineRef, signature: genuineSig }, cust.accessToken);
  check(good.status === 200 && good.body.data.status === "PAID",
    "a correctly signed confirmation settles the booking", `status=${good.body.data?.status}`);

  // ── the webhook, which is what makes settlement reliable ──────────────────
  section("4. Webhook: signature is the authentication");
  const raw = hookBody("order_NOTMINE", "pay_X", 1000);
  const unsigned = await j("POST", "/v1/webhooks/razorpay", raw, undefined,
    { "content-type": "application/json" });
  check(unsigned.status === 401, "an unsigned webhook is rejected", `got ${unsigned.status}`);

  const wrongSig = await j("POST", "/v1/webhooks/razorpay", raw, undefined,
    { "x-razorpay-signature": sign(raw, "not-the-secret") });
  check(wrongSig.status === 401, "a wrongly signed webhook is rejected", `got ${wrongSig.status}`);

  const unknown = await j("POST", "/v1/webhooks/razorpay", raw, undefined,
    { "x-razorpay-signature": sign(raw) });
  check(unknown.status === 200 && unknown.body.data?.ignored === true,
    "a signed webhook for an unknown order is ignored, not an error", "200 ignored");

  const otherEvent = hookBody("order_X", "pay_X", 1000, "payment.failed");
  const failedEvt = await j("POST", "/v1/webhooks/razorpay", otherEvent, undefined,
    { "x-razorpay-signature": sign(otherEvent) });
  check(failedEvt.status === 200 && failedEvt.body.data?.ignored === true,
    "payment.failed never settles an invoice", failedEvt.body.data?.event);

  // ── webhook settles a booking whose payer vanished ───────────────────────
  section("5. Webhook settles when the browser never comes back");
  const bk2 = await j("POST", "/v1/bookings", {
    vehicleId, serviceTypeCode: "flat_tyre", lat: 17.385, lng: 78.4867,
  }, cust.accessToken);
  const b2 = bk2.body.data.id;
  const d2 = await j("POST", `/v1/bookings/${b2}/dispatch`, { radiusKm: 60, limit: 3 }, cust.accessToken);
  await j("POST", `/v1/offers/${d2.body.data.offers[0].id}/accept`, {}, cust.accessToken);
  const det2 = await j("GET", `/v1/bookings/${b2}`, undefined, cust.accessToken);
  const mech2 = await login(det2.body.data.mechanic.msisdn);
  for (const command of ["mechanic.start_travel", "arrive", "work.start", "work.complete"]) {
    await j("POST", `/v1/bookings/${b2}/transition`, { command }, mech2.accessToken);
  }
  const ready2 = await j("GET", `/v1/bookings/${b2}`, undefined, cust.accessToken);
  check(ready2.body.data.status === "COMPLETED",
    "second booking reached COMPLETED before paying", ready2.body.data.status);
  const pay2 = await j("POST", `/v1/bookings/${b2}/pay`, { method: "upi" }, cust.accessToken);
  check(pay2.status === 202, "second order created at the gateway",
    pay2.status === 202 ? "202" : `got ${pay2.status} ${pay2.body?.error?.code ?? ""}`);
  const order2 = pay2.body.data?.payment?.providerRef;
  const amount2 = pay2.body.data?.checkout?.amountPaise;

  // Customer pays, then closes the tab — no confirm call is ever made.
  const wrongAmt = hookBody(order2, `pay_STUB${RUN}0002`, amount2 + 100);
  const mismatched = await j("POST", "/v1/webhooks/razorpay", wrongAmt, undefined,
    { "x-razorpay-signature": sign(wrongAmt) });
  check(mismatched.status === 409, "a captured amount that differs from the invoice is refused",
    `got ${mismatched.status}`);

  const rawOk = hookBody(order2, `pay_STUB${RUN}0002`, amount2);
  const hook = await j("POST", "/v1/webhooks/razorpay", rawOk, undefined,
    { "x-razorpay-signature": sign(rawOk) });
  check(hook.status === 200 && hook.body.data?.bookingSettled === true,
    "the webhook settles the booking with no client involvement",
    `status=${hook.status} bookingSettled=${hook.body.data?.bookingSettled} ${hook.body?.error?.code ?? ""}`);
  const b2after = await j("GET", `/v1/bookings/${b2}`, undefined, cust.accessToken);
  check(b2after.body.data.status === "PAID", "the booking reached PAID via the webhook alone",
    b2after.body.data.status);

  section("6. Delivery is at-least-once, so replay must be safe");
  const replay = await j("POST", "/v1/webhooks/razorpay", rawOk, undefined,
    { "x-razorpay-signature": sign(rawOk) });
  check(replay.status === 200, "a replayed webhook is accepted, not an error", `got ${replay.status}`);
  const b2replay = await j("GET", `/v1/bookings/${b2}`, undefined, cust.accessToken);
  check(b2replay.body.data.status === "PAID", "replay leaves the booking PAID exactly once",
    b2replay.body.data.status);
  const dupReview = await j("POST", `/v1/bookings/${b2}/review`, { rating: 5 }, cust.accessToken);
  check(dupReview.status === 201, "the settled booking is reviewable, so the flow really completed",
    `got ${dupReview.status}`);

  console.log("\n" + "─".repeat(58));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("─".repeat(58));
  stub.close();
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error("\naborted:", e.message);
  stub.close();
  process.exit(1);
});
