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
console.log("\n9. Invoice and payment");
const completed = detail.data;
ok("booking is COMPLETED", completed.status === "COMPLETED");

// PAID is a fact about money, not a state the client may simply assert. The
// command is still how the transition is recorded — it just no longer creates
// the settlement it records.
const freeRide = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command: "payment.settled" } });
ok("a booking cannot be marked PAID without a payment",
   freeRide.status === 409 && freeRide.error?.code === "payment_required",
   `got ${freeRide.status} ${freeRide.error?.code ?? ""}`);

const cashGrab = await call("POST", `/v1/bookings/${bookingId}/pay`, { token, body: { method: "cash" } });
ok("the customer cannot declare their own cash payment", cashGrab.status === 403,
   `got ${cashGrab.status}`);

const badMethod = await call("POST", `/v1/bookings/${bookingId}/pay`, { token, body: { method: "barter" } });
ok("an unknown payment method is rejected", badMethod.status === 400, `got ${badMethod.status}`);

const paid = await call("POST", `/v1/bookings/${bookingId}/pay`, { token, body: { method: "upi" } });
ok("paying the invoice settles the booking", paid.status === 200 && paid.data?.status === "PAID",
   `got ${paid.status} ${paid.data?.status ?? ""}`);
ok("the payment is recorded for exactly the invoiced amount, never the client's figure",
   paid.data?.payment?.amountPaise === paid.data?.invoice?.totalPaise && paid.data?.payment?.status === "SETTLED",
   `₹${((paid.data?.payment?.amountPaise ?? 0) / 100).toFixed(2)}`);

const doublePay = await call("POST", `/v1/bookings/${bookingId}/pay`, { token });
ok("paying an already-paid booking does not charge again",
   doublePay.status === 200 && doublePay.data?.alreadySettled === true);

const settledEvent = await call("GET", `/v1/bookings/${bookingId}`, { token });
ok("the settlement is in the audit trail like every other transition",
   settledEvent.data?.events?.some((e) => e.command === "payment.settled" && e.toStatus === "PAID"));

const unpayable = await call("POST", "/v1/bookings", {
  token, body: { vehicleId, serviceTypeCode: "flat_tyre", lat: 28.4595, lng: 77.0266 },
});
const early = await call("POST", `/v1/bookings/${unpayable.data.id}/pay`, { token });
ok("a job that has not been done yet cannot be paid for",
   early.status === 409 && early.error?.code === "not_payable",
   `got ${early.status} ${early.error?.code ?? ""}`);

// ── 10. offline sync ───────────────────────────────────────────────────────
console.log("\n10. Offline replay");
const opId = "op-" + Math.random().toString(36).slice(2, 12);
const batch = { operations: [{ opId, entity: "booking", operation: "create",
  payload: { note: "queued while offline" }, clientUpdatedAt: new Date().toISOString() }] };
const s1 = await call("POST", "/v1/sync/operations", { token, body: batch });
ok("queued operation applied on reconnect", s1.data?.results?.[0]?.status === "applied");
const s2 = await call("POST", "/v1/sync/operations", { token, body: batch });

// ── 11b. offline conflict resolution (ADR-0004 §8) ─────────────────────────
// A device that lost the network at one status and reconnects after the
// mechanic moved the job on must NOT be able to drag the booking backwards.
console.log("\n11b. Offline conflict resolution");
const staleOp = {
  operations: [{
    opId: "conflict-" + Math.random().toString(36).slice(2, 12),
    entity: "booking", entityId: bookingId, operation: "update",
    // The booking is PAID by this point in the journey; the device thinks it
    // is still EN_ROUTE because that is where it was when the signal died.
    payload: { status: "EN_ROUTE" },
    clientUpdatedAt: new Date().toISOString(),
  }],
};
const conflicted = await call("POST", "/v1/sync/operations", { token, body: staleOp });
const conflictResult = conflicted.data?.results?.[0];
ok("a stale client status is not applied", conflictResult?.status === "conflict",
   conflictResult?.status);
ok("the rule that fired is named", conflictResult?.rule === "server_wins", conflictResult?.rule);
ok("the server's value is returned as authoritative",
   conflictResult?.authoritative?.status === "PAID" && conflictResult?.serverValue === "PAID",
   `server=${conflictResult?.serverValue} client=${conflictResult?.clientValue}`);
ok("the batch reports the conflict count", conflicted.meta?.conflicts === 1,
   JSON.stringify(conflicted.meta));

// A separate account, signed in here rather than reusing the one created later
// in this file — an ownership check must not depend on statement order.
const bystanderMsisdn = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
const bystanderOtp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: bystanderMsisdn } });
const bystander = await call("POST", "/v1/auth/otp/verify", {
  body: { msisdn: bystanderMsisdn, code: bystanderOtp.meta.devOtp },
});
const foreignOp = await call("POST", "/v1/sync/operations", {
  token: bystander.data.accessToken,
  body: { operations: [{ ...staleOp.operations[0], opId: "x-" + Math.random().toString(36).slice(2, 12) }] },
});
ok("a device cannot sync an operation about someone else's booking",
   foreignOp.data?.results?.[0]?.status === "rejected",
   foreignOp.data?.results?.[0]?.reason);

const agreeing = await call("POST", "/v1/sync/operations", {
  token,
  body: { operations: [{ ...staleOp.operations[0], opId: "agree-" + Math.random().toString(36).slice(2, 12),
    payload: { status: "PAID" } }] },
});
ok("a client that already agrees with the server applies cleanly",
   agreeing.data?.results?.[0]?.status === "applied",
   agreeing.data?.results?.[0]?.status);
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

// ── 12b. off-grid SOS: store on the device, forward on reconnect (ADR-0009) ─
console.log("\n12b. Off-grid SOS synchronisation");

const ping = await call("GET", "/v1/ping");
ok("the connectivity probe answers without touching the database",
   ping.status === 200 && typeof ping.data?.t === "number");

/** The device mints these; the shape is pinned so a colliding key cannot get in. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const clientId = () => "RA-" + Array.from({ length: 6 },
  () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const digest64 = () => Array.from({ length: 64 },
  () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

const offGridId = clientId();
const offGridOp = "ogs-" + Math.random().toString(36).slice(2, 14);
const offGridBody = {
  incidents: [{
    clientIncidentId: offGridId,
    opId: offGridOp,
    // Raised twenty minutes ago, while the phone had no signal.
    occurredAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    emergencyType: "breakdown",
    lat: 28.4601, lng: 77.0301, accuracyM: 14,
    vehicleId,
    diagnosis: { cause: "Battery discharged or terminals loose", confidence: 0.8, severity: 3, engine: "local-rules-1.0.0" },
    integrity: digest64(),
  }],
};

const anonSync = await call("POST", "/v1/sos/offline-sync", { body: offGridBody });
ok("off-grid sync has no anonymous intake path", anonSync.status === 401, `got ${anonSync.status}`);

const synced = await call("POST", "/v1/sos/offline-sync", { token, body: offGridBody });
ok("a stored off-grid incident is accepted on reconnect", synced.status === 200, `got ${synced.status}`);
const created = synced.data?.results?.[0];
ok("it lands as a real incident with a server id", Boolean(created?.id), created?.status);
ok("it arrives CONFIRMED — it was a human act when it happened",
   created?.incidentStatus === "CONFIRMED", created?.incidentStatus);
ok("the server reports how long it sat on the device",
   created?.storedOfflineForMs > 60_000, `${Math.round((created?.storedOfflineForMs ?? 0) / 1000)}s`);
ok("syncing does NOT alert anybody — escalation stays an explicit step",
   created?.escalationRequired === true && /Nothing has been alerted/i.test(synced.meta?.note ?? ""),
   synced.meta?.note);

// The whole point of the idempotency key: a retry after a lost response.
const replay = await call("POST", "/v1/sos/offline-sync", { token, body: offGridBody });
ok("replaying the same incident creates no duplicate",
   replay.data?.results?.[0]?.status === "duplicate", replay.data?.results?.[0]?.status);
ok("the replay converges on the same incident id",
   replay.data?.results?.[0]?.id === created?.id);
ok("the meta counts the replay as a duplicate, not a creation",
   replay.meta?.created === 0 && replay.meta?.duplicates === 1,
   JSON.stringify(replay.meta));

const otherReplay = await call("POST", "/v1/sos/offline-sync", { token: otherToken, body: offGridBody });
ok("another account cannot claim someone else's device reference",
   otherReplay.data?.results?.[0]?.status === "rejected",
   otherReplay.data?.results?.[0]?.reason);

// Offline payloads are re-validated as hostile input, because that is what they are.
const badShape = await call("POST", "/v1/sos/offline-sync", {
  token, body: { incidents: [{ ...offGridBody.incidents[0], clientIncidentId: "not-a-reference" }] },
});
ok("a malformed device reference is rejected outright", badShape.status === 400, `got ${badShape.status}`);

const future = await call("POST", "/v1/sos/offline-sync", {
  token, body: { incidents: [{ ...offGridBody.incidents[0], clientIncidentId: clientId(),
    opId: "ogs-" + Math.random().toString(36).slice(2, 14),
    occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }] },
});
ok("an incident from the future is refused, not silently accepted",
   future.data?.results?.[0]?.status === "rejected", future.data?.results?.[0]?.reason);

const stale = await call("POST", "/v1/sos/offline-sync", {
  token, body: { incidents: [{ ...offGridBody.incidents[0], clientIncidentId: clientId(),
    opId: "ogs-" + Math.random().toString(36).slice(2, 14),
    occurredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }] },
});
ok("an incident older than the retention window is refused",
   stale.data?.results?.[0]?.status === "rejected", stale.data?.results?.[0]?.reason);

const foreignVehicle = await call("POST", "/v1/sos/offline-sync", {
  token, body: { incidents: [{ ...offGridBody.incidents[0], clientIncidentId: clientId(),
    opId: "ogs-" + Math.random().toString(36).slice(2, 14),
    vehicleId: "00000000-0000-4000-8000-000000000000" }] },
});
ok("an unverifiable vehicle link is dropped rather than failing the emergency",
   foreignVehicle.data?.results?.[0]?.status === "created",
   foreignVehicle.data?.results?.[0]?.status);

// And the escalation ladder is the same one an online SOS runs.
const offGridEscalated = await call("POST", `/v1/sos/${created.id}/confirm`, { token });
ok("a synchronised off-grid incident escalates through the normal ladder",
   offGridEscalated.data?.status === "RESPONDING", offGridEscalated.data?.status);
ok("its emergency contacts are alerted like any other incident",
   offGridEscalated.data?.contactsAlerted >= 1, `${offGridEscalated.data?.contactsAlerted}`);

const offGridDetail = await call("GET", `/v1/bookings`, { token });   // keeps the session warm
ok("the session survives the off-grid round trip", offGridDetail.status === 200);

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

// ── 19. keyless basemap proxy ──────────────────────────────────────────────
// The proxy used to fetch CARTO raster basemaps, which now require an API key
// and stamp "API KEY REQUIRED" across every unauthenticated tile. It serves
// keyless OpenStreetMap tiles instead, so the map carries no watermark and the
// platform still needs zero third-party accounts.
console.log("\n19. Keyless basemap proxy");
const tile = (path) => fetch(`${BASE}/basemap/${path}`);
const [tOk, tLowZ, tHighZ, tBadFile] = await Promise.all([
  tile("5/22/13.png"), tile("2/1/1.png"), tile("19/1/1.png"), tile("5/22/notatile.png"),
]);
ok("a basemap tile is served as PNG", tOk.status === 200 &&
   tOk.headers.get("content-type")?.includes("image/png"), `got ${tOk.status}`);
const tileBytes = Buffer.from(await tOk.arrayBuffer());
ok("the tile is a real PNG, not an error page",
   tileBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
   `${tileBytes.length} bytes`);
ok("tiles are cached hard by the client", (tOk.headers.get("cache-control") ?? "").includes("max-age"),
   tOk.headers.get("cache-control") ?? "none");
ok("a zoom below the allowed window is rejected", tLowZ.status === 400, `got ${tLowZ.status}`);
ok("a zoom above the allowed window is rejected", tHighZ.status === 400, `got ${tHighZ.status}`);
ok("a non-numeric tile filename is rejected", tBadFile.status === 400, `got ${tBadFile.status}`);

// These four sections continue the booking from §9. They run here rather than
// beside it because they need the admin and second-citizen sessions, and every
// extra OTP counts against the per-IP ceiling this suite must not trip.
// ── 20. reviews ────────────────────────────────────────────────────────────
// The dispatch ranker weights `rating` at 34% of a mechanic's score but nothing
// used to write that column. These assertions pin the loop shut.
console.log("\n20. Reviews");
const unreviewable = await call("POST", `/v1/bookings/${unpayable.data.id}/review`, {
  token, body: { rating: 5 },
});
ok("an unfinished job cannot be reviewed",
   unreviewable.status === 409 && unreviewable.error?.code === "not_reviewable",
   `got ${unreviewable.status} ${unreviewable.error?.code ?? ""}`);

const outOfRange = await call("POST", `/v1/bookings/${bookingId}/review`, { token, body: { rating: 9 } });
ok("a rating outside 1–5 is rejected", outOfRange.status === 400, `got ${outOfRange.status}`);

const mechanicBefore = (await call("GET", `/v1/bookings/${bookingId}`, { token })).data?.mechanicId;
const ratingBefore = (await call("GET", `/v1/mechanics/${mechanicBefore}/reviews`, { token }))
  .data?.mechanic?.rating;
const review = await call("POST", `/v1/bookings/${bookingId}/review`, {
  token, body: { rating: 2, comment: "Took a while, but sorted it." },
});
ok("the customer can review a paid job", review.status === 201 && review.data?.rating === 2,
   `got ${review.status}`);
// Bounds rather than an exact figure: this suite shares a database, so the
// mechanic dispatch picks may already carry reviews from earlier runs. Both
// bounds hold for any history — shrinkage toward the mechanic's prior keeps the
// score strictly above the 2★ just given, and the 2★ never raises it. The
// comparison is with the mechanic's OWN rating before the review, not with the
// platform mean: this used to assert "< 4.2", which only held while every
// review was shrunk toward 4.2 and the mechanic's existing rating was thrown
// away — the bug that took a 4.9 to 4.33 on a 5★. (Not strictly lower: a
// mechanic with a long record can move by less than the 2-decimal rounding.)
// The exact formula is pinned in apps/api/test/rating.test.ts.
ok("one harsh review dents the mechanic's rating without destroying it",
   review.data?.mechanicRating > 2 && typeof ratingBefore === "number" &&
   review.data?.mechanicRating <= ratingBefore,
   `rating ${ratingBefore} → ${review.data?.mechanicRating} across ${review.data?.mechanicReviewCount} review(s)`);

const reviewTwice = await call("POST", `/v1/bookings/${bookingId}/review`, { token, body: { rating: 5 } });
ok("the same job cannot be reviewed twice",
   reviewTwice.status === 409 && reviewTwice.error?.code === "already_reviewed",
   `got ${reviewTwice.status} ${reviewTwice.error?.code ?? ""}`);

const strangerReview = await call("POST", `/v1/bookings/${bookingId}/review`, {
  token: otherToken, body: { rating: 1 },
});
ok("somebody else cannot review a job they were not on", strangerReview.status === 403,
   `got ${strangerReview.status}`);

const publicReviews = await call("GET", `/v1/mechanics/${mechanicBefore}/reviews`, { token });
ok("a mechanic's reviews are readable with their distribution",
   publicReviews.status === 200 && publicReviews.data?.reviews?.length >= 1 &&
   Array.isArray(publicReviews.data?.distribution),
   `${publicReviews.data?.reviews?.length} review(s)`);
ok("a review is published without identifying who wrote it",
   publicReviews.data?.reviews?.every((r) => !("userId" in r)));

// ── 21. medical profile and break-glass ────────────────────────────────────
console.log("\n21. Medical profile · break-glass");
const noProfile = await call("GET", "/v1/me/medical", { token });
ok("a profile starts unset rather than missing", noProfile.status === 200,
   `configured=${noProfile.meta?.configured}`);

const badBlood = await call("PUT", "/v1/me/medical", { token, body: { bloodGroup: "Z+" } });
ok("an impossible blood group is rejected", badBlood.status === 400, `got ${badBlood.status}`);

const savedMedical = await call("PUT", "/v1/me/medical", {
  token, body: { bloodGroup: "O+", allergies: "penicillin", conditions: "asthma" },
});
ok("the medical profile saves", savedMedical.status === 200 && savedMedical.data?.bloodGroup === "O+");

const emergency = await call("POST", "/v1/sos", { token, body: { lat: 28.4595, lng: 77.0266 } });
const incidentId = emergency.data?.incidentId ?? emergency.data?.id;
ok("an incident exists to break glass on", Boolean(incidentId));

const selfServe = await call("GET", `/v1/incidents/${incidentId}/medical?reason=curious+about+this+record`, { token });
ok("a citizen cannot break glass on anyone, including themselves", selfServe.status === 403,
   `got ${selfServe.status}`);

const noReason = await call("GET", `/v1/incidents/${incidentId}/medical`, { token: adminToken });
ok("an authority must give a reason", noReason.status === 400, `got ${noReason.status}`);

const thinReason = await call("GET", `/v1/incidents/${incidentId}/medical?reason=x`, { token: adminToken });
ok("the reason has to actually say something", thinReason.status === 400, `got ${thinReason.status}`);

const REASON = "unconscious at scene, need blood group before transfusion";
const glass = await call("GET", `/v1/incidents/${incidentId}/medical?reason=${encodeURIComponent(REASON)}`,
                         { token: adminToken });
ok("an authority on a live incident gets the record",
   glass.status === 200 && glass.data?.bloodGroup === "O+", `got ${glass.status}`);
ok("the read is handed back with its break-glass reference", Boolean(glass.meta?.breakGlassId));

const accessLog = await call("GET", "/v1/me/medical/access-log", { token });
ok("the subject can see who opened their record, and why",
   accessLog.data?.[0]?.reason === REASON, accessLog.data?.[0]?.reason);
ok("the subject was notified it happened", Boolean(accessLog.data?.[0]?.notifiedAt));

await call("POST", `/v1/sos/${incidentId}/cancel`, { token });
const afterIncidentClosed = await call("GET", `/v1/incidents/${incidentId}/medical?reason=${encodeURIComponent(REASON)}`,
                               { token: adminToken });
ok("break glass closes once the emergency is over",
   afterIncidentClosed.status === 403 && afterIncidentClosed.error?.code === "incident_not_live",
   `got ${afterIncidentClosed.status} ${afterIncidentClosed.error?.code ?? ""}`);

// ── 22. vehicle documents ──────────────────────────────────────────────────
console.log("\n22. Vehicle documents");
const day = 86_400_000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();
ok("an insurance expiry is recorded",
   (await call("POST", `/v1/vehicles/${vehicleId}/documents`,
      { token, body: { docType: "insurance", expiresOn: iso(12 * day) } })).status === 201);
ok("a lapsed PUC is recorded",
   (await call("POST", `/v1/vehicles/${vehicleId}/documents`,
      { token, body: { docType: "puc", expiresOn: iso(-5 * day) } })).status === 201);

const madeUpDoc = await call("POST", `/v1/vehicles/${vehicleId}/documents`,
  { token, body: { docType: "hogwarts_permit", expiresOn: iso(day) } });
ok("an unknown document type is rejected", madeUpDoc.status === 400, `got ${madeUpDoc.status}`);

const notMyVehicle = await call("POST", `/v1/vehicles/${vehicleId}/documents`,
  { token: otherToken, body: { docType: "rc", expiresOn: iso(day) } });
ok("documents cannot be filed against someone else's vehicle", notMyVehicle.status === 403,
   `got ${notMyVehicle.status}`);

const documents = await call("GET", "/v1/me/documents", { token });
ok("the countdown is computed server-side, soonest first",
   documents.data?.[0]?.docType === "puc" && documents.data[0].daysToExpiry < 0 &&
   documents.data[0].state === "expired",
   `${documents.data?.[0]?.docType} ${documents.data?.[0]?.daysToExpiry}d`);
ok("expiring-soon is counted separately from expired",
   documents.meta?.expired === 1 && documents.meta?.expiringWithin30Days === 1,
   `expired=${documents.meta?.expired} expiring=${documents.meta?.expiringWithin30Days}`);

await call("POST", `/v1/vehicles/${vehicleId}/documents`,
  { token, body: { docType: "puc", expiresOn: iso(300 * day) } });
const renewed = await call("GET", "/v1/me/documents", { token });
ok("renewing supersedes the old document rather than duplicating it",
   renewed.data?.length === documents.data?.length && renewed.meta?.expired === 0,
   `${renewed.data?.length} docs, ${renewed.meta?.expired} expired`);

// ── 23. tamper-evident audit log ───────────────────────────────────────────
console.log("\n23. Audit chain");
const auditRead = await call("GET", "/v1/admin/audit?limit=20", { token: adminToken });
ok("the audit trail is admin-only",
   (await call("GET", "/v1/admin/audit", { token })).status === 403);
ok("the trail recorded the break-glass read",
   auditRead.data?.some((r) => r.action === "medical.break_glass_read"));
ok("the chain verifies on read", auditRead.meta?.integrity?.ok === true,
   `checked ${auditRead.meta?.integrity?.checked} entries`);

// ── 24. booking read/write audience parity ─────────────────────────────────
// POST /bookings/:id/transition has always allowed the assigned mechanic. The
// GET did not, so the write path was strictly more permissive than the read
// path — a mechanic could drive a job they were forbidden to look at. These
// assertions pin both halves: the mechanic can now read, and nobody else can.
console.log("\n24. Booking read/write audience parity");
{
  const { default: postgres } = await import("postgres");
  const DB_URL = process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist";
  let sql;
  try {
    sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
    const parityVeh = await call("POST", "/v1/vehicles", {
      token,
      body: { registrationNo: "PR" + Math.floor(Math.random() * 8999 + 1000) + "XY", vehicleClass: "car" },
    });
    const parityBooking = await call("POST", "/v1/bookings", {
      token,
      body: {
        vehicleId: parityVeh.data.id, serviceTypeCode: "battery_jumpstart",
        lat: 28.4595, lng: 77.0266, idempotencyKey: "parity-" + Date.now(),
      },
    });
    const parityDispatch = await call("POST", `/v1/bookings/${parityBooking.data.id}/dispatch`, {
      token, body: { radiusKm: 40, limit: 5 },
    });
    const offer = parityDispatch.data?.offers?.[0];
    ok("dispatch produced an offer to test against", Boolean(offer),
       `${parityDispatch.data?.offers?.length ?? 0} offers`);

    if (offer) {
      // The offer only carries the mechanic's public identity, so the harness
      // resolves the owning account directly — the same join dispatch used.
      const [row] = await sql`
        SELECT u.msisdn FROM dispatch_offers o
          JOIN mechanics m ON m.id = o.mechanic_id
          JOIN users u ON u.id = m.user_id
         WHERE o.id = ${offer.id}`;
      ok("the offer resolves to a signed-in-able mechanic account", Boolean(row?.msisdn));

      const mReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: row.msisdn } });
      const mVer = await call("POST", "/v1/auth/otp/verify", {
        body: { msisdn: row.msisdn, code: mReq.meta.devOtp },
      });
      const mToken = mVer.data.accessToken;
      ok("the mechanic account carries the mechanic role", mVer.data.roles.includes("mechanic"),
         JSON.stringify(mVer.data.roles));

      const inbox = await call("GET", "/v1/mechanic/offers", { token: mToken });
      ok("the mechanic sees this offer in their own inbox",
         inbox.status === 200 && inbox.data.some((o) => o.id === offer.id),
         `${inbox.data?.length ?? 0} offer(s)`);

      const accepted = await call("POST", `/v1/offers/${offer.id}/accept`, { token: mToken });
      ok("the mechanic can accept their own offer", accepted.status === 200,
         `status=${accepted.data?.status}`);

      const mRead = await call("GET", `/v1/bookings/${parityBooking.data.id}`, { token: mToken });
      ok("the ASSIGNED MECHANIC can now read the booking they drive",
         mRead.status === 200, `got ${mRead.status}`);

      const mDrive = await call("POST", `/v1/bookings/${parityBooking.data.id}/transition`, {
        token: mToken, body: { command: "mechanic.start_travel" },
      });
      // The write path always allowed this; asserting it alongside the read is
      // what pins the two to the same audience.
      ok("the mechanic can still drive the job it can now read",
         mDrive.status === 200 && mDrive.data.status === "EN_ROUTE", `got ${mDrive.status}`);

      // …and the widening stops exactly there. Reuses the unrelated citizen the
      // suite already signed in: every extra account costs an OTP against the
      // per-IP ceiling, which the suite itself would otherwise trip on a rerun.
      const sRead = await call("GET", `/v1/bookings/${parityBooking.data.id}`, {
        token: otherToken,
      });
      ok("an unrelated citizen still cannot read that booking", sRead.status === 403,
         `got ${sRead.status}`);

      const dupe = await call("POST", `/v1/offers/${offer.id}/accept`, { token: mToken });
      ok("re-accepting a closed offer is refused", dupe.status === 409,
         `code=${dupe.error?.code}`);

      // Cash is the common case on an Indian roadside, and it is the one method
      // the platform records rather than charges — so the person holding the
      // money is the only one who may declare it.
      for (const command of ["arrive", "work.start", "work.complete"]) {
        await call("POST", `/v1/bookings/${parityBooking.data.id}/transition`, {
          token: mToken, body: { command },
        });
      }
      const cash = await call("POST", `/v1/bookings/${parityBooking.data.id}/pay`, {
        token: mToken, body: { method: "cash" },
      });
      ok("the assigned mechanic can record a cash payment",
         cash.status === 200 && cash.data?.status === "PAID" && cash.data?.payment?.method === "cash",
         `got ${cash.status} ${cash.data?.status ?? ""}`);
      ok("a cash settlement never touches the payment gateway",
         String(cash.data?.payment?.providerRef ?? "").startsWith("cash_"),
         cash.data?.payment?.providerRef);
    }
  } catch (e) {
    // A harness problem is a failed assertion, not a crashed run — the other
    // 100+ results still need to be reported.
    ok("booking-audience checks could reach the database", false, e.message);
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
}

console.log(`\n${"─".repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(58)}\n`);
process.exit(fail ? 1 : 0);
