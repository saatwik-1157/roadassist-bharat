/**
 * RAKSHA — autonomous remote road & infrastructure monitoring (ADR-0007).
 *
 * Edge devices detect road problems where nobody is watching, queue them
 * offline, and sync idempotently. Devices are authenticated principals
 * (ADR-0008); detections follow the model-governance conventions (ADR-0006)
 * and can only ever raise incident *signals*, never dispatch (ADR-0005).
 */
import {
  boolean, customType, doublePrecision, index, integer, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { base, geoPoint } from "./_shared.js";
import { users } from "./identity.js";
import { serviceZones } from "./service.js";

export const rakshaDeviceStatusEnum = pgEnum("raksha_device_status", [
  "PROVISIONED", "ACTIVE", "DEGRADED", "OFFLINE", "RETIRED",
]);
export const rakshaDetectionTypeEnum = pgEnum("raksha_detection_type", [
  "pothole", "road_damage", "obstruction",
]);
export const rakshaDetectionStatusEnum = pgEnum("raksha_detection_status", [
  "DETECTED", "VERIFIED", "REJECTED", "REPAIR_SCHEDULED", "REPAIRED", "CLOSED",
]);

/**
 * PostGIS LineString. Emitted as bare `geometry` (a parenthesised dataType is
 * quoted by drizzle-kit and breaks the migration — see geoPoint's note); the
 * SRID + subtype are pinned to geometry(LineString,4326) in migrate.ts, same
 * two-phase approach the point columns use. Always read via ST_AsGeoJSON.
 */
const lineGeometry = customType<{ data: string; driverData: string }>({
  dataType() { return "geometry"; },
});
export const geoLine = (name: string) => lineGeometry(name);

/**
 * The RAKSHA hardware fleet. NOT the `devices` table — that name already
 * means a user's phone in the identity module.
 */
export const edgeDevices = pgTable("edge_devices", {
  ...base,
  name: varchar("name", { length: 120 }).notNull(),
  hardwareRef: varchar("hardware_ref", { length: 80 }).notNull().default("SIMULATED"),
  /** SHA-256 of the one-time registration secret. The secret itself is never stored. */
  credentialHash: text("credential_hash").notNull(),
  firmwareVersion: varchar("firmware_version", { length: 40 }).notNull().default("sim-0.1.0"),
  status: rakshaDeviceStatusEnum("status").notNull().default("PROVISIONED"),
  batteryPercent: integer("battery_percent"),
  storagePercent: integer("storage_percent"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  location: geoPoint("location"),
  zoneId: uuid("zone_id").references(() => serviceZones.id),
  registeredBy: uuid("registered_by").notNull().references(() => users.id),
  /** Honest labeling: true until a real hardware deployment flips it. */
  simulated: boolean("simulated").notNull().default(true),
}, (t) => ({
  statusIdx: index("edge_devices_status_idx").on(t.status),
  seenIdx: index("edge_devices_seen_idx").on(t.lastSeenAt),
}));

/** A monitored stretch of road, dual-referenced: geometry + linear marker. */
export const roadSegments = pgTable("road_segments", {
  ...base,
  code: varchar("code", { length: 40 }).notNull(),        // e.g. NH48-K205-K210
  name: varchar("name", { length: 120 }).notNull(),
  highwayRef: varchar("highway_ref", { length: 24 }),      // e.g. NH-48
  kmStart: doublePrecision("km_start"),
  kmEnd: doublePrecision("km_end"),
  lengthKm: doublePrecision("length_km"),
  path: geoLine("path"),                                   // geometry(LineString,4326), pinned in migrate.ts
}, (t) => ({
  codeUq: uniqueIndex("road_segments_code_uq").on(t.code),
}));

/** One autonomous detection. Idempotent on the device-generated op_id. */
export const rakshaDetections = pgTable("raksha_detections", {
  ...base,
  deviceId: uuid("device_id").notNull().references(() => edgeDevices.id),
  segmentId: uuid("segment_id").references(() => roadSegments.id),
  /**
   * Device-generated idempotency key — replaying a queued batch is a no-op.
   * Scoped per device: one device's op ids can never collide with (or censor)
   * another's, so uniqueness is on (device_id, op_id), never op_id alone.
   */
  opId: varchar("op_id", { length: 64 }).notNull(),
  detectionType: rakshaDetectionTypeEnum("detection_type").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  severity: integer("severity").notNull(),                 // 1..5, CHECK in migrate.ts
  status: rakshaDetectionStatusEnum("status").notNull().default("DETECTED"),
  location: geoPoint("location"),
  /**
   * Radius in metres the reporting phone gave for `location` (the Geolocation
   * API's coords.accuracy), normalised by the API. NULL means no radius was
   * measured — every report before 0005, and every device sighting — and is
   * shown as "accuracy not reported", never filled with an estimate.
   */
  locationAccuracyM: doublePrecision("location_accuracy_m"),
  /** Device clock at capture — preserved verbatim; created_at is server truth. */
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  ranOffline: boolean("ran_offline").notNull().default(false),
  /** Reference only (object-storage key / URL). Raw frames never enter the DB. */
  imageRef: varchar("image_ref", { length: 200 }),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  usedFallback: boolean("used_fallback").notNull().default(false),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  notes: text("notes"),
  raw: jsonb("raw"),
  /**
   * What the sighting IS, independent of the device that sent it: a sha256 of
   * the model, frame and detection (apps/api/src/domain/raksha-input.ts).
   * op_id dedups one device's replays; this dedups the same detection sent by
   * a second device, and keeps a REJECTED one rejected when it is re-sent.
   * NULL for citizen reports and for every row before 0009.
   */
  sourceKey: varchar("source_key", { length: 64 }),
}, (t) => ({
  opUq: uniqueIndex("raksha_detections_op_uq").on(t.deviceId, t.opId),
  sourceUq: uniqueIndex("raksha_detections_source_uq").on(t.sourceKey),
  deviceIdx: index("raksha_detections_device_idx").on(t.deviceId, t.createdAt),
  statusIdx: index("raksha_detections_status_idx").on(t.status),
  segmentIdx: index("raksha_detections_segment_idx").on(t.segmentId),
}));

/** Postgres bytea. drizzle-orm 0.45 has no built-in for it; postgres.js hands back a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

/**
 * A citizen report's photo, held in the database when PHOTO_STORE=db
 * (ADR-0013, which amends the "only a reference in the database" rule).
 *
 * One row per detection. The detection's image_ref then reads
 * `db:hazards/<id>.<ext>`, so the photo route knows which store to ask. A
 * device's image_ref is never one of these: device ingestion stores whatever
 * the device sent, and a device-supplied `db:` string only ever finds its own
 * detection's (absent) row.
 *
 * The size cap is a CHECK in migrate.ts (octet_length ≤ 600 KiB), backing the
 * API's own refusal (apps/api/src/domain/photo-store.ts). A rejected report's
 * row is DELETEd, not soft-deleted: the point of rejecting is to stop holding
 * the bytes, and deleted_at would keep every one of them.
 */
export const rakshaPhotos = pgTable("raksha_photos", {
  ...base,
  detectionId: uuid("detection_id").notNull().references(() => rakshaDetections.id),
  mime: varchar("mime", { length: 32 }).notNull(),
  bytes: bytea("bytes").notNull(),
}, (t) => ({
  detectionUq: uniqueIndex("raksha_photos_detection_uq").on(t.detectionId),
}));

/** Device health over time (battery, storage, queue) — fleet observability. */
export const edgeDeviceTelemetry = pgTable("edge_device_telemetry", {
  ...base,
  deviceId: uuid("device_id").notNull().references(() => edgeDevices.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  batteryPercent: integer("battery_percent"),
  storagePercent: integer("storage_percent"),
  temperatureC: doublePrecision("temperature_c"),
  uptimeSeconds: integer("uptime_seconds"),
  queueDepth: integer("queue_depth"),
  raw: jsonb("raw"),
}, (t) => ({
  deviceTimeIdx: index("edge_telemetry_device_time_idx").on(t.deviceId, t.recordedAt),
}));

/** Transparent 0–100 score per segment. Factors show exactly why (Phase 8). */
export const roadHealthScores = pgTable("road_health_scores", {
  ...base,
  segmentId: uuid("segment_id").notNull().references(() => roadSegments.id),
  score: integer("score").notNull(),                       // 0..100, CHECK in migrate.ts
  level: varchar("level", { length: 12 }).notNull(),       // good | fair | poor | critical
  factors: jsonb("factors").notNull(),
  windowDays: integer("window_days").notNull().default(30),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  segmentTimeIdx: index("road_health_segment_time_idx").on(t.segmentId, t.computedAt),
}));
