/**
 * What the citizen app makes of a status (apps/web/journey.js).
 *
 * The literal file the browser loads is imported, not a copy, so these tests
 * pin what a phone actually shows. It is a classic script that registers itself
 * on globalThis — the same way app.html reaches it.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import "../../web/journey.js";
import { STATUSES } from "../src/domain/booking-machine.js";
import {
  INCIDENT_STATUSES, allowedIncidentCommands, applyIncident, type IncidentStatus,
} from "../src/domain/incident-machine.js";

type Mark = "done" | "now" | "todo";
interface Journey {
  JOURNEY: string[];
  journeyMarks(status: string): Mark[] | null;
  bookingChange(prev: string | null, next: string): { announce: boolean; accepted: boolean; offersLive: boolean };
  sosExits(status: string | null): Array<{ command: string; path: string; label: string; body: Record<string, unknown> }>;
  sosActive(status: string | null): boolean;
  sosOutcome(data: Record<string, unknown> | null): {
    contacts: number; responders: number; repeat: boolean; smsLive: boolean; reached: boolean; call112: boolean;
    lines: string[];
  };
  sosHeadline(data: Record<string, unknown> | null, ref: string, t: (key: string) => string): string;
}
const J = (globalThis as unknown as { RAJourney: Journey }).RAJourney;

/**
 * The web catalogue (apps/web/i18n.js), loaded as the browser loads it: a
 * classic script run against a window. Only what it touches is provided.
 */
interface WebI18n { locales: string[]; set(l: string): string; t(k: string, f?: string): string }
function loadWebI18n(): WebI18n {
  const ctx: Record<string, unknown> = {
    navigator: { languages: [] },
    localStorage: { getItem: () => null, setItem: () => undefined },
    document: {
      readyState: "complete", querySelectorAll: () => [],
      documentElement: { setAttribute: () => undefined },
    },
    CustomEvent: class {},
    dispatchEvent: () => true,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../../web/i18n.js", import.meta.url), "utf8"), ctx);
  return ctx.I18N as WebI18n;
}

describe("the tracking timeline", () => {
  it("names only statuses the booking machine actually has", () => {
    for (const s of J.JOURNEY) assert.ok((STATUSES as readonly string[]).includes(s), s);
  });

  it("marks exactly one step as current while the job is under way", () => {
    for (const s of J.JOURNEY.filter((x) => x !== "PAID")) {
      const marks = J.journeyMarks(s)!;
      const at = J.JOURNEY.indexOf(s);
      assert.equal(marks.filter((m) => m === "now").length, 1, s);
      assert.equal(marks[at], "now", s);
      assert.ok(marks.slice(0, at).every((m) => m === "done"), `${s}: everything before is done`);
      assert.ok(marks.slice(at + 1).every((m) => m === "todo"), `${s}: everything after is to come`);
    }
  });

  it("a PAID booking is finished: Payment is done and nothing is Now", () => {
    // The demo caught a settled invoice with "Payment" still flagged NOW.
    const marks = J.journeyMarks("PAID")!;
    assert.ok(marks.every((m) => m === "done"), marks.join(","));
    assert.equal(marks[J.JOURNEY.indexOf("PAID")], "done");
  });

  it("says nothing for a status that is off the standard journey", () => {
    for (const s of ["NO_SUPPLY", "CANCELLED", "AWAITING_PARTS", "ESCALATED", "DRAFT", "nonsense"]) {
      assert.equal(J.journeyMarks(s), null, s);
    }
  });
});

describe("a booking that moves under the citizen's screen", () => {
  it("a mechanic accepting from the console is an acceptance the screen acts on", () => {
    // The demo: the console accepted, and the Assist screen kept its offers.
    const c = J.bookingChange("MATCHING", "ASSIGNED");
    assert.equal(c.accepted, true);
    assert.equal(c.offersLive, false, "listed offers are stale once someone accepted");
    assert.equal(c.announce, true);
  });

  it("still counts as accepted when the stream coalesced several moves into one read", () => {
    assert.equal(J.bookingChange("MATCHING", "EN_ROUTE").accepted, true);
    assert.equal(J.bookingChange("REQUESTED", "ASSIGNED").accepted, true);
  });

  it("a first sighting is not news: nothing announced, nobody moved between screens", () => {
    for (const s of ["ASSIGNED", "EN_ROUTE", "PAID", "MATCHING"]) {
      const c = J.bookingChange(null, s);
      assert.equal(c.announce, false, s);
      assert.equal(c.accepted, false, s);
    }
  });

  it("later moves are announced but are not a second acceptance", () => {
    for (const [a, b] of [["ASSIGNED", "EN_ROUTE"], ["IN_PROGRESS", "COMPLETED"], ["COMPLETED", "PAID"]]) {
      const c = J.bookingChange(a, b);
      assert.equal(c.announce, true, `${a}->${b}`);
      assert.equal(c.accepted, false, `${a}->${b}`);
    }
    assert.equal(J.bookingChange("EN_ROUTE", "EN_ROUTE").announce, false, "the same state twice is not a change");
  });

  it("offers are live only while matching; a cancel or no-supply is not an acceptance", () => {
    assert.equal(J.bookingChange("REQUESTED", "MATCHING").offersLive, true);
    assert.equal(J.bookingChange("NO_SUPPLY", "MATCHING").accepted, false, "widening the search");
    for (const s of ["NO_SUPPLY", "CANCELLED"]) {
      const c = J.bookingChange("MATCHING", s);
      assert.equal(c.accepted, false, s);
      assert.equal(c.offersLive, false, s);
    }
  });
});

describe("standing down an emergency", () => {
  it("offers only what the incident state machine will accept, in every state", () => {
    // The app must never show a button the server is certain to refuse.
    for (const s of INCIDENT_STATUSES) {
      for (const x of J.sosExits(s)) {
        assert.ok(allowedIncidentCommands(s as IncidentStatus).includes(x.command as "cancel" | "resolve"),
          `${x.command} from ${s}`);
        assert.doesNotThrow(() => applyIncident(s as IncidentStatus, x.command as "cancel" | "resolve"));
      }
    }
  });

  it("an escalated incident (a synced off-grid SOS) can be called off or closed as safe", () => {
    for (const s of ["CONFIRMED", "RESPONDING"]) {
      assert.deepEqual(J.sosExits(s).map((x) => x.command), ["resolve", "cancel"], s);
      assert.equal(J.sosActive(s), true, s);
    }
    const safe = J.sosExits("RESPONDING").find((x) => x.command === "resolve")!;
    assert.equal(safe.path, "/resolve");
    assert.equal(safe.label, "I'm safe now");
    assert.deepEqual(safe.body, { outcome: "self_resolved" }, "the owner closing it is not an assisted rescue");
    const cancel = J.sosExits("RESPONDING").find((x) => x.command === "cancel")!;
    assert.equal(cancel.path, "/cancel");
    assert.match(cancel.label, /false alarm/i);
  });

  it("an unconfirmed detection can only be cancelled, never 'resolved'", () => {
    for (const s of ["DETECTED", "AWAITING_CONFIRMATION"]) {
      assert.deepEqual(J.sosExits(s).map((x) => x.command), ["cancel"], s);
    }
  });

  it("a closed emergency offers nothing and is not active", () => {
    for (const s of ["RESOLVED", "CANCELLED", null, "nonsense"]) {
      assert.deepEqual(J.sosExits(s), [], String(s));
      assert.equal(J.sosActive(s), false, String(s));
    }
  });

  it("hands out copies, so a caller cannot rewrite the table", () => {
    J.sosExits("RESPONDING").pop();
    assert.equal(J.sosExits("RESPONDING").length, 2);
  });
});

describe("what an escalated SOS says happened", () => {
  // The shape POST /v1/sos/:id/confirm answers with (routes/emergency.ts).
  const UNIT = { id: "u1", name: "Gurugram PCR 4", km: 2.1 };
  // smsLive: true is a real SMS provider; the smsLive: false cases are below.
  const answer = (over: Record<string, unknown> = {}) =>
    ({ status: "RESPONDING", contactsAlerted: 0, respondersNotified: 0, smsLive: true, nearestResponder: UNIT, ...over });

  it("an escalation that reached nobody says so and puts Call 112 first", () => {
    // The bug: "Help is on the way." after a confirm that reached no contact
    // and no responder, because a unit had been located.
    const o = J.sosOutcome(answer());
    assert.deepEqual(o.lines, ["sos.done.recorded", "sos.done.none"]);
    assert.equal(o.reached, false);
    assert.equal(o.call112, true);
  });

  it("a located responder is not a contacted one, and a missing count is zero", () => {
    // An older server sends no respondersNotified at all: that is not "probably".
    const o = J.sosOutcome({ status: "RESPONDING", contactsAlerted: 0, nearestResponder: UNIT });
    assert.equal(o.responders, 0);
    assert.ok(!o.lines.includes("sos.done.responders"), o.lines.join());
    assert.equal(o.call112, true);
  });

  it("contacts are claimed only as counted, in the singular for one", () => {
    assert.deepEqual(J.sosOutcome(answer({ contactsAlerted: 1 })).lines,
      ["sos.done.recorded", "sos.done.contacts.one", "sos.done.noResponder"]);
    const three = J.sosOutcome(answer({ contactsAlerted: 3 }));
    assert.deepEqual(three.lines, ["sos.done.recorded", "sos.done.contacts", "sos.done.noResponder"]);
    assert.equal(three.contacts, 3);
    assert.equal(three.reached, true);
    assert.equal(three.call112, true, "contacts are not a responder: 112 still leads");
  });

  it("'Responders have been alerted' only when the server says it notified them", () => {
    const o = J.sosOutcome(answer({ respondersNotified: 2, contactsAlerted: 2 }));
    assert.deepEqual(o.lines, ["sos.done.recorded", "sos.done.responders", "sos.done.contacts"]);
    assert.equal(o.call112, false);
  });

  it("a repeated confirm claims nothing new, and does not say nobody was ever reached", () => {
    // The repeat answer carries contactsAlerted: 0 for THIS call; the first
    // call may well have texted them, so "no contact was reached" would be false.
    const o = J.sosOutcome(answer({ alreadyEscalated: true }));
    assert.deepEqual(o.lines, ["sos.done.recorded", "sos.done.repeat", "sos.done.noResponder"]);
  });

  it("anything that is not a count of one or more counts as zero", () => {
    for (const v of [null, undefined, "abc", -1, 0, NaN, "", {}]) {
      const o = J.sosOutcome(answer({ contactsAlerted: v, respondersNotified: v }));
      assert.equal(o.contacts, 0, String(v));
      assert.equal(o.responders, 0, String(v));
    }
    assert.deepEqual(J.sosOutcome(null).lines, ["sos.done.recorded", "sos.done.none"]);
  });

  it("on a server whose SMS is only logged, counted contacts 'would be texted' and nobody counts as reached", () => {
    // The hosted demo runs SMS_PROVIDER=console: a send is a log line. The
    // sheet said "Your 1 emergency contact was alerted" there regardless.
    const one = J.sosOutcome(answer({ contactsAlerted: 1, smsLive: false }));
    assert.deepEqual(one.lines, ["sos.done.recorded", "sos.done.contacts.logged.one", "sos.done.none"]);
    assert.equal(one.reached, false);
    assert.equal(one.smsLive, false);
    assert.deepEqual(J.sosOutcome(answer({ contactsAlerted: 3, smsLive: false })).lines,
      ["sos.done.recorded", "sos.done.contacts.logged", "sos.done.none"]);
    // No smsLive at all (an older server) is not proof of delivery either.
    const absent = J.sosOutcome({ status: "RESPONDING", contactsAlerted: 2, respondersNotified: 0 });
    assert.ok(!absent.lines.includes("sos.done.contacts"), absent.lines.join());
    assert.equal(absent.reached, false);
  });

  it("'were alerted' only when the server says SMS is live", () => {
    const live = J.sosOutcome(answer({ contactsAlerted: 1, smsLive: true }));
    assert.deepEqual(live.lines, ["sos.done.recorded", "sos.done.contacts.one", "sos.done.noResponder"]);
    assert.equal(live.reached, true);
    for (const v of ["true", 1, "yes", null]) {
      assert.equal(J.sosOutcome(answer({ contactsAlerted: 1, smsLive: v })).smsLive, false, String(v));
    }
  });

  it("reads as specified in English, every key exists in all 8 languages, and none says help is coming", () => {
    const web = loadWebI18n();
    assert.equal(web.locales.length, 8);
    const t = (k: string) => web.t(k, "");
    web.set("en");
    assert.equal(J.sosHeadline(answer(), "ab12cd34", t),
      "Emergency recorded (ref ab12cd34). No responder or contact was reached. Call 112 now.");
    assert.equal(J.sosHeadline(answer({ contactsAlerted: 2 }), "ab12cd34", t),
      "Emergency recorded (ref ab12cd34). Your 2 emergency contacts were alerted. No responder was contacted. Call 112 now.");
    assert.equal(J.sosHeadline(answer({ contactsAlerted: 2, smsLive: false }), "ab12cd34", t),
      "Emergency recorded (ref ab12cd34). Your 2 emergency contacts would be texted. On this demo server SMS is " +
      "only logged, not sent. No responder or contact was reached. Call 112 now.");

    const cases = [answer(), answer({ contactsAlerted: 1 }), answer({ contactsAlerted: 4 }),
      answer({ respondersNotified: 1 }), answer({ alreadyEscalated: true }),
      answer({ contactsAlerted: 1, smsLive: false }), answer({ contactsAlerted: 4, smsLive: false })];
    const keys = new Set(cases.flatMap((c) => J.sosOutcome(c).lines));
    keys.add("sos.grace"); keys.add("sos.call112"); keys.add("sos.unit.found"); keys.add("sos.unit.notContacted");
    keys.add("sos.grace.logged"); keys.add("sos.contacts.logged");
    for (const locale of web.locales) {
      web.set(locale);
      for (const k of keys) {
        // t() falls back to English, so a missing key would pass silently: compare.
        const s = t(k);
        assert.ok(s, `${locale}/${k}`);
        if (locale !== "en") {
          web.set("en"); const en = t(k); web.set(locale);
          assert.notEqual(s, en, `${locale}/${k} is still English`);
        }
      }
      for (const c of cases) {
        const line = J.sosHeadline(c, "ab12cd34", t);
        assert.ok(line.includes("ab12cd34") && !/[{}]/.test(line), `${locale}: ${line}`);
        assert.doesNotMatch(line, /on the way|help is coming/i, `${locale}: ${line}`);
      }
    }
  });
});
