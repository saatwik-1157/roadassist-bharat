/**
 * The emergency path (ADR-0005) — raise, cancel, resolve, confirm, and the
 * off-grid sync that replays an SOS taken with no network.
 *
 * This is the group the split exists for. Non-negotiable #1 says emergency
 * paths never regress, and "two approvals and a dedicated test run" is hard to
 * mean when the code is 500 lines buried in the middle of a 3,000-line file
 * alongside payments, reviews and map tiles. Here it can be read, reviewed and
 * blamed on its own.
 *
 * Moved verbatim: the handlers are unchanged, only the wrapper and imports are
 * new. Two rules live in here and are worth finding before changing anything:
 *
 *   · A model NEVER dispatches. A crash signal raises an incident that sits in
 *     AWAITING_CONFIRMATION until a recorded human — or a corroborating second
 *     signal — moves it on. That is ADR-0005 and it is the whole reason this
 *     path is separate from dispatch.
 *   · An off-grid SOS replayed on reconnect must converge on the incident it
 *     already created. The client reference is the idempotency key, and a
 *     retry that creates a second incident sends a second ambulance.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, notInArray, sql as raw } from "drizzle-orm";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { ok } from "../http.js";
import { audit } from "../audit.js";
import { alerts } from "../alerts.js";
import { hit, limit, LIMITS } from "../ratelimit.js";
import { sms } from "../providers.js";
import { publish } from "../realtime.js";
import { authenticate } from "../auth.js";
import { t, resolveLocale } from "../i18n.js";
import { fail } from "../errors.js";
import { logOp } from "../observability.js";
import { optedOutAmong } from "../sms-opt-out.js";
import { partitionByOptOut } from "../domain/sms-consent.js";
import {
  allowedIncidentCommands, applyIncident, PUBLIC_STAGE, type IncidentStatus,
} from "../domain/incident-machine.js";

/**
 * Responder units RoadAssist itself contacted for an incident: none, in this
 * build, on every path.
 *
 * The escalation ladder LOCATES the nearest active unit (`nearestResponder`)
 * and records it on an `incident_responses` row; nothing is sent to that unit,
 * and the ERSS 112 handoff is stubbed. Clients used to read "a unit was found"
 * as "help is on the way". Every answer that describes an escalation therefore
 * carries this count, so a screen may say "responders have been alerted" only
 * when the server says it did that. Raise it only alongside a real send.
 */
const RESPONDERS_NOTIFIED = 0;

export async function emergencyRoutes(app: FastifyInstance) {
  /**
   * A crash signal raises an incident; it never dispatches one. The incident sits
   * in AWAITING_CONFIRMATION for the cancel window, and only a recorded human (or
   * corroborating second signal) moves it to CONFIRMED.
   */
  app.post("/v1/sos", { preHandler: [authenticate, limit("sos")] }, async (req, reply) => {
    const body = z.object({
      vehicleId: z.string().uuid().optional(),
      // Both or neither. "Neither" must be said out loud with locationUnknown, so
      // a client that forgot the fields is still refused: an SOS with no fix is
      // raised without a position rather than at a made-up one, the same as the
      // SMS and off-grid paths already do.
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      locationUnknown: z.literal(true).optional(),
      source: z.enum(["manual", "crash_model", "sms"]).default("manual"),
      modelConfidence: z.number().min(0).max(1).optional(),
      degradedPath: z.boolean().optional(),
      /**
       * Optional client-minted reference, and the only real defence against a
       * duplicate emergency.
       *
       * The app already guards a double tap in the UI, but a UI guard is not a
       * rule: a retried request after a lost response, a restored tab, a flaky
       * link that resends — each of those raises a second incident that alerts
       * the family twice and occupies a second responder. Sending the same
       * reference makes the retry converge on the incident it already created,
       * exactly as the off-grid path does, on the same unique index.
       */
      clientIncidentId: z.string().regex(/^RA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/).optional(),
    }).refine(
      (b) => b.locationUnknown ? b.lat === undefined && b.lng === undefined
                               : b.lat !== undefined && b.lng !== undefined,
      { message: "send lat and lng, or locationUnknown: true with neither" },
    ).parse(req.body);
    const located = body.lat !== undefined && body.lng !== undefined;

    /**
     * Answer a replay with the incident it already created.
     *
     * A lookup here is a courtesy for the ordinary case — it saves a wasted
     * insert and returns quickly. It is NOT the guard, and treating it as one was
     * a real bug: three taps arriving together all read "no such reference", all
     * proceeded to insert, and two of them hit the unique index and returned 500.
     * A person double-tapping SOS getting a server error is the worst possible
     * place for that failure.
     *
     * The actual guard is the unique index plus `onConflictDoNothing` below.
     */
    const respondDuplicate = (existing: typeof S.incidents.$inferSelect) => {
      if (existing.userId !== req.user!.sub) {
        return reply.code(409).send({ error: {
          code: "reference_taken", title: "That reference belongs to another account",
          retryable: false, requestId: req.id } });
      }
      return reply.code(200).send(ok({
        id: existing.id, status: existing.status,
        cancelWindowSeconds: 0, requiresConfirmation: false, duplicate: true,
      }, { note: "This emergency was already raised — the replay was ignored." }));
    };

    if (body.clientIncidentId) {
      const [existing] = await db.select().from(S.incidents)
        .where(eq(S.incidents.clientIncidentId, body.clientIncidentId)).limit(1);
      if (existing) return respondDuplicate(existing);
    }

    const byModel = body.source === "crash_model";

    /**
     * The vehicle must be the caller's — but the emergency goes through anyway.
     *
     * Any uuid used to be linked unchecked, so an account could attach its SOS
     * to somebody else's vehicle and have a responder, the incident record and
     * the analytics all point at the wrong owner's car. A foreign or unknown
     * vehicle is therefore refused — as a link, not as an emergency: the id is
     * dropped, the SOS is raised without it, and the response says so. Same rule
     * as the off-grid sync below.
     */
    let vehicleId: string | undefined;
    let vehicleRefused = false;
    if (body.vehicleId) {
      const [own] = await db.select({ id: S.userVehicles.vehicleId }).from(S.userVehicles)
        .where(and(
          eq(S.userVehicles.vehicleId, body.vehicleId),
          eq(S.userVehicles.userId, req.user!.sub),
          isNull(S.userVehicles.deletedAt),
        )).limit(1);
      vehicleId = own?.id;
      vehicleRefused = !own;
    }

    /**
     * The incident, its position and its signal are ONE unit of work.
     *
     * They used to be three statements in a row, and the gap between the first
     * and the second is the whole emergency. `incidents.location` is nullable,
     * so a process death or a dropped connection after the insert left an
     * incident committed as CONFIRMED, escalating, with no coordinates — and the
     * idempotency guard above then made that permanent: the client retries with
     * the same reference, converges on the row that already exists, and is told
     * the replay was ignored, so nothing ever writes the fix it was still
     * holding. A responder gets an emergency with no place to go.
     *
     * Inside a transaction the row either arrives with its location or does not
     * arrive at all, which is the only honest pair of outcomes. `raw` is still
     * needed for the position — PostGIS geometry has no Drizzle column builder
     * here and ST_MakePoint has to be evaluated by the database.
     */
    const incident = await db.transaction(async (tx) => {
      const [row] = await tx.insert(S.incidents).values({
        userId: req.user!.sub, vehicleId,
        clientIncidentId: body.clientIncidentId,
        occurredAt: new Date(),
        emergencyType: byModel ? "accident" : "other",
        // Manual SOS is already a human act; a model signal must wait for confirmation.
        status: byModel ? "AWAITING_CONFIRMATION" : "CONFIRMED",
        severity: byModel && (body.modelConfidence ?? 0) > 0.9 ? "CRITICAL" : "HIGH",
        detectedByModel: byModel,
        modelConfidence: body.modelConfidence,
        confirmedBy: byModel ? null : "user",
        confirmedAt: byModel ? null : new Date(),
        degradedPath: body.degradedPath ?? false,
      })
        // The real idempotency guard. Two taps racing past the lookup above both
        // arrive here; the index lets exactly one through and the other gets no row
        // back, which is a duplicate rather than an error.
        .onConflictDoNothing({ target: S.incidents.clientIncidentId })
        .returning();

      // Lost the race. ON CONFLICT DO NOTHING raises nothing, so the transaction
      // is still valid and has written nothing — leave it that way and let the
      // caller read the winner's row outside.
      if (!row) return null;

      if (located) {
        await tx.execute(raw`
          UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
          WHERE id = ${row.id}`);
      }
      await tx.insert(S.incidentSignals).values({
        incidentId: row.id, kind: body.source,
        payload: { lat: body.lat ?? null, lng: body.lng ?? null, confidence: body.modelConfidence },
      });
      return row;
    });

    if (!incident) {
      // Whoever won has committed by now, so read their incident and answer with
      // it — the caller gets the same reply either way.
      const [winner] = await db.select().from(S.incidents)
        .where(eq(S.incidents.clientIncidentId, body.clientIncidentId!)).limit(1);
      if (winner) return respondDuplicate(winner);
      return reply.code(409).send({ error: {
        code: "reference_taken", title: "That reference is already in use",
        retryable: false, requestId: req.id } });
    }

    await audit({
      actorId: req.user!.sub, actorRole: "citizen", action: "sos.created",
      entity: "incident", entityId: incident.id,
      after: {
        source: body.source, status: incident.status, severity: incident.severity,
        detectedByModel: byModel, clientIncidentId: body.clientIncidentId ?? null,
        degradedPath: body.degradedPath ?? false,
        // Coordinates are the point of the incident, not a secret to withhold —
        // but the audit row records only that a fix existed, since the incident
        // row already holds the location and the chain does not need it twice.
        locationKnown: located,
        ...(vehicleRefused ? { vehicleRefused: true } : {}),
      },
      ip: req.ip,
    });
    publish(req.user!.sub, {
      type: "sos.status", incidentId: incident.id, status: incident.status,
      requiresConfirmation: byModel,
    });

    return reply.code(201).send(ok({
      id: incident.id, status: incident.status, locationKnown: located,
      cancelWindowSeconds: byModel ? 30 : 0,
      requiresConfirmation: byModel,
    }, {
      note: byModel
        ? "Detected on device. Nothing has been dispatched — confirm or cancel within 30 seconds."
        : "Escalating now.",
      ...(vehicleRefused ? {
        vehicle: {
          linked: false, code: "forbidden", title: "That vehicle is not yours",
          detail: "The emergency was raised without a vehicle link.",
        },
      } : {}),
    }));
  });

  app.post("/v1/sos/:id/cancel", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [inc] = await db.select().from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
    if (!inc) return reply.code(404).send({ error: { code: "not_found", title: "Incident not found", retryable: false } });
    if (inc.userId !== req.user!.sub) {
      return reply.code(403).send({ error: { code: "forbidden", title: "That incident is not yours", retryable: false } });
    }
    // The state machine decides whether a cancel is legal at all — a resolved
    // emergency cannot be un-resolved, and it throws rather than silently
    // succeeding. The guarded UPDATE below then makes it safe under concurrency.
    const { to: cancelTo } = applyIncident(inc.status as IncidentStatus, "cancel");
    const cancelled = await db.update(S.incidents)
      .set({ status: cancelTo, cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(S.incidents.id, id), eq(S.incidents.status, inc.status)))
      .returning({ id: S.incidents.id });
    if (!cancelled.length) {
      return reply.code(409).send({ error: {
        code: "invalid_state", title: "This incident changed while the cancel was in flight. Reload it.",
        retryable: true, requestId: req.id } });
    }
    await audit({
      actorId: req.user!.sub, actorRole: "citizen", action: "sos.cancelled",
      entity: "incident", entityId: id, before: { status: inc.status },
      after: { status: "CANCELLED" }, ip: req.ip,
    });
    publish(inc.userId, {
      type: "sos.status", incidentId: id, status: "CANCELLED",
      stage: PUBLIC_STAGE.CANCELLED,
    });
    logOp(req, { op: "sos.cancel", result: "ok", incidentId: id, from: inc.status });
    return ok({ id, status: "CANCELLED", stage: PUBLIC_STAGE.CANCELLED },
      { note: "False alarm recorded — this feeds the false-positive dataset." });
  });

  /**
   * Close an emergency.
   *
   * The lifecycle ended at RESPONDING and never came back: `RESOLVED` existed in
   * the enum with nothing able to reach it, so every incident ever raised stayed
   * open forever. That is not a cosmetic gap — an operations view counting
   * "active emergencies" counted every emergency the platform had ever seen.
   */
  app.post("/v1/sos/:id/resolve", { preHandler: authenticate }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { outcome } = z.object({
      outcome: z.enum(["assisted", "self_resolved", "false_alarm", "handed_off"]).default("assisted"),
    }).parse(req.body ?? {});

    const [inc] = await db.select().from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
    if (!inc) throw fail("INCIDENT_NOT_FOUND");
    // The person it happened to, or an operator. A responder closing somebody
    // else's emergency has to be an accountable role, not any signed-in account.
    if (inc.userId !== req.user!.sub &&
        !req.user!.roles.some((r) => r === "admin" || r === "gov_officer")) {
      throw fail("FORBIDDEN", "That incident is not yours");
    }

    const { to } = applyIncident(inc.status as IncidentStatus, "resolve");
    const closed = await db.update(S.incidents)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(S.incidents.id, id), eq(S.incidents.status, inc.status)))
      .returning({ id: S.incidents.id });
    if (!closed.length) throw fail("CONFLICT", "This incident changed while the request was in flight");

    await audit({
      actorId: req.user!.sub, actorRole: req.user!.roles[0] ?? "citizen",
      action: "sos.resolved", entity: "incident", entityId: id,
      before: { status: inc.status }, after: { status: to, outcome }, ip: req.ip,
    });
    publish(inc.userId, { type: "sos.status", incidentId: id, status: to, stage: PUBLIC_STAGE[to] });
    logOp(req, { op: "sos.resolve", result: "ok", incidentId: id, outcome, from: inc.status });

    return ok({ id, status: to, stage: PUBLIC_STAGE[to], outcome },
      { note: "The emergency is closed. A new one needs a new incident." });
  });

  /**
   * The caller's emergencies that are still open.
   *
   * Nothing listed them. The SOS screen held the one it had just raised, so an
   * app that was closed, killed or reinstalled mid-emergency could no longer
   * see it - or say "I'm safe" and close it. It stayed open on the server with
   * nobody able to end it but an operator. Only the caller's own, only the
   * open ones, newest first, and with what may be done to each.
   */
  app.get("/v1/me/incidents", { preHandler: authenticate }, async (req) => {
    const rows = await db.select({
      id: S.incidents.id, status: S.incidents.status, severity: S.incidents.severity,
      reference: S.incidents.clientIncidentId, raisedAt: S.incidents.createdAt,
    }).from(S.incidents)
      .where(and(eq(S.incidents.userId, req.user!.sub), isNull(S.incidents.deletedAt),
                 notInArray(S.incidents.status, ["RESOLVED", "CANCELLED"])))
      .orderBy(desc(S.incidents.createdAt)).limit(5);
    return ok(rows.map((r) => {
      const status = r.status as IncidentStatus;
      return {
        id: r.id, status, stage: PUBLIC_STAGE[status], reference: r.reference ?? null,
        raisedAt: r.raisedAt.toISOString(), severity: r.severity,
        respondersNotified: RESPONDERS_NOTIFIED,
        canResolve: allowedIncidentCommands(status).includes("resolve"),
        canCancel: allowedIncidentCommands(status).includes("cancel"),
      };
    }), { note: "Open emergencies only; a resolved or cancelled one is history." });
  });

  /**
   * How long a claimed escalation may go without recording its "contacts" step
   * before a retry treats the claimer as dead and alerts the contacts itself.
   * Far longer than any send loop takes; short enough that a family is not
   * left unalerted for long by a crash.
   */
  const ESCALATION_LEASE_MS = 2 * 60_000;

  /** Escalation ladder. Each rung is timed so the <10s claim is measured, not asserted. */
  app.post("/v1/sos/:id/confirm", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [inc] = await db.select().from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
    if (!inc) return reply.code(404).send({ error: { code: "not_found", title: "Incident not found", retryable: false } });
    // Same ownership rule as cancel: escalating someone else's incident would
    // SMS their emergency contacts (threat #5).
    if (inc.userId !== req.user!.sub && !req.user!.roles.includes("admin")) {
      return reply.code(403).send({ error: { code: "forbidden", title: "That incident is not yours", retryable: false } });
    }

    const t0 = Date.now();

    /**
     * Decide, and commit the decision, BEFORE anything leaves the building.
     *
     * This used to sit at the bottom of the handler, after the contacts had
     * already been texted and both response rows written, and that order cost
     * two things:
     *
     *   · A closed emergency still alerted the family. `applyIncident` refuses
     *     to escalate a CANCELLED or RESOLVED incident — but by the time it was
     *     asked, every emergency contact had received "there has been an
     *     emergency" for an alarm the person had already withdrawn. The 409 the
     *     caller got back was correct and far too late.
     *   · A cancel racing a confirm could be undone. The write was an
     *     unguarded `WHERE id = ?`, so a confirm that read CONFIRMED, then lost
     *     the race to a cancel, still wrote RESPONDING over CANCELLED. Cancel
     *     and resolve have both been compare-and-swapped for exactly this
     *     reason; this one was not, and it is the path that summons help.
     *
     * The guard is the set of states the ladder may legally run FROM — and it
     * no longer includes RESPONDING. Escalating twice is legal in the state
     * machine, and it used to mean texting every emergency contact twice: any
     * holder of the incident could call confirm in a loop and pump SMS through
     * the family's phones (and our SMS bill). Now the compare-and-swap into
     * RESPONDING is the claim: exactly one confirm wins it and sends the alerts;
     * a repeat, or a second tap racing the first, finds the incident already
     * RESPONDING and gets the same 200 back with nothing re-sent. A cancel that
     * landed first still excludes the row and nothing is sent.
     */
    const confirmed = inc.status === "AWAITING_CONFIRMATION" || inc.status === "DETECTED"
      ? applyIncident(inc.status as IncidentStatus, "confirm").to
      : (inc.status as IncidentStatus);
    // ADR-0005 as executable code: `escalate` is reachable only from CONFIRMED,
    // so a model-detected crash cannot reach RESPONDING without a human first.
    const { to: respondingTo } = applyIncident(confirmed, "escalate");

    const claimed = await db.update(S.incidents).set({
      status: respondingTo,
      confirmedBy: inc.confirmedBy ?? "user",
      confirmedAt: inc.confirmedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(S.incidents.id, id),
      raw`${S.incidents.status} IN ('DETECTED', 'AWAITING_CONFIRMATION', 'CONFIRMED')`,
    )).returning({ id: S.incidents.id });

    let sendAlerts = claimed.length > 0;

    if (!sendAlerts) {
      const [now] = await db.select({ status: S.incidents.status, updatedAt: S.incidents.updatedAt })
        .from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
      if (now?.status !== "RESPONDING") {
        logOp(req, { op: "sos.escalate", result: "rejected", incidentId: id,
                     from: inc.status, errorCode: "INVALID_STATE" });
        return reply.code(409).send({ error: {
          code: "invalid_state",
          title: "This emergency was closed while the request was in flight — nothing was alerted.",
          retryable: false, requestId: req.id } });
      }

      /**
       * Already RESPONDING. Normally that means the contacts were texted and
       * this is a repeat — but if the process that won the claim died before
       * recording the "contacts" step, a retry must still be able to alert the
       * family, or the idempotency above would make a crash permanent. The
       * claim is treated as abandoned once it is ESCALATION_LEASE_MS old with
       * no contacts row, and re-taken with a compare-and-swap on updated_at so
       * that only one retry wins it.
       */
      const [recorded] = await db.select({ id: S.incidentResponses.id }).from(S.incidentResponses)
        .where(and(eq(S.incidentResponses.incidentId, id), eq(S.incidentResponses.step, "contacts")))
        .limit(1);
      if (!recorded && now.updatedAt.getTime() < Date.now() - ESCALATION_LEASE_MS) {
        const retaken = await db.update(S.incidents).set({ updatedAt: new Date() })
          .where(and(eq(S.incidents.id, id), eq(S.incidents.status, "RESPONDING"),
                     eq(S.incidents.updatedAt, now.updatedAt)))
          .returning({ id: S.incidents.id });
        sendAlerts = retaken.length > 0;
      }
    }

    const nearestResponder = () => db.execute<{ id: string; name: string; km: number }>(raw`
      SELECT r.id, r.name, ST_Distance(r.last_location::geography, i.location::geography)/1000 AS km
        FROM responder_units r, incidents i
       WHERE i.id = ${id} AND r.active AND r.deleted_at IS NULL
         AND r.last_location IS NOT NULL
       ORDER BY r.last_location <-> i.location LIMIT 1`);

    if (!sendAlerts) {
      // A repeat. Same shape as the first answer, so a client that retried
      // after a lost response renders the same screen — but nothing is texted,
      // no response rows are written and nothing is audited twice.
      const again = await nearestResponder();
      logOp(req, { op: "sos.escalate", result: "ok", duplicate: true, incidentId: id, from: inc.status });
      return ok({
        id, status: respondingTo, stage: PUBLIC_STAGE[respondingTo],
        contactsAlerted: 0, alreadyEscalated: true,
        respondersNotified: RESPONDERS_NOTIFIED,
        nearestResponder: again[0] ?? null,
        elapsedMs: Date.now() - t0,
      }, { note: "Already escalated — emergency contacts are alerted once per incident and were not texted again." });
    }

    const listed = await db.select().from(S.emergencyContacts)
      .where(and(eq(S.emergencyContacts.userId, inc.userId!), isNull(S.emergencyContacts.deletedAt)));
    // A contact who texted STOP is not texted (domain/sms-consent.ts: the legal
    // norm is that opt-out is honoured, and the STOP reply told them this). They
    // are counted and reported as contactsOptedOut, never folded into "alerted".
    const { reachable: contacts, optedOut } =
      partitionByOptOut(listed, await optedOutAmong(listed.map((c) => c.msisdn)));

    /**
     * In the language of the person in trouble, not the platform's default.
     *
     * An emergency contact is usually family, and family usually shares a
     * language. This is the single most important message the platform ever
     * sends, and it went out in English to every contact in the country.
     */
    const [owner] = await db.select({ lang: S.users.preferredLanguage })
      .from(S.users).where(eq(S.users.id, inc.userId!)).limit(1);
    const contactLocale = resolveLocale({ stored: owner?.lang });

    /**
     * A ceiling on alert batches per incident OWNER (LIMITS.sosAlerts), as the
     * backstop behind the idempotency above: one account raising incident after
     * incident and confirming each could still pump the same contact list. It
     * never blocks the escalation — status, responder search and audit all go
     * ahead — only the texts are not sent, and the response says so. No
     * "contacts" row is written then, so a retry after the window can still
     * alert them (see the lease above).
     */
    const alertCeiling = contacts.length
      ? hit(`sosAlerts:${inc.userId}`, LIMITS.sosAlerts.max, LIMITS.sosAlerts.windowMs)
      : null;
    const withheld = alertCeiling !== null && !alertCeiling.allowed;

    let contactsAlerted = 0, contactsFailed = 0;
    if (!withheld) {
      for (const c of contacts) {
        // One contact's failed send must not stop the next contact being texted,
        // nor the responder search below.
        try {
          await sms.send(c.msisdn, t(contactLocale, "sos.contact.alert", {
            url: `https://roadassist.in/i/${id}`,
          }));
          contactsAlerted++;
        } catch (err) {
          contactsFailed++;
          req.log.error({ err, incidentId: id }, "emergency contact alert failed");
        }
      }
      await db.insert(S.incidentResponses).values({
        incidentId: id, step: "contacts", latencyMs: Date.now() - t0, acknowledged: false,
      });
    } else {
      req.log.warn({ incidentId: id, ownerId: inc.userId, resetInSeconds: alertCeiling.resetInSeconds },
        "emergency contact alerts withheld: sosAlerts ceiling reached");
    }

    const responders = await nearestResponder();

    await db.insert(S.incidentResponses).values({
      incidentId: id, responderId: responders[0]?.id ?? null,
      step: "responder", latencyMs: Date.now() - t0, acknowledged: false,
    });

    await audit({
      actorId: req.user!.sub, actorRole: req.user!.roles[0] ?? "citizen",
      action: "sos.escalated", entity: "incident", entityId: id,
      before: { status: inc.status },
      after: {
        status: "RESPONDING", contactsAlerted,
        ...(contactsFailed ? { contactsFailed } : {}),
        ...(withheld ? { contactsWithheld: contacts.length } : {}),
        ...(optedOut.length ? { contactsOptedOut: optedOut.length } : {}),
        responderFound: Boolean(responders[0]), elapsedMs: Date.now() - t0,
      },
      ip: req.ip,
    });
    publish(inc.userId, {
      type: "sos.status", incidentId: id, status: respondingTo,
      stage: PUBLIC_STAGE[respondingTo],
      contactsAlerted, responderFound: Boolean(responders[0]),
      respondersNotified: RESPONDERS_NOTIFIED,
    });
    logOp(req, {
      op: "sos.escalate", result: "ok", durationMs: Date.now() - t0, incidentId: id,
      contactsAlerted, responderFound: Boolean(responders[0]),
    });

    alerts.sosConfirmed(id, contactsAlerted);

    return ok({
      id, status: respondingTo, stage: PUBLIC_STAGE[respondingTo],
      contactsAlerted,
      ...(contactsFailed ? { contactsFailed } : {}),
      ...(withheld ? { contactsWithheld: contacts.length } : {}),
      ...(optedOut.length ? { contactsOptedOut: optedOut.length } : {}),
      respondersNotified: RESPONDERS_NOTIFIED,
      nearestResponder: responders[0] ?? null,
      elapsedMs: Date.now() - t0,
    }, {
      note: "ERSS 112 handoff is stubbed in development — no real emergency service is contacted.",
      ...(withheld ? {
        warning: "Emergency contacts were not texted: this account has reached the hourly ceiling on " +
                 "contact alerts. The emergency itself was escalated.",
      } : {}),
      ...(optedOut.length ? {
        optedOut: `${optedOut.length} of your emergency contacts were not texted: they replied STOP to ` +
                  "RoadAssist SMS, and that opt-out is honoured. Call them yourself if you can.",
      } : {}),
    });
  });

  // ══ off-grid SOS sync (ADR-0009) ═══════════════════════════════════════════
  /**
   * Take delivery of emergencies a device raised while it had no network.
   *
   * The client stores an off-grid SOS locally, tells the user plainly that
   * nothing has been transmitted, and sends it here the moment connectivity
   * returns. Four rules govern what happens on arrival, and each is enforced
   * rather than assumed:
   *
   *   1. **Authenticated.** A device syncs as the account that raised it, using
   *      the ordinary session. There is no anonymous intake path.
   *   2. **Re-validated.** Everything below is validated as if it came from an
   *      attacker, because a payload that has been sitting on a phone is exactly
   *      that: it left our control, and it can be edited on a rooted device.
   *      The device's integrity digest is recorded as evidence, never trusted as
   *      authorisation — it proves the record was not corrupted in storage, not
   *      that it was not forged.
   *   3. **Idempotent.** `client_incident_id` is unique. A retry after a lost
   *      response — the normal way retries duplicate things — collides and does
   *      nothing rather than raising a second emergency.
   *   4. **Never auto-escalated.** This creates the incident; it does not alert
   *      anybody. An incident that may be hours old must not silently SMS a
   *      family at 3am on reconnect. Escalation stays where it already lives, in
   *      POST /v1/sos/:id/confirm, which the client calls as an explicit step of
   *      the reconnection flow. Same discipline as ADR-0005's rule that a model
   *      raises a signal and a human confirms.
   */
  const OFFGRID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // matches the device retention window
  const OFFGRID_FUTURE_SKEW_MS = 5 * 60 * 1000;         // a phone's clock is allowed to be wrong

  app.post("/v1/sos/offline-sync", { preHandler: [authenticate, limit("sync")] }, async (req) => {
    const { incidents } = z.object({
      incidents: z.array(z.object({
        // The device-minted reference. Format is pinned so a client cannot smuggle
        // a colliding or oversized key past the unique index.
        clientIncidentId: z.string().regex(/^RA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/,
          "clientIncidentId must look like RA-K7P2QX"),
        opId: z.string().min(8).max(64),
        occurredAt: z.coerce.date(),
        emergencyType: z.enum(["breakdown", "accident", "medical", "unsafe", "other"]).default("other"),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
        accuracyM: z.number().min(0).max(1_000_000).nullable().optional(),
        vehicleId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
        /** What the on-device rules engine concluded, if it was run. */
        diagnosis: z.object({
          cause: z.string().max(200),
          confidence: z.number().min(0).max(1),
          severity: z.number().int().min(1).max(5),
          engine: z.string().max(40),
        }).optional(),
        /** SHA-256 the device computed over its own stored payload. Evidence only. */
        integrity: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      })).min(1).max(50),
    }).parse(req.body);

    const now = Date.now();
    const results: Array<Record<string, unknown>> = [];

    for (const it of incidents) {
      const age = now - it.occurredAt.getTime();
      if (age < -OFFGRID_FUTURE_SKEW_MS) {
        results.push({ clientIncidentId: it.clientIncidentId, status: "rejected",
          reason: "occurredAt is in the future — the device clock cannot be trusted for this record" });
        continue;
      }
      if (age > OFFGRID_MAX_AGE_MS) {
        results.push({ clientIncidentId: it.clientIncidentId, status: "rejected",
          reason: "older than the 7-day retention window — raise a fresh incident instead" });
        continue;
      }

      // A vehicle id from an offline payload is unverified. Rather than reject the
      // whole emergency over it, the link is dropped and the incident still lands.
      let vehicleId: string | undefined;
      if (it.vehicleId) {
        const [v] = await db.select({ id: S.userVehicles.vehicleId }).from(S.userVehicles)
          .where(and(
            eq(S.userVehicles.vehicleId, it.vehicleId),
            eq(S.userVehicles.userId, req.user!.sub),
            isNull(S.userVehicles.deletedAt),
          )).limit(1);
        vehicleId = v?.id;
      }

      // Accidents and medical calls arrive as CRITICAL; a breakdown does not.
      const severity = it.emergencyType === "accident" || it.emergencyType === "medical"
        ? "CRITICAL" as const : "HIGH" as const;

      /**
       * The same unit-of-work rule as POST /v1/sos above, and it matters more
       * here: this is an emergency that already happened, replayed from a device
       * whose link just came back and may go again mid-request. The incident,
       * its position, its evidence signal and its journal entry commit together
       * or not at all — a partial replay leaves a located-nowhere incident that
       * the next retry converges on and therefore never repairs.
       */
      const inserted = await db.transaction(async (tx) => {
        const [row] = await tx.insert(S.incidents).values({
          userId: req.user!.sub,
          vehicleId,
          clientIncidentId: it.clientIncidentId,
          occurredAt: it.occurredAt,
          emergencyType: it.emergencyType,
          syncedAt: new Date(),
          // A manual off-grid SOS is a human act at the moment it was raised, so it
          // arrives confirmed — but confirmed is not escalated (rule 4 above).
          status: "CONFIRMED",
          severity,
          detectedByModel: false,
          confirmedBy: "user",
          confirmedAt: it.occurredAt,
          // This is the degraded path, by definition. Flagged so the emergency
          // analytics can tell an off-grid rescue from an ordinary one.
          degradedPath: true,
        }).onConflictDoNothing({ target: S.incidents.clientIncidentId }).returning();

        // Already synchronised. Nothing written, transaction still clean.
        if (!row) return null;

        if (it.lat != null && it.lng != null) {
          await tx.execute(raw`
            UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(${it.lng}, ${it.lat}), 4326)
            WHERE id = ${row.id}`);
        }

        // The signal row is the evidence trail: what the device captured, when, how
        // accurately, and what its own engine made of it.
        await tx.insert(S.incidentSignals).values({
          incidentId: row.id,
          kind: "offgrid_sos",
          payload: {
            clientIncidentId: it.clientIncidentId,
            opId: it.opId,
            occurredAt: it.occurredAt.toISOString(),
            syncedAt: new Date().toISOString(),
            lat: it.lat ?? null, lng: it.lng ?? null, accuracyM: it.accuracyM ?? null,
            locationKnown: it.lat != null && it.lng != null,
            emergencyType: it.emergencyType,
            note: it.note ?? null,
            localDiagnosis: it.diagnosis ?? null,
            deviceIntegrity: it.integrity ?? null,
            storedOfflineForMs: age,
          },
        });

        // The same journal every other offline operation lands in, so "what did this
        // device replay?" has one answer rather than two. In here with the incident
        // for exactly that reason — committed separately it could disagree with the
        // row it describes.
        await tx.insert(S.syncOperations).values({
          userId: req.user!.sub, opId: it.opId, entity: "incident",
          entityId: row.id, operation: "create",
          payload: { clientIncidentId: it.clientIncidentId, emergencyType: it.emergencyType,
                     offGrid: true, integrity: it.integrity ?? null },
          clientUpdatedAt: it.occurredAt, appliedAt: new Date(),
        }).onConflictDoNothing();

        return row;
      });

      if (!inserted) {
        // Already known. Return the existing incident so a retry converges on the
        // same id instead of leaving the device unsure what happened.
        const [existing] = await db.select().from(S.incidents)
          .where(eq(S.incidents.clientIncidentId, it.clientIncidentId)).limit(1);
        if (existing && existing.userId !== req.user!.sub) {
          results.push({ clientIncidentId: it.clientIncidentId, status: "rejected",
            reason: "that reference belongs to another account" });
          continue;
        }
        results.push({
          clientIncidentId: it.clientIncidentId, id: existing?.id, status: "duplicate",
          incidentStatus: existing?.status,
          reason: "already synchronised — the replay was ignored, no second incident was created",
        });
        continue;
      }

      // Tamper-evident record that an off-grid emergency entered the platform.
      await audit({
        actorId: req.user!.sub, actorRole: "citizen",
        action: "sos.offgrid_synced", entity: "incident", entityId: inserted.id,
        after: {
          clientIncidentId: it.clientIncidentId,
          emergencyType: it.emergencyType,
          occurredAt: it.occurredAt.toISOString(),
          storedOfflineForMs: age,
          locationKnown: it.lat != null && it.lng != null,
          deviceIntegrity: it.integrity ?? null,
        },
        ip: req.ip,
      });

      publish(req.user!.sub, {
        type: "sos.status", incidentId: inserted.id, status: inserted.status,
        clientIncidentId: it.clientIncidentId, source: "offgrid_sync",
      });

      results.push({
        clientIncidentId: it.clientIncidentId, id: inserted.id, status: "created",
        incidentStatus: inserted.status,
        storedOfflineForMs: age,
        // Explicit, because the client's next step depends on it.
        escalationRequired: true,
      });
    }

    await audit({
      actorId: req.user!.sub, actorRole: "citizen", action: "sync.completed",
      entity: "sync_batch", entityId: null,
      after: {
        kind: "offgrid_sos",
        submitted: incidents.length,
        created: results.filter((r) => r.status === "created").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        rejected: results.filter((r) => r.status === "rejected").length,
      },
      ip: req.ip,
    });

    const created = results.filter((r) => r.status === "created").length;
    if (created) {
      alerts.sosSynced(created, Math.max(0, ...results.map((r) => ("storedOfflineForMs" in r ? Number(r.storedOfflineForMs) || 0 : 0))));
    }
    return ok({ results }, {
      created,
      duplicates: results.filter((r) => r.status === "duplicate").length,
      rejected: results.filter((r) => r.status === "rejected").length,
      note: created
        ? "Incidents recorded. Nothing has been alerted yet — call POST /v1/sos/:id/confirm to escalate."
        : "No new incidents; every entry was a replay or was rejected.",
    });
  });
}
