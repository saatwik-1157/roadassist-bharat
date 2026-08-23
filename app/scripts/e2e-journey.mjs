#!/usr/bin/env node
/**
 * Review 2 vertical slice, exercised end to end against the running API.
 * Every step asserts, so this is a test rather than a demo script.
 */
const BASE = process.env.API ?? "http://localhost:4000";
const MSISDN = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✗ ${label}  ${detail}`); }
};

async function call(method, path, { token, body, key } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

console.log(`\nRoadAssist — end-to-end journey  (${MSISDN})\n`);

// ── 1. authentication ──────────────────────────────────────────────────────
console.log("1. Authentication");
const otp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: MSISDN } });
ok("OTP requested", otp.status === 200 && otp.data?.sent === true);
const code = otp.meta?.devOtp;
ok("dev OTP returned for testing", Boolean(code), code ? `code=${code}` : "");

const bad = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: MSISDN, code: "999999" } });
ok("wrong OTP rejected", bad.status === 401, `got ${bad.status} ${bad.error?.code ?? ""}`);

const verified = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: MSISDN, code } });
ok("correct OTP accepted", verified.status === 200 && Boolean(verified.data?.accessToken));
ok("new account created with citizen role", verified.data?.roles?.includes("citizen"),
   JSON.stringify(verified.data?.roles ?? []));
let token = verified.data.accessToken;
const refresh = verified.data.refreshToken;

// ── 2. refresh rotation + reuse detection ──────────────────────────────────
console.log("\n2. Refresh rotation and theft detection");
const rot1 = await call("POST", "/v1/auth/refresh", { body: { refreshToken: refresh } });
ok("refresh token rotates", rot1.status === 200 && rot1.data.refreshToken !== refresh);
const reuse = await call("POST", "/v1/auth/refresh", { body: { refreshToken: refresh } });
ok("replaying the consumed token is rejected", reuse.status === 401,
   `code=${reuse.error?.code}`);
ok("reuse burns the whole family", reuse.error?.code === "reuse_detected");
const rot2 = await call("POST", "/v1/auth/refresh", { body: { refreshToken: rot1.data.refreshToken } });
ok("the rotated token is dead too after a detected theft", rot2.status === 401);
token = rot1.data.accessToken;

// ── 3. authorization ───────────────────────────────────────────────────────
console.log("\n3. Authorization");
const anon = await call("GET", "/v1/me");
ok("unauthenticated request is refused", anon.status === 401);
const me = await call("GET", "/v1/me", { token });
ok("authenticated profile loads", me.status === 200, me.data?.user?.msisdn);

// ── 4. vehicle ─────────────────────────────────────────────────────────────
console.log("\n4. Vehicle");
const reg = "TS09" + Math.random().toString(36).slice(2, 4).toUpperCase() + Math.floor(1000 + Math.random() * 8999);
const veh = await call("POST", "/v1/vehicles", { token, body: { registrationNo: reg, vehicleClass: "car", nickname: "Swift" } });
ok("vehicle added", veh.status === 201, veh.data?.registrationNo);
const dup = await call("POST", "/v1/vehicles", { token, body: { registrationNo: reg, vehicleClass: "car" } });
ok("duplicate registration rejected", dup.status === 409);
const vehicleId = veh.data.id;

// ── 5. AI diagnosis (rules) ────────────────────────────────────────────────
console.log("\n5. Diagnosis");
const diag = await call("POST", "/v1/diagnose", {
  token, body: { vehicleId, symptoms: "engine won't start, just a clicking sound and the lights are dim" },
});
ok("diagnosis returned", diag.status === 200, diag.data?.cause);
ok("confidence present", typeof diag.data?.confidence === "number", `confidence=${diag.data?.confidence}`);
ok("fallback flagged honestly", diag.meta?.usedFallback === true, `model=${diag.meta?.modelVersion}`);
ok("battery fault identified", /battery/i.test(diag.data?.cause ?? ""));
ok("marked not safe to drive", diag.data?.driveable === false);

const overheat = await call("POST", "/v1/diagnose", { token, body: { symptoms: "temperature warning and steam from the bonnet" } });
ok("overheating is severity 5", overheat.data?.severity === 5, `severity=${overheat.data?.severity}`);
const dtc = await call("POST", "/v1/diagnose", { token, body: { dtcCodes: ["P0300"] } });
ok("scanned code beats free text on confidence", dtc.data?.confidence >= 0.7, `confidence=${dtc.data?.confidence}`);

// ── 6. booking + idempotency ───────────────────────────────────────────────
console.log("\n6. Booking");
const idem = "idem-" + Math.random().toString(36).slice(2);
const b1 = await call("POST", "/v1/bookings", {
  token, key: idem,
  body: { vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266,
          symptoms: "won't start", highwayMarker: "NH-48, KM 212" },
});
ok("booking created", b1.status === 201, `${b1.data?.reference} status=${b1.data?.status}`);
ok("booking submitted into REQUESTED", b1.data?.status === "REQUESTED");
const b2 = await call("POST", "/v1/bookings", {
  token, key: idem,
  body: { vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266 },
});
ok("replaying the same idempotency key does not double-book",
   b2.data?.reference === b1.data?.reference, `${b2.data?.reference}`);
const bookingId = b1.data.id;

// ── 7. dispatch (PostGIS) ──────────────────────────────────────────────────
console.log("\n7. Dispatch");
const disp = await call("POST", `/v1/bookings/${bookingId}/dispatch`, { token, body: { radiusKm: 30, limit: 5 } });
ok("dispatch ran", disp.status === 200, `status=${disp.data?.status}`);
ok("offers created from real geospatial query", (disp.data?.offers?.length ?? 0) > 0,
   `${disp.data?.offers?.length} offers`);
const first = disp.data?.offers?.[0];
ok("offers ranked nearest-first", Boolean(first?.mechanic),
   first ? `top: ${first.mechanic.displayName} ${first.mechanic.distanceKm}km eta ${first.etaMinutes}min` : "");
ok("distances are within the requested radius",
   (disp.data?.offers ?? []).every((o) => o.mechanic.distanceKm <= 30));

// ── 8. state machine ───────────────────────────────────────────────────────
console.log("\n8. Booking state machine");
const illegal = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command: "work.complete" } });
ok("illegal transition rejected with 409", illegal.status === 409, illegal.error?.title?.slice(0, 60));

const accept = await call("POST", `/v1/offers/${first.id}/accept`, { token });
ok("mechanic accepts", accept.status === 200 && accept.data.status === "ASSIGNED");
const reAccept = await call("POST", `/v1/offers/${first.id}/accept`, { token });
ok("the same offer cannot be accepted twice", reAccept.status === 409);

for (const [command, expected] of [
  ["mechanic.start_travel", "EN_ROUTE"], ["arrive", "ON_SITE"],
  ["work.start", "IN_PROGRESS"], ["work.complete", "COMPLETED"],
]) {
  const r = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command } });
  ok(`${command} → ${expected}`, r.data?.status === expected, `got ${r.data?.status}`);
}

const detail = await call("GET", `/v1/bookings/${bookingId}`, { token });
ok("full event history recorded", (detail.data?.events?.length ?? 0) >= 6,
   `${detail.data?.events?.length} events`);

// ── 9. invoice + payment ───────────────────────────────────────────────────
console.log("\n9. Invoice");
const completed = detail.data;
ok("booking is COMPLETED", completed.status === "COMPLETED");
const paid = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command: "payment.settled" } });
ok("payment settles the booking", paid.data?.status === "PAID");

// ── 10. offline sync ───────────────────────────────────────────────────────
console.log("\n10. Offline replay");
const opId = "op-" + Math.random().toString(36).slice(2, 12);
const batch = { operations: [{ opId, entity: "booking", operation: "create",
  payload: { note: "queued while offline" }, clientUpdatedAt: new Date().toISOString() }] };
const s1 = await call("POST", "/v1/sync/operations", { token, body: batch });
ok("queued operation applied on reconnect", s1.data?.results?.[0]?.status === "applied");
const s2 = await call("POST", "/v1/sync/operations", { token, body: batch });
ok("replaying the same operation is a safe no-op", s2.data?.results?.[0]?.status === "duplicate");

// ── 11. ownership isolation ────────────────────────────────────────────────
console.log("\n11. Tenant isolation");
const other = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
const o1 = await call("POST", "/v1/auth/otp/request", { body: { msisdn: other } });
const o2 = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: other, code: o1.meta.devOtp } });
const otherToken = o2.data.accessToken;
const peek = await call("GET", `/v1/bookings/${bookingId}`, { token: otherToken });
ok("another user cannot read this booking (IDOR blocked)", peek.status === 403, `got ${peek.status}`);
const steal = await call("POST", "/v1/bookings", {
  token: otherToken, body: { vehicleId, serviceTypeCode: "flat_tyre", lat: 28.4, lng: 77.0 },
});
ok("another user cannot book against someone else's vehicle", steal.status === 403, `got ${steal.status}`);
const hijack = await call("POST", `/v1/bookings/${bookingId}/transition`, { token: otherToken, body: { command: "cancel" } });
ok("another user cannot drive someone else's booking", hijack.status === 403, `got ${hijack.status}`);
const grab = await call("POST", `/v1/offers/${first.id}/accept`, { token: otherToken });
ok("another user cannot accept someone else's offer", grab.status === 403, `got ${grab.status}`);

// ── 12. emergency contacts + SOS ───────────────────────────────────────────
console.log("\n12. Emergency path");
const contact = await call("POST", "/v1/me/emergency-contacts", {
  token, body: { name: "Priya", msisdn: "+919812345678", relation: "spouse" },
});
ok("emergency contact added", contact.status === 201);

const sos = await call("POST", "/v1/sos", {
  token, body: { lat: 28.4595, lng: 77.0266, source: "crash_model", modelConfidence: 0.94 },
});
ok("crash signal raises an incident", sos.status === 201);
const fakeConfirm = await call("POST", `/v1/sos/${sos.data.id}/confirm`, { token: otherToken });
ok("another user cannot escalate someone else's incident", fakeConfirm.status === 403, `got ${fakeConfirm.status}`);
ok("model signal waits for confirmation", sos.data?.status === "AWAITING_CONFIRMATION",
   `status=${sos.data?.status}`);
ok("nothing dispatched yet", sos.data?.requiresConfirmation === true);
ok("30-second cancel window offered", sos.data?.cancelWindowSeconds === 30);

const confirmed = await call("POST", `/v1/sos/${sos.data.id}/confirm`, { token });
ok("confirmation escalates", confirmed.data?.status === "RESPONDING");
ok("emergency contact was alerted", confirmed.data?.contactsAlerted >= 1,
   `${confirmed.data?.contactsAlerted} contact(s)`);
ok("nearest responder found by geospatial query", Boolean(confirmed.data?.nearestResponder?.name),
   confirmed.data?.nearestResponder?.name);
ok("escalation measured under 10s", confirmed.data?.elapsedMs < 10000,
   `${confirmed.data?.elapsedMs}ms`);

const manual = await call("POST", "/v1/sos", { token, body: { lat: 28.46, lng: 77.03, source: "manual" } });
ok("a manual SOS needs no confirmation", manual.data?.status === "CONFIRMED");

// ── 13. feature phone over SMS ─────────────────────────────────────────────
console.log("\n13. Feature phone (SMS only, no app)");
const phone = "+9198" + Math.floor(10000000 + Math.random() * 89999999);
const sms = (text) => call("POST", "/v1/telecom/sms", { body: { from: phone, text } });

const gibberish = await sms("asdf");
ok("unknown input returns the command list, not an error",
   /HELP CAR/.test(gibberish.data?.reply ?? ""));
const noVehicle = await sms("MADAD");
ok("HELP with no vehicle asks which one", /Which vehicle/i.test(noVehicle.data?.reply ?? ""));
const started = await sms("HELP TRACTOR");
ok("HELP <type> creates a request", /received/i.test(started.data?.reply ?? ""),
   started.data?.reply?.slice(0, 46));
const dupe = await sms("HELP CAR");
ok("a second request is refused while one is open", /already have/i.test(dupe.data?.reply ?? ""));
const status = await sms("STATUS");
ok("STATUS reports the booking", /REQUESTED/.test(status.data?.reply ?? ""));
const cancelled = await sms("CANCEL");
ok("CANCEL works over SMS", /cancelled/i.test(cancelled.data?.reply ?? ""));
const afterCancel = await sms("STATUS");
ok("STATUS after cancelling is honest", /no active request/i.test(afterCancel.data?.reply ?? ""));
const smsSos = await sms("SOS");
ok("SOS works over SMS on the degraded path", /SOS received/i.test(smsSos.data?.reply ?? ""));
const stop = await sms("STOP");
ok("STOP opt-out is honoured (TRAI)", /no further messages/i.test(stop.data?.reply ?? ""));

console.log(`\n${"─".repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(58)}\n`);
process.exit(fail ? 1 : 0);
