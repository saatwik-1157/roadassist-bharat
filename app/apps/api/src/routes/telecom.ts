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
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok, msisdnSchema } from "../http.js";
import { sms } from "../providers.js";
import { hit, limit, LIMITS } from "../ratelimit.js";
import { audit } from "../audit.js";
import { alerts } from "../alerts.js";
import { publish, publishMany } from "../realtime.js";
import { withdrawOpenOffers, announceWithdrawnOffers } from "../dispatch.js";
import { decideWebhookIntake, type IntakeMode } from "../domain/webhook-intake.js";
import { isDemoNumber } from "../domain/demo-numbers.js";
import { apply, IllegalTransition, type Status } from "../domain/booking-machine.js";
import { applyIncident, PUBLIC_STAGE } from "../domain/incident-machine.js";
import { parseSmsCoordinates } from "../domain/sms-coordinates.js";
import { consentKeyword, partitionByOptOut } from "../domain/sms-consent.js";
import { optedOutAmong, recordOptIn, recordOptOut } from "../sms-opt-out.js";
import { reference } from "../domain/reference.js";
import { t, resolveLocale, parseLangCommand, DEFAULT_LOCALE, type Locale } from "../i18n.js";

/** What the intake gate decided for each accepted request, for the handler to report. */
const intakeMode = new WeakMap<FastifyRequest, IntakeMode>();

/**
 * Signature (or, without a secret, the development/demo-number rule) BEFORE
 * anything else — including the rate limit, so a forged request cannot spend a
 * real number's allowance and lock its owner out of texting SOS.
 */
async function webhookGate(req: FastifyRequest, res: FastifyReply) {
  const decision = decideWebhookIntake({
    secret: env.telecomWebhookSecret,
    nodeEnv: env.nodeEnv,
    rawBody: (req as { rawBody?: string }).rawBody ?? "",
    signature: req.headers["x-roadassist-signature"] as string | undefined,
    from: (req.body as { from?: unknown } | undefined)?.from,
    isDemoNumber,
  });
  if (!decision.accept) {
    return res.code(decision.status).send({
      error: { code: decision.code, title: decision.title, retryable: false, requestId: req.id },
    });
  }
  intakeMode.set(req, decision.mode);
}

/** Keyed by the sending number; a body with no usable `from` falls to the IP. */
const bySender = (req: FastifyRequest) => {
  const from = (req.body as { from?: unknown } | undefined)?.from;
  return typeof from === "string" && from.length <= 20 ? `msisdn:${from}` : `ip:${req.ip}`;
};

/**
 * Unsigned demo-number intake is also counted per IP, so one client cannot walk
 * the demo range. Signed traffic all comes from the vendor's few addresses, and
 * local development is nobody else's business, so neither is counted here.
 */
const byIpWhenUnsignedDemo = (req: FastifyRequest) =>
  intakeMode.get(req) === "unsigned_demo_number" ? `ip:${req.ip}` : null;

/** An app-registered person lists at most five contacts; see POST /v1/me/emergency-contacts. */
const MAX_CONTACTS_ALERTED = 5;

/**
 * Escalate an SOS that arrived by SMS: alert the sender's emergency contacts
 * and find the nearest responder, exactly as the app's confirm does.
 *
 * ── why escalate here instead of leaving it for someone to confirm ────────
 * This path used to write an incident_responses row with step "contacts" and
 * latency 0, texting nobody. That row is what POST /v1/sos/:id/confirm reads
 * to decide the contacts were already alerted, so the fake did not just
 * misreport: it would have made a later confirm skip the family for good.
 *
 * Deleting the row was the other honest option, and it would have left the
 * SMS SOS as the one emergency that never reaches the family. The emergency
 * design says a manual SOS is already a human act (routes/emergency.ts:
 * "Manual SOS is already a human act") and a model signal is the only thing
 * that must wait for a human; a person who typed SOS on a keypad is the human.
 * The off-grid rule against auto-escalating (ADR-0009, rule 4) is about a
 * record that may be hours old; this text is arriving now. And there is no app
 * on the other end to call confirm. So the SMS path escalates, and it does so
 * through the same guards confirm uses — nothing here is looser:
 *
 *   · the CONFIRMED → RESPONDING compare-and-swap is the claim, so a cancel
 *     from the app that lands first means nothing is sent;
 *   · the per-owner sosAlerts ceiling (same key as confirm, so the two paths
 *     share one budget) withholds the texts, never the escalation, and then
 *     writes no "contacts" row so confirm's lease can still alert later;
 *   · at most five contacts, the cap the contact list is held to;
 *   · contacts who texted STOP are not texted (domain/sms-consent.ts) and are
 *     counted, never folded into "alerted";
 *   · the "contacts" row carries the measured latency, and the count goes in
 *     the audit record, as confirm records it.
 *
 * Duplicated from confirm rather than shared because the emergency module is
 * reviewed on its own (routes/emergency.ts header); keep the two in step.
 */
async function escalateSmsSos(
  incidentId: string, ownerId: string, locale: Locale, t0: number, log: FastifyRequest["log"],
): Promise<{ escalated: boolean; contactsAlerted: number; contactsFailed: number;
             contactsWithheld: number; contactsOptedOut: number; responderFound: boolean }> {
  const none = { escalated: false, contactsAlerted: 0, contactsFailed: 0, contactsWithheld: 0,
                 contactsOptedOut: 0, responderFound: false };
  const { to: respondingTo } = applyIncident("CONFIRMED", "escalate");
  const claimed = await db.update(S.incidents)
    .set({ status: respondingTo, updatedAt: new Date() })
    .where(and(eq(S.incidents.id, incidentId), eq(S.incidents.status, "CONFIRMED")))
    .returning({ id: S.incidents.id });
  if (!claimed.length) return none;   // cancelled from the app in between: alert nobody

  const listed = await db.select().from(S.emergencyContacts)
    .where(and(eq(S.emergencyContacts.userId, ownerId), isNull(S.emergencyContacts.deletedAt)))
    .orderBy(S.emergencyContacts.priority).limit(MAX_CONTACTS_ALERTED);
  const { reachable, optedOut } = partitionByOptOut(listed, await optedOutAmong(listed.map((c) => c.msisdn)));

  const ceiling = reachable.length
    ? hit(`sosAlerts:${ownerId}`, LIMITS.sosAlerts.max, LIMITS.sosAlerts.windowMs)
    : null;
  const withheld = ceiling !== null && !ceiling.allowed;

  let contactsAlerted = 0, contactsFailed = 0;
  if (!withheld) {
    for (const c of reachable) {
      try {
        await sms.send(c.msisdn, t(locale, "sos.contact.alert", { url: `https://roadassist.in/i/${incidentId}` }));
        contactsAlerted++;
      } catch (err) {
        contactsFailed++;
        log.error({ err: err instanceof Error ? err.message.slice(0, 200) : String(err), incidentId },
          "emergency contact alert failed");
      }
    }
    await db.insert(S.incidentResponses).values({
      incidentId, step: "contacts", latencyMs: Date.now() - t0, acknowledged: false,
    });
  } else {
    log.warn({ incidentId, ownerId, resetInSeconds: ceiling.resetInSeconds },
      "emergency contact alerts withheld: sosAlerts ceiling reached");
  }

  // Only a located incident has a nearest responder. A bare "SOS" has no fix,
  // and ordering by distance to NULL would return an arbitrary unit as "nearest".
  const [responder] = await db.execute<{ id: string; name: string; km: number }>(raw`
    SELECT r.id, r.name, ST_Distance(r.last_location::geography, i.location::geography)/1000 AS km
      FROM responder_units r, incidents i
     WHERE i.id = ${incidentId} AND i.location IS NOT NULL AND r.active AND r.deleted_at IS NULL
       AND r.last_location IS NOT NULL
     ORDER BY r.last_location <-> i.location LIMIT 1`);
  await db.insert(S.incidentResponses).values({
    incidentId, responderId: responder?.id ?? null,
    step: "responder", latencyMs: Date.now() - t0, acknowledged: false,
  });

  const outcome = {
    escalated: true, contactsAlerted, contactsFailed,
    contactsWithheld: withheld ? reachable.length : 0,
    contactsOptedOut: optedOut.length, responderFound: Boolean(responder),
  };
  await audit({
    actorId: ownerId, actorRole: "citizen", action: "sos.escalated", entity: "incident", entityId: incidentId,
    before: { status: "CONFIRMED" },
    after: {
      status: respondingTo, channel: "sms", contactsAlerted,
      ...(contactsFailed ? { contactsFailed } : {}),
      ...(withheld ? { contactsWithheld: reachable.length } : {}),
      ...(optedOut.length ? { contactsOptedOut: optedOut.length } : {}),
      responderFound: Boolean(responder), elapsedMs: Date.now() - t0,
    },
  });
  publish(ownerId, {
    type: "sos.status", incidentId, status: respondingTo, stage: PUBLIC_STAGE[respondingTo],
    contactsAlerted, contactsOptedOut: optedOut.length, responderFound: Boolean(responder),
  });
  alerts.sosConfirmed(incidentId, contactsAlerted);
  return outcome;
}

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
   * the endpoint is open only in local environments (domain/local-env.ts:
   * development, test, the CI smoke test). Anywhere else — the
   * hosted demo is NODE_ENV=demo, which assertProductionSafe never covered —
   * it answers 503 webhook_not_configured, except for the published demo
   * numbers, so the demo keeps its feature-phone walkthrough without letting a
   * stranger act as a real phone number. Rules: domain/webhook-intake.ts.
   *
   * Rate limited per sending number (LIMITS.telecom), and unsigned demo-number
   * intake also per IP (LIMITS.telecomUnsigned), both after the gate.
   */

  const CLASS_WORDS: Record<string, string> = {
    car: "car", bike: "motorcycle", motorcycle: "motorcycle", scooter: "scooter",
    auto: "auto_rickshaw", rickshaw: "auto_rickshaw", truck: "truck",
    bus: "bus", tractor: "tractor", ev: "ev",
  };

  app.post("/v1/telecom/sms", {
    preHandler: [webhookGate, limit("telecom", bySender), limit("telecomUnsigned", byIpWhenUnsignedDemo)],
  }, async (req) => {
    // Running without a signature is a development convenience, and the comment
    // above claimed it was "flagged" — it was not. An operator reading a response
    // could not tell a signed intake from an open one. Now they can.
    const mode = intakeMode.get(req) ?? "signed";

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
      // By now the text has been acted on - an SOS raised, a booking cancelled.
      // A reply the gateway fails to send used to throw a 500 over that, and a
      // telecom vendor redelivers a webhook that failed: the SOS came in again
      // and raised a second incident. The reply is still in the body here.
      let delivered = true;
      try {
        await sms.send(from, body);
      } catch (err) {
        delivered = false;
        req.log.error({ err: err instanceof Error ? err.message.slice(0, 200) : String(err) }, "sms reply not delivered");
      }
      return ok({ reply: body }, {
        channel: "sms", to: from,
        ...(delivered ? {} : { replyDelivered: false }),
        // Said out loud on every response, not buried in a code comment. This
        // endpoint can raise an SOS for the phone number it is handed, so an
        // operator must be able to see from the wire whether the intake is
        // authenticated. Production cannot reach the unsigned states:
        // `assertProductionSafe` refuses to boot without the secret.
        ...(mode === "signed"
          ? { signed: true }
          : mode === "unsigned_demo_number"
            ? { warning: "UNSIGNED DEMO INTAKE — TELECOM_WEBHOOK_SECRET is unset, so only the published demo numbers are accepted, unauthenticated. Every other number is refused." }
            : { warning: "UNSIGNED INTAKE — TELECOM_WEBHOOK_SECRET is unset, so this endpoint accepts unauthenticated requests. Development only." }),
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

    /**
     * STOP and START, stored (sms_opt_outs) rather than merely acknowledged.
     *
     * The legal norm is that an opt-out is honoured, and it is — including for
     * emergency-contact alerts: a number that texted STOP is not texted when
     * somebody who lists it as a contact raises an SOS, from the app or by SMS.
     * The reply says that in plain words, so nobody opts out without knowing
     * what they are giving up. Answers to this number's own texts still go
     * (they are what it asked for); the rule is in domain/sms-consent.ts.
     */
    const consent = consentKeyword(verb);
    if (consent === "stop") {
      await recordOptOut(from, verb);
      return reply("sms.stopped");
    }
    if (consent === "start") {
      await recordOptIn(from);
      return reply("sms.started");
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
      const t0 = Date.now();

      /**
       * One unit of work, for the reason the comment above describes: this is the
       * SOS raised because there is no data coverage, and the coordinates are the
       * only thing separating a responder from a search. Committing the incident
       * and then failing before the UPDATE reproduces exactly the bug that comment
       * exists to record — a located-nowhere emergency — only intermittently, and
       * the reply would still say "located". Same rule as POST /v1/sos.
       */
      const incident = await db.transaction(async (tx) => {
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
        return row;
      });
      await audit({
        actorId: user.id, actorRole: "citizen", action: "sos.created", entity: "incident", entityId: incident.id,
        after: { source: "sms", status: incident.status, severity: incident.severity,
                 degradedPath: true, locationKnown: Boolean(fix) },
        ip: req.ip,
      });

      // The contacts step is recorded by the escalation that actually texts them
      // — see escalateSmsSos above for why this path escalates at all. The
      // incident is committed either way, so a failure here is logged, not
      // thrown: a 500 makes the vendor redeliver, and that raises a second SOS.
      let escalation: Awaited<ReturnType<typeof escalateSmsSos>> | null = null;
      try {
        escalation = await escalateSmsSos(incident.id, user.id, locale, t0, req.log);
      } catch (err) {
        req.log.error({ err: err instanceof Error ? err.message.slice(0, 200) : String(err), incidentId: incident.id },
          "sms sos escalation failed; the incident stands CONFIRMED for an operator");
      }
      // The reply states only what happened — recorded, under this ref — and
      // never that help is on the way: no responder is contacted from here.
      const sent = await reply(fix ? "sos.received.located" : "sos.received",
        { ref: String(incident.id).slice(0, 8) });
      return { ...sent, meta: { ...sent.meta, incidentId: incident.id, escalated: escalation?.escalated ?? false,
        contactsAlerted: escalation?.contactsAlerted ?? 0,
        ...(escalation?.contactsFailed ? { contactsFailed: escalation.contactsFailed } : {}),
        ...(escalation?.contactsWithheld ? { contactsWithheld: escalation.contactsWithheld } : {}),
        ...(escalation?.contactsOptedOut ? { contactsOptedOut: escalation.contactsOptedOut } : {}) } };
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
      let to: Status, cancellationFee: boolean;
      try {
        ({ to, cancellationFee } = apply(b.status as Status, "cancel"));
      } catch (err) {
        if (!(err instanceof IllegalTransition)) throw err;
        return reply("sms.cancel.tooLate", { reference: b.reference, status: b.status });
      }

      /**
       * A compare-and-swap on the status AND version the cancel was computed
       * from, the rule every app transition follows (POST
       * /v1/bookings/:id/transition, domain/booking-machine.ts).
       *
       * It was `WHERE id = ?`. A mechanic's accept landing between the read
       * above and this write was overwritten — the booking went CANCELLED
       * with a mechanic still assigned and driving — and the fee was decided
       * from the stale status, so a cancel that should have cost the customer
       * a fee (ASSIGNED) was free. Now the loser is told what happened instead.
       * The booking's open offers close in the same transaction (dispatch.ts).
       */
      const cancelled = await db.transaction(async (tx) => {
        const moved = await tx.update(S.bookings)
          .set({ status: to, cancelledAt: new Date(), cancelReason: "sms_cancel",
                 updatedAt: new Date(), version: b.version + 1 })
          .where(and(eq(S.bookings.id, b.id), eq(S.bookings.status, b.status),
                     eq(S.bookings.version, b.version)))
          .returning({ id: S.bookings.id, mechanicId: S.bookings.mechanicId });
        if (!moved.length) return null;
        const withdrawn = await withdrawOpenOffers(tx, b.id);
        await tx.insert(S.bookingEvents).values({
          bookingId: b.id, fromStatus: b.status, toStatus: to,
          command: "cancel", actorId: user.id, actorRole: "citizen",
          meta: { channel: "sms", ...(withdrawn.length ? { offersWithdrawn: withdrawn.length } : {}) },
        });
        return { mechanicId: moved[0].mechanicId, withdrawn };
      });

      if (!cancelled) {
        // Lost the race. Say what won, from the row as it now is — the most
        // likely winner is a mechanic accepting, and the customer must know a
        // second CANCEL now costs a fee rather than discover it on the invoice.
        const [now] = await db.select().from(S.bookings).where(eq(S.bookings.id, b.id)).limit(1);
        req.log.info({ bookingId: b.id, from: b.status, now: now?.status }, "sms cancel lost a race");
        return now?.mechanicId && now.mechanicId !== b.mechanicId
          ? reply("sms.cancel.accepted", { reference: b.reference })
          : reply("sms.cancel.changed", { reference: b.reference, status: now?.status ?? b.status });
      }

      await audit({
        actorId: user.id, actorRole: "citizen", action: "booking.status_changed",
        entity: "booking", entityId: b.id,
        before: { status: b.status }, after: { status: to, command: "cancel", channel: "sms" },
        ip: req.ip,
      });
      // Persisted first, published second: the customer's other screens, the
      // mechanic already driving (if any), and every mechanic still being asked.
      const audience: Array<string | null> = [user.id];
      if (cancelled.mechanicId) {
        const [m] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
          .where(eq(S.mechanics.id, cancelled.mechanicId)).limit(1);
        audience.push(m?.userId ?? null);
      }
      publishMany(audience, { type: "booking.status", bookingId: b.id, status: to, previous: b.status, command: "cancel" });
      await announceWithdrawnOffers(b.id, cancelled.withdrawn);

      return reply(cancellationFee ? "sms.cancelled.fee" : "sms.cancelled", { reference: b.reference });
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
