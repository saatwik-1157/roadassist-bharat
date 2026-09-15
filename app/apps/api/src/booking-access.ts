import { eq } from "drizzle-orm";

import * as S from "@roadassist/db";
import { db } from "./db.js";

/**
 * Who may see and drive a booking.
 *
 * Its customer, the mechanic currently assigned to it, or an admin. Checked at
 * the RESOURCE rather than the route (threat #5), and in one place so the read,
 * write and payment paths cannot drift apart — they have before, and the write
 * path ended up strictly more permissive than the read path.
 *
 * It lives in its own module because the payment routes moved out of server.ts
 * and still have to ask the same question. Two copies of this is two answers.
 */
export async function bookingAudience(
  booking: { userId: string; mechanicId: string | null },
  caller: { sub: string; roles: string[] },
): Promise<{ allowed: boolean; isAssignedMechanic: boolean }> {
  let isAssignedMechanic = false;
  if (booking.mechanicId) {
    const [mech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
      .where(eq(S.mechanics.id, booking.mechanicId)).limit(1);
    isAssignedMechanic = mech?.userId === caller.sub;
  }
  return {
    allowed: booking.userId === caller.sub || isAssignedMechanic || caller.roles.includes("admin"),
    isAssignedMechanic,
  };
}

/** The refusal every booking route sends when the caller is not that audience. */
export const notYours = { code: "forbidden", title: "That booking is not yours", retryable: false } as const;
