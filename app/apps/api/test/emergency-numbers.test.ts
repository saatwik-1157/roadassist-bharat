/**
 * The web app's emergency numbers and its "Text my location" message
 * (apps/web/emergency-numbers.js). The literal file the browser loads is
 * imported, not a copy.
 *
 * Two failures matter most here, and both are quiet. A coordinate that is not
 * the user's — a fallback, a 0,0 from an unset field — typed into an emergency
 * text sends someone to the wrong place. And the Android client keeps its own
 * list (mobile/.../EmergencyNumbers.kt): if the two drift, the same person sees
 * a different set of numbers depending on which app they opened.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import "../../web/emergency-numbers.js";
import { smsSegments } from "../src/i18n.js";

type Num = { number: string; id: string; label: string; primary: boolean };
type Info = {
  ref?: string; lat?: number | null; lng?: number | null; accuracyM?: number | null;
  type?: string; at?: string | Date | null; demo?: boolean;
};
const E = (globalThis as unknown as {
  RAEmergency: {
    NUMBERS: Num[];
    telHref(n: string): string;
    smsBody(o: Info): string;
    smsHref(body: string, ua?: string, touchPoints?: number): string;
    isIOS(ua: string, touchPoints?: number): boolean;
    panelHtml(info?: Info): string;
  };
}).RAEmergency;

const KOTLIN = fileURLToPath(new URL(
  "../../../../mobile/app/src/main/java/in/roadassist/app/EmergencyNumbers.kt", import.meta.url));

/** Local time, so the formatted clock does not depend on the machine's zone. */
const AT = new Date(2026, 9, 1, 10, 32);
const WITH_FIX: Info = { ref: "RA-AB12CD", lat: 28.4595, lng: 77.0266, accuracyM: 15, type: "breakdown", at: AT };
const COORD = /-?\d{1,3}\.\d{3,}/;

describe("emergency-numbers.js — the list", () => {
  it("is 112, 1033, 108, 102, 100, 101, in that order, with 112 the only primary", () => {
    assert.deepEqual(E.NUMBERS.map((n) => n.number), ["112", "1033", "108", "102", "100", "101"]);
    assert.deepEqual(E.NUMBERS.map((n) => n.id), ["all", "highway", "ambulance", "ambulance_alt", "police", "fire"]);
    assert.deepEqual(E.NUMBERS.filter((n) => n.primary).map((n) => n.number), ["112"]);
    assert.equal(E.NUMBERS[0].label, "All emergencies (police, fire, ambulance)");
  });

  it("every number is digits only, and every id and number is unique", () => {
    for (const n of E.NUMBERS) {
      assert.match(n.number, /^\d+$/, n.number);
      assert.ok(n.label.trim().length > 0, `${n.number} has a label`);
    }
    assert.equal(new Set(E.NUMBERS.map((n) => n.id)).size, E.NUMBERS.length);
    assert.equal(new Set(E.NUMBERS.map((n) => n.number)).size, E.NUMBERS.length);
  });

  it("telHref is tel: and the bare digits", () => {
    assert.equal(E.telHref("112"), "tel:112");
    assert.equal(E.telHref("1033"), "tel:1033");
  });

  it("the panel has a tel: link for every number, 112 first", () => {
    const hrefs = [...E.panelHtml().matchAll(/href='(tel:[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, E.NUMBERS.map((n) => "tel:" + n.number));
    assert.doesNotMatch(E.panelHtml(), /sms:/, "no Text my location without an incident to describe");
  });
});

describe("emergency-numbers.js — Text my location", () => {
  it("with a fix: the reference, the type, 5 dp coordinates, accuracy and time", () => {
    assert.equal(E.smsBody(WITH_FIX),
      "SOS RA-AB12CD. I need help: breakdown. Location 28.45950,77.02660 (+/-15 m) at 1 Oct 2026, 10:32. " +
      "Sent by me. RoadAssist has not alerted anyone.");
  });

  it("without a fix it says Location unknown and carries no coordinate at all", () => {
    const cases: Info[] = [
      { ...WITH_FIX, lat: null, lng: null },
      { ...WITH_FIX, lat: undefined, lng: undefined },
      { ...WITH_FIX, lat: 28.4595, lng: null },
      { ...WITH_FIX, lat: 0, lng: 0 },
      { ...WITH_FIX, lat: Number.NaN, lng: 77 },
      { ...WITH_FIX, demo: true },
    ];
    for (const c of cases) {
      const body = E.smsBody(c);
      assert.match(body, /Location unknown/, JSON.stringify(c));
      assert.doesNotMatch(body, COORD, `no coordinate-looking number in: ${body}`);
      assert.doesNotMatch(body, /\+\/-/, "no accuracy for a fix that does not exist");
      assert.match(body, /RA-AB12CD/);
    }
  });

  it("fits one 160-character GSM SMS, worst realistic case included", () => {
    const worst: Info = {
      ref: "RA-ZZZZZZ", lat: -89.99999, lng: -179.99999, accuracyM: 999,
      type: "unsafe", at: new Date(2026, 11, 31, 23, 59),
    };
    for (const o of [WITH_FIX, worst, { ...worst, accuracyM: 123_456 }, { ...WITH_FIX, lat: null }, {}]) {
      const body = E.smsBody(o);
      assert.ok(body.length <= 160, `${body.length} chars: ${body}`);
      assert.deepEqual(smsSegments(body), { encoding: "GSM", segments: 1 }, body);
    }
  });

  it("smsHref leaves the recipient empty and encodes the body so it decodes to itself", () => {
    const body = E.smsBody(WITH_FIX);
    const android = E.smsHref(body, "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129");
    assert.ok(android.startsWith("sms:?body="), android);
    assert.equal(decodeURIComponent(android.slice("sms:?body=".length)), body);
    assert.doesNotMatch(android, / /, "spaces are encoded, not left raw");
    assert.match(android, /%2B%2F-15/, "the + in +/- is encoded, so it is not read as a space");

    const iphone = E.smsHref(body, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    assert.ok(iphone.startsWith("sms:&body="), iphone);
    assert.equal(decodeURIComponent(iphone.slice("sms:&body=".length)), body);

    assert.equal(E.isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true, "iPadOS as a Mac");
    assert.equal(E.isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false, "an actual Mac");
  });

  it("the panel's Text my location link carries the same body, with the honest note", () => {
    const html = E.panelHtml(WITH_FIX);
    const href = html.match(/href='(sms:[^']+)'/)?.[1] ?? "";
    assert.equal(decodeURIComponent(href.replace(/^sms:[?&]body=/, "")), E.smsBody(WITH_FIX));
    assert.match(html, /You choose who it goes to and press Send yourself/);
    assert.match(html, /RoadAssist has not sent anything/);
  });
});

describe("emergency-numbers.js — the contract with the Android client", () => {
  it("EmergencyNumbers.kt lists the same numbers, ids and primary, in the same order", () => {
    assert.ok(existsSync(KOTLIN),
      `${KOTLIN} does not exist. The Android list is the other half of this contract; ` +
      "without it there is nothing to hold the web list against.");
    const kt = readFileSync(KOTLIN, "utf8");
    const rows = [...kt.matchAll(/EmergencyNumber\(\s*"([^"]*)"\s*,\s*"([^"]*)"([^)]*)\)/g)]
      .map((m) => ({ number: m[1], id: m[2], primary: /primary\s*=\s*true/.test(m[3]) }));
    assert.ok(rows.length > 0, "no EmergencyNumber(...) rows found — has the Kotlin shape changed?");
    assert.deepEqual(rows, E.NUMBERS.map((n) => ({ number: n.number, id: n.id, primary: n.primary })));
  });
});
