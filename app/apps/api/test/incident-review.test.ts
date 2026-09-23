/**
 * The review window on an unconfirmed incident (ADR-0011).
 *
 * The rule these protect is the one the state machine could not express: a
 * model-detected crash waits for a human, and until now it could wait forever.
 * The assertions that matter here are not "does five minutes equal five
 * minutes" — they are the two ways this goes wrong in the field. Nothing in
 * this file may open a path to dispatch, and an incident that has been ignored
 * must outrank a fresh one however serious the fresh one looks.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  AWAITING_REVIEW_STATUS,
  REVIEW_SLA_MINUTES,
  assessReview,
  compareReviewUrgency,
  isReviewOverdue,
  reviewDeadline,
  type IncidentSeverity,
} from "../src/domain/incident-review.js";
import { INCIDENT_STATUSES, allowedIncidentCommands } from "../src/domain/incident-machine.js";

const T0 = new Date("2026-09-23T03:00:00.000Z");
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

describe("ADR-0005 is not weakened by ADR-0011", () => {
  it("being overdue opens no new way out of AWAITING_CONFIRMATION", () => {
    // The whole point of deriving overdue-ness rather than storing it: the
    // transition table is untouched, so there is still no path to RESPONDING
    // that skips a human.
    assert.deepEqual(allowedIncidentCommands("AWAITING_CONFIRMATION").sort(), ["cancel", "confirm"]);
  });

  it("the status this module watches is a real one", () => {
    assert.ok((INCIDENT_STATUSES as readonly string[]).includes(AWAITING_REVIEW_STATUS));
  });

  it("nothing here can move an incident at all — it only reports", () => {
    const a = assessReview(AWAITING_REVIEW_STATUS, T0, "CRITICAL", at(999));
    assert.equal(a.state, "OVERDUE");
    // An assessment is a reading, not a command: there is no status on it.
    assert.equal("status" in a, false);
    assert.equal("to" in a, false);
  });
});

describe("the window itself", () => {
  it("every severity has one, and more serious means less waiting", () => {
    const order: IncidentSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    for (const s of order) assert.equal(typeof REVIEW_SLA_MINUTES[s], "number");
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        REVIEW_SLA_MINUTES[order[i - 1]] < REVIEW_SLA_MINUTES[order[i]],
        `${order[i - 1]} must be reviewed sooner than ${order[i]}`,
      );
    }
  });

  it("the deadline is the raise time plus the window", () => {
    assert.deepEqual(reviewDeadline(T0, "CRITICAL"), at(REVIEW_SLA_MINUTES.CRITICAL));
    assert.deepEqual(reviewDeadline(T0, "LOW"), at(REVIEW_SLA_MINUTES.LOW));
  });

  it("a signal inside its window is waiting, not late", () => {
    const a = assessReview(AWAITING_REVIEW_STATUS, T0, "HIGH", at(14));
    assert.equal(a.state, "WITHIN_SLA");
    assert.equal(a.waitedMinutes, 14);
    assert.equal(a.minutesToDeadline, 1);
  });

  it("exactly at the deadline is already overdue", () => {
    // The window is what it may wait, not what it may wait and then some. An
    // off-by-one here is a signal that is never late until a minute after it is.
    assert.equal(assessReview(AWAITING_REVIEW_STATUS, T0, "HIGH", at(15)).state, "OVERDUE");
    assert.equal(assessReview(AWAITING_REVIEW_STATUS, T0, "HIGH", at(14.9)).state, "WITHIN_SLA");
  });

  it("past the deadline the remaining time goes negative rather than clamping", () => {
    const a = assessReview(AWAITING_REVIEW_STATUS, T0, "CRITICAL", at(20));
    assert.equal(a.state, "OVERDUE");
    assert.equal(a.waitedMinutes, 20);
    assert.ok(a.minutesToDeadline !== null && a.minutesToDeadline < 0);
  });
});

describe("what is not waiting on anybody", () => {
  it("a confirmed, responding, resolved or cancelled incident is never overdue", () => {
    for (const status of INCIDENT_STATUSES) {
      if (status === AWAITING_REVIEW_STATUS) continue;
      const a = assessReview(status, T0, "CRITICAL", at(10_000));
      assert.equal(a.state, "NOT_AWAITING", `${status} should not be in the queue`);
      assert.equal(a.deadline, null);
      assert.equal(a.waitedMinutes, 0);
      assert.equal(isReviewOverdue(status, T0, "CRITICAL", at(10_000)), false);
    }
  });
});

describe("a clock that disagrees with itself", () => {
  it("a timestamp in the future reads as zero waited, not negative", () => {
    // Devices set their own clocks. A negative wait would sort a fresh incident
    // above a breached one, which is the one thing the queue exists to prevent.
    const a = assessReview(AWAITING_REVIEW_STATUS, at(30), "HIGH", T0);
    assert.equal(a.waitedMinutes, 0);
    assert.equal(a.state, "WITHIN_SLA");
  });
});

describe("queue order surfaces what has been ignored", () => {
  const row = (severity: IncidentSeverity, raisedMinsAgo: number, now = at(60)) => ({
    severity,
    assessment: assessReview(AWAITING_REVIEW_STATUS, at(60 - raisedMinsAgo), severity, now),
  });

  it("anything overdue outranks anything still inside its window", () => {
    const overdueLow = row("LOW", 0);
    const freshCritical = row("CRITICAL", 0);
    // LOW waits 240 minutes, so force it past its own deadline.
    const reallyOverdueLow = {
      severity: "LOW" as const,
      assessment: assessReview(AWAITING_REVIEW_STATUS, T0, "LOW", at(300)),
    };
    assert.ok(compareReviewUrgency(reallyOverdueLow, freshCritical) < 0);
    void overdueLow;
  });

  it("among overdue signals the longest-ignored comes first", () => {
    const older = row("HIGH", 50);
    const newer = row("CRITICAL", 20);
    assert.ok(compareReviewUrgency(older, newer) < 0,
      "a HIGH ignored for 50 minutes outranks a CRITICAL ignored for 20");
  });

  it("severity breaks a tie and nothing more", () => {
    const high = row("HIGH", 30);
    const critical = row("CRITICAL", 30);
    assert.ok(compareReviewUrgency(critical, high) < 0);
  });

  it("sorting a mixed queue puts the neglected at the top", () => {
    const rows = [row("CRITICAL", 1), row("LOW", 45), row("HIGH", 40), row("MEDIUM", 2)];
    const sorted = [...rows].sort(compareReviewUrgency);
    assert.equal(sorted[0].assessment.state, "OVERDUE");
    assert.ok(sorted[0].assessment.waitedMinutes >= sorted[1].assessment.waitedMinutes
      || sorted[1].assessment.state !== "OVERDUE");
    assert.equal(sorted[sorted.length - 1].assessment.state, "WITHIN_SLA");
  });
});
