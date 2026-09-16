/**
 * Seeds a realistic dataset: RBAC, service catalogue, DTC codes, and a population
 * of users, vehicles, mechanics and bookings spread across real Indian districts.
 *
 *   npm run db:seed              -> default volume
 *   SEED_USERS=20000 npm run db:seed
 */
import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import { sql } from "drizzle-orm";
import { createClient } from "./client.js";
import * as I from "./schema/identity.js";
import * as F from "./schema/fleet.js";
import * as S from "./schema/service.js";
import * as O from "./schema/ops.js";

const USERS = Number(process.env.SEED_USERS ?? 4000);
const MECHANICS = Number(process.env.SEED_MECHANICS ?? 600);
const BOOKINGS = Number(process.env.SEED_BOOKINGS ?? 6000);

/**
 * Reference data only — no demo population.
 *
 *   npm run db:seed -- --reference-only
 *
 * A production database needs the rows the application cannot work without:
 * roles and permissions, consent purposes, the service catalogue, and the OBD-II
 * code dictionary. It must NEVER receive the rest of this file — four thousand
 * invented users with Indian phone numbers, six hundred fictional mechanics and
 * six thousand fabricated bookings, all of which would be indistinguishable from
 * real records the moment the platform went live.
 *
 * Until this flag existed, `DEPLOYMENT.md` had to tell an operator to insert the
 * catalogue by hand. That is exactly the kind of undocumented manual step that
 * turns into a production incident.
 */
const REFERENCE_ONLY =
  process.argv.includes("--reference-only") || process.env.SEED_REFERENCE_ONLY === "true";

faker.seed(20260804);
const { sql: raw, db } = createClient();

/** Service zones anchored on real districts, with a plausible radius. */
const ZONES = [
  { name: "Gurugram", state: "Haryana", district: "Gurugram", lng: 77.0266, lat: 28.4595 },
  { name: "Hyderabad", state: "Telangana", district: "Hyderabad", lng: 78.4867, lat: 17.3850 },
  { name: "Vijayawada", state: "Andhra Pradesh", district: "NTR", lng: 80.6480, lat: 16.5062 },
  { name: "Pune", state: "Maharashtra", district: "Pune", lng: 73.8567, lat: 18.5204 },
  { name: "Coimbatore", state: "Tamil Nadu", district: "Coimbatore", lng: 76.9558, lat: 11.0168 },
  { name: "Jaipur", state: "Rajasthan", district: "Jaipur", lng: 75.7873, lat: 26.9124 },
  { name: "Guwahati", state: "Assam", district: "Kamrup Metro", lng: 91.7362, lat: 26.1445 },
  { name: "Bhopal", state: "Madhya Pradesh", district: "Bhopal", lng: 77.4126, lat: 23.2599 },
];

const SERVICE_TYPES = [
  ["flat_tyre", "Flat tyre / puncture", 39900, 1200, 25],
  ["battery_jumpstart", "Battery jump start", 34900, 1200, 20],
  ["fuel_delivery", "Emergency fuel delivery", 29900, 1500, 30],
  ["key_lockout", "Key lockout assistance", 49900, 1200, 35],
  ["minor_repair", "On-spot minor repair", 59900, 1500, 40],
  ["towing", "Towing to nearest garage", 99900, 4500, 45],
  ["ev_charge", "EV mobile charging", 79900, 2000, 40],
  ["accident_support", "Accident support", 0, 0, 15],
] as const;

const DTC = [
  ["P0300", "engine", 4, false, "Random or multiple cylinder misfire detected"],
  ["P0171", "fuel", 3, true, "System too lean (bank 1)"],
  ["P0420", "emissions", 2, true, "Catalyst system efficiency below threshold"],
  ["P0128", "cooling", 3, true, "Coolant thermostat below regulating temperature"],
  ["P0562", "electrical", 4, false, "System voltage low — charging fault"],
  ["P0301", "engine", 4, false, "Cylinder 1 misfire detected"],
  ["C0035", "abs", 4, false, "Left front wheel speed sensor circuit"],
  ["B1318", "electrical", 5, false, "Battery voltage critically low"],
  ["P0217", "cooling", 5, false, "Engine over-temperature condition"],
  ["U0100", "network", 4, false, "Lost communication with ECM/PCM"],
] as const;

const MODELS = [
  ["Maruti Suzuki", "Swift", "car", "petrol", true],
  ["Maruti Suzuki", "Alto", "car", "petrol", true],
  ["Hyundai", "i20", "car", "petrol", true],
  ["Tata", "Nexon EV", "ev", "electric", true],
  ["Mahindra", "Bolero", "car", "diesel", true],
  ["Hero", "Splendor Plus", "motorcycle", "petrol", false],
  ["Honda", "Activa", "scooter", "petrol", false],
  ["Bajaj", "RE Compact", "auto_rickshaw", "cng", false],
  ["Tata", "Ace", "truck", "diesel", true],
  ["Ashok Leyland", "Dost", "truck", "diesel", true],
  ["Mahindra", "575 DI", "tractor", "diesel", false],
  ["Ola", "S1 Pro", "ev", "electric", false],
] as const;

const PERMISSIONS = [
  "booking:create", "booking:read", "booking:cancel", "booking:assign",
  "vehicle:read", "vehicle:write", "mechanic:read", "mechanic:accept",
  "incident:create", "incident:read", "incident:confirm", "medical:breakglass",
  "gov:analytics:read", "gov:report:generate", "admin:user:manage", "admin:audit:read",
];

const ROLE_PERMS: Record<string, string[]> = {
  citizen: ["booking:create", "booking:read", "booking:cancel", "vehicle:read", "vehicle:write", "mechanic:read", "incident:create", "incident:read", "incident:confirm"],
  mechanic: ["booking:read", "mechanic:accept", "mechanic:read", "vehicle:read", "incident:read"],
  fleet_admin: ["booking:create", "booking:read", "booking:cancel", "vehicle:read", "vehicle:write", "mechanic:read"],
  fleet_driver: ["booking:create", "booking:read", "vehicle:read", "incident:create"],
  gov_officer: ["gov:analytics:read", "gov:report:generate"],
  support: ["booking:read", "booking:assign", "vehicle:read", "mechanic:read", "incident:read"],
  admin: PERMISSIONS,
};

const jitter = (v: number, km: number) => v + faker.number.float({ min: -km, max: km }) / 111;
// Columns are geometry(Point,4326); distance queries cast to ::geography at
// read time so ST_DWithin still measures true metres.
const pt = (lng: number, lat: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
const ref = () => faker.string.alphanumeric({ length: 8, casing: "upper" });

async function main() {
  const t0 = Date.now();
  console.log(REFERENCE_ONLY
    ? "→ seeding REFERENCE DATA ONLY (roles, consent purposes, service catalogue, DTC codes) — no demo population"
    : `→ seeding ${USERS} users, ${MECHANICS} mechanics, ${BOOKINGS} bookings`);

  // ---- RBAC ---------------------------------------------------------------
  const roleRows = await db.insert(I.roles).values(
    (Object.keys(ROLE_PERMS) as Array<keyof typeof ROLE_PERMS>).map((name) => ({
      // The keys of ROLE_PERMS are the enum's own members; the cast tells the
      // compiler what the object literal already guarantees.
      name: name as (typeof I.roleEnum.enumValues)[number], description: `${name} role`,
    })),
  ).returning();
  const permRows = await db.insert(I.permissions).values(
    PERMISSIONS.map((code) => ({ code, description: code })),
  ).returning();
  const permId = new Map(permRows.map((p) => [p.code, p.id]));
  await db.insert(I.rolePermissions).values(
    roleRows.flatMap((r) =>
      ROLE_PERMS[r.name].map((c) => ({ roleId: r.id, permissionId: permId.get(c)! })),
    ),
  );
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]));

  // ---- consent purposes (DPDP) -------------------------------------------
  await db.insert(I.consentPurposes).values([
    { code: "service_delivery", label: "Provide roadside assistance", policyVersion: "1.0", required: true },
    { code: "location_tracking", label: "Share live location with the assigned mechanic", policyVersion: "1.0", required: true },
    { code: "emergency_contacts", label: "Alert your emergency contacts after a crash", policyVersion: "1.0", required: false },
    { code: "medical_breakglass", label: "Release medical details to responders in an emergency", policyVersion: "1.0", required: false },
    { code: "model_training", label: "Use anonymised diagnostic data to improve the models", policyVersion: "1.0", required: false },
    { code: "marketing", label: "Send offers and product updates", policyVersion: "1.0", required: false },
  ]);

  // ---- catalogue ----------------------------------------------------------
  const svcRows = await db.insert(S.serviceTypes).values(
    SERVICE_TYPES.map(([code, label, base, perKm, eta]) => ({
      code, label, baseFarePaise: base, perKmPaise: perKm, etaMinutes: eta,
    })),
  ).returning();

  const dtcRows = await db.insert(F.dtcCodes).values(
    DTC.map(([code, system, severity, driveable, description]) => ({
      code, system, severity, driveable, description,
    })),
  ).returning();
  await db.insert(F.dtcTranslations).values(
    dtcRows.flatMap((d) => [
      { dtcId: d.id, lang: "en", plainText: d.description },
      { dtcId: d.id, lang: "hi", plainText: `${d.code}: इंजन की जाँच आवश्यक है` },
    ]),
  );

  const modelRows = await db.insert(F.vehicleModels).values(
    MODELS.map(([make, model, cls, fuel, hasObd]) => ({
      make, model,
      vehicleClass: cls as (typeof F.vehicleClassEnum.enumValues)[number],
      fuel: fuel as (typeof F.fuelEnum.enumValues)[number], hasObd,
      yearFrom: 2014, yearTo: 2026,
    })),
  ).returning();

  // Everything above is reference data the application cannot run without.
  // Everything below is an invented population, and a production database must
  // never receive it — a fabricated user with a real-looking Indian phone number
  // is indistinguishable from a real one the day after go-live.
  if (REFERENCE_ONLY) {
    const [{ count: tables }] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    console.log(`✓ reference data seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  ${roleRows.length} roles · ${svcRows.length} service types · ` +
                `${dtcRows.length} DTC codes · ${modelRows.length} vehicle models`);
    console.log(`  ${tables} tables in the schema, no demo users, mechanics or bookings`);
    console.log("  Create the first operator account by signing in — the SIM is the identity.");
    return;
  }

  const zoneRows: Array<{ id: string } & (typeof ZONES)[number]> = [];
  for (const z of ZONES) {
    const [row] = await db.insert(S.serviceZones).values({
      name: z.name, state: z.state, district: z.district, radiusKm: 30,
    }).returning();
    await db.execute(sql`UPDATE service_zones SET centre = ${pt(z.lng, z.lat)} WHERE id = ${row.id}`);
    zoneRows.push({ ...row, ...z });
  }

  // ---- users --------------------------------------------------------------
  const userValues = Array.from({ length: USERS }, (_, i) => ({
    msisdn: `+91${String(7000000000 + i)}`,
    fullName: faker.person.fullName(),
    preferredLanguage: faker.helpers.arrayElement(["en", "hi", "te", "ta", "mr", "bn", "kn", "gu"]),
    isVerified: faker.datatype.boolean(0.85),
  }));
  const userRows: { id: string }[] = [];
  for (let i = 0; i < userValues.length; i += 1000) {
    userRows.push(...await db.insert(I.users).values(userValues.slice(i, i + 1000)).returning({ id: I.users.id }));
  }
  await db.insert(I.userRoles).values(
    userRows.map((u) => ({ userId: u.id, roleId: roleId.get("citizen")! })),
  ).onConflictDoNothing();

  // emergency contacts for a realistic share of users
  await db.insert(I.emergencyContacts).values(
    userRows.slice(0, Math.floor(USERS * 0.6)).map((u) => ({
      userId: u.id, name: faker.person.firstName(),
      msisdn: `+91${faker.string.numeric(10)}`,
      relation: faker.helpers.arrayElement(["spouse", "parent", "sibling", "friend"]),
    })),
  );

  // ---- vehicles -----------------------------------------------------------
  const vehValues = userRows.map((u, i) => {
    const m = faker.helpers.arrayElement(modelRows);
    return {
      modelId: m.id,
      registrationNo: `${faker.helpers.arrayElement(["HR26", "TS09", "AP16", "MH12", "TN37", "RJ14", "AS01", "MP04"])}${faker.string.alpha({ length: 2, casing: "upper" })}${String(1000 + (i % 8999))}`,
      vehicleClass: m.vehicleClass, fuel: m.fuel,
      odometerKm: faker.number.int({ min: 500, max: 190000 }),
    };
  });
  const vehRows: { id: string }[] = [];
  for (let i = 0; i < vehValues.length; i += 1000) {
    vehRows.push(...await db.insert(F.vehicles).values(vehValues.slice(i, i + 1000)).returning({ id: F.vehicles.id }));
  }
  for (let i = 0; i < vehRows.length; i += 1000) {
    await db.insert(F.userVehicles).values(
      vehRows.slice(i, i + 1000).map((v, k) => ({
        userId: userRows[i + k].id, vehicleId: v.id, isPrimary: true,
      })),
    );
  }

  // ---- mechanics ----------------------------------------------------------
  const partnerRows = await db.insert(S.servicePartners).values(
    Array.from({ length: 40 }, () => ({
      name: `${faker.company.name()} Motors`, verified: true,
      contactMsisdn: `+91${faker.string.numeric(10)}`,
    })),
  ).returning();

  const mechUsers = await db.insert(I.users).values(
    Array.from({ length: MECHANICS }, (_, i) => ({
      msisdn: `+91${String(9600000000 + i)}`,
      fullName: faker.person.fullName(),
      isVerified: true,
      preferredLanguage: faker.helpers.arrayElement(["en", "hi", "te", "ta"]),
    })),
  ).returning({ id: I.users.id });
  await db.insert(I.userRoles).values(
    mechUsers.map((u) => ({ userId: u.id, roleId: roleId.get("mechanic")! })),
  );

  const mechRows = await db.insert(S.mechanics).values(
    mechUsers.map((u, i) => {
      const z = zoneRows[i % zoneRows.length];
      return {
        userId: u.id,
        partnerId: faker.helpers.arrayElement(partnerRows).id,
        displayName: faker.person.fullName(),
        verified: faker.datatype.boolean(0.9),
        rating: Number(faker.number.float({ min: 3.2, max: 5, fractionDigits: 1 })),
        jobsCompleted: faker.number.int({ min: 0, max: 900 }),
        isAvailable: faker.datatype.boolean(0.55),
        zoneId: z.id,
      };
    }),
  ).returning({ id: S.mechanics.id, zoneId: S.mechanics.zoneId });

  // scatter mechanics around their zone centre
  for (let i = 0; i < mechRows.length; i++) {
    const z = zoneRows[i % zoneRows.length];
    await db.execute(sql`
      UPDATE mechanics
         SET last_location = ${pt(jitter(z.lng, 22), jitter(z.lat, 22))},
             last_location_at = now()
       WHERE id = ${mechRows[i].id}`);
  }
  await db.insert(S.mechanicSkills).values(
    mechRows.flatMap((m) =>
      faker.helpers.arrayElements(svcRows, { min: 2, max: 5 }).map((s) => ({
        mechanicId: m.id, serviceTypeId: s.id,
        vehicleClass: faker.helpers.arrayElement(["car", "motorcycle", "auto_rickshaw", "truck"]),
      })),
    ),
  ).onConflictDoNothing();

  // ---- bookings -----------------------------------------------------------
  /**
   * Bookings that must carry financial records, collected while they are
   * inserted.
   *
   * A status column is not a fact about money. The API refuses
   * `payment.settled` unless a settled payment covers the invoice
   * (`payment_required`, server.ts), so a seeded database that marked bookings
   * PAID with no invoice and no payment contradicted the platform's own rule —
   * 1,789 of them, discoverable by anyone who ran one join. Same class as the
   * 874 impossible-state rows fixed earlier: the seeder was wrong, not the app.
   */
  const billable: Array<{ bookingId: string; paid: boolean; serviceTypeId: string; at: Date }> = [];

  const STATUSES = ["COMPLETED", "PAID", "CANCELLED", "REQUESTED", "MATCHING", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as const;
  const WEIGHTS = [38, 30, 10, 4, 3, 5, 5, 5];
  const pickStatus = () => {
    let r = faker.number.int({ min: 1, max: 100 });
    for (let i = 0; i < STATUSES.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return STATUSES[i]; }
    return "COMPLETED" as const;
  };

  /**
   * Statuses that can only exist because a mechanic accepted the job.
   *
   * The seeder used to pick one of these and leave `mechanic_id` null, which is
   * a state the application itself cannot produce: the only route into ASSIGNED
   * is `mechanic.accept`, and that always writes the id. A database audit found
   * 874 such rows — every one of them seeded, none application-created.
   *
   * It is not cosmetic. Those rows are counted as active work by the operations
   * view, and any join through `mechanic_id` silently drops them, so the demo
   * data disagreed with the demo.
   */
  const NEEDS_MECHANIC: ReadonlySet<string> =
    new Set(["ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED", "COMPLETED", "PAID"]);

  let created = 0;
  for (let batch = 0; batch < BOOKINGS; batch += 500) {
    const size = Math.min(500, BOOKINGS - batch);
    const rows = Array.from({ length: size }, () => {
      const idx = faker.number.int({ min: 0, max: userRows.length - 1 });
      const z = faker.helpers.arrayElement(zoneRows);
      const status = pickStatus();
      const requestedAt = faker.date.recent({ days: 90 });
      return {
        reference: `RA${ref()}`,
        userId: userRows[idx].id,
        vehicleId: vehRows[idx].id,
        serviceTypeId: faker.helpers.arrayElement(svcRows).id,
        status: status as (typeof S.bookingStatusEnum.enumValues)[number],
        // A job in an accepted state has a mechanic, always. See NEEDS_MECHANIC.
        mechanicId: NEEDS_MECHANIC.has(status)
          ? faker.helpers.arrayElement(mechRows).id
          : null,
        assignedAt: NEEDS_MECHANIC.has(status) ? requestedAt : null,
        addressText: `${faker.location.streetAddress()}, ${z.district}`,
        highwayMarker: faker.datatype.boolean(0.3)
          ? `NH-${faker.number.int({ min: 2, max: 966 })}, KM ${faker.number.int({ min: 1, max: 400 })}` : null,
        symptoms: faker.helpers.arrayElement([
          "Engine won't start", "Flat tyre on the rear left", "Battery seems dead",
          "Overheating warning light", "Ran out of fuel", "Keys locked inside",
          "Strange noise from the front wheel", "Clutch not engaging",
        ]),
        requestedAt,
        completedAt: ["COMPLETED", "PAID"].includes(status) ? faker.date.soon({ days: 1, refDate: requestedAt }) : null,
        cancelledAt: status === "CANCELLED" ? faker.date.soon({ days: 1, refDate: requestedAt }) : null,
        createdOffline: faker.datatype.boolean(0.18),
        _lng: jitter(z.lng, 28), _lat: jitter(z.lat, 28),
      };
    });
    const inserted = await db.insert(S.bookings)
      .values(rows.map(({ _lng, _lat, ...r }) => r))
      .returning({ id: S.bookings.id });
    for (let i = 0; i < inserted.length; i++) {
      await db.execute(sql`UPDATE bookings SET location = ${pt(rows[i]._lng, rows[i]._lat)} WHERE id = ${inserted[i].id}`);
      const r = rows[i];
      if (r.status === "COMPLETED" || r.status === "PAID") {
        billable.push({
          bookingId: inserted[i].id,
          paid: r.status === "PAID",
          serviceTypeId: r.serviceTypeId,
          at: r.completedAt ?? r.requestedAt,
        });
      }
    }
    created += inserted.length;
    if (created % 2000 === 0) console.log(`  … ${created}/${BOOKINGS} bookings`);
  }

  // ---- invoices and payments ----------------------------------------------
  // Mirrors what the API does rather than inventing a second set of rules: an
  // invoice is raised when a job completes (labour + 18% GST, the same figures
  // server.ts uses), and a PAID booking additionally carries a settled payment
  // for the full amount. Anything still COMPLETED has an invoice and no
  // payment, which is exactly what "payment pending" means on the screen.
  const fareOf = new Map(svcRows.map((s) => [s.id, s.baseFarePaise ?? 39900]));
  const invNo = () => "INV" + randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  let invoiced = 0, settled = 0;
  for (let i = 0; i < billable.length; i += 500) {
    const slice = billable.slice(i, i + 500);
    const invRows = slice.map((b) => {
      const labour = fareOf.get(b.serviceTypeId) ?? 39900;
      const tax = Math.round(labour * 0.18);
      return {
        bookingId: b.bookingId, number: invNo(),
        labourPaise: labour, partsPaise: 0, taxPaise: tax, totalPaise: labour + tax,
        createdAt: b.at, updatedAt: b.at,
      };
    });
    const insertedInv = await db.insert(S.invoices).values(invRows)
      .returning({ id: S.invoices.id, bookingId: S.invoices.bookingId, totalPaise: S.invoices.totalPaise });
    invoiced += insertedInv.length;

    const byBooking = new Map(insertedInv.map((r) => [r.bookingId as string, r]));
    const payRows = slice.filter((b) => b.paid).map((b) => {
      const inv = byBooking.get(b.bookingId)!;
      return {
        invoiceId: inv.id, method: "upi", amountPaise: inv.totalPaise,
        status: "SETTLED", providerRef: "seed_" + randomUUID().slice(0, 12),
        settledAt: b.at, createdAt: b.at, updatedAt: b.at,
      };
    });
    if (payRows.length) {
      await db.insert(S.payments).values(payRows);
      settled += payRows.length;
    }
  }
  console.log(`  ${invoiced} invoices · ${settled} settled payments`);

  // ---- responder units (emergency escalation targets) ---------------------
  const KINDS = ["ambulance", "police", "tow", "partner"] as const;
  const responderRows = [];
  for (const z of zoneRows) {
    for (const kind of KINDS) {
      const [r] = await db.insert(O.responderUnits).values({
        name: `${z.name} ${kind === "police" ? "Highway Patrol" : kind === "ambulance" ? "108 Ambulance" : kind === "tow" ? "Recovery Unit" : "Partner Response"}`,
        kind, msisdn: `+91${faker.string.numeric(10)}`, active: true,
      }).returning({ id: O.responderUnits.id });
      await db.execute(sql`
        UPDATE responder_units SET last_location = ${pt(jitter(z.lng, 12), jitter(z.lat, 12))}
        WHERE id = ${r.id}`);
      responderRows.push(r);
    }
  }

  // ---- a handful of incidents --------------------------------------------
  const incidentRows = await db.insert(O.incidents).values(
    Array.from({ length: 120 }, () => {
      const idx = faker.number.int({ min: 0, max: userRows.length - 1 });
      const detected = faker.datatype.boolean(0.7);
      return {
        userId: userRows[idx].id,
        vehicleId: vehRows[idx].id,
        status: faker.helpers.arrayElement(
          ["RESOLVED", "CANCELLED", "CONFIRMED", "RESPONDING"] as const,
        ) as (typeof O.incidentStatusEnum.enumValues)[number],
        severity: faker.helpers.arrayElement(
          ["MEDIUM", "HIGH", "CRITICAL"] as const,
        ) as (typeof O.incidentSeverityEnum.enumValues)[number],
        detectedByModel: detected,
        modelConfidence: detected ? Number(faker.number.float({ min: 0.72, max: 0.99, fractionDigits: 2 })) : null,
        confirmedBy: faker.helpers.arrayElement(["user", "callback", "second_signal"]),
        confirmedAt: faker.date.recent({ days: 60 }),
      };
    }),
  ).returning({ id: O.incidents.id });
  await db.insert(O.incidentResponses).values(
    incidentRows.flatMap((i) =>
      ["contacts", "responder", "erss112"].map((step, k) => ({
        incidentId: i.id, step,
        latencyMs: faker.number.int({ min: 400, max: 2400 }) * (k + 1),
        acknowledged: faker.datatype.boolean(0.8),
      })),
    ),
  );

  // Our tables, not PostGIS's. The same information_schema count lived in
  // migrate.ts and reported 57 for a schema that defines 56 — spatial_ref_sys
  // is installed into `public` by CREATE EXTENSION. pg_depend knows the
  // difference; see the note in migrate.ts and CLAIMS-AUDIT.md §4.
  const [{ tables }] = await db.execute<{ tables: string }>(sql`
    SELECT count(*)::text AS tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
     WHERE c.relkind = 'r' AND d.objid IS NULL`);
  const [{ rows: totalRows }] = await db.execute<{ rows: string }>(sql`
    SELECT COALESCE(sum(n_live_tup),0)::text AS rows FROM pg_stat_user_tables`);

  console.log(`✓ seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  tables: ${tables}   approx rows: ${totalRows}`);
  console.log(`  demo login: +917000000000  (any OTP in dev)`);
}

main()
  .catch((e) => { console.error("✗ seed failed:", e); process.exitCode = 1; })
  .finally(() => raw.end());
