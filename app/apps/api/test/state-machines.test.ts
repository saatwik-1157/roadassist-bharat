/**
 * The two state machines added in the hardening phase, and the error
 * vocabulary they raise.
 *
 * Both encode rules that used to live in prose. The point of the tests is not
 * that the tables are typed correctly — the compiler does that — but that the
 * *safety* properties hold: a model cannot summon an ambulance, a closed
 * emergency stays closed, and a provider committed to one customer cannot be
 * offered to another.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  allowedIncidentCommands, applyIncident, IllegalIncidentTransition,
  initialStatus, isIncidentTerminal, PUBLIC_STAGE, INCIDENT_STATUSES,
  type IncidentStatus,
} from "../src/domain/incident-machine.js";
import {
  deriveProviderState, describeProviderState, isOfferable, PROVIDER_STATES,
} from "../src/domain/provider-state.js";
import { ApiError, ERRORS, fail, type ErrorCode } from "../src/errors.js";
import { redact } from "../src/observability.js";

/* ── the emergency state machine ──────────────────────────────────────────── */

test("a manual SOS is already a human act; a model signal is not", () => {
  assert.equal(initialStatus(false), "CONFIRMED");
  assert.equal(initialStatus(true), "AWAITING_CONFIRMATION");
});

test("ADR-0005: a model-detected crash cannot reach RESPONDING without a human", () => {
  // The whole rule, as one assertion. There is no path out of
  // AWAITING_CONFIRMATION that summons help.
  assert.throws(
    () => applyIncident("AWAITING_CONFIRMATION", "escalate"),
    IllegalIncidentTransition,
    "a model signal must not be able to escalate itself",
  );
  // Only through a confirmation.
  const confirmed = applyIncident("AWAITING_CONFIRMATION", "confirm").to;
  assert.equal(confirmed, "CONFIRMED");
  assert.equal(applyIncident(confirmed, "escalate").to, "RESPONDING");
});

test("escalating twice is idempotent, not an error", () => {
  // An emergency retried on a bad connection must never be refused for having
  // already been tried.
  assert.equal(applyIncident("RESPONDING", "escalate").to, "RESPONDING");
});

test("a closed emergency stays closed", () => {
  for (const terminal of ["RESOLVED", "CANCELLED"] as const) {
    assert.ok(isIncidentTerminal(terminal));
    assert.equal(allowedIncidentCommands(terminal).length, 0);
    for (const cmd of ["confirm", "escalate", "resolve", "cancel"] as const) {
      assert.throws(() => applyIncident(terminal, cmd), IllegalIncidentTransition,
        `${terminal} must refuse "${cmd}"`);
    }
  }
});

test("an emergency can be resolved only once help is on record", () => {
  // Resolving something nobody ever confirmed would close a live signal.
  assert.throws(() => applyIncident("AWAITING_CONFIRMATION", "resolve"), IllegalIncidentTransition);
  assert.throws(() => applyIncident("DETECTED", "resolve"), IllegalIncidentTransition);
  assert.equal(applyIncident("CONFIRMED", "resolve").to, "RESOLVED");
  assert.equal(applyIncident("RESPONDING", "resolve").to, "RESOLVED");
});

test("a false alarm can be withdrawn from every live state", () => {
  for (const s of ["DETECTED", "AWAITING_CONFIRMATION", "CONFIRMED", "RESPONDING"] as const) {
    assert.equal(applyIncident(s, "cancel").to, "CANCELLED");
  }
});

test("the illegal-transition error tells the caller what IS allowed", () => {
  try {
    applyIncident("RESOLVED", "escalate");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof IllegalIncidentTransition);
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, "invalid_state");
    assert.match(err.message, /closed/i, "a dead end should say so, not list nothing");
  }
});

test("every stored status has a public stage name", () => {
  for (const s of INCIDENT_STATUSES) {
    assert.ok(PUBLIC_STAGE[s as IncidentStatus], `${s} has no public stage`);
  }
});

/* ── provider state ───────────────────────────────────────────────────────── */

test("a provider on a job is never offerable — the bug this was written for", () => {
  // `is_available` is a duty toggle: "I am working today", not "I am free now".
  // Dispatch filtered on it alone, so a mechanic mid-job kept getting offers.
  for (const status of ["ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "AWAITING_PARTS"]) {
    const state = deriveProviderState({ isAvailable: true, activeBookingStatus: status });
    assert.ok(!isOfferable(state),
      `a mechanic whose booking is ${status} must not be offerable (got ${state})`);
  }
});

test("a committed job outranks the duty toggle", () => {
  // Going off duty mid-drive does not abandon the customer waiting for you.
  assert.equal(
    deriveProviderState({ isAvailable: false, activeBookingStatus: "EN_ROUTE" }),
    "EN_ROUTE",
  );
});

test("off duty with nothing in hand is OFFLINE, and unreachable by dispatch", () => {
  const state = deriveProviderState({ isAvailable: false });
  assert.equal(state, "OFFLINE");
  assert.ok(!isOfferable(state));
});

test("holding an offer does not block another one", () => {
  // A live offer is not a commitment, and a marketplace where one blocks every
  // other leaves a stranded customer waiting on somebody who will not answer.
  const state = deriveProviderState({ isAvailable: true, liveOffers: 2 });
  assert.equal(state, "OFFERED");
  assert.ok(isOfferable(state), "an outstanding offer must not take a provider out of the pool");
});

test("free and on duty is the only fully available state", () => {
  assert.equal(deriveProviderState({ isAvailable: true, liveOffers: 0 }), "AVAILABLE");
  assert.ok(isOfferable("AVAILABLE"));
});

test("the booking states map onto exactly the right provider states", () => {
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "ASSIGNED" }), "BUSY");
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "EN_ROUTE" }), "EN_ROUTE");
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "ON_SITE" }), "ON_JOB");
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "IN_PROGRESS" }), "ON_JOB");
  // A finished or cancelled job frees the provider immediately.
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "COMPLETED" }), "AVAILABLE");
  assert.equal(deriveProviderState({ isAvailable: true, activeBookingStatus: "CANCELLED" }), "AVAILABLE");
});

test("every provider state has a label a customer can read", () => {
  for (const s of PROVIDER_STATES) {
    const label = describeProviderState(s);
    assert.ok(label && label.length > 3, `${s} has no readable label`);
    assert.ok(!/[_A-Z]{2,}/.test(label), `"${label}" is an enum, not a sentence`);
  }
});

/* ── the error vocabulary ─────────────────────────────────────────────────── */

test("every error code carries a status and an honest retryability", () => {
  for (const [code, spec] of Object.entries(ERRORS)) {
    assert.ok(spec.status >= 400 && spec.status < 600, `${code} has status ${spec.status}`);
    assert.equal(typeof spec.retryable, "boolean", `${code} must say whether a retry could work`);
    assert.ok(spec.title.length > 3, `${code} needs a title a person can read`);
  }
});

test("losing a race is not retryable; a transient failure is", () => {
  // This distinction is what the client's queue branches on.
  assert.equal(ERRORS.ALREADY_ASSIGNED.retryable, false);
  assert.equal(ERRORS.OFFER_EXPIRED.retryable, false);
  assert.equal(ERRORS.FORBIDDEN.retryable, false);
  assert.equal(ERRORS.CONFLICT.retryable, true);
  assert.equal(ERRORS.RATE_LIMITED.retryable, true);
  assert.equal(ERRORS.UNAVAILABLE.retryable, true);
});

test("an ApiError renders an envelope carrying the request id", () => {
  const err = fail("INCIDENT_NOT_FOUND");
  assert.equal(err.statusCode, 404);
  const body = err.envelope("req-123");
  assert.equal(body.error.code, "INCIDENT_NOT_FOUND");
  assert.equal(body.error.requestId, "req-123");
  assert.equal(body.error.retryable, false);
});

test("a custom title overrides the default without changing the contract", () => {
  const err = new ApiError("FORBIDDEN" as ErrorCode, { title: "That booking is not yours" });
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, "FORBIDDEN");
  assert.equal(err.message, "That booking is not yours");
});

/* ── log redaction ────────────────────────────────────────────────────────── */

test("logs never carry credentials, codes or coordinates", () => {
  const out = redact({
    bookingId: "b1",
    token: "eyJhbGci...", refreshToken: "r", authorization: "Bearer x",
    otp: "000000", code: "123456", signature: "deadbeef",
    msisdn: "+919876543210", email: "a@b.c",
    lat: 28.4595, lng: 77.0266,
    bloodGroup: "O+", allergies: "penicillin", symptoms: "car wont start",
  }) as Record<string, unknown>;

  assert.equal(out.bookingId, "b1", "identifiers must survive — they are the point");
  for (const field of ["token", "refreshToken", "authorization", "otp", "code", "signature",
                       "msisdn", "email", "lat", "lng", "bloodGroup", "allergies", "symptoms"]) {
    assert.equal(out[field], "[redacted]", `${field} must never reach a log`);
  }
});

test("redaction reaches nested payloads, where a whole row usually lands", () => {
  const out = redact({ op: "sos.escalate", incident: { id: "i1", lat: 1.2, lng: 3.4 } }) as
    { incident: Record<string, unknown> };
  assert.equal(out.incident.id, "i1");
  assert.equal(out.incident.lat, "[redacted]");
});

test("redaction terminates on deep or cyclic-looking structures", () => {
  let deep: Record<string, unknown> = { token: "x" };
  for (let i = 0; i < 12; i++) deep = { nested: deep };
  // Must not blow the stack; depth-limited by design.
  assert.doesNotThrow(() => redact(deep));
});
