/**
 * Web i18n — the citizen app's language switch.
 *
 * ── the shape ─────────────────────────────────────────────────────────────
 * No framework, no build step, no dependency, matching the rest of these
 * surfaces. Static markup carries `data-i18n="key"` (or `data-i18n-attr` for a
 * placeholder or aria-label); anything built in JS calls `t(key)`.
 *
 * ── coverage, stated rather than implied ──────────────────────────────────
 * This does NOT translate the whole app, and it should not be described as if
 * it does. What is covered is what a person in trouble reads: the SOS control
 * and its states, the connectivity tiers that are the product's entire thesis,
 * sign-in, and the primary navigation. Long explanatory prose stays English.
 *
 * `coverage()` returns the real numbers — translated elements over total text
 * elements — so the gap is a measurement rather than a claim. Anything the
 * catalogue does not cover simply stays as authored, which is why a partial
 * pass degrades into "some English" rather than into blank space.
 *
 * ── choosing ──────────────────────────────────────────────────────────────
 * An explicit choice is remembered in localStorage and always wins. Otherwise
 * the browser's own language is honoured — a phone set to Hindi should not have
 * to be told twice — and English is the floor. Matching the server's rule in
 * apps/api/src/i18n.ts, and matching it deliberately: a user who texted LANG HI
 * and then opens the web app should not find it in English.
 */
(function (global) {
  "use strict";

  var LOCALES = ["en", "hi"];
  var DEFAULT = "en";
  var STORAGE_KEY = "ra.locale";

  var MESSAGES = {
    en: {
      // ── the SOS control ──────────────────────────────────────────────
      "sos.label": "SOS",
      "sos.hold": "hold 1.5s",
      "sos.aria": "Hold to send an emergency SOS",
      "sos.sending": "sending…",
      "sos.cancel": "Cancel",
      "sos.ready": "Emergency readiness",

      // ── connectivity: the product's whole argument ───────────────────
      "net.online": "Online",
      "net.limited": "Limited connection",
      "net.offline": "Off-grid",
      "net.offline.detail": "No signal. An SOS is stored on this device with its own reference and sent the moment connectivity returns.",
      "net.limited.detail": "Weak connection. Emergency actions still work; payment is held until you are back online.",
      "net.syncing": "Syncing…",
      "net.synced": "Synced",

      // ── sign-in ──────────────────────────────────────────────────────
      "auth.title": "Sign in with your phone.",
      "auth.msisdn": "Mobile number",
      "auth.send": "Send code",
      "auth.code": "6-digit code",
      "auth.verify": "Verify & continue",
      "auth.restoring": "Restoring your session…",

      // ── primary navigation ───────────────────────────────────────────
      "nav.home": "Home",
      "nav.bookings": "Bookings",
      "nav.vehicles": "Vehicles",
      "nav.more": "More",
      "nav.map": "Map",

      // ── the booking verbs a user actually presses ────────────────────
      "action.book": "Book help",
      "action.cancel": "Cancel",
      "action.pay": "Pay",
      "action.track": "Track",
      "action.retry": "Try again",

      "lang.name": "English",
      "lang.switch": "भाषा: हिंदी",
    },
    hi: {
      "sos.label": "SOS",
      "sos.hold": "1.5 सेकंड दबाए रखें",
      "sos.aria": "आपात SOS भेजने के लिए दबाए रखें",
      "sos.sending": "भेजा जा रहा है…",
      "sos.cancel": "रद्द करें",
      "sos.ready": "आपात तैयारी",

      "net.online": "ऑनलाइन",
      "net.limited": "कमज़ोर कनेक्शन",
      "net.offline": "ऑफ़-ग्रिड",
      "net.offline.detail": "सिग्नल नहीं है। SOS इसी फ़ोन में अपने नंबर के साथ सेव है और कनेक्शन आते ही चला जाएगा।",
      "net.limited.detail": "कनेक्शन कमज़ोर है। आपात सुविधाएँ चालू हैं; भुगतान ऑनलाइन होने तक रुका रहेगा।",
      "net.syncing": "सिंक हो रहा है…",
      "net.synced": "सिंक हो गया",

      "auth.title": "अपने फ़ोन से साइन इन करें।",
      "auth.msisdn": "मोबाइल नंबर",
      "auth.send": "कोड भेजें",
      "auth.code": "6 अंकों का कोड",
      "auth.verify": "जाँचें और आगे बढ़ें",
      "auth.restoring": "आपका सत्र वापस लाया जा रहा है…",

      "nav.home": "होम",
      "nav.bookings": "बुकिंग",
      "nav.vehicles": "वाहन",
      "nav.more": "और",
      "nav.map": "नक्शा",

      "action.book": "मदद बुक करें",
      "action.cancel": "रद्द करें",
      "action.pay": "भुगतान",
      "action.track": "ट्रैक करें",
      "action.retry": "फिर कोशिश करें",

      "lang.name": "हिंदी",
      "lang.switch": "Language: English",
    },
  };

  function supported(value) {
    return LOCALES.indexOf(value) !== -1 ? value : null;
  }

  function stored() {
    // Private windows and blocked site data both throw here; a language
    // preference is never worth breaking the page over.
    try {
      return supported(global.localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function fromBrowser() {
    var list = (global.navigator && (navigator.languages || [navigator.language])) || [];
    for (var i = 0; i < list.length; i++) {
      var base = String(list[i] || "").toLowerCase().split("-")[0];
      if (supported(base)) return base;
    }
    return null;
  }

  var current = stored() || fromBrowser() || DEFAULT;

  function t(key, fallback) {
    var table = MESSAGES[current] || MESSAGES[DEFAULT];
    if (table && table[key] !== undefined) return table[key];
    if (MESSAGES[DEFAULT][key] !== undefined) return MESSAGES[DEFAULT][key];
    // Never render a key at a user. An untranslated string stays as authored.
    return fallback !== undefined ? fallback : "";
  }

  /**
   * Apply the catalogue to the document.
   *
   * `data-i18n` replaces text content; `data-i18n-attr="placeholder:key"` (comma
   * separated for several) sets attributes, which is how placeholders and
   * aria-labels get translated without a second mechanism.
   */
  function apply(root) {
    var scope = root || global.document;

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var value = t(el.getAttribute("data-i18n"), null);
      if (value) el.textContent = value;
    });

    scope.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) {
        var bits = pair.split(":");
        if (bits.length !== 2) return;
        var value = t(bits[1].trim(), null);
        if (value) el.setAttribute(bits[0].trim(), value);
      });
    });

    // The <html lang> drives font fallback, hyphenation and screen-reader
    // pronunciation. Getting this wrong makes Devanagari render in whatever the
    // Latin fallback happens to be.
    global.document.documentElement.setAttribute("lang", current);
  }

  function set(locale) {
    if (!supported(locale)) return current;
    current = locale;
    try {
      global.localStorage.setItem(STORAGE_KEY, locale);
    } catch { /* see stored() */ }
    apply();
    global.dispatchEvent(new CustomEvent("ra:locale", { detail: { locale: locale } }));
    return current;
  }

  /** Honest coverage: how much of the visible app this catalogue actually reaches. */
  function coverage() {
    var marked = global.document.querySelectorAll("[data-i18n],[data-i18n-attr]").length;
    var keys = Object.keys(MESSAGES[DEFAULT]).length;
    var missing = [];
    Object.keys(MESSAGES[DEFAULT]).forEach(function (key) {
      LOCALES.forEach(function (locale) {
        if (MESSAGES[locale][key] === undefined) missing.push(locale + "/" + key);
      });
    });
    return { locale: current, locales: LOCALES.slice(), keys: keys, elements: marked, missing: missing };
  }

  global.I18N = {
    locales: LOCALES.slice(),
    get: function () { return current; },
    set: set,
    toggle: function () { return set(current === "hi" ? "en" : "hi"); },
    t: t,
    apply: apply,
    coverage: coverage,
  };

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", function () { apply(); });
  } else {
    apply();
  }
})(window);
