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
import { asc, desc } from "drizzle-orm";
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
function digest(e: AuditEntry, createdAt: string, prevHash: string): string {
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

/**
 * Re-hashes the chain from the beginning and reports the first entry whose
 * stored hash does not match its content, or whose link does not match its
 * predecessor. Reads in the same order appends used, which is what makes the
 * two agree.
 */
export async function verifyAuditChain(limit = 5000): Promise<{
  ok: boolean; checked: number; brokenAt?: string; reason?: string;
}> {
  const rows = await db.select().from(S.auditLog)
    .orderBy(asc(S.auditLog.createdAt), asc(S.auditLog.id))
    .limit(limit);

  let prevHash = GENESIS;
  let checked = 0;
  for (const r of rows) {
    if ((r.prevHash ?? GENESIS) !== prevHash) {
      return { ok: false, checked, brokenAt: r.id, reason: "link does not match the previous entry" };
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
      return { ok: false, checked, brokenAt: r.id, reason: "content does not match its hash" };
    }
    prevHash = r.hash;
    checked++;
  }
  return { ok: true, checked };
}
