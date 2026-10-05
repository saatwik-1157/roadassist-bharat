/* RoadAssist — India's emergency numbers, and the two things a page can do
 * with them when there is no data connection: open the dialler, and open the
 * messaging app with the user's position already typed.
 *
 * This is the web's single list. The Android client keeps its own copy in
 * mobile/app/src/main/java/in/roadassist/app/EmergencyNumbers.kt, and
 * apps/api/test/emergency-numbers.test.ts fails if the two lists disagree on
 * which numbers appear or in what order.
 *
 * Sources:
 *   112  — Emergency Response Support System (ERSS), Ministry of Home Affairs,
 *          https://112.gov.in. One number that integrates police (100), fire
 *          (101) and ambulance (102/108), which is why it is first.
 *   1033 — NHAI's 24x7 toll-free national-highway helpline (ambulance, route
 *          patrol and crane on NHAI stretches), https://ihmcl.co.in/?p=3491.
 *   102 / 108 — ambulance services run by each state; which one answers, and
 *          whether both do, varies by state.
 *   Other national helplines (checked 2026-10-05), listed after the six above
 *   under their own subheading:
 *   181  — Women Helpline, Ministry of Women & Child Development (MWCD), 24x7.
 *   1098 — Childline, for children in distress, 24x7.
 *   14567 — Elderline, Ministry of Social Justice & Empowerment (MoSJE),
 *          for senior citizens; operates 8 AM–8 PM all days.
 *
 * What the page can and cannot do, said once here so no copy oversells it:
 *   - A `tel:` link hands the number to the phone's dialler. A voice call can
 *     connect on a network too weak for data. The app only dials.
 *   - An `sms:` link opens the messaging app with a body filled in. The user
 *     picks the recipient and presses Send. The page sends nothing itself; the
 *     web platform gives it no way to.
 *
 * sms: URI form. RFC 5724 writes the body as `sms:?body=…`, which Android's
 * messaging apps honour. iOS Messages has historically wanted `sms:&body=…`
 * and ignored a `?` body, so on an iPhone, iPod or iPad (including an iPad
 * that reports itself as a Mac, told apart by its touch points) the `&` form
 * is used. The recipient is left empty on purpose: the user chooses who to text.
 *
 * A classic script (no import/export), like photo-shrink.js, so app.html loads
 * it with a plain <script src> and the test imports the same file. It only
 * defines globalThis.RAEmergency.
 */
(function (global) {
  "use strict";

  /** Number, id, English label. Order is display order; 112 is primary. */
  var NUMBERS = [
    { number: "112", id: "all", label: "All emergencies (police, fire, ambulance)", primary: true },
    { number: "1033", id: "highway", label: "National highway helpline (NHAI)", primary: false },
    { number: "108", id: "ambulance", label: "Ambulance (most states)", primary: false },
    { number: "102", id: "ambulance_alt", label: "Ambulance (some states)", primary: false },
    { number: "100", id: "police", label: "Police", primary: false },
    { number: "101", id: "fire", label: "Fire", primary: false },
    { number: "181", id: "women", label: "Women Helpline (24×7)", primary: false },
    { number: "1098", id: "child", label: "Childline — children in distress (24×7)", primary: false },
    { number: "14567", id: "elder", label: "Elderline — senior citizens (8 AM–8 PM)", primary: false },
  ];

  /**
   * The entries shown under "Other national helplines", after the emergency
   * numbers. They are the tail of NUMBERS, so display order is still NUMBERS
   * order. EmergencyNumbers.kt keeps the same set (HELPLINE_IDS) and the test
   * holds the two against each other.
   */
  var HELPLINE_IDS = ["women", "child", "elder"];
  var HELPLINES_HEADING = "Other national helplines";

  function isHelpline(n) { return HELPLINE_IDS.indexOf(n.id) !== -1; }

  /** The off-grid emergency types (app.html OFFGRID_TYPES), as words in a text. */
  var TYPE_WORDS = {
    breakdown: "breakdown", accident: "accident", medical: "medical",
    unsafe: "feeling unsafe", other: "other",
  };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function telHref(n) {
    return "tel:" + String(n).replace(/[^0-9]/g, "");
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  /** "1 Oct 2026, 10:32" in the phone's own time, or "" for no usable time. */
  function formatTime(at) {
    if (at == null || at === "") return "";
    var d = at instanceof Date ? at : new Date(at);
    if (isNaN(d.getTime())) return "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + ", " +
      pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  /**
   * A position, or null. Missing, non-numeric or out-of-range values are no
   * position, and so is 0,0 — the coordinate an unset field turns into. A
   * fallback point is never substituted: a made-up location in an emergency
   * text sends someone to the wrong place.
   */
  function fixOf(lat, lng, demo) {
    if (demo) return null;
    if (lat == null || lng == null || lat === "" || lng === "") return null;
    var a = Number(lat), b = Number(lng);
    if (!isFinite(a) || !isFinite(b)) return null;
    if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
    if (a === 0 && b === 0) return null;
    return { lat: a, lng: b };
  }

  /**
   * The text a person sends from their own phone. Plain GSM 03.38 characters
   * only (so "+/-", not a plus-minus sign, which would force UCS-2 and a
   * 70-character segment), and short enough for one 160-character SMS.
   */
  function smsBody(o) {
    o = o || {};
    var ref = String(o.ref || "").replace(/[^A-Za-z0-9-]/g, "");
    var what = TYPE_WORDS[o.type] || "emergency";
    var when = formatTime(o.at);
    var fix = fixOf(o.lat, o.lng, o.demo);
    var where;
    if (fix) {
      var acc = o.accuracyM == null || o.accuracyM === "" ? NaN : Number(o.accuracyM);
      where = "Location " + fix.lat.toFixed(5) + "," + fix.lng.toFixed(5);
      if (isFinite(acc) && acc >= 0) {
        where += acc >= 1000 ? " (+/-" + Math.round(acc / 1000) + " km)" : " (+/-" + Math.round(acc) + " m)";
      }
    } else {
      where = "Location unknown (no GPS fix)";
    }
    return (ref ? "SOS " + ref + ". " : "SOS. ") +
      "I need help: " + what + ". " +
      where + (when ? " at " + when : "") + ". " +
      "Sent by me. RoadAssist has not alerted anyone.";
  }

  function isIOS(ua, touchPoints) {
    ua = String(ua || "");
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(touchPoints) > 1);
  }

  /** sms: with no recipient. `ua`/`touchPoints` default to this browser's. */
  function smsHref(body, ua, touchPoints) {
    var nav = global.navigator || {};
    if (ua === undefined) ua = nav.userAgent;
    if (touchPoints === undefined) touchPoints = nav.maxTouchPoints;
    return "sms:" + (isIOS(ua, touchPoints) ? "&" : "?") + "body=" + encodeURIComponent(String(body));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── markup, so app.html only places it ─────────────────────────────── */

  function callHtml() {
    var p = NUMBERS[0];
    return "<a class='btn danger em-call' href='" + esc(telHref(p.number)) + "' data-em='" +
      esc(p.id) + "'>Call " + esc(p.number) + "</a>";
  }

  function itemHtml(n) {
    return "<li><a href='" + esc(telHref(n.number)) + "' data-em='" + esc(n.id) + "'>" +
      "<b class='num'>" + esc(n.number) + "</b><span>" + esc(n.label) + "</span></a></li>";
  }

  /** The numbers after 112, then the national helplines under their own subheading. */
  function listHtml() {
    var rest = NUMBERS.slice(1);
    var emergency = rest.filter(function (n) { return !isHelpline(n); });
    var helplines = rest.filter(isHelpline);
    return "<ul class='em-list' aria-label='Other emergency numbers'>" +
      emergency.map(itemHtml).join("") + "</ul>" +
      (helplines.length
        ? "<p class='em-sub'>" + esc(HELPLINES_HEADING) + "</p>" +
          "<ul class='em-list em-helplines' aria-label='" + esc(HELPLINES_HEADING) + "'>" +
          helplines.map(itemHtml).join("") + "</ul>"
        : "");
  }

  /** The "Text my location" link and the sentence that keeps it honest. */
  function textHtml(info, id) {
    return "<a class='btn ghost em-sms' id='" + esc(id || "em-sms") + "' href='" +
      esc(smsHref(smsBody(info))) + "'>Text my location</a>" +
      "<p class='hint em-note'>Opens your messaging app with your SOS reference, position and time " +
      "typed in. You choose who it goes to and press Send yourself — RoadAssist has not sent anything.</p>";
  }

  /** Call 112, the other numbers, and — given an incident — Text my location. */
  function panelHtml(info) {
    return "<div class='em-panel'>" + callHtml() + listHtml() + (info ? textHtml(info) : "") + "</div>";
  }

  global.RAEmergency = {
    NUMBERS: NUMBERS, HELPLINE_IDS: HELPLINE_IDS, HELPLINES_HEADING: HELPLINES_HEADING, TYPE_WORDS: TYPE_WORDS,
    telHref: telHref, smsBody: smsBody, smsHref: smsHref, isIOS: isIOS, formatTime: formatTime,
    callHtml: callHtml, listHtml: listHtml, textHtml: textHtml, panelHtml: panelHtml,
  };
})(globalThis);
