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
const redispatch = await call("POST", `/v1/bookings/${bookingId}/dispatch`, { token, body: { radiusKm: 30, limit: 5 } });
ok("a second dispatch while offers are live is refused", redispatch.status === 409 &&
   redispatch.error?.code === "dispatch_in_progress", `got ${redispatch.status} ${redispatch.error?.code ?? ""}`);

// ── 7b. nobody in range, then the app's "Widen and retry" ──────────────────
// The app answers NO_SUPPLY with a button that sends retry.widen (NO_SUPPLY →
// MATCHING) and then dispatches with a larger radius. Dispatch accepted
// REQUESTED alone, so that search always answered 409 and the booking sat in
// MATCHING with nobody asked. A fresh account keeps the booking limit clear.
console.log("\n7b. No supply, then a widened retry");
{
  const nsNumber = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
  const nsReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: nsNumber } });
  const nsVer = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: nsNumber, code: nsReq.meta?.devOtp } });
  const nsToken = nsVer.data?.accessToken;
  const nsVeh = await call("POST", "/v1/vehicles", {
    token: nsToken,
    body: { registrationNo: "NS" + Math.floor(1000 + Math.random() * 8999) + Math.random().toString(36).slice(2, 5).toUpperCase(), vehicleClass: "car" },
  });
  // The Arabian Sea, hundreds of kilometres from any seeded mechanic.
  const nsBooking = await call("POST", "/v1/bookings", {
    token: nsToken, body: { vehicleId: nsVeh.data?.id, serviceTypeCode: "battery_jumpstart", lat: 15.0, lng: 65.0 },
  });
  const nsId = nsBooking.data?.id;
  const dispatchAt = (radiusKm) => call("POST", `/v1/bookings/${nsId}/dispatch`, { token: nsToken, body: { radiusKm, limit: 5 } });
  const none = await dispatchAt(10);
  ok("a search that finds nobody leaves the booking in NO_SUPPLY",
     none.status === 200 && none.data?.status === "NO_SUPPLY", `got ${none.status} ${none.data?.status ?? none.error?.code}`);
  const retry = await dispatchAt(25);
  ok("dispatching again from NO_SUPPLY runs a new search",
     retry.status === 200 && retry.data?.status === "NO_SUPPLY", `got ${retry.status} ${retry.data?.status ?? retry.error?.code}`);
  const widen = await call("POST", `/v1/bookings/${nsId}/transition`, { token: nsToken, body: { command: "retry.widen" } });
  ok("retry.widen moves NO_SUPPLY back to MATCHING", widen.status === 200 && widen.data?.status === "MATCHING",
     `got ${widen.status} ${widen.data?.status ?? widen.error?.code}`);
  const widened = await dispatchAt(50);
  ok("the widened search then runs instead of answering 409",
     widened.status === 200 && widened.data?.status === "NO_SUPPLY", `got ${widened.status} ${widened.data?.status ?? widened.error?.code}`);
  const nsDetail = await call("GET", `/v1/bookings/${nsId}`, { token: nsToken });
  ok("every search is on the booking's history", (nsDetail.data?.events ?? [])
     .filter((e) => e.command === "offers.exhausted").length === 3, `${nsDetail.data?.events?.length ?? 0} events`);
  await call("POST", `/v1/bookings/${nsId}/transition`, { token: nsToken, body: { command: "cancel" } });
}

// ── 8. state machine ───────────────────────────────────────────────────────
console.log("\n8. Booking state machine");
const illegal = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command: "work.complete" } });
ok("illegal transition rejected with 409", illegal.status === 409, illegal.error?.title?.slice(0, 60));

// The customer chooses one of the offered mechanics (the citizen apps' Accept).
// The seeded operator then reports the work done for that mechanic: a review
// needs a completion the workforce reported, which §40 pins from the other side.
const opsOtp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: "+919999900001" } });
const opsSession = (await call("POST", "/v1/auth/otp/verify", {
  body: { msisdn: "+919999900001", code: opsOtp.meta?.devOtp },
})).data;
const opsToken = opsSession?.accessToken;
const accept = await call("POST", `/v1/offers/${first.id}/accept`, { token });
ok("the customer can choose an offered mechanic", accept.status === 200 && accept.data.status === "ASSIGNED",
   `got ${accept.status} ${accept.data?.status ?? accept.error?.code ?? ""}`);
const reAccept = await call("POST", `/v1/offers/${first.id}/accept`, { token: opsToken });
ok("the same offer cannot be accepted twice", reAccept.status === 409);

const jobsOf = async (mechanicId) =>
  (await call("GET", `/v1/mechanics/${mechanicId}/reviews`, { token })).data?.mechanic?.jobsCompleted;
const jobsBefore = await jobsOf(accept.data?.mechanicId);
for (const [command, expected, who] of [
  ["mechanic.start_travel", "EN_ROUTE", token], ["arrive", "ON_SITE", token],
  ["work.start", "IN_PROGRESS", token], ["work.complete", "COMPLETED", opsToken],
]) {
  const r = await call("POST", `/v1/bookings/${bookingId}/transition`, { token: who, body: { command } });
  ok(`${command} → ${expected}`, r.data?.status === expected, `got ${r.data?.status}`);
}
// The workforce (here the operator) reported the job done, so it counts once.
// A customer marking its own job done is pinned in §40 below: no count, no review.
const jobsAfter = await jobsOf(accept.data?.mechanicId);
ok("a completion reported by the workforce adds exactly one job to the mechanic's record",
   typeof jobsBefore === "number" && jobsAfter === jobsBefore + 1, `${jobsBefore} → ${jobsAfter}`);
const acceptEvent = (await call("GET", `/v1/bookings/${bookingId}`, { token })).data?.events
  ?.find((e) => e.command === "mechanic.accept");
// It used to be written as the mechanic's own acceptance, with the mechanic
// row's id standing in for a user.
ok("a customer's choice is recorded as the customer's, not as the mechanic accepting",
   acceptEvent?.actorId === verified.data?.user?.id && acceptEvent?.actorRole === "citizen" &&
   acceptEvent?.meta?.acceptedBy === "customer" && acceptEvent?.meta?.mechanicId === accept.data?.mechanicId,
   `actorRole=${acceptEvent?.actorRole} acceptedBy=${acceptEvent?.meta?.acceptedBy}`);

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
// Found is not told: nothing is sent to that unit, and the answer says so, so
// no screen can turn "a unit was located" into "help is on the way".
ok("the answer says no responder was notified (located, not contacted)",
   confirmed.data?.respondersNotified === 0, `respondersNotified=${confirmed.data?.respondersNotified}`);
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
ok("HELP <type> creates a request", /Request RA\w+ recorded/i.test(started.data?.reply ?? ""),
   started.data?.reply?.slice(0, 46));
// A texted request carries no location, so nothing can search for it: the
// reply said "We are finding a mechanic near you" about a booking that would
// never be dispatched. It now says so, and points at 112.
ok("…and the reply says no search can start without a location, never that one is running",
   /no location/i.test(started.data?.reply ?? "") && /112/.test(started.data?.reply ?? "") &&
     !/finding a mechanic/i.test(started.data?.reply ?? ""),
   started.data?.reply);
const dupe = await sms("HELP CAR");
ok("a second request is refused while one is open", /already have/i.test(dupe.data?.reply ?? ""));
const status = await sms("STATUS");
ok("STATUS reports the booking, and does not claim a search is running",
   (status.data?.reply ?? "").includes(started.data?.reply?.match(/RA\w+/)?.[0] ?? "?") &&
     !/finding a mechanic/i.test(status.data?.reply ?? ""),
   status.data?.reply);
const cancelled = await sms("CANCEL");
ok("CANCEL works over SMS", /cancelled/i.test(cancelled.data?.reply ?? ""));
const afterCancel = await sms("STATUS");
ok("STATUS after cancelling is honest", /no active request/i.test(afterCancel.data?.reply ?? ""));
const smsSos = await sms("SOS");
// The reply says what happened (recorded, its ref, nobody dispatched, call 112)
// and never that help is being arranged: nothing contacts a responder from here.
ok("SOS works over SMS on the degraded path, and the reply promises nothing",
   /SOS received.*recorded \(ref [0-9a-f]{8}\)\. Nobody is dispatched automatically\. Call 112/i
     .test(smsSos.data?.reply ?? "") && !/being arranged|on the way/i.test(smsSos.data?.reply ?? ""),
   smsSos.data?.reply);
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

// §12's confirm answer said whether its counted contacts were really texted.
// It must follow the configured provider, which the operator health view names:
// console only logs (the hosted demo), so smsLive is false there.
const healthDetail = await call("GET", "/health?detail=1", { token: adminToken });
const smsProviderName = healthDetail.data?.providers?.sms;
ok("the confirm answer's smsLive follows the configured SMS provider (console only logs)",
   typeof smsProviderName === "string" && typeof confirmed.data?.smsLive === "boolean" &&
     confirmed.data.smsLive === (smsProviderName !== "console"),
   `provider=${smsProviderName} smsLive=${confirmed.data?.smsLive}`);

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
// must never be silently censored by the first device's rows. Its readings are
// its own (its clock is a second behind): a byte-identical reading from a
// second device is a replay, which source_key rightly refuses (section 31).
const devReg2 = await call("POST", "/v1/raksha/devices", {
  token: adminToken, body: { name: "E2E-EDGE-2 [SIMULATED]", lat: 28.41, lng: 76.99 },
});
const devTok2 = await call("POST", "/v1/raksha/devices/token", {
  body: { deviceId: devReg2.data.id, deviceSecret: devReg2.data.deviceSecret },
});
const cross = await call("POST", "/v1/raksha/detections", {
  token: devTok2.data.accessToken, body: { detections: edgeBatch.detections.map((d) => ({
    ...d, capturedAt: new Date(new Date(d.capturedAt).getTime() - 1000).toISOString() })) },
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

// photo attachment (on disk or in raksha_photos, whichever PHOTO_STORE the server runs — ADR-0013)
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

// An app restarted mid-emergency must still find it, to close it.
const openMine = await call("GET", "/v1/me/incidents", { token });
ok("the caller's open emergency is listed, with what may be done to it",
   openMine.status === 200 && openMine.data?.some((i) => i.id === incidentId && typeof i.canCancel === "boolean"),
   `got ${openMine.status} ${openMine.data?.length ?? ""}`);
ok("each listed emergency says how many responders were notified, so a card never assumes",
   openMine.data?.length > 0 && openMine.data.every((i) => i.respondersNotified === 0),
   openMine.data?.map((i) => i.respondersNotified).join(","));
const openTheirs = await call("GET", "/v1/me/incidents", { token: otherToken });
ok("nobody else's emergencies are in that list",
   openTheirs.status === 200 && !openTheirs.data?.some((i) => i.id === incidentId), `got ${openTheirs.status}`);

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
// The response says what happened to the subject's notice, rather than always
// claiming "the subject has been notified".
ok("the responder is told the notice was actually sent",
   glass.meta?.subjectNotice === "sent" && /notified by SMS/.test(glass.meta?.notice ?? ""),
   `${glass.meta?.subjectNotice} · ${glass.meta?.notice ?? ""}`);

const accessLog = await call("GET", "/v1/me/medical/access-log", { token });
ok("the subject can see who opened their record, and why",
   accessLog.data?.[0]?.reason === REASON, accessLog.data?.[0]?.reason);
ok("the subject was notified it happened", Boolean(accessLog.data?.[0]?.notifiedAt));

await call("POST", `/v1/sos/${incidentId}/cancel`, { token });
const openAfter = await call("GET", "/v1/me/incidents", { token });
ok("a closed emergency leaves the open list",
   openAfter.status === 200 && !openAfter.data?.some((i) => i.id === incidentId), `got ${openAfter.status}`);
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
      const mJobs = async () => (await call("GET", `/v1/mechanics/${accepted.data?.mechanicId}/reviews`, { token: mToken }))
        .data?.mechanic?.jobsCompleted;
      const mJobsBefore = await mJobs();
      for (const command of ["arrive", "work.start", "work.complete"]) {
        await call("POST", `/v1/bookings/${parityBooking.data.id}/transition`, {
          token: mToken, body: { command },
        });
      }
      const mJobsAfter = await mJobs();
      ok("a job the mechanic completes adds exactly one to their record",
         typeof mJobsBefore === "number" && mJobsAfter === mJobsBefore + 1, `${mJobsBefore} → ${mJobsAfter}`);
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

// ── 25. hardening from the security review ────────────────────────────────
console.log("\n25. Hardening");
{
  const page = await fetch(BASE + "/app.html");
  const csp = page.headers.get("content-security-policy") ?? "";
  ok("pages carry a content security policy that closes plugins and foreign framing",
     csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'self'") && csp.includes("base-uri 'self'"),
     csp.slice(0, 60));
  const api = await fetch(BASE + "/v1/ping");
  ok("API answers are nosniff and never cached",
     api.headers.get("x-content-type-options") === "nosniff" && api.headers.get("cache-control") === "no-store",
     `${api.headers.get("x-content-type-options")} / ${api.headers.get("cache-control")}`);

  // Neither reaches OpenStreetMap: both are refused before any fetch.
  const offGrid = await fetch(BASE + "/basemap/3/8/0.png");
  ok("a tile that does not exist at its zoom is refused, not fetched", offGrid.status === 404, `got ${offGrid.status}`);
  const london = await fetch(BASE + "/basemap/12/2046/1362.png");
  ok("a tile far outside the region is refused, not fetched", london.status === 404, `got ${london.status}`);

  const sneakAccept = await call("POST", `/v1/bookings/${bookingId}/transition`, { token, body: { command: "mechanic.accept" } });
  ok("a mechanic cannot be 'accepted' through the generic command route",
     sneakAccept.status === 409 && sneakAccept.error?.code === "command_not_allowed",
     `got ${sneakAccept.status} ${sneakAccept.error?.code ?? ""}`);

  const borrowedKey = await call("POST", "/v1/bookings", {
    token: otherToken, key: idem,
    body: { vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266 },
  });
  ok("another user's idempotency key is a conflict, never a replay of their booking",
     borrowedKey.status === 409 && borrowedKey.error?.code === "idempotency_key_in_use" && !borrowedKey.data,
     `got ${borrowedKey.status} ${borrowedKey.error?.code ?? ""}`);

  const added = [];
  for (let i = 0; i < 6; i++) {
    added.push(await call("POST", "/v1/me/emergency-contacts", {
      token: otherToken, body: { name: `Contact ${i}`, msisdn: `+91910000000${i}` },
    }));
  }
  ok("at most five emergency contacts, so an SOS cannot be an SMS pump",
     added.slice(0, 5).every((r) => r.status === 201) && added[5].status === 409 && added[5].error?.code === "too_many_contacts",
     added.map((r) => r.status).join(","));
  const dupe = await call("POST", "/v1/me/emergency-contacts", {
    token: otherToken, body: { name: "Again", msisdn: "+919100000000" },
  });
  ok("a contact's number is listed once", dupe.status === 409 && dupe.error?.code === "contact_exists", `got ${dupe.status}`);

  const relay = await call("POST", "/v1/notify/email", {
    token: adminToken, body: { to: "someone@example.com", subject: "hello", body: "hi" },
  });
  ok("operator email goes only to the platform's own recipients",
     relay.status === 403 && relay.error?.code === "recipient_not_allowed", `got ${relay.status} ${relay.error?.code ?? ""}`);
}

// ── 26. location services (routes/geo.ts) ─────────────────────────────────
// The providers are donated public services, so a test run must never call
// them: GEO_SERVICES is off in development, test and CI, and these check the
// gate around the lookups rather than the lookups themselves (those are
// unit-tested against recorded responses in apps/api/test/geo.test.ts).
console.log("\n26. Location services");
{
  const anon = await call("GET", "/v1/geo/address?lat=28.46&lng=77.03");
  ok("an address lookup needs a signed-in caller", anon.status === 401, `got ${anon.status}`);
  const abroad = await call("GET", "/v1/geo/nearby?lat=51.5&lng=-0.12", { token });
  ok("a point outside India is refused, not sent to a provider",
     abroad.status === 400 && abroad.error?.code === "outside_region", `got ${abroad.status} ${abroad.error?.code ?? ""}`);
  const off = await Promise.all([
    call("GET", "/v1/geo/address?lat=28.46&lng=77.03", { token }),
    call("GET", "/v1/geo/nearby?lat=28.46&lng=77.03", { token }),
    call("GET", "/v1/geo/route?fromLat=28.46&fromLng=77.03&toLat=28.61&toLng=77.21", { token }),
    call("GET", "/v1/geo/earthquakes", { token }),
  ]);
  ok("with GEO_SERVICES off every lookup says so instead of inventing a place",
     off.every((r) => r.status === 503 && r.error?.code === "geo_disabled"),
     off.map((r) => `${r.status} ${r.error?.code ?? ""}`).join(", "));
  const bad = await call("GET", "/v1/geo/address?lat=north&lng=77.03", { token });
  ok("a malformed coordinate is a 400", bad.status === 400, `got ${bad.status}`);
}

// ── 27. an SOS cannot borrow somebody else's vehicle (routes/emergency.ts) ──
// Any vehicleId used to be linked unchecked, so a responder and the incident
// record could point at another owner's car. A foreign one is dropped as a
// LINK, never as an emergency: the SOS is still raised, the response says the
// vehicle was not linked, and the stored row carries no vehicle at all.
console.log("\n27. SOS vehicle link");
{
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
  try {
    const theirs = await call("POST", "/v1/vehicles", {
      token: otherToken,
      body: { registrationNo: "FV" + Math.floor(Math.random() * 8999 + 1000) + "ZZ", vehicleClass: "car" },
    });
    ok("another account owns a vehicle to borrow", theirs.status === 201, `got ${theirs.status}`);

    const borrowed = await call("POST", "/v1/sos", {
      token, body: { lat: 28.46, lng: 77.03, source: "manual", vehicleId: theirs.data?.id },
    });
    ok("an SOS naming someone else's vehicle is still raised", borrowed.status === 201, `got ${borrowed.status}`);
    ok("…and the response says the vehicle was not linked", borrowed.meta?.vehicle?.linked === false,
       JSON.stringify(borrowed.meta?.vehicle ?? null));
    const own = await call("POST", "/v1/sos", {
      token, body: { lat: 28.46, lng: 77.03, source: "manual", vehicleId },
    });
    ok("the caller's own vehicle links without a warning", own.status === 201 && own.meta?.vehicle === undefined,
       `got ${own.status} ${JSON.stringify(own.meta?.vehicle ?? null)}`);

    const rows = await sql`
      SELECT id, vehicle_id FROM incidents WHERE id IN (${borrowed.data?.id ?? null}, ${own.data?.id ?? null})`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.vehicle_id]));
    ok("the stored incident carries no vehicle, not the borrowed one",
       borrowed.data?.id in byId && byId[borrowed.data.id] === null, `vehicle_id=${byId[borrowed.data?.id]}`);
    ok("while an SOS on the caller's own vehicle keeps it", byId[own.data?.id] === vehicleId,
       `vehicle_id=${byId[own.data?.id]}`);

    for (const r of [borrowed, own]) {
      if (r.data?.id) await call("POST", `/v1/sos/${r.data.id}/resolve`, { token, body: { outcome: "false_alarm" } });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── 28. dismissing a RAKSHA false positive (ADR-0011) ─────────────────────
// A model-raised incident has no owner, so no owner's cancel reaches it and it
// sat in the review queue for ever. An authority may now dismiss it, with a
// reason that lands in the audit chain; nobody else may, and never an incident
// that has an owner.
console.log("\n28. Dismissing a false positive");
{
  const fpTag = Math.random().toString(36).slice(2, 8);
  const fp = await call("POST", "/v1/raksha/detections", {
    token: deviceToken, body: { detections: [
      { opId: `e2e-${fpTag}-fp`, type: "obstruction", confidence: 0.9, severity: 5,
        lat: 28.301, lng: 76.901, capturedAt: new Date().toISOString(), modelVersion: "sim-rules-0.1.0" },
    ] },
  });
  const fpId = fp.data?.results?.[0]?.incidentId;
  ok("a device sighting raises an ownerless incident to review", Boolean(fpId), fp.data?.results?.[0]?.status);

  const queue = await call("GET", "/v1/raksha/incidents/review-queue?limit=200", { token: adminToken });
  ok("the review queue marks it as dismissable",
     queue.data?.find((i) => i.id === fpId)?.dismissable === true, JSON.stringify(queue.data?.find((i) => i.id === fpId)?.dismissable));

  const byCitizen = await call("POST", `/v1/raksha/incidents/${fpId}/dismiss`, {
    token, body: { reason: "looks like a shadow to me" },
  });
  ok("a citizen cannot dismiss an incident", byCitizen.status === 403, `got ${byCitizen.status}`);
  const noReason = await call("POST", `/v1/raksha/incidents/${fpId}/dismiss`, { token: adminToken, body: {} });
  ok("a dismissal without a reason is refused", noReason.status === 400, `got ${noReason.status}`);

  const REASON = "Camera frame shows a parked lorry on the shoulder, lane clear";
  const dismissed = await call("POST", `/v1/raksha/incidents/${fpId}/dismiss`, {
    token: adminToken, body: { reason: REASON },
  });
  ok("an authority dismisses it as a false positive",
     dismissed.status === 200 && dismissed.data?.status === "CANCELLED", `got ${dismissed.status} ${dismissed.data?.status}`);
  ok("…and the response says it was audited", dismissed.meta?.audited === true, dismissed.meta?.note);

  const after = await call("GET", "/v1/raksha/incidents/review-queue?limit=200", { token: adminToken });
  ok("it leaves the review queue", after.status === 200 && !after.data?.some((i) => i.id === fpId),
     `${after.meta?.awaitingReview} still waiting`);
  const trail = await call("GET", "/v1/admin/audit?limit=20", { token: adminToken });
  const entry = trail.data?.find((r) => r.action === "incident.dismissed" && r.entityId === fpId);
  ok("the audit chain holds who dismissed it and why",
     entry?.after?.reason === REASON && entry?.actorRole === "admin", entry ? entry.after?.reason : "no entry");
  ok("and the chain still verifies end to end with it", trail.meta?.integrity?.ok === true &&
     trail.meta.integrity.verified?.count === trail.meta.integrity.total,
     `${trail.meta?.integrity?.verified?.count} of ${trail.meta?.integrity?.total}`);

  const again = await call("POST", `/v1/raksha/incidents/${fpId}/dismiss`, { token: adminToken, body: { reason: REASON } });
  ok("a dismissed incident cannot be dismissed twice", again.status === 409, `got ${again.status} ${again.error?.code ?? ""}`);

  const owned = await call("POST", "/v1/sos", {
    token, body: { lat: 28.46, lng: 77.03, source: "crash_model", modelConfidence: 0.95 },
  });
  const ownedTry = await call("POST", `/v1/raksha/incidents/${owned.data?.id}/dismiss`, {
    token: adminToken, body: { reason: "operator thinks it is a false alarm" },
  });
  ok("an incident with an owner is never dismissed from the dashboard",
     ownedTry.status === 409 && ownedTry.error?.code === "not_dismissable", `got ${ownedTry.status} ${ownedTry.error?.code ?? ""}`);
  if (owned.data?.id) await call("POST", `/v1/sos/${owned.data.id}/cancel`, { token });
}

// ── 29. hazard photos in the database (ADR-0013) ──────────────────────────
// The hosted demo's disk is wiped on every redeploy, so a PHOTO_STORE=db server
// keeps report photos in raksha_photos, capped at 600 KiB. Runs only against a
// server started with PHOTO_STORE=db (CI's is); a disk server skips it, saying so.
console.log("\n29. Hazard photos in the database");
{
  const { randomBytes } = await import("node:crypto");
  const pm = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
  const pReq = await call("POST", "/v1/auth/otp/request", { body: { msisdn: pm } });
  const pVer = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: pm, code: pReq.meta?.devOtp } });
  const pToken = pVer.data?.accessToken;
  const CAP = 600 * 1024;
  const report = (bytes) => call("POST", "/v1/raksha/report", {
    token: pToken, body: { type: "pothole", severity: 2, lat: 28.452, lng: 77.061,
      photoBase64: bytes.toString("base64"), photoMime: "image/jpeg" },
  });
  // Random bytes, not a real JPEG: nothing compresses them, and any byte the
  // round trip changed would show.
  const photo = randomBytes(150_000);
  const first = await report(photo);
  if (first.meta?.photoStore !== "db") {
    console.log(`  - skipped: this server keeps photos on ${first.meta?.photoStore ?? "an unknown store"} ` +
      `(status ${first.status}); start it with PHOTO_STORE=db to run this section`);
    // Reclaim the probe's photo from that disk.
    if (first.data?.id) await call("POST", `/v1/raksha/detections/${first.data.id}/verify`, { token: adminToken, body: { action: "reject" } });
  } else {
    ok("a report's photo is accepted into the database store", first.status === 201 && first.data?.hasPhoto === true,
       `got ${first.status}`);
    const url = `${BASE}/v1/raksha/detections/${first.data.id}/photo`;
    const back = await fetch(url, { headers: { authorization: `Bearer ${pToken}` } });
    const got = Buffer.from(await back.arrayBuffer());
    ok("it is served back byte-identical, with its type",
       back.status === 200 && got.equals(photo) && back.headers.get("content-type") === "image/jpeg",
       `${back.status} ${got.length} bytes ${back.headers.get("content-type")}`);
    const stranger = await fetch(url, { headers: { authorization: `Bearer ${otherToken}` } });
    ok("another citizen still cannot fetch it", stranger.status === 403, `got ${stranger.status}`);

    const atCap = await report(randomBytes(CAP));
    ok("a photo of exactly 600 KiB is accepted", atCap.status === 201, `got ${atCap.status} ${atCap.error?.code ?? ""}`);
    const before = await call("GET", "/v1/me/reports", { token: pToken });
    const over = await report(randomBytes(CAP + 1));
    ok("one byte over is refused with 413 photo_too_large",
       over.status === 413 && over.error?.code === "photo_too_large" && over.error?.maxBytes === CAP,
       `got ${over.status} ${over.error?.code ?? ""}`);
    const after = await call("GET", "/v1/me/reports", { token: pToken });
    ok("…and the refused photo created no report", after.meta?.count === before.meta?.count,
       `${before.meta?.count} → ${after.meta?.count}`);

    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL ??
      "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
    try {
      const [row] = await sql`
        SELECT octet_length(p.bytes)::int AS n, d.image_ref FROM raksha_photos p
          JOIN raksha_detections d ON d.id = p.detection_id WHERE p.detection_id = ${first.data.id}`;
      ok("the bytes are in raksha_photos and the row points there, not at a file",
         row?.n === photo.length && /^db:hazards\//.test(row?.image_ref ?? ""), `${row?.n} bytes, ref ${row?.image_ref}`);

      const rejected = await call("POST", `/v1/raksha/detections/${first.data.id}/verify`, {
        token: adminToken, body: { action: "reject" },
      });
      const gone = await fetch(url, { headers: { authorization: `Bearer ${pToken}` } });
      const [{ n: left }] = await sql`SELECT count(*)::int AS n FROM raksha_photos WHERE detection_id = ${first.data.id}`;
      ok("rejecting the report deletes its photo row", rejected.data?.status === "REJECTED" && gone.status === 404 && left === 0,
         `${rejected.data?.status}, photo ${gone.status}, ${left} rows left`);
      await call("POST", `/v1/raksha/detections/${atCap.data?.id}/verify`, { token: adminToken, body: { action: "reject" } });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

// ── 30. an SOS with no GPS fix (routes/emergency.ts) ──────────────────────
// Both clients used to send a fixed demo point when the phone had no fix, so
// a responder could be sent to Gurugram from anywhere in India. An SOS with no
// fix is now raised without a position, and it must say so: dropping the
// fields by accident is still a validation error.
console.log("\n30. SOS with no GPS fix");
{
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
  try {
    const forgot = await call("POST", "/v1/sos", { token, body: { source: "manual" } });
    ok("an SOS that simply omits the position is refused", forgot.status === 400, `got ${forgot.status}`);
    const both = await call("POST", "/v1/sos", {
      token, body: { lat: 28.46, lng: 77.03, locationUnknown: true, source: "manual" },
    });
    ok("a position and 'location unknown' together are refused", both.status === 400, `got ${both.status}`);
    const half = await call("POST", "/v1/sos", { token, body: { lat: 28.46, source: "manual" } });
    ok("half a position is refused", half.status === 400, `got ${half.status}`);

    const unknown = await call("POST", "/v1/sos", { token, body: { locationUnknown: true, source: "manual" } });
    ok("an SOS with no fix is still raised", unknown.status === 201 && unknown.data?.status === "CONFIRMED",
       `got ${unknown.status} ${unknown.data?.status}`);
    ok("…and the response says the location is unknown", unknown.data?.locationKnown === false,
       `locationKnown=${unknown.data?.locationKnown}`);
    const [row] = await sql`SELECT location IS NULL AS empty FROM incidents WHERE id = ${unknown.data?.id ?? null}`;
    ok("the stored incident has no position rather than a made-up one", row?.empty === true,
       `location null=${row?.empty}`);
    const located = await call("POST", "/v1/sos", { token, body: { lat: 28.46, lng: 77.03, source: "manual" } });
    ok("an SOS with a fix still says it is located", located.status === 201 && located.data?.locationKnown === true,
       `got ${located.status} ${located.data?.locationKnown}`);

    for (const r of [unknown, located]) {
      if (r.data?.id) await call("POST", `/v1/sos/${r.data.id}/resolve`, { token, body: { outcome: "false_alarm" } });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── 31. RAKSHA: one sighting, one review ──────────────────────────────────
// A detection was unique only per device, so a second device re-sent the boot
// seed (and a rejection came back as a new incident); dismissing an incident
// left its detection open, and rejecting a detection left its incident queued.
// The review queue read "?overdueOnly=false" as true and counted its own page.
console.log("\n31. RAKSHA: one sighting, one review");
{
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
  try {
    const t = Math.random().toString(36).slice(2, 8);
    let n = 0;
    const det = (o = {}) => ({
      opId: `e2e-${t}-r${n++}`, type: "pothole", confidence: 0.81, severity: 3,
      lat: 28.444, lng: 77.015, capturedAt: new Date().toISOString(), modelVersion: "e2e-yolo", ...o,
    });
    const ingest = (tok, ...ds) => call("POST", "/v1/raksha/detections", { token: tok, body: { detections: ds } });
    const first = (r) => r.data?.results?.[0] ?? {};

    for (const [label, o] of [
      ["a null capturedAt", { capturedAt: null }], ["capturedAt: true", { capturedAt: true }],
      ["a capturedAt in year 9999", { capturedAt: "9999-01-01T00:00:00Z" }],
      ["a capturedAt without an offset", { capturedAt: "2026-10-07T09:30:00" }],
      ["a capturedAt 40 days old", { capturedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }],
      ["an empty modelVersion", { modelVersion: "" }],
    ]) {
      const r = await ingest(deviceToken, det(o));
      ok(`a detection with ${label} is refused`, r.status === 400, `got ${r.status}`);
    }
    for (const path of ["/v1/raksha/detections?limit=2.5", "/v1/raksha/incidents/review-queue?limit=1.5"]) {
      const r = await call("GET", path, { token: adminToken });
      ok(`a fractional limit is a 400, not a 500 (${path.split("?")[0]})`, r.status === 400, `got ${r.status}`);
    }

    const reg = await call("POST", "/v1/raksha/devices", {
      token: adminToken, body: { name: `E2E-EDGE-2 ${t} [SIMULATED]`, lat: 28.40, lng: 76.98 },
    });
    const dev2 = (await call("POST", "/v1/raksha/devices/token", {
      body: { deviceId: reg.data?.id, deviceSecret: reg.data?.deviceSecret },
    })).data?.accessToken;

    // One frame's detection, sent by this device and then by another, with the
    // other upload's own op id, position and clock - as the simulator re-sends
    // the boot seed.
    const frame = det({ imageRef: `e2e-${t}.jpg`, type: "road_damage", confidence: 0.777, severity: 4 });
    const s0 = (await call("GET", "/v1/raksha/stats")).data?.detections;
    const a = first(await ingest(deviceToken, frame));
    const b = first(await ingest(dev2, { ...frame, opId: `e2e-${t}-other`, lat: 28.39, lng: 76.96,
      capturedAt: new Date(Date.now() - 60_000).toISOString() }));
    const s1 = (await call("GET", "/v1/raksha/stats")).data?.detections;
    ok("one frame's detection sent by two devices is ingested once",
       a.status === "applied" && b.status === "duplicate", `${a.status} then ${b.status}`);
    ok("…so the corridor's count goes up by one, not two", s1 - s0 === 1, `${s0} → ${s1}`);

    const ob = det({ type: "obstruction", severity: 5, confidence: 0.93, lat: 28.33, lng: 76.93 });
    const raised = first(await ingest(deviceToken, ob));
    ok("a severe obstruction raises an incident to review", Boolean(raised.incidentId), raised.status);
    const rej = await call("POST", `/v1/raksha/detections/${raised.detectionId}/verify`, {
      token: adminToken, body: { action: "reject", notes: "e2e: a shadow across the lane" },
    });
    const [inc1] = await sql`SELECT status FROM incidents WHERE id = ${raised.incidentId ?? null}`;
    ok("rejecting the detection cancels the incident it alone raised",
       rej.status === 200 && rej.data?.cancelledIncidents?.includes(raised.incidentId) && inc1?.status === "CANCELLED",
       `${rej.status} ${inc1?.status}`);
    const replay = first(await ingest(dev2, ob));
    ok("a rejected detection re-sent by another device stays rejected and raises nothing",
       replay.status === "duplicate" && !replay.incidentId, JSON.stringify(replay));

    const ob2 = det({ type: "obstruction", severity: 5, confidence: 0.91, lat: 28.36, lng: 76.91 });
    const r2 = first(await ingest(deviceToken, ob2));
    const dis = await call("POST", `/v1/raksha/incidents/${r2.incidentId}/dismiss`, {
      token: adminToken, body: { reason: "e2e: parked lorry on the shoulder" },
    });
    const [d2] = await sql`SELECT status FROM raksha_detections WHERE id = ${r2.detectionId ?? null}`;
    ok("dismissing an incident rejects the detection behind it",
       dis.status === 200 && d2?.status === "REJECTED" && dis.data?.rejectedDetections?.includes(r2.detectionId),
       `${dis.status} ${d2?.status}`);
    const seen = first(await ingest(deviceToken,
      det({ type: "obstruction", severity: 5, confidence: 0.9, lat: 28.3601, lng: 76.9101 })));
    const q0 = await call("GET", "/v1/raksha/incidents/review-queue?limit=200", { token: adminToken });
    ok("seeing the dismissed hazard again corroborates that incident instead of re-raising it",
       seen.incidentId === r2.incidentId && seen.incidentCorroborated === true &&
       !q0.data?.some((i) => i.id === r2.incidentId), JSON.stringify(seen));

    const pv = first(await ingest(deviceToken, det({ lat: 28.41, lng: 76.99 })));
    const v = await call("POST", `/v1/raksha/detections/${pv.detectionId}/verify`, { token: adminToken, body: { action: "verify" } });
    const c = await call("POST", `/v1/raksha/detections/${pv.detectionId}/close`, { token: adminToken });
    const trail = await call("GET", "/v1/admin/audit?limit=50", { token: adminToken });
    const has = (action, id) => Boolean(id) && trail.data?.some((r) => r.action === action && r.entityId === id);
    ok("verifying, closing and rejecting a detection are in the audit chain",
       v.status === 200 && c.status === 200 && has("detection.verified", pv.detectionId) &&
       has("detection.closed", pv.detectionId) && has("detection.rejected", raised.detectionId),
       `verify ${v.status} close ${c.status}`);
    ok("…as is the incident a rejection cancelled, and the chain still verifies",
       has("incident.dismissed", raised.incidentId) && trail.meta?.integrity?.ok === true);

    // Two fresh HIGH incidents, inside their 15-minute window.
    const f1 = first(await ingest(deviceToken, det({ type: "obstruction", severity: 4, confidence: 0.9, lat: 28.42, lng: 77.0 })));
    const f2 = first(await ingest(deviceToken, det({ type: "obstruction", severity: 4, confidence: 0.9, lat: 28.452, lng: 77.03 })));
    const all = await call("GET", "/v1/raksha/incidents/review-queue?limit=200", { token: adminToken });
    for (const flag of ["false", "0"]) {
      const r = await call("GET", `/v1/raksha/incidents/review-queue?overdueOnly=${flag}&limit=200`, { token: adminToken });
      ok(`overdueOnly=${flag} returns every waiting incident, not only the overdue ones`,
         r.status === 200 && r.data?.length === all.data?.length && r.data?.some((i) => i.id === f1.incidentId),
         `${r.status}: ${r.data?.length} of ${all.data?.length}`);
    }
    const only = await call("GET", "/v1/raksha/incidents/review-queue?overdueOnly=true&limit=200", { token: adminToken });
    ok("overdueOnly=true returns only overdue incidents",
       only.status === 200 && only.data?.every((i) => i.overdue) && !only.data?.some((i) => i.id === f1.incidentId));
    const one = await call("GET", "/v1/raksha/incidents/review-queue?limit=1", { token: adminToken });
    ok("the queue's totals count every waiting incident, not the page",
       one.data?.length === 1 && one.meta?.awaitingReview >= 2 &&
       one.meta?.awaitingReview === all.meta?.awaitingReview && one.meta?.overdue === all.meta?.overdue,
       `limit=1: ${one.meta?.awaitingReview}/${one.meta?.overdue}, all: ${all.meta?.awaitingReview}/${all.meta?.overdue}`);
    for (const r of [f1, f2]) {
      if (r.incidentId) {
        await call("POST", `/v1/raksha/incidents/${r.incidentId}/dismiss`, { token: adminToken, body: { reason: "e2e: test incident" } });
      }
    }

    const devBefore = (await call("GET", "/v1/raksha/stats")).data?.devices;
    await sql`UPDATE edge_devices SET status = 'RETIRED' WHERE id = ${reg.data?.id ?? null}`;
    const devAfter = (await call("GET", "/v1/raksha/stats")).data?.devices;
    ok("a retired device is not counted among the corridor's devices", devBefore - devAfter === 1,
       `${devBefore} → ${devAfter}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ── 40. Bookings, offers and sign-out: the API bug-hunt regressions ────────
// Each check here failed before its fix (revert-checked). The sections that
// need positions place seeded mechanics far out to sea through the database
// and put them back afterwards, so no other section's supply is touched.
console.log("\n40. Bookings, offers and sign-out (bug-hunt regressions)");
{
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist", { max: 1, onnotice: () => {} });
  const citizen = async () => {
    const n = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
    const r = await call("POST", "/v1/auth/otp/request", { body: { msisdn: n } });
    const v = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: n, code: r.meta?.devOtp } });
    const t = v.data?.accessToken;
    const veh = await call("POST", "/v1/vehicles", {
      token: t, body: { registrationNo: "BH" + Math.floor(1000 + Math.random() * 8999) + Math.random().toString(36).slice(2, 5).toUpperCase(), vehicleClass: "car" },
    });
    return { token: t, refresh: v.data?.refreshToken, userId: v.data?.user?.id, vehicleId: veh.data?.id };
  };
  const book = async (c, lat, lng) => (await call("POST", "/v1/bookings", {
    token: c.token, body: { vehicleId: c.vehicleId, serviceTypeCode: "battery_jumpstart", lat, lng },
  })).data?.id;
  try {
    // ── a customer who finishes their own job cannot rate it ──
    // The customer may still step a job through (the demo drives a simulated
    // mechanic that way), but a rating of work only the customer says happened
    // moved a real mechanic's score. The completion must be the mechanic's.
    const rc = await citizen();
    const rcId = await book(rc, 28.4595, 77.0266);
    const rcOffer = (await call("POST", `/v1/bookings/${rcId}/dispatch`, { token: rc.token, body: { radiusKm: 60, limit: 1 } }))
      .data?.offers?.[0];
    const rcAccept = await call("POST", `/v1/offers/${rcOffer?.id}/accept`, { token: rc.token });
    ok("the customer can accept (choose) an offered mechanic", rcAccept.status === 200,
       `got ${rcAccept.status} ${rcAccept.error?.code ?? ""}`);
    const rcMech = async () => (await call("GET", `/v1/mechanics/${rcOffer?.mechanicId}/reviews`, { token: rc.token }))
      .data?.mechanic;
    const rcJobs = async () => (await rcMech())?.jobsCompleted;
    const rcRatingBefore = (await rcMech())?.rating;
    const rcJobsBefore = await rcJobs();
    for (const command of ["mechanic.start_travel", "arrive", "work.start", "work.complete"]) {
      await call("POST", `/v1/bookings/${rcId}/transition`, { token: rc.token, body: { command } });
    }
    ok("a customer completing its own job does not add to the mechanic's record",
       typeof rcJobsBefore === "number" && (await rcJobs()) === rcJobsBefore, `${rcJobsBefore}`);
    const rcPaid = await call("POST", `/v1/bookings/${rcId}/pay`, { token: rc.token, body: { method: "upi" } });
    const rcReview = await call("POST", `/v1/bookings/${rcId}/review`, { token: rc.token, body: { rating: 1, comment: "never came" } });
    ok("…nor can it then rate that mechanic: only a completion the mechanic reported is reviewable",
       rcPaid.data?.status === "PAID" && rcReview.status === 409 && rcReview.error?.code === "completion_not_confirmed",
       `pay=${rcPaid.data?.status} review=${rcReview.status} ${rcReview.error?.code ?? ""}`);
    const rcRatingAfter = (await rcMech())?.rating;
    ok("…and the mechanic's rating is unchanged", typeof rcRatingBefore === "number" && rcRatingAfter === rcRatingBefore,
       `${rcRatingBefore} → ${rcRatingAfter}`);

    // ── a late cancel claims no fee it never records ──
    const lc = await citizen();
    const lcId = await book(lc, 28.4595, 77.0266);
    const lcOffer = (await call("POST", `/v1/bookings/${lcId}/dispatch`, { token: lc.token, body: { radiusKm: 60, limit: 1 } }))
      .data?.offers?.[0];
    await call("POST", `/v1/offers/${lcOffer?.id}/accept`, { token: opsToken });
    await call("POST", `/v1/bookings/${lcId}/transition`, { token: lc.token, body: { command: "mechanic.start_travel" } });
    const lcCancel = await call("POST", `/v1/bookings/${lcId}/transition`, { token: lc.token, body: { command: "cancel" } });
    const [lcInvoices] = await sql`SELECT count(*)::int AS n FROM invoices WHERE booking_id = ${lcId}`;
    ok("cancelling with a mechanic on the way says so, and claims no fee the platform never records",
       lcCancel.data?.status === "CANCELLED" && lcCancel.data?.lateCancellation === true &&
         !("cancellationFee" in (lcCancel.data ?? {})) && lcInvoices?.n === 0,
       `lateCancellation=${lcCancel.data?.lateCancellation} cancellationFee=${lcCancel.data?.cancellationFee} invoices=${lcInvoices?.n}`);

    // ── the ladder keeps the radius the customer chose ──
    // Escalation used to search the server default (25 km) whatever the
    // customer had widened to, and then told them "every provider in range has
    // been asked" with a free mechanic inside their radius.
    const sea = { lat: 13.0, lng: 62.0 };   // open sea: nothing seeded within 300 km
    const pair = await sql`
      SELECT m.id, ST_Y(m.last_location) AS lat, ST_X(m.last_location) AS lng, m.is_available
        FROM mechanics m
       WHERE m.verified AND m.deleted_at IS NULL AND m.last_location IS NOT NULL
         AND NOT ST_DWithin(m.last_location::geography, ST_SetSRID(ST_MakePoint(77.0266, 28.4595), 4326)::geography, 150000)
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.mechanic_id = m.id
                          AND b.status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS','ESCALATED'))
       ORDER BY m.id LIMIT 2`;
    try {
      // ~30 km north and ~40 km south of the booking.
      await sql`UPDATE mechanics SET is_available = true,
                  last_location = ST_SetSRID(ST_MakePoint(${sea.lng}, ${sea.lat + 0.27}), 4326) WHERE id = ${pair[0].id}`;
      await sql`UPDATE mechanics SET is_available = true,
                  last_location = ST_SetSRID(ST_MakePoint(${sea.lng}, ${sea.lat - 0.36}), 4326) WHERE id = ${pair[1].id}`;
      const rd = await citizen();
      const rdId = await book(rd, sea.lat, sea.lng);
      const rdFirst = (await call("POST", `/v1/bookings/${rdId}/dispatch`, { token: rd.token, body: { radiusKm: 50, limit: 1 } }))
        .data?.offers?.[0];
      const rdDecline = await call("POST", `/v1/offers/${rdFirst?.id}/decline`, { token: opsToken });
      const [rdNext] = await sql`SELECT mechanic_id FROM dispatch_offers WHERE booking_id = ${rdId} AND status = 'SENT'`;
      ok("after a decline, the next wave searches the customer's own 50 km, not the 25 km default",
         rdDecline.meta?.escalated === true && rdNext?.mechanic_id && rdNext.mechanic_id !== rdFirst?.mechanicId &&
           /50 km/.test(rdDecline.meta?.note ?? ""),
         `${rdDecline.meta?.outcome}: ${rdDecline.meta?.note}`);
      await call("POST", `/v1/bookings/${rdId}/transition`, { token: rd.token, body: { command: "cancel" } });
    } finally {
      for (const m of pair) {
        await sql`UPDATE mechanics SET is_available = ${m.is_available},
                    last_location = ST_SetSRID(ST_MakePoint(${m.lng}, ${m.lat}), 4326) WHERE id = ${m.id}`;
      }
    }

    // ── a live stream ends with the sign-in that opened it ──
    const st = await citizen();
    const ctrl = new AbortController();
    const res = await fetch(BASE + "/v1/events", { headers: { authorization: `Bearer ${st.token}` }, signal: ctrl.signal });
    const reader = res.body.getReader();
    let got = "";
    const ended = (async () => {
      const dec = new TextDecoder();
      try { for (;;) { const { value, done } = await reader.read(); if (done) return true; got += dec.decode(value); } }
      catch { return false; }
    })();
    await new Promise((r) => setTimeout(r, 300));
    await call("POST", "/v1/auth/logout", { token: st.token });
    const closed = await Promise.race([ended, new Promise((r) => setTimeout(() => r("open"), 4000))]);
    ctrl.abort();
    ok("signing out ends the live event stream opened under that session",
       closed === true && /stream\.closed/.test(got) && /signed_out/.test(got), `stream: ${closed}`);

    // ── a command named after an Object.prototype property ──
    const pc = await citizen();
    const pcId = await book(pc, 28.4595, 77.0266);
    const proto = [];
    for (const command of ["toString", "constructor", "__proto__"]) {
      proto.push((await call("POST", `/v1/bookings/${pcId}/transition`, { token: pc.token, body: { command } })).status);
    }
    const pcAfter = await call("GET", `/v1/bookings/${pcId}`, { token: pc.token });
    ok("\"toString\", \"constructor\" and \"__proto__\" are refused as unknown commands, not a 500",
       proto.every((s) => s === 400) && pcAfter.data?.status === "REQUESTED", `${proto.join(",")} → ${pcAfter.data?.status}`);
    await call("POST", `/v1/bookings/${pcId}/transition`, { token: pc.token, body: { command: "cancel" } });

    // ── who confirmed an emergency nobody owns ──
    // An admin confirming an ownerless RAKSHA signal was recorded as "user".
    const [orphan] = await sql`
      INSERT INTO incidents (status, severity, detected_by_model, model_confidence)
      VALUES ('AWAITING_CONFIRMATION', 'HIGH', true, 0.8) RETURNING id`;
    const orphanConfirm = await call("POST", `/v1/sos/${orphan.id}/confirm`, { token: opsToken });
    const [orphanRow] = await sql`SELECT confirmed_by FROM incidents WHERE id = ${orphan.id}`;
    const [orphanAudit] = await sql`SELECT actor_role FROM audit_log WHERE entity_id = ${orphan.id} AND action = 'sos.escalated'`;
    ok("an operator's confirmation is recorded as the operator's, not the user's",
       orphanConfirm.status === 200 && orphanRow?.confirmed_by === "admin" && orphanAudit?.actor_role === "admin",
       `confirmed_by=${orphanRow?.confirmed_by} audit=${orphanAudit?.actor_role}`);
    await call("POST", `/v1/sos/${orphan.id}/resolve`, { token: opsToken, body: { outcome: "false_alarm" } });

    // ── a device token is not a citizen ──
    const asDevice = await call("GET", "/v1/me", { token: deviceToken });
    const deviceSos = await call("POST", "/v1/sos", { token: deviceToken, body: { lat: 28.45, lng: 77.02, source: "manual" } });
    ok("a RAKSHA device token is refused on citizen routes",
       asDevice.status === 403 && deviceSos.status === 403 && asDevice.error?.code === "device_token_not_allowed",
       `me=${asDevice.status} sos=${deviceSos.status}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

console.log(`\n${"─".repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(58)}\n`);
process.exit(fail ? 1 : 0);
