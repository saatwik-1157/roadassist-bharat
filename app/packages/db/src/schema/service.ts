/** Bookings, dispatch, mechanics and money. The booking state machine lives here. */
import {
  boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { base, geoPoint } from "./_shared.js";
import { users } from "./identity.js";
import { vehicles } from "./fleet.js";

/** Guarded transitions are enforced in code; this enum is the storage contract. */
export const bookingStatusEnum = pgEnum("booking_status", [
  "DRAFT", "REQUESTED", "MATCHING", "NO_SUPPLY", "ASSIGNED", "EN_ROUTE", "ON_SITE",
  "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED", "COMPLETED", "PAID", "CANCELLED",
]);

export const offerStatusEnum = pgEnum("offer_status", [
  "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN",
]);

export const serviceTypes = pgTable("service_types", {
  ...base,
  code: varchar("code", { length: 40 }).notNull(),
  label: text("label").notNull(),
  baseFarePaise: integer("base_fare_paise").notNull(),
  perKmPaise: integer("per_km_paise").notNull().default(0),
  etaMinutes: integer("eta_minutes").notNull().default(30),
}, (t) => ({ codeUq: uniqueIndex("service_type_code_uq").on(t.code) }));

export const serviceZones = pgTable("service_zones", {
  ...base,
  name: varchar("name", { length: 120 }).notNull(),
  state: varchar("state", { length: 60 }),
  district: varchar("district", { length: 80 }),
  centre: geoPoint("centre"),
  radiusKm: doublePrecision("radius_km").notNull().default(25),
  active: boolean("active").notNull().default(true),
});

export const servicePartners = pgTable("service_partners", {
  ...base,
  name: varchar("name", { length: 140 }).notNull(),
  gstin: varchar("gstin", { length: 20 }),
  contactMsisdn: varchar("contact_msisdn", { length: 16 }),
  verified: boolean("verified").notNull().default(false),
});

export const mechanics = pgTable("mechanics", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  partnerId: uuid("partner_id").references(() => servicePartners.id),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  verified: boolean("verified").notNull().default(false),
  rating: doublePrecision("rating").notNull().default(0),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  isAvailable: boolean("is_available").notNull().default(false),
  lastLocation: geoPoint("last_location"),
  lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
  zoneId: uuid("zone_id").references(() => serviceZones.id),
}, (t) => ({
  userUq: uniqueIndex("mechanics_user_uq").on(t.userId),
  availIdx: index("mechanics_available_idx").on(t.isAvailable, t.verified),
  zoneIdx: index("mechanics_zone_idx").on(t.zoneId),
}));

export const mechanicSkills = pgTable("mechanic_skills", {
  ...base,
  mechanicId: uuid("mechanic_id").notNull().references(() => mechanics.id),
  serviceTypeId: uuid("service_type_id").notNull().references(() => serviceTypes.id),
  vehicleClass: varchar("vehicle_class", { length: 24 }).notNull(),
}, (t) => ({ uq: uniqueIndex("mechanic_skill_uq").on(t.mechanicId, t.serviceTypeId, t.vehicleClass) }));

export const inventoryItems = pgTable("inventory_items", {
  ...base,
  mechanicId: uuid("mechanic_id").notNull().references(() => mechanics.id),
  partCode: varchar("part_code", { length: 48 }).notNull(),
  partName: varchar("part_name", { length: 120 }).notNull(),
  quantity: integer("quantity").notNull().default(0),
  unitPricePaise: integer("unit_price_paise"),
}, (t) => ({ mechIdx: index("inventory_mechanic_idx").on(t.mechanicId) }));

export const bookings = pgTable("bookings", {
  ...base,
  reference: varchar("reference", { length: 16 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
  serviceTypeId: uuid("service_type_id").references(() => serviceTypes.id),
  mechanicId: uuid("mechanic_id").references(() => mechanics.id),
  status: bookingStatusEnum("status").notNull().default("DRAFT"),
  location: geoPoint("location"),
  addressText: text("address_text"),
  highwayMarker: varchar("highway_marker", { length: 40 }),   // "NH-48, KM 212"
  symptoms: text("symptoms"),
  quotedPaise: integer("quoted_paise"),
  finalPaise: integer("final_paise"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: varchar("cancel_reason", { length: 80 }),
  createdOffline: boolean("created_offline").notNull().default(false),
  clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }),
}, (t) => ({
  refUq: uniqueIndex("bookings_reference_uq").on(t.reference),
  userIdx: index("bookings_user_idx").on(t.userId),
  statusIdx: index("bookings_status_idx").on(t.status),
  mechIdx: index("bookings_mechanic_idx").on(t.mechanicId),
}));

/** Append-only history of every state transition — the audit trail for disputes. */
export const bookingEvents = pgTable("booking_events", {
  ...base,
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  fromStatus: bookingStatusEnum("from_status"),
  toStatus: bookingStatusEnum("to_status").notNull(),
  command: varchar("command", { length: 48 }).notNull(),
  actorId: uuid("actor_id"),
  actorRole: varchar("actor_role", { length: 24 }),
  meta: jsonb("meta"),
}, (t) => ({ bookingIdx: index("booking_events_booking_idx").on(t.bookingId, t.createdAt) }));

export const dispatchOffers = pgTable("dispatch_offers", {
  ...base,
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  mechanicId: uuid("mechanic_id").notNull().references(() => mechanics.id),
  status: offerStatusEnum("status").notNull().default("SENT"),
  rank: integer("rank").notNull(),
  score: doublePrecision("score"),
  distanceKm: doublePrecision("distance_km"),
  etaMinutes: integer("eta_minutes"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  usedFallback: boolean("used_fallback").notNull().default(false),
}, (t) => ({
  bookingIdx: index("offers_booking_idx").on(t.bookingId),
  mechIdx: index("offers_mechanic_idx").on(t.mechanicId, t.status),
}));

export const invoices = pgTable("invoices", {
  ...base,
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  number: varchar("number", { length: 24 }).notNull(),
  labourPaise: integer("labour_paise").notNull().default(0),
  partsPaise: integer("parts_paise").notNull().default(0),
  taxPaise: integer("tax_paise").notNull().default(0),
  totalPaise: integer("total_paise").notNull(),
  breakdown: jsonb("breakdown"),
}, (t) => ({ numUq: uniqueIndex("invoices_number_uq").on(t.number) }));

export const payments = pgTable("payments", {
  ...base,
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  method: varchar("method", { length: 16 }).notNull(),   // upi | card | cash | wallet
  amountPaise: integer("amount_paise").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  providerRef: varchar("provider_ref", { length: 80 }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, (t) => ({ invIdx: index("payments_invoice_idx").on(t.invoiceId) }));

export const reviews = pgTable("reviews", {
  ...base,
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  mechanicId: uuid("mechanic_id").notNull().references(() => mechanics.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
}, (t) => ({ bookingUq: uniqueIndex("reviews_booking_uq").on(t.bookingId) }));
