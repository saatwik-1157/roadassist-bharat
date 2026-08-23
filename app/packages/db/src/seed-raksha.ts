/**
 * RAKSHA seed — idempotent, additive, safe to run after the main seed.
 *
 * Creates:
 *  - a demo admin user (+919999900001) so the dashboard/simulator/e2e can
 *    exercise role-gated endpoints with the dev OTP,
 *  - 4 road segments along NH-48 between Gurugram and Manesar with real-ish
 *    coordinates (SIMULATED corridor for the MVP — not survey data).
 */
import { eq, sql } from "drizzle-orm";
import { createClient } from "./client.js";
import { roles, userRoles, users } from "./schema/identity.js";
import { roadSegments } from "./schema/raksha.js";

const { sql: raw, db } = createClient();

const DEMO_ADMIN_MSISDN = "+919999900001";

/** [code, name, kmStart, kmEnd, [lng,lat][] ] — hand-placed along NH-48. */
const SEGMENTS: Array<[string, string, number, number, Array<[number, number]>]> = [
  ["NH48-K205-K208", "NH-48 · Rajiv Chowk → Kherki Daula", 205, 208, [
    [77.0266, 28.4595], [77.0170, 28.4480], [77.0080, 28.4350], [76.9990, 28.4230],
  ]],
  ["NH48-K208-K211", "NH-48 · Kherki Daula → Panchgaon", 208, 211, [
    [76.9990, 28.4230], [76.9880, 28.4120], [76.9760, 28.4020], [76.9640, 28.3930],
  ]],
  ["NH48-K211-K214", "NH-48 · Panchgaon → IMT Manesar", 211, 214, [
    [76.9640, 28.3930], [76.9520, 28.3840], [76.9400, 28.3760], [76.9280, 28.3690],
  ]],
  ["NH48-K214-K217", "NH-48 · IMT Manesar → Bilaspur Chowk", 214, 217, [
    [76.9280, 28.3690], [76.9150, 28.3610], [76.9020, 28.3540], [76.8890, 28.3480],
  ]],
];

async function main() {
  // 1. Demo admin — created if missing, promoted if not yet admin.
  let [admin] = await db.select().from(users).where(eq(users.msisdn, DEMO_ADMIN_MSISDN)).limit(1);
  if (!admin) {
    [admin] = await db.insert(users)
      .values({ msisdn: DEMO_ADMIN_MSISDN, fullName: "RAKSHA Demo Admin", isVerified: true })
      .returning();
    console.log("→ created demo admin user", DEMO_ADMIN_MSISDN);
  }
  let [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin")).limit(1);
  if (!adminRole) {
    [adminRole] = await db.insert(roles)
      .values({ name: "admin", description: "Platform administrator" })
      .returning();
    console.log("→ created admin role (main seed had not run)");
  }
  await db.insert(userRoles)
    .values({ userId: admin.id, roleId: adminRole.id })
    .onConflictDoNothing();

  // 2. Road segments — skipped when the code already exists.
  let created = 0;
  for (const [code, name, kmStart, kmEnd, points] of SEGMENTS) {
    const [existing] = await db.select({ id: roadSegments.id })
      .from(roadSegments).where(eq(roadSegments.code, code)).limit(1);
    if (existing) continue;

    // Row and geometry commit together — a rerun can never see a pathless
    // segment it refuses to repair.
    await db.transaction(async (tx) => {
      const [seg] = await tx.insert(roadSegments).values({
        code, name, highwayRef: "NH-48", kmStart, kmEnd, lengthKm: kmEnd - kmStart,
      }).returning({ id: roadSegments.id });

      const wkt = `LINESTRING(${points.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`;
      await tx.execute(sql`
        UPDATE road_segments
           SET path = ST_SetSRID(ST_GeomFromText(${wkt}), 4326)
         WHERE id = ${seg.id}`);
    });
    created++;
  }
  console.log(`✓ RAKSHA seed complete — demo admin ready, ${created} segment(s) created, ${SEGMENTS.length - created} already present`);
}

main()
  .catch((e) => { console.error("✗ RAKSHA seed failed:", e); process.exitCode = 1; })
  .finally(() => raw.end());
