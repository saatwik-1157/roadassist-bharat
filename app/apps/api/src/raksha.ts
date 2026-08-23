/**
 * RAKSHA routes — autonomous road-monitoring ingestion and dashboards.
 *
 * ADR-0007: RAKSHA is a module of the monolith, not a second system.
 * ADR-0008: devices are authenticated principals; anonymous upload is impossible.
 * ADR-0005: a detection can raise an incident *signal* awaiting human
 *           confirmation — it can never dispatch anything.
 * ADR-0006: inference metadata (model version, confidence, fallback) travels
 *           with every detection and is journaled to model_predictions by hash.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, sql as raw } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { env } from "./env.js";
import { db } from "./db.js";
import * as S from "@roadassist/db";
import { authenticate, constantTimeEquals, issueAccessToken, requireRole, sha256 } from "./auth.js";

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ data, meta });

const latLng = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

/** Severity → penalty weights for the Road Health Score. Rule-based v1 —
 *  configurable engineering weights, NOT an official safety standard. */
const HEALTH = {
  windowDays: 30,
  potholePerSeverity: 3,   caps: { pothole: 45, damage: 25, obstruction: 20 },
  damagePerSeverity: 2,
  obstructionEach: 10,
  levels: [[80, "good"], [60, "fair"], [35, "poor"], [0, "critical"]] as const,
};

export async function rakshaRoutes(app: FastifyInstance) {
  // ── public aggregate stats — counts only, no locations, no identifiers ───
  // Powers the live showcase page. Nothing here can re-identify a device,
  // detection site, or person (the k-anonymity concern applies to detail
  // reads, which stay authority-gated).
  app.get("/v1/raksha/stats", async () => {
    const [row] = await db.execute<{
      detections: number; open: number; verified: number;
      devices: number; segments: number; avg_health: number | null;
    }>(raw`
      SELECT (SELECT count(*)::int FROM raksha_detections WHERE deleted_at IS NULL) AS detections,
             (SELECT count(*)::int FROM raksha_detections WHERE deleted_at IS NULL
               AND status IN ('DETECTED', 'VERIFIED')) AS open,
             (SELECT count(*)::int FROM raksha_detections WHERE deleted_at IS NULL
               AND status = 'VERIFIED') AS verified,
             (SELECT count(*)::int FROM edge_devices WHERE deleted_at IS NULL) AS devices,
             (SELECT count(*)::int FROM road_segments WHERE deleted_at IS NULL) AS segments,
             (SELECT round(avg(score))::int FROM (
                SELECT DISTINCT ON (segment_id) score FROM road_health_scores
                ORDER BY segment_id, computed_at DESC) latest) AS avg_health`);
    return ok(row, { note: "aggregate counts only — demo build, device data SIMULATED" });
  });

  // ── device registration (human act: admin or gov officer) ────────────────
  app.post("/v1/raksha/devices", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(3).max(120),
      ...latLng,
      hardwareRef: z.string().max(80).optional(),
      zoneId: z.string().uuid().optional(),
      simulated: z.boolean().optional(),
    }).parse(req.body);

    // 32-byte secret, shown exactly once; only its hash is stored (ADR-0008).
    const secret = randomBytes(32).toString("base64url");

    const [device] = await db.insert(S.edgeDevices).values({
      name: body.name,
      hardwareRef: body.hardwareRef ?? "SIMULATED",
      credentialHash: sha256(secret),
      zoneId: body.zoneId,
      registeredBy: req.user!.sub,
      simulated: body.simulated ?? true,
    }).returning();
    await db.execute(raw`
      UPDATE edge_devices SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
      WHERE id = ${device.id}`);

    return reply.code(201).send(ok(
      { id: device.id, name: device.name, status: device.status, simulated: device.simulated, deviceSecret: secret },
      { note: "Store deviceSecret now — it is shown once and only its hash is kept." },
    ));
  });

  // Fleet locations and detection streams are operational intelligence:
  // authority-only, so a citizen or a device credential cannot enumerate them.
  app.get("/v1/raksha/devices", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async () => {
    const rows = await db.execute<{
      id: string; name: string; hardware_ref: string; status: string; simulated: boolean;
      battery_percent: number | null; storage_percent: number | null;
      last_seen_at: string | null; lat: number | null; lng: number | null;
    }>(raw`
      SELECT id, name, hardware_ref, status, simulated, battery_percent, storage_percent,
             last_seen_at, ST_Y(location) AS lat, ST_X(location) AS lng
        FROM edge_devices WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`);
    return ok(rows);
  });

  // ── device token exchange ─────────────────────────────────────────────────
  app.post("/v1/raksha/devices/token", async (req, reply) => {
    const { deviceId, deviceSecret } = z.object({
      deviceId: z.string().uuid(),
      deviceSecret: z.string().min(20),
    }).parse(req.body);

    const [device] = await db.select().from(S.edgeDevices)
      .where(and(eq(S.edgeDevices.id, deviceId), isNull(S.edgeDevices.deletedAt))).limit(1);

    if (!device || !constantTimeEquals(sha256(deviceSecret), device.credentialHash)) {
      return reply.code(401).send({
        error: { code: "device_auth_failed", title: "Unknown device or wrong credential", retryable: false },
      });
    }
    if (device.status === "RETIRED") {
      return reply.code(403).send({
        error: { code: "device_retired", title: "This device has been retired", retryable: false },
      });
    }

    await db.update(S.edgeDevices)
      .set({ lastSeenAt: new Date(), status: "ACTIVE", updatedAt: new Date() })
      .where(eq(S.edgeDevices.id, device.id));

    return ok({
      accessToken: await issueAccessToken({ sub: device.id, roles: ["device"], sid: "" }),
      tokenType: "Bearer",
      expiresIn: env.accessTtlSeconds,
    });
  });

  // ── heartbeat ─────────────────────────────────────────────────────────────
  app.post("/v1/raksha/devices/heartbeat", { preHandler: [authenticate, requireRole("device")] }, async (req, reply) => {
    const body = z.object({
      batteryPercent: z.number().int().min(0).max(100).optional(),
      storagePercent: z.number().int().min(0).max(100).optional(),
      temperatureC: z.number().min(-40).max(90).optional(),
      uptimeSeconds: z.number().int().min(0).optional(),
      queueDepth: z.number().int().min(0).optional(),
      lat: latLng.lat.optional(),
      lng: latLng.lng.optional(),
    }).parse(req.body ?? {});

    const deviceId = req.user!.sub;
    const degraded = body.batteryPercent !== undefined && body.batteryPercent < 15;

    // Guarded: a retired or soft-deleted device must not resurrect itself
    // through a heartbeat while its last access token is still live.
    const updated = await db.update(S.edgeDevices).set({
      lastSeenAt: new Date(), updatedAt: new Date(),
      batteryPercent: body.batteryPercent, storagePercent: body.storagePercent,
      status: degraded ? "DEGRADED" : "ACTIVE",
    }).where(and(
      eq(S.edgeDevices.id, deviceId),
      isNull(S.edgeDevices.deletedAt),
      raw`${S.edgeDevices.status} <> 'RETIRED'`,
    )).returning({ id: S.edgeDevices.id });
    if (!updated.length) {
      return reply.code(403).send({
        error: { code: "device_retired", title: "This device is no longer accepted", retryable: false },
      });
    }

    await db.insert(S.edgeDeviceTelemetry).values({
      deviceId, recordedAt: new Date(),
      batteryPercent: body.batteryPercent, storagePercent: body.storagePercent,
      temperatureC: body.temperatureC, uptimeSeconds: body.uptimeSeconds,
      queueDepth: body.queueDepth,
    });

    if (body.lat !== undefined && body.lng !== undefined) {
      await db.execute(raw`
        UPDATE edge_devices SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
        WHERE id = ${deviceId}`);
    }
    return ok({ status: degraded ? "DEGRADED" : "ACTIVE" });
  });

  // ── detection ingestion (batched, idempotent on device op_id) ────────────
  app.post("/v1/raksha/detections", { preHandler: [authenticate, requireRole("device")] }, async (req, reply) => {
    const { detections } = z.object({
      detections: z.array(z.object({
        opId: z.string().min(8).max(64),
        type: z.enum(["pothole", "road_damage", "obstruction"]),
        confidence: z.number().min(0).max(1),
        severity: z.number().int().min(1).max(5),
        ...latLng,
        capturedAt: z.coerce.date(),
        ranOffline: z.boolean().optional(),
        imageRef: z.string().max(200).optional(),
        modelVersion: z.string().max(40),
        usedFallback: z.boolean().optional(),
      })).min(1).max(200),
    }).parse(req.body);

    const deviceId = req.user!.sub;

    // A retired or deleted device keeps a signed token for the access TTL —
    // the resource must refuse it, not just the token exchange (ADR-0008).
    const [device] = await db.select({ id: S.edgeDevices.id, status: S.edgeDevices.status })
      .from(S.edgeDevices)
      .where(and(eq(S.edgeDevices.id, deviceId), isNull(S.edgeDevices.deletedAt))).limit(1);
    if (!device || device.status === "RETIRED") {
      return reply.code(403).send({
        error: { code: "device_retired", title: "This device is no longer accepted", retryable: false },
      });
    }

    const results: Array<{ opId: string; status: string; detectionId?: string; incidentId?: string; incidentCorroborated?: boolean }> = [];
    // Backstop against incident-queue flooding: one batch may open at most
    // this many NEW incidents; repeats corroborate an existing one instead.
    // Per-device rate limiting proper is a Phase 17 control (threat model #4).
    let newIncidentBudget = 5;

    for (const d of detections) {
      // Everything for one item commits together, or not at all — the
      // idempotency marker must never exist without the rest (ADR-0004).
      const outcome = await db.transaction(async (tx) => {
        const inserted = await tx.insert(S.rakshaDetections).values({
          deviceId, opId: d.opId, detectionType: d.type,
          confidence: d.confidence, severity: d.severity,
          capturedAt: d.capturedAt, ranOffline: d.ranOffline ?? false,
          imageRef: d.imageRef, modelVersion: d.modelVersion,
          usedFallback: d.usedFallback ?? false,
        }).onConflictDoNothing({ target: [S.rakshaDetections.deviceId, S.rakshaDetections.opId] })
          .returning({ id: S.rakshaDetections.id });

        if (!inserted.length) return { opId: d.opId, status: "duplicate" as const };
        const detectionId = inserted[0].id;

        // Attach location, then the nearest monitored segment within 250 m.
        await tx.execute(raw`
          UPDATE raksha_detections
             SET location = ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)
           WHERE id = ${detectionId}`);
        await tx.execute(raw`
          UPDATE raksha_detections rd
             SET segment_id = seg.id
            FROM (SELECT id FROM road_segments
                   WHERE deleted_at IS NULL
                     AND ST_DWithin(path::geography,
                                    ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)::geography, 250)
                   ORDER BY path <-> ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)
                   LIMIT 1) seg
           WHERE rd.id = ${detectionId}`);

        // ADR-0006 audit: hash of the event, never the frame.
        await tx.insert(S.modelPredictions).values({
          capability: "road_damage_detect", modelVersion: d.modelVersion,
          inputHash: sha256(JSON.stringify(d)), confidence: d.confidence,
          usedFallback: d.usedFallback ?? false, subjectId: deviceId,
        });

        // ADR-0005: a severe obstruction raises a SIGNAL — a human must confirm.
        let incidentId: string | undefined;
        let incidentCorroborated: boolean | undefined;
        if (d.type === "obstruction" && d.severity >= 4 && d.confidence >= 0.75) {
          // The same hazard seen again (same device, within 200 m, last hour,
          // still open) corroborates the existing incident — it never opens a
          // second one, so a stuck camera cannot bury the confirmation queue.
          const open = await tx.execute<{ id: string }>(raw`
            SELECT i.id FROM incidents i
              JOIN incident_signals s ON s.incident_id = i.id
             WHERE s.kind = 'raksha_detection'
               AND s.payload->>'deviceId' = ${deviceId}
               AND i.status IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'RESPONDING')
               AND i.deleted_at IS NULL AND i.location IS NOT NULL
               AND ST_DWithin(i.location::geography,
                              ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)::geography, 200)
               AND i.created_at > now() - interval '60 minutes'
             LIMIT 1`);

          if (open.length) {
            incidentId = open[0].id;
            incidentCorroborated = true;
          } else if (newIncidentBudget > 0) {
            newIncidentBudget--;
            const [incident] = await tx.insert(S.incidents).values({
              status: "AWAITING_CONFIRMATION", severity: d.severity >= 5 ? "CRITICAL" : "HIGH",
              detectedByModel: true, modelConfidence: d.confidence,
            }).returning({ id: S.incidents.id });
            await tx.execute(raw`
              UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)
              WHERE id = ${incident.id}`);
            incidentId = incident.id;
          }
          if (incidentId) {
            await tx.insert(S.incidentSignals).values({
              incidentId, kind: "raksha_detection",
              payload: { detectionId, opId: d.opId, deviceId, type: d.type, severity: d.severity },
            });
          }
        }

        return { opId: d.opId, status: "applied" as const, detectionId, incidentId, incidentCorroborated };
      });
      results.push(outcome);
    }

    await db.update(S.edgeDevices)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(S.edgeDevices.id, deviceId));

    return ok({ results }, {
      applied: results.filter((r) => r.status === "applied").length,
      duplicates: results.filter((r) => r.status === "duplicate").length,
    });
  });

  // ── reads for the dashboard ───────────────────────────────────────────────
  app.get("/v1/raksha/detections", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req) => {
    const q = z.object({
      status: z.enum(["DETECTED", "VERIFIED", "REJECTED", "REPAIR_SCHEDULED", "REPAIRED", "CLOSED"]).optional(),
      type: z.enum(["pothole", "road_damage", "obstruction"]).optional(),
      limit: z.coerce.number().min(1).max(200).optional(),
    }).parse(req.query);

    const rows = await db.execute<Record<string, unknown>>(raw`
      SELECT rd.id, rd.op_id, rd.detection_type, rd.confidence, rd.severity, rd.status,
             rd.captured_at, rd.created_at, rd.ran_offline, rd.model_version, rd.used_fallback,
             rd.image_ref, rd.notes,
             ST_Y(rd.location) AS lat, ST_X(rd.location) AS lng,
             ed.name AS device_name, ed.simulated,
             rs.code AS segment_code, rs.name AS segment_name
        FROM raksha_detections rd
        JOIN edge_devices ed ON ed.id = rd.device_id
        LEFT JOIN road_segments rs ON rs.id = rd.segment_id
       WHERE rd.deleted_at IS NULL
         AND (${q.status ?? null}::raksha_detection_status IS NULL OR rd.status = ${q.status ?? null})
         AND (${q.type ?? null}::raksha_detection_type IS NULL OR rd.detection_type = ${q.type ?? null})
       ORDER BY rd.created_at DESC
       LIMIT ${q.limit ?? 50}`);
    return ok(rows, { count: rows.length });
  });

  app.get("/v1/raksha/segments", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async () => {
    const rows = await db.execute<Record<string, unknown>>(raw`
      SELECT rs.id, rs.code, rs.name, rs.highway_ref, rs.km_start, rs.km_end, rs.length_km,
             ST_AsGeoJSON(rs.path)::json AS geometry,
             h.score, h.level, h.factors, h.computed_at,
             (SELECT count(*)::int FROM raksha_detections rd
               WHERE rd.segment_id = rs.id AND rd.deleted_at IS NULL
                 AND rd.status NOT IN ('REJECTED','CLOSED','REPAIRED')) AS open_detections
        FROM road_segments rs
        LEFT JOIN LATERAL (
          SELECT score, level, factors, computed_at FROM road_health_scores
           WHERE segment_id = rs.id ORDER BY computed_at DESC LIMIT 1) h ON true
       WHERE rs.deleted_at IS NULL
       ORDER BY rs.code`);
    return ok(rows);
  });

  // ── Road Health Score (Phase 8 — transparent, rule-based v1) ─────────────
  app.post("/v1/raksha/road-health/recompute", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async () => {
    const segments = await db.select({ id: S.roadSegments.id, code: S.roadSegments.code })
      .from(S.roadSegments).where(isNull(S.roadSegments.deletedAt));

    const scores = [];
    for (const seg of segments) {
      const [agg] = await db.execute<{
        pothole_sev: number; damage_sev: number; obstructions: number;
        potholes: number; damages: number;
      }>(raw`
        SELECT coalesce(sum(severity) FILTER (WHERE detection_type = 'pothole'), 0)::int AS pothole_sev,
               coalesce(sum(severity) FILTER (WHERE detection_type = 'road_damage'), 0)::int AS damage_sev,
               count(*) FILTER (WHERE detection_type = 'obstruction')::int AS obstructions,
               count(*) FILTER (WHERE detection_type = 'pothole')::int AS potholes,
               count(*) FILTER (WHERE detection_type = 'road_damage')::int AS damages
          FROM raksha_detections
         WHERE segment_id = ${seg.id} AND deleted_at IS NULL
           AND status NOT IN ('REJECTED', 'CLOSED', 'REPAIRED')
           AND created_at > now() - make_interval(days => ${HEALTH.windowDays})`);

      const potholePenalty = Math.min(HEALTH.caps.pothole, agg.pothole_sev * HEALTH.potholePerSeverity);
      const damagePenalty = Math.min(HEALTH.caps.damage, agg.damage_sev * HEALTH.damagePerSeverity);
      const obstructionPenalty = Math.min(HEALTH.caps.obstruction, agg.obstructions * HEALTH.obstructionEach);
      const score = Math.max(0, 100 - potholePenalty - damagePenalty - obstructionPenalty);
      const level = HEALTH.levels.find(([floor]) => score >= floor)![1];

      const factors = {
        potholes: agg.potholes, potholeSeveritySum: agg.pothole_sev, potholePenalty,
        roadDamage: agg.damages, damageSeveritySum: agg.damage_sev, damagePenalty,
        obstructions: agg.obstructions, obstructionPenalty,
        windowDays: HEALTH.windowDays,
        note: "Rule-based weights v1 — configurable engineering heuristic, not an official safety standard.",
      };
      await db.insert(S.roadHealthScores).values({
        segmentId: seg.id, score, level, factors, windowDays: HEALTH.windowDays,
      });
      scores.push({ segmentId: seg.id, code: seg.code, score, level, factors });
    }
    return ok(scores, { recomputed: scores.length, windowDays: HEALTH.windowDays });
  });

  // ── authority workflow ────────────────────────────────────────────────────
  app.post("/v1/raksha/detections/:id/verify", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { action, notes } = z.object({
      action: z.enum(["verify", "reject"]),
      notes: z.string().max(500).optional(),
    }).parse(req.body);

    const [current] = await db.select({ status: S.rakshaDetections.status }).from(S.rakshaDetections)
      .where(and(eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt))).limit(1);
    if (!current) {
      return reply.code(404).send({ error: { code: "not_found", title: "Detection not found", retryable: false } });
    }
    // Verification is a one-way gate: only a fresh detection can be judged,
    // and prior verification evidence is never silently overwritten.
    const rows = await db.update(S.rakshaDetections).set({
      status: action === "verify" ? "VERIFIED" : "REJECTED",
      verifiedBy: req.user!.sub, verifiedAt: new Date(), notes, updatedAt: new Date(),
    }).where(and(
      eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt),
      eq(S.rakshaDetections.status, "DETECTED"),
    )).returning({ id: S.rakshaDetections.id, status: S.rakshaDetections.status });
    if (!rows.length) {
      return reply.code(409).send({
        error: { code: "already_reviewed", title: `This detection is already ${current.status} and cannot be re-judged`, retryable: false },
      });
    }
    return ok(rows[0]);
  });

  app.post("/v1/raksha/detections/:id/close", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [current] = await db.select({ status: S.rakshaDetections.status }).from(S.rakshaDetections)
      .where(and(eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt))).limit(1);
    if (!current) {
      return reply.code(404).send({ error: { code: "not_found", title: "Detection not found", retryable: false } });
    }
    // Closing means a verified/repaired problem was confirmed fixed — a raw
    // or rejected detection has nothing to close.
    const rows = await db.update(S.rakshaDetections)
      .set({ status: "CLOSED", updatedAt: new Date() })
      .where(and(
        eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt),
        raw`${S.rakshaDetections.status} IN ('VERIFIED', 'REPAIRED')`,
      ))
      .returning({ id: S.rakshaDetections.id, status: S.rakshaDetections.status });
    if (!rows.length) {
      return reply.code(409).send({
        error: { code: "not_closable", title: `Only a VERIFIED or REPAIRED detection can be closed (this one is ${current.status})`, retryable: false },
      });
    }
    return ok(rows[0]);
  });
}
