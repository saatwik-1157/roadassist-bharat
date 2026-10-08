/**
 * Language for the messages that leave the platform.
 *
 * ── why this exists, and why it starts with SMS ────────────────────────────
 * The product's thesis is the roads where coverage is worst and the phones that
 * are cheapest. Both of those describe people for whom English is not a first
 * language — and the SMS path is the one they reach us on. An English OTP to a
 * feature phone in rural Bihar is not a missing nicety; it is the failure the
 * project exists to prevent, arriving in a different form.
 *
 * So the catalogue below covers the messages the platform SENDS — every OTP,
 * every SMS reply, every emergency-contact alert — before it covers anything on
 * a screen. A screen can be pointed at; a text message cannot.
 *
 * ── scope, stated honestly ────────────────────────────────────────────────
 * All eight roadmap languages ship: en hi ta te bn mr kn gu. This paragraph
 * said "two languages ship: English and Hindi" long after the other six had
 * landed — a file whose own header under-claimed what the table beneath it
 * does, which is the same defect as over-claiming and is caught the same way.
 * `LOCALES` is the whole truth, `i18n.test.ts` holds every locale to every key,
 * and prose in here is only ever a description of that.
 *
 * What is NOT claimed: the translations are not native-reviewed. The strings
 * exist and fit their segment budget; the quality is unverified, and those are
 * different claims. Say so wherever the count is quoted.
 *
 * Copy is written FOR SMS in each language rather than translated word-for-word
 * from the English: a 70-character UCS-2 segment and a stranded reader both
 * reward directness.
 *
 * ── encoding, which is the trap ───────────────────────────────────────────
 * Devanagari is not in the GSM 03.38 alphabet, so a Hindi SMS is sent as UCS-2
 * and a single segment holds 70 characters, not 160. `smsSegments()` below is
 * the thing to check a new message against; `i18n.test.ts` holds every catalogue
 * entry to it, because a message that silently becomes three segments costs
 * three times as much and can be truncated by an aggregator.
 *
 * One entry is a documented exception. `sos.contact.alert` has to carry a link,
 * the link ends in a 36-character UUID, and 60 characters of URL against a
 * 70-character UCS-2 segment leaves ten for the Hindi — which is not a copy
 * problem, it is arithmetic. It is allowed two segments. The real fix is a
 * short incident code in the URL instead of the UUID; that changes a
 * user-facing link format, so it is named here rather than done quietly.
 */

export const LOCALES = ["en", "hi", "ta", "te", "bn", "mr", "kn", "gu"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * Pick a language.
 *
 * A stored preference always wins: the user told us, possibly by texting
 * `LANG HI` from a phone with no settings screen at all. `Accept-Language` is a
 * hint from a browser, used only when we have been told nothing.
 */
export function resolveLocale(opts: {
  stored?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(opts.stored)) return opts.stored;
  return parseAcceptLanguage(opts.acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * Minimal RFC 9110 Accept-Language: q-ordered, first supported match wins.
 *
 * Deliberately small. A full negotiator is a dependency and a surface; this
 * handles `hi`, `hi-IN`, `en-GB,en;q=0.9,hi;q=0.8` and the malformed junk that
 * arrives from real clients, which is all eight of these need.
 */
export function parseAcceptLanguage(header?: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p))
        .find(Boolean)?.[1];
      const weight = q === undefined ? 1 : Number(q);
      return {
        base: tag.trim().toLowerCase().split("-")[0],
        // A malformed q is not a reason to discard the whole header.
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    // q=0 means "explicitly not this one".
    .filter((r) => r.base && r.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { base } of ranked) if (isLocale(base)) return base;
  return null;
}

/**
 * How many SMS segments a body costs.
 *
 * GSM 03.38 packs 160 characters into one segment. Anything outside it — every
 * Devanagari character — forces UCS-2 on the whole message, where a segment is
 * 70 characters and a concatenated one is 67.
 */
export function smsSegments(body: string): { encoding: "GSM" | "UCS2"; segments: number } {
  // The subset that matters here. Latin letters, digits, and the punctuation the
  // catalogue actually uses.
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_ÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  if (gsm.test(body)) {
    const segments = body.length <= 160 ? 1 : Math.ceil(body.length / 153);
    return { encoding: "GSM", segments: Math.max(1, segments) };
  }
  const segments = body.length <= 70 ? 1 : Math.ceil(body.length / 67);
  return { encoding: "UCS2", segments: Math.max(1, segments) };
}

type Params = Record<string, string | number>;

/**
 * The catalogue.
 *
 * Every key is a message that leaves the platform. `{name}` placeholders are
 * substituted by [t]; a key missing from a locale falls back to English rather
 * than showing the user a key, because a message in the wrong language still
 * helps and `sos.received` is not the place to discover a gap.
 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    "otp.code": "{code} is your RoadAssist verification code. It expires in 5 minutes.",

    // Only what happened: the SOS is recorded and any saved contacts texted, but
    // no responder is contacted and the 112 handoff is stubbed. These said
    // "Help is being arranged" (and in Tamil, "help is coming"). {ref} is the
    // incident id's first 8 characters, the same short ref the web app shows.
    "sos.received": "SOS received and recorded (ref {ref}). Nobody is dispatched automatically. Call 112 if you can. Reply with a landmark or highway marker.",
    "sos.received.located": "SOS received with your location and recorded (ref {ref}). Nobody is dispatched automatically. Call 112 if you can.",
    "sos.contact.alert": "EMERGENCY: your contact may have been in a crash. Live location: {url}",

    "sms.stopped": "You will receive no further messages from RoadAssist, including emergency alerts when someone lists you as a contact. Send START to opt back in.",
    "sms.started": "You are opted back in to RoadAssist messages, including emergency alerts. Send STOP to opt out.",
    "sms.noActive": "You have no active request. Send HELP CAR (or BIKE, AUTO, TRUCK) to start one.",
    "sms.nothingToCancel": "You have no active request to cancel.",
    "sms.status.assigned": "{reference}: {status}. {mechanic} is assigned. Reply CANCEL to cancel.",
    "sms.status.searching": "{reference}: {status}. We are still finding a mechanic. Reply CANCEL to cancel.",

    "sms.cancelled": "{reference} cancelled.",
    "sms.cancel.tooLate": "{reference} is {status} and can no longer be cancelled by SMS. Call us for help.",
    "sms.cancel.accepted": "{reference}: a mechanic accepted it just before your CANCEL, so it was not cancelled. Send CANCEL again to cancel.",
    "sms.cancel.changed": "{reference} changed to {status} before your CANCEL arrived, so it was not cancelled. Send CANCEL again.",
    "sms.whichVehicle": "Which vehicle? Reply HELP CAR, HELP BIKE, HELP AUTO, HELP TRUCK or HELP TRACTOR.",
    "sms.alreadyOpen": "You already have request {reference} ({status}). Reply STATUS or CANCEL.",
    "sms.requested": "Request {reference} recorded, but we have no location for you, so no mechanic search has started. In an emergency call 112.",
    "sms.commands": "RoadAssist commands:\nHELP CAR / BIKE / AUTO / TRUCK - request assistance\nSTATUS - your current request\nCANCEL - cancel it\nSOS - emergency\nSTOP - opt out",

    "lang.set": "Language set to English. Send LANG HI for Hindi.",
    "lang.options": "Reply LANG EN for English or LANG HI for Hindi.",
  },
  hi: {
    "otp.code": "{code} आपका RoadAssist कोड है। 5 मिनट में समाप्त।",

    "sos.received": "SOS {ref} दर्ज। कोई अपने-आप नहीं आएगा। 112 पर कॉल कर जगह बताएं।",
    "sos.received.located": "SOS {ref} लोकेशन सहित दर्ज। कोई अपने-आप नहीं आएगा। 112 पर कॉल करें।",
    "sos.contact.alert": "आपातकाल: आपके संपर्क की दुर्घटना हो सकती है। लोकेशन: {url}",

    "sms.stopped": "RoadAssist संदेश बंद, आपात अलर्ट भी। फिर चालू करने को START भेजें।",
    "sms.started": "RoadAssist संदेश फिर चालू, आपातकालीन अलर्ट भी। बंद को STOP भेजें।",
    "sms.noActive": "कोई सक्रिय अनुरोध नहीं। शुरू करने के लिए HELP CAR भेजें।",
    "sms.nothingToCancel": "रद्द करने के लिए कोई अनुरोध नहीं है।",
    "sms.status.assigned": "{reference} {status}। {mechanic} आ रहे हैं। रद्द को CANCEL।",
    "sms.status.searching": "{reference} {status}। मैकेनिक खोज रहे हैं। रद्द को CANCEL।",

    "sms.cancelled": "{reference} रद्द कर दिया।",
    "sms.cancel.tooLate": "{reference} {status}। SMS से रद्द नहीं। कॉल करें।",
    "sms.cancel.accepted": "{reference}: मैकेनिक ने ले लिया, रद्द नहीं हुआ। रद्द को फिर CANCEL।",
    "sms.cancel.changed": "{reference} अब {status} है, रद्द नहीं हुआ। फिर CANCEL भेजें।",
    "sms.whichVehicle": "कौन सा वाहन? HELP CAR, BIKE, AUTO, TRUCK या TRACTOR भेजें।",
    "sms.alreadyOpen": "{reference} ({status}) पहले से चालू है। STATUS या CANCEL भेजें।",
    "sms.requested": "{reference} दर्ज। लोकेशन नहीं, मैकेनिक खोज शुरू नहीं हुई। आपात: 112।",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - मदद\nSTATUS - स्थिति\nCANCEL - रद्द\nSOS - आपातकाल\nSTOP - बंद",

    "lang.set": "भाषा हिंदी कर दी गई। English के लिए LANG EN भेजें।",
    "lang.options": "भाषा: LANG EN HI TA TE BN MR KN GU",
  },
  ta: {
    "otp.code": "{code} உங்கள் RoadAssist குறியீடு. 5 நிமிடத்தில் முடியும்.",
    "sos.received": "SOS {ref} பதிவு. யாரும் தானாக வரார். 112-ஐ அழைத்து இடம் கூறுங்கள்.",
    "sos.received.located": "SOS {ref} இடத்துடன் பதிவு. யாரும் தானாக வரார். 112-ஐ அழையுங்கள்.",
    "sos.contact.alert": "அவசரம்: உங்கள் தொடர்புக்கு விபத்து இருக்கலாம். இடம்: {url}",
    "sms.stopped": "RoadAssist செய்திகள் நிறுத்தம், அவசர எச்சரிக்கையும். மீண்டும் START.",
    "sms.started": "RoadAssist செய்திகள் மீண்டும், அவசர எச்சரிக்கையும். நிறுத்த STOP.",
    "sms.noActive": "கோரிக்கை எதுவும் இல்லை. தொடங்க HELP CAR அனுப்பவும்.",
    "sms.nothingToCancel": "ரத்து செய்ய கோரிக்கை இல்லை.",
    "sms.status.assigned": "{reference} {status}. {mechanic} வருகிறார். ரத்துக்கு CANCEL.",
    "sms.status.searching": "{reference} {status}. மெக்கானிக் தேடுகிறோம். ரத்துக்கு CANCEL.",
    "sms.cancelled": "{reference} ரத்து செய்யப்பட்டது.",
    "sms.cancel.tooLate": "{reference} {status}. SMS-ல் ரத்து இல்லை. அழைக்கவும்.",
    "sms.cancel.accepted": "{reference}: மெக்கானிக் ஏற்றார், ரத்து இல்லை. ரத்துக்கு மீண்டும் CANCEL.",
    "sms.cancel.changed": "{reference} இப்போது {status}, ரத்து இல்லை. மீண்டும் CANCEL.",
    "sms.whichVehicle": "எந்த வாகனம்? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ஏற்கெனவே உள்ளது. STATUS அல்லது CANCEL.",
    "sms.requested": "{reference} பதிவு. இடம் தெரியாததால் மெக்கானிக் தேடல் இல்லை. அவசரம்: 112.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - உதவி\nSTATUS - நிலை\nCANCEL - ரத்து\nSOS - அவசரம்\nSTOP - நிறுத்து",
    "lang.set": "மொழி தமிழ். English-க்கு LANG EN அனுப்பவும்.",
    "lang.options": "மொழி: LANG EN HI TA TE BN MR KN GU",
  },
  te: {
    "otp.code": "{code} మీ RoadAssist కోడ్. 5 నిమిషాల్లో ముగుస్తుంది.",
    "sos.received": "SOS {ref} నమోదు. ఎవరూ స్వయంగా రారు. 112కు కాల్ చేసి చోటు చెప్పండి.",
    "sos.received.located": "SOS {ref} లొకేషన్‌తో నమోదు. ఎవరూ స్వయంగా రారు. 112కు కాల్ చేయండి.",
    "sos.contact.alert": "అత్యవసరం: మీ పరిచయస్థునికి ప్రమాదం కావచ్చు. లొకేషన్: {url}",
    "sms.stopped": "RoadAssist సందేశాలు ఆగాయి, అత్యవసర హెచ్చరికలు కూడా. మళ్లీ START.",
    "sms.started": "RoadAssist సందేశాలు మళ్లీ మొదలు, అత్యవసర హెచ్చరికలతో. ఆపడానికి STOP.",
    "sms.noActive": "మీకు అభ్యర్థన లేదు. ప్రారంభించడానికి HELP CAR పంపండి.",
    "sms.nothingToCancel": "రద్దు చేయడానికి అభ్యర్థన లేదు.",
    "sms.status.assigned": "{reference} {status}. {mechanic} వస్తున్నారు. రద్దుకు CANCEL.",
    "sms.status.searching": "{reference} {status}. మెకానిక్ కోసం వెతుకుతున్నాం. CANCEL.",
    "sms.cancelled": "{reference} రద్దు అయింది.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ద్వారా రద్దు కాదు. కాల్ చేయండి.",
    "sms.cancel.accepted": "{reference}: మెకానిక్ ఒప్పుకున్నారు, రద్దు లేదు. రద్దుకు మళ్లీ CANCEL.",
    "sms.cancel.changed": "{reference} ఇప్పుడు {status}, రద్దు కాలేదు. మళ్లీ CANCEL.",
    "sms.whichVehicle": "ఏ వాహనం? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ఇప్పటికే ఉంది. STATUS లేదా CANCEL.",
    "sms.requested": "{reference} నమోదు. లొకేషన్ లేదు, మెకానిక్ వెతకడం లేదు. అత్యవసరం: 112.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - సహాయం\nSTATUS - స్థితి\nCANCEL - రద్దు\nSOS - అత్యవసరం\nSTOP - ఆపు",
    "lang.set": "భాష తెలుగు. English కోసం LANG EN పంపండి.",
    "lang.options": "భాష: LANG EN HI TA TE BN MR KN GU",
  },
  bn: {
    "otp.code": "{code} আপনার RoadAssist কোড। ৫ মিনিটে শেষ হবে।",
    "sos.received": "SOS {ref} নথিভুক্ত। কেউ নিজে আসবে না। 112-এ কল করে জায়গা বলুন।",
    "sos.received.located": "SOS {ref} লোকেশনসহ নথিভুক্ত। কেউ নিজে আসবে না। 112-এ কল করুন।",
    "sos.contact.alert": "জরুরি: আপনার পরিচিতের দুর্ঘটনা হতে পারে। লোকেশন: {url}",
    "sms.stopped": "RoadAssist বার্তা বন্ধ, জরুরি সতর্কতাও। আবার চালু করতে START পাঠান।",
    "sms.started": "RoadAssist বার্তা আবার চালু, জরুরি সতর্কতাও। বন্ধ করতে STOP পাঠান।",
    "sms.noActive": "কোনো সক্রিয় অনুরোধ নেই। শুরু করতে HELP CAR পাঠান।",
    "sms.nothingToCancel": "বাতিল করার মতো অনুরোধ নেই।",
    "sms.status.assigned": "{reference} {status}। {mechanic} আসছেন। বাতিলে CANCEL।",
    "sms.status.searching": "{reference} {status}। মেকানিক খোঁজা হচ্ছে। বাতিলে CANCEL।",
    "sms.cancelled": "{reference} বাতিল হয়েছে।",
    "sms.cancel.tooLate": "{reference} {status}। SMS-এ বাতিল নয়। কল করুন।",
    "sms.cancel.accepted": "{reference}: মেকানিক নিয়েছেন, বাতিল হয়নি। বাতিলে আবার CANCEL দিন।",
    "sms.cancel.changed": "{reference} এখন {status}, বাতিল হয়নি। আবার CANCEL পাঠান।",
    "sms.whichVehicle": "কোন গাড়ি? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR।",
    "sms.alreadyOpen": "{reference} ({status}) চালু আছে। STATUS বা CANCEL পাঠান।",
    "sms.requested": "{reference} নথিভুক্ত। লোকেশন নেই, মেকানিক খোঁজা শুরু হয়নি। জরুরি: 112।",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - সাহায্য\nSTATUS - অবস্থা\nCANCEL - বাতিল\nSOS - জরুরি\nSTOP - বন্ধ",
    "lang.set": "ভাষা বাংলা। English-এর জন্য LANG EN পাঠান।",
    "lang.options": "ভাষা: LANG EN HI TA TE BN MR KN GU",
  },
  mr: {
    "otp.code": "{code} हा तुमचा RoadAssist कोड. 5 मिनिटांत संपेल.",
    "sos.received": "SOS {ref} नोंदवला. आपोआप कोणी येत नाही. 112 वर कॉल करून जागा सांगा.",
    "sos.received.located": "SOS {ref} लोकेशनसह नोंदवला. आपोआप कोणी येत नाही. 112 वर कॉल करा.",
    "sos.contact.alert": "आणीबाणी: तुमच्या संपर्काचा अपघात असू शकतो. लोकेशन: {url}",
    "sms.stopped": "RoadAssist संदेश बंद, आणीबाणी सूचनाही. पुन्हा सुरूसाठी START पाठवा.",
    "sms.started": "RoadAssist संदेश पुन्हा सुरू, आणीबाणी सूचनाही. बंदसाठी STOP पाठवा.",
    "sms.noActive": "कोणतीही विनंती नाही. सुरू करण्यास HELP CAR पाठवा.",
    "sms.nothingToCancel": "रद्द करण्यासाठी विनंती नाही.",
    "sms.status.assigned": "{reference} {status}. {mechanic} येत आहेत. रद्दसाठी CANCEL.",
    "sms.status.searching": "{reference} {status}. मेकॅनिक शोधत आहोत. रद्दसाठी CANCEL.",
    "sms.cancelled": "{reference} रद्द केले.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ने रद्द होणार नाही. कॉल करा.",
    "sms.cancel.accepted": "{reference}: मेकॅनिकने स्वीकारले, रद्द नाही. रद्दसाठी पुन्हा CANCEL.",
    "sms.cancel.changed": "{reference} आता {status}, रद्द झाले नाही. पुन्हा CANCEL पाठवा.",
    "sms.whichVehicle": "कोणते वाहन? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) आधीच सुरू आहे. STATUS किंवा CANCEL.",
    "sms.requested": "{reference} नोंदवले. लोकेशन नाही, मेकॅनिक शोध सुरू नाही. आपत्कालीन: 112.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - मदत\nSTATUS - स्थिती\nCANCEL - रद्द\nSOS - आणीबाणी\nSTOP - बंद",
    "lang.set": "भाषा मराठी. English साठी LANG EN पाठवा.",
    "lang.options": "भाषा: LANG EN HI TA TE BN MR KN GU",
  },
  kn: {
    "otp.code": "{code} ನಿಮ್ಮ RoadAssist ಕೋಡ್. 5 ನಿಮಿಷದಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ.",
    "sos.received": "SOS {ref} ದಾಖಲಾಗಿದೆ. ಯಾರೂ ತಾನಾಗಿ ಬರರು. 112ಕ್ಕೆ ಕರೆಮಾಡಿ ಸ್ಥಳ ತಿಳಿಸಿ.",
    "sos.received.located": "SOS {ref} ಸ್ಥಳಸಹಿತ ದಾಖಲಾಗಿದೆ. ಯಾರೂ ತಾನಾಗಿ ಬರರು. 112ಕ್ಕೆ ಕರೆಮಾಡಿ.",
    "sos.contact.alert": "ತುರ್ತು: ನಿಮ್ಮ ಸಂಪರ್ಕಕ್ಕೆ ಅಪಘಾತ ಆಗಿರಬಹುದು. ಸ್ಥಳ: {url}",
    "sms.stopped": "RoadAssist ಸಂದೇಶ ನಿಂತಿದೆ, ತುರ್ತು ಎಚ್ಚರಿಕೆಯೂ. ಮತ್ತೆ ಶುರುಮಾಡಲು START.",
    "sms.started": "RoadAssist ಸಂದೇಶ ಮತ್ತೆ ಶುರು, ತುರ್ತು ಎಚ್ಚರಿಕೆಯೂ. ನಿಲ್ಲಿಸಲು STOP.",
    "sms.noActive": "ಯಾವ ಮನವಿಯೂ ಇಲ್ಲ. ಶುರುಮಾಡಲು HELP CAR ಕಳಿಸಿ.",
    "sms.nothingToCancel": "ರದ್ದು ಮಾಡಲು ಮನವಿ ಇಲ್ಲ.",
    "sms.status.assigned": "{reference} {status}. {mechanic} ಬರುತ್ತಿದ್ದಾರೆ. ರದ್ದಿಗೆ CANCEL.",
    "sms.status.searching": "{reference} {status}. ಮೆಕ್ಯಾನಿಕ್ ಹುಡುಕುತ್ತಿದ್ದೇವೆ. CANCEL.",
    "sms.cancelled": "{reference} ರದ್ದಾಗಿದೆ.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ನಲ್ಲಿ ರದ್ದು ಇಲ್ಲ. ಕರೆ ಮಾಡಿ.",
    "sms.cancel.accepted": "{reference}: ಮೆಕ್ಯಾನಿಕ್ ಒಪ್ಪಿದರು, ರದ್ದಾಗಿಲ್ಲ. ರದ್ದಿಗೆ ಮತ್ತೆ CANCEL.",
    "sms.cancel.changed": "{reference} ಈಗ {status}, ರದ್ದಾಗಿಲ್ಲ. ಮತ್ತೆ CANCEL ಕಳಿಸಿ.",
    "sms.whichVehicle": "ಯಾವ ವಾಹನ? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ಈಗಾಗಲೇ ಇದೆ. STATUS ಅಥವಾ CANCEL.",
    "sms.requested": "{reference} ದಾಖಲು. ಸ್ಥಳ ಇಲ್ಲದೆ ಮೆಕ್ಯಾನಿಕ್ ಹುಡುಕಾಟ ಇಲ್ಲ. ತುರ್ತು: 112.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - ಸಹಾಯ\nSTATUS - ಸ್ಥಿತಿ\nCANCEL - ರದ್ದು\nSOS - ತುರ್ತು\nSTOP - ನಿಲ್ಲಿಸು",
    "lang.set": "ಭಾಷೆ ಕನ್ನಡ. English ಗಾಗಿ LANG EN ಕಳಿಸಿ.",
    "lang.options": "ಭಾಷೆ: LANG EN HI TA TE BN MR KN GU",
  },
  gu: {
    "otp.code": "{code} તમારો RoadAssist કોડ છે. 5 મિનિટમાં પૂરો થશે.",
    "sos.received": "SOS {ref} નોંધાયો. આપમેળે કોઈ નહીં આવે. 112 પર કૉલ કરી જગ્યા કહો.",
    "sos.received.located": "SOS {ref} લોકેશન સાથે નોંધાયો. આપમેળે કોઈ નહીં આવે. 112 પર કૉલ કરો.",
    "sos.contact.alert": "કટોકટી: તમારા સંપર્કનો અકસ્માત થયો હોઈ શકે. લોકેશન: {url}",
    "sms.stopped": "RoadAssist સંદેશા બંધ, કટોકટી ચેતવણી પણ. ફરી ચાલુ કરવા START મોકલો.",
    "sms.started": "RoadAssist સંદેશા ફરી ચાલુ, કટોકટી ચેતવણી પણ. બંધ કરવા STOP મોકલો.",
    "sms.noActive": "કોઈ વિનંતી નથી. શરૂ કરવા HELP CAR મોકલો.",
    "sms.nothingToCancel": "રદ કરવા માટે વિનંતી નથી.",
    "sms.status.assigned": "{reference} {status}. {mechanic} આવે છે. રદ માટે CANCEL.",
    "sms.status.searching": "{reference} {status}. મિકેનિક શોધી રહ્યા છીએ. રદ માટે CANCEL.",
    "sms.cancelled": "{reference} રદ થયું.",
    "sms.cancel.tooLate": "{reference} {status}. SMS થી રદ નહીં. ફોન કરો.",
    "sms.cancel.accepted": "{reference}: મિકેનિકે સ્વીકાર્યું, રદ નથી થયું. રદ માટે ફરી CANCEL.",
    "sms.cancel.changed": "{reference} હવે {status}, રદ નથી થયું. ફરી CANCEL મોકલો.",
    "sms.whichVehicle": "કયું વાહન? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) પહેલેથી છે. STATUS કે CANCEL મોકલો.",
    "sms.requested": "{reference} નોંધાયું. લોકેશન નથી, તેથી મિકેનિક શોધ શરૂ નથી. કટોકટી: 112.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - મદદ\nSTATUS - સ્થિતિ\nCANCEL - રદ\nSOS - કટોકટી\nSTOP - બંધ",
    "lang.set": "ભાષા ગુજરાતી. English માટે LANG EN મોકલો.",
    "lang.options": "ભાષા: LANG EN HI TA TE BN MR KN GU",
  },
};

/** Every key the catalogue defines, from the English entry (the complete one). */
export const MESSAGE_KEYS = Object.keys(MESSAGES.en);

export function t(locale: Locale, key: string, params: Params = {}): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (template === undefined) {
    // A missing key is a programming error, not a user-facing state. Say so
    // loudly in logs rather than texting somebody "sms.status.assigned".
    throw new Error(`i18n: no message for key "${key}"`);
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * The `LANG` SMS command.
 *
 * A feature phone has no settings screen, so the only way its owner can change
 * language is by texting. Accepts the English word, the native name, and the
 * ISO code: someone switching TO Hindi may well type the Hindi word for it.
 */
const LANG_WORDS: Record<string, Locale> = {
  en: "en", eng: "en", english: "en", "अंग्रेजी": "en", angrezi: "en",
  hi: "hi", hin: "hi", hindi: "hi", "हिंदी": "hi", "हिन्दी": "hi",
  ta: "ta", tam: "ta", tamil: "ta", "தமிழ்": "ta",
  te: "te", tel: "te", telugu: "te", "తెలుగు": "te",
  bn: "bn", ben: "bn", bangla: "bn", bengali: "bn", "বাংলা": "bn",
  mr: "mr", mar: "mr", marathi: "mr", "मराठी": "mr",
  kn: "kn", kan: "kn", kannada: "kn", "ಕನ್ನಡ": "kn",
  gu: "gu", guj: "gu", gujarati: "gu", "ગુજરાતી": "gu",
};

export function parseLangCommand(words: string[]): Locale | null | undefined {
  const verb = words[0] ?? "";
  if (!["lang", "language", "भाषा"].includes(verb)) return undefined;   // not this command
  const asked = words[1];
  if (asked === undefined) return null;                                  // command, no argument
  return LANG_WORDS[asked] ?? null;
}
