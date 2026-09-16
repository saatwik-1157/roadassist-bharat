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

  var LOCALES = ["en", "hi", "ta", "te", "bn", "mr", "kn", "gu"];
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
    },
    ta: {
      "sos.label": "SOS",
      "sos.hold": "1.5 வினாடி அழுத்தவும்",
      "sos.aria": "அவசர SOS அனுப்ப அழுத்திப் பிடிக்கவும்",
      "sos.sending": "அனுப்புகிறது…",
      "sos.cancel": "ரத்து",
      "sos.ready": "அவசரத் தயார்நிலை",
      "net.online": "இணைப்பில்",
      "net.limited": "மெல்லிய இணைப்பு",
      "net.offline": "இணைப்பு இல்லை",
      "net.offline.detail": "சிக்னல் இல்லை. SOS இந்த ஃபோனிலேயே அதன் எண்ணுடன் சேமிக்கப்பட்டு, இணைப்பு வந்ததும் அனுப்பப்படும்.",
      "net.limited.detail": "இணைப்பு மெலிதாக உள்ளது. அவசர வசதிகள் இயங்கும்; பணம் செலுத்துவது இணைப்பு வரும் வரை காத்திருக்கும்.",
      "net.syncing": "ஒத்திசைக்கிறது…",
      "net.synced": "ஒத்திசைக்கப்பட்டது",
      "auth.title": "உங்கள் ஃபோனில் உள்நுழையவும்.",
      "auth.msisdn": "கைபேசி எண்",
      "auth.send": "குறியீடு அனுப்பு",
      "auth.code": "6 இலக்கக் குறியீடு",
      "auth.verify": "சரிபார்த்து தொடரவும்",
      "auth.restoring": "உங்கள் அமர்வு மீட்கப்படுகிறது…",
      "nav.home": "முகப்பு",
      "nav.bookings": "முன்பதிவு",
      "nav.vehicles": "வாகனங்கள்",
      "nav.more": "மேலும்",
      "nav.map": "வரைபடம்",
      "action.book": "உதவி பதிவு",
      "action.cancel": "ரத்து",
      "action.pay": "பணம்",
      "action.track": "கண்காணி",
      "action.retry": "மீண்டும் முயற்சி",
      "lang.name": "தமிழ்",
    },
    te: {
      "sos.label": "SOS",
      "sos.hold": "1.5 సెకన్లు నొక్కి ఉంచండి",
      "sos.aria": "అత్యవసర SOS పంపడానికి నొక్కి ఉంచండి",
      "sos.sending": "పంపుతోంది…",
      "sos.cancel": "రద్దు",
      "sos.ready": "అత్యవసర సంసిద్ధత",
      "net.online": "ఆన్‌లైన్",
      "net.limited": "బలహీన కనెక్షన్",
      "net.offline": "కనెక్షన్ లేదు",
      "net.offline.detail": "సిగ్నల్ లేదు. SOS ఈ ఫోన్‌లోనే దాని నంబర్‌తో సేవ్ అయి, కనెక్షన్ రాగానే పంపబడుతుంది.",
      "net.limited.detail": "కనెక్షన్ బలహీనంగా ఉంది. అత్యవసర సేవలు పనిచేస్తాయి; చెల్లింపు ఆన్‌లైన్ వచ్చే వరకు ఆగుతుంది.",
      "net.syncing": "సింక్ అవుతోంది…",
      "net.synced": "సింక్ అయింది",
      "auth.title": "మీ ఫోన్‌తో సైన్ ఇన్ చేయండి.",
      "auth.msisdn": "మొబైల్ నంబర్",
      "auth.send": "కోడ్ పంపు",
      "auth.code": "6 అంకెల కోడ్",
      "auth.verify": "ధృవీకరించి కొనసాగండి",
      "auth.restoring": "మీ సెషన్ పునరుద్ధరిస్తోంది…",
      "nav.home": "హోమ్",
      "nav.bookings": "బుకింగ్‌లు",
      "nav.vehicles": "వాహనాలు",
      "nav.more": "మరిన్ని",
      "nav.map": "మ్యాప్",
      "action.book": "సహాయం బుక్",
      "action.cancel": "రద్దు",
      "action.pay": "చెల్లింపు",
      "action.track": "ట్రాక్",
      "action.retry": "మళ్లీ ప్రయత్నించు",
      "lang.name": "తెలుగు",
    },
    bn: {
      "sos.label": "SOS",
      "sos.hold": "১.৫ সেকেন্ড চেপে ধরুন",
      "sos.aria": "জরুরি SOS পাঠাতে চেপে ধরুন",
      "sos.sending": "পাঠানো হচ্ছে…",
      "sos.cancel": "বাতিল",
      "sos.ready": "জরুরি প্রস্তুতি",
      "net.online": "অনলাইন",
      "net.limited": "দুর্বল সংযোগ",
      "net.offline": "সংযোগ নেই",
      "net.offline.detail": "সিগন্যাল নেই। SOS এই ফোনেই নিজের নম্বর সহ সেভ আছে এবং সংযোগ ফিরলেই পাঠানো হবে।",
      "net.limited.detail": "সংযোগ দুর্বল। জরুরি সুবিধা চালু আছে; পেমেন্ট অনলাইনে ফেরা পর্যন্ত অপেক্ষা করবে।",
      "net.syncing": "সিঙ্ক হচ্ছে…",
      "net.synced": "সিঙ্ক হয়েছে",
      "auth.title": "আপনার ফোন দিয়ে সাইন ইন করুন।",
      "auth.msisdn": "মোবাইল নম্বর",
      "auth.send": "কোড পাঠান",
      "auth.code": "৬ সংখ্যার কোড",
      "auth.verify": "যাচাই করে এগোন",
      "auth.restoring": "আপনার সেশন ফেরানো হচ্ছে…",
      "nav.home": "হোম",
      "nav.bookings": "বুকিং",
      "nav.vehicles": "গাড়ি",
      "nav.more": "আরও",
      "nav.map": "মানচিত্র",
      "action.book": "সাহায্য বুক",
      "action.cancel": "বাতিল",
      "action.pay": "পেমেন্ট",
      "action.track": "ট্র্যাক",
      "action.retry": "আবার চেষ্টা",
      "lang.name": "বাংলা",
    },
    mr: {
      "sos.label": "SOS",
      "sos.hold": "१.५ सेकंद दाबून ठेवा",
      "sos.aria": "आणीबाणी SOS पाठवण्यासाठी दाबून ठेवा",
      "sos.sending": "पाठवत आहे…",
      "sos.cancel": "रद्द",
      "sos.ready": "आणीबाणी तयारी",
      "net.online": "ऑनलाइन",
      "net.limited": "कमकुवत कनेक्शन",
      "net.offline": "कनेक्शन नाही",
      "net.offline.detail": "सिग्नल नाही. SOS याच फोनमध्ये स्वतःच्या क्रमांकासह जतन आहे आणि कनेक्शन येताच पाठवला जाईल.",
      "net.limited.detail": "कनेक्शन कमकुवत आहे. आणीबाणी सुविधा चालू आहेत; पेमेंट ऑनलाइन येईपर्यंत थांबेल.",
      "net.syncing": "सिंक होत आहे…",
      "net.synced": "सिंक झाले",
      "auth.title": "तुमच्या फोनने साइन इन करा.",
      "auth.msisdn": "मोबाइल क्रमांक",
      "auth.send": "कोड पाठवा",
      "auth.code": "६ अंकी कोड",
      "auth.verify": "तपासून पुढे चला",
      "auth.restoring": "तुमचे सत्र परत आणत आहे…",
      "nav.home": "होम",
      "nav.bookings": "बुकिंग",
      "nav.vehicles": "वाहने",
      "nav.more": "अधिक",
      "nav.map": "नकाशा",
      "action.book": "मदत बुक करा",
      "action.cancel": "रद्द",
      "action.pay": "पेमेंट",
      "action.track": "ट्रॅक",
      "action.retry": "पुन्हा प्रयत्न",
      "lang.name": "मराठी",
    },
    kn: {
      "sos.label": "SOS",
      "sos.hold": "1.5 ಸೆಕೆಂಡು ಒತ್ತಿ ಹಿಡಿಯಿರಿ",
      "sos.aria": "ತುರ್ತು SOS ಕಳಿಸಲು ಒತ್ತಿ ಹಿಡಿಯಿರಿ",
      "sos.sending": "ಕಳಿಸುತ್ತಿದೆ…",
      "sos.cancel": "ರದ್ದು",
      "sos.ready": "ತುರ್ತು ಸಿದ್ಧತೆ",
      "net.online": "ಆನ್‌ಲೈನ್",
      "net.limited": "ದುರ್ಬಲ ಸಂಪರ್ಕ",
      "net.offline": "ಸಂಪರ್ಕ ಇಲ್ಲ",
      "net.offline.detail": "ಸಿಗ್ನಲ್ ಇಲ್ಲ. SOS ಈ ಫೋನಿನಲ್ಲೇ ತನ್ನ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಉಳಿದಿದೆ, ಸಂಪರ್ಕ ಬಂದ ತಕ್ಷಣ ಕಳಿಸಲಾಗುತ್ತದೆ.",
      "net.limited.detail": "ಸಂಪರ್ಕ ದುರ್ಬಲವಾಗಿದೆ. ತುರ್ತು ಸೌಲಭ್ಯ ಕೆಲಸ ಮಾಡುತ್ತದೆ; ಪಾವತಿ ಆನ್‌ಲೈನ್ ಬರುವವರೆಗೆ ಕಾಯುತ್ತದೆ.",
      "net.syncing": "ಸಿಂಕ್ ಆಗುತ್ತಿದೆ…",
      "net.synced": "ಸಿಂಕ್ ಆಗಿದೆ",
      "auth.title": "ನಿಮ್ಮ ಫೋನಿನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ.",
      "auth.msisdn": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ",
      "auth.send": "ಕೋಡ್ ಕಳಿಸಿ",
      "auth.code": "6 ಅಂಕಿಯ ಕೋಡ್",
      "auth.verify": "ಪರಿಶೀಲಿಸಿ ಮುಂದುವರಿಯಿರಿ",
      "auth.restoring": "ನಿಮ್ಮ ಸೆಷನ್ ಮರಳಿ ತರಲಾಗುತ್ತಿದೆ…",
      "nav.home": "ಮುಖಪುಟ",
      "nav.bookings": "ಬುಕಿಂಗ್",
      "nav.vehicles": "ವಾಹನಗಳು",
      "nav.more": "ಇನ್ನಷ್ಟು",
      "nav.map": "ನಕ್ಷೆ",
      "action.book": "ಸಹಾಯ ಬುಕ್",
      "action.cancel": "ರದ್ದು",
      "action.pay": "ಪಾವತಿ",
      "action.track": "ಟ್ರ್ಯಾಕ್",
      "action.retry": "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
      "lang.name": "ಕನ್ನಡ",
    },
    gu: {
      "sos.label": "SOS",
      "sos.hold": "૧.૫ સેકન્ડ દબાવી રાખો",
      "sos.aria": "કટોકટી SOS મોકલવા દબાવી રાખો",
      "sos.sending": "મોકલાઈ રહ્યું છે…",
      "sos.cancel": "રદ",
      "sos.ready": "કટોકટી તૈયારી",
      "net.online": "ઓનલાઈન",
      "net.limited": "નબળું જોડાણ",
      "net.offline": "જોડાણ નથી",
      "net.offline.detail": "સિગ્નલ નથી. SOS આ જ ફોનમાં તેના નંબર સાથે સચવાયો છે અને જોડાણ આવતાં જ મોકલાશે.",
      "net.limited.detail": "જોડાણ નબળું છે. કટોકટી સુવિધા ચાલુ છે; ચુકવણી ઓનલાઈન આવે ત્યાં સુધી રોકાશે.",
      "net.syncing": "સિંક થઈ રહ્યું છે…",
      "net.synced": "સિંક થયું",
      "auth.title": "તમારા ફોનથી સાઇન ઇન કરો.",
      "auth.msisdn": "મોબાઈલ નંબર",
      "auth.send": "કોડ મોકલો",
      "auth.code": "૬ અંકનો કોડ",
      "auth.verify": "ચકાસીને આગળ વધો",
      "auth.restoring": "તમારું સત્ર પાછું લવાઈ રહ્યું છે…",
      "nav.home": "હોમ",
      "nav.bookings": "બુકિંગ",
      "nav.vehicles": "વાહનો",
      "nav.more": "વધુ",
      "nav.map": "નકશો",
      "action.book": "મદદ બુક કરો",
      "action.cancel": "રદ",
      "action.pay": "ચુકવણી",
      "action.track": "ટ્રેક",
      "action.retry": "ફરી પ્રયાસ",
      "lang.name": "ગુજરાતી",
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
    // Cycles rather than toggles: with eight languages a two-way switch cannot
    // reach six of them, and a dropdown a reader cannot read is no better.
    // Each press advances one and the label shows what the NEXT press gives.
    next: function () {
      return set(LOCALES[(LOCALES.indexOf(current) + 1) % LOCALES.length]);
    },
    toggle: function () {
      return set(LOCALES[(LOCALES.indexOf(current) + 1) % LOCALES.length]);
    },
    // The NEXT language's name, written in that language.
    //
    // With two languages a stored "Language: English" label worked. With eight
    // it cannot: the label has to be legible to the person who wants to leave
    // the language currently on screen, and that person by definition may not
    // read it. So the control always shows where one more press lands, in the
    // script of that destination.
    nextName: function () {
      var next = LOCALES[(LOCALES.indexOf(current) + 1) % LOCALES.length];
      return (MESSAGES[next] || {})["lang.name"] || next;
    },
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
