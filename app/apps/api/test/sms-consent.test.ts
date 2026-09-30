/**
 * SMS opt-out: the words, and what STOP is allowed to stop.
 *
 * STOP used to be answered with "you will receive no further messages" while
 * nothing was stored and START was not a command. The store is exercised end to
 * end in scripts/gateway-security-test.mjs; these pin the pure rule it rests on.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { consentKeyword, partitionByOptOut, START_WORDS, STOP_WORDS } from "../src/domain/sms-consent.js";
import { t } from "../src/i18n.js";

describe("consent keywords", () => {
  it("recognises STOP and its synonyms, in any case", () => {
    for (const w of ["STOP", "stop", "Stop", " stop ", "UNSUBSCRIBE", "STOPALL", "QUIT", "END", "OPTOUT"]) {
      assert.equal(consentKeyword(w), "stop", w);
    }
  });

  it("recognises START and its synonyms — the reply has promised it for a long time", () => {
    for (const w of ["START", "start", "UNSTOP", "SUBSCRIBE", "OPTIN", "RESUME"]) {
      assert.equal(consentKeyword(w), "start", w);
    }
  });

  it("does NOT treat CANCEL as an opt-out: on this line it cancels a booking", () => {
    // The industry list includes CANCEL. Here a person cancelling a mechanic
    // would silently have unsubscribed from their own emergency alerts.
    assert.equal(consentKeyword("cancel"), null);
    assert.equal(consentKeyword("c"), null);
    assert.ok(!STOP_WORDS.includes("cancel"));
  });

  it("leaves every other command alone", () => {
    for (const w of ["sos", "help", "status", "lang", "", undefined]) assert.equal(consentKeyword(w), null, String(w));
  });

  it("no word is both STOP and START", () => {
    assert.deepEqual(STOP_WORDS.filter((w) => START_WORDS.includes(w)), []);
  });
});

describe("partitionByOptOut", () => {
  const contacts = [
    { name: "Asha", msisdn: "+919800000001" },
    { name: "Ravi", msisdn: "+919800000002" },
    { name: "Meena", msisdn: "+919800000003" },
  ];

  it("keeps everybody reachable when nobody opted out", () => {
    const r = partitionByOptOut(contacts, new Set());
    assert.equal(r.reachable.length, 3);
    assert.equal(r.optedOut.length, 0);
  });

  it("removes exactly the opted-out numbers, and returns them so they can be counted", () => {
    const r = partitionByOptOut(contacts, new Set(["+919800000002"]));
    assert.deepEqual(r.reachable.map((c) => c.name), ["Asha", "Meena"]);
    assert.deepEqual(r.optedOut.map((c) => c.name), ["Ravi"]);
  });

  it("never loses a contact: reachable plus opted out is the whole list", () => {
    const r = partitionByOptOut(contacts, new Set(["+919800000001", "+919800000003", "+910000000000"]));
    assert.equal(r.reachable.length + r.optedOut.length, contacts.length);
  });

  it("compares whole numbers, not prefixes", () => {
    const r = partitionByOptOut(contacts, new Set(["+91980000000"]));
    assert.equal(r.optedOut.length, 0);
  });
});

describe("the STOP reply says what STOP does", () => {
  it("names emergency alerts and START, and still promises no further messages", () => {
    const body = t("en", "sms.stopped");
    assert.match(body, /no further messages/i);
    assert.match(body, /emergency alerts/i);
    assert.match(body, /START/);
  });

  it("START confirms the opt-in, including emergency alerts, and says how to leave again", () => {
    const body = t("en", "sms.started");
    assert.match(body, /emergency alerts/i);
    assert.match(body, /STOP/);
  });
});
