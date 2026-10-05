/* RoadAssist — which position a booking is sent with, or why it is not sent.
 *
 * app.html's locate() always resolves, so a stranded person is never stuck on
 * a permission dialog: with no GPS fix it hands back the NH-48 demo point
 * marked demo:true. The booking flow used to post that point as if it were the
 * user's, so a real mechanic would have driven to Gurugram. The rule is now:
 *
 *   - a real fix          -> send it;
 *   - no fix, demo chosen -> send the demo point, labelled as the demo point,
 *                            only because the user pressed "Use the NH-48 demo
 *                            point (demo only)" for this booking;
 *   - no fix, no choice   -> do not send; say why and offer the two buttons.
 *
 * SOS does not use this: with no fix it is sent with locationUnknown instead,
 * because an emergency cannot wait for a choice.
 *
 * A classic script (no import/export), like photo-shrink.js, so app.html loads
 * it with a plain <script src> and apps/api/test/booking-position.test.ts can
 * import the same file; it only defines globalThis.RABookingPosition.
 */
(function (global) {
  "use strict";

  /** Must equal DEMO_POS in app.html (the test reads both). */
  var DEMO_POINT = { lat: 28.4595, lng: 77.0266 };
  /** Sent as the booking's highwayMarker so every screen and the DB show it. */
  var DEMO_MARKER = "NH-48, KM 212 (demo point)";
  var DEMO_NOTE = "A mechanic would be sent to NH-48, Gurugram — for the classroom demo only.";

  function num(v) { return typeof v === "number" && isFinite(v); }

  /** A position the phone actually measured, not the fallback. */
  function hasFix(pos) {
    return Boolean(pos && pos.demo !== true && num(pos.lat) && num(pos.lng));
  }

  /**
   * The decision. `demoChosen` must be exactly true: only the user's own press
   * of the demo-only button sets it.
   *   -> { send: true, lat, lng, demo: false }
   *   -> { send: true, lat, lng, demo: true, highwayMarker }
   *   -> { send: false, reason: "denied" | "timeout" | "unavailable" | "unsupported" | "unchecked" }
   */
  function decide(pos, demoChosen) {
    if (hasFix(pos)) return { send: true, lat: pos.lat, lng: pos.lng, demo: false };
    if (demoChosen === true) {
      return { send: true, lat: DEMO_POINT.lat, lng: DEMO_POINT.lng, demo: true, highwayMarker: DEMO_MARKER };
    }
    var reason = !pos ? "unchecked" : pos.denied ? "denied" : pos.reason || "unavailable";
    return { send: false, reason: reason };
  }

  /** What to tell the user, by reason. */
  function advice(reason) {
    if (reason === "denied") return "Location permission is off. Allow location in your browser and try again.";
    if (reason === "unsupported") return "This browser cannot share a location. Try another browser, then try again.";
    if (reason === "unchecked") return "Your location has not been checked yet. Press Check in step 3.";
    return "Couldn't get a GPS fix. Move to open sky and try again.";   // timeout, unavailable
  }

  /** "Try again", and the clearly secondary demo-only button with its note. */
  function choiceHtml() {
    return "<div class='b-nofix' style='margin-top:11px'>" +
      "<button type='button' class='btn auto sm' data-loc='retry'>Try again</button>" +
      "<button type='button' class='btn ghost auto sm' data-loc='demo' style='margin-top:8px'>" +
        "Use the NH-48 demo point (demo only)</button>" +
      "<small style='display:block;margin-top:6px;color:var(--text-3);font-size:11.5px'>" +
        DEMO_NOTE + "</small></div>";
  }

  /** The card shown under "Request assistance" when nothing was sent. */
  function notSentHtml(reason) {
    return "<div class='card' id='b-notsent' style='margin-top:13px'>" +
      "<h2 class='title'>Not sent: no location</h2>" +
      "<p class='meta' style='margin-top:6px'>" + advice(reason) + "</p>" + choiceHtml() + "</div>";
  }

  global.RABookingPosition = {
    DEMO_POINT: DEMO_POINT, DEMO_MARKER: DEMO_MARKER, DEMO_NOTE: DEMO_NOTE,
    hasFix: hasFix, decide: decide, advice: advice, choiceHtml: choiceHtml, notSentHtml: notSentHtml,
  };
})(globalThis);
