/**
 * Telegram alerts and bot replies in the user's language
 * (src/domain/telegram-i18n.ts, src/domain/telegram.ts). The structure of
 * every message is the same in all eight: who, the reference, the IST time,
 * the two map links, "automated demo alert; call 112" and the /stop hint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../src/i18n.js";
import {
  TELEGRAM_KEYS, TELEGRAM_MESSAGES, telegramLocale, telegramText,
} from "../src/domain/telegram-i18n.js";
import { botReply, linkedMessage, mapLinks, sosAlertMessage } from "../src/domain/telegram.js";

const NOW = new Date("2026-10-13T08:35:00Z");
const POS = { lat: 28.4595, lng: 77.0266 };
const PHONE = /\d{10}/;

test("all eight app languages have every Telegram message, with the same placeholders", () => {
  assert.deepEqual(Object.keys(TELEGRAM_MESSAGES).sort(), [...LOCALES].sort());
  for (const l of LOCALES) {
    for (const k of TELEGRAM_KEYS) {
      const en = TELEGRAM_MESSAGES.en[k]!, mine = TELEGRAM_MESSAGES[l][k];
      assert.ok(mine, `${l} lacks ${k}`);
      assert.deepEqual(mine!.match(/\{\w+\}/g) ?? [], en.match(/\{\w+\}/g) ?? [], `${l} ${k} placeholders`);
    }
  }
});

test("every language keeps 112 and /stop as written, where the English has them", () => {
  for (const l of LOCALES) {
    assert.match(telegramText(l, "alert.disclaimer"), /112/, l);
    for (const k of ["alert.stopHint", "linked", "help"] as const) assert.match(telegramText(l, k), /\/stop/, `${l} ${k}`);
  }
});

test("a Hindi alert is Hindi, with the same structure and links, and no phone number", () => {
  const text = sosAlertMessage({ ownerFirstName: "Priya", ref: "RA-K7P2QX", at: NOW, position: POS, locale: "hi" });
  const lines = text.split("\n");
  const links = mapLinks(POS.lat, POS.lng);
  assert.equal(lines[0], "SOS: Priya ने RoadAssist पर आपातकालीन मदद माँगी है।");
  assert.equal(lines[2], "संदर्भ: RA-K7P2QX");
  assert.match(lines[3], /^समय: .* IST$/);
  assert.equal(lines[4], `लोकेशन: ${links.google}`);
  assert.equal(lines[5], `OpenStreetMap: ${links.osm}`);
  assert.equal(lines[7], "यह RoadAssist का स्वचालित डेमो अलर्ट है; आपात स्थिति में 112 पर कॉल करें।");
  assert.match(lines[8], /\/stop/);
  assert.equal(lines.length, sosAlertMessage({ ownerFirstName: "Priya", ref: "RA-K7P2QX", at: NOW, position: POS }).split("\n").length);
  assert.doesNotMatch(text, PHONE);
});

test("no locale, or an unknown one, is the English alert exactly as before", () => {
  const en = sosAlertMessage({ ownerFirstName: "Priya", ref: "R", at: NOW, position: null });
  assert.equal(sosAlertMessage({ ownerFirstName: "Priya", ref: "R", at: NOW, position: null, locale: telegramLocale("fr") }), en);
  assert.ok(en.startsWith("SOS: Priya has raised an emergency on RoadAssist."));
  assert.match(en, /Location: not known/);
});

test("telegramLocale accepts the eight, in any case or region, and nothing else", () => {
  assert.equal(telegramLocale("hi"), "hi");
  assert.equal(telegramLocale("HI-in"), "hi");
  assert.equal(telegramLocale("ta_IN"), "ta");
  for (const v of ["fr", "", "x-klingon", 42, null, undefined, { lang: "hi" }]) assert.equal(telegramLocale(v), null, String(v));
});

test("a missing translation falls back to English for that message only", () => {
  const cat = { en: TELEGRAM_MESSAGES.en, hi: { ...TELEGRAM_MESSAGES.hi, "alert.ref": undefined } };
  assert.equal(telegramText("hi", "alert.ref", { ref: "X" }, cat), "Ref: X");
  assert.equal(telegramText("hi", "alert.time", { time: "T" }, cat), "समय: T");
});

test("bot replies follow the invite's language, English by default", () => {
  assert.equal(botReply("stopped"), "Unlinked. You will no longer get RoadAssist SOS alerts in this chat.");
  assert.equal(botReply("stopped", "hi"), TELEGRAM_MESSAGES.hi.stopped);
  assert.match(linkedMessage("Priya", "ta"), /^நீங்கள் இப்போது Priya-இன் அவசரத் தொடர்பு\./);
  assert.match(linkedMessage(null, "hi"), /एक RoadAssist उपयोगकर्ता/);
  assert.match(linkedMessage(null), /^You are now an emergency contact for a RoadAssist user\. /);
});
