/**
 * The mechanic's own views: the offers waiting for them, the jobs they are
 * driving, and their availability switch.
 *
 * Lifted out of server.ts unchanged. Every route here is role-gated to
 * mechanic or admin AND scoped to the caller's own mechanic row — the role
 * says what kind of account this is, the row says which one, and both are
 * needed or one mechanic reads another's work queue.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { isoTimestamp, ok } from "../http.js";
import { audit } from "../audit.js";
import { authenticate, requireRole } from "../auth.js";

export async function mechanicRoutes(app: FastifyInstance) {
  // ══ mechanic view ══════════════════════════════════════════════════════════
  app.get("/v1/mechanic/offers", { preHandler: [authenticate, requireRole("mechanic", "admin")] }, async (req) => {
    const [mech] = await db.select().from(S.mechanics).where(eq(S.mechanics.userId, req.user!.sub)).limit(1);
    if (!mech) return ok([], { note: "This account is not registered as a mechanic" });
    // Expired offers are filtered out rather than listed. They used to accumulate
    // in the inbox as cards whose Accept button was guaranteed to fail, which is
    // a dead button by any other name.
    const rows = await db.select().from(S.dispatchOffers)
      .where(and(eq(S.dispatchOffers.mechanicId, mech.id), eq(S.dispatchOffers.status, "SENT"),
                 raw`${S.dispatchOffers.expiresAt} > now()`))
      .orderBy(desc(S.dispatchOffers.createdAt)).limit(20);

    // The customer is stranded somewhere specific — a mechanic deciding whether to
    // take a job needs to know what and where before accepting, not after.
    const enriched = await Promise.all(rows.map(async (o) => {
      const [ctx] = await db.execute<{
        reference: string; symptoms: string | null; address_text: string | null;
        highway_marker: string | null; registration_no: string; vehicle_class: string;
        service_label: string | null; lat: number | null; lng: number | null;
      }>(raw`
        SELECT b.reference, b.symptoms, b.address_text, b.highway_marker,
               v.registration_no, v.vehicle_class, s.label AS service_label,
               ST_Y(b.location) AS lat, ST_X(b.location) AS lng
          FROM bookings b
          JOIN vehicles v ON v.id = b.vehicle_id
          LEFT JOIN service_types s ON s.id = b.service_type_id
         WHERE b.id = ${o.bookingId}`);
      return {
        ...o,
        booking: ctx
          ? {
              reference: ctx.reference, symptoms: ctx.symptoms,
              addressText: ctx.address_text, highwayMarker: ctx.highway_marker,
              registrationNo: ctx.registration_no, vehicleClass: ctx.vehicle_class,
              serviceLabel: ctx.service_label, lat: ctx.lat, lng: ctx.lng,
            }
          : null,
      };
    }));
    return ok(enriched, { availableNow: mech.isAvailable });
  });

  /**
   * The mechanic's own console state: who they are, whether dispatch can reach
   * them, the job they are currently on, and what they have finished.
   *
   * The active job is looked up from the bookings table rather than remembered by
   * the client, so closing the console mid-job and reopening it lands back on the
   * same job instead of an empty screen.
   */
  const MECHANIC_OPEN_STATUSES = ["ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS",
                                  "AWAITING_PARTS", "ESCALATED", "COMPLETED"] as const;

  app.get("/v1/mechanic/jobs", { preHandler: [authenticate, requireRole("mechanic", "admin")] }, async (req) => {
    const [mech] = await db.select().from(S.mechanics).where(eq(S.mechanics.userId, req.user!.sub)).limit(1);
    if (!mech) return ok({ mechanic: null, active: null, history: [] }, { note: "This account is not registered as a mechanic" });

    const rows = await db.execute<{
      id: string; reference: string; status: string; created_at: string; completed_at: string | null;
      symptoms: string | null; registration_no: string; service_label: string | null;
      total_paise: number | null; rating: number | null;
    }>(raw`
      SELECT b.id, b.reference, b.status::text AS status, b.created_at, b.completed_at,
             b.symptoms, v.registration_no, s.label AS service_label,
             i.total_paise, r.rating
        FROM bookings b
        JOIN vehicles v ON v.id = b.vehicle_id
        LEFT JOIN service_types s ON s.id = b.service_type_id
        LEFT JOIN invoices i ON i.booking_id = b.id AND i.deleted_at IS NULL
        LEFT JOIN reviews  r ON r.booking_id = b.id AND r.deleted_at IS NULL
       WHERE b.mechanic_id = ${mech.id} AND b.deleted_at IS NULL
       ORDER BY b.created_at DESC
       LIMIT 40`);

    const open = new Set<string>(MECHANIC_OPEN_STATUSES);
    const active = rows.find((r) => open.has(r.status)) ?? null;

    return ok({
      mechanic: {
        id: mech.id, displayName: mech.displayName, rating: Number(mech.rating),
        jobsCompleted: mech.jobsCompleted, isAvailable: mech.isAvailable, verified: mech.verified,
      },
      activeBookingId: active?.id ?? null,
      history: rows.filter((r) => r.id !== active?.id).map((r) => ({
        id: r.id, reference: r.reference, status: r.status, createdAt: isoTimestamp(r.created_at),
        completedAt: isoTimestamp(r.completed_at), registrationNo: r.registration_no,
        serviceLabel: r.service_label, symptoms: r.symptoms,
        totalPaise: r.total_paise == null ? null : Number(r.total_paise),
        rating: r.rating == null ? null : Number(r.rating),
      })),
    }, { count: rows.length });
  });

  /**
   * Go on or off duty.
   *
   * `is_available` already gated the dispatch query — nothing could ever set it,
   * so a mechanic was whatever the seed decided, permanently. Going off duty now
   * genuinely removes them from dispatch; the location update is accepted in the
   * same call because a mechanic coming on duty is exactly when their position is
   * worth refreshing.
   */
  app.post("/v1/mechanic/availability", { preHandler: [authenticate, requireRole("mechanic", "admin")] }, async (req, reply) => {
    const body = z.object({
      isAvailable: z.boolean(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    }).parse(req.body);

    const [mech] = await db.select().from(S.mechanics).where(eq(S.mechanics.userId, req.user!.sub)).limit(1);
    if (!mech) {
      return reply.code(404).send({
        error: { code: "not_a_mechanic", title: "This account is not registered as a mechanic", retryable: false },
      });
    }

    await db.update(S.mechanics)
      .set({ isAvailable: body.isAvailable, updatedAt: new Date() })
      .where(eq(S.mechanics.id, mech.id));

    if (body.lat != null && body.lng != null) {
      await db.execute(raw`
        UPDATE mechanics
           SET last_location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326),
               last_location_at = now()
         WHERE id = ${mech.id}`);
    }

    await audit({
      actorId: req.user!.sub, actorRole: "mechanic",
      action: body.isAvailable ? "mechanic.on_duty" : "mechanic.off_duty",
      entity: "mechanic", entityId: mech.id,
      after: { isAvailable: body.isAvailable }, ip: req.ip,
    });

    return ok({ id: mech.id, isAvailable: body.isAvailable },
      { message: body.isAvailable ? "You are on duty — dispatch can reach you." : "Off duty. No new offers will be sent." });
  });
}
