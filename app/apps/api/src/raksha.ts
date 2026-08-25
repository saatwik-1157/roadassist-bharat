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
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { env } from "./env.js";
import { db } from "./db.js";
import * as S from "@roadassist/db";
import { authenticate, constantTimeEquals, issueAccessToken, requireRole, sha256 } from "./auth.js";

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ data, meta });

const latLng = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
};

// Hazard-report photos live on disk (ADR-0006: never in the DB). The detection
// row keeps only the key, e.g. "hazards/<id>.jpg".
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function savePhoto(detectionId: string, buf: Buffer, mime: string): string {
  const ext = PHOTO_EXT[mime] ?? "bin";
  const dir = join(env.uploadDir, "hazards");
  mkdirSync(dir, { recursive: true });
  const key = `hazards/${detectionId}.${ext}`;
  writeFileSync(join(env.uploadDir, key), buf);
  return key;
}

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

  // ── Trip Guardian: prepare a route BEFORE signal disappears ──────────────
  // Honest architecture: prediction happens while the client still has
  // connectivity — coverage risk is a HEURISTIC learned from this platform's
  // own devices (the share of detections each segment's hardware captured
  // while offline), never carrier coverage data; weather is a live forecast
  // (Open-Meteo) fetched now and cached on-device; tiles are listed for the
  // client to pre-download. Nothing here claims to forecast without data.
  app.get("/v1/trip/prepare", { preHandler: authenticate }, async () => {
    const segments = await db.execute<{
      code: string; name: string; km_start: number | null; km_end: number | null;
      mid_lat: number | null; mid_lng: number | null;
      total: number; offline: number; health: number | null;
      pts: string | null;
    }>(raw`
      SELECT rs.code, rs.name, rs.km_start, rs.km_end,
             ST_Y(ST_LineInterpolatePoint(rs.path, 0.5)) AS mid_lat,
             ST_X(ST_LineInterpolatePoint(rs.path, 0.5)) AS mid_lng,
             (SELECT count(*)::int FROM raksha_detections d
               WHERE d.segment_id = rs.id AND d.deleted_at IS NULL) AS total,
             (SELECT count(*)::int FROM raksha_detections d
               WHERE d.segment_id = rs.id AND d.deleted_at IS NULL AND d.ran_offline) AS offline,
             (SELECT score FROM road_health_scores h WHERE h.segment_id = rs.id
               ORDER BY h.computed_at DESC LIMIT 1) AS health,
             ST_AsGeoJSON(rs.path) AS pts
        FROM road_segments rs
       WHERE rs.deleted_at IS NULL AND rs.path IS NOT NULL
       ORDER BY rs.km_start NULLS LAST`);

    const notes: string[] = [
      "coverageRisk is heuristic v1 — the share of this platform's own detections captured offline per segment; NOT carrier coverage data",
      "weather is a live Open-Meteo forecast fetched now for on-device caching; null when the forecast service is unreachable",
      "tiles © OpenStreetMap contributors — cache them on-device before departure",
    ];

    const segOut = segments.map((s) => {
      const ratio = s.total > 0 ? s.offline / s.total : null;
      const coverageRisk =
        ratio === null ? "UNKNOWN" : ratio >= 0.6 ? "HIGH" : ratio >= 0.3 ? "MEDIUM" : "LOW";
      return {
        code: s.code, name: s.name, kmStart: s.km_start, kmEnd: s.km_end,
        mid: s.mid_lat != null && s.mid_lng != null ? { lat: s.mid_lat, lng: s.mid_lng } : null,
        coverageRisk, offlineRatio: ratio != null ? Number(ratio.toFixed(2)) : null,
        samples: s.total, healthScore: s.health,
      };
    });

    // Route weather: forecast at the corridor's two ends, 6-hour horizon.
    // Degrades to null (never fails the endpoint) so offline prep still works.
    async function forecast(lat: number, lng: number) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&hourly=precipitation_probability,precipitation,visibility,wind_speed_10m` +
          `&forecast_hours=6&timezone=auto`,
          { signal: ctrl.signal },
        ).finally(() => clearTimeout(timer));
        if (!res.ok) return null;
        const j = (await res.json()) as {
          hourly: { time: string[]; precipitation_probability: number[];
            precipitation: number[]; visibility: number[]; wind_speed_10m: number[] };
        };
        const h = j.hourly;
        return {
          hours: h.time.length,
          maxRainProbability: Math.max(...h.precipitation_probability),
          totalPrecipitationMm: Number(h.precipitation.reduce((a, b) => a + b, 0).toFixed(1)),
          minVisibilityM: Math.min(...h.visibility),
          maxWindKmh: Math.max(...h.wind_speed_10m),
        };
      } catch { return null; }
    }

    const withMid = segOut.filter((s) => s.mid);
    const first = withMid[0]?.mid, last = withMid[withMid.length - 1]?.mid;
    const [wStart, wEnd] = await Promise.all([
      first ? forecast(first.lat, first.lng) : null,
      last ? forecast(last.lat, last.lng) : null,
    ]);
    const worst = [wStart, wEnd].filter(Boolean) as NonNullable<typeof wStart>[];
    const factors: string[] = [];
    let weatherRisk: string | null = null;
    if (worst.length) {
      const rain = Math.max(...worst.map((w) => w.maxRainProbability));
      const vis = Math.min(...worst.map((w) => w.minVisibilityM));
      const wind = Math.max(...worst.map((w) => w.maxWindKmh));
      if (rain >= 60) factors.push(`heavy rain likely (${rain}% peak probability)`);
      else if (rain >= 30) factors.push(`rain possible (${rain}% peak probability)`);
      if (vis < 2000) factors.push(`low visibility ahead (${vis} m minimum)`);
      if (wind >= 40) factors.push(`strong wind (${wind} km/h peak)`);
      weatherRisk = factors.length >= 2 ? "HIGH" : factors.length === 1 ? "MEDIUM" : "LOW";
      if (!factors.length) factors.push("no significant weather flags in the next 6 hours");
    }

    // Offline map manifest: z13 slippy tiles along every segment point, deduped.
    const Z = 13;
    const tiles = new Set<string>();
    for (const s of segments) {
      if (!s.pts) continue;
      const coords = (JSON.parse(s.pts) as { coordinates: [number, number][] }).coordinates;
      for (const [lng, lat] of coords) {
        const x = Math.floor(((lng + 180) / 360) * 2 ** Z);
        const latR = (lat * Math.PI) / 180;
        const y = Math.floor(
          ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * 2 ** Z,
        );
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
          // relative: served by this API's same-origin tile proxy, so the
          // client's Cache API copy is fully readable offline
          tiles.add(`/tiles/${Z}/${x + dx}/${y + dy}.png`);
        }
      }
    }

    return ok({
      preparedAt: new Date().toISOString(),
      segments: segOut,
      weather: worst.length
        ? { risk: weatherRisk, factors, start: wStart, end: wEnd, horizonHours: 6 }
        : null,
      tiles: [...tiles].slice(0, 120),
    }, { notes });
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

  // ── citizen-reported hazard (crowdsourced) ────────────────────────────────
  // Any signed-in user can flag a road hazard they hit. It enters the SAME
  // pipeline as an edge-device sighting — snapped to the nearest monitored
  // segment, shown on the live map, queued for authority verification — but is
  // attributed to a singleton "Citizen Reports" device and tagged
  // source:"citizen" so it is never mistaken for autonomous hardware. Unlike a
  // device sighting it never auto-raises an incident (ADR-0005): a citizen
  // report is advisory until a human authority confirms it.
  app.post("/v1/raksha/report", { preHandler: authenticate }, async (req, reply) => {
    const body = z.object({
      type: z.enum(["pothole", "road_damage", "obstruction"]),
      severity: z.number().int().min(1).max(5),
      note: z.string().max(280).optional(),
      // Optional photo: base64 payload (no data: prefix) + its mime type.
      photoBase64: z.string().min(1).max(9_000_000).optional(),
      photoMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
      ...latLng,
    }).parse(req.body);

    const userId = req.user!.sub;

    // Per-user rate limit: one account cannot flood the queue/map with reports.
    const [{ n: recent }] = await db.execute<{ n: number }>(raw`
      SELECT count(*)::int AS n FROM raksha_detections
       WHERE deleted_at IS NULL AND raw->>'reportedBy' = ${userId}
         AND created_at > now() - make_interval(mins => ${env.reportWindowMinutes})`);
    if (recent >= env.reportMaxPerWindow) {
      return reply.code(429).send({
        error: {
          code: "report_rate_limited",
          title: `You've reported ${env.reportMaxPerWindow} hazards recently — please wait a little before sending more.`,
          retryable: true,
        },
      });
    }

    // Validate the photo up front so a bad attachment never creates a detection.
    let photoBuf: Buffer | null = null;
    if (body.photoBase64) {
      if (!body.photoMime) {
        return reply.code(400).send({ error: { code: "photo_mime_required", title: "A photo needs its image type", retryable: false } });
      }
      photoBuf = Buffer.from(body.photoBase64, "base64");
      if (photoBuf.length === 0 || photoBuf.length > env.uploadMaxBytes) {
        return reply.code(400).send({ error: { code: "photo_too_large", title: `Photo must be 1 byte–${Math.round(env.uploadMaxBytes / 1e6)}MB`, retryable: false } });
      }
    }

    // The one device all crowdsourced reports are attributed to — created lazily
    // on the first report. Its credential is never used to authenticate (reports
    // ride the citizen's own JWT); it exists only to satisfy the detection FK.
    const CITIZEN_HW = "CITIZEN-CROWDSOURCE";
    let [device] = await db.select({ id: S.edgeDevices.id })
      .from(S.edgeDevices)
      .where(and(eq(S.edgeDevices.hardwareRef, CITIZEN_HW), isNull(S.edgeDevices.deletedAt)))
      .limit(1);
    if (!device) {
      [device] = await db.insert(S.edgeDevices).values({
        name: "Citizen Reports (crowdsourced)", hardwareRef: CITIZEN_HW,
        credentialHash: sha256(randomBytes(32).toString("hex")),
        status: "ACTIVE", registeredBy: userId, simulated: true,
      }).returning({ id: S.edgeDevices.id });
    }
    const deviceId = device.id;
    const opId = "cit-" + randomBytes(12).toString("hex");

    const detectionId = await db.transaction(async (tx) => {
      const [ins] = await tx.insert(S.rakshaDetections).values({
        deviceId, opId, detectionType: body.type,
        confidence: 1, severity: body.severity,
        capturedAt: new Date(), ranOffline: false,
        modelVersion: "citizen-report", usedFallback: false,
        notes: body.note,
        raw: { source: "citizen", reportedBy: userId },
      }).returning({ id: S.rakshaDetections.id });
      const id = ins.id;
      await tx.execute(raw`
        UPDATE raksha_detections
           SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
         WHERE id = ${id}`);
      await tx.execute(raw`
        UPDATE raksha_detections rd
           SET segment_id = seg.id
          FROM (SELECT id FROM road_segments
                 WHERE deleted_at IS NULL
                   AND ST_DWithin(path::geography,
                                  ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)::geography, 250)
                 ORDER BY path <-> ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
                 LIMIT 1) seg
         WHERE rd.id = ${id}`);
      return id;
    });

    // Persist the photo to disk (never the DB) and record only its key.
    let imageRef: string | null = null;
    if (photoBuf && body.photoMime) {
      imageRef = savePhoto(detectionId, photoBuf, body.photoMime);
      await db.update(S.rakshaDetections).set({ imageRef, updatedAt: new Date() })
        .where(eq(S.rakshaDetections.id, detectionId));
    }

    return reply.code(201).send(ok(
      { id: detectionId, status: "DETECTED", type: body.type, severity: body.severity, hasPhoto: Boolean(imageRef) },
      { source: "citizen", note: "Queued for authority verification; now visible on the live map." },
    ));
  });

  // ── serve a hazard-report photo (owner or authority only) ─────────────────
  app.get("/v1/raksha/detections/:id/photo", { preHandler: authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [d] = await db.select({ raw: S.rakshaDetections.raw, ref: S.rakshaDetections.imageRef })
      .from(S.rakshaDetections)
      .where(and(eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt))).limit(1);
    if (!d || !d.ref) {
      return reply.code(404).send({ error: { code: "no_photo", title: "No photo for this report", retryable: false } });
    }
    // Only the reporter or an authority may view it.
    const rawObj = (d.raw ?? {}) as Record<string, unknown>;
    const isOwner = rawObj.reportedBy === req.user!.sub;
    const isAuthority = (req.user!.roles ?? []).some((r) => r === "admin" || r === "gov_officer");
    if (!isOwner && !isAuthority) {
      return reply.code(403).send({ error: { code: "forbidden", title: "Not allowed to view this photo", retryable: false } });
    }
    const path = join(env.uploadDir, d.ref);
    if (!existsSync(path)) {
      return reply.code(404).send({ error: { code: "photo_missing", title: "Photo file is unavailable", retryable: false } });
    }
    const ext = d.ref.split(".").pop() ?? "";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return reply.header("cache-control", "private, max-age=3600").type(mime).send(readFileSync(path));
  });

  // ── a citizen's own reports + their verification status ───────────────────
  // Closes the loop: the reporter can watch each hazard move DETECTED → VERIFIED
  // (or REJECTED) as an authority reviews it. Scoped strictly to the caller.
  app.get("/v1/me/reports", { preHandler: authenticate }, async (req) => {
    const userId = req.user!.sub;
    const rows = await db.execute<Record<string, unknown>>(raw`
      SELECT id, detection_type, severity, status, created_at,
             ST_Y(location) AS lat, ST_X(location) AS lng, notes,
             (image_ref IS NOT NULL) AS has_photo
        FROM raksha_detections
       WHERE deleted_at IS NULL
         AND raw->>'source' = 'citizen'
         AND raw->>'reportedBy' = ${userId}
       ORDER BY created_at DESC
       LIMIT 50`);
    return ok(rows, { count: rows.length });
  });

  // ── reads for the dashboard ───────────────────────────────────────────────
  app.get("/v1/raksha/detections", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req) => {
    const q = z.object({
      status: z.enum(["DETECTED", "VERIFIED", "REJECTED", "REPAIR_SCHEDULED", "REPAIRED", "CLOSED"]).optional(),
      type: z.enum(["pothole", "road_damage", "obstruction"]).optional(),
      source: z.enum(["citizen", "device"]).optional(),
      limit: z.coerce.number().min(1).max(200).optional(),
    }).parse(req.query);

    const rows = await db.execute<Record<string, unknown>>(raw`
      SELECT rd.id, rd.op_id, rd.detection_type, rd.confidence, rd.severity, rd.status,
             rd.captured_at, rd.created_at, rd.ran_offline, rd.model_version, rd.used_fallback,
             rd.image_ref, rd.notes,
             COALESCE(rd.raw->>'source', 'device') AS source,
             ST_Y(rd.location) AS lat, ST_X(rd.location) AS lng,
             ed.name AS device_name, ed.simulated,
             rs.code AS segment_code, rs.name AS segment_name
        FROM raksha_detections rd
        JOIN edge_devices ed ON ed.id = rd.device_id
        LEFT JOIN road_segments rs ON rs.id = rd.segment_id
       WHERE rd.deleted_at IS NULL
         AND (${q.status ?? null}::raksha_detection_status IS NULL OR rd.status = ${q.status ?? null})
         AND (${q.type ?? null}::raksha_detection_type IS NULL OR rd.detection_type = ${q.type ?? null})
         AND (${q.source ?? null}::text IS NULL OR COALESCE(rd.raw->>'source', 'device') = ${q.source ?? null})
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

    const [current] = await db.select({ status: S.rakshaDetections.status, imageRef: S.rakshaDetections.imageRef })
      .from(S.rakshaDetections)
      .where(and(eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt))).limit(1);
    if (!current) {
      return reply.code(404).send({ error: { code: "not_found", title: "Detection not found", retryable: false } });
    }
    // Verification is a one-way gate: only a fresh detection can be judged,
    // and prior verification evidence is never silently overwritten.
    const rows = await db.update(S.rakshaDetections).set({
      status: action === "verify" ? "VERIFIED" : "REJECTED",
      verifiedBy: req.user!.sub, verifiedAt: new Date(), updatedAt: new Date(),
      // Only overwrite notes when the reviewer supplies their own — otherwise a
      // citizen's original report note (shown back to them) is preserved.
      ...(notes !== undefined ? { notes } : {}),
      // A rejected report is spam/noise — drop its photo reference now (the file
      // is reclaimed just below) so disk isn't held by discarded submissions.
      ...(action === "reject" && current.imageRef ? { imageRef: null } : {}),
    }).where(and(
      eq(S.rakshaDetections.id, id), isNull(S.rakshaDetections.deletedAt),
      eq(S.rakshaDetections.status, "DETECTED"),
    )).returning({ id: S.rakshaDetections.id, status: S.rakshaDetections.status });
    if (!rows.length) {
      return reply.code(409).send({
        error: { code: "already_reviewed", title: `This detection is already ${current.status} and cannot be re-judged`, retryable: false },
      });
    }
    // Reclaim the rejected report's photo file from disk (best-effort).
    if (action === "reject" && current.imageRef) {
      try { const p = join(env.uploadDir, current.imageRef); if (existsSync(p)) unlinkSync(p); } catch { /* already gone */ }
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
