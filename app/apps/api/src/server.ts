import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { and, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";

import { env, assertProductionSafe } from "./env.js";
import { db, sql } from "./db.js";
import * as S from "@roadassist/db";
import {
  authenticate, constantTimeEquals, otpAttemptsInWindow, otpRequestsFromIp,
  requireRole, rotateSession, sha256, startSession,
} from "./auth.js";
import { apply, allowedFrom, IllegalTransition, type Command, type Status } from "./domain/booking-machine.js";
import { rankMechanics } from "./domain/ai-rules.js";
import { diagnoseWithFallback, maps, providerSummary, sms } from "./providers.js";
import { rakshaRoutes } from "./raksha.js";

assertProductionSafe();

const app = Fastify({
  logger: { level: env.nodeEnv === "test" ? "silent" : "info" },
  genReqId: () => randomUUID(),
});
await app.register(cors, { origin: true });

/**
 * Treat an empty JSON body as `{}`.
 *
 * Several endpoints take no body at all (accepting an offer) or an entirely
 * optional one (dispatch, which has defaults). Clients routinely send
 * `content-type: application/json` with nothing after it, and Fastify's default
 * parser rejects that with a 400 the caller cannot act on.
 */
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  const text = typeof body === "string" ? body.trim() : "";
  // Webhook signatures are computed over the exact bytes the vendor sent, so
  // the raw text is kept alongside the parsed object.
  (req as { rawBody?: string }).rawBody = typeof body === "string" ? body : "";
  if (!text) return done(null, {});
  try {
    done(null, JSON.parse(text));
  } catch {
    done(Object.assign(new Error("Request body is not valid JSON"), { statusCode: 400 }), undefined);
  }
});

/** Uniform error envelope (API style guide §6). */
app.setErrorHandler((err, req, reply) => {
  if (err instanceof IllegalTransition) {
    return reply.code(409).send({
      error: { code: err.code, title: err.message, retryable: false, requestId: req.id },
    });
  }
  if (err instanceof z.ZodError) {
    return reply.code(400).send({
      error: {
        code: "invalid_request", title: "Some fields need fixing", retryable: false,
        fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.id,
      },
    });
  }
  req.log.error({ err }, "unhandled");
  console.error("[error]", req.method, req.url, "\n", err);
  return reply.code(500).send({
    error: {
      code: "internal", title: "Something went wrong on our side", retryable: true, requestId: req.id,
      // Detail is for developers, so it is withheld in production. `err` has been
      // narrowed past the handled cases above, so read the message defensively.
      ...(env.nodeEnv === "production"
        ? {}
        : { detail: err instanceof Error ? err.message : String(err) }),
    },
  });
});

// The demo client is served from the API so the whole slice is one command.
await app.register(fastifyStatic, {
  root: resolve(dirname(fileURLToPath(import.meta.url)), "../../web"),
  prefix: "/",
  index: ["index.html"],
});
// Demo media (videos, photos) live in the repo's site/ folder — served here so
// the showcase page can embed them without duplicating megabytes into app/.
await app.register(fastifyStatic, {
  root: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../site"),
  prefix: "/media/",
  decorateReply: false,
});

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ data, meta });

// ── offline-map tile proxy ──────────────────────────────────────────────────
// OSM tiles carry no CORS headers, so a browser cannot cache-and-reuse them
// offline. This same-origin proxy (small zoom window, in-memory cache, polite
// User-Agent, attribution required in every client) makes Trip Guardian's
// pre-downloaded maps actually usable. © OpenStreetMap contributors.
const tileCache = new Map<string, Buffer>();
app.get("/tiles/:z/:x/:file", async (req, reply) => {
  const p = z.object({
    z: z.coerce.number().int().min(11).max(15),
    x: z.coerce.number().int().min(0),
    file: z.string().regex(/^\d+\.png$/),
  }).parse(req.params);
  const y = Number(p.file.replace(".png", ""));
  const key = `${p.z}/${p.x}/${y}`;

  let buf = tileCache.get(key);
  if (!buf) {
    const res = await fetch(`https://tile.openstreetmap.org/${key}.png`, {
      headers: { "user-agent": "RoadAssistDemo/0.1 (student project; trip-guardian prefetch)" },
    });
    if (!res.ok) {
      return reply.code(502).send({ error: { code: "tile_unavailable", title: "Map tile could not be fetched", retryable: true } });
    }
    buf = Buffer.from(await res.arrayBuffer());
    if (tileCache.size > 600) tileCache.clear();   // tiny corridor cache, never grows unbounded
    tileCache.set(key, buf);
  }
  return reply.header("cache-control", "public, max-age=86400").type("image/png").send(buf);
});

// ══ health ═════════════════════════════════════════════════════════════════
app.get("/health", async () => {
  const t0 = Date.now();
  const [{ n }] = await db.execute<{ n: number }>(raw`SELECT 1::int AS n`);
  return ok({
    status: n === 1 ? "ok" : "degraded",
    dbLatencyMs: Date.now() - t0,
    providers: providerSummary(),
    version: "0.1.0",
  });
});

app.get("/v1/service-types", async () => {
  const rows = await db.select().from(S.serviceTypes).where(isNull(S.serviceTypes.deletedAt));
  return ok(rows);
});

// ══ auth ═══════════════════════════════════════════════════════════════════
const msisdnSchema = z.string().regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number");

app.post("/v1/auth/otp/request", async (req, reply) => {
  const { msisdn } = z.object({ msisdn: msisdnSchema }).parse(req.body);

  if (await otpAttemptsInWindow(db, msisdn) >= env.otpMaxAttempts) {
    return reply.code(429).send({
      error: {
        code: "too_many_requests",
        title: `Too many codes requested. Try again in ${env.otpWindowMinutes} minutes.`,
        retryable: true,
      },
    });
  }
  // Second axis of threat #1: one address hammering many numbers.
  if (await otpRequestsFromIp(db, req.ip) >= env.otpIpMax) {
    return reply.code(429).send({
      error: {
        code: "otp_ip_limited",
        title: `Too many codes requested from this connection. Try again in ${env.otpWindowMinutes} minutes.`,
        retryable: true,
      },
    });
  }

  const code = env.nodeEnv === "production" ? String(Math.floor(100000 + Math.random() * 900000)) : env.devOtp;
  await db.insert(S.otpChallenges).values({
    msisdn, codeHash: sha256(code), ip: req.ip,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  await sms.send(msisdn, `${code} is your RoadAssist verification code. It expires in 5 minutes.`);

  return ok(
    { sent: true, expiresInSeconds: 300 },
    env.exposeDevOtp ? { devOtp: code, note: "Returned only because EXPOSE_DEV_OTP is on" } : {},
  );
});

app.post("/v1/auth/otp/verify", async (req, reply) => {
  const { msisdn, code } = z.object({ msisdn: msisdnSchema, code: z.string().length(6) }).parse(req.body);

  const [challenge] = await db.select().from(S.otpChallenges)
    .where(and(eq(S.otpChallenges.msisdn, msisdn), isNull(S.otpChallenges.consumedAt)))
    .orderBy(desc(S.otpChallenges.createdAt)).limit(1);

  const invalid = () => reply.code(401).send({
    error: { code: "otp_invalid", title: "That code is not right. Check it and try again.", retryable: true },
  });

  if (!challenge) return invalid();
  if (challenge.expiresAt.getTime() < Date.now()) {
    return reply.code(401).send({
      error: { code: "otp_expired", title: "That code has expired. Request a new one.", retryable: true },
    });
  }
  if (challenge.attempts >= env.otpMaxAttempts) {
    return reply.code(429).send({
      error: { code: "otp_locked", title: "Too many wrong attempts. Request a new code.", retryable: true },
    });
  }
  if (!constantTimeEquals(sha256(code), challenge.codeHash)) {
    await db.update(S.otpChallenges)
      .set({ attempts: challenge.attempts + 1, updatedAt: new Date() })
      .where(eq(S.otpChallenges.id, challenge.id));
    return invalid();
  }

  await db.update(S.otpChallenges)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(eq(S.otpChallenges.id, challenge.id));

  let [user] = await db.select().from(S.users).where(eq(S.users.msisdn, msisdn)).limit(1);
  let created = false;
  if (!user) {
    [user] = await db.insert(S.users).values({ msisdn, isVerified: true }).returning();
    const [citizen] = await db.select().from(S.roles).where(eq(S.roles.name, "citizen")).limit(1);
    if (citizen) await db.insert(S.userRoles).values({ userId: user.id, roleId: citizen.id });
    created = true;
  } else if (!user.isVerified) {
    await db.update(S.users).set({ isVerified: true, updatedAt: new Date() }).where(eq(S.users.id, user.id));
  }

  const session = await startSession(db, user.id, { ip: req.ip, ua: req.headers["user-agent"] });
  return ok({ ...session, user: { id: user.id, msisdn: user.msisdn, fullName: user.fullName } }, { newAccount: created });
});

app.post("/v1/auth/refresh", async (req, reply) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
  const result = await rotateSession(db, refreshToken, { ip: req.ip, ua: req.headers["user-agent"] });
  if (!result.ok) {
    return reply.code(401).send({
      error: {
        code: result.reason,
        title: result.reason === "reuse_detected"
          ? "For your security every session has been signed out. Please sign in again."
          : "Your session has expired. Sign in again.",
        retryable: false,
      },
    });
  }
  return ok(result);
});

app.get("/v1/me", { preHandler: authenticate }, async (req) => {
  const [user] = await db.select().from(S.users).where(eq(S.users.id, req.user!.sub)).limit(1);
  const vehicles = await db.select({
    id: S.vehicles.id, registrationNo: S.vehicles.registrationNo,
    vehicleClass: S.vehicles.vehicleClass, nickname: S.vehicles.nickname,
    odometerKm: S.vehicles.odometerKm,
  }).from(S.userVehicles)
    .innerJoin(S.vehicles, eq(S.vehicles.id, S.userVehicles.vehicleId))
    .where(and(eq(S.userVehicles.userId, req.user!.sub), isNull(S.userVehicles.deletedAt)));
  return ok({ user: { id: user.id, msisdn: user.msisdn, fullName: user.fullName }, roles: req.user!.roles, vehicles });
});

// ══ vehicles ═══════════════════════════════════════════════════════════════
app.post("/v1/vehicles", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    registrationNo: z.string().min(4).max(16).transform((s) => s.toUpperCase().replace(/\s+/g, "")),
    vehicleClass: z.enum(["car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev"]),
    nickname: z.string().max(60).optional(),
    odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  }).parse(req.body);

  const [existing] = await db.select().from(S.vehicles)
    .where(eq(S.vehicles.registrationNo, body.registrationNo)).limit(1);
  if (existing) {
    return reply.code(409).send({
      error: { code: "vehicle_exists", title: "That registration number is already on the platform", retryable: false },
    });
  }

  const [vehicle] = await db.insert(S.vehicles).values({
    registrationNo: body.registrationNo, vehicleClass: body.vehicleClass,
    nickname: body.nickname, odometerKm: body.odometerKm ?? 0,
  }).returning();
  await db.insert(S.userVehicles).values({ userId: req.user!.sub, vehicleId: vehicle.id, isPrimary: true });

  return reply.code(201).send(ok(vehicle));
});

// ══ diagnosis ══════════════════════════════════════════════════════════════
app.post("/v1/diagnose", { preHandler: authenticate }, async (req) => {
  const body = z.object({
    vehicleId: z.string().uuid().optional(),
    symptoms: z.string().max(500).optional(),
    dtcCodes: z.array(z.string().max(12)).max(10).optional(),
    ranOffline: z.boolean().optional(),
  }).parse(req.body);

  const result = await diagnoseWithFallback(body);

  if (body.vehicleId) {
    const [session] = await db.insert(S.diagnosticSessions).values({
      vehicleId: body.vehicleId, userId: req.user!.sub,
      source: body.dtcCodes?.length ? "obd" : "symptom",
      symptomsText: body.symptoms, ranOffline: body.ranOffline ?? false,
    }).returning({ id: S.diagnosticSessions.id });
    await db.insert(S.diagnosticFindings).values({
      sessionId: session.id, cause: result.cause, confidence: result.confidence,
      severity: result.severity, driveable: result.driveable,
      predictedParts: result.parts, modelVersion: result.modelVersion,
      usedFallback: result.usedFallback,
    });
  }

  // Auditable without retaining the input (threat #10).
  await db.insert(S.modelPredictions).values({
    capability: "diagnose", modelVersion: result.modelVersion,
    inputHash: sha256(JSON.stringify(body)), confidence: result.confidence,
    latencyMs: result.latencyMs, usedFallback: result.usedFallback, subjectId: req.user!.sub,
  });

  return ok(result, { modelVersion: result.modelVersion, usedFallback: result.usedFallback });
});

// ══ bookings ═══════════════════════════════════════════════════════════════
const reference = () => "RA" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

app.post("/v1/bookings", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    vehicleId: z.string().uuid(),
    serviceTypeCode: z.string().min(2),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    symptoms: z.string().max(500).optional(),
    addressText: z.string().max(200).optional(),
    highwayMarker: z.string().max(40).optional(),
    createdOffline: z.boolean().optional(),
    idempotencyKey: z.string().max(80).optional(),
  }).parse(req.body);

  const idemKey = body.idempotencyKey ?? (req.headers["idempotency-key"] as string | undefined);
  if (idemKey) {
    const [seen] = await db.select().from(S.idempotencyKeys)
      .where(and(eq(S.idempotencyKeys.key, idemKey), eq(S.idempotencyKeys.endpoint, "POST /v1/bookings"))).limit(1);
    if (seen) return reply.code(seen.responseStatus ?? 200).send(seen.responseBody);
  }

  // Ownership check at the resource, not just the route (threat #5).
  const [owned] = await db.select().from(S.userVehicles)
    .where(and(eq(S.userVehicles.userId, req.user!.sub), eq(S.userVehicles.vehicleId, body.vehicleId),
               isNull(S.userVehicles.deletedAt))).limit(1);
  if (!owned) {
    return reply.code(403).send({
      error: { code: "not_your_vehicle", title: "That vehicle is not on your account", retryable: false },
    });
  }

  const [svc] = await db.select().from(S.serviceTypes).where(eq(S.serviceTypes.code, body.serviceTypeCode)).limit(1);
  if (!svc) {
    return reply.code(400).send({ error: { code: "unknown_service", title: "That service type does not exist", retryable: false } });
  }

  // A stranded user often cannot type an address, so derive one when it is
  // missing. The local provider returns coordinates and flags itself estimated.
  const address = body.addressText
    ?? (await maps.reverseGeocode({ lat: body.lat, lng: body.lng }).catch(() => null))?.label
    ?? undefined;

  const [booking] = await db.insert(S.bookings).values({
    reference: reference(), userId: req.user!.sub, vehicleId: body.vehicleId,
    serviceTypeId: svc.id, status: "DRAFT", symptoms: body.symptoms,
    addressText: address, highwayMarker: body.highwayMarker,
    quotedPaise: svc.baseFarePaise, createdOffline: body.createdOffline ?? false,
    clientUpdatedAt: new Date(),
  }).returning();

  await db.execute(raw`
    UPDATE bookings SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
    WHERE id = ${booking.id}`);

  const { to } = apply("DRAFT", "submit");
  await db.update(S.bookings)
    .set({ status: to, requestedAt: new Date(), updatedAt: new Date(), version: booking.version + 1 })
    .where(eq(S.bookings.id, booking.id));
  await db.insert(S.bookingEvents).values({
    bookingId: booking.id, fromStatus: "DRAFT", toStatus: to,
    command: "submit", actorId: req.user!.sub, actorRole: "citizen",
  });

  const payload = ok({ ...booking, status: to, lat: body.lat, lng: body.lng },
                     { nextCommands: allowedFrom(to) });
  if (idemKey) {
    await db.insert(S.idempotencyKeys).values({
      key: idemKey, userId: req.user!.sub, endpoint: "POST /v1/bookings",
      responseStatus: 201, responseBody: payload,
    }).onConflictDoNothing();
  }
  return reply.code(201).send(payload);
});

/** Dispatch: PostGIS nearest-neighbour, then the deterministic ranker. */
app.post("/v1/bookings/:id/dispatch", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { radiusKm = 25, limit = 5 } = z.object({
    radiusKm: z.number().min(1).max(100).optional(), limit: z.number().min(1).max(20).optional(),
  }).parse(req.body ?? {});

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });
  if (booking.userId !== req.user!.sub) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That booking is not yours", retryable: false } });
  }

  const { to } = apply(booking.status as Status, "dispatch.start");

  const candidates = await db.execute<{
    id: string; display_name: string; rating: number; jobs_completed: number; distance_km: number;
  }>(raw`
    SELECT m.id, m.display_name, m.rating, m.jobs_completed,
           ST_Distance(m.last_location::geography, b.location::geography) / 1000 AS distance_km
      FROM mechanics m, bookings b
     WHERE b.id = ${id}
       AND m.deleted_at IS NULL AND m.verified AND m.is_available
       AND ST_DWithin(m.last_location::geography, b.location::geography, ${radiusKm * 1000})
     ORDER BY m.last_location <-> b.location
     LIMIT ${limit}`);

  const ranked = rankMechanics(candidates.map((c) => ({
    id: c.id, displayName: c.display_name, rating: Number(c.rating),
    jobsCompleted: Number(c.jobs_completed), distanceKm: Number(Number(c.distance_km).toFixed(2)),
  })));

  if (ranked.length === 0) {
    const noSupply = apply(to, "offers.exhausted");
    await db.update(S.bookings).set({ status: noSupply.to, updatedAt: new Date() }).where(eq(S.bookings.id, id));
    await db.insert(S.bookingEvents).values({
      bookingId: id, fromStatus: to, toStatus: noSupply.to, command: "offers.exhausted", actorRole: "system",
    });
    return ok({ offers: [], status: noSupply.to },
      { message: `No available mechanic within ${radiusKm} km. Widen the radius to try again.` });
  }

  await db.update(S.bookings).set({ status: to, updatedAt: new Date() }).where(eq(S.bookings.id, id));
  await db.insert(S.bookingEvents).values({
    bookingId: id, fromStatus: booking.status, toStatus: to, command: "dispatch.start", actorRole: "system",
  });

  const offers = await db.insert(S.dispatchOffers).values(
    ranked.map((m, i) => ({
      bookingId: id, mechanicId: m.id, rank: i + 1, score: m.score,
      distanceKm: m.distanceKm, etaMinutes: m.etaMinutes,
      expiresAt: new Date(Date.now() + 90_000), usedFallback: true,
    })),
  ).returning();

  return ok({
    status: to,
    offers: offers.map((o, i) => ({ ...o, mechanic: ranked[i] })),
  }, { rankedBy: "rules-1.0.0", radiusKm });
});

app.post("/v1/offers/:offerId/accept", { preHandler: authenticate }, async (req, reply) => {
  const { offerId } = z.object({ offerId: z.string().uuid() }).parse(req.params);
  const [offer] = await db.select().from(S.dispatchOffers).where(eq(S.dispatchOffers.id, offerId)).limit(1);
  if (!offer) return reply.code(404).send({ error: { code: "not_found", title: "Offer not found", retryable: false } });

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, offer.bookingId)).limit(1);

  // Only the offer's mechanic, the customer who owns the booking, or an admin
  // may act on an offer — checked before the status so strangers learn nothing.
  const caller = req.user!;
  const [offerMech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
    .where(eq(S.mechanics.id, offer.mechanicId)).limit(1);
  if (booking.userId !== caller.sub && offerMech?.userId !== caller.sub && !caller.roles.includes("admin")) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That offer is not yours to accept", retryable: false } });
  }

  if (offer.status !== "SENT") {
    return reply.code(409).send({ error: { code: "offer_closed", title: `This offer is already ${offer.status.toLowerCase()}`, retryable: false } });
  }

  const { to } = apply(booking.status as Status, "mechanic.accept");

  await db.transaction(async (tx) => {
    await tx.update(S.dispatchOffers).set({ status: "ACCEPTED", respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(S.dispatchOffers.id, offerId));
    await tx.update(S.dispatchOffers).set({ status: "WITHDRAWN", updatedAt: new Date() })
      .where(and(eq(S.dispatchOffers.bookingId, offer.bookingId), eq(S.dispatchOffers.status, "SENT")));
    await tx.update(S.bookings)
      .set({ status: to, mechanicId: offer.mechanicId, assignedAt: new Date(), updatedAt: new Date() })
      .where(eq(S.bookings.id, offer.bookingId));
    await tx.insert(S.bookingEvents).values({
      bookingId: offer.bookingId, fromStatus: booking.status, toStatus: to,
      command: "mechanic.accept", actorId: offer.mechanicId, actorRole: "mechanic",
    });
  });

  return ok({ bookingId: offer.bookingId, status: to, mechanicId: offer.mechanicId, etaMinutes: offer.etaMinutes },
             { nextCommands: allowedFrom(to) });
});

/** Generic guarded transition — every other state change goes through here. */
app.post("/v1/bookings/:id/transition", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { command } = z.object({ command: z.string() }).parse(req.body);

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });

  // Ownership check at the resource, not just the route (threat #5): only the
  // customer, the assigned mechanic or an admin may drive this booking.
  const caller = req.user!;
  let isAssignedMechanic = false;
  if (booking.mechanicId) {
    const [mech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
      .where(eq(S.mechanics.id, booking.mechanicId)).limit(1);
    isAssignedMechanic = mech?.userId === caller.sub;
  }
  if (booking.userId !== caller.sub && !isAssignedMechanic && !caller.roles.includes("admin")) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That booking is not yours", retryable: false } });
  }

  const { to, cancellationFee } = apply(booking.status as Status, command as Command);

  const patch: Record<string, unknown> = { status: to, updatedAt: new Date(), version: booking.version + 1 };
  if (to === "COMPLETED") patch.completedAt = new Date();
  if (to === "CANCELLED") { patch.cancelledAt = new Date(); patch.cancelReason = "user_cancelled"; }

  let invoice = null;
  const applied = await db.transaction(async (tx) => {
    // Guarded update: the row must still be in the state the transition was
    // computed from, so two concurrent commands cannot both win.
    const updated = await tx.update(S.bookings).set(patch)
      .where(and(eq(S.bookings.id, id), eq(S.bookings.status, booking.status)))
      .returning({ id: S.bookings.id });
    if (!updated.length) return false;

    await tx.insert(S.bookingEvents).values({
      bookingId: id, fromStatus: booking.status, toStatus: to,
      command, actorId: caller.sub, actorRole: caller.roles[0] ?? "citizen",
    });

    if (to === "COMPLETED") {
      const [svc] = booking.serviceTypeId
        ? await tx.select().from(S.serviceTypes).where(eq(S.serviceTypes.id, booking.serviceTypeId)).limit(1)
        : [];
      const labour = svc?.baseFarePaise ?? 39900;
      const tax = Math.round(labour * 0.18);
      [invoice] = await tx.insert(S.invoices).values({
        bookingId: id, number: "INV" + randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase(),
        labourPaise: labour, partsPaise: 0, taxPaise: tax, totalPaise: labour + tax,
        breakdown: { labour, parts: 0, tax, note: "GST at 18% on labour" },
      }).returning();
    }
    return true;
  });

  if (!applied) {
    return reply.code(409).send({
      error: { code: "conflict", title: "The booking changed while this request was in flight. Reload and retry.", retryable: true },
    });
  }

  return ok({ id, status: to, cancellationFee, invoice }, { nextCommands: allowedFrom(to) });
});

app.get("/v1/bookings/:id", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });
  if (booking.userId !== req.user!.sub && !req.user!.roles.includes("admin")) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That booking is not yours", retryable: false } });
  }
  const events = await db.select().from(S.bookingEvents)
    .where(eq(S.bookingEvents.bookingId, id)).orderBy(S.bookingEvents.createdAt);
  return ok({ ...booking, events }, { nextCommands: allowedFrom(booking.status as Status) });
});

app.get("/v1/bookings", { preHandler: authenticate }, async (req) => {
  const { limit = 20 } = z.object({ limit: z.coerce.number().min(1).max(100).optional() }).parse(req.query);
  const rows = await db.select().from(S.bookings)
    .where(and(eq(S.bookings.userId, req.user!.sub), isNull(S.bookings.deletedAt)))
    .orderBy(desc(S.bookings.createdAt)).limit(limit);
  return ok(rows, { count: rows.length });
});

// ══ offline sync ═══════════════════════════════════════════════════════════
app.post("/v1/sync/operations", { preHandler: authenticate }, async (req) => {
  const { operations } = z.object({
    operations: z.array(z.object({
      opId: z.string().min(8).max(64),
      entity: z.string().max(40),
      operation: z.enum(["create", "update", "delete"]),
      payload: z.record(z.unknown()),
      clientUpdatedAt: z.coerce.date(),
    })).max(200),
  }).parse(req.body);

  const results: Array<{ opId: string; status: string; reason?: string }> = [];
  for (const op of operations) {
    // op_id is unique, so a replay is a no-op rather than a duplicate booking.
    const inserted = await db.insert(S.syncOperations).values({
      userId: req.user!.sub, opId: op.opId, entity: op.entity,
      operation: op.operation, payload: op.payload, clientUpdatedAt: op.clientUpdatedAt,
      appliedAt: new Date(),
    }).onConflictDoNothing().returning({ id: S.syncOperations.id });

    results.push(inserted.length
      ? { opId: op.opId, status: "applied" }
      : { opId: op.opId, status: "duplicate", reason: "already applied — replay is safe" });
  }
  return ok({ results }, { applied: results.filter((r) => r.status === "applied").length });
});

// ══ emergency contacts ═════════════════════════════════════════════════════
app.get("/v1/me/emergency-contacts", { preHandler: authenticate }, async (req) => {
  const rows = await db.select().from(S.emergencyContacts)
    .where(and(eq(S.emergencyContacts.userId, req.user!.sub), isNull(S.emergencyContacts.deletedAt)))
    .orderBy(S.emergencyContacts.priority);
  return ok(rows);
});

app.post("/v1/me/emergency-contacts", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    name: z.string().min(1).max(120),
    msisdn: msisdnSchema,
    relation: z.string().max(40).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  }).parse(req.body);

  const [row] = await db.insert(S.emergencyContacts).values({
    userId: req.user!.sub, name: body.name, msisdn: body.msisdn,
    relation: body.relation, priority: body.priority ?? 1,
  }).returning();
  return reply.code(201).send(ok(row));
});

app.delete("/v1/me/emergency-contacts/:id", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  // Soft delete, scoped to the owner — a contact id alone is not authority.
  const rows = await db.update(S.emergencyContacts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(S.emergencyContacts.id, id), eq(S.emergencyContacts.userId, req.user!.sub)))
    .returning({ id: S.emergencyContacts.id });
  if (!rows.length) {
    return reply.code(404).send({ error: { code: "not_found", title: "Contact not found", retryable: false } });
  }
  return ok({ id, removed: true });
});

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
const SMS_HELP = [
  "RoadAssist commands:",
  "HELP CAR / BIKE / AUTO / TRUCK — request assistance",
  "STATUS — your current request",
  "CANCEL — cancel it",
  "SOS — emergency",
  "STOP — opt out",
].join("\n");

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

  const { from, text } = z.object({
    from: msisdnSchema,
    text: z.string().max(160),
  }).parse(req.body);

  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const verb = words[0] ?? "";
  const reply = async (body: string) => {
    await sms.send(from, body);
    return ok({ reply: body }, { channel: "sms", to: from });
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

  if (["stop", "unsubscribe"].includes(verb)) {
    return reply("You will receive no further messages from RoadAssist. Send START to opt back in.");
  }

  if (["sos", "emergency", "112"].includes(verb)) {
    const [incident] = await db.insert(S.incidents).values({
      userId: user.id, status: "CONFIRMED", severity: "CRITICAL",
      detectedByModel: false, confirmedBy: "sms", confirmedAt: new Date(),
      degradedPath: true,   // this path works with the app platform down
    }).returning();
    await db.insert(S.incidentSignals).values({ incidentId: incident.id, kind: "sms", payload: { text } });
    await db.insert(S.incidentResponses).values({ incidentId: incident.id, step: "contacts", latencyMs: 0 });
    return reply("SOS received. Help is being arranged. Reply with a landmark or highway marker if you can.");
  }

  if (["status", "s"].includes(verb)) {
    const b = await activeBooking();
    if (!b) return reply("You have no active request. Send HELP CAR (or BIKE, AUTO, TRUCK) to start one.");
    const [mech] = b.mechanicId
      ? await db.select().from(S.mechanics).where(eq(S.mechanics.id, b.mechanicId)).limit(1)
      : [];
    return reply(mech
      ? `${b.reference}: ${b.status}. ${mech.displayName} is assigned. Reply CANCEL to cancel.`
      : `${b.reference}: ${b.status}. We are still finding a mechanic. Reply CANCEL to cancel.`);
  }

  if (["cancel", "c"].includes(verb)) {
    const b = await activeBooking();
    if (!b) return reply("You have no active request to cancel.");
    try {
      const { to, cancellationFee } = apply(b.status as Status, "cancel");
      await db.update(S.bookings)
        .set({ status: to, cancelledAt: new Date(), cancelReason: "sms_cancel", updatedAt: new Date() })
        .where(eq(S.bookings.id, b.id));
      await db.insert(S.bookingEvents).values({
        bookingId: b.id, fromStatus: b.status, toStatus: to,
        command: "cancel", actorId: user.id, actorRole: "citizen",
      });
      return reply(`${b.reference} cancelled.${cancellationFee ? " A cancellation fee applies as a mechanic was already on the way." : ""}`);
    } catch {
      return reply(`${b.reference} is ${b.status} and can no longer be cancelled by SMS. Call us for help.`);
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
        return reply("Which vehicle? Reply HELP CAR, HELP BIKE, HELP AUTO, HELP TRUCK or HELP TRACTOR.");
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
    if (open) return reply(`You already have request ${open.reference} (${open.status}). Reply STATUS or CANCEL.`);

    const [svc] = await db.select().from(S.serviceTypes)
      .where(eq(S.serviceTypes.code, "minor_repair")).limit(1);
    const [b] = await db.insert(S.bookings).values({
      reference: reference(), userId: user.id, vehicleId,
      serviceTypeId: svc?.id, status: "REQUESTED", requestedAt: new Date(),
      symptoms: text, quotedPaise: svc?.baseFarePaise, createdOffline: false,
    }).returning();
    await db.insert(S.bookingEvents).values({
      bookingId: b.id, fromStatus: "DRAFT", toStatus: "REQUESTED",
      command: "submit", actorId: user.id, actorRole: "citizen",
      meta: { channel: "sms" },
    });
    return reply(`Request ${b.reference} received. We are finding a mechanic near you. Reply STATUS for an update or CANCEL to stop.`);
  }

  return reply(SMS_HELP);
});

// ══ emergency (ADR-0005) ═══════════════════════════════════════════════════
/**
 * A crash signal raises an incident; it never dispatches one. The incident sits
 * in AWAITING_CONFIRMATION for the cancel window, and only a recorded human (or
 * corroborating second signal) moves it to CONFIRMED.
 */
app.post("/v1/sos", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    vehicleId: z.string().uuid().optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    source: z.enum(["manual", "crash_model", "sms"]).default("manual"),
    modelConfidence: z.number().min(0).max(1).optional(),
    degradedPath: z.boolean().optional(),
  }).parse(req.body);

  const byModel = body.source === "crash_model";
  const [incident] = await db.insert(S.incidents).values({
    userId: req.user!.sub, vehicleId: body.vehicleId,
    // Manual SOS is already a human act; a model signal must wait for confirmation.
    status: byModel ? "AWAITING_CONFIRMATION" : "CONFIRMED",
    severity: byModel && (body.modelConfidence ?? 0) > 0.9 ? "CRITICAL" : "HIGH",
    detectedByModel: byModel,
    modelConfidence: body.modelConfidence,
    confirmedBy: byModel ? null : "user",
    confirmedAt: byModel ? null : new Date(),
    degradedPath: body.degradedPath ?? false,
  }).returning();

  await db.execute(raw`
    UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
    WHERE id = ${incident.id}`);
  await db.insert(S.incidentSignals).values({
    incidentId: incident.id, kind: body.source,
    payload: { lat: body.lat, lng: body.lng, confidence: body.modelConfidence },
  });

  return reply.code(201).send(ok({
    id: incident.id, status: incident.status,
    cancelWindowSeconds: byModel ? 30 : 0,
    requiresConfirmation: byModel,
  }, {
    note: byModel
      ? "Detected on device. Nothing has been dispatched — confirm or cancel within 30 seconds."
      : "Escalating now.",
  }));
});

app.post("/v1/sos/:id/cancel", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [inc] = await db.select().from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
  if (!inc) return reply.code(404).send({ error: { code: "not_found", title: "Incident not found", retryable: false } });
  if (inc.userId !== req.user!.sub) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That incident is not yours", retryable: false } });
  }
  await db.update(S.incidents)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(S.incidents.id, id));
  return ok({ id, status: "CANCELLED" }, { note: "False alarm recorded — this feeds the false-positive dataset." });
});

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
  const contacts = await db.select().from(S.emergencyContacts)
    .where(and(eq(S.emergencyContacts.userId, inc.userId!), isNull(S.emergencyContacts.deletedAt)));

  for (const c of contacts) {
    await sms.send(c.msisdn, `EMERGENCY: your contact may have been in a crash. Live location: https://roadassist.in/i/${id}`);
  }
  await db.insert(S.incidentResponses).values({
    incidentId: id, step: "contacts", latencyMs: Date.now() - t0, acknowledged: false,
  });

  const responders = await db.execute<{ id: string; name: string; km: number }>(raw`
    SELECT r.id, r.name, ST_Distance(r.last_location::geography, i.location::geography)/1000 AS km
      FROM responder_units r, incidents i
     WHERE i.id = ${id} AND r.active AND r.deleted_at IS NULL
       AND r.last_location IS NOT NULL
     ORDER BY r.last_location <-> i.location LIMIT 1`);

  await db.insert(S.incidentResponses).values({
    incidentId: id, responderId: responders[0]?.id ?? null,
    step: "responder", latencyMs: Date.now() - t0, acknowledged: false,
  });

  await db.update(S.incidents).set({
    status: "RESPONDING",
    confirmedBy: inc.confirmedBy ?? "user",
    confirmedAt: inc.confirmedAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(S.incidents.id, id));

  return ok({
    id, status: "RESPONDING",
    contactsAlerted: contacts.length,
    nearestResponder: responders[0] ?? null,
    elapsedMs: Date.now() - t0,
  }, { note: "ERSS 112 handoff is stubbed in development — no real emergency service is contacted." });
});

// ══ mechanic view ══════════════════════════════════════════════════════════
app.get("/v1/mechanic/offers", { preHandler: [authenticate, requireRole("mechanic", "admin")] }, async (req) => {
  const [mech] = await db.select().from(S.mechanics).where(eq(S.mechanics.userId, req.user!.sub)).limit(1);
  if (!mech) return ok([], { note: "This account is not registered as a mechanic" });
  const rows = await db.select().from(S.dispatchOffers)
    .where(and(eq(S.dispatchOffers.mechanicId, mech.id), eq(S.dispatchOffers.status, "SENT")))
    .orderBy(desc(S.dispatchOffers.createdAt)).limit(20);
  return ok(rows);
});

// ══ RAKSHA — autonomous road monitoring (ADR-0007) ═════════════════════════
await app.register(rakshaRoutes);

// ══ boot ═══════════════════════════════════════════════════════════════════
const close = async () => { await app.close(); await sql.end({ timeout: 5 }); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ port: env.port, host: env.host });
app.log.info({ providers: providerSummary() }, "RoadAssist API ready");
