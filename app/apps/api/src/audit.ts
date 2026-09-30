/**
 * Tamper-evident audit log.
 *
 * Every entry hashes its own content together with the previous entry's hash,
 * so the table is a chain rather than a list: editing or deleting any historical
 * row invalidates every hash after it, and the break is detectable without
 * having to trust the database it lives in.
 *
 * That matters because the rows this protects are exactly the ones somebody
 * would have a motive to erase — chiefly who read an unconscious crash victim's
 * medical record, and what reason they gave for it (see break-glass, ADR-0005).
 * An audit trail an administrator can quietly edit is not an audit trail.
 *
 * Two constraints follow from the chain and are enforced by convention here:
 *
 *   1. Writes are serialised in-process. Two concurrent appends that both read
 *      the same tip would each chain from it and fork the sequence.
 *   2. `before`/`after` payloads must contain only strings, integers, booleans
 *      and null. They round-trip through jsonb, which reorders object keys and
 *      renormalises numbers; canonicalisation below handles the key order, but
 *      a float could still come back with different bytes than it went in with.
 */
import { createHash } from "node:crypto";
import { asc, desc, sql as raw } from "drizzle-orm";
import { db } from "./db.js";
import * as S from "@roadassist/db";

/** What the first entry chains from, so an empty table has a defined start. */
export const GENESIS = "0".repeat(64);

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  /** Verb, past tense, scoped: "medical.break_glass_read", "review.created". */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Recursively sorts object keys so the hash does not depend on key order.
 * Postgres normalises jsonb key order on storage, so an entry hashed at write
 * time would otherwise never re-hash to the same value when read back.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** The bytes an entry is identified by. Field order here is part of the format. */
export function digest(e: AuditEntry, createdAt: string, prevHash: string): string {
  return createHash("sha256").update(JSON.stringify([
    prevHash,
    createdAt,
    e.actorId ?? null,
    e.actorRole ?? null,
    e.action,
    e.entity,
    e.entityId ?? null,
    canonical(e.before ?? null),
    canonical(e.after ?? null),
  ])).digest("hex");
}

// Appends run one at a time: see constraint 1 above.
let tail: Promise<unknown> = Promise.resolve();

/**
 * The last timestamp handed out, so two appends can never share one.
 *
 * The chain is read back ordered by `(created_at, id)` — both here, to find the
 * tip, and in `verifyAuditChain`. `id` is `gen_random_uuid()`, so it carries no
 * order at all: it is a tie-break that breaks ties ARBITRARILY. Two appends
 * landing in the same millisecond therefore read back in an order unrelated to
 * the order they chained in, and the verifier reports a chain that is perfectly
 * intact as broken — on `/v1/ops/overview` and `/v1/admin/audit`, which exist
 * precisely to answer whether the trail can be believed.
 *
 * A JS `Date` has millisecond resolution and two appends against a local
 * database are comfortably faster than that, so the collision is ordinary
 * rather than exotic. Since appends are already serialised through `tail`, the
 * fix is to make the stamps strictly increasing: never earlier than the clock,
 * never equal to the one before. The skew is at most a few milliseconds and
 * only while appends are arriving faster than the clock ticks.
 *
 * This holds within a process, which is the same scope constraint 1 already
 * has. Across instances the chain needs a sequence column rather than a
 * timestamp, and that is a migration — written down here rather than implied.
 */
let lastStamp = 0;

/**
 * Appends one entry and returns its hash. Never throws into the caller's path —
 * an audit write failing must not take down the action being audited, but it is
 * logged loudly, and the gap is visible in the chain because the next entry
 * chains from the last one that did land.
 */
export function audit(entry: AuditEntry): Promise<string | null> {
  const run = tail.then(async () => {
    const [prev] = await db.select({ hash: S.auditLog.hash })
      .from(S.auditLog)
      .orderBy(desc(S.auditLog.createdAt), desc(S.auditLog.id))
      .limit(1);

    const prevHash = prev?.hash ?? GENESIS;
    const now = Date.now();
    lastStamp = now > lastStamp ? now : lastStamp + 1;
    const createdAt = new Date(lastStamp);
    const hash = digest(entry, createdAt.toISOString(), prevHash);

    await db.insert(S.auditLog).values({
      createdAt, updatedAt: createdAt,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      prevHash, hash,
    });
    return hash;
  }).catch((err) => {
    console.error("[audit] append failed — the chain now has a visible gap:", err);
    return null;
  });

  tail = run;
  return run;
}

/** One stored entry, as the verifier reads it back. */
export interface ChainRow {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  prevHash: string | null;
  hash: string;
}

/**
 * Walks consecutive entries from `prevHash` and stops at the first one whose
 * link does not match its predecessor or whose content does not match its own
 * hash. Pure, so the rule is testable without a database.
 */
export function walkChain(rows: readonly ChainRow[], prevHash: string): {
  good: number; lastId: string | null; lastHash: string; brokenAt?: string; reason?: string;
} {
  let good = 0;
  let lastId: string | null = null;
  for (const r of rows) {
    if ((r.prevHash ?? GENESIS) !== prevHash) {
      return { good, lastId, lastHash: prevHash, brokenAt: r.id, reason: "link does not match the previous entry" };
    }
    const expected = digest(
      {
        actorId: r.actorId, actorRole: r.actorRole, action: r.action,
        entity: r.entity, entityId: r.entityId, before: r.before, after: r.after,
      },
      r.createdAt.toISOString(),
      prevHash,
    );
    if (expected !== r.hash) {
      return { good, lastId, lastHash: prevHash, brokenAt: r.id, reason: "content does not match its hash" };
    }
    prevHash = r.hash;
    lastId = r.id;
    good++;
  }
  return { good, lastId, lastHash: prevHash };
}

/** A contiguous run of entries, in chain order. */
export interface ChainRange { fromId: string | null; toId: string | null; count: number }

/**
 * What a verification established, and exactly how far.
 *
 * The verifier used to re-hash the first N rows (2,000 on the operations view,
 * 5,000 on the audit endpoint) and answer `ok: true`. Once the log outgrew N,
 * every newer entry — the ones most likely to matter — went unchecked while the
 * answer still read "intact". A report now names its range, and `ok` is true
 * only when that range is the whole log as it stood when the check began.
 */
export interface ChainReport {
  /** Every entry present when the check began is verified, and none is broken. */
  ok: boolean;
  /** Entries verified, genesis onward: `verified.count`. */
  checked: number;
  /** Entries in the log when the check began. */
  total: number;
  /** The run from the first entry that is verified: anchored + re-hashed now. */
  verified: ChainRange;
  /** The part of `verified` this call actually re-hashed. */
  rehashed: ChainRange;
  /**
   * The part of `verified` covered by the checkpoint instead of re-hashed now.
   * Those entries were re-hashed by this process no earlier than
   * `oldestRehashAt`, and this call confirmed the checkpoint entry still holds
   * the same hash, the same number of entries precede it, and both append-only
   * rules are in place. Null when the whole chain was re-hashed.
   */
  anchored: { throughId: string; count: number; oldestRehashAt: string; checks: string } | null;
  /** Entries NOT verified: everything from a break onward. Zero when `ok`. */
  unverified: number;
  mode: "full" | "incremental";
  /** Why a checkpoint was refused and the chain re-hashed from genesis instead. */
  anchorRejected?: string;
  brokenAt?: string;
  reason?: string;
}

/** The last entry this process verified, and how it got there. */
interface Checkpoint {
  id: string; hash: string; count: number; firstId: string;
  /** When the walk that last started from genesis ran — the oldest re-hash in the prefix. */
  genesisWalkAt: Date;
}
let checkpoint: Checkpoint | null = null;

const ANCHOR_CHECKS = "checkpoint hash unchanged, preceding entry count unchanged, append-only rules in place";

/**
 * Whether a checkpoint can still stand in for re-hashing the entries under it.
 *
 * The rules make UPDATE and DELETE do nothing, so with both in place the only
 * mutation left is INSERT — and an entry spliced in under the checkpoint
 * changes how many entries precede it. A missing rule means an in-place edit
 * is possible, which the count would not show, so the whole chain is re-hashed.
 */
export function anchorProblem(
  cp: { hash: string; count: number },
  seen: { hash: string | null; precedingCount: number; rules: number },
): string | null {
  if (seen.rules < 2) return `only ${seen.rules} of the 2 append-only rules are in place`;
  if (seen.hash === null) return "the checkpoint entry is no longer in the log";
  if (seen.hash !== cp.hash) return "the checkpoint entry's hash has changed";
  if (seen.precedingCount !== cp.count) {
    return `${seen.precedingCount} entries now run through the checkpoint, not ${cp.count}`;
  }
  return null;
}

const PAGE = 1000;
let verifying: Promise<unknown> = Promise.resolve();

/**
 * Verifies the WHOLE chain and says exactly what it verified.
 *
 * Incremental by default: re-hashes only the entries after the last verified
 * checkpoint, once the checkpoint passes `anchorProblem`, and reports the two
 * parts separately. `full: true` ignores the checkpoint and re-hashes from the
 * first entry, which is what the audit endpoint does on every read. Reads in
 * the same order appends used, which is what makes the two agree, inside one
 * read-only snapshot so an append landing mid-check cannot be half-counted.
 * Runs one at a time, so two callers never race on the checkpoint.
 *
 * The checkpoint lives in memory: a restart re-hashes from genesis once.
 */
export function verifyAuditChain(opts: { full?: boolean } = {}): Promise<ChainReport> {
  const run = verifying.then(() => verifyOnce(opts.full === true));
  verifying = run.catch(() => undefined);
  return run;
}

async function verifyOnce(full: boolean): Promise<ChainReport> {
  const startedAt = new Date();
  return db.transaction(async (tx) => {
    const [{ total }] = await tx.select({ total: raw<number>`count(*)::int` }).from(S.auditLog);

    let start: Checkpoint | null = null;
    let anchorRejected: string | undefined;
    if (!full && checkpoint) {
      const cp = checkpoint;
      const [seen] = await tx.execute<{ hash: string | null; preceding: number; rules: number }>(raw`
        SELECT (SELECT hash FROM audit_log WHERE id = ${cp.id}) AS hash,
               (SELECT count(*)::int FROM audit_log a
                 WHERE (a.created_at, a.id) <= (SELECT c.created_at, c.id FROM audit_log c WHERE c.id = ${cp.id})
               ) AS preceding,
               (SELECT count(*)::int FROM pg_rules WHERE tablename = 'audit_log'
                  AND rulename IN ('audit_log_no_update', 'audit_log_no_delete')) AS rules`);
      anchorRejected = anchorProblem(cp, {
        hash: seen?.hash ?? null, precedingCount: Number(seen?.preceding ?? 0), rules: Number(seen?.rules ?? 0),
      }) ?? undefined;
      if (!anchorRejected) start = cp;
    }

    let prevHash = start?.hash ?? GENESIS;
    let cursor = start?.id ?? null;
    let good = start?.count ?? 0;
    let firstId = start?.firstId ?? null;
    let rehashFrom: string | null = null;
    let rehashTo: string | null = null;
    let rehashed = 0;
    let broken: { brokenAt?: string; reason?: string } = {};

    for (;;) {
      const page = await tx.select().from(S.auditLog)
        .where(cursor
          ? raw`(${S.auditLog.createdAt}, ${S.auditLog.id}) >
                (SELECT c.created_at, c.id FROM audit_log c WHERE c.id = ${cursor})`
          : undefined)
        .orderBy(asc(S.auditLog.createdAt), asc(S.auditLog.id))
        .limit(PAGE);
      if (!page.length) break;

      const walked = walkChain(page, prevHash);
      if (walked.good) {
        rehashFrom ??= page[0].id;
        firstId ??= page[0].id;
        rehashTo = walked.lastId;
        rehashed += walked.good;
        good += walked.good;
        prevHash = walked.lastHash;
        cursor = walked.lastId;
      }
      if (walked.brokenAt) { broken = { brokenAt: walked.brokenAt, reason: walked.reason }; break; }
      if (page.length < PAGE) break;
    }

    // The checkpoint always moves to the last entry that verified, including
    // BACK, when a full walk finds a break under where it used to be.
    const lastGood = rehashTo ?? start?.id ?? null;
    checkpoint = lastGood && firstId ? {
      id: lastGood, hash: prevHash, count: good, firstId,
      genesisWalkAt: start ? start.genesisWalkAt : startedAt,
    } : null;

    const ok = !broken.brokenAt && good === total;
    return {
      ok, checked: good, total,
      verified: { fromId: good ? firstId : null, toId: lastGood, count: good },
      rehashed: { fromId: rehashFrom, toId: rehashTo, count: rehashed },
      anchored: start ? {
        throughId: start.id, count: start.count,
        oldestRehashAt: start.genesisWalkAt.toISOString(), checks: ANCHOR_CHECKS,
      } : null,
      unverified: total - good,
      mode: start ? "incremental" : "full",
      ...(anchorRejected ? { anchorRejected } : {}),
      ...broken,
    } satisfies ChainReport;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * The operations view's wording of a report. `intact` is claimed only for a
 * range that is the whole log; anything short of that says how short.
 */
export function auditChainSummary(r: ChainReport) {
  return {
    intact: r.ok && r.unverified === 0,
    entriesChecked: r.checked,
    totalEntries: r.total,
    unverifiedEntries: r.unverified,
    verifiedRange: r.verified,
    rehashedNow: r.rehashed,
    anchoredBy: r.anchored,
    mode: r.mode,
    ...(r.anchorRejected ? { anchorRejected: r.anchorRejected } : {}),
    ...(r.brokenAt ? { brokenAt: r.brokenAt, reason: r.reason } : {}),
  };
}
