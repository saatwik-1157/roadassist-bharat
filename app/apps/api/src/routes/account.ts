/**
 * Self-serve account deletion and Unlink Google.
 *
 *   POST   /v1/me/delete   delete the signed-in citizen account   { confirm: "DELETE MY ACCOUNT" }
 *   DELETE /v1/me/google   unlink the Google account (needs a verified phone)
 *
 * The rules - who may, the phrase, the fresh sign-in, what blocks it - are
 * in domain/account-deletion.ts. What is deleted, what is kept and why is in
 * app/docs/SECURITY.md ("Deleting an account") and privacy.html section 9;
 * this file is the one place it happens, in ONE transaction:
 *
 *   ended     every session (revoked as account_deleted; ip and user agent
 *             scrubbed; the rows stay so a still-unexpired access token
 *             finds its sid refused)
 *   deleted   emergency contacts and their Telegram links and invite codes,
 *             devices and push tokens, medical profile, notification
 *             channels, Google nonces, idempotency records, the number's
 *             OTP challenges, vehicle documents and the vehicle links
 *   scrubbed  the user row (phone, name, email, Google sub and email freed or
 *             cleared, deleted_at set); vehicles only this account had
 *             (plate replaced so it can be registered again, nickname
 *             cleared); bookings' address, symptoms, marker and position;
 *             review comments; diagnosis symptom text; offline-sync
 *             payloads; free text in SOS signals
 *   detached  incidents (user_id NULL; the record and its position stay for
 *             whoever responded); citizen hazard reports (reportedBy removed)
 *   kept      bookings, invoices and payments (the mechanic's record of work
 *             and money), review ratings (the mechanic's score), consents
 *             (the record that processing had a basis), the audit log
 *             (append-only and hash-chained: rewriting it would break the
 *             chain that proves nothing else was rewritten), SMS opt-outs
 *             (keyed by the number, protecting it from texts)
 *
 * Idempotent: the user row is locked FOR UPDATE, so of two deletes racing,
 * the second waits and then finds deleted_at set and changes nothing; a
 * repeat with the old token is refused by authenticate (401 AUTH_REVOKED,
 * reason account_deleted). The audit entry is written after the commit by
 * the audit chain's own serial writer (audit.ts), as every route does.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, inArray, isNull, notInArray, sql as raw } from "drizzle-orm";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { ok } from "../http.js";
import { audit } from "../audit.js";
import { authenticate, rolesFor } from "../auth.js";
import { endSessionStreams } from "../realtime.js";
import { emailSignin } from "./email-auth.js";
import { phonePolicy } from "./auth.js";
import { env } from "../env.js";
import { demoRestrictionsApply, isDemoNumber } from "../domain/demo-numbers.js";
import {
  ACCOUNT_DELETED_REASON, CLOSED_INCIDENT_STATUSES, DELETION_STATUS, DELETION_TITLES,
  SETTLED_BOOKING_STATUSES, anonymisedPlate, deletionRefusal, selfDeleteRefusal, unlinkDecision,
  type DeletionRefusal,
} from "../domain/account-deletion.js";

const refuse = (reply: FastifyReply, reason: DeletionRefusal | "phone_required", status: number, requestId: string) =>
  reply.code(status).send({ error: { code: reason, title: DELETION_TITLES[reason], retryable: false, requestId } });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Open bookings and open incidents of `userId`, counted inside `tx`. */
async function openWork(tx: Tx | typeof db, userId: string) {
  const [b] = await tx.select({ n: raw<number>`count(*)::int` }).from(S.bookings)
    .where(and(eq(S.bookings.userId, userId), isNull(S.bookings.deletedAt),
               notInArray(S.bookings.status, SETTLED_BOOKING_STATUSES as typeof S.bookings.status.enumValues)));
  const [i] = await tx.select({ n: raw<number>`count(*)::int` }).from(S.incidents)
    .where(and(eq(S.incidents.userId, userId), isNull(S.incidents.deletedAt),
               notInArray(S.incidents.status, CLOSED_INCIDENT_STATUSES as typeof S.incidents.status.enumValues)));
  return { openBookings: b?.n ?? 0, openIncidents: i?.n ?? 0 };
}

/** When the caller's sign-in began: the first session of its refresh-token family. */
async function signInStartedAt(sid: string): Promise<Date | null> {
  const [row] = await db.execute<{ started: string | Date | null }>(raw`
    SELECT min(s.created_at) AS started FROM sessions s
     WHERE s.family_id = (SELECT family_id FROM sessions WHERE id = ${sid})`);
  return row?.started ? new Date(row.started) : null;
}

/** Whether this account may delete itself from the app (GET /v1/me says so as `selfDelete`). */
export async function canSelfDelete(userId: string, roles: string[]): Promise<boolean> {
  const [u] = await db.select({ msisdn: S.users.msisdn }).from(S.users).where(eq(S.users.id, userId)).limit(1);
  if (!u || selfDeleteRefusal({ roles, msisdn: u.msisdn }, emailSignin.protectedNumbers) !== null) return false;
  return !(u.msisdn && isDemoNumber(u.msisdn) && demoRestrictionsApply({ nodeEnv: env.nodeEnv, policy: phonePolicy() }));
}

/** Everything the deletion does, in the caller's transaction. Returns what it touched, for the audit row. */
async function eraseAccount(tx: Tx, userId: string, msisdn: string | null) {
  const now = new Date();
  const counts: Record<string, number> = {};
  const n = (rows: unknown[]) => rows.length;

  // Sessions: ended, and stripped of where they came from.
  const ended = await tx.update(S.sessions)
    .set({ revokedAt: raw`coalesce(${S.sessions.revokedAt}, now())`, revokedReason: ACCOUNT_DELETED_REASON,
           ip: null, userAgent: null, deviceId: null, updatedAt: now })
    .where(eq(S.sessions.userId, userId)).returning({ id: S.sessions.id });
  counts.sessionsEnded = n(ended);

  counts.devicesDeleted = n(await tx.delete(S.devices).where(eq(S.devices.userId, userId)).returning({ id: S.devices.id }));

  // Emergency contacts, with their Telegram chats and invite codes.
  const contacts = await tx.select({ id: S.emergencyContacts.id, chat: S.emergencyContacts.telegramChatId })
    .from(S.emergencyContacts).where(eq(S.emergencyContacts.userId, userId));
  const contactIds = contacts.map((c) => c.id);
  counts.telegramLinksRemoved = contacts.filter((c) => c.chat).length;
  if (contactIds.length) {
    await tx.delete(S.telegramLinkCodes).where(inArray(S.telegramLinkCodes.contactId, contactIds));
    await tx.delete(S.emergencyContacts).where(inArray(S.emergencyContacts.id, contactIds));
  }
  counts.contactsDeleted = contactIds.length;

  await tx.delete(S.googleAuthNonces).where(eq(S.googleAuthNonces.linkUserId, userId));
  await tx.delete(S.medicalProfiles).where(eq(S.medicalProfiles.userId, userId));
  await tx.delete(S.notificationChannels).where(eq(S.notificationChannels.userId, userId));
  await tx.delete(S.idempotencyKeys).where(eq(S.idempotencyKeys.userId, userId));
  if (msisdn) await tx.delete(S.otpChallenges).where(eq(S.otpChallenges.msisdn, msisdn));

  // Vehicles: the links go; a vehicle nobody else is linked to (and no fleet
  // owns) loses its documents, plate and nickname. It is not deleted, because
  // past bookings and incidents still point at it.
  const linked = await tx.select({ vehicleId: S.userVehicles.vehicleId }).from(S.userVehicles)
    .where(eq(S.userVehicles.userId, userId));
  await tx.delete(S.userVehicles).where(eq(S.userVehicles.userId, userId));
  let anonymised = 0;
  for (const { vehicleId } of linked) {
    const [others] = await tx.select({ n: raw<number>`count(*)::int` }).from(S.userVehicles)
      .where(eq(S.userVehicles.vehicleId, vehicleId));
    const [v] = await tx.select({ fleetId: S.vehicles.fleetId }).from(S.vehicles).where(eq(S.vehicles.id, vehicleId)).limit(1);
    if ((others?.n ?? 0) > 0 || v?.fleetId) continue;
    await tx.delete(S.vehicleDocuments).where(eq(S.vehicleDocuments.vehicleId, vehicleId));
    await tx.update(S.vehicles)
      .set({ registrationNo: anonymisedPlate(vehicleId), nickname: null, deletedAt: now, updatedAt: now })
      .where(eq(S.vehicles.id, vehicleId));
    anonymised++;
  }
  counts.vehiclesAnonymised = anonymised;
  await tx.update(S.diagnosticSessions).set({ userId: null, symptomsText: null, updatedAt: now })
    .where(eq(S.diagnosticSessions.userId, userId));

  // Bookings stay (the mechanic's record of work and money); what the
  // customer typed and where they were does not.
  counts.bookingsScrubbed = n(await tx.update(S.bookings)
    .set({ addressText: null, symptoms: null, highwayMarker: null, location: null, updatedAt: now })
    .where(eq(S.bookings.userId, userId)).returning({ id: S.bookings.id }));
  await tx.update(S.reviews).set({ comment: null, updatedAt: now }).where(eq(S.reviews.userId, userId));
  await tx.update(S.syncOperations).set({ payload: {}, updatedAt: now }).where(eq(S.syncOperations.userId, userId));

  // SOS history stays for whoever responded, detached from the person; the
  // free text the person typed or texted goes.
  const incidents = await tx.update(S.incidents).set({ userId: null, vehicleId: null, updatedAt: now })
    .where(eq(S.incidents.userId, userId)).returning({ id: S.incidents.id });
  counts.incidentsDetached = incidents.length;
  if (incidents.length) {
    await tx.update(S.incidentSignals)
      .set({ payload: raw`${S.incidentSignals.payload} - 'note' - 'text'`, updatedAt: now })
      .where(inArray(S.incidentSignals.incidentId, incidents.map((i) => i.id)));
  }
  // Hazard reports are public road data: they stay, without the reporter.
  const reports = await tx.execute<{ id: string }>(raw`
    UPDATE raksha_detections SET raw = raw - 'reportedBy', updated_at = now()
     WHERE raw->>'reportedBy' = ${userId} RETURNING id`);
  counts.hazardReportsDetached = reports.length;

  await tx.update(S.userRoles).set({ deletedAt: now, updatedAt: now })
    .where(and(eq(S.userRoles.userId, userId), isNull(S.userRoles.deletedAt)));

  // Last, the row itself: the phone number and Google sub are freed so either
  // can sign up again as a NEW account, which can see none of this.
  await tx.update(S.users).set({
    msisdn: null, fullName: null, email: null, googleSub: null, googleEmail: null,
    isVerified: false, lastSeenAt: null, preferredLanguage: "en", deletedAt: now, updatedAt: now,
  }).where(eq(S.users.id, userId));

  return { counts, sessionIds: ended.map((s) => s.id) };
}

export async function accountRoutes(app: FastifyInstance) {
  app.post("/v1/me/delete", { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.sub;
    const [user] = await db.select({ msisdn: S.users.msisdn, deletedAt: S.users.deletedAt })
      .from(S.users).where(eq(S.users.id, userId)).limit(1);
    if (!user) return refuse(reply, "privileged_account", 403, String(req.id));
    if (user.deletedAt) return ok({ deleted: true, alreadyDeleted: true });

    const roles = await rolesFor(db, userId);
    const why = deletionRefusal({
      account: { roles, msisdn: user.msisdn },
      protectedNumbers: emailSignin.protectedNumbers,
      phrase: (req.body as { confirm?: unknown } | undefined)?.confirm,
      signInStartedAt: req.user!.sid ? await signInStartedAt(req.user!.sid) : null,
      now: new Date(),
      ...(await openWork(db, userId)),
      sharedDemo: Boolean(user.msisdn) && isDemoNumber(user.msisdn!) &&
        demoRestrictionsApply({ nodeEnv: env.nodeEnv, policy: phonePolicy() }),
    });
    if (why) return refuse(reply, why, DELETION_STATUS[why], String(req.id));

    const outcome = await db.transaction(async (tx) => {
      // The lock that makes this idempotent: a second delete waits here, then sees deleted_at.
      const [locked] = await tx.select({ msisdn: S.users.msisdn, deletedAt: S.users.deletedAt })
        .from(S.users).where(eq(S.users.id, userId)).limit(1).for("update");
      if (!locked || locked.deletedAt) return { already: true as const };
      // Re-checked under the lock: a booking made a moment ago must not be scrubbed mid-job.
      const open = await openWork(tx, userId);
      if (open.openBookings) return { refused: "active_booking" as const };
      if (open.openIncidents) return { refused: "active_sos" as const };
      return { done: await eraseAccount(tx, userId, locked.msisdn) };
    });
    if ("already" in outcome) return ok({ deleted: true, alreadyDeleted: true });
    if ("refused" in outcome && outcome.refused) {
      return refuse(reply, outcome.refused, DELETION_STATUS[outcome.refused], String(req.id));
    }
    const { counts, sessionIds } = outcome.done!;
    // Live event streams opened under any of those sessions end now (realtime.ts).
    endSessionStreams(sessionIds);
    // No phone number, name or address in the audit row: the subject id and the counts.
    await audit({
      actorId: userId, actorRole: "citizen", action: "account.deleted", entity: "user", entityId: userId,
      after: { ...counts, via: "self_serve" }, ip: req.ip,
    });
    return ok({ deleted: true, alreadyDeleted: false, ...counts });
  });

  app.delete("/v1/me/google", { preHandler: authenticate }, async (req, reply) => {
    const userId = req.user!.sub;
    const [user] = await db.select({
      msisdn: S.users.msisdn, isVerified: S.users.isVerified, googleSub: S.users.googleSub, deletedAt: S.users.deletedAt,
    }).from(S.users).where(eq(S.users.id, userId)).limit(1);
    if (!user || user.deletedAt) return refuse(reply, "privileged_account", 403, String(req.id));
    const decision = unlinkDecision(user);
    if (decision.action === "nothing") return ok({ unlinked: false });
    if (decision.action === "refuse") return refuse(reply, decision.reason, 409, String(req.id));
    // Conditional on the phone still being there, so a race cannot leave an account with neither.
    const [done] = await db.update(S.users).set({ googleSub: null, googleEmail: null, updatedAt: new Date() })
      .where(and(eq(S.users.id, userId), eq(S.users.isVerified, true), raw`${S.users.msisdn} IS NOT NULL`))
      .returning({ id: S.users.id });
    if (!done) return refuse(reply, "phone_required", 409, String(req.id));
    await audit({
      actorId: userId, actorRole: "citizen", action: "auth.google.unlinked", entity: "user", entityId: userId,
      after: { via: "self_serve" }, ip: req.ip,
    });
    return ok({ unlinked: true });
  });
}
