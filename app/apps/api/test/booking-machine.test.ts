/**
 * The booking state machine, and the one property the mechanic's job counter
 * depends on.
 *
 * `mechanics.jobs_completed` is incremented when a booking enters COMPLETED,
 * inside the same guarded transaction as the status write, and nowhere else.
 * That is only "once per booking" if the table itself makes COMPLETED
 * enterable once. These tests pin that, so a future edge added to the table
 * (a "reopen", a "rework") fails here instead of silently double-counting a
 * mechanic's record — the counter feeds dispatch's newcomer bonus.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  allowedFrom, apply, canApply, finishesJob, IllegalTransition, STATUSES, type Status,
} from "../src/domain/booking-machine.js";

/** Every status reachable from `start` by one or more legal commands. */
function reachableFrom(start: Status): Set<Status> {
  const seen = new Set<Status>();
  const queue: Status[] = [start];
  while (queue.length) {
    const from = queue.shift()!;
    for (const command of allowedFrom(from)) {
      const { to } = apply(from, command);
      if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  return seen;
}

test("exactly one status finishes a job, and it is COMPLETED", () => {
  assert.deepEqual(STATUSES.filter(finishesJob), ["COMPLETED"]);
});

test("COMPLETED has one way in: work.complete from IN_PROGRESS", () => {
  const entries: string[] = [];
  for (const from of STATUSES) {
    for (const command of allowedFrom(from)) {
      if (apply(from, command).to === "COMPLETED") entries.push(`${from} --${command}-->`);
    }
  }
  assert.deepEqual(entries, ["IN_PROGRESS --work.complete-->"]);
});

test("a booking can never re-enter COMPLETED, so the job counts once", () => {
  assert.equal(reachableFrom("COMPLETED").has("COMPLETED"), false,
    "a path back into COMPLETED would count the same booking twice");
});

test("a replayed work.complete is refused before anything is counted", () => {
  assert.equal(canApply("COMPLETED", "work.complete"), false);
  assert.throws(() => apply("COMPLETED", "work.complete"), IllegalTransition);
  assert.throws(() => apply("PAID", "work.complete"), IllegalTransition);
});

test("payment settles a completed job without finishing it a second time", () => {
  const { to } = apply("COMPLETED", "payment.settled");
  assert.equal(to, "PAID");
  assert.equal(finishesJob(to), false, "PAID must not count the job again");
});

test("a cancelled booking never counts as a job done", () => {
  for (const from of STATUSES) {
    if (!canApply(from, "cancel")) continue;
    assert.equal(finishesJob(apply(from, "cancel").to), false, `cancel from ${from}`);
  }
  assert.equal(reachableFrom("CANCELLED").size, 0, "CANCELLED is terminal");
});
