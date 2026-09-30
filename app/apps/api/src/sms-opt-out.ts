/**
 * The opt-out store behind the SMS line's STOP and START (sms_opt_outs,
 * migration 0007). The rule — what STOP stops and why emergency-contact alerts
 * are included — is in domain/sms-consent.ts.
 */
import { and, eq, inArray, isNull, sql as raw } from "drizzle-orm";

import * as S from "@roadassist/db";
import { db } from "./db.js";

/**
 * The subset of `msisdns` that has opted out and not opted back in.
 *
 * Called on the emergency path, so a failure to read the list must not become
 * a failure to escalate: if the table cannot be read (a database that has not
 * run migration 0007, say) nobody is treated as opted out and the failure is
 * logged loudly. Texting a contact who said STOP is the lesser wrong next to
 * an SOS that alerts nobody because a consent lookup threw.
 */
export async function optedOutAmong(msisdns: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(msisdns)];
  if (unique.length === 0) return new Set();
  try {
    const rows = await db.select({ msisdn: S.smsOptOuts.msisdn }).from(S.smsOptOuts)
      .where(and(inArray(S.smsOptOuts.msisdn, unique),
                 isNull(S.smsOptOuts.optedBackInAt), isNull(S.smsOptOuts.deletedAt)));
    return new Set(rows.map((r) => r.msisdn));
  } catch (err) {
    console.error(JSON.stringify({ level: "error", op: "sms.opt_out.lookup",
      msg: "opt-out list unreadable; nobody treated as opted out",
      err: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
    return new Set();
  }
}

/**
 * Record a STOP. Idempotent: a second STOP restamps the time and keeps the one
 * row, and a STOP after a START re-opens the opt-out.
 */
export async function recordOptOut(msisdn: string, keyword: string): Promise<void> {
  await db.insert(S.smsOptOuts).values({ msisdn, keyword: keyword.slice(0, 16) })
    .onConflictDoUpdate({
      target: S.smsOptOuts.msisdn,
      set: {
        keyword: keyword.slice(0, 16), optedOutAt: new Date(), optedBackInAt: null,
        deletedAt: null, updatedAt: new Date(), version: raw`${S.smsOptOuts.version} + 1`,
      },
    });
}

/** Record a START. Returns whether the number had actually been opted out. */
export async function recordOptIn(msisdn: string): Promise<boolean> {
  const rows = await db.update(S.smsOptOuts)
    .set({ optedBackInAt: new Date(), updatedAt: new Date(), version: raw`${S.smsOptOuts.version} + 1` })
    .where(and(eq(S.smsOptOuts.msisdn, msisdn), isNull(S.smsOptOuts.optedBackInAt),
               isNull(S.smsOptOuts.deletedAt)))
    .returning({ id: S.smsOptOuts.id });
  return rows.length > 0;
}
