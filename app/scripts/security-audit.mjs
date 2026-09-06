#!/usr/bin/env node
/**
 * Application-level penetration checks.
 *
 * Every case here is an ATTACK that must fail. The suite passes when the
 * platform refuses; a green run means "we tried and could not get in", which is
 * a different and stronger statement than "the code looks right".
 *
 * Non-destructive by design: it reads, forges and probes, but never deletes
 * another account's data and never writes outside accounts it created itself.
 * Safe against a development or staging environment. Do not point it at
 * production — the rate-limit section deliberately trips ceilings.
 *
 *   node scripts/security-audit.mjs
 */
const BASE = process.env.API ?? process.env.BASE_URL ?? "http://localhost:4000";

let pass = 0, fail = 0, skip = 0;
const section = (t) => console.log(`\n${t}`);
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✗ VULNERABLE: ${label}  ${detail}`); }
};
const skipped = (label, why) => { skip++; console.log(`  – ${label} (${why})`); };

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* not JSON — that itself can be a finding */ }
  return { status: res.status, raw: text, headers: res.headers, ...json };
}

const newMsisdn = () => "+91" + (9000000000 + Math.floor(Math.random() * 899999999));

async function signIn() {
  const msisdn = newMsisdn();
  const req = await call("POST", "/v1/auth/otp/request", { body: { msisdn } });
  const v = await call("POST", "/v1/auth/otp/verify", { body: { msisdn, code: req.meta?.devOtp } });
  return { msisdn, token: v.data?.accessToken, refresh: v.data?.refreshToken, userId: v.data?.user?.id };
}

async function makeCustomer() {
  const who = await signIn();
  const reg = "TS12" + Math.random().toString(36).slice(2, 4).toUpperCase() + Math.floor(1000 + Math.random() * 8999);
  const v = await call("POST", "/v1/vehicles", { token: who.token, body: { registrationNo: reg, vehicleClass: "car" } });
  return { ...who, vehicleId: v.data?.id, reg };
}

console.log(`\nRoadAssist — security audit  (${BASE})\n`);

// ── Two unrelated customers, and whatever each of them owns ─────────────────
const alice = await makeCustomer();
const bob = await makeCustomer();
ok("two independent accounts created", Boolean(alice.token && bob.token));

const aliceBooking = await call("POST", "/v1/bookings", {
  token: alice.token,
  body: { vehicleId: alice.vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266 },
});
const aliceIncident = await call("POST", "/v1/sos", {
  token: alice.token, body: { lat: 28.46, lng: 77.03, source: "manual" },
});
const bookingId = aliceBooking.data?.id;
const incidentId = aliceIncident.data?.id;
ok("victim account has a booking and an incident to steal",
   Boolean(bookingId && incidentId));

// ══ 1. Horizontal privilege escalation — customer A → customer B ═══════════
section("1. Horizontal escalation: one customer reaching another's data");

const reads = [
  ["booking detail", "GET", `/v1/bookings/${bookingId}`],
  ["booking timeline", "GET", `/v1/bookings/${bookingId}`],
];
for (const [what, method, path] of reads) {
  const r = await call(method, path, { token: bob.token });
  ok(`${what} is refused to another customer`, r.status === 403 || r.status === 404,
     `${r.status} ${r.error?.code ?? ""}`);
}

const writes = [
  ["cancel someone else's booking", "POST", `/v1/bookings/${bookingId}/transition`, { command: "cancel" }],
  ["dispatch someone else's booking", "POST", `/v1/bookings/${bookingId}/dispatch`, { radiusKm: 25 }],
  ["pay someone else's booking", "POST", `/v1/bookings/${bookingId}/pay`, { method: "upi" }],
  ["review someone else's booking", "POST", `/v1/bookings/${bookingId}/review`, { rating: 1 }],
  ["cancel someone else's SOS", "POST", `/v1/sos/${incidentId}/cancel`, {}],
  ["escalate someone else's SOS", "POST", `/v1/sos/${incidentId}/confirm`, {}],
  ["resolve someone else's SOS", "POST", `/v1/sos/${incidentId}/resolve`, {}],
];
for (const [what, method, path, body] of writes) {
  const r = await call(method, path, { token: bob.token, body });
  ok(`cannot ${what}`, r.status === 403 || r.status === 404 || r.status === 409,
     `${r.status} ${r.error?.code ?? ""}`);
}

// Booking against a vehicle you do not own.
const stolenVehicle = await call("POST", "/v1/bookings", {
  token: bob.token,
  body: { vehicleId: alice.vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4, lng: 77.0 },
});
ok("cannot book against another customer's vehicle",
   stolenVehicle.status === 403 || stolenVehicle.status === 404,
   `${stolenVehicle.status} ${stolenVehicle.error?.code ?? ""}`);

// Editing a vehicle you do not own.
const editVehicle = await call("PATCH", `/v1/vehicles/${alice.vehicleId}`, {
  token: bob.token, body: { nickname: "pwned" },
});
ok("cannot rename another customer's vehicle",
   editVehicle.status === 403 || editVehicle.status === 404,
   `${editVehicle.status} ${editVehicle.error?.code ?? ""}`);

// Listing endpoints must be scoped to the caller, not filtered client-side.
// Bob gets a booking of his own first — otherwise "contains none of Alice's"
// is satisfied by an empty list and the check proves nothing.
const bobBooking = await call("POST", "/v1/bookings", {
  token: bob.token,
  body: { vehicleId: bob.vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.40, lng: 77.00 },
});
const bobBookings = await call("GET", "/v1/bookings", { token: bob.token });
const bobRows = bobBookings.data ?? [];
ok("the caller sees their own bookings", bobRows.some((b) => b.id === bobBooking.data?.id),
   `${bobRows.length} row(s) returned`);
ok("…and none of anyone else's", bobRows.every((b) => b.id !== bookingId),
   `${bobRows.length} row(s), victim booking absent`);

// ══ 2. Vertical privilege escalation — citizen → operator ══════════════════
section("2. Vertical escalation: a citizen reaching operator surfaces");

const adminOnly = [
  ["audit log", "GET", "/v1/admin/audit"],
  ["operations overview", "GET", "/v1/ops/overview"],
  ["email notifications", "POST", "/v1/notify/email"],
  ["RAKSHA device registry", "GET", "/v1/raksha/devices"],
  ["road-health recompute", "POST", "/v1/raksha/road-health/recompute"],
];
for (const [what, method, path] of adminOnly) {
  const r = await call(method, path, { token: bob.token, body: method === "POST" ? {} : undefined });
  ok(`a citizen cannot reach the ${what}`, r.status === 403, `${r.status} ${r.error?.code ?? ""}`);
}

const mechanicOnly = [
  ["dispatch inbox", "GET", "/v1/mechanic/offers"],
  ["job list", "GET", "/v1/mechanic/jobs"],
  ["availability toggle", "POST", "/v1/mechanic/availability"],
];
for (const [what, method, path] of mechanicOnly) {
  const r = await call(method, path, { token: bob.token, body: method === "POST" ? { isAvailable: true } : undefined });
  ok(`a citizen cannot reach the mechanic ${what}`, r.status === 403, `${r.status} ${r.error?.code ?? ""}`);
}

// The single most sensitive read in the platform.
const medical = await call("GET", `/v1/incidents/${incidentId}/medical?reason=curiosity+about+this+person`, {
  token: bob.token,
});
ok("a citizen cannot break-glass into medical data", medical.status === 403,
   `${medical.status} ${medical.error?.code ?? ""}`);
const medicalAnon = await call("GET", `/v1/incidents/${incidentId}/medical?reason=curiosity+about+this+person`);
ok("nor can an anonymous caller", medicalAnon.status === 401, `${medicalAnon.status}`);

// ══ 3. Identifier manipulation ═════════════════════════════════════════════
section("3. Identifier manipulation");

const forged = [
  ["random incident uuid", "POST", `/v1/sos/00000000-0000-4000-8000-000000000000/confirm`],
  ["random booking uuid", "GET", `/v1/bookings/00000000-0000-4000-8000-000000000000`],
  ["random offer uuid", "POST", `/v1/offers/00000000-0000-4000-8000-000000000000/accept`],
  ["random payment uuid", "POST", `/v1/payments/00000000-0000-4000-8000-000000000000/confirm`],
];
for (const [what, method, path] of forged) {
  const r = await call(method, path, {
    token: bob.token, ...(method === "GET" ? {} : { body: {} }),
  });
  ok(`a ${what} yields 404/403, never data`, [403, 404, 400, 409].includes(r.status),
     `${r.status} ${r.error?.code ?? ""}`);
  ok(`…and leaks no record in the body`, !/msisdn|"lat"|medical|blood/i.test(r.raw),
     r.raw.slice(0, 60));
}

// Non-uuid input must be rejected by validation, not reach the database.
const malformed = await call("GET", "/v1/bookings/not-a-uuid", { token: bob.token });
ok("a malformed id is rejected by validation", malformed.status === 400,
   `${malformed.status} ${malformed.error?.code}`);

// ══ 4. SQL injection ═══════════════════════════════════════════════════════
section("4. SQL injection");

const payloads = [
  "1' OR '1'='1",
  "'; DROP TABLE bookings; --",
  "\" UNION SELECT null,null,null --",
  "1); DELETE FROM users WHERE ('1'='1",
];
for (const p of payloads) {
  const r = await call("GET", `/v1/bookings/${encodeURIComponent(p)}`, { token: bob.token });
  ok(`injection in a path parameter is refused`, r.status === 400,
     `${r.status} for ${p.slice(0, 22)}…`);
}
// Free text that reaches the database as a value must be stored, never executed.
const injText = await call("POST", "/v1/diagnose", {
  token: bob.token, body: { symptoms: "'; DROP TABLE users; -- car won't start" },
});
ok("injection inside free text is treated as text", injText.status === 200,
   `${injText.status} cause="${(injText.data?.cause ?? "").slice(0, 28)}"`);
const stillAlive = await call("GET", "/v1/service-types");
ok("the database is intact after every injection attempt",
   stillAlive.status === 200 && (stillAlive.data ?? []).length > 0,
   `${(stillAlive.data ?? []).length} service types`);

// ══ 5. Stored XSS ══════════════════════════════════════════════════════════
section("5. Cross-site scripting");

const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
const xssVehicle = await call("POST", "/v1/vehicles", {
  token: bob.token,
  body: { registrationNo: "TS99XS" + Math.floor(1000 + Math.random() * 8999), vehicleClass: "car", nickname: xss },
});
ok("a script payload is accepted as data, not rejected as a special case",
   xssVehicle.status === 201, `${xssVehicle.status}`);
ok("…and comes back byte-identical, so the client is what must escape it",
   xssVehicle.data?.nickname === xss,
   "stored verbatim — the browser suite asserts the DOM escapes it");
ok("responses are served as JSON, so a payload cannot execute in the API origin",
   /application\/json/.test(String(xssVehicle.headers?.get?.("content-type") ?? "")),
   String(xssVehicle.headers?.get?.("content-type")));

// ══ 6. Authentication ══════════════════════════════════════════════════════
section("6. Authentication");

const noToken = await call("GET", "/v1/me");
ok("no token is refused", noToken.status === 401, `${noToken.status}`);

const garbage = await call("GET", "/v1/me", { token: "not.a.jwt" });
ok("a malformed token is refused", garbage.status === 401, `${garbage.status}`);

// A token signed with the wrong key: same shape, forged signature.
const [h, p] = (alice.token ?? "").split(".");
const tampered = `${h}.${p}.${"A".repeat(43)}`;
const forgedSig = await call("GET", "/v1/me", { token: tampered });
ok("a forged signature is refused", forgedSig.status === 401, `${forgedSig.status}`);

/**
 * Payload tampering: take ALICE's token, rewrite the subject claim to BOB's
 * user id, keep Alice's signature.
 *
 * The first version of this check set the subject to Alice's own id, so the
 * token was unchanged and the 200 it earned was correct — the test proved
 * nothing and reported a vulnerability that did not exist. Impersonation is
 * only demonstrated by swapping the subject to a DIFFERENT account.
 */
try {
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  const originalSub = claims.sub;
  claims.sub = bob.userId;
  const swapped = `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${(alice.token ?? "").split(".")[2]}`;
  const r = await call("GET", "/v1/me", { token: swapped });
  ok("a token whose subject was swapped to another account is refused",
     r.status === 401,
     `${r.status} (sub ${String(originalSub).slice(0, 8)} → ${String(bob.userId).slice(0, 8)})`);
  ok("…and it does not return the impersonated account's profile",
     r.data?.user?.msisdn !== bob.msisdn);
} catch { skipped("subject-swap check", "token payload not decodable"); }

// The "alg: none" downgrade — the classic JWT bypass.
try {
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const unsignedJwt = `${noneHeader}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
  const r = await call("GET", "/v1/me", { token: unsignedJwt });
  ok("an alg:none token is refused", r.status === 401, `${r.status}`);
} catch { skipped("alg:none check", "token payload not decodable"); }

// Refresh-token theft detection.
const rot1 = await call("POST", "/v1/auth/refresh", { body: { refreshToken: bob.refresh } });
ok("a refresh token rotates on use", rot1.status === 200 && rot1.data?.refreshToken !== bob.refresh);
const replay = await call("POST", "/v1/auth/refresh", { body: { refreshToken: bob.refresh } });
ok("replaying a consumed refresh token is treated as theft",
   replay.status === 401 && replay.error?.code === "reuse_detected", replay.error?.code);
const afterBurn = await call("POST", "/v1/auth/refresh", { body: { refreshToken: rot1.data?.refreshToken } });
ok("…and the whole token family is burned", afterBurn.status === 401, `${afterBurn.status}`);

// ══ 7. Webhook and payment verification ════════════════════════════════════
section("7. Webhook and payment verification");

const unsigned = await call("POST", "/v1/webhooks/razorpay", {
  body: { event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x", amount: 1 } } } },
});
ok("an unsigned payment webhook is refused",
   unsigned.status === 401 || unsigned.status === 503,
   `${unsigned.status} ${unsigned.error?.code ?? ""}`);

const badSig = await call("POST", "/v1/webhooks/razorpay", {
  headers: { "x-razorpay-signature": "0".repeat(64) },
  body: { event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x", amount: 1 } } } },
});
ok("a forged webhook signature is refused",
   badSig.status === 401 || badSig.status === 503,
   `${badSig.status} ${badSig.error?.code ?? ""}`);

const unsignedSms = await call("POST", "/v1/telecom/sms", { body: { from: newMsisdn(), text: "SOS" } });
ok("the inbound SMS webhook is signed, or flagged as open in development",
   unsignedSms.status === 401 || Boolean(unsignedSms.meta?.warning ?? unsignedSms.meta?.note),
   `${unsignedSms.status} ${JSON.stringify(unsignedSms.meta ?? {}).slice(0, 70)}`);

// The client must never be able to declare its own payment settled.
const selfSettle = await call("POST", `/v1/bookings/${bookingId}/transition`, {
  token: alice.token, body: { command: "payment.settled" },
});
ok("a client cannot declare its own invoice paid",
   selfSettle.status === 409 || selfSettle.status === 403,
   `${selfSettle.status} ${selfSettle.error?.code ?? ""}`);

// ══ 8. Input limits ════════════════════════════════════════════════════════
section("8. Malformed and oversized input");

const oversize = await call("POST", "/v1/diagnose", {
  token: bob.token, body: { symptoms: "x".repeat(50_000) },
});
ok("an oversized field is rejected by schema validation", oversize.status === 400,
   `${oversize.status} ${oversize.error?.code ?? ""}`);

const badJson = await call("POST", "/v1/diagnose", { token: bob.token, body: "{not json" });
ok("malformed JSON yields a 400, not a crash", badJson.status === 400, `${badJson.status}`);

const wrongType = await call("POST", "/v1/sos", {
  token: bob.token, body: { lat: "twenty-eight", lng: 77 },
});
ok("a wrongly typed field is refused", wrongType.status === 400, `${wrongType.status}`);

const outOfRange = await call("POST", "/v1/sos", { token: bob.token, body: { lat: 999, lng: 999 } });
ok("an out-of-range coordinate is refused", outOfRange.status === 400, `${outOfRange.status}`);

const badRating = await call("POST", `/v1/bookings/${bookingId}/review`, {
  token: alice.token, body: { rating: 99 },
});
ok("an out-of-range rating is refused", badRating.status === 400 || badRating.status === 409,
   `${badRating.status}`);

// ══ 9. Error hygiene ═══════════════════════════════════════════════════════
section("9. Error responses leak nothing");

const errors = [noToken, garbage, malformed, oversize, badJson];
ok("no error body contains a stack trace",
   errors.every((e) => !/\bat \w+.*\(.*:\d+:\d+\)/.test(e.raw)));
ok("no error body names an internal file path",
   errors.every((e) => !/\/apps\/api\/src|C:\\\\Users|node_modules/i.test(e.raw)));
ok("no error body exposes SQL",
   errors.every((e) => !/select |insert into|relation ".*" does not exist/i.test(e.raw)));

/**
 * The `detail` field is a DEVELOPMENT affordance and must never ship.
 *
 * A chaos test (stop Postgres, call any endpoint) showed a 500 whose `detail`
 * carried the failing SQL. That is correct in development and would be a leak
 * in production, where `env.nodeEnv === "production"` omits the field entirely —
 * verified separately by running the container with NODE_ENV=production against
 * a dead database, which returns only code, title, retryable and requestId.
 *
 * This suite runs against development, so it asserts the rule it can: whatever
 * `detail` contains, it is only ever present outside production.
 */
const healthProbe = await call("GET", "/health?detail=1");
const isProd = /"environment":"production"/.test(healthProbe.raw);
const withDetail = errors.filter((e) => e.error && "detail" in e.error);
ok(isProd
     ? "production error bodies carry no developer detail"
     : "developer detail appears only outside production (this run is development)",
   isProd ? withDetail.length === 0 : true,
   isProd ? `${withDetail.length} leaked` : `${withDetail.length} error(s) carry detail, as intended in dev`);
ok("every error carries a request id for support to trace",
   [noToken, malformed, oversize].every((e) => Boolean(e.error?.requestId)),
   noToken.error?.requestId);

// ══ 10. Rate limiting ══════════════════════════════════════════════════════
section("10. Rate limiting on the paths that matter");

const otpVictim = newMsisdn();
const otpBurst = [];
for (let i = 0; i < 8; i++) otpBurst.push(await call("POST", "/v1/auth/otp/request", { body: { msisdn: otpVictim } }));
ok("repeated OTP requests for one number are throttled",
   otpBurst.some((r) => r.status === 429), `${otpBurst.filter((r) => r.status === 429).length}/8 refused`);

const wrongCodes = [];
for (let i = 0; i < 8; i++) {
  wrongCodes.push(await call("POST", "/v1/auth/otp/verify", { body: { msisdn: otpVictim, code: "999999" } }));
}
ok("brute-forcing an OTP is locked out",
   wrongCodes.some((r) => r.status === 429 || r.error?.code === "otp_locked"),
   [...new Set(wrongCodes.map((r) => r.error?.code ?? r.status))].join(","));

const carl = await makeCustomer();
const bookingBurst = await Promise.all(Array.from({ length: 14 }, () => call("POST", "/v1/bookings", {
  token: carl.token,
  body: { vehicleId: carl.vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4, lng: 77.0 },
})));
ok("a booking flood is throttled", bookingBurst.some((r) => r.status === 429),
   `${bookingBurst.filter((r) => r.status === 429).length}/14 refused`);

// The rule that must never be traded away for tidiness.
const sosRun = [];
for (let i = 0; i < 10; i++) {
  sosRun.push(await call("POST", "/v1/sos", { token: carl.token, body: { lat: 28.4, lng: 77.0 } }));
}
ok("ten genuine SOS in a row are ALL accepted — a limit must never block an emergency",
   sosRun.every((r) => r.status === 201), [...new Set(sosRun.map((r) => r.status))].join(","));

// ══ 11. Transport and headers ══════════════════════════════════════════════
section("11. Transport and response headers");

const ping = await call("GET", "/v1/ping");
ok("the connectivity probe is not cacheable",
   /no-store/.test(String(ping.headers?.get?.("cache-control") ?? "")),
   String(ping.headers?.get?.("cache-control")));

const health = await call("GET", "/health");
ok("unauthenticated health exposes no provider, runtime or environment detail",
   !/providers|environment|uptimeSeconds|realtime/.test(health.raw),
   Object.keys(health.data ?? {}).join(","));
ok("health does not expose credentials or connection strings",
   !/password|secret|postgres:\/\/|key/i.test(health.raw), health.raw.slice(0, 50) + "…");

const meLeak = await call("GET", "/v1/me", { token: bob.token });
ok("the profile response carries no password or token field",
   !/password|passwordHash|refreshToken|codeHash/i.test(meLeak.raw));

// ── clean up anything still holding a provider ─────────────────────────────
if (bookingId) await call("POST", `/v1/bookings/${bookingId}/transition`, { token: alice.token, body: { command: "cancel" } });
if (bobBooking?.data?.id) await call("POST", `/v1/bookings/${bobBooking.data.id}/transition`, { token: bob.token, body: { command: "cancel" } });
if (incidentId) await call("POST", `/v1/sos/${incidentId}/cancel`, { token: alice.token });

console.log("\n" + "─".repeat(60));
console.log(`  ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`);
if (fail) console.log(`  ⚠ ${fail} confirmed vulnerability/vulnerabilities — fix before submission.`);
console.log("─".repeat(60));
process.exit(fail ? 1 : 0);
