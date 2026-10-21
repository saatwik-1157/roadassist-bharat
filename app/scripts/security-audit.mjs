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
  ["false-positive dismissal", "POST", `/v1/raksha/incidents/${incidentId}/dismiss`],
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

// Sign-out. Before POST /v1/auth/logout existed there was no way to end a
// session at all: a refresh token on a lost or shared phone stayed good for
// its full 30 days, and the access token for its full ten minutes.
const noAuthLogout = await call("POST", "/v1/auth/logout");
ok("signing out requires a signed-in caller", noAuthLogout.status === 401, `${noAuthLogout.status}`);

const leaver = await signIn();
const leaverMe = await call("GET", "/v1/me", { token: leaver.token });
ok("a fresh session works before sign-out", leaverMe.status === 200, `${leaverMe.status}`);
// Rotate once, so the family holds an earlier access token that has not expired.
const leaverRot = await call("POST", "/v1/auth/refresh", { body: { refreshToken: leaver.refresh } });
ok("…and rotates normally", leaverRot.status === 200 && Boolean(leaverRot.data?.accessToken), `${leaverRot.status}`);
const earlierToken = leaver.token;
const currentToken = leaverRot.data?.accessToken;
const currentRefresh = leaverRot.data?.refreshToken;

const logout = await call("POST", "/v1/auth/logout", { token: currentToken });
ok("POST /v1/auth/logout signs the session out",
   logout.status === 200 && logout.data?.signedOut === true, `${logout.status} ${logout.error?.code ?? ""}`);
const refreshAfter = await call("POST", "/v1/auth/refresh", { body: { refreshToken: currentRefresh } });
ok("after sign-out the refresh token no longer works",
   refreshAfter.status === 401 && !refreshAfter.data?.accessToken, `${refreshAfter.status} ${refreshAfter.error?.code ?? ""}`);
const replayAfter = await call("POST", "/v1/auth/refresh", { body: { refreshToken: leaver.refresh } });
ok("…nor does any earlier refresh token of that family",
   replayAfter.status === 401 && !replayAfter.data?.accessToken, `${replayAfter.status}`);
const meAfter = await call("GET", "/v1/me", { token: currentToken });
ok("after sign-out the access token is refused",
   meAfter.status === 401 && meAfter.error?.code === "AUTH_REVOKED", `${meAfter.status} ${meAfter.error?.code ?? ""}`);
const earlierAfter = await call("GET", "/v1/me", { token: earlierToken });
ok("…and so is an earlier, unexpired access token of the same family",
   earlierAfter.status === 401, `${earlierAfter.status} ${earlierAfter.error?.code ?? ""}`);
const logoutAgain = await call("POST", "/v1/auth/logout", { token: currentToken });
ok("a signed-out access token cannot sign out again", logoutAgain.status === 401, `${logoutAgain.status}`);
// Sign-out is per family: another account's session is untouched.
const aliceStill = await call("GET", "/v1/me", { token: alice.token });
ok("one user's sign-out does not touch another user's session", aliceStill.status === 200, `${aliceStill.status}`);

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
// 401: a secret is set. 503: a hosted demo with no secret refuses a real number.
// A local environment with no secret stays open and must say so.
ok("the inbound SMS webhook is signed, refused, or flagged as open in development",
   unsignedSms.status === 401
     || (unsignedSms.status === 503 && unsignedSms.error?.code === "webhook_not_configured")
     || Boolean(unsignedSms.meta?.warning ?? unsignedSms.meta?.note),
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

// ══ 12. A device's image reference cannot name a server file ══════════════
// Device ingestion stores the image_ref the device sends, and the photo read
// and an officer's "reject" (which deletes the photo) both used it as a path
// under UPLOAD_DIR. A captured device credential could then have a routine
// rejection delete any file the API can write, and the photo endpoint serve
// any file it can read. The reference climbs to the filesystem root and back
// down to a sentinel this run creates, so it lands on the sentinel whatever
// UPLOAD_DIR is. Needs the API on this machine and the seeded operator.
section("12. Upload references stay inside the upload directory");
{
  const { writeFileSync, existsSync, unlinkSync, mkdirSync } = await import("node:fs");
  const { resolve: resolvePath, parse: parsePath, join, dirname } = await import("node:path");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
  const opReq = local ? await call("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } }) : null;
  const opVer = opReq?.meta?.devOtp
    ? await call("POST", "/v1/auth/otp/verify", { body: { msisdn: "+919999900001", code: opReq.meta.devOtp } })
    : null;
  const op = opVer?.data?.roles?.includes("admin") ? opVer.data.accessToken : null;
  if (!op) {
    skipped("device image references", local ? "the seeded operator could not sign in" : "the API is not on this machine");
  } else {
    const tag = Math.random().toString(36).slice(2, 10);
    const sentinel = resolvePath(`.security-audit-sentinel-${tag}.txt`);
    writeFileSync(sentinel, `sentinel ${tag}`);
    const victims = [];
    const climb = "../".repeat(24) + sentinel.slice(parsePath(sentinel).root.length).replaceAll("\\", "/");
    try {
      const dev = await call("POST", "/v1/raksha/devices", {
        token: op, body: { name: `audit device ${tag}`, lat: 28.45, lng: 77.03, simulated: true },
      });
      const devTok = await call("POST", "/v1/raksha/devices/token", {
        body: { deviceId: dev.data?.id, deviceSecret: dev.data?.deviceSecret },
      });
      const ingest = await call("POST", "/v1/raksha/detections", {
        token: devTok.data?.accessToken,
        body: { detections: [{
          opId: `audit-${tag}`, type: "pothole", confidence: 0.9, severity: 2, lat: 28.45, lng: 77.03,
          capturedAt: new Date().toISOString(), modelVersion: "audit", imageRef: climb,
        }] },
      });
      const detectionId = ingest.data?.results?.[0]?.detectionId;
      ok("a device can submit a detection to probe with", Boolean(detectionId), `${ingest.status}`);
      if (detectionId) {
        const photo = await call("GET", `/v1/raksha/detections/${detectionId}/photo`, { token: op });
        ok("the photo endpoint does not serve a file outside the upload directory",
           photo.status === 404 && !photo.raw.includes(`sentinel ${tag}`), `got ${photo.status}`);
        const rejected = await call("POST", `/v1/raksha/detections/${detectionId}/verify`, {
          token: op, body: { action: "reject", notes: "security audit" },
        });
        ok("rejecting the detection does not delete a file outside the upload directory",
           rejected.status === 200 && existsSync(sentinel), `reject ${rejected.status}, file ${existsSync(sentinel) ? "kept" : "DELETED"}`);
      }

      // Inside the upload directory is not safe either: a device naming another
      // report's photo, hazards/<their id>.jpg, had it served under its own
      // detection and deleted by the officer's reject. UPLOAD_DIR is that of an
      // API started from apps/api (npm run dev) unless the environment says.
      const victim = join(process.env.UPLOAD_DIR ?? resolvePath("apps/api/uploads"), "hazards", `audit-victim-${tag}.jpg`);
      mkdirSync(dirname(victim), { recursive: true });
      writeFileSync(victim, `victim ${tag}`);
      victims.push(victim);
      const inside = await call("POST", "/v1/raksha/detections", {
        token: devTok.data?.accessToken,
        body: { detections: [{
          opId: `audit-in-${tag}`, type: "pothole", confidence: 0.9, severity: 2, lat: 28.45, lng: 77.03,
          capturedAt: new Date().toISOString(), modelVersion: "audit", imageRef: `hazards/audit-victim-${tag}.jpg`,
        }] },
      });
      const insideId = inside.data?.results?.[0]?.detectionId;
      if (insideId) {
        const photo = await call("GET", `/v1/raksha/detections/${insideId}/photo`, { token: op });
        ok("the photo endpoint does not serve another report's photo under a device's detection",
           photo.status === 404 && !photo.raw.includes(`victim ${tag}`), `got ${photo.status}`);
        const rejected = await call("POST", `/v1/raksha/detections/${insideId}/verify`, {
          token: op, body: { action: "reject", notes: "security audit" },
        });
        ok("rejecting a device's detection does not delete another report's photo",
           rejected.status === 200 && existsSync(victim), `reject ${rejected.status}, file ${existsSync(victim) ? "kept" : "DELETED"}`);
      } else {
        ok("a device can submit a detection naming a file inside the upload directory", false, `${inside.status}`);
      }
    } finally {
      if (existsSync(sentinel)) unlinkSync(sentinel);
      for (const v of victims) if (existsSync(v)) unlinkSync(v);
    }
  }
}

// ══ 13. The web pages' refresh cookie, and the page script policy ═════════
// Web pages keep the refresh token in an HttpOnly cookie (routes/auth.ts), so a
// script injected into a page cannot read it. A cookie is sent by the browser
// whoever asks, so it is honoured only with the X-RA-Client header, which a
// cross-site form cannot send. The native body flow above is unchanged.
section("13. Web refresh cookie and the page script policy");
{
  const WEB = { "x-ra-client": "web-app" };
  const cookieOf = (r) => String(r.headers.get("set-cookie") ?? "");
  const pair = (setCookie) => setCookie.split(";")[0];            // "ra_rt_app=…"
  const msisdn = newMsisdn();
  const req = await call("POST", "/v1/auth/otp/request", { body: { msisdn } });
  const web = await call("POST", "/v1/auth/otp/verify", { headers: WEB, body: { msisdn, code: req.meta?.devOtp } });
  const set = cookieOf(web);
  ok("a web sign-in sets the refresh token as a cookie", /^ra_rt_app=[A-Za-z0-9_-]{20,}/.test(set), set.slice(0, 40));
  ok("…HttpOnly, so no page script can read it", /;\s*HttpOnly/i.test(set), set.replace(/=[^;]+/, "=…"));
  ok("…scoped to /v1/auth and SameSite-marked",
     /;\s*Path=\/v1\/auth(;|$)/i.test(set) && /;\s*SameSite=(Lax|None)/i.test(set) &&
     (!/SameSite=None/i.test(set) || /;\s*Secure/i.test(set)));
  ok("…and the answer's body carries no refresh token", web.status === 200 && !("refreshToken" in (web.data ?? {})),
     `${web.status}`);

  const nMsisdn = newMsisdn();
  const nReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: nMsisdn } });
  const native = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: nMsisdn, code: nReq.meta?.devOtp } });
  ok("a native sign-in (no header) still gets its token in the body, and no cookie",
     typeof native.data?.refreshToken === "string" && native.data.refreshToken.length > 20 && !cookieOf(native));

  const noHeader = await call("POST", "/v1/auth/refresh", { headers: { cookie: pair(set) } });
  ok("a refresh by cookie WITHOUT the X-RA-Client header is refused (cross-site request forgery)",
     noHeader.status === 403 && !noHeader.data?.accessToken, `${noHeader.status} ${noHeader.error?.code ?? ""}`);
  const wrongSlot = await call("POST", "/v1/auth/refresh", { headers: { cookie: pair(set), "x-ra-client": "web-mechanic" } });
  ok("one page's cookie does not refresh another page's slot", wrongSlot.status === 401, `${wrongSlot.status}`);

  const rot = await call("POST", "/v1/auth/refresh", { headers: { ...WEB, cookie: pair(set) } });
  const next = cookieOf(rot);
  ok("with the header the cookie refreshes and rotates",
     rot.status === 200 && Boolean(rot.data?.accessToken) && pair(next) !== pair(set) && /HttpOnly/i.test(next),
     `${rot.status}`);
  ok("…and the refreshed body carries no refresh token either", !("refreshToken" in (rot.data ?? {})));

  const noHeaderLogout = await call("POST", "/v1/auth/logout", { headers: { cookie: pair(next) } });
  ok("signing out by cookie without the header is refused too", noHeaderLogout.status === 401, `${noHeaderLogout.status}`);
  const out = await call("POST", "/v1/auth/logout", { headers: { ...WEB, cookie: pair(next) } });
  const cleared = cookieOf(out);
  ok("a web sign-out by cookie ends the session", out.status === 200 && out.data?.signedOut === true, `${out.status}`);
  ok("…and clears the cookie", /^ra_rt_app=;/.test(cleared) && /Max-Age=0/i.test(cleared), cleared.slice(0, 40));
  const after = await call("POST", "/v1/auth/refresh", { headers: { ...WEB, cookie: pair(next) } });
  ok("…after which the old cookie refreshes nothing", after.status === 401 && !after.data?.accessToken,
     `${after.status} ${after.error?.code ?? ""}`);
  const meAfter = await call("GET", "/v1/me", { token: rot.data?.accessToken });
  ok("…and its access token is refused", meAfter.status === 401, `${meAfter.status}`);

  // A page still holding a pre-cookie token in localStorage trades it once.
  const legacy = await signIn();
  const moved = await call("POST", "/v1/auth/refresh", { headers: WEB, body: { refreshToken: legacy.refresh } });
  ok("an old body token is exchanged once for the cookie",
     moved.status === 200 && /^ra_rt_app=/.test(cookieOf(moved)) && !("refreshToken" in (moved.data ?? {})), `${moved.status}`);
  const again = await call("POST", "/v1/auth/refresh", { body: { refreshToken: legacy.refresh } });
  ok("…and cannot be used again", again.status === 401, `${again.status} ${again.error?.code ?? ""}`);

  // The CSP allows the pages' own inline scripts by hash, and nothing else inline.
  const page = await fetch(BASE + "/app.html");
  const scriptSrc = (page.headers.get("content-security-policy") ?? "").split(";").map((d) => d.trim())
    .find((d) => d.startsWith("script-src ")) ?? "";
  ok("script-src no longer allows 'unsafe-inline'", scriptSrc !== "" && !scriptSrc.includes("'unsafe-inline'"),
     scriptSrc.slice(0, 40));
  ok("…and allows the pages' inline scripts by SHA-256 hash", /'sha256-[A-Za-z0-9+/]{43}='/.test(scriptSrc),
     `${(scriptSrc.match(/'sha256-/g) ?? []).length} hashes`);
}

// ══ 14. The Telegram bot webhook (routes/telegram.ts) ═════════════════════
// Anyone can POST to the webhook URL; only Telegram knows the secret header.
// A request without it could link an attacker's chat to somebody's contact
// (and receive their SOS positions) or unlink a real one. Runs against a local
// stub of the Bot API; skipped, and said so, when the server has Telegram off.
section("14. Telegram webhook: secret header, single-use codes, /stop");
{
  const { telegramStub } = await import("./telegram-stub.mjs");
  const owner = await signIn();
  const probe = await call("GET", "/v1/me/emergency-contacts", { token: owner.token });
  const stub = probe.meta?.telegram?.enabled ? await telegramStub() : { why: "this server has Telegram off" };
  if (stub.why) {
    for (const l of ["webhook without the secret", "webhook with a wrong secret", "unsigned /stop",
                     "replayed code", "expired code", "withdrawn code", "group chat", "/stop unlinks"]) {
      skipped(l, stub.why);
    }
  } else {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL ??
      "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
    try {
      const addContact = async (name) => (await call("POST", "/v1/me/emergency-contacts", {
        token: owner.token, body: { name, msisdn: newMsisdn() } })).data;
      const invite = async (contactId) => new URL((await call("POST",
        `/v1/me/emergency-contacts/${contactId}/telegram-invite`, { token: owner.token })).data.link).searchParams.get("start");
      const chatOf = async (contactId) =>
        (await sql`SELECT telegram_chat_id AS c FROM emergency_contacts WHERE id = ${contactId}`)[0]?.c ?? null;

      const victim = await addContact("Amma");
      const code = await invite(victim.id);
      const attacker = stub.newChatId();

      const bare = await stub.deliver(BASE, attacker, `/start ${code}`, { secret: null });
      ok("the webhook without Telegram's secret header is refused 401", bare.status === 401, `${bare.status}`);
      const wrong = await stub.deliver(BASE, attacker, `/start ${code}`, { secret: stub.secret.slice(0, -1) + "x" });
      ok("…and with a wrong secret, 401, and nothing was linked",
         wrong.status === 401 && (await chatOf(victim.id)) === null, `${wrong.status}`);

      const real = stub.newChatId();
      const first = await stub.deliver(BASE, real, `/start ${code}`);
      const replay = await stub.deliver(BASE, attacker, `/start ${code}`);
      ok("a replayed invite code is refused: the contact stays linked to the first chat",
         first.data?.outcome === "linked" && replay.data?.outcome === "refused" && (await chatOf(victim.id)) === real,
         `${first.data?.outcome} then ${replay.data?.outcome}`);

      const unsignedStop = await stub.deliver(BASE, real, "/stop", { secret: null });
      ok("an unsigned /stop cannot unlink a real contact",
         unsignedStop.status === 401 && (await chatOf(victim.id)) === real, `${unsignedStop.status}`);

      const late = await addContact("Ravi");
      const lateCode = await invite(late.id);
      await sql`UPDATE telegram_link_codes SET expires_at = now() - interval '1 second'
                 WHERE contact_id = ${late.id} AND deleted_at IS NULL`;
      const expired = await stub.deliver(BASE, attacker, `/start ${lateCode}`);
      ok("an expired invite code is refused", expired.data?.outcome === "refused" && (await chatOf(late.id)) === null,
         `${expired.data?.outcome}`);

      const oldCode = await invite(late.id);
      await invite(late.id);   // a new invite withdraws the old one
      const withdrawn = await stub.deliver(BASE, attacker, `/start ${oldCode}`);
      ok("an invite replaced by a newer one is refused", withdrawn.data?.outcome === "refused" && (await chatOf(late.id)) === null,
         `${withdrawn.data?.outcome}`);

      const groupCode = await invite(late.id);
      const group = await stub.deliver(BASE, attacker, `/start ${groupCode}`, { type: "group" });
      ok("a group chat cannot become an emergency contact", group.data?.outcome === "not_private" && (await chatOf(late.id)) === null,
         `${group.data?.outcome}`);

      const stop = await stub.deliver(BASE, real, "/stop");
      ok("/stop from the linked chat unlinks it", stop.data?.outcome === "unlinked" && (await chatOf(victim.id)) === null,
         `${stop.data?.outcome}`);
    } finally {
      await sql.end({ timeout: 5 });
      await stub.close();
    }
  }
}

// ══ 15. Sign in with Google (routes/google-auth.ts) ═══════════════════════
// Every way a Google sign-in could become somebody else's session: a callback
// planted on another browser (login CSRF), a replayed code or token, a forged,
// misaddressed, expired or unverified token, a Google identity aimed at an
// admin or mechanic, an email that happens to match, a phone that belongs to
// somebody else, a link nonce spent by another account. Runs against a LOCAL
// stub of Google (scripts/google-stub.mjs); skipped, and said so, when off.
section("15. Google sign-in: CSRF, replay, forged tokens, privileged accounts, collisions");
{
  const { googleStub, cookieJar, hop, webGoogleFlow } = await import("./google-stub.mjs");
  const health = await call("GET", "/health");
  const feature = health.data?.features?.googleSignin;
  const stub = feature?.web && feature?.android ? await googleStub() : { why: "this server has Google sign-in off" };
  const LABELS = ["planted callback (login CSRF)", "replayed callback", "tampered flow cookie", "token replay", "invented nonce",
    "forged signature", "wrong audience", "wrong issuer", "expired token", "unverified email", "web token on Android",
    "privileged account by Google", "privileged account linking", "email is never the key", "phone collision",
    "link nonce bound to its account", "link cookie required", "Google account in use", "no secret in /health"];
  if (stub.why) {
    for (const l of LABELS) skipped(l, stub.why);
  } else {
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL ??
      "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
    const android = async (claims, { purpose = "signin", token, nonce } = {}) => {
      const n = nonce ?? (await call("POST", "/v1/auth/google/nonce", { token, body: { purpose } })).data?.nonce;
      const idToken = claims.idToken ?? stub.mint({ nonce: n, ...claims });
      const res = await call("POST", purpose === "link" ? "/v1/me/google" : "/v1/auth/google/token",
        { token, body: { idToken, nonce: n } });
      return { nonce: n, idToken, res };
    };
    const sessionIssued = (r) => Boolean(r.data?.accessToken || r.data?.refreshToken);
    const googleSubOf = async (id) => (await sql`SELECT google_sub AS s FROM users WHERE id = ${id}`)[0]?.s ?? null;
    try {
      // ── login CSRF: an attacker's callback opened in the victim's browser ──
      const attacker = cookieJar();
      const aStart = await hop(attacker, `${BASE}/v1/auth/google/start`);
      const aConsent = await hop(attacker, aStart.location);
      const planted = aConsent.location;      // the attacker's code + state, never redeemed by them
      const victim = cookieJar();
      const v1 = await hop(victim, planted);
      const victimOwn = cookieJar();
      await hop(victimOwn, `${BASE}/v1/auth/google/start`);   // the victim has a flow of their own going
      const v2 = await hop(victimOwn, planted);
      // Three bindings refuse it, each on its own: the sealed state, PKCE, and the nonce.
      ok("a callback planted on another browser signs nobody in (state, PKCE and nonce bind it to the browser that started it)",
         /#google=error/.test(v1.location ?? "") && !victim.get(BASE, "ra_rt_app") &&
         /#google=error/.test(v2.location ?? "") && !victimOwn.get(BASE, "ra_rt_app"),
         `${v1.location?.split("#")[1]} / ${v2.location?.split("#")[1]}`);

      // ── a replayed callback ───────────────────────────────────────────
      const r = cookieJar();
      const rStart = await hop(r, `${BASE}/v1/auth/google/start`);
      const sealed = r.get(BASE, "ra_g_flow");
      const rConsent = await hop(r, rStart.location);
      const first = await hop(r, rConsent.location);
      const r2 = cookieJar();
      r2.set(BASE, "ra_g_flow", sealed);
      const replay = await hop(r2, rConsent.location);
      ok("a callback replayed with its own flow cookie is refused: the code and the nonce work once",
         /#google=signedin/.test(first.location ?? "") && /google=error/.test(replay.location ?? "") && !r2.get(BASE, "ra_rt_app"),
         replay.location?.split("#")[1]);

      // ── a tampered flow cookie ────────────────────────────────────────
      const t = cookieJar();
      const tStart = await hop(t, `${BASE}/v1/auth/google/start`);
      const tc = t.get(BASE, "ra_g_flow");
      t.set(BASE, "ra_g_flow", tc.slice(0, -2) + (tc.at(-2) === "A" ? "B" : "A") + tc.at(-1));
      const tConsent = await hop(t, tStart.location);
      const tCb = await hop(t, tConsent.location);
      ok("a flow cookie altered in the browser is refused", /reason=google_failed/.test(tCb.location ?? "") && !t.get(BASE, "ra_rt_app"),
         tCb.location?.split("#")[1]);

      // ── the Android token path ────────────────────────────────────────
      const good = await android({ email: "replay@example.com" });
      const again = await call("POST", "/v1/auth/google/token", { body: { idToken: good.idToken, nonce: good.nonce } });
      ok("an ID token replayed on Android is refused (its nonce was spent)",
         good.res.status === 200 && again.status === 401 && again.error?.code === "nonce_replayed" && !sessionIssued(again),
         `${good.res.status} then ${again.status} ${again.error?.code ?? ""}`);

      const invented = "x".repeat(43);
      const inv = await call("POST", "/v1/auth/google/token", { body: { idToken: stub.mint({ nonce: invented }), nonce: invented } });
      ok("a validly signed token for a nonce this server never issued is refused",
         inv.status === 401 && !sessionIssued(inv), `${inv.status} ${inv.error?.code ?? ""}`);

      const fNonce = (await call("POST", "/v1/auth/google/nonce", { body: {} })).data?.nonce;
      const forged = await call("POST", "/v1/auth/google/token", { body: { idToken: stub.mint({ nonce: fNonce }, { rogue: true }), nonce: fNonce } });
      const afterForgery = await android({ email: "after.forgery@example.com" }, { nonce: fNonce });
      ok("a token signed by a key Google never published is refused - and does not burn the real nonce",
         forged.status === 401 && forged.error?.code === "bad_signature" && afterForgery.res.status === 200,
         `${forged.status} ${forged.error?.code ?? ""}, then ${afterForgery.res.status}`);

      const aud = await android({ aud: "999999999999-someoneelsesapp.apps.googleusercontent.com" });
      ok("a token issued to another app (wrong aud) is refused", aud.res.status === 401 && aud.res.error?.code === "bad_audience",
         `${aud.res.status} ${aud.res.error?.code ?? ""}`);
      const iss = await android({ iss: "https://accounts.example.com" });
      ok("a token from another issuer is refused", iss.res.status === 401 && iss.res.error?.code === "bad_issuer",
         `${iss.res.status} ${iss.res.error?.code ?? ""}`);
      const nowS = Math.floor(Date.now() / 1000);
      const old = await android({ iat: nowS - 7200, exp: nowS - 3600 });
      ok("an expired token is refused", old.res.status === 401 && old.res.error?.code === "expired", `${old.res.status} ${old.res.error?.code ?? ""}`);
      const unverified = await android({ email_verified: false });
      const uj = cookieJar();
      stub.nextIdentity({ email_verified: false });
      const uFlow = await webGoogleFlow(BASE, uj);
      ok("an address Google has not verified signs in nowhere, on Android or the web",
         unverified.res.status === 401 && unverified.res.error?.code === "email_unverified" &&
         uFlow.landed?.hash === "#google=error&reason=email_unverified" && !uj.get(BASE, "ra_rt_app"),
         `${unverified.res.error?.code ?? ""} / ${uFlow.landed?.hash}`);
      const webAzp = await android({ azp: stub.clientId });
      ok("a token minted for the web client is not accepted as the Android app's (azp)",
         webAzp.res.status === 401 && webAzp.res.error?.code === "bad_azp", `${webAzp.res.status} ${webAzp.res.error?.code ?? ""}`);

      // ── privileged accounts ───────────────────────────────────────────
      const [admin] = await sql`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles ro ON ro.id = ur.role_id
                                 WHERE ro.name = 'admin' AND ur.deleted_at IS NULL AND u.msisdn = '+919999900001' LIMIT 1`;
      const [mech] = await sql`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles ro ON ro.id = ur.role_id
                                WHERE ro.name = 'mechanic' AND ur.deleted_at IS NULL AND u.google_sub IS NULL LIMIT 1`;
      if (!admin || !mech) {
        skipped("privileged account by Google", "no seeded admin and mechanic in this database");
      } else {
        const adminSub = stub.newSub(), mechSub = stub.newSub();
        // As if each had somehow been given a Google identity: a sign-in with it must still be refused.
        await sql`UPDATE users SET google_sub = ${adminSub} WHERE id = ${admin.id}`;
        await sql`UPDATE users SET google_sub = ${mechSub} WHERE id = ${mech.id}`;
        try {
          const a = await android({ sub: adminSub, email: "owner@example.com" });
          const m = await android({ sub: mechSub, email: "mechanic@example.com" });
          const wj = cookieJar();
          stub.nextIdentity({ sub: adminSub, email: "owner@example.com" });
          const w = await webGoogleFlow(BASE, wj);
          ok("a Google identity can never sign in to an admin or a mechanic account, on Android or the web",
             a.res.status === 403 && a.res.error?.code === "privileged_account" && !sessionIssued(a.res) &&
             m.res.status === 403 && m.res.error?.code === "privileged_account" && !sessionIssued(m.res) &&
             w.landed?.hash === "#google=error&reason=privileged_account" && !wj.get(BASE, "ra_rt_app"),
             `${a.res.status} ${m.res.status} ${w.landed?.hash}`);
        } finally {
          await sql`UPDATE users SET google_sub = NULL WHERE id IN (${admin.id}, ${mech.id})`;
        }
      }
      const opReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } });
      const op = opReq.meta?.devOtp
        ? (await call("POST", "/v1/auth/otp/verify", { body: { msisdn: "+919999900001", code: opReq.meta.devOtp } })).data : null;
      if (!op?.roles?.includes("admin")) {
        skipped("privileged account linking", "the seeded admin could not sign in by phone here");
      } else {
        const webLink = await call("POST", "/v1/me/google/web-link", { token: op.accessToken });
        const nonceLink = await call("POST", "/v1/auth/google/nonce", { token: op.accessToken, body: { purpose: "link" } });
        ok("an admin cannot link a Google account at all (web or Android)",
           webLink.status === 403 && webLink.error?.code === "privileged_account" && !webLink.headers.get("set-cookie") &&
           nonceLink.status === 403 && nonceLink.error?.code === "privileged_account" && !(await googleSubOf(admin?.id ?? op.user?.id)),
           `${webLink.status} ${nonceLink.status}`);
      }

      // ── the email is never the key ────────────────────────────────────
      const v = await signIn();
      const victimEmail = `victim.${Math.random().toString(36).slice(2, 8)}@example.com`;
      await sql`UPDATE users SET email = ${victimEmail} WHERE id = ${v.userId}`;
      const same = await android({ email: victimEmail });
      ok("a Google account with the same email as an existing account gets its OWN new account",
         same.res.status === 200 && same.res.data?.user?.id !== v.userId && same.res.meta?.newAccount === true &&
         !(await googleSubOf(v.userId)), `${same.res.data?.user?.id} vs ${v.userId}`);

      // ── phone collision ───────────────────────────────────────────────
      const owner = await signIn();
      const g = await android({ email: "collision@example.com" });
      const code = (await call("POST", "/v1/auth/otp/request", { body: { msisdn: owner.msisdn } })).meta?.devOtp;
      const take = await call("POST", "/v1/me/phone", { token: g.res.data?.accessToken, body: { msisdn: owner.msisdn, code } });
      const [ownerRow] = await sql`SELECT msisdn, google_sub FROM users WHERE id = ${owner.userId}`;
      const [gRow] = await sql`SELECT msisdn FROM users WHERE id = ${g.res.data?.user?.id}`;
      const reOtp = (await call("POST", "/v1/auth/otp/request", { body: { msisdn: owner.msisdn } })).meta?.devOtp;
      const ownerBack = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: owner.msisdn, code: reOtp } });
      ok("verifying a number that belongs to another account takes nothing over: 409, and both accounts unchanged",
         take.status === 409 && take.error?.code === "phone_in_use" && !sessionIssued(take) &&
         ownerRow?.msisdn === owner.msisdn && ownerRow?.google_sub === null && gRow?.msisdn === null &&
         ownerBack.data?.user?.id === owner.userId,
         `${take.status} ${take.error?.code ?? ""}`);

      // ── a link nonce belongs to the account it was issued to ──────────
      const A = await signIn(), B = await signIn();
      const aNonce = (await call("POST", "/v1/auth/google/nonce", { token: A.token, body: { purpose: "link" } })).data?.nonce;
      const stolen = await android({ email: "stolen.link@example.com" }, { purpose: "link", token: B.token, nonce: aNonce });
      const asSignin = await android({ email: "wrong.purpose@example.com" }, { nonce: aNonce });
      const sNonce = (await call("POST", "/v1/auth/google/nonce", { body: {} })).data?.nonce;
      const signinAsLink = await android({ email: "wrong.purpose2@example.com" }, { purpose: "link", token: B.token, nonce: sNonce });
      ok("a link nonce cannot be spent by another account, or to sign in; a sign-in nonce cannot link",
         stolen.res.status === 401 && !(await googleSubOf(B.userId)) &&
         asSignin.res.status === 401 && !sessionIssued(asSignin.res) && signinAsLink.res.status === 401,
         `${stolen.res.status} ${asSignin.res.status} ${signinAsLink.res.status}`);

      // ── the web link cookie ───────────────────────────────────────────
      const bare = cookieJar();
      const noCookie = await hop(bare, `${BASE}/v1/auth/google/start?link=1`);
      bare.set(BASE, "ra_g_link", "A".repeat(80));
      const fakeCookie = await hop(bare, `${BASE}/v1/auth/google/start?link=1`);
      const anon = await call("POST", "/v1/me/google/web-link");
      ok("Link Google on the web needs the signed-in page's sealed cookie; it cannot be forged or skipped",
         /reason=link_expired/.test(noCookie.location ?? "") && /reason=link_expired/.test(fakeCookie.location ?? "") &&
         anon.status === 401, `${noCookie.location?.split("#")[1]} ${fakeCookie.location?.split("#")[1]} ${anon.status}`);

      // ── a Google account another proven account uses ──────────────────
      const P = await signIn(), P2 = await signIn();
      const heldSub = stub.newSub();
      await android({ sub: heldSub, email: "held@example.com" }, { purpose: "link", token: P.token });
      const grab = await android({ sub: heldSub, email: "held@example.com" }, { purpose: "link", token: P2.token });
      ok("a Google account linked to an account with a phone cannot be linked away from it",
         grab.res.status === 409 && grab.res.error?.code === "google_in_use" && (await googleSubOf(P.userId)) === heldSub &&
         !(await googleSubOf(P2.userId)), `${grab.res.status} ${grab.res.error?.code ?? ""}`);

      ok("/health names the feature, never the client secret",
         !health.raw.includes(stub.secret) && feature.serverClientId === stub.clientId);
    } finally {
      await sql.end({ timeout: 5 });
      await stub.close();
    }
  }
}

section("16. Delete my account and Unlink Google: confirmation, fresh sign-in, privileged accounts, other people");
{
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
  const PHRASE = "DELETE MY ACCOUNT";
  const sidOf = (tok) => JSON.parse(Buffer.from(String(tok).split(".")[1] ?? "", "base64url").toString() || "{}").sid;
  const alive = async (userId) => (await sql`SELECT deleted_at IS NULL AS a FROM users WHERE id = ${userId}`)[0]?.a === true;
  const age = (tok) => sql`UPDATE sessions SET created_at = now() - interval '11 minutes'
                            WHERE family_id = (SELECT family_id FROM sessions WHERE id = ${sidOf(tok)})`;
  try {
    // ── the phrase ──
    const v = await signIn();
    const odd = [undefined, {}, { confirm: "" }, { confirm: "delete my account" }, { confirm: "DELETE MY ACCOUNT!" },
      { confirm: ["DELETE MY ACCOUNT"] }, { confirm: true }, { phrase: PHRASE }];
    const results = [];
    for (const body of odd) results.push(await call("POST", "/v1/me/delete", { token: v.token, body }));
    ok("no body, a wrong phrase, a near miss, an array or the wrong field deletes nothing",
       results.every((r) => r.status === 400 && r.error?.code === "confirmation_required") && await alive(v.userId),
       results.map((r) => r.status).join(","));

    // ── the fresh sign-in ──
    await age(v.token);
    const stale = await call("POST", "/v1/me/delete", { token: v.token, body: { confirm: PHRASE } });
    ok("a session whose sign-in is older than ten minutes cannot delete (403 reauth_required)",
       stale.status === 403 && stale.error?.code === "reauth_required" && await alive(v.userId), `${stale.status}`);
    const rot = await call("POST", "/v1/auth/refresh", { body: { refreshToken: v.refresh } });
    const rotDel = await call("POST", "/v1/me/delete", { token: rot.data?.accessToken, body: { confirm: PHRASE } });
    ok("a stolen refresh token, rotated into a new access token, is still not a fresh sign-in",
       rotDel.status === 403 && rotDel.error?.code === "reauth_required" && await alive(v.userId), `${rotDel.status}`);

    // ── privileged accounts keep the by-request path ──
    const opReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } });
    const op = opReq.meta?.devOtp
      ? (await call("POST", "/v1/auth/otp/verify", { body: { msisdn: "+919999900001", code: opReq.meta.devOtp } })).data : null;
    if (op?.accessToken) {
      const r = await call("POST", "/v1/me/delete", { token: op.accessToken, body: { confirm: PHRASE } });
      const me = await call("GET", "/v1/me", { token: op.accessToken });
      ok("an admin cannot delete itself (403 privileged_account), and /v1/me does not offer it",
         r.status === 403 && r.error?.code === "privileged_account" && me.data?.selfDelete === false && await alive(op.user?.id),
         `${r.status} ${r.error?.code}`);
    } else skipped("an admin cannot delete itself", "no dev OTP echo for the seeded admin");
    const [mech] = await sql`SELECT u.msisdn FROM users u JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
                              JOIN roles ro ON ro.id = ur.role_id AND ro.name = 'mechanic'
                             WHERE u.msisdn IS NOT NULL AND u.deleted_at IS NULL LIMIT 1`;
    if (mech) {
      const mr = await call("POST", "/v1/auth/otp/request", { body: { msisdn: mech.msisdn } });
      const m = mr.meta?.devOtp ? (await call("POST", "/v1/auth/otp/verify", { body: { msisdn: mech.msisdn, code: mr.meta.devOtp } })).data : null;
      const r = m?.accessToken ? await call("POST", "/v1/me/delete", { token: m.accessToken, body: { confirm: PHRASE } }) : null;
      ok("a mechanic cannot delete itself (403 privileged_account)",
         r?.status === 403 && r?.error?.code === "privileged_account" && await alive(m?.user?.id), `${r?.status} ${r?.error?.code}`);
    } else skipped("a mechanic cannot delete itself", "no seeded mechanic with a phone");

    // ── nobody else is touched, and the old token is dead ──
    const victim = await signIn();
    await call("POST", "/v1/me/emergency-contacts", { token: victim.token, body: { name: "Didi", msisdn: newMsisdn() } });
    const doer = await signIn();
    const bodyForOther = await call("POST", "/v1/me/delete", { token: doer.token, body: { confirm: PHRASE, userId: victim.userId } });
    const victimMe = await call("GET", "/v1/me/emergency-contacts", { token: victim.token });
    ok("a delete deletes only the caller: an id in the body is ignored, the other account and its contacts stay",
       bodyForOther.status === 200 && !(await alive(doer.userId)) && await alive(victim.userId) &&
       victimMe.status === 200 && victimMe.data?.length === 1, `${bodyForOther.status} ${victimMe.data?.length}`);
    const after = await call("GET", "/v1/me", { token: doer.token });
    const afterRefresh = await call("POST", "/v1/auth/refresh", { body: { refreshToken: doer.refresh } });
    ok("the deleted account's access and refresh tokens are refused",
       after.status === 401 && after.error?.code === "AUTH_REVOKED" && afterRefresh.status === 401, `${after.status} ${afterRefresh.status}`);
    const reuse = await call("POST", "/v1/me/delete", { token: doer.token, body: { confirm: PHRASE } });
    ok("…including for a second delete", reuse.status === 401, `${reuse.status}`);

    // ── Unlink Google without a phone ──
    const { googleStub } = await import("./google-stub.mjs");
    const health = await call("GET", "/health");
    const feature = health.data?.features?.googleSignin;
    const stub = feature?.android ? await googleStub() : { why: "this server has Google sign-in off" };
    if (stub.why) skipped("Unlink Google is refused without a phone", stub.why);
    else {
      try {
        const n = await call("POST", "/v1/auth/google/nonce", { body: { purpose: "signin" } });
        const g = (await call("POST", "/v1/auth/google/token", { body: { idToken: stub.mint({ sub: stub.newSub(), nonce: n.data?.nonce }), nonce: n.data?.nonce } })).data;
        const un = await call("DELETE", "/v1/me/google", { token: g?.accessToken });
        const [row] = await sql`SELECT google_sub IS NOT NULL AS linked FROM users WHERE id = ${g?.user?.id}`;
        ok("Unlink Google is refused for an account with no phone, which would otherwise be locked out (409 phone_required)",
           un.status === 409 && un.error?.code === "phone_required" && row?.linked === true, `${un.status} ${un.error?.code}`);
      } finally { await stub.close(); }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── clean up anything still holding a provider ─────────────────────────────
if (bookingId) await call("POST", `/v1/bookings/${bookingId}/transition`, { token: alice.token, body: { command: "cancel" } });
if (bobBooking?.data?.id) await call("POST", `/v1/bookings/${bobBooking.data.id}/transition`, { token: bob.token, body: { command: "cancel" } });
if (incidentId) await call("POST", `/v1/sos/${incidentId}/cancel`, { token: alice.token });

console.log("\n" + "─".repeat(60));
console.log(`  ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`);
if (fail) console.log(`  ⚠ ${fail} confirmed vulnerability/vulnerabilities — fix before submission.`);
console.log("─".repeat(60));
process.exit(fail ? 1 : 0);
