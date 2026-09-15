/**
 * The feature-phone path: a complete journey over SMS, with no app at all.
 *
 * Lifted out of server.ts unchanged. It earns its own module for the reason
 * the auth and emergency groups did — this is a contract with two other pieces
 * of code that must change together (Emergency.smsBody on the Android client
 * and parseSmsCoordinates on the server), and a contract is easier to keep when
 * you can read the whole of one side of it in one file.
 *
 * Two rules live in here and are worth finding before changing anything:
 *
 *   · reply() takes a CATALOGUE KEY, never a string. t() throws on an unknown
 *     key rather than texting somebody the key.
 *   · Every script but English is outside GSM 03.38, so one segment holds 70
 *     characters, not 160. i18n.test.ts holds every entry to that budget.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok, msisdnSchema } from "../http.js";
import { sms } from "../providers.js";
import { constantTimeEquals } from "../auth.js";
import { apply, type Status } from "../domain/booking-machine.js";
import { parseSmsCoordinates } from "../domain/sms-coordinates.js";
import { reference } from "../domain/reference.js";
import { t, resolveLocale, parseLangCommand, DEFAULT_LOCALE } from "../i18n.js";

export async function telecomRoutes(app: FastifyInstance) {
  // ══ feature-phone journey: inbound SMS ═════════════════════════════════════
  /**
   * The whole core journey over SMS, for a phone with no app and no data.
   *
   * Authentication is the SIM: the sending MSISDN identifies the user. Because
   * that is weaker than app auth, this path is deliberately limited — request,
   * status, cancel and SOS. No payment, no profile changes (threat #12).
   *
   * In production the telecom vendor calls this with a signed webhook. When
   * TELECOM_WEBHOOK_SECRET is set, every request must carry
   * x-roadassist-signature = HMAC-SHA256(secret, raw body) as hex; production
   * refuses to boot without the secret (assertProductionSafe). With no secret
   * configured the endpoint stays open for development and says so.
   */

  const CLASS_WORDS: Record<string, string> = {
    car: "car", bike: "motorcycle", motorcycle: "motorcycle", scooter: "scooter",
    auto: "auto_rickshaw", rickshaw: "auto_rickshaw", truck: "truck",
    bus: "bus", tractor: "tractor", ev: "ev",
  };

  app.post("/v1/telecom/sms", async (req, res) => {
    if (env.telecomWebhookSecret) {
      const presented = String(req.headers["x-roadassist-signature"] ?? "");
      const expected = createHmac("sha256", env.telecomWebhookSecret)
        .update((req as { rawBody?: string }).rawBody ?? "")
        .digest("hex");
      if (!presented || !constantTimeEquals(presented, expected)) {
        return res.code(401).send({
          error: { code: "webhook_unsigned", title: "Missing or invalid webhook signature", retryable: false },
        });
      }
    }

    // Running without a signature is a development convenience, and the comment
    // above claimed it was "flagged" — it was not. An operator reading a response
    // could not tell a signed intake from an open one. Now they can.
    const unsignedIntake = !env.telecomWebhookSecret;

    const { from, text } = z.object({
      from: msisdnSchema,
      text: z.string().max(160),
    }).parse(req.body);

    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const verb = words[0] ?? "";

    /**
     * Language for this conversation.
     *
     * Set below the user lookup, because the SIM is the identity here and the
     * stored preference belongs to the row. A feature phone sends no
     * Accept-Language and has no settings screen, so `LANG HI` is the only way
     * its owner can ever change this — which is why the command exists.
     */
    let locale = DEFAULT_LOCALE;
    const reply = async (key: string, params: Record<string, string | number> = {}) => {
      const body = t(locale, key, params);
      await sms.send(from, body);
      return ok({ reply: body }, {
        channel: "sms", to: from,
        // Said out loud on every response, not buried in a code comment. This
        // endpoint can raise an SOS for any phone number it is handed, so an
        // operator must be able to see from the wire whether the intake is
        // authenticated. Production cannot reach this state:
        // `assertProductionSafe` refuses to boot without the secret.
        ...(unsignedIntake
          ? { warning: "UNSIGNED INTAKE — TELECOM_WEBHOOK_SECRET is unset, so this endpoint accepts unauthenticated requests. Development only." }
          : { signed: true }),
      });
    };

    // The SIM is the identity. First contact registers the number.
    let [user] = await db.select().from(S.users).where(eq(S.users.msisdn, from)).limit(1);
    if (!user) {
      [user] = await db.insert(S.users).values({ msisdn: from, isVerified: true }).returning();
      const [citizen] = await db.select().from(S.roles).where(eq(S.roles.name, "citizen")).limit(1);
      if (citizen) await db.insert(S.userRoles).values({ userId: user.id, roleId: citizen.id });
    }

    const activeBooking = async () => {
      const [b] = await db.select().from(S.bookings)
        .where(and(eq(S.bookings.userId, user.id), isNull(S.bookings.deletedAt)))
        .orderBy(desc(S.bookings.createdAt)).limit(1);
      return b && !["PAID", "CANCELLED"].includes(b.status) ? b : null;
    };

    locale = resolveLocale({ stored: user.preferredLanguage });

    /**
     * `LANG` — the only language switch a feature phone has.
     *
     * Handled before every other verb so it works even mid-conversation, and
     * the confirmation is sent in the NEW language: that is the proof it
     * worked, for a reader who cannot check a settings screen.
     */
    const asked = parseLangCommand(words);
    if (asked !== undefined) {
      if (asked === null) return reply("lang.options");
      await db.update(S.users)
        .set({ preferredLanguage: asked, updatedAt: new Date() })
        .where(eq(S.users.id, user.id));
      locale = asked;
      return reply("lang.set");
    }

    if (["stop", "unsubscribe"].includes(verb)) {
      return reply("sms.stopped");
    }

    if (["sos", "emergency", "112"].includes(verb)) {
      /**
       * Read the coordinates the Android client already sends.
       *
       * Its SMS body is `SOS <lat> <lng> RoadAssist` (Emergency.smsBody), and
       * this endpoint used to drop the two numbers on the floor: the raw text was
       * kept in incident_signals, but incidents.location was never set. So the
       * one SOS raised precisely BECAUSE there is no data coverage — the most
       * remote person on the worst road — was the only SOS that reached a
       * responder with no location, and the reply asked them to describe a
       * landmark that the phone had already measured to six decimal places.
       *
       * A human texting a bare "SOS" from a feature phone is still valid and
       * still has no location, exactly as before. Anything that is not a pair of
       * in-range coordinates is ignored rather than guessed at.
       */
      const fix = parseSmsCoordinates(words);

      /**
       * One unit of work, for the reason the comment above describes: this is the
       * SOS raised because there is no data coverage, and the coordinates are the
       * only thing separating a responder from a search. Committing the incident
       * and then failing before the UPDATE reproduces exactly the bug that comment
       * exists to record — a located-nowhere emergency — only intermittently, and
       * the reply would still say "located". Same rule as POST /v1/sos.
       */
      await db.transaction(async (tx) => {
        const [row] = await tx.insert(S.incidents).values({
          userId: user.id, status: "CONFIRMED", severity: "CRITICAL",
          detectedByModel: false, confirmedBy: "sms", confirmedAt: new Date(),
          degradedPath: true,   // this path works with the app platform down
        }).returning();
        if (fix) {
          await tx.execute(raw`
            UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(${fix.lng}, ${fix.lat}), 4326)
            WHERE id = ${row.id}`);
        }
        await tx.insert(S.incidentSignals).values({
          incidentId: row.id, kind: "sms",
          payload: { text, ...(fix ? { lat: fix.lat, lng: fix.lng } : {}) },
        });
        await tx.insert(S.incidentResponses).values({ incidentId: row.id, step: "contacts", latencyMs: 0 });
      });
      return reply(fix ? "sos.received.located" : "sos.received");
    }

    if (["status", "s"].includes(verb)) {
      const b = await activeBooking();
      if (!b) return reply("sms.noActive");
      const [mech] = b.mechanicId
        ? await db.select().from(S.mechanics).where(eq(S.mechanics.id, b.mechanicId)).limit(1)
        : [];
      return reply(
        mech ? "sms.status.assigned" : "sms.status.searching",
        { reference: b.reference, status: b.status, mechanic: mech?.displayName ?? "" },
      );
    }

    if (["cancel", "c"].includes(verb)) {
      const b = await activeBooking();
      if (!b) return reply("sms.nothingToCancel");
      try {
        const { to, cancellationFee } = apply(b.status as Status, "cancel");
        await db.update(S.bookings)
          .set({ status: to, cancelledAt: new Date(), cancelReason: "sms_cancel", updatedAt: new Date() })
          .where(eq(S.bookings.id, b.id));
        await db.insert(S.bookingEvents).values({
          bookingId: b.id, fromStatus: b.status, toStatus: to,
          command: "cancel", actorId: user.id, actorRole: "citizen",
        });
        return reply(cancellationFee ? "sms.cancelled.fee" : "sms.cancelled", { reference: b.reference });
      } catch {
        return reply("sms.cancel.tooLate", { reference: b.reference, status: b.status });
      }
    }

    if (["help", "madad", "sahaya", "h"].includes(verb)) {
      const asked = words[1] ? CLASS_WORDS[words[1]] : undefined;

      const [existing] = await db.select({ id: S.vehicles.id, cls: S.vehicles.vehicleClass })
        .from(S.userVehicles)
        .innerJoin(S.vehicles, eq(S.vehicles.id, S.userVehicles.vehicleId))
        .where(and(eq(S.userVehicles.userId, user.id), isNull(S.userVehicles.deletedAt)))
        .limit(1);

      let vehicleId = existing?.id;
      if (!vehicleId) {
        if (!asked) {
          return reply("sms.whichVehicle");
        }
        // A feature-phone user cannot type a registration number reliably, so the
        // record is created from the vehicle class and completed later.
        const [v] = await db.insert(S.vehicles).values({
          registrationNo: "SMS-" + from.slice(-10),
          vehicleClass: asked as never,
        }).returning({ id: S.vehicles.id });
        await db.insert(S.userVehicles).values({ userId: user.id, vehicleId: v.id, isPrimary: true });
        vehicleId = v.id;
      }

      const open = await activeBooking();
      if (open) return reply("sms.alreadyOpen", { reference: open.reference, status: open.status });

      const [svc] = await db.select().from(S.serviceTypes)
        .where(eq(S.serviceTypes.code, "minor_repair")).limit(1);
      // The row and the event that explains it, together — the same rule as
      // POST /v1/bookings. This booking carries NO location by design: a feature
      // phone texting BOOK sends no coordinates, and guessing one would be worse
      // than having none. That makes its event row the only record of which
      // channel the request arrived on, so losing it loses the channel.
      const b = await db.transaction(async (tx) => {
        const [row] = await tx.insert(S.bookings).values({
          reference: reference(), userId: user.id, vehicleId,
          serviceTypeId: svc?.id, status: "REQUESTED", requestedAt: new Date(),
          symptoms: text, quotedPaise: svc?.baseFarePaise, createdOffline: false,
        }).returning();
        await tx.insert(S.bookingEvents).values({
          bookingId: row.id, fromStatus: "DRAFT", toStatus: "REQUESTED",
          command: "submit", actorId: user.id, actorRole: "citizen",
          meta: { channel: "sms" },
        });
        return row;
      });
      return reply("sms.requested", { reference: b.reference });
    }

    return reply("sms.commands");
  });
}
