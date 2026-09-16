/**
 * The message catalogue and how a language gets chosen.
 *
 * The interesting assertions here are not "does Hindi come back for hi" — they
 * are the two things that break silently in production: a catalogue that has
 * drifted so one language is missing a key nobody notices until an emergency,
 * and a Devanagari message that quietly costs three SMS segments because
 * nothing outside GSM 03.38 fits in 160 characters.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DEFAULT_LOCALE,
  LOCALES,
  MESSAGE_KEYS,
  isLocale,
  parseAcceptLanguage,
  parseLangCommand,
  resolveLocale,
  smsSegments,
  t,
} from "../src/i18n.js";

describe("the catalogue", () => {
  it("says exactly which languages ship, and it is all eight", () => {
    // This test used to read "and it is two", which was the honest answer
    // then. The roadmap's eight are now all present — so the assertion moves,
    // and it stays here for the same reason: whatever LOCALES says is what the
    // documents are allowed to claim.
    assert.deepEqual([...LOCALES], ["en", "hi", "ta", "te", "bn", "mr", "kn", "gu"]);
  });

  it("every locale defines every key — no silent English fallback in production", () => {
    // A fallback exists so a gap degrades instead of throwing, but a gap is
    // still a bug: the reader gets a language they may not have.
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        const message = t(locale, key, {
          code: "123456", url: "https://x", reference: "RA-1", status: "EN_ROUTE", mechanic: "M",
        });
        assert.ok(message.length > 0, `${locale}/${key} is empty`);
        if (locale !== DEFAULT_LOCALE) {
          assert.notEqual(
            message,
            t(DEFAULT_LOCALE, key, {
              code: "123456", url: "https://x", reference: "RA-1", status: "EN_ROUTE", mechanic: "M",
            }),
            `${locale}/${key} is identical to English — the key is probably missing`,
          );
        }
      }
    }
  });

  it("substitutes every placeholder it is given", () => {
    assert.equal(t("en", "otp.code", { code: "482913" }).startsWith("482913"), true);
    assert.ok(t("hi", "otp.code", { code: "482913" }).includes("482913"));
  });

  it("leaves an unknown placeholder visible rather than printing undefined", () => {
    // "Reply {reference}" is a bug report. "Reply undefined" is a mystery.
    assert.ok(t("en", "sms.status.searching", {}).includes("{reference}"));
  });

  it("throws on an unknown key instead of texting somebody the key", () => {
    assert.throws(() => t("en", "no.such.key"), /no message for key/);
  });
});

describe("SMS segment cost", () => {
  it("knows plain English is GSM and fits 160", () => {
    const r = smsSegments("SOS received. Help is being arranged.");
    assert.equal(r.encoding, "GSM");
    assert.equal(r.segments, 1);
  });

  it("knows Devanagari forces UCS-2, where a segment is 70 characters", () => {
    const r = smsSegments("SOS मिल गया।");
    assert.equal(r.encoding, "UCS2");
    assert.equal(r.segments, 1);
  });

  it("counts multi-segment correctly in both encodings", () => {
    assert.equal(smsSegments("a".repeat(161)).segments, 2);
    assert.equal(smsSegments("क".repeat(71)).segments, 2);
    assert.equal(smsSegments("क".repeat(140)).segments, 3);
  });

  /**
   * One segment, with one named exception.
   *
   * `sos.contact.alert` carries a link ending in a 36-character UUID: 60
   * characters of URL against a 70-character UCS-2 segment leaves ten for the
   * Hindi. No wording fixes that, so it is allowed two and the exception is
   * listed here by name — a blanket rule nobody can satisfy gets relaxed
   * silently, and then it stops catching anything.
   */
  const SEGMENT_BUDGET: Record<string, number> = {
    // Carries a 60-character URL; see above.
    "sos.contact.alert": 2,
    // These interpolate data of unbounded length — a booking reference, a status
    // enum and a mechanic's full name. The fixed Hindi is kept short so the
    // ordinary case is one segment, but no wording can bound "Ramesh Kumar".
    "sms.status.assigned": 2,
    "sms.status.searching": 2,
    // A reference card, sent on request and never on an emergency path. A
    // five-line command list cannot fit 70 UCS-2 characters in any wording.
    "sms.commands": 2,
  };

  it("every catalogue message costs one segment, bar the one that carries a link", () => {
    // This is the whole reason the Hindi copy is written for SMS rather than
    // translated word-for-word. A three-segment OTP costs three times as much,
    // on the exact path used by the people least able to absorb it, and some
    // aggregators truncate rather than concatenate.
    const params = {
      code: "482913",
      url: "https://roadassist.in/i/00000000-0000-0000-0000-000000000000",
      reference: "RA-ABC123",
      status: "MECHANIC_EN_ROUTE",
      mechanic: "Ramesh Kumar",
    };
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        const body = t(locale, key, params);
        const { encoding, segments } = smsSegments(body);
        const allowed = SEGMENT_BUDGET[key] ?? 1;
        assert.ok(
          segments <= allowed,
          `${locale}/${key} costs ${segments} ${encoding} segments, budget ${allowed} (${body.length} chars): ${body}`,
        );
      }
    }
  });
});

describe("choosing a language", () => {
  it("a stored preference beats everything — the user told us", () => {
    assert.equal(resolveLocale({ stored: "hi", acceptLanguage: "en-GB,en;q=0.9" }), "hi");
  });

  it("falls back to Accept-Language only when nothing is stored", () => {
    assert.equal(resolveLocale({ stored: null, acceptLanguage: "hi-IN,hi;q=0.9,en;q=0.8" }), "hi");
  });

  it("honours every language the seeder can write into preferred_language", () => {
    // The seeder picks from these eight, and for a long time six of them had no
    // catalogue, so those users silently got English. Now each resolves to
    // itself — which is the whole point of the column existing.
    for (const code of ["en", "hi", "te", "ta", "mr", "bn", "kn", "gu"]) {
      assert.equal(resolveLocale({ stored: code }), code, code);
    }
  });

  it("still refuses a language we do not ship", () => {
    for (const unsupported of ["", "xx", "fr", "ur", "or", "pa"]) {
      assert.equal(resolveLocale({ stored: unsupported }), "en", unsupported);
    }
  });

  it("ends at English when nothing says otherwise", () => {
    assert.equal(resolveLocale({}), "en");
    assert.equal(resolveLocale({ stored: null, acceptLanguage: null }), "en");
  });

  describe("Accept-Language", () => {
    it("honours q-ordering rather than document order", () => {
      assert.equal(parseAcceptLanguage("en;q=0.2,hi;q=0.9"), "hi");
      assert.equal(parseAcceptLanguage("hi;q=0.1,en;q=0.8"), "en");
    });

    it("matches on the base tag, so hi-IN is Hindi", () => {
      assert.equal(parseAcceptLanguage("hi-IN"), "hi");
      assert.equal(parseAcceptLanguage("en-US"), "en");
    });

    it("skips languages we do not ship and takes the next one we do", () => {
      assert.equal(parseAcceptLanguage("ur;q=1.0,hi;q=0.5"), "hi");
    });

    it("matches each of the eight on its own tag", () => {
      for (const code of LOCALES) {
        assert.equal(parseAcceptLanguage(`${code}-IN,en;q=0.1`), code, code);
      }
    });

    it("treats q=0 as an explicit refusal", () => {
      assert.equal(parseAcceptLanguage("hi;q=0,en;q=0.5"), "en");
    });

    it("survives the malformed headers real clients send", () => {
      for (const junk of ["", "   ", ",,,", "hi;q=", "hi;q=abc", "*", "en;;q=0.5;;"]) {
        assert.doesNotThrow(() => parseAcceptLanguage(junk), junk);
      }
      assert.equal(parseAcceptLanguage("*"), null);
    });
  });
});

describe("the LANG SMS command", () => {
  it("is not confused with any other verb", () => {
    // undefined means "this is not the lang command" — distinct from null,
    // which means "it is, but I could not read the argument".
    assert.equal(parseLangCommand(["sos", "12.5", "77.5"]), undefined);
    assert.equal(parseLangCommand(["status"]), undefined);
    assert.equal(parseLangCommand([]), undefined);
  });

  it("accepts the ISO code, the English word and the native word", () => {
    for (const word of ["hi", "hin", "hindi", "हिंदी", "हिन्दी"]) {
      assert.equal(parseLangCommand(["lang", word]), "hi", word);
    }
    for (const word of ["en", "eng", "english", "अंग्रेजी"]) {
      assert.equal(parseLangCommand(["lang", word]), "en", word);
    }
  });

  it("accepts every shipped language by code, English name and native name", () => {
    const names: Record<string, string[]> = {
      ta: ["ta", "tamil", "தமிழ்"],
      te: ["te", "telugu", "తెలుగు"],
      bn: ["bn", "bengali", "বাংলা"],
      mr: ["mr", "marathi", "मराठी"],
      kn: ["kn", "kannada", "ಕನ್ನಡ"],
      gu: ["gu", "gujarati", "ગુજરાતી"],
    };
    for (const [code, words] of Object.entries(names)) {
      for (const word of words) {
        assert.equal(parseLangCommand(["lang", word]), code, `${code}/${word}`);
      }
    }
  });

  it("accepts the command word itself in Hindi", () => {
    // Somebody switching TO Hindi may well type the whole thing in Hindi.
    assert.equal(parseLangCommand(["भाषा", "हिंदी"]), "hi");
  });

  it("offers the options when the argument is missing or unknown", () => {
    assert.equal(parseLangCommand(["lang"]), null);
    assert.equal(parseLangCommand(["lang", "klingon"]), null);
  });
});

describe("isLocale", () => {
  it("accepts only what ships", () => {
    for (const yes of LOCALES) assert.equal(isLocale(yes), true, yes);
    for (const no of ["ur", "EN", "HI", "", null, undefined, 7, {}]) {
      assert.equal(isLocale(no), false, String(no));
    }
  });
});
