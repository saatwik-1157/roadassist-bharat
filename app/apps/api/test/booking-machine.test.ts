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
  allowedFrom, apply, canApply, COMMANDS, finishesJob, IllegalTransition, isCommand, STATUSES, type Command, type Status,
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

test("Object.prototype names are not commands, and never reach the table as one", () => {
  // "toString" looked up Object.prototype.toString in the transition table,
  // passed as a destination status and reached the database as a function: a
  // 500 for any client that sent it. The route now refuses them as unknown
  // (400), and the table itself reads own properties only.
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(isCommand(name), false, name);
    assert.equal(canApply("REQUESTED", name as Command), false, name);
    assert.throws(() => apply("REQUESTED", name as Command), IllegalTransition, name);
  }
  assert.deepEqual(COMMANDS.filter(isCommand), [...COMMANDS], "every real command is recognised");
});

test("a late cancel is reported as one, and claims no fee", () => {
  // Every surface used to announce "a cancellation fee applies"; nothing ever
  // recorded one (no fee in the catalogue, no invoice, no payment path for a
  // cancelled booking). The fact that a mechanic had committed is kept.
  for (const from of ["ASSIGNED", "EN_ROUTE", "ON_SITE"] as Status[]) {
    const r = apply(from, "cancel");
    assert.equal(r.lateCancellation, true, from);
    assert.equal("cancellationFee" in r, false, `${from}: no fee is recorded, so none is claimed`);
  }
  assert.equal(apply("MATCHING", "cancel").lateCancellation, false);
});
