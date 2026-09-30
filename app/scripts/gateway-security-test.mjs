#!/usr/bin/env node
/**
 * Gateway security suite: webhook signatures, per-IP OTP ceiling, and the
 * Twilio and Razorpay adapters' wire formats — proven against a hardened API
 * instance and a stub vendor endpoint. It also owns the SMS line's truthfulness:
 * an SMS SOS texts the contacts it says it texted, STOP/START are stored and
 * honoured (by the app's SOS confirm too), an SMS CANCEL cannot overwrite an
 * accept, and a cancel closes the booking's offers. Run from app/:
 *   node scripts/gateway-security-test.mjs
 *
 * Needs the database up (docker compose locally, the service container in CI).
 * Spawns its own API on API_PORT (default 4101), and afterwards a NODE_ENV=demo
 * instance with no webhook secret on DEMO_API_PORT (default API_PORT + 1) — the
 * dev server on :4000 is untouched.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = Number(process.env.API_PORT ?? 4101);
const STUB_PORT = Number(process.env.STUB_PORT ?? 4980);
const BASE = `http://localhost:${API_PORT}`;
const SECRET = "whsec-test-3f9a";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://roadassist:devpassword@localhost:5434/roadassist";

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
  if (cond) pass++;
  else fail++;
};

// The per-IP test needs a deterministic starting count. OTP challenges are
// transient auth artifacts; clearing IP-attributed ones is safe on a test or
// dev database — and refused anywhere else, same guard as db reset.
if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("✗ refusing to run against a non-local DATABASE_URL");
  process.exit(1);
}
const { default: postgres } = await import("postgres");
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const clearOtpAttempts = () => sql`DELETE FROM otp_challenges WHERE ip IS NOT NULL`;
await clearOtpAttempts();

// 1. stub vendor endpoints — record exactly what each adapter sends
const RZP_KEY = "rzp_test_stub";
const RZP_SECRET = "rzp-secret-test-71c4";
const RZP_ORDER = "order_STUB0000000001";
const RZP_HOOK_SECRET = "rzp-webhook-test-5d2e";
let lastTwilio = null;
let lastRazorpay = null;
/** Numbers the stub gateway refuses to deliver to, as a vendor outage would. */
const UNDELIVERABLE = new Set();
/** Every SMS the Twilio stub accepted, in order: who was actually texted. */
const twilioSent = [];
const textedSince = (mark, to) => twilioSent.slice(mark).filter((m) => m.to === to);
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const captured = { url: req.url, auth: req.headers.authorization ?? "", ct: req.headers["content-type"] ?? "", body };
    if (req.url === "/v1/orders") {
      lastRazorpay = captured;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: RZP_ORDER, entity: "order", status: "created" }));
    }
    if (UNDELIVERABLE.has(new URLSearchParams(body).get("To"))) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: "stub outage" }));
    }
    lastTwilio = captured;
    const sentForm = new URLSearchParams(body);
    twilioSent.push({ to: sentForm.get("To"), body: sentForm.get("Body") ?? "" });
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ sid: "SMstub123" }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, r));

// 2. hardened API instance
const api = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: resolve(APP_DIR, "apps/api"),
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATABASE_URL,
    TELECOM_WEBHOOK_SECRET: SECRET,
    OTP_IP_MAX: "3",
    SMS_PROVIDER: "twilio",
    SMS_API_KEY: "AC000000000000000000000000deadbeef:authtok",
    SMS_SENDER_ID: "+15550000001",
    SMS_BASE_URL: `http://localhost:${STUB_PORT}`,
    PAYMENTS_PROVIDER: "razorpay",
    PAYMENTS_KEY_ID: RZP_KEY,
    PAYMENTS_KEY_SECRET: RZP_SECRET,
    PAYMENTS_BASE_URL: `http://localhost:${STUB_PORT}`,
    PAYMENTS_WEBHOOK_SECRET: RZP_HOOK_SECRET,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let apiErr = "";
api.stderr.on("data", (d) => (apiErr += d));

let up = false;
for (let i = 0; i < 180; i++) {   // up to 90 s: tsx compiles the API on boot, slow on a loaded machine
  try { if ((await fetch(BASE + "/health")).ok) { up = true; break; } } catch { /* booting */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  console.error("✗ hardened API instance failed to start:\n" + apiErr.slice(0, 1200));
  api.kill(); stub.close();
  process.exit(1);
}

console.log("\nGateway security — verification\n");

// ── webhook signature ──
const payload = JSON.stringify({ from: "+919812340001", text: "STATUS" });
const unsigned = await fetch(BASE + "/v1/telecom/sms", {
  method: "POST", headers: { "content-type": "application/json" }, body: payload,
});
ok("unsigned webhook rejected", unsigned.status === 401, `got ${unsigned.status}`);

const badSig = await fetch(BASE + "/v1/telecom/sms", {
  method: "POST",
  headers: { "content-type": "application/json", "x-roadassist-signature": "deadbeef".repeat(8) },
  body: payload,
});
ok("wrong signature rejected", badSig.status === 401, `got ${badSig.status}`);

const goodSig = createHmac("sha256", SECRET).update(payload).digest("hex");
const signed = await fetch(BASE + "/v1/telecom/sms", {
  method: "POST",
  headers: { "content-type": "application/json", "x-roadassist-signature": goodSig },
  body: payload,
});
const signedJson = await signed.json();
ok("correctly signed webhook accepted", signed.status === 200 && Boolean(signedJson.data?.reply),
   (signedJson.data?.reply ?? "").slice(0, 40));

// The demo-number exemption exists only on a server with NO secret. Here there
// is one, so a demo number is held to the signature like everybody else.
const unsignedDemo = await fetch(BASE + "/v1/telecom/sms", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ from: "+917000000042", text: "STATUS" }),
});
ok("an unsigned demo number is refused too when a secret is set", unsignedDemo.status === 401,
   `got ${unsignedDemo.status}`);

// ── Twilio adapter wire format (captured by the stub) ──
ok("Twilio adapter hit the Messages endpoint",
   Boolean(lastTwilio) && lastTwilio.url === "/2010-04-01/Accounts/AC000000000000000000000000deadbeef/Messages.json",
   lastTwilio?.url ?? "no request captured");
ok("HTTP Basic auth = base64(SID:token)",
   lastTwilio?.auth === "Basic " + Buffer.from("AC000000000000000000000000deadbeef:authtok").toString("base64"));
const form = new URLSearchParams(lastTwilio?.body ?? "");
ok("form-encoded From/To/Body present",
   (lastTwilio?.ct ?? "").includes("x-www-form-urlencoded") &&
   form.get("From") === "+15550000001" && form.get("To") === "+919812340001" && Boolean(form.get("Body")));

// ── webhook rate limit, per sending number ──
// Keyed by the number, not the IP: every signed request comes from the vendor.
// After the Twilio checks above, because each accepted message is a stub send.
const signedSms = (from, text) => {
  const body = JSON.stringify({ from, text });
  return fetch(BASE + "/v1/telecom/sms", {
    method: "POST",
    headers: { "content-type": "application/json",
               "x-roadassist-signature": createHmac("sha256", SECRET).update(body).digest("hex") },
    body,
  });
};
const noisy = "+9198123" + String(Math.floor(10000 + Math.random() * 89999));
const smsBurst = [];
for (let i = 0; i < 31; i++) smsBurst.push((await signedSms(noisy, "STOP")).status);
ok("thirty signed messages from one number are accepted", smsBurst.slice(0, 30).every((s) => s === 200),
   [...new Set(smsBurst.slice(0, 30))].join(","));
ok("the thirty-first from the same number is throttled (429)", smsBurst[30] === 429, `got ${smsBurst[30]}`);
const neighbour = await signedSms(noisy.slice(0, -1) + ((Number(noisy.slice(-1)) + 1) % 10), "STOP");
ok("another number from the same vendor IP is unaffected", neighbour.status === 200, `got ${neighbour.status}`);

// ── a reply the gateway cannot send ──
// The SOS is raised before the reply goes out. A failed reply used to turn the
// whole webhook into a 500, and a vendor redelivers a failed webhook - so the
// same text raised a second incident. It must answer 200 and say so instead.
const unreachable = "+9197" + String(Math.floor(10000000 + Math.random() * 89999999));
UNDELIVERABLE.add(unreachable);
const strandedSos = await signedSms(unreachable, "SOS 28.4595 77.0266");
const strandedJson = await strandedSos.json().catch(() => ({}));
ok("an SOS whose reply cannot be sent still answers 200, saying so",
   strandedSos.status === 200 && strandedJson.meta?.replyDelivered === false,
   `got ${strandedSos.status} ${strandedJson.error?.code ?? ""}`);
const [raised] = await sql`
  SELECT count(*)::int AS n FROM incidents i JOIN users u ON u.id = i.user_id WHERE u.msisdn = ${unreachable}`;
ok("and it raised exactly one incident", raised?.n === 1, `${raised?.n} incident(s)`);

// ── an SMS SOS really alerts the contacts, and STOP really stops ──
// The SMS SOS used to write a "contacts" response row with latency 0 and text
// nobody; STOP replied "no further messages" and stored nothing; START was not
// a command. Checked here against what the stub gateway actually received.
const rnd = (prefix) => prefix + String(Math.floor(10000000 + Math.random() * 89999999));
const smsOwner = rnd("+9196"), contactA = rnd("+9195"), contactB = rnd("+9194");
await signedSms(smsOwner, "STATUS");   // first contact registers the number
await sql`
  INSERT INTO emergency_contacts (user_id, name, msisdn, priority)
  SELECT id, 'GW contact A', ${contactA}, 1 FROM users WHERE msisdn = ${smsOwner}
  UNION ALL
  SELECT id, 'GW contact B', ${contactB}, 2 FROM users WHERE msisdn = ${smsOwner}`;

const stopReply = await (await signedSms(contactB, "UNSUBSCRIBE")).json();
const [stopRow] = await sql`
  SELECT keyword, opted_back_in_at FROM sms_opt_outs WHERE msisdn = ${contactB} AND deleted_at IS NULL`;
ok("STOP (here its synonym UNSUBSCRIBE) is stored, not just acknowledged",
   stopRow?.keyword === "unsubscribe" && stopRow.opted_back_in_at === null, JSON.stringify(stopRow ?? null));
ok("and the reply says plainly that emergency alerts stop too",
   /no further messages/i.test(stopReply.data?.reply ?? "") && /emergency alerts/i.test(stopReply.data?.reply ?? ""),
   (stopReply.data?.reply ?? "").slice(0, 60));

let mark = twilioSent.length;
const smsSosRes = await (await signedSms(smsOwner, "SOS 28.4595 77.0266")).json();
const smsIncident = smsSosRes.meta?.incidentId;
ok("an SMS SOS texts the sender's emergency contacts, with the incident link",
   textedSince(mark, contactA).some((m) => m.body.includes(`/i/${smsIncident}`)),
   `${textedSince(mark, contactA).length} message(s) to contact A`);
ok("but not the contact who texted STOP", textedSince(mark, contactB).length === 0,
   `${textedSince(mark, contactB).length} message(s) to contact B`);
ok("and says so: one alerted, one opted out",
   smsSosRes.meta?.contactsAlerted === 1 && smsSosRes.meta?.contactsOptedOut === 1,
   `alerted=${smsSosRes.meta?.contactsAlerted} optedOut=${smsSosRes.meta?.contactsOptedOut}`);
const [smsInc] = smsIncident ? await sql`SELECT status FROM incidents WHERE id = ${smsIncident}` : [];
const smsSteps = smsIncident ? await sql`
  SELECT step, latency_ms FROM incident_responses WHERE incident_id = ${smsIncident} ORDER BY step` : [];
const contactsStep = smsSteps.find((s) => s.step === "contacts");
ok("the incident escalated, and its contacts step carries a measured latency, not a 0",
   smsInc?.status === "RESPONDING" && smsSteps.filter((s) => s.step === "contacts").length === 1 &&
   contactsStep?.latency_ms > 0,
   `status=${smsInc?.status} steps=${smsSteps.map((s) => `${s.step}:${s.latency_ms}`).join(",")}`);
const [escalatedAudit] = smsIncident ? await sql`
  SELECT after FROM audit_log WHERE entity_id = ${smsIncident} AND action = 'sos.escalated'` : [];
ok("the audit record carries the real count",
   escalatedAudit?.after?.contactsAlerted === 1 && escalatedAudit?.after?.contactsOptedOut === 1 &&
   escalatedAudit?.after?.channel === "sms", JSON.stringify(escalatedAudit?.after ?? null));

const startReply = await (await signedSms(contactB, "START")).json();
const [startRow] = await sql`SELECT opted_back_in_at FROM sms_opt_outs WHERE msisdn = ${contactB}`;
ok("START is a command: it opts the number back in and says so",
   startRow?.opted_back_in_at !== null && startRow?.opted_back_in_at !== undefined &&
   /opted back in/i.test(startReply.data?.reply ?? ""), (startReply.data?.reply ?? "").slice(0, 50));
mark = twilioSent.length;
const smsSos2 = await (await signedSms(smsOwner, "SOS")).json();
ok("and the next SOS texts that contact again",
   textedSince(mark, contactB).length === 1 && smsSos2.meta?.contactsAlerted === 2,
   `B texted ${textedSince(mark, contactB).length}x, alerted=${smsSos2.meta?.contactsAlerted}`);

// ── an SMS CANCEL that loses the race to a mechanic's accept ──
// The cancel was `WHERE id = ?`: an accept landing between its read and its
// write was overwritten, leaving a CANCELLED booking with a mechanic driving
// to it. Made deterministic by holding the booking row lock: the accept below
// is written and held uncommitted, the CANCEL is sent and blocks on the lock,
// then the accept commits and the CANCEL's write is re-checked against it.
{
  const racer = rnd("+9193");
  await signedSms(racer, "HELP CAR");
  const [bk] = await sql`
    SELECT b.id, b.version FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE u.msisdn = ${racer} ORDER BY b.created_at DESC LIMIT 1`;
  await sql`UPDATE bookings SET status = 'MATCHING', version = version + 1 WHERE id = ${bk.id}`;
  const [mech] = await sql`SELECT id FROM mechanics WHERE deleted_at IS NULL AND verified LIMIT 1`;
  const watcher = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  let cancelRes;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM bookings WHERE id = ${bk.id} FOR UPDATE`;
      await tx`UPDATE bookings SET status = 'ASSIGNED', mechanic_id = ${mech.id}, assigned_at = now(),
                      version = version + 1 WHERE id = ${bk.id}`;
      cancelRes = signedSms(racer, "CANCEL");
      // Wait until the CANCEL's write is queued behind this lock.
      for (let i = 0; i < 100; i++) {
        const [w] = await watcher`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'update "bookings"%'`;
        if (w.n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    const lost = await (await cancelRes).json();
    const [after] = await sql`SELECT status, mechanic_id FROM bookings WHERE id = ${bk.id}`;
    ok("an SMS CANCEL that loses to an accept does not overwrite it",
       after.status === "ASSIGNED" && after.mechanic_id === mech.id, `${after.status} mechanic=${Boolean(after.mechanic_id)}`);
    ok("and tells the customer a mechanic accepted, and that cancelling now costs a fee",
       /mechanic accepted/i.test(lost.data?.reply ?? "") && /fee/i.test(lost.data?.reply ?? ""),
       (lost.data?.reply ?? "").slice(0, 70));
  } finally {
    await watcher.end();
  }
}

// ── an SMS CANCEL closes the booking's open offers ──
{
  const canceller = rnd("+9192");
  await signedSms(canceller, "HELP BIKE");
  const [bk] = await sql`
    SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE u.msisdn = ${canceller} ORDER BY b.created_at DESC LIMIT 1`;
  const [mech] = await sql`SELECT id FROM mechanics WHERE deleted_at IS NULL AND verified LIMIT 1`;
  await sql`UPDATE bookings SET status = 'MATCHING', version = version + 1 WHERE id = ${bk.id}`;
  await sql`INSERT INTO dispatch_offers (booking_id, mechanic_id, rank, expires_at)
            VALUES (${bk.id}, ${mech.id}, 1, now() + interval '90 seconds')`;
  const res = await (await signedSms(canceller, "CANCEL")).json();
  const offerStates = await sql`SELECT status FROM dispatch_offers WHERE booking_id = ${bk.id}`;
  ok("an SMS CANCEL withdraws the booking's live offers in the same step",
     /cancelled/i.test(res.data?.reply ?? "") && offerStates.length === 1 && offerStates[0].status === "WITHDRAWN",
     offerStates.map((o) => o.status).join(","));
}

// ── Razorpay adapter: order creation + signature-gated settlement ──
// A booking is only PAID once the *gateway* says the money arrived. This drives
// a real job to COMPLETED, then proves the invoice cannot be closed without a
// signature that verifies against the shared secret.
const api1 = async (method, path, { token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

/**
 * Read the OTP out of the SMS the stub captured.
 *
 * This instance runs with SMS_PROVIDER=twilio so the adapter's wire format can
 * be checked, and that means the code is random and is NOT returned in the API
 * response — `otpPolicy` refuses to publish a credential that reached a
 * handset. So the suite does what a real user does: reads it off the message.
 *
 * It used to take `meta.devOtp`, which only worked because a fixed code was
 * being echoed even with a gateway configured. Going through the SMS makes
 * every sign-in below an end-to-end test of real OTP delivery.
 */
const otpFromSms = () => {
  const body = lastTwilio?.body ?? "";
  const text = new URLSearchParams(body).get("Body") ?? "";
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error(`no OTP in the captured SMS: ${text || "(nothing captured)"}`);
  return code;
};

const payer = "+91" + (7000000000 + Math.floor(Math.random() * 8e8));
const challenge = await api1("POST", "/v1/auth/otp/request", { body: { msisdn: payer } });
// The response carries no code — only that one was sent, and by what.
ok("a configured gateway means the code is never echoed over HTTP",
   challenge.meta?.devOtp === undefined && challenge.data?.channel === "twilio",
   `channel=${challenge.data?.channel} devOtp=${challenge.meta?.devOtp}`);
const session = await api1("POST", "/v1/auth/otp/verify", { body: { msisdn: payer, code: otpFromSms() } });
const payToken = session.data?.accessToken;

const vehicle = await api1("POST", "/v1/vehicles", {
  token: payToken,
  body: { registrationNo: "DL01PY" + Math.floor(1000 + Math.random() * 8999), vehicleClass: "car" },
});
const job = await api1("POST", "/v1/bookings", {
  token: payToken,
  body: { vehicleId: vehicle.data?.id, serviceTypeCode: "flat_tyre", lat: 28.4595, lng: 77.0266 },
});
const jobId = job.data?.id;
const offers = await api1("POST", `/v1/bookings/${jobId}/dispatch`, { token: payToken, body: { radiusKm: 40, limit: 5 } });
await api1("POST", `/v1/offers/${offers.data?.offers?.[0]?.id}/accept`, { token: payToken });
let completed = {};
for (const command of ["mechanic.start_travel", "arrive", "work.start", "work.complete"]) {
  completed = await api1("POST", `/v1/bookings/${jobId}/transition`, { token: payToken, body: { command } });
}
const invoiceTotal = completed.data?.invoice?.totalPaise;
ok("job reached COMPLETED with an invoice", completed.data?.status === "COMPLETED" && invoiceTotal > 0,
   invoiceTotal ? `₹${(invoiceTotal / 100).toFixed(2)}` : "no invoice");

const freeSettle = await api1("POST", `/v1/bookings/${jobId}/transition`, {
  token: payToken, body: { command: "payment.settled" },
});
ok("a booking cannot be marked PAID without a settled payment",
   freeSettle.status === 409 && freeSettle.error?.code === "payment_required",
   `got ${freeSettle.status} ${freeSettle.error?.code ?? ""}`);

const order = await api1("POST", `/v1/bookings/${jobId}/pay`, { token: payToken, body: { method: "upi" } });
ok("gateway order created, invoice not yet settled",
   order.status === 202 && order.data?.payment?.status === "PENDING" && order.data?.status === "COMPLETED",
   `got ${order.status} payment=${order.data?.payment?.status}`);
ok("checkout handle carries the gateway's order id",
   order.data?.checkout?.orderId === RZP_ORDER && order.data?.checkout?.keyId === RZP_KEY,
   order.data?.checkout?.orderId ?? "none");

ok("Razorpay adapter hit the Orders endpoint", lastRazorpay?.url === "/v1/orders",
   lastRazorpay?.url ?? "no request captured");
ok("HTTP Basic auth = base64(key_id:key_secret)",
   lastRazorpay?.auth === "Basic " + Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString("base64"));
const rzpBody = JSON.parse(lastRazorpay?.body || "{}");
ok("amount sent in paise, unconverted, with the invoice as the receipt",
   rzpBody.amount === invoiceTotal && rzpBody.currency === "INR" && Boolean(rzpBody.receipt),
   `amount=${rzpBody.amount} currency=${rzpBody.currency}`);

const paymentId = order.data?.payment?.id;
const forged = await api1("POST", `/v1/payments/${paymentId}/confirm`, {
  token: payToken, body: { paymentRef: "pay_FORGED0001", signature: "0".repeat(64) },
});
ok("a forged gateway signature settles nothing",
   forged.status === 402 && forged.error?.code === "payment_unverified",
   `got ${forged.status} ${forged.error?.code ?? ""}`);
const stillOwing = await api1("GET", `/v1/bookings/${jobId}`, { token: payToken });
ok("the booking is still COMPLETED after the forged confirmation",
   stillOwing.data?.status === "COMPLETED", stillOwing.data?.status);

const rzpPaymentId = "pay_STUB0000000001";
const realSig = createHmac("sha256", RZP_SECRET).update(`${RZP_ORDER}|${rzpPaymentId}`).digest("hex");
const settled = await api1("POST", `/v1/payments/${paymentId}/confirm`, {
  token: payToken, body: { paymentRef: rzpPaymentId, signature: realSig },
});
ok("a genuine gateway signature settles the invoice and pays the booking",
   settled.status === 200 && settled.data?.status === "PAID",
   `got ${settled.status} ${settled.data?.status ?? ""}`);

const replayed = await api1("POST", `/v1/payments/${paymentId}/confirm`, {
  token: payToken, body: { paymentRef: rzpPaymentId, signature: realSig },
});
ok("replaying the confirmation does not charge twice",
   replayed.status === 200 && replayed.data?.alreadySettled === true);

// A capture for an invoice that is already settled - the customer paid online
// after the mechanic recorded cash, say. The second settlement is refused by
// payments_invoice_settled_uq, and in the webhook that refusal escaped as a
// 500; Razorpay retries a failed webhook for a day, failing the same way each
// time. It must answer 2xx, keep the capture PENDING for reconciliation, and
// say it needs refunding.
{
  const [inv] = await sql`SELECT id, total_paise FROM invoices WHERE booking_id = ${jobId} AND deleted_at IS NULL`;
  const lateOrder = "order_LATE" + Math.random().toString(36).slice(2, 12);
  const [late] = inv ? await sql`
    INSERT INTO payments (invoice_id, method, amount_paise, status, provider_ref)
    VALUES (${inv.id}, 'upi', ${inv.total_paise}, 'PENDING', ${lateOrder}) RETURNING id` : [];
  try {
    const hookBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {
      id: "pay_LATE0000000001", order_id: lateOrder, amount: Number(inv?.total_paise) } } } });
    const hook = await fetch(BASE + "/v1/webhooks/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json",
                 "x-razorpay-signature": createHmac("sha256", RZP_HOOK_SECRET).update(hookBody).digest("hex") },
      body: hookBody,
    });
    const hookJson = await hook.json().catch(() => ({}));
    ok("a capture for an already-settled invoice answers 2xx, so the gateway stops retrying",
       hook.status === 200 && hookJson.data?.refundRequired === true, `got ${hook.status} ${hookJson.error?.code ?? ""}`);
    const [row] = late ? await sql`SELECT status FROM payments WHERE id = ${late.id}` : [];
    ok("and the capture is kept PENDING for reconciliation, not a second settlement", row?.status === "PENDING", row?.status);
  } finally {
    if (late) await sql`DELETE FROM payments WHERE id = ${late.id}`;
  }
}

// ── audit chain: does it actually catch an edit? ──
// Asserting that a fresh chain verifies proves almost nothing — an unverifiable
// scheme would pass that too. The property worth testing is detection, so this
// reaches past the API and edits a row directly in Postgres, the way an
// administrator with database access would.
await api1("PUT", "/v1/me/medical", { token: payToken, body: { bloodGroup: "B+" } });

await api1("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } });
const adminVer = await api1("POST", "/v1/auth/otp/verify", {
  body: { msisdn: "+919999900001", code: otpFromSms() },
});
const adminTok = adminVer.data?.accessToken;

const clean = await api1("GET", "/v1/admin/audit?limit=5", { token: adminTok });
ok("the audit chain verifies before tampering", clean.meta?.integrity?.ok === true,
   `checked ${clean.meta?.integrity?.checked}`);

// Layer one: the table is append-only in the database itself. The migration
// installs DO INSTEAD NOTHING rules, so an UPDATE or DELETE is not refused with
// an error — it silently changes nothing, which is what an attacker with an
// ordinary connection would discover the hard way.
const target = clean.data?.find((r) => r.action === "medical.updated") ?? clean.data?.[0];
const [before] = await sql`SELECT action FROM audit_log WHERE id = ${target.id}`;
await sql`UPDATE audit_log SET action = 'medical.nothing_to_see_here' WHERE id = ${target.id}`;
const [afterUpdate] = await sql`SELECT action FROM audit_log WHERE id = ${target.id}`;
ok("the database refuses to let history be edited at all",
   afterUpdate.action === before.action, `still ${afterUpdate.action}`);

const countBefore = Number((await sql`SELECT count(*)::int AS n FROM audit_log`)[0].n);
await sql`DELETE FROM audit_log WHERE id = ${target.id}`;
const countAfter = Number((await sql`SELECT count(*)::int AS n FROM audit_log`)[0].n);
ok("and refuses to let history be deleted", countAfter === countBefore, `${countAfter} rows`);

// Layer two: INSERT is the one mutation those rules allow, because an
// append-only log has to accept appends. So that is the gap the hash chain has
// to cover — a forged entry spliced in does not link to what came before it.
const FORGED_ID = "00000000-0000-4000-8000-0000feedface";
try {
  await sql`
    INSERT INTO audit_log (id, actor_role, action, entity, prev_hash, hash, created_at, updated_at)
    VALUES (${FORGED_ID}, 'admin', 'audit.forged_entry', 'test',
            repeat('a', 64), repeat('b', 64), now(), now())`;

  const spliced = await api1("GET", "/v1/admin/audit?limit=5", { token: adminTok });
  ok("an entry forged into the log is caught by the chain",
     spliced.meta?.integrity?.ok === false, spliced.meta?.integrity?.reason ?? "NOT DETECTED");
  ok("and is reported as a broken link rather than bad content",
     /link/i.test(spliced.meta?.integrity?.reason ?? ""), spliced.meta?.integrity?.reason ?? "");
} finally {
  // Undoing this needs the delete rule out of the way — the same privilege an
  // attacker would need, which is rather the point. Restored in the same breath,
  // so a failure above cannot leave the log writable or the chain broken.
  //
  // One batch of unprepared statements, not three tagged templates: a
  // parameterised `DELETE ... WHERE id = $1` was already prepared further up
  // while the rule was live, and Postgres reuses that cached plan — with the
  // rule's DO INSTEAD NOTHING rewritten into it — so the delete would silently
  // do nothing here. The id is a constant defined above, not input.
  await sql.unsafe(`
    DROP RULE IF EXISTS audit_log_no_delete ON audit_log;
    DELETE FROM audit_log WHERE id = '${FORGED_ID}';
    CREATE OR REPLACE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
  `);
}

const healed = await api1("GET", "/v1/admin/audit?limit=5", { token: adminTok });
ok("removing the forgery makes the chain verify again",
   healed.meta?.integrity?.ok === true, healed.meta?.integrity?.reason ?? "");
const [ruleCheck] = await sql`
  SELECT count(*)::int AS n FROM pg_rules
   WHERE tablename = 'audit_log' AND rulename IN ('audit_log_no_update', 'audit_log_no_delete')`;
ok("the append-only rules are back in place after the test", ruleCheck.n === 2, `${ruleCheck.n}/2 rules`);

// ── the app's SOS confirm honours STOP too ──
// The STOP reply promises no emergency alerts either, so it must hold for an
// SOS raised in the app, not only for one raised by SMS.
await clearOtpAttempts();   // this instance allows 3 OTPs per IP; the sign-ins below need more
const signIn = async (msisdn) => {
  await api1("POST", "/v1/auth/otp/request", { body: { msisdn } });
  const v = await api1("POST", "/v1/auth/otp/verify", { body: { msisdn, code: otpFromSms() } });
  return v.data?.accessToken;
};
{
  const ownerTok = await signIn(smsOwner);
  await signedSms(contactA, "STOP");
  const raisedSos = await api1("POST", "/v1/sos", { token: ownerTok, body: { lat: 28.4595, lng: 77.0266 } });
  mark = twilioSent.length;
  const confirmed = await api1("POST", `/v1/sos/${raisedSos.data?.id}/confirm`, { token: ownerTok });
  ok("an app SOS confirm does not text a contact who replied STOP",
     confirmed.status === 200 && textedSince(mark, contactA).length === 0 && textedSince(mark, contactB).length === 1,
     `status=${confirmed.status} A=${textedSince(mark, contactA).length} B=${textedSince(mark, contactB).length}`);
  ok("and tells the person in trouble that one contact was not alerted, and why",
     confirmed.data?.contactsAlerted === 1 && confirmed.data?.contactsOptedOut === 1 &&
     /STOP/.test(confirmed.meta?.optedOut ?? ""),
     `alerted=${confirmed.data?.contactsAlerted} optedOut=${confirmed.data?.contactsOptedOut}`);
}

// ── cancelling a booking closes its offers, and the mechanic is told ──
// Cancel left every SENT offer live: the job sat in each mechanic's inbox and
// Accept answered 409. Customer and admin cancels both go through transition.
{
  const dispatchFresh = async () => {
    const b = await api1("POST", "/v1/bookings", {
      token: payToken,
      body: { vehicleId: vehicle.data?.id, serviceTypeCode: "flat_tyre", lat: 28.4595, lng: 77.0266 },
    });
    const d = await api1("POST", `/v1/bookings/${b.data?.id}/dispatch`, { token: payToken, body: { radiusKm: 40, limit: 5 } });
    return { id: b.data?.id, offers: d.data?.offers ?? [] };
  };
  const liveOffers = async (bookingId) =>
    (await sql`SELECT count(*)::int AS n FROM dispatch_offers WHERE booking_id = ${bookingId} AND status = 'SENT'`)[0].n;

  const job2 = await dispatchFresh();
  const firstOffer = job2.offers[0];
  const [mechUser] = firstOffer ? await sql`
    SELECT u.msisdn FROM mechanics m JOIN users u ON u.id = m.user_id WHERE m.id = ${firstOffer.mechanicId}` : [];
  const mechTok = mechUser ? await signIn(mechUser.msisdn) : null;

  // The mechanic's live stream, opened before the cancel.
  const abort = new AbortController();
  let streamText = "";
  const streamSeen = (async () => {
    try {
      const s = await fetch(BASE + "/v1/events", { headers: { authorization: `Bearer ${mechTok}` }, signal: abort.signal });
      const reader = s.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        streamText += dec.decode(value, { stream: true });
        if (streamText.includes(job2.id) && streamText.includes("CANCELLED")) break;
      }
    } catch { /* aborted */ }
  })();
  await new Promise((r) => setTimeout(r, 300));   // let the stream subscribe

  const beforeCancel = await liveOffers(job2.id);
  const cancelled = await api1("POST", `/v1/bookings/${job2.id}/transition`, { token: payToken, body: { command: "cancel" } });
  await Promise.race([streamSeen, new Promise((r) => setTimeout(r, 5000))]);
  abort.abort();
  ok("a customer cancel withdraws every live offer for the booking",
     cancelled.status === 200 && beforeCancel > 0 && (await liveOffers(job2.id)) === 0 &&
     cancelled.meta?.offersWithdrawn === beforeCancel,
     `live before=${beforeCancel} after=${await liveOffers(job2.id)} withdrawn=${cancelled.meta?.offersWithdrawn}`);
  const inbox = mechTok ? await api1("GET", "/v1/mechanic/offers", { token: mechTok }) : {};
  ok("the job leaves the mechanic's inbox", Array.isArray(inbox.data) && !inbox.data.some((o) => o.bookingId === job2.id),
     `${inbox.data?.length ?? "no"} offer(s) listed`);
  ok("and the mechanic's live stream is told, on the event the console refetches on",
     /event: booking\.status/.test(streamText) && streamText.includes(job2.id) && streamText.includes("WITHDRAWN"),
     streamText ? "" : "no event received");
  const lateAccept = firstOffer ? await api1("POST", `/v1/offers/${firstOffer.id}/accept`, { token: mechTok }) : {};
  ok("accepting the withdrawn offer says it is closed, not that the booking is illegal",
     lateAccept.status === 409 && lateAccept.error?.code === "offer_closed",
     `${lateAccept.status} ${lateAccept.error?.code ?? ""}`);

  const job3 = await dispatchFresh();
  const before3 = await liveOffers(job3.id);
  const adminCancel = await api1("POST", `/v1/bookings/${job3.id}/transition`, { token: adminTok, body: { command: "cancel" } });
  ok("an admin cancel withdraws them too",
     adminCancel.status === 200 && before3 > 0 && (await liveOffers(job3.id)) === 0,
     `${adminCancel.status} live before=${before3} after=${await liveOffers(job3.id)}`);
}

// ── per-IP OTP ceiling (cap 3 on this instance) ──
// The payment journey above signed in, which counts against the same ceiling —
// reset so this section starts from a deterministic zero.
await clearOtpAttempts();
const codes = [];
for (let i = 0; i < 4; i++) {
  const r = await fetch(BASE + "/v1/auth/otp/request", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ msisdn: "+91901234000" + i }),
  });
  codes.push(r.status);
}
ok("three OTP requests from one IP pass", codes[0] === 200 && codes[1] === 200 && codes[2] === 200,
   codes.slice(0, 3).join(","));
ok("fourth request from the same IP is throttled (429 otp_ip_limited)", codes[3] === 429, `got ${codes[3]}`);

// Put the limiter back. The ceiling is per IP over a 15-minute window, and in
// CI every suite runs from the same address against the same server: this test
// deliberately exhausts a bucket that the browser journey needs several minutes
// later to sign a mechanic in. Locally the suites are run one at a time with a
// reset in between, so the debt was never visible — and the browser suite had
// never once reached CI to collect it.
await clearOtpAttempts();
api.kill();

// ── a demo deployment with NO webhook secret ──
// The hosted demo is NODE_ENV=demo and never set TELECOM_WEBHOOK_SECRET, and
// the signature was checked only when a secret existed — so the demo accepted
// unsigned messages "from" any phone number in India. It must now refuse
// every number except the published demo ones, and its console SMS log must
// not print whole numbers.
const DEMO_PORT = Number(process.env.DEMO_API_PORT ?? API_PORT + 1);
const DEMO_BASE = `http://localhost:${DEMO_PORT}`;
const demoEnv = { ...process.env };
delete demoEnv.TELECOM_WEBHOOK_SECRET;
const demoApi = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: resolve(APP_DIR, "apps/api"),
  env: {
    ...demoEnv,
    NODE_ENV: "demo",
    PORT: String(DEMO_PORT),
    DATABASE_URL,
    // Present but empty, so an app/.env that sets one cannot leak in.
    TELECOM_WEBHOOK_SECRET: "",
    JWT_SECRET: "gw-demo-" + createHmac("sha256", String(Date.now())).update("jwt").digest("hex").slice(0, 32),
    SMS_PROVIDER: "console",
    PAYMENTS_PROVIDER: "mock",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let demoOut = "", demoErr = "";
demoApi.stdout.on("data", (d) => (demoOut += d));
demoApi.stderr.on("data", (d) => (demoErr += d));
let demoUp = false;
for (let i = 0; i < 180; i++) {   // up to 90 s: tsx compiles the API on boot, slow on a loaded machine
  try { if ((await fetch(DEMO_BASE + "/health")).ok) { demoUp = true; break; } } catch { /* booting */ }
  await new Promise((r) => setTimeout(r, 500));
}
ok("a NODE_ENV=demo instance with no webhook secret boots", demoUp, demoUp ? "" : demoErr.slice(0, 300));
if (demoUp) {
  const demoSms = (from, text) => fetch(DEMO_BASE + "/v1/telecom/sms", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, text }),
  });
  const stranger = await demoSms("+919123456789", "SOS");
  const strangerJson = await stranger.json().catch(() => ({}));
  ok("unsigned SMS from a real number is refused (503 webhook_not_configured)",
     stranger.status === 503 && strangerJson.error?.code === "webhook_not_configured",
     `${stranger.status} ${strangerJson.error?.code ?? ""}`);

  const demoNumber = await demoSms("+917000000042", "STATUS");
  const demoJson = await demoNumber.json().catch(() => ({}));
  ok("unsigned SMS from a demo number still works, and says it is unsigned",
     demoNumber.status === 200 && /UNSIGNED DEMO INTAKE/.test(demoJson.meta?.warning ?? ""),
     `${demoNumber.status}`);

  await new Promise((r) => setTimeout(r, 300));   // let the console line flush
  ok("the demo's console SMS log masks the number",
     demoOut.includes("[sms:console] → +91******0042") && !demoOut.includes("+917000000042"),
     demoOut.includes("[sms:console]") ? "" : "no console SMS line captured");
}
demoApi.kill();

await sql.end();
stub.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
