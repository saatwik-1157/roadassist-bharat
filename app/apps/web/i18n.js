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

      // ── what an online SOS actually did (journey.js sosOutcome) ───────
      // Each sentence is said only when the server's confirm answer reports
      // it. {ref} is the incident's short id, {n} a count from the server.
      "sos.grace": "At zero, RoadAssist texts your saved emergency contacts and looks for the nearest responder unit.",
      "sos.done.recorded": "Emergency recorded (ref {ref}).",
      "sos.done.responders": "Responders have been alerted.",
      "sos.done.contacts.one": "Your 1 emergency contact was alerted.",
      "sos.done.contacts": "Your {n} emergency contacts were alerted.",
      "sos.done.none": "No responder or contact was reached. Call 112 now.",
      "sos.done.noResponder": "No responder was contacted. Call 112 now.",
      "sos.done.repeat": "It was already escalated, so nothing was sent again.",
      "sos.call112": "Call 112 now",
      "sos.unit.found": "unit located, not contacted",
      "sos.unit.notContacted": "not contacted",
      // smsLive: false — the provider only logs (console, the hosted demo).
      "sos.done.contacts.logged.one": "Your 1 emergency contact would be texted. On this demo server SMS is only logged, not sent.",
      "sos.done.contacts.logged": "Your {n} emergency contacts would be texted. On this demo server SMS is only logged, not sent.",
      "sos.contacts.logged": "{n} logged, not sent",
      "sos.grace.logged": "At zero, RoadAssist looks for the nearest responder unit. On this demo server SMS to your contacts is only logged, not sent.",

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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "शून्य होते ही RoadAssist आपके सेव किए आपात संपर्कों को SMS भेजेगा और सबसे पास की बचाव यूनिट खोजेगा।",
      "sos.done.recorded": "आपात स्थिति दर्ज हुई (संदर्भ {ref})।",
      "sos.done.responders": "बचावकर्मियों को सूचित कर दिया गया है।",
      "sos.done.contacts.one": "आपके 1 आपात संपर्क को सूचित किया गया।",
      "sos.done.contacts": "आपके {n} आपात संपर्कों को सूचित किया गया।",
      "sos.done.none": "किसी बचावकर्मी या संपर्क तक बात नहीं पहुँची। अभी 112 पर कॉल करें।",
      "sos.done.noResponder": "किसी बचावकर्मी से संपर्क नहीं हुआ। अभी 112 पर कॉल करें।",
      "sos.done.repeat": "यह पहले ही आगे बढ़ाया जा चुका है, इसलिए दोबारा कुछ नहीं भेजा गया।",
      "sos.call112": "अभी 112 पर कॉल करें",
      "sos.unit.found": "यूनिट मिली, संपर्क नहीं हुआ",
      "sos.unit.notContacted": "संपर्क नहीं हुआ",
      "sos.done.contacts.logged.one": "आपके 1 आपात संपर्क को SMS जाता। इस डेमो सर्वर पर SMS सिर्फ़ लॉग होता है, भेजा नहीं जाता।",
      "sos.done.contacts.logged": "आपके {n} आपात संपर्कों को SMS जाता। इस डेमो सर्वर पर SMS सिर्फ़ लॉग होता है, भेजा नहीं जाता।",
      "sos.contacts.logged": "{n} लॉग हुए, भेजे नहीं गए",
      "sos.grace.logged": "शून्य होते ही RoadAssist सबसे पास की बचाव यूनिट खोजेगा। इस डेमो सर्वर पर संपर्कों को SMS सिर्फ़ लॉग होता है, भेजा नहीं जाता।",

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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "பூஜ்ஜியம் ஆனதும், RoadAssist நீங்கள் சேமித்த அவசரத் தொடர்புகளுக்கு SMS அனுப்பி, அருகிலுள்ள மீட்புக் குழுவைத் தேடும்.",
      "sos.done.recorded": "அவசரநிலை பதிவு செய்யப்பட்டது (குறிப்பு {ref}).",
      "sos.done.responders": "மீட்பாளர்களுக்குத் தெரிவிக்கப்பட்டது.",
      "sos.done.contacts.one": "உங்கள் 1 அவசரத் தொடர்புக்குத் தெரிவிக்கப்பட்டது.",
      "sos.done.contacts": "உங்கள் {n} அவசரத் தொடர்புகளுக்குத் தெரிவிக்கப்பட்டது.",
      "sos.done.none": "எந்த மீட்பாளரையும் தொடர்பையும் அடைய முடியவில்லை. இப்போதே 112-ஐ அழையுங்கள்.",
      "sos.done.noResponder": "எந்த மீட்பாளரும் தொடர்பு கொள்ளப்படவில்லை. இப்போதே 112-ஐ அழையுங்கள்.",
      "sos.done.repeat": "இது ஏற்கெனவே அனுப்பப்பட்டது, அதனால் மீண்டும் எதுவும் அனுப்பப்படவில்லை.",
      "sos.call112": "இப்போதே 112-ஐ அழையுங்கள்",
      "sos.unit.found": "குழு கண்டறியப்பட்டது, தொடர்பு கொள்ளப்படவில்லை",
      "sos.unit.notContacted": "தொடர்பு கொள்ளப்படவில்லை",
      "sos.done.contacts.logged.one": "உங்கள் 1 அவசரத் தொடர்புக்கு SMS அனுப்பப்பட்டிருக்கும். இந்த டெமோ சர்வரில் SMS பதிவு மட்டுமே செய்யப்படுகிறது, அனுப்பப்படுவதில்லை.",
      "sos.done.contacts.logged": "உங்கள் {n} அவசரத் தொடர்புகளுக்கு SMS அனுப்பப்பட்டிருக்கும். இந்த டெமோ சர்வரில் SMS பதிவு மட்டுமே செய்யப்படுகிறது, அனுப்பப்படுவதில்லை.",
      "sos.contacts.logged": "{n} பதிவு, அனுப்பப்படவில்லை",
      "sos.grace.logged": "பூஜ்ஜியம் ஆனதும், RoadAssist அருகிலுள்ள மீட்புக் குழுவைத் தேடும். இந்த டெமோ சர்வரில் தொடர்புகளுக்கான SMS பதிவு மட்டுமே செய்யப்படுகிறது, அனுப்பப்படுவதில்லை.",
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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "సున్నా అవగానే RoadAssist మీరు సేవ్ చేసిన అత్యవసర పరిచయాలకు SMS పంపి, దగ్గరి సహాయ బృందాన్ని వెతుకుతుంది.",
      "sos.done.recorded": "అత్యవసర పరిస్థితి నమోదైంది (రెఫ్ {ref}).",
      "sos.done.responders": "సహాయకులకు తెలియజేశాం.",
      "sos.done.contacts.one": "మీ 1 అత్యవసర పరిచయానికి తెలియజేశాం.",
      "sos.done.contacts": "మీ {n} అత్యవసర పరిచయాలకు తెలియజేశాం.",
      "sos.done.none": "ఏ సహాయకుడినీ, పరిచయాన్నీ చేరలేకపోయాం. ఇప్పుడే 112కు కాల్ చేయండి.",
      "sos.done.noResponder": "ఏ సహాయకుడినీ సంప్రదించలేదు. ఇప్పుడే 112కు కాల్ చేయండి.",
      "sos.done.repeat": "ఇది ఇప్పటికే పంపబడింది, కాబట్టి మళ్లీ ఏదీ పంపలేదు.",
      "sos.call112": "ఇప్పుడే 112కు కాల్ చేయండి",
      "sos.unit.found": "బృందం దొరికింది, సంప్రదించలేదు",
      "sos.unit.notContacted": "సంప్రదించలేదు",
      "sos.done.contacts.logged.one": "మీ 1 అత్యవసర పరిచయానికి SMS వెళ్లేది. ఈ డెమో సర్వర్‌లో SMS లాగ్ మాత్రమే అవుతుంది, పంపబడదు.",
      "sos.done.contacts.logged": "మీ {n} అత్యవసర పరిచయాలకు SMS వెళ్లేది. ఈ డెమో సర్వర్‌లో SMS లాగ్ మాత్రమే అవుతుంది, పంపబడదు.",
      "sos.contacts.logged": "{n} లాగ్ అయ్యాయి, పంపలేదు",
      "sos.grace.logged": "సున్నా అవగానే RoadAssist దగ్గరి సహాయ బృందాన్ని వెతుకుతుంది. ఈ డెమో సర్వర్‌లో పరిచయాలకు SMS లాగ్ మాత్రమే అవుతుంది, పంపబడదు.",
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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "শূন্য হলেই RoadAssist আপনার সেভ করা জরুরি পরিচিতিদের SMS পাঠাবে এবং কাছের উদ্ধারকারী দল খুঁজবে।",
      "sos.done.recorded": "জরুরি অবস্থা নথিভুক্ত হয়েছে (রেফ {ref})।",
      "sos.done.responders": "উদ্ধারকারীদের জানানো হয়েছে।",
      "sos.done.contacts.one": "আপনার ১ জন জরুরি পরিচিতিকে জানানো হয়েছে।",
      "sos.done.contacts": "আপনার {n} জন জরুরি পরিচিতিকে জানানো হয়েছে।",
      "sos.done.none": "কোনো উদ্ধারকারী বা পরিচিতির কাছে পৌঁছানো যায়নি। এখনই 112-এ কল করুন।",
      "sos.done.noResponder": "কোনো উদ্ধারকারীর সঙ্গে যোগাযোগ করা হয়নি। এখনই 112-এ কল করুন।",
      "sos.done.repeat": "এটি আগেই পাঠানো হয়েছে, তাই আবার কিছু পাঠানো হয়নি।",
      "sos.call112": "এখনই 112-এ কল করুন",
      "sos.unit.found": "দল পাওয়া গেছে, যোগাযোগ করা হয়নি",
      "sos.unit.notContacted": "যোগাযোগ করা হয়নি",
      "sos.done.contacts.logged.one": "আপনার ১ জন জরুরি পরিচিতিকে SMS পাঠানো হতো। এই ডেমো সার্ভারে SMS শুধু লগ হয়, পাঠানো হয় না।",
      "sos.done.contacts.logged": "আপনার {n} জন জরুরি পরিচিতিকে SMS পাঠানো হতো। এই ডেমো সার্ভারে SMS শুধু লগ হয়, পাঠানো হয় না।",
      "sos.contacts.logged": "{n} লগ হয়েছে, পাঠানো হয়নি",
      "sos.grace.logged": "শূন্য হলেই RoadAssist কাছের উদ্ধারকারী দল খুঁজবে। এই ডেমো সার্ভারে পরিচিতিদের SMS শুধু লগ হয়, পাঠানো হয় না।",
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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "शून्य होताच RoadAssist तुमच्या जतन केलेल्या आणीबाणी संपर्कांना SMS पाठवेल आणि जवळचे बचाव पथक शोधेल.",
      "sos.done.recorded": "आणीबाणी नोंदवली (संदर्भ {ref}).",
      "sos.done.responders": "बचाव पथकाला कळवले आहे.",
      "sos.done.contacts.one": "तुमच्या १ आणीबाणी संपर्काला कळवले.",
      "sos.done.contacts": "तुमच्या {n} आणीबाणी संपर्कांना कळवले.",
      "sos.done.none": "कोणत्याही बचाव पथकापर्यंत किंवा संपर्कापर्यंत पोहोचता आले नाही. आत्ताच 112 वर कॉल करा.",
      "sos.done.noResponder": "कोणत्याही बचाव पथकाशी संपर्क झाला नाही. आत्ताच 112 वर कॉल करा.",
      "sos.done.repeat": "हे आधीच पुढे पाठवले गेले आहे, म्हणून पुन्हा काहीही पाठवले नाही.",
      "sos.call112": "आत्ताच 112 वर कॉल करा",
      "sos.unit.found": "पथक सापडले, संपर्क झाला नाही",
      "sos.unit.notContacted": "संपर्क झाला नाही",
      "sos.done.contacts.logged.one": "तुमच्या १ आणीबाणी संपर्काला SMS गेला असता. या डेमो सर्व्हरवर SMS फक्त लॉग होतो, पाठवला जात नाही.",
      "sos.done.contacts.logged": "तुमच्या {n} आणीबाणी संपर्कांना SMS गेला असता. या डेमो सर्व्हरवर SMS फक्त लॉग होतो, पाठवला जात नाही.",
      "sos.contacts.logged": "{n} लॉग झाले, पाठवले नाहीत",
      "sos.grace.logged": "शून्य होताच RoadAssist जवळचे बचाव पथक शोधेल. या डेमो सर्व्हरवर संपर्कांना SMS फक्त लॉग होतो, पाठवला जात नाही.",
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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "ಸೊನ್ನೆ ಆದ ತಕ್ಷಣ RoadAssist ನೀವು ಉಳಿಸಿದ ತುರ್ತು ಸಂಪರ್ಕಗಳಿಗೆ SMS ಕಳಿಸಿ, ಹತ್ತಿರದ ರಕ್ಷಣಾ ತಂಡವನ್ನು ಹುಡುಕುತ್ತದೆ.",
      "sos.done.recorded": "ತುರ್ತು ಸ್ಥಿತಿ ದಾಖಲಾಗಿದೆ (ಉಲ್ಲೇಖ {ref}).",
      "sos.done.responders": "ರಕ್ಷಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.",
      "sos.done.contacts.one": "ನಿಮ್ಮ 1 ತುರ್ತು ಸಂಪರ್ಕಕ್ಕೆ ತಿಳಿಸಲಾಗಿದೆ.",
      "sos.done.contacts": "ನಿಮ್ಮ {n} ತುರ್ತು ಸಂಪರ್ಕಗಳಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.",
      "sos.done.none": "ಯಾವುದೇ ರಕ್ಷಕರನ್ನಾಗಲಿ ಸಂಪರ್ಕವನ್ನಾಗಲಿ ತಲುಪಲಾಗಲಿಲ್ಲ. ಈಗಲೇ 112ಕ್ಕೆ ಕರೆ ಮಾಡಿ.",
      "sos.done.noResponder": "ಯಾವುದೇ ರಕ್ಷಕರನ್ನು ಸಂಪರ್ಕಿಸಲಾಗಿಲ್ಲ. ಈಗಲೇ 112ಕ್ಕೆ ಕರೆ ಮಾಡಿ.",
      "sos.done.repeat": "ಇದನ್ನು ಈಗಾಗಲೇ ಕಳಿಸಲಾಗಿದೆ, ಆದ್ದರಿಂದ ಮತ್ತೆ ಏನನ್ನೂ ಕಳಿಸಿಲ್ಲ.",
      "sos.call112": "ಈಗಲೇ 112ಕ್ಕೆ ಕರೆ ಮಾಡಿ",
      "sos.unit.found": "ತಂಡ ಸಿಕ್ಕಿದೆ, ಸಂಪರ್ಕಿಸಿಲ್ಲ",
      "sos.unit.notContacted": "ಸಂಪರ್ಕಿಸಿಲ್ಲ",
      "sos.done.contacts.logged.one": "ನಿಮ್ಮ 1 ತುರ್ತು ಸಂಪರ್ಕಕ್ಕೆ SMS ಹೋಗುತ್ತಿತ್ತು. ಈ ಡೆಮೊ ಸರ್ವರ್‌ನಲ್ಲಿ SMS ಲಾಗ್ ಮಾತ್ರ ಆಗುತ್ತದೆ, ಕಳಿಸಲಾಗುವುದಿಲ್ಲ.",
      "sos.done.contacts.logged": "ನಿಮ್ಮ {n} ತುರ್ತು ಸಂಪರ್ಕಗಳಿಗೆ SMS ಹೋಗುತ್ತಿತ್ತು. ಈ ಡೆಮೊ ಸರ್ವರ್‌ನಲ್ಲಿ SMS ಲಾಗ್ ಮಾತ್ರ ಆಗುತ್ತದೆ, ಕಳಿಸಲಾಗುವುದಿಲ್ಲ.",
      "sos.contacts.logged": "{n} ಲಾಗ್ ಆಗಿದೆ, ಕಳಿಸಿಲ್ಲ",
      "sos.grace.logged": "ಸೊನ್ನೆ ಆದ ತಕ್ಷಣ RoadAssist ಹತ್ತಿರದ ರಕ್ಷಣಾ ತಂಡವನ್ನು ಹುಡುಕುತ್ತದೆ. ಈ ಡೆಮೊ ಸರ್ವರ್‌ನಲ್ಲಿ ಸಂಪರ್ಕಗಳಿಗೆ SMS ಲಾಗ್ ಮಾತ್ರ ಆಗುತ್ತದೆ, ಕಳಿಸಲಾಗುವುದಿಲ್ಲ.",
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
      // Machine-translated, NOT native-reviewed (docs/translations/README.md).
      "sos.grace": "શૂન્ય થતાં જ RoadAssist તમારા સાચવેલા કટોકટી સંપર્કોને SMS મોકલશે અને નજીકની બચાવ ટુકડી શોધશે.",
      "sos.done.recorded": "કટોકટી નોંધાઈ (સંદર્ભ {ref}).",
      "sos.done.responders": "બચાવકર્તાઓને જાણ કરાઈ છે.",
      "sos.done.contacts.one": "તમારા ૧ કટોકટી સંપર્કને જાણ કરાઈ.",
      "sos.done.contacts": "તમારા {n} કટોકટી સંપર્કોને જાણ કરાઈ.",
      "sos.done.none": "કોઈ બચાવકર્તા કે સંપર્ક સુધી પહોંચી શકાયું નથી. હમણાં જ 112 પર કૉલ કરો.",
      "sos.done.noResponder": "કોઈ બચાવકર્તાનો સંપર્ક થયો નથી. હમણાં જ 112 પર કૉલ કરો.",
      "sos.done.repeat": "આ પહેલેથી આગળ મોકલાયું છે, તેથી ફરી કંઈ મોકલાયું નથી.",
      "sos.call112": "હમણાં જ 112 પર કૉલ કરો",
      "sos.unit.found": "ટુકડી મળી, સંપર્ક થયો નથી",
      "sos.unit.notContacted": "સંપર્ક થયો નથી",
      "sos.done.contacts.logged.one": "તમારા ૧ કટોકટી સંપર્કને SMS જાત. આ ડેમો સર્વર પર SMS ફક્ત લૉગ થાય છે, મોકલાતો નથી.",
      "sos.done.contacts.logged": "તમારા {n} કટોકટી સંપર્કોને SMS જાત. આ ડેમો સર્વર પર SMS ફક્ત લૉગ થાય છે, મોકલાતો નથી.",
      "sos.contacts.logged": "{n} લૉગ થયા, મોકલાયા નથી",
      "sos.grace.logged": "શૂન્ય થતાં જ RoadAssist નજીકની બચાવ ટુકડી શોધશે. આ ડેમો સર્વર પર સંપર્કોને SMS ફક્ત લૉગ થાય છે, મોકલાતો નથી.",
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
