#!/usr/bin/env node
/**
 * Gateway security suite: webhook signatures, per-IP OTP ceiling, and the
 * Twilio adapter's wire format — proven against a hardened API instance and a
 * stub vendor endpoint. Run from app/:  node scripts/gateway-security-test.mjs
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
await sql`DELETE FROM otp_challenges WHERE ip IS NOT NULL`;
await sql.end();

// 1. stub vendor endpoint — records exactly what the adapter sends
let lastTwilio = null;
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastTwilio = { url: req.url, auth: req.headers.authorization ?? "", ct: req.headers["content-type"] ?? "", body };
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
    SMS_API_KEY: "ACtest:authtok",
    SMS_SENDER_ID: "+15550000001",
    SMS_BASE_URL: `http://localhost:${STUB_PORT}`,
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
   Boolean(lastTwilio) && lastTwilio.url === "/2010-04-01/Accounts/ACtest/Messages.json",
   lastTwilio?.url ?? "no request captured");
ok("HTTP Basic auth = base64(SID:token)",
   lastTwilio?.auth === "Basic " + Buffer.from("ACtest:authtok").toString("base64"));
const form = new URLSearchParams(lastTwilio?.body ?? "");
ok("form-encoded From/To/Body present",
   (lastTwilio?.ct ?? "").includes("x-www-form-urlencoded") &&
   form.get("From") === "+15550000001" && form.get("To") === "+919812340001" && Boolean(form.get("Body")));

// ── per-IP OTP ceiling (cap 3 on this instance) ──
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

api.kill();
stub.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
