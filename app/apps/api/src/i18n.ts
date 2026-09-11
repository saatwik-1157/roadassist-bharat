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
 * Two languages ship: English and Hindi. The roadmap names eight. Adding the
 * next one is a column in the table below and nothing else — that is the point
 * of the shape — but six of them are NOT here, and nothing in this file should
 * be read as claiming otherwise. `LOCALES` is the whole truth.
 *
 * Hindi copy is written for SMS, not translated word-for-word from the English:
 * a 160-character GSM limit and a stranded reader both reward directness.
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

export const LOCALES = ["en", "hi"] as const;
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
 * arrives from real clients, which is all we need for two languages.
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
    "lang.options": "English के लिए LANG EN, हिंदी के लिए LANG HI भेजें।",
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
};

export function parseLangCommand(words: string[]): Locale | null | undefined {
  const verb = words[0] ?? "";
  if (!["lang", "language", "भाषा"].includes(verb)) return undefined;   // not this command
  const asked = words[1];
  if (asked === undefined) return null;                                  // command, no argument
  return LANG_WORDS[asked] ?? null;
}
