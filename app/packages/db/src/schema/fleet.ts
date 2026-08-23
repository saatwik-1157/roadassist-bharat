/** Vehicles, telemetry, diagnostics and fleet tenancy. */
import {
  boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { base } from "./_shared.js";
import { users } from "./identity.js";

export const vehicleClassEnum = pgEnum("vehicle_class", [
  "car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev",
]);

export const fuelEnum = pgEnum("fuel_type", ["petrol", "diesel", "cng", "lpg", "electric", "hybrid"]);

export const vehicleModels = pgTable("vehicle_models", {
  ...base,
  make: varchar("make", { length: 60 }).notNull(),
  model: varchar("model", { length: 80 }).notNull(),
  yearFrom: integer("year_from"),
  yearTo: integer("year_to"),
  vehicleClass: vehicleClassEnum("vehicle_class").notNull(),
  fuel: fuelEnum("fuel"),
  hasObd: boolean("has_obd").notNull().default(false),
}, (t) => ({
  makeModelIdx: index("vehicle_models_make_model_idx").on(t.make, t.model),
}));

export const vehicles = pgTable("vehicles", {
  ...base,
  modelId: uuid("model_id").references(() => vehicleModels.id),
  registrationNo: varchar("registration_no", { length: 16 }).notNull(),
  nickname: varchar("nickname", { length: 60 }),
  odometerKm: integer("odometer_km").notNull().default(0),
  vehicleClass: vehicleClassEnum("vehicle_class").notNull(),
  fuel: fuelEnum("fuel"),
  fleetId: uuid("fleet_id"),
}, (t) => ({
  regUq: uniqueIndex("vehicles_reg_uq").on(t.registrationNo),
  fleetIdx: index("vehicles_fleet_idx").on(t.fleetId),
}));

export const userVehicles = pgTable("user_vehicles", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  relationship: varchar("relationship", { length: 16 }).notNull().default("owner"),
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => ({
  uq: uniqueIndex("user_vehicle_uq").on(t.userId, t.vehicleId),
  userIdx: index("user_vehicles_user_idx").on(t.userId),
}));

export const vehicleDocuments = pgTable("vehicle_documents", {
  ...base,
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  docType: varchar("doc_type", { length: 24 }).notNull(),   // rc | insurance | puc | permit
  objectKey: text("object_key").notNull(),
  expiresOn: timestamp("expires_on", { withTimezone: true }),
}, (t) => ({ vehicleIdx: index("vehicle_docs_vehicle_idx").on(t.vehicleId) }));

export const serviceRecords = pgTable("service_records", {
  ...base,
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  servicedOn: timestamp("serviced_on", { withTimezone: true }).notNull(),
  odometerKm: integer("odometer_km"),
  summary: text("summary"),
  costPaise: integer("cost_paise"),
}, (t) => ({ vehicleIdx: index("service_records_vehicle_idx").on(t.vehicleId) }));

/** High-volume time series — partitioned by time in production. */
export const vehicleTelemetry = pgTable("vehicle_telemetry", {
  ...base,
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  speedKph: doublePrecision("speed_kph"),
  engineTempC: doublePrecision("engine_temp_c"),
  batteryVolts: doublePrecision("battery_volts"),
  fuelLevelPct: doublePrecision("fuel_level_pct"),
  stateOfChargePct: doublePrecision("state_of_charge_pct"),
  raw: jsonb("raw"),
}, (t) => ({
  vehicleTimeIdx: index("telemetry_vehicle_time_idx").on(t.vehicleId, t.recordedAt),
}));

export const dtcCodes = pgTable("dtc_codes", {
  ...base,
  code: varchar("code", { length: 12 }).notNull(),
  system: varchar("system", { length: 24 }),
  severity: integer("severity").notNull().default(3),
  driveable: boolean("driveable").notNull().default(true),
  description: text("description").notNull(),
}, (t) => ({ codeUq: uniqueIndex("dtc_code_uq").on(t.code) }));

export const dtcTranslations = pgTable("dtc_translations", {
  ...base,
  dtcId: uuid("dtc_id").notNull().references(() => dtcCodes.id),
  lang: varchar("lang", { length: 8 }).notNull(),
  plainText: text("plain_text").notNull(),
}, (t) => ({ uq: uniqueIndex("dtc_translation_uq").on(t.dtcId, t.lang) }));

export const diagnosticSessions = pgTable("diagnostic_sessions", {
  ...base,
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  userId: uuid("user_id").references(() => users.id),
  source: varchar("source", { length: 16 }).notNull(),   // obd | photo | symptom | sound
  symptomsText: text("symptoms_text"),
  ranOffline: boolean("ran_offline").notNull().default(false),
}, (t) => ({ vehicleIdx: index("diag_sessions_vehicle_idx").on(t.vehicleId) }));

export const diagnosticFindings = pgTable("diagnostic_findings", {
  ...base,
  sessionId: uuid("session_id").notNull().references(() => diagnosticSessions.id),
  cause: text("cause").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  severity: integer("severity").notNull(),
  driveable: boolean("driveable").notNull(),
  predictedParts: jsonb("predicted_parts"),
  modelVersion: varchar("model_version", { length: 40 }),
  usedFallback: boolean("used_fallback").notNull().default(false),
}, (t) => ({ sessionIdx: index("diag_findings_session_idx").on(t.sessionId) }));

export const fleets = pgTable("fleets", {
  ...base,
  name: varchar("name", { length: 120 }).notNull(),
  gstin: varchar("gstin", { length: 20 }),
  contactMsisdn: varchar("contact_msisdn", { length: 16 }),
  plan: varchar("plan", { length: 24 }).notNull().default("standard"),
});

export const fleetMembers = pgTable("fleet_members", {
  ...base,
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: varchar("role", { length: 24 }).notNull().default("driver"),
}, (t) => ({ uq: uniqueIndex("fleet_member_uq").on(t.fleetId, t.userId) }));
