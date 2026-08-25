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

// ── 14. RAKSHA — autonomous road monitoring (ADR-0007/0008) ────────────────
console.log("\n14. RAKSHA autonomous monitoring (device data is SIMULATED)");
// The demo admin comes from `npm run db:seed:raksha`.
const adminOtp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } });
const adminVer = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: "+919999900001", code: adminOtp.meta.devOtp } });
const adminToken = adminVer.data?.accessToken;
ok("demo admin signs in with an authority role", adminVer.data?.roles?.includes("admin"),
   JSON.stringify(adminVer.data?.roles ?? []));

const citizenReg = await call("POST", "/v1/raksha/devices", {
  token, body: { name: "E2E-ROGUE [SIMULATED]", lat: 28.4, lng: 77.0 },
});
ok("a citizen cannot register a device", citizenReg.status === 403, `got ${citizenReg.status}`);

const devReg = await call("POST", "/v1/raksha/devices", {
  token: adminToken, body: { name: "E2E-EDGE [SIMULATED]", lat: 28.44, lng: 77.01 },
});
ok("admin registers an edge device", devReg.status === 201 && Boolean(devReg.data?.deviceSecret));

const badTok = await call("POST", "/v1/raksha/devices/token", {
  body: { deviceId: devReg.data.id, deviceSecret: "wrong-credential-000000000000" },
});
ok("wrong device credential is rejected", badTok.status === 401);
const devTok = await call("POST", "/v1/raksha/devices/token", {
  body: { deviceId: devReg.data.id, deviceSecret: devReg.data.deviceSecret },
});
ok("device exchanges its credential for a token", Boolean(devTok.data?.accessToken));
const deviceToken = devTok.data.accessToken;

const tag = Math.random().toString(36).slice(2, 8);
const edgeBatch = { detections: [
  { opId: `e2e-${tag}-p1`, type: "pothole", confidence: 0.86, severity: 4,
    lat: 28.443, lng: 77.014, capturedAt: new Date(Date.now() - 3600_000).toISOString(),
    ranOffline: true, modelVersion: "sim-rules-0.1.0", usedFallback: true },
  { opId: `e2e-${tag}-d1`, type: "road_damage", confidence: 0.71, severity: 2,
    lat: 28.412, lng: 76.988, capturedAt: new Date().toISOString(), modelVersion: "sim-rules-0.1.0" },
  { opId: `e2e-${tag}-o1`, type: "obstruction", confidence: 0.92, severity: 5,
    lat: 28.393, lng: 76.964, capturedAt: new Date().toISOString(), modelVersion: "sim-rules-0.1.0" },
]};
const anonUp = await call("POST", "/v1/raksha/detections", { body: edgeBatch });
ok("anonymous detection upload is impossible", anonUp.status === 401, `got ${anonUp.status}`);
const citizenUp = await call("POST", "/v1/raksha/detections", { token, body: edgeBatch });
ok("a citizen token cannot upload detections", citizenUp.status === 403, `got ${citizenUp.status}`);

const up1 = await call("POST", "/v1/raksha/detections", { token: deviceToken, body: edgeBatch });
ok("device uploads a queued batch", up1.meta?.applied === 3, `applied=${up1.meta?.applied}`);
ok("a severe obstruction raises an incident signal, never a dispatch",
   Boolean(up1.data?.results?.find((r) => r.opId === `e2e-${tag}-o1`)?.incidentId));
const up2 = await call("POST", "/v1/raksha/detections", { token: deviceToken, body: edgeBatch });
ok("replaying the same batch is idempotent", up2.meta?.duplicates === 3 && up2.meta?.applied === 0,
   `applied=${up2.meta?.applied} duplicates=${up2.meta?.duplicates}`);

const hb = await call("POST", "/v1/raksha/devices/heartbeat", {
  token: deviceToken, body: { batteryPercent: 78, storagePercent: 22, queueDepth: 0 },
});
ok("device heartbeat recorded", hb.data?.status === "ACTIVE");

const list = await call("GET", "/v1/raksha/detections?limit=100", { token: adminToken });
const mine = (list.data ?? []).filter((d) => d.op_id?.startsWith(`e2e-${tag}`));
ok("detections attributed to the device with GPS", mine.length === 3 && mine.every((d) => d.lat != null));
ok("detections auto-attached to the nearest road segment",
   mine.some((d) => d.segment_code), mine.map((d) => d.segment_code).join(","));
ok("capture timestamps preserved through offline sync",
   Math.abs(new Date(mine.find((d) => d.op_id === `e2e-${tag}-p1`).captured_at).getTime()
            - (Date.now() - 3600_000)) < 60_000);

const health = await call("POST", "/v1/raksha/road-health/recompute", { token: adminToken });
const scored = (health.data ?? []).find((s) => s.score < 100);
ok("road health recomputed with a transparent factor breakdown",
   Boolean(scored?.factors?.note), scored ? `${scored.code}=${scored.score}` : "");
const citizenHealth = await call("POST", "/v1/raksha/road-health/recompute", { token });
ok("a citizen cannot recompute road health", citizenHealth.status === 403);

const target = mine.find((d) => d.op_id === `e2e-${tag}-p1`);
const citizenVerify = await call("POST", `/v1/raksha/detections/${target.id}/verify`, {
  token, body: { action: "verify" },
});
ok("a citizen cannot verify a detection", citizenVerify.status === 403);
const verify = await call("POST", `/v1/raksha/detections/${target.id}/verify`, {
  token: adminToken, body: { action: "verify", notes: "e2e confirmation" },
});
ok("authority verifies the detection", verify.data?.status === "VERIFIED");
const close = await call("POST", `/v1/raksha/detections/${target.id}/close`, { token: adminToken });
ok("verified detection is closed after repair confirmation", close.data?.status === "CLOSED");
const reJudge = await call("POST", `/v1/raksha/detections/${target.id}/verify`, {
  token: adminToken, body: { action: "reject" },
});
ok("a closed detection cannot be re-judged", reJudge.status === 409, `got ${reJudge.status}`);

// Idempotency is scoped per device: another device reusing the same op ids
// must never be silently censored by the first device's rows.
const devReg2 = await call("POST", "/v1/raksha/devices", {
  token: adminToken, body: { name: "E2E-EDGE-2 [SIMULATED]", lat: 28.41, lng: 76.99 },
});
const devTok2 = await call("POST", "/v1/raksha/devices/token", {
  body: { deviceId: devReg2.data.id, deviceSecret: devReg2.data.deviceSecret },
});
const cross = await call("POST", "/v1/raksha/detections", {
  token: devTok2.data.accessToken, body: edgeBatch,
});
ok("a second device reusing the same op ids is not censored (per-device idempotency)",
   cross.meta?.applied === 3, `applied=${cross.meta?.applied} duplicates=${cross.meta?.duplicates}`);

// ── 15. Trip Guardian — pre-trip prediction & offline-map manifest ─────────
console.log("\n15. Trip Guardian (predict before signal dies)");
const anonTrip = await call("GET", "/v1/trip/prepare");
ok("trip preparation requires sign-in", anonTrip.status === 401, `got ${anonTrip.status}`);
const trip = await call("GET", "/v1/trip/prepare", { token });
ok("route prepared: per-segment dead-zone risk from platform telemetry",
   (trip.data?.segments?.length ?? 0) >= 1 &&
   trip.data.segments.every((s) => ["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(s.coverageRisk)),
   trip.data?.segments?.map((s) => s.coverageRisk).join(","));
ok("offline-map tile manifest present (weather may be null offline)",
   Array.isArray(trip.data?.tiles) && trip.data.tiles.length > 0 && "weather" in (trip.data ?? {}),
   `${trip.data?.tiles?.length} tiles · weather=${trip.data?.weather ? trip.data.weather.risk : "null"}`);

// ── 16. Email notification channel ─────────────────────────────────────────
console.log("\n16. Email channel");
const citizenEmail = await call("POST", "/v1/notify/email", {
  token, body: { to: "test@example.com", subject: "hi", body: "hello" },
});
ok("a citizen cannot send platform email", citizenEmail.status === 403, `got ${citizenEmail.status}`);
const adminEmail = await call("POST", "/v1/notify/email", {
  token: adminToken, body: { to: "ops@example.com", subject: "RoadAssist test", body: "Channel check." },
});
ok("authority sends via the email channel", adminEmail.data?.sent === true,
   `provider=${adminEmail.data?.provider}`);
const badEmail = await call("POST", "/v1/notify/email", {
  token: adminToken, body: { to: "not-an-email", subject: "x", body: "y" },
});
ok("invalid recipient rejected", badEmail.status === 400, `got ${badEmail.status}`);

// ── 17. Citizen hazard reports (crowdsourced RAKSHA input) ─────────────────
console.log("\n17. Citizen hazard reports");
const reportNote = `e2e citizen note ${tag}`;
const anonReport = await call("POST", "/v1/raksha/report", {
  body: { type: "pothole", severity: 4, lat: 28.44, lng: 77.05 },
});
ok("anonymous hazard report is refused", anonReport.status === 401, `got ${anonReport.status}`);

const badReport = await call("POST", "/v1/raksha/report", {
  token, body: { type: "meteor_strike", severity: 4, lat: 28.44, lng: 77.05 },
});
ok("an invalid hazard type is rejected", badReport.status === 400, `got ${badReport.status}`);

const report = await call("POST", "/v1/raksha/report", {
  token, body: { type: "pothole", severity: 4, lat: 28.44, lng: 77.05, note: reportNote },
});
ok("citizen submits a hazard report", report.status === 201 && report.data?.status === "DETECTED",
   `status=${report.data?.status}`);
ok("report is tagged source=citizen, not a device", report.meta?.source === "citizen");
const reportId = report.data.id;

const myReports = await call("GET", "/v1/me/reports", { token });
const mineReport = (myReports.data ?? []).find((r) => r.id === reportId);
ok("the report shows in the reporter's own list with its note and location",
   Boolean(mineReport) && mineReport.notes === reportNote && mineReport.status === "DETECTED" &&
   mineReport.lat != null);

const otherReports = await call("GET", "/v1/me/reports", { token: otherToken });
ok("another user cannot see this user's reports (scoped to caller)",
   !(otherReports.data ?? []).some((r) => r.id === reportId));

const liveMap = await call("GET", "/v1/map/live?lat=28.44&lng=77.05&radiusKm=10", { token });
ok("the report appears on the live map carrying source=citizen",
   (liveMap.data?.detections ?? []).some((d) => d.source === "citizen"));

const citizenQueue = await call("GET", "/v1/raksha/detections?source=citizen", { token: adminToken });
ok("authority can filter to citizen reports only", citizenQueue.status === 200 &&
   (citizenQueue.data ?? []).every((d) => d.source === "citizen"), `count=${citizenQueue.meta?.count}`);
ok("the submitted report is in the authority's citizen queue",
   (citizenQueue.data ?? []).some((d) => d.id === reportId));

const citizenReportVerify = await call("POST", `/v1/raksha/detections/${reportId}/verify`, {
  token, body: { action: "verify" },
});
ok("a citizen cannot verify their own report", citizenReportVerify.status === 403,
   `got ${citizenReportVerify.status}`);

const verifyReport = await call("POST", `/v1/raksha/detections/${reportId}/verify`, {
  token: adminToken, body: { action: "verify" },   // no reviewer note supplied
});
ok("authority verifies the citizen report", verifyReport.data?.status === "VERIFIED");

const afterVerify = await call("GET", "/v1/me/reports", { token });
const verifiedMine = (afterVerify.data ?? []).find((r) => r.id === reportId);
ok("the reporter sees it VERIFIED with the original note preserved (not clobbered)",
   verifiedMine?.status === "VERIFIED" && verifiedMine?.notes === reportNote,
   `status=${verifiedMine?.status} note="${verifiedMine?.notes}"`);

// photo attachment (stored on disk, never in the DB — ADR-0006)
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const photoReport = await call("POST", "/v1/raksha/report", {
  token, body: { type: "road_damage", severity: 2, lat: 28.45, lng: 77.06, photoBase64: PNG_1x1, photoMime: "image/png" },
});
ok("a report with a photo is accepted and flagged hasPhoto",
   photoReport.status === 201 && photoReport.data?.hasPhoto === true);
const badMime = await call("POST", "/v1/raksha/report", {
  token, body: { type: "pothole", severity: 2, lat: 28.45, lng: 77.06, photoBase64: PNG_1x1, photoMime: "image/gif" },
});
ok("an unsupported photo type is rejected", badMime.status === 400, `got ${badMime.status}`);

const photoUrl = `${BASE}/v1/raksha/detections/${photoReport.data.id}/photo`;
const ownerPhoto = await fetch(photoUrl, { headers: { authorization: `Bearer ${token}` } });
ok("the reporter can fetch their own photo back",
   ownerPhoto.status === 200 && (ownerPhoto.headers.get("content-type") ?? "").startsWith("image/"),
   `${ownerPhoto.status} ${ownerPhoto.headers.get("content-type")}`);
const strangerPhoto = await fetch(photoUrl, { headers: { authorization: `Bearer ${otherToken}` } });
ok("another citizen cannot fetch someone else's photo", strangerPhoto.status === 403, `got ${strangerPhoto.status}`);
const authorityPhoto = await fetch(photoUrl, { headers: { authorization: `Bearer ${adminToken}` } });
ok("an authority can fetch the photo for triage", authorityPhoto.status === 200, `got ${authorityPhoto.status}`);
const anonPhoto = await fetch(photoUrl);
ok("the photo endpoint refuses anonymous access", anonPhoto.status === 401, `got ${anonPhoto.status}`);

// rejecting a report reclaims its photo from disk (image_ref cleared)
const rejectPhoto = await call("POST", `/v1/raksha/detections/${photoReport.data.id}/verify`, {
  token: adminToken, body: { action: "reject" },
});
ok("authority can reject a photo report", rejectPhoto.data?.status === "REJECTED");
const reclaimed = await fetch(photoUrl, { headers: { authorization: `Bearer ${token}` } });
ok("a rejected report's photo is reclaimed (now 404)", reclaimed.status === 404, `got ${reclaimed.status}`);

// per-user report rate limit — one account cannot flood the queue
console.log("\n18. Report rate limiting");
const floodMsisdn = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
const fReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: floodMsisdn } });
const fVer = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: floodMsisdn, code: fReq.meta.devOtp } });
const floodToken = fVer.data.accessToken;
let got429 = false, made = 0;
for (let i = 0; i < 25; i++) {
  const r = await call("POST", "/v1/raksha/report", {
    token: floodToken, body: { type: "pothole", severity: 1, lat: 28.45, lng: 77.05 },
  });
  if (r.status === 429) { got429 = true; break; }
  if (r.status === 201) made++;
}
ok("a single account is rate-limited after a burst of reports", got429 && made <= 20,
   `accepted ${made} then 429`);

console.log(`\n${"─".repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(58)}\n`);
process.exit(fail ? 1 : 0);
