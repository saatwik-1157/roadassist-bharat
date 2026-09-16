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

    "sos.received": "SOS received. Help is being arranged. Reply with a landmark or highway marker if you can.",
    "sos.received.located": "SOS received with your location. Help is being arranged.",
    "sos.contact.alert": "EMERGENCY: your contact may have been in a crash. Live location: {url}",

    "sms.stopped": "You will receive no further messages from RoadAssist. Send START to opt back in.",
    "sms.noActive": "You have no active request. Send HELP CAR (or BIKE, AUTO, TRUCK) to start one.",
    "sms.nothingToCancel": "You have no active request to cancel.",
    "sms.status.assigned": "{reference}: {status}. {mechanic} is assigned. Reply CANCEL to cancel.",
    "sms.status.searching": "{reference}: {status}. We are still finding a mechanic. Reply CANCEL to cancel.",

    "sms.cancelled": "{reference} cancelled.",
    "sms.cancelled.fee": "{reference} cancelled. A cancellation fee applies as a mechanic was already on the way.",
    "sms.cancel.tooLate": "{reference} is {status} and can no longer be cancelled by SMS. Call us for help.",
    "sms.whichVehicle": "Which vehicle? Reply HELP CAR, HELP BIKE, HELP AUTO, HELP TRUCK or HELP TRACTOR.",
    "sms.alreadyOpen": "You already have request {reference} ({status}). Reply STATUS or CANCEL.",
    "sms.requested": "Request {reference} received. We are finding a mechanic near you. Reply STATUS for an update or CANCEL to stop.",
    "sms.commands": "RoadAssist commands:\nHELP CAR / BIKE / AUTO / TRUCK - request assistance\nSTATUS - your current request\nCANCEL - cancel it\nSOS - emergency\nSTOP - opt out",

    "lang.set": "Language set to English. Send LANG HI for Hindi.",
    "lang.options": "Reply LANG EN for English or LANG HI for Hindi.",
  },
  hi: {
    "otp.code": "{code} आपका RoadAssist कोड है। 5 मिनट में समाप्त।",

    "sos.received": "SOS मिल गया। मदद भेजी जा रही है। हो सके तो पास की जगह बताएं।",
    "sos.received.located": "SOS और आपकी लोकेशन मिल गई। मदद भेजी जा रही है।",
    "sos.contact.alert": "आपातकाल: आपके संपर्क की दुर्घटना हो सकती है। लोकेशन: {url}",

    "sms.stopped": "RoadAssist संदेश बंद। दोबारा चालू करने को START भेजें।",
    "sms.noActive": "कोई सक्रिय अनुरोध नहीं। शुरू करने के लिए HELP CAR भेजें।",
    "sms.nothingToCancel": "रद्द करने के लिए कोई अनुरोध नहीं है।",
    "sms.status.assigned": "{reference} {status}। {mechanic} आ रहे हैं। रद्द को CANCEL।",
    "sms.status.searching": "{reference} {status}। मैकेनिक खोज रहे हैं। रद्द को CANCEL।",

    "sms.cancelled": "{reference} रद्द कर दिया।",
    "sms.cancelled.fee": "{reference} रद्द। मैकेनिक निकल चुका था, इसलिए रद्द शुल्क लगेगा।",
    "sms.cancel.tooLate": "{reference} {status}। SMS से रद्द नहीं। कॉल करें।",
    "sms.whichVehicle": "कौन सा वाहन? HELP CAR, BIKE, AUTO, TRUCK या TRACTOR भेजें।",
    "sms.alreadyOpen": "{reference} ({status}) पहले से चालू है। STATUS या CANCEL भेजें।",
    "sms.requested": "{reference} मिल गया। मैकेनिक खोज रहे हैं। STATUS या CANCEL।",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - मदद\nSTATUS - स्थिति\nCANCEL - रद्द\nSOS - आपातकाल\nSTOP - बंद",

    "lang.set": "भाषा हिंदी कर दी गई। English के लिए LANG EN भेजें।",
    "lang.options": "भाषा: LANG EN HI TA TE BN MR KN GU",
  },
  ta: {
    "otp.code": "{code} உங்கள் RoadAssist குறியீடு. 5 நிமிடத்தில் முடியும்.",
    "sos.received": "SOS கிடைத்தது. உதவி வருகிறது. அருகில் உள்ள இடத்தைச் சொல்லுங்கள்.",
    "sos.received.located": "SOS-ம் உங்கள் இடமும் கிடைத்தது. உதவி வருகிறது.",
    "sos.contact.alert": "அவசரம்: உங்கள் தொடர்புக்கு விபத்து இருக்கலாம். இடம்: {url}",
    "sms.stopped": "RoadAssist செய்திகள் நிறுத்தப்பட்டன. மீண்டும் START அனுப்பவும்.",
    "sms.noActive": "கோரிக்கை எதுவும் இல்லை. தொடங்க HELP CAR அனுப்பவும்.",
    "sms.nothingToCancel": "ரத்து செய்ய கோரிக்கை இல்லை.",
    "sms.status.assigned": "{reference} {status}. {mechanic} வருகிறார். ரத்துக்கு CANCEL.",
    "sms.status.searching": "{reference} {status}. மெக்கானிக் தேடுகிறோம். ரத்துக்கு CANCEL.",
    "sms.cancelled": "{reference} ரத்து செய்யப்பட்டது.",
    "sms.cancelled.fee": "{reference} ரத்து. மெக்கானிக் புறப்பட்டதால் கட்டணம் உண்டு.",
    "sms.cancel.tooLate": "{reference} {status}. SMS-ல் ரத்து இல்லை. அழைக்கவும்.",
    "sms.whichVehicle": "எந்த வாகனம்? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ஏற்கெனவே உள்ளது. STATUS அல்லது CANCEL.",
    "sms.requested": "{reference} கிடைத்தது. மெக்கானிக் தேடுகிறோம். STATUS/CANCEL.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - உதவி\nSTATUS - நிலை\nCANCEL - ரத்து\nSOS - அவசரம்\nSTOP - நிறுத்து",
    "lang.set": "மொழி தமிழ். English-க்கு LANG EN அனுப்பவும்.",
    "lang.options": "மொழி: LANG EN HI TA TE BN MR KN GU",
  },
  te: {
    "otp.code": "{code} మీ RoadAssist కోడ్. 5 నిమిషాల్లో ముగుస్తుంది.",
    "sos.received": "SOS అందింది. సహాయం పంపుతున్నాం. దగ్గరి ప్రదేశం చెప్పండి.",
    "sos.received.located": "SOS, మీ లొకేషన్ అందాయి. సహాయం పంపుతున్నాం.",
    "sos.contact.alert": "అత్యవసరం: మీ పరిచయస్థునికి ప్రమాదం కావచ్చు. లొకేషన్: {url}",
    "sms.stopped": "RoadAssist సందేశాలు ఆగాయి. మళ్లీ ప్రారంభించడానికి START.",
    "sms.noActive": "మీకు అభ్యర్థన లేదు. ప్రారంభించడానికి HELP CAR పంపండి.",
    "sms.nothingToCancel": "రద్దు చేయడానికి అభ్యర్థన లేదు.",
    "sms.status.assigned": "{reference} {status}. {mechanic} వస్తున్నారు. రద్దుకు CANCEL.",
    "sms.status.searching": "{reference} {status}. మెకానిక్ కోసం వెతుకుతున్నాం. CANCEL.",
    "sms.cancelled": "{reference} రద్దు అయింది.",
    "sms.cancelled.fee": "{reference} రద్దు. మెకానిక్ బయలుదేరారు, రుసుము ఉంటుంది.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ద్వారా రద్దు కాదు. కాల్ చేయండి.",
    "sms.whichVehicle": "ఏ వాహనం? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ఇప్పటికే ఉంది. STATUS లేదా CANCEL.",
    "sms.requested": "{reference} అందింది. మెకానిక్ కోసం వెతుకుతున్నాం. STATUS/CANCEL.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - సహాయం\nSTATUS - స్థితి\nCANCEL - రద్దు\nSOS - అత్యవసరం\nSTOP - ఆపు",
    "lang.set": "భాష తెలుగు. English కోసం LANG EN పంపండి.",
    "lang.options": "భాష: LANG EN HI TA TE BN MR KN GU",
  },
  bn: {
    "otp.code": "{code} আপনার RoadAssist কোড। ৫ মিনিটে শেষ হবে।",
    "sos.received": "SOS পেয়েছি। সাহায্য পাঠানো হচ্ছে। কাছের জায়গা জানান।",
    "sos.received.located": "SOS ও আপনার লোকেশন পেয়েছি। সাহায্য পাঠানো হচ্ছে।",
    "sos.contact.alert": "জরুরি: আপনার পরিচিতের দুর্ঘটনা হতে পারে। লোকেশন: {url}",
    "sms.stopped": "RoadAssist বার্তা বন্ধ। আবার চালু করতে START পাঠান।",
    "sms.noActive": "কোনো সক্রিয় অনুরোধ নেই। শুরু করতে HELP CAR পাঠান।",
    "sms.nothingToCancel": "বাতিল করার মতো অনুরোধ নেই।",
    "sms.status.assigned": "{reference} {status}। {mechanic} আসছেন। বাতিলে CANCEL।",
    "sms.status.searching": "{reference} {status}। মেকানিক খোঁজা হচ্ছে। বাতিলে CANCEL।",
    "sms.cancelled": "{reference} বাতিল হয়েছে।",
    "sms.cancelled.fee": "{reference} বাতিল। মেকানিক রওনা দেওয়ায় ফি লাগবে।",
    "sms.cancel.tooLate": "{reference} {status}। SMS-এ বাতিল নয়। কল করুন।",
    "sms.whichVehicle": "কোন গাড়ি? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR।",
    "sms.alreadyOpen": "{reference} ({status}) চালু আছে। STATUS বা CANCEL পাঠান।",
    "sms.requested": "{reference} পেয়েছি। মেকানিক খোঁজা হচ্ছে। STATUS বা CANCEL।",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - সাহায্য\nSTATUS - অবস্থা\nCANCEL - বাতিল\nSOS - জরুরি\nSTOP - বন্ধ",
    "lang.set": "ভাষা বাংলা। English-এর জন্য LANG EN পাঠান।",
    "lang.options": "ভাষা: LANG EN HI TA TE BN MR KN GU",
  },
  mr: {
    "otp.code": "{code} हा तुमचा RoadAssist कोड. 5 मिनिटांत संपेल.",
    "sos.received": "SOS मिळाला. मदत पाठवत आहोत. जवळची जागा सांगा.",
    "sos.received.located": "SOS आणि तुमचे लोकेशन मिळाले. मदत पाठवत आहोत.",
    "sos.contact.alert": "आणीबाणी: तुमच्या संपर्काचा अपघात असू शकतो. लोकेशन: {url}",
    "sms.stopped": "RoadAssist संदेश बंद. पुन्हा सुरू करण्यास START पाठवा.",
    "sms.noActive": "कोणतीही विनंती नाही. सुरू करण्यास HELP CAR पाठवा.",
    "sms.nothingToCancel": "रद्द करण्यासाठी विनंती नाही.",
    "sms.status.assigned": "{reference} {status}. {mechanic} येत आहेत. रद्दसाठी CANCEL.",
    "sms.status.searching": "{reference} {status}. मेकॅनिक शोधत आहोत. रद्दसाठी CANCEL.",
    "sms.cancelled": "{reference} रद्द केले.",
    "sms.cancelled.fee": "{reference} रद्द. मेकॅनिक निघाल्याने शुल्क लागेल.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ने रद्द होणार नाही. कॉल करा.",
    "sms.whichVehicle": "कोणते वाहन? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) आधीच सुरू आहे. STATUS किंवा CANCEL.",
    "sms.requested": "{reference} मिळाले. मेकॅनिक शोधत आहोत. STATUS किंवा CANCEL.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - मदत\nSTATUS - स्थिती\nCANCEL - रद्द\nSOS - आणीबाणी\nSTOP - बंद",
    "lang.set": "भाषा मराठी. English साठी LANG EN पाठवा.",
    "lang.options": "भाषा: LANG EN HI TA TE BN MR KN GU",
  },
  kn: {
    "otp.code": "{code} ನಿಮ್ಮ RoadAssist ಕೋಡ್. 5 ನಿಮಿಷದಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ.",
    "sos.received": "SOS ಸಿಕ್ಕಿದೆ. ಸಹಾಯ ಕಳಿಸುತ್ತಿದ್ದೇವೆ. ಹತ್ತಿರದ ಸ್ಥಳ ತಿಳಿಸಿ.",
    "sos.received.located": "SOS ಮತ್ತು ನಿಮ್ಮ ಸ್ಥಳ ಸಿಕ್ಕಿದೆ. ಸಹಾಯ ಬರುತ್ತಿದೆ.",
    "sos.contact.alert": "ತುರ್ತು: ನಿಮ್ಮ ಸಂಪರ್ಕಕ್ಕೆ ಅಪಘಾತ ಆಗಿರಬಹುದು. ಸ್ಥಳ: {url}",
    "sms.stopped": "RoadAssist ಸಂದೇಶ ನಿಂತಿದೆ. ಮತ್ತೆ ಶುರುಮಾಡಲು START ಕಳಿಸಿ.",
    "sms.noActive": "ಯಾವ ಮನವಿಯೂ ಇಲ್ಲ. ಶುರುಮಾಡಲು HELP CAR ಕಳಿಸಿ.",
    "sms.nothingToCancel": "ರದ್ದು ಮಾಡಲು ಮನವಿ ಇಲ್ಲ.",
    "sms.status.assigned": "{reference} {status}. {mechanic} ಬರುತ್ತಿದ್ದಾರೆ. ರದ್ದಿಗೆ CANCEL.",
    "sms.status.searching": "{reference} {status}. ಮೆಕ್ಯಾನಿಕ್ ಹುಡುಕುತ್ತಿದ್ದೇವೆ. CANCEL.",
    "sms.cancelled": "{reference} ರದ್ದಾಗಿದೆ.",
    "sms.cancelled.fee": "{reference} ರದ್ದು. ಮೆಕ್ಯಾನಿಕ್ ಹೊರಟಿದ್ದರಿಂದ ಶುಲ್ಕ ಬೀಳುತ್ತದೆ.",
    "sms.cancel.tooLate": "{reference} {status}. SMS ನಲ್ಲಿ ರದ್ದು ಇಲ್ಲ. ಕರೆ ಮಾಡಿ.",
    "sms.whichVehicle": "ಯಾವ ವಾಹನ? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) ಈಗಾಗಲೇ ಇದೆ. STATUS ಅಥವಾ CANCEL.",
    "sms.requested": "{reference} ಸಿಕ್ಕಿದೆ. ಮೆಕ್ಯಾನಿಕ್ ಹುಡುಕುತ್ತಿದ್ದೇವೆ. STATUS/CANCEL.",
    "sms.commands": "RoadAssist:\nHELP CAR/BIKE/AUTO/TRUCK - ಸಹಾಯ\nSTATUS - ಸ್ಥಿತಿ\nCANCEL - ರದ್ದು\nSOS - ತುರ್ತು\nSTOP - ನಿಲ್ಲಿಸು",
    "lang.set": "ಭಾಷೆ ಕನ್ನಡ. English ಗಾಗಿ LANG EN ಕಳಿಸಿ.",
    "lang.options": "ಭಾಷೆ: LANG EN HI TA TE BN MR KN GU",
  },
  gu: {
    "otp.code": "{code} તમારો RoadAssist કોડ છે. 5 મિનિટમાં પૂરો થશે.",
    "sos.received": "SOS મળ્યો. મદદ મોકલી રહ્યા છીએ. નજીકની જગ્યા જણાવો.",
    "sos.received.located": "SOS અને તમારું લોકેશન મળ્યું. મદદ મોકલી રહ્યા છીએ.",
    "sos.contact.alert": "કટોકટી: તમારા સંપર્કનો અકસ્માત થયો હોઈ શકે. લોકેશન: {url}",
    "sms.stopped": "RoadAssist સંદેશા બંધ. ફરી ચાલુ કરવા START મોકલો.",
    "sms.noActive": "કોઈ વિનંતી નથી. શરૂ કરવા HELP CAR મોકલો.",
    "sms.nothingToCancel": "રદ કરવા માટે વિનંતી નથી.",
    "sms.status.assigned": "{reference} {status}. {mechanic} આવે છે. રદ માટે CANCEL.",
    "sms.status.searching": "{reference} {status}. મિકેનિક શોધી રહ્યા છીએ. રદ માટે CANCEL.",
    "sms.cancelled": "{reference} રદ થયું.",
    "sms.cancelled.fee": "{reference} રદ. મિકેનિક નીકળી ગયો હોવાથી ફી લાગશે.",
    "sms.cancel.tooLate": "{reference} {status}. SMS થી રદ નહીં. ફોન કરો.",
    "sms.whichVehicle": "કયું વાહન? HELP CAR, BIKE, AUTO, TRUCK, TRACTOR.",
    "sms.alreadyOpen": "{reference} ({status}) પહેલેથી છે. STATUS કે CANCEL મોકલો.",
    "sms.requested": "{reference} મળ્યું. મિકેનિક શોધી રહ્યા છીએ. STATUS કે CANCEL.",
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
