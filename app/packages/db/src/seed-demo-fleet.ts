/**
 * Demo fleet seed — 24 SIMULATED mechanics on the Gurugram / NH-48 corridor.
 *
 *   npm run seed:demo-fleet -w @roadassist/db
 *   node packages/db/dist/src/seed-demo-fleet.js      (inside the image)
 *
 * ── why this exists ────────────────────────────────────────────────────────
 * The hosted demo's database had the schema, the catalogue, the RAKSHA admin
 * and the NH-48 segments, and not one mechanic, so every citizen dispatch
 * ended in NO_SUPPLY. The full seed cannot fix that from inside the container:
 * it needs @faker-js/faker, a devDependency the production image deliberately
 * leaves out. Nor can it be run from outside, because that means somebody's
 * tooling handling the database password. So the container adds this small
 * fleet itself, on boot, when SEED_DEMO_FLEET=true (docker-start.sh).
 *
 * ── what it guarantees ─────────────────────────────────────────────────────
 *  - No faker. A fixed-seed mulberry32 (the same generator as
 *    scripts/raksha-simulator.mjs) makes the fleet identical on every run and
 *    every machine, so the account the docs cite is always in the same place.
 *  - Idempotent. A number that is already a mechanic is skipped whole, and
 *    reference rows (role, catalogue, zone, partner) are created only when
 *    missing. It runs on every boot, so a second run must be a no-op.
 *  - Additive. It never updates or deletes a row it did not just create, so on
 *    a database the full seed already populated it changes nothing.
 *  - Never production. A fabricated mechanic with a real-looking Indian number
 *    is indistinguishable from a real one on a live platform; see seedDemoFleet().
 *
 * Every row it writes is labelled: the partner is "Demo Fleet (simulated)".
 */
import { pathToFileURL } from "node:url";

import { SERVICE_TYPES } from "./service-catalogue.js";

/** One mechanic, as data. Everything the DB step needs and nothing it looks up. */
export interface DemoMechanicSpec {
  msisdn: string;
  displayName: string;
  lng: number;
  lat: number;
  rating: number;
  jobsCompleted: number;
  isAvailable: boolean;
  preferredLanguage: string;
  /** Service-type codes from the catalogue; resolved to ids at write time. */
  skills: string[];
  vehicleClass: string;
}

export const DEMO_FLEET_SIZE = 24;
export const DEMO_PARTNER_NAME = "Demo Fleet (simulated)";
export const DEMO_ZONE_NAME = "Gurugram";

/**
 * The first number of the range the docs already cite (README, the mechanic
 * console's sign-in hint). The full seed uses the same base, so on a fully
 * seeded database all 24 are already mechanics and every one is skipped.
 */
const MSISDN_BASE = 9600000000;

/** Gurugram and the NH-48 Gurugram-Manesar corridor. Every mechanic lands inside. */
export const DEMO_BOUNDS = { minLng: 76.88, maxLng: 77.10, minLat: 28.34, maxLat: 28.50 } as const;

/**
 * Where mechanics actually wait for work: the city's arterial junctions and the
 * highway's interchanges. The NH-48 points are the vertices of the RAKSHA
 * segments in seed-raksha.ts, so a hazard on a segment has mechanics near it.
 *
 * Anchor 0 is Rajiv Chowk — the point the e2e journey and the docs book at —
 * and mechanic 0 (+919600000000, the account the docs tell people to sign in
 * as) is placed there, so the documented walkthrough reaches him.
 */
const ANCHORS: Array<[number, number]> = [
  [77.0266, 28.4595],   // Rajiv Chowk
  [77.0720, 28.4800],   // MG Road / Sikanderpur
  [77.0420, 28.4250],   // Sohna Road
  [76.9990, 28.4230],   // Kherki Daula toll
  [77.0800, 28.4400],   // Golf Course Extension
  [76.9640, 28.3930],   // Panchgaon
  [76.9280, 28.3690],   // IMT Manesar
  [76.8950, 28.3500],   // Bilaspur Chowk
];

/** About ±1.3 km: enough to scatter a cluster, small enough to stay on its road. */
const JITTER_DEG = 0.012;

const FIRST_NAMES = ["Ramesh", "Suresh", "Mahesh", "Anil", "Sunil", "Vijay",
                     "Rajesh", "Sanjay", "Deepak", "Manoj", "Ashok", "Pankaj"];
const LAST_NAMES = ["Kumar", "Yadav", "Sharma", "Singh", "Chauhan", "Rathi", "Dahiya", "Saini"];

/** Haryana: Hindi first, English for the rest. */
const LANGUAGES = ["hi", "hi", "hi", "en"];
const VEHICLE_CLASSES = ["car", "car", "motorcycle", "auto_rickshaw", "truck"];

const FLEET_SEED = 20260924;

/** mulberry32, copied from scripts/raksha-simulator.mjs. Pure: state is local. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The fleet, as plain data. No I/O, no clock, no global state — two calls
 * return equal arrays, which is what the unit test pins.
 */
export function buildDemoFleet(): DemoMechanicSpec[] {
  const rand = mulberry32(FLEET_SEED);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const codes = SERVICE_TYPES.map(([code]) => code as string);

  return Array.from({ length: DEMO_FLEET_SIZE }, (_, i) => {
    const [aLng, aLat] = ANCHORS[i % ANCHORS.length];
    // Mechanic 0 stays within a few hundred metres of the demo booking point;
    // the rest scatter across their cluster.
    const spread = i === 0 ? JITTER_DEG / 4 : JITTER_DEG;
    const lng = clamp(aLng + (rand() * 2 - 1) * spread, DEMO_BOUNDS.minLng, DEMO_BOUNDS.maxLng);
    const lat = clamp(aLat + (rand() * 2 - 1) * spread, DEMO_BOUNDS.minLat, DEMO_BOUNDS.maxLat);

    // Every mechanic can do the two commonest call-outs; 1-3 more on top.
    // Dispatch does not filter on skills today, but the rows should still say
    // something true about what each provider carries.
    const extras = codes.filter((c) => c !== "flat_tyre" && c !== "battery_jumpstart")
      .filter(() => rand() < 0.35).slice(0, 3);

    return {
      msisdn: `+91${MSISDN_BASE + i}`,
      // Stepped rather than picked, so no two of the 24 share a name: a
      // customer told "Ashok is on his way" should not have two Ashoks.
      displayName: `${FIRST_NAMES[i % FIRST_NAMES.length]} ` +
                   `${LAST_NAMES[(i * 3 + Math.floor(i / FIRST_NAMES.length)) % LAST_NAMES.length]}`,
      lng: round(lng, 5),
      lat: round(lat, 5),
      rating: round(4 + rand() * 0.9, 1),
      jobsCompleted: 20 + Math.floor(rand() * 380),
      // All on duty. Dispatch only offers to is_available mechanics, and a
      // demo that answers NO_SUPPLY because of a realism flourish is the bug
      // this file exists to fix. The console's own toggle takes them off.
      isAvailable: true,
      preferredLanguage: pick(LANGUAGES),
      skills: ["flat_tyre", "battery_jumpstart", ...extras],
      vehicleClass: pick(VEHICLE_CLASSES),
    };
  });
}

/**
 * Write the fleet. `env` is a parameter so the production refusal can be
 * tested without touching a database: the check runs before the client module
 * is even imported, because importing it resolves DATABASE_URL.
 */
export async function seedDemoFleet(env: NodeJS.ProcessEnv = process.env): Promise<{ created: number; attached: number; skipped: number }> {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "seed-demo-fleet refuses to run with NODE_ENV=production. It writes 24 simulated " +
      "mechanics with real-looking Indian phone numbers, and on a live platform they " +
      "would be offered real customers' breakdowns. It is for the demo deployment only.",
    );
  }

  const { eq, and, isNull, sql } = await import("drizzle-orm");
  const { createClient } = await import("./client.js");
  const I = await import("./schema/identity.js");
  const S = await import("./schema/service.js");

  // max 1: this runs once at boot beside a server that is about to open its own
  // pool, and a free-tier Postgres has few connections to spare.
  const { sql: raw, db } = createClient(undefined, 1);
  try {
    // ---- reference rows, only where missing --------------------------------
    // The mechanic role is what requireRole("mechanic") checks on the console
    // routes; without the user_roles row a mechanic can sign in and see nothing.
    await db.insert(I.roles).values({ name: "mechanic", description: "mechanic role" }).onConflictDoNothing();
    const [mechanicRole] = await db.select({ id: I.roles.id }).from(I.roles)
      .where(eq(I.roles.name, "mechanic")).limit(1);

    // A booking is priced from its service type, and a database that has had
    // only migrate + seed-raksha has none, so a citizen could not even book.
    // The unique index on code makes this a no-op where the catalogue exists.
    await db.insert(S.serviceTypes).values(SERVICE_TYPES.map(([code, label, base, perKm, eta]) => ({
      code, label, baseFarePaise: base, perKmPaise: perKm, etaMinutes: eta,
    }))).onConflictDoNothing();
    const svcRows = await db.select({ id: S.serviceTypes.id, code: S.serviceTypes.code }).from(S.serviceTypes);
    const svcId = new Map(svcRows.map((s) => [s.code, s.id]));

    // Neither table has a unique name, so look before inserting.
    let [zone] = await db.select({ id: S.serviceZones.id }).from(S.serviceZones)
      .where(and(eq(S.serviceZones.name, DEMO_ZONE_NAME), isNull(S.serviceZones.deletedAt))).limit(1);
    if (!zone) {
      [zone] = await db.insert(S.serviceZones).values({
        name: DEMO_ZONE_NAME, state: "Haryana", district: "Gurugram", radiusKm: 30,
      }).returning({ id: S.serviceZones.id });
      await db.execute(sql`UPDATE service_zones SET centre = ST_SetSRID(ST_MakePoint(77.0266, 28.4595), 4326)
                            WHERE id = ${zone.id}`);
      console.log(`→ created service zone ${DEMO_ZONE_NAME}`);
    }

    let [partner] = await db.select({ id: S.servicePartners.id }).from(S.servicePartners)
      .where(and(eq(S.servicePartners.name, DEMO_PARTNER_NAME), isNull(S.servicePartners.deletedAt))).limit(1);
    if (!partner) {
      // No contact number: a partner msisdn would be one more fabricated
      // number that looks like a real person's.
      [partner] = await db.insert(S.servicePartners).values({ name: DEMO_PARTNER_NAME, verified: true })
        .returning({ id: S.servicePartners.id });
      console.log(`→ created partner "${DEMO_PARTNER_NAME}"`);
    }

    // ---- the mechanics ----------------------------------------------------
    const tally = { created: 0, attached: 0, skipped: 0 };
    for (const m of buildDemoFleet()) {
      // Each mechanic commits whole or not at all. Otherwise a user row that
      // landed without its mechanic row would be skipped on every later boot
      // and stay undispatchable forever.
      const outcome = await db.transaction(async (tx) => {
        // ON CONFLICT rather than a prior SELECT: two containers booting at
        // once (a deploy overlapping the old instance) both reach this line,
        // and the loser must skip rather than fail the transaction.
        let [user] = await tx.insert(I.users).values({
          msisdn: m.msisdn, fullName: m.displayName, isVerified: true,
          preferredLanguage: m.preferredLanguage,
        }).onConflictDoNothing().returning({ id: I.users.id });
        const fresh = Boolean(user);

        // The number exists but may not be a mechanic. The docs tell visitors
        // to sign in as +919600000000, and on a database with no mechanics that
        // sign-in creates a plain citizen account — so the documented number
        // is the one most likely to exist already, and skipping it would leave
        // the walkthrough broken for good. Attach a mechanic row to it instead.
        // That is still additive: the user row itself is not modified.
        if (!user) {
          [user] = await tx.select({ id: I.users.id }).from(I.users).where(eq(I.users.msisdn, m.msisdn)).limit(1);
        }

        // verified + is_available + last_location are exactly the columns
        // findCandidates() in apps/api/src/dispatch.ts filters on; a mechanic
        // missing any one of them is invisible to dispatch. The unique index
        // on user_id is the "already a mechanic" test: a conflict here means
        // this number is taken care of, by the full seed or an earlier boot.
        const [mech] = await tx.insert(S.mechanics).values({
          userId: user.id, partnerId: partner.id, displayName: m.displayName,
          verified: true, rating: m.rating, jobsCompleted: m.jobsCompleted,
          isAvailable: m.isAvailable, zoneId: zone.id,
        }).onConflictDoNothing().returning({ id: S.mechanics.id });
        if (!mech) return "skipped" as const;

        // The role is what requireRole("mechanic") checks on the console routes.
        await tx.insert(I.userRoles).values({ userId: user.id, roleId: mechanicRole.id }).onConflictDoNothing();

        // Same geometry(Point,4326) write as seed.ts; dispatch casts to
        // ::geography at read time, so ST_DWithin measures true metres.
        await tx.execute(sql`
          UPDATE mechanics
             SET last_location = ST_SetSRID(ST_MakePoint(${m.lng}, ${m.lat}), 4326),
                 last_location_at = now()
           WHERE id = ${mech.id}`);

        const skills = m.skills.map((code) => svcId.get(code)).filter((id): id is string => Boolean(id));
        if (skills.length) {
          await tx.insert(S.mechanicSkills).values(skills.map((serviceTypeId) => ({
            mechanicId: mech.id, serviceTypeId, vehicleClass: m.vehicleClass,
          }))).onConflictDoNothing();
        }
        return fresh ? "created" as const : "attached" as const;
      });
      tally[outcome]++;
    }

    console.log(`✓ demo fleet seed complete — ${tally.created} mechanic(s) created, ` +
                `${tally.attached} attached to an existing account, ${tally.skipped} already present ` +
                `(+91${MSISDN_BASE} … +91${MSISDN_BASE + DEMO_FLEET_SIZE - 1}, partner "${DEMO_PARTNER_NAME}")`);
    return tally;
  } finally {
    await raw.end();
  }
}

// Run only when executed directly, so the unit test can import the generator
// and the refusal without opening a connection.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDemoFleet().catch((e) => { console.error("✗ demo fleet seed failed:", e); process.exitCode = 1; });
}
