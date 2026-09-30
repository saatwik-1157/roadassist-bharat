/**
 * The audit-chain verifier says exactly what it verified.
 *
 * It used to re-hash the oldest N entries and answer "intact" for a log of any
 * length, so every newer entry went unchecked under a green light. These pin
 * the three pure parts the fix rests on: the walk stops at the first bad entry
 * and counts only what came before it, a checkpoint is refused whenever the
 * entries under it could have changed, and the operations wording never says
 * "intact" while any entry is unverified.
 *
 * No database is touched: importing audit.ts creates a lazy client that never
 * connects unless a query runs.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  GENESIS, anchorProblem, auditChainSummary, digest, walkChain,
  type ChainReport, type ChainRow,
} from "../src/audit.js";

/** A valid chain of `n` entries, hashed exactly as `audit()` hashes them. */
function chain(n: number, prev = GENESIS): ChainRow[] {
  const rows: ChainRow[] = [];
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(Date.UTC(2026, 8, 30, 3, 0, 0, i));
    const e = {
      actorId: null, actorRole: "admin", action: "test.appended", entity: "test",
      entityId: null, before: null, after: { i, ok: true },
    };
    const hash = digest(e, createdAt.toISOString(), prev);
    rows.push({ id: `row-${i}`, createdAt, ...e, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

describe("walkChain", () => {
  it("verifies every entry of an intact chain, well past the old 2,000 cap", () => {
    const rows = chain(2500);
    const w = walkChain(rows, GENESIS);
    assert.equal(w.good, 2500);
    assert.equal(w.lastId, "row-2499");
    assert.equal(w.lastHash, rows[2499].hash);
    assert.equal(w.brokenAt, undefined);
  });

  it("finds an edit in the NEWEST entry, which the capped verifier never read", () => {
    const rows = chain(2500);
    rows[2499] = { ...rows[2499], after: { i: 2499, ok: false } };
    const w = walkChain(rows, GENESIS);
    assert.equal(w.brokenAt, "row-2499");
    assert.equal(w.reason, "content does not match its hash");
    assert.equal(w.good, 2499, "only the entries before the break count as verified");
  });

  it("reports a spliced entry as a broken link", () => {
    const rows = chain(5);
    rows.splice(2, 0, { ...rows[2], id: "forged", prevHash: "a".repeat(64), hash: "b".repeat(64) });
    const w = walkChain(rows, GENESIS);
    assert.equal(w.brokenAt, "forged");
    assert.equal(w.reason, "link does not match the previous entry");
    assert.equal(w.good, 2);
  });

  it("continues from a checkpoint hash exactly as it would from genesis", () => {
    const rows = chain(10);
    const head = walkChain(rows.slice(0, 6), GENESIS);
    const rest = walkChain(rows.slice(6), head.lastHash);
    assert.equal(head.good + rest.good, 10);
    assert.equal(rest.brokenAt, undefined);
    // …and from the wrong hash it refuses the very first entry.
    assert.equal(walkChain(rows.slice(6), GENESIS).brokenAt, "row-6");
  });
});

describe("anchorProblem", () => {
  const cp = { hash: "c".repeat(64), count: 40 };
  const fine = { hash: cp.hash, precedingCount: 40, rules: 2 };

  it("accepts a checkpoint whose entry, position and rules are unchanged", () => {
    assert.equal(anchorProblem(cp, fine), null);
  });

  it("refuses when an entry was spliced in under the checkpoint", () => {
    assert.match(anchorProblem(cp, { ...fine, precedingCount: 41 }) ?? "", /41 entries/);
  });

  it("refuses when the checkpoint entry is gone or its hash changed", () => {
    assert.match(anchorProblem(cp, { ...fine, hash: null }) ?? "", /no longer in the log/);
    assert.match(anchorProblem(cp, { ...fine, hash: "d".repeat(64) }) ?? "", /hash has changed/);
  });

  it("refuses when an append-only rule is missing, since an in-place edit is then possible", () => {
    assert.match(anchorProblem(cp, { ...fine, rules: 1 }) ?? "", /1 of the 2/);
  });
});

describe("auditChainSummary", () => {
  const base: ChainReport = {
    ok: true, checked: 10, total: 10,
    verified: { fromId: "a", toId: "j", count: 10 },
    rehashed: { fromId: "g", toId: "j", count: 4 },
    anchored: { throughId: "f", count: 6, oldestRehashAt: "2026-09-30T03:00:00.000Z", checks: "x" },
    unverified: 0, mode: "incremental",
  };

  it("says intact only when the verified range is the whole log", () => {
    const s = auditChainSummary(base);
    assert.equal(s.intact, true);
    assert.deepEqual(s.verifiedRange, base.verified);
    assert.equal(s.rehashedNow.count + (s.anchoredBy?.count ?? 0), s.verifiedRange.count);
  });

  it("never says intact while any entry is unverified, even if ok were set", () => {
    const s = auditChainSummary({ ...base, total: 12, unverified: 2 });
    assert.equal(s.intact, false);
    assert.equal(s.unverifiedEntries, 2);
  });

  it("names the break and the reason when there is one", () => {
    const s = auditChainSummary({
      ...base, ok: false, checked: 7, unverified: 3, brokenAt: "h", reason: "content does not match its hash",
      verified: { fromId: "a", toId: "g", count: 7 },
    });
    assert.equal(s.intact, false);
    assert.equal(s.brokenAt, "h");
    assert.equal(s.verifiedRange.toId, "g");
  });
});
