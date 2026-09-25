/**
 * Fill an empty demo RAKSHA with the project's real detections, at boot.
 *
 * A hosted demo database starts with no detections, and the way they used to
 * arrive - the simulator signing in as the demo admin with the on-screen code -
 * is refused once that admin is behind email sign-in, as it should be. So the
 * demo deployment does it itself, the same way it seeds its mechanics:
 *
 *   · only when SEED_DEMO_FLEET=true, and never with NODE_ENV=production;
 *   · only when there are no detections at all, so it never touches a corridor
 *     somebody is actually using, and a restart is a no-op;
 *   · through the real routes, in-process (app.inject): the ingest route's
 *     validation, segment snapping, idempotency and audit all apply exactly as
 *     they would to a device on the road. Nothing is written around them.
 *
 * The device it posts as is registered like any other: a random secret is
 * generated and only its hash is stored. Nobody ever sees the secret, because
 * nobody needs it - the boot job holds the device's short-lived token instead.
 */
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { issueAccessToken, sha256 } from "../auth.js";
import { RAKSHA_DEMO_DETECTIONS, RAKSHA_DEMO_MODEL } from "./raksha-demo-detections.js";

export const DEMO_DEVICE_NAME = "RAKSHA demo patrol NH-48 [SIMULATED position, real YOLO11 detections]";
const DEMO_ADMIN_MSISDN = "+919999900001";

export async function seedRakshaDemo(app: FastifyInstance): Promise<string> {
  if (process.env.SEED_DEMO_FLEET !== "true") return "raksha demo: off (SEED_DEMO_FLEET unset)";
  if (env.nodeEnv === "production") return "raksha demo: refused (NODE_ENV=production)";

  // Two instances booting on one empty database would each see no detections
  // and each register a device - and idempotency is per device, so every
  // detection would appear twice. One transaction holds a lock for the whole
  // seed; an instance that cannot take it leaves the seeding to the other.
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ got: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('raksha-demo-seed')) AS got`);
    if (!lock?.got) return "raksha demo: skipped - another instance is seeding";
    return seed(app);
  });
}

async function seed(app: FastifyInstance): Promise<string> {

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.rakshaDetections);
  if (n > 0) return `raksha demo: skipped - ${n} detection(s) already present`;

  const [admin] = await db.select({ id: S.users.id }).from(S.users).where(eq(S.users.msisdn, DEMO_ADMIN_MSISDN)).limit(1);
  // A device is registered BY someone (registered_by is required), and the
  // corridor is scored by an officer; seed-raksha.ts creates that admin first.
  if (!admin) return "raksha demo: skipped - no demo admin yet (seed-raksha runs before the API)";

  let [device] = await db.select({ id: S.edgeDevices.id }).from(S.edgeDevices)
    .where(eq(S.edgeDevices.name, DEMO_DEVICE_NAME)).limit(1);
  if (!device) {
    // Registered the way POST /v1/raksha/devices registers one: hash only.
    [device] = await db.transaction(async (tx) => {
      const [row] = await tx.insert(S.edgeDevices).values({
        name: DEMO_DEVICE_NAME,
        hardwareRef: "SIMULATED boot seed",
        credentialHash: sha256(randomBytes(32).toString("base64url")),
        registeredBy: admin.id,
        simulated: true,
      }).returning({ id: S.edgeDevices.id });
      await tx.execute(sql`
        UPDATE edge_devices SET location = ST_SetSRID(ST_MakePoint(77.0266, 28.4595), 4326)
         WHERE id = ${row.id}`);
      return [row];
    });
  }

  const deviceToken = await issueAccessToken({ sub: device.id, roles: ["device"], sid: "" });
  const now = Date.now();
  const res = await app.inject({
    method: "POST", url: "/v1/raksha/detections",
    headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
    payload: {
      detections: RAKSHA_DEMO_DETECTIONS.map((d) => ({
        opId: d.opId, type: d.type, severity: d.severity, confidence: d.confidence,
        lat: d.lat, lng: d.lng, capturedAt: new Date(now - d.ageSeconds * 1000).toISOString(),
        ranOffline: true, imageRef: d.imageRef, modelVersion: d.modelVersion,
        usedFallback: false,
      })),
    },
  });
  if (res.statusCode >= 300) return `raksha demo: ingest answered ${res.statusCode} ${res.body.slice(0, 160)}`;

  // Score the corridor, as an officer's "Recompute" would. The admin is the
  // seeded demo authority; without it the detections still show, unscored.
  const adminToken = await issueAccessToken({ sub: admin.id, roles: ["admin"], sid: "" });
  const h = await app.inject({
    method: "POST", url: "/v1/raksha/road-health/recompute",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const scored = h.statusCode < 300 ? "corridor scored" : `corridor recompute answered ${h.statusCode}`;
  const meta = (res.json() as { meta?: { applied?: number; duplicates?: number } }).meta ?? {};
  return `raksha demo: ${meta.applied ?? "?"} real ${RAKSHA_DEMO_MODEL} detection(s) applied, ` +
    `${meta.duplicates ?? 0} duplicate(s), positions simulated; ${scored}`;
}
