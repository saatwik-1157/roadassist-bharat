/* RoadAssist — what a booking or an emergency status MEANS to the citizen app.
 *
 * Pure functions over a status string: no DOM, no network, no storage. They
 * live outside app.html for one reason — so apps/api/test/journey.test.ts can
 * pin them. Every rule here answers a screen that disagreed with the server,
 * like a PAID booking still marking "Payment" as the step happening now.
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

  global.RAJourney = { JOURNEY: JOURNEY, journeyMarks: journeyMarks };
})(globalThis);
