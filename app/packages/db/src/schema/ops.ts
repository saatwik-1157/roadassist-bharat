/** Emergency, offline sync, government tenancy and the audit trail. */
import {
  boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { base, geoPoint } from "./_shared.js";
import { users } from "./identity.js";
import { vehicles } from "./fleet.js";
import { bookings } from "./service.js";

export const incidentSeverityEnum = pgEnum("incident_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const incidentStatusEnum = pgEnum("incident_status", [
  "DETECTED", "AWAITING_CONFIRMATION", "CONFIRMED", "CANCELLED", "RESPONDING", "RESOLVED",
]);

export const incidents = pgTable("incidents", {
  ...base,
  userId: uuid("user_id").references(() => users.id),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  status: incidentStatusEnum("status").notNull().default("DETECTED"),
  severity: incidentSeverityEnum("severity").notNull().default("HIGH"),
  location: geoPoint("location"),
  // The model raises a signal; it can never dispatch. Confirmation is recorded here.
  detectedByModel: boolean("detected_by_model").notNull().default(false),
  modelConfidence: doublePrecision("model_confidence"),
  confirmedBy: varchar("confirmed_by", { length: 24 }),   // user | callback | second_signal
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  handedOffTo112At: timestamp("handed_off_to_112_at", { withTimezone: true }),
  degradedPath: boolean("degraded_path").notNull().default(false),
}, (t) => ({
  statusIdx: index("incidents_status_idx").on(t.status),
  userIdx: index("incidents_user_idx").on(t.userId),
}));

export const incidentSignals = pgTable("incident_signals", {
  ...base,
  incidentId: uuid("incident_id").notNull().references(() => incidents.id),
  kind: varchar("kind", { length: 32 }).notNull(),   // accelerometer | manual | sms | callback
  payload: jsonb("payload"),
}, (t) => ({ incidentIdx: index("incident_signals_idx").on(t.incidentId) }));

export const responderUnits = pgTable("responder_units", {
  ...base,
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),   // ambulance | police | tow | partner
  msisdn: varchar("msisdn", { length: 16 }),
  lastLocation: geoPoint("last_location"),
  active: boolean("active").notNull().default(true),
});

export const incidentResponses = pgTable("incident_responses", {
  ...base,
  incidentId: uuid("incident_id").notNull().references(() => incidents.id),
  responderId: uuid("responder_id").references(() => responderUnits.id),
  step: varchar("step", { length: 32 }).notNull(),   // contacts | responder | ambulance | erss112
  notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull().defaultNow(),
  latencyMs: integer("latency_ms"),
  acknowledged: boolean("acknowledged").notNull().default(false),
}, (t) => ({ incidentIdx: index("incident_responses_idx").on(t.incidentId) }));

/** Break-glass reads of medical data. Append-only, user is notified afterwards. */
export const breakGlassAccess = pgTable("break_glass_access", {
  ...base,
  incidentId: uuid("incident_id").notNull().references(() => incidents.id),
  actorId: uuid("actor_id"),
  actorRole: varchar("actor_role", { length: 24 }).notNull(),
  reason: text("reason").notNull(),
  subjectUserId: uuid("subject_user_id").notNull().references(() => users.id),
  userNotifiedAt: timestamp("user_notified_at", { withTimezone: true }),
}, (t) => ({ incidentIdx: index("break_glass_incident_idx").on(t.incidentId) }));

/** Offline-first: queued client operations replayed on reconnect. */
export const syncOperations = pgTable("sync_operations", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  deviceId: uuid("device_id"),
  opId: varchar("op_id", { length: 64 }).notNull(),      // client-generated, idempotency key
  entity: varchar("entity", { length: 40 }).notNull(),
  entityId: uuid("entity_id"),
  operation: varchar("operation", { length: 16 }).notNull(),   // create | update | delete
  payload: jsonb("payload").notNull(),
  clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
}, (t) => ({
  opUq: uniqueIndex("sync_op_uq").on(t.opId),
  userIdx: index("sync_ops_user_idx").on(t.userId, t.appliedAt),
}));

export const conflictLog = pgTable("conflict_log", {
  ...base,
  syncOperationId: uuid("sync_operation_id").notNull().references(() => syncOperations.id),
  entity: varchar("entity", { length: 40 }).notNull(),
  field: varchar("field", { length: 60 }).notNull(),
  rule: varchar("rule", { length: 32 }).notNull(),   // server_wins | lww | max | merge | user
  serverValue: jsonb("server_value"),
  clientValue: jsonb("client_value"),
  resolvedValue: jsonb("resolved_value"),
});

export const govJurisdictions = pgTable("gov_jurisdictions", {
  ...base,
  name: varchar("name", { length: 120 }).notNull(),
  level: varchar("level", { length: 16 }).notNull(),   // national | state | district
  parentId: uuid("parent_id"),
  code: varchar("code", { length: 24 }).notNull(),
}, (t) => ({ codeUq: uniqueIndex("gov_jurisdiction_code_uq").on(t.code) }));

export const govOfficers = pgTable("gov_officers", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  jurisdictionId: uuid("jurisdiction_id").notNull().references(() => govJurisdictions.id),
  designation: varchar("designation", { length: 80 }),
  certificateSerial: varchar("certificate_serial", { length: 80 }),
}, (t) => ({ userUq: uniqueIndex("gov_officer_user_uq").on(t.userId) }));

/** Every government query is logged with a purpose code (re-identification defence). */
export const govQueries = pgTable("gov_queries", {
  ...base,
  officerId: uuid("officer_id").notNull().references(() => govOfficers.id),
  endpoint: varchar("endpoint", { length: 120 }).notNull(),
  purposeCode: varchar("purpose_code", { length: 40 }).notNull(),
  params: jsonb("params"),
  rowsReturned: integer("rows_returned"),
  suppressedCells: integer("suppressed_cells").notNull().default(0),
}, (t) => ({ officerIdx: index("gov_queries_officer_idx").on(t.officerId, t.createdAt) }));

/** Tamper-evident: each row stores the hash of the previous row. */
export const auditLog = pgTable("audit_log", {
  ...base,
  actorId: uuid("actor_id"),
  actorRole: varchar("actor_role", { length: 24 }),
  action: varchar("action", { length: 64 }).notNull(),
  entity: varchar("entity", { length: 40 }).notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: varchar("ip", { length: 45 }),
  prevHash: varchar("prev_hash", { length: 64 }),
  hash: varchar("hash", { length: 64 }).notNull(),
}, (t) => ({
  entityIdx: index("audit_entity_idx").on(t.entity, t.entityId),
  createdIdx: index("audit_created_idx").on(t.createdAt),
}));

/** Every model call is logged: version, confidence, and whether the fallback ran. */
export const modelPredictions = pgTable("model_predictions", {
  ...base,
  capability: varchar("capability", { length: 40 }).notNull(),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  confidence: doublePrecision("confidence"),
  latencyMs: integer("latency_ms"),
  usedFallback: boolean("used_fallback").notNull().default(false),
  subjectId: uuid("subject_id"),
}, (t) => ({ capIdx: index("model_predictions_cap_idx").on(t.capability, t.createdAt) }));

export const outboxEvents = pgTable("outbox_events", {
  ...base,
  topic: varchar("topic", { length: 80 }).notNull(),
  key: varchar("key", { length: 80 }),
  payload: jsonb("payload").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
}, (t) => ({ pendingIdx: index("outbox_pending_idx").on(t.publishedAt, t.createdAt) }));

export const idempotencyKeys = pgTable("idempotency_keys", {
  ...base,
  key: varchar("key", { length: 80 }).notNull(),
  userId: uuid("user_id"),
  endpoint: varchar("endpoint", { length: 120 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
}, (t) => ({ keyUq: uniqueIndex("idempotency_key_uq").on(t.key, t.endpoint) }));
