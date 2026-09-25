/* RoadAssist — what a booking or an emergency status MEANS to the citizen app.
 *
 * Pure functions over a status string: no DOM, no network, no storage. They
 * live outside app.html for one reason — so apps/api/test/journey.test.ts can
 * pin them. Every rule here answers a screen that disagreed with the server:
 * a PAID booking still marking "Payment" as the step happening now, a
 * mechanic's acceptance that never reached the person waiting for it, and an
 * escalated SOS its owner had no way to call off.
 *
 * A classic script (no import/export), so app.html can load it with a plain
 * <script src> ahead of its inline IIFE — which stays a classic script — and
 * Node can still import it for the tests; either way it lands on globalThis.
 */
(function (global) {
  "use strict";

  /** The happy path, in order. Anything else is off the standard journey. */
  var JOURNEY = ["REQUESTED", "MATCHING", "ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "COMPLETED", "PAID"];

  /**
   * One mark per journey step: "done", "now" or "todo" — or null for a status
   * that is not on the journey at all (NO_SUPPLY, CANCELLED, AWAITING_PARTS…).
   *
   * PAID is the one status that is an END rather than a stage. Treating it like
   * the others made "Payment" the step happening NOW on a booking that was
   * already settled, which reads as "you still owe money". Once paid, every
   * step is done and nothing is current.
   */
  function journeyMarks(status) {
    var at = JOURNEY.indexOf(status);
    if (at < 0) return null;
    var finished = status === "PAID";
    return JOURNEY.map(function (_s, i) {
      return i < at || finished ? "done" : i === at ? "now" : "todo";
    });
  }

  /** Before a mechanic is committed — the only states in which offers are live. */
  var PRE_ASSIGN = { REQUESTED: true, MATCHING: true, NO_SUPPLY: true };

  /**
   * What the citizen's screen should do when its own booking moves.
   *
   * `prev` is the last status the screen showed, or null when it has shown
   * none (a fresh load): a first sighting is not news, so nothing is announced
   * and nobody is moved between screens on the strength of it.
   *
   *   announce   — say it out loud (a toast): something happened since last look
   *   accepted   — a mechanic has just committed: close the offers, say who,
   *                and take the person to tracking
   *   offersLive — offers can still be accepted; otherwise any listed offer is
   *                stale, and an Accept tap would only earn a 409
   */
  function bookingChange(prev, next) {
    var moved = prev !== next;
    return {
      announce: moved && prev != null,
      accepted: moved && PRE_ASSIGN[prev] === true && !PRE_ASSIGN[next] && next !== "CANCELLED",
      offersLive: next === "REQUESTED" || next === "MATCHING",
    };
  }

  /**
   * The ways out of an emergency its owner may take, per the incident state
   * machine (apps/api/src/domain/incident-machine.ts):
   *
   *   cancel  — "false alarm". Legal from every open state; the server records
   *             it as a false positive.
   *   resolve — "I'm safe now". Only once someone stood behind the emergency
   *             (CONFIRMED or RESPONDING): an unconfirmed detection is not an
   *             emergency that was resolved, it is one that never was.
   *
   * RESOLVED and CANCELLED are terminal and offer nothing.
   */
  var CANCEL = { command: "cancel", path: "/cancel", label: "Cancel — false alarm", body: {} };
  var RESOLVE = { command: "resolve", path: "/resolve", label: "I'm safe now", body: { outcome: "self_resolved" } };
  var SOS_EXITS = {
    DETECTED: [CANCEL],
    AWAITING_CONFIRMATION: [CANCEL],
    CONFIRMED: [RESOLVE, CANCEL],
    RESPONDING: [RESOLVE, CANCEL],
  };

  function sosExits(status) { return (SOS_EXITS[status] || []).slice(); }
  function sosActive(status) { return sosExits(status).length > 0; }

  global.RAJourney = {
    JOURNEY: JOURNEY, journeyMarks: journeyMarks, bookingChange: bookingChange,
    sosExits: sosExits, sosActive: sosActive,
  };
})(globalThis);
