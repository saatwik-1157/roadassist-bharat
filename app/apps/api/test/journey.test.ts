/**
 * What the citizen app makes of a status (apps/web/journey.js).
 *
 * The literal file the browser loads is imported, not a copy, so these tests
 * pin what a phone actually shows. It is a classic script that registers itself
 * on globalThis — the same way app.html reaches it.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import "../../web/journey.js";
import { STATUSES } from "../src/domain/booking-machine.js";

type Mark = "done" | "now" | "todo";
interface Journey {
  JOURNEY: string[];
  journeyMarks(status: string): Mark[] | null;
  bookingChange(prev: string | null, next: string): { announce: boolean; accepted: boolean; offersLive: boolean };
}
const J = (globalThis as unknown as { RAJourney: Journey }).RAJourney;

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
