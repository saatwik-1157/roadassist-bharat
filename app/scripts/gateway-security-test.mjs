#!/usr/bin/env node
/**
 * Gateway security suite: webhook signatures, per-IP OTP ceiling, and the
 * Twilio and Razorpay adapters' wire formats — proven against a hardened API
 * instance and a stub vendor endpoint. Run from app/:
 *   node scripts/gateway-security-test.mjs
 *
 * Needs the database up (docker compose locally, the service container in CI).
 * Spawns its own API on API_PORT (default 4101) — the dev server on :4000 is
 * untouched.
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
let lastTwilio = null;
let lastRazorpay = null;
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
    lastTwilio = captured;
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
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let apiErr = "";
api.stderr.on("data", (d) => (apiErr += d));

let up = false;
for (let i = 0; i < 60; i++) {
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

await sql.end();
api.kill();
stub.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
