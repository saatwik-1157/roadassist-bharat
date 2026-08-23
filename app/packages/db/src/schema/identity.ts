/** Auth + user identity. Module 6 (IAM, SSO) and DPDP consent live here. */
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { base } from "./_shared.js";

export const roleEnum = pgEnum("role_name", [
  "citizen", "mechanic", "fleet_admin", "fleet_driver", "gov_officer", "support", "admin",
]);

export const users = pgTable("users", {
  ...base,
  msisdn: varchar("msisdn", { length: 16 }).notNull(),
  fullName: varchar("full_name", { length: 120 }),
  email: varchar("email", { length: 160 }),
  preferredLanguage: varchar("preferred_language", { length: 8 }).notNull().default("en"),
  isVerified: boolean("is_verified").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => ({
  msisdnUq: uniqueIndex("users_msisdn_uq").on(t.msisdn),
  emailIdx: index("users_email_idx").on(t.email),
}));

export const otpChallenges = pgTable("otp_challenges", {
  ...base,
  msisdn: varchar("msisdn", { length: 16 }).notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  channel: varchar("channel", { length: 12 }).notNull().default("sms"),
}, (t) => ({
  msisdnIdx: index("otp_msisdn_idx").on(t.msisdn, t.expiresAt),
}));

export const devices = pgTable("devices", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  model: varchar("model", { length: 80 }),
  pushToken: text("push_token"),
}, (t) => ({
  userIdx: index("devices_user_idx").on(t.userId),
  fpUq: uniqueIndex("devices_fp_uq").on(t.userId, t.fingerprint),
}));

export const sessions = pgTable("sessions", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  deviceId: uuid("device_id").references(() => devices.id),
  // Rotating refresh tokens: reuse of a consumed token revokes the whole family.
  familyId: uuid("family_id").notNull(),
  refreshHash: text("refresh_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: varchar("revoked_reason", { length: 40 }),
  ip: varchar("ip", { length: 45 }),
  userAgent: text("user_agent"),
}, (t) => ({
  userIdx: index("sessions_user_idx").on(t.userId),
  familyIdx: index("sessions_family_idx").on(t.familyId),
  refreshIdx: uniqueIndex("sessions_refresh_uq").on(t.refreshHash),
}));

export const roles = pgTable("roles", {
  ...base,
  name: roleEnum("name").notNull(),
  description: text("description"),
}, (t) => ({ nameUq: uniqueIndex("roles_name_uq").on(t.name) }));

export const permissions = pgTable("permissions", {
  ...base,
  code: varchar("code", { length: 64 }).notNull(),   // e.g. booking:cancel
  description: text("description"),
}, (t) => ({ codeUq: uniqueIndex("permissions_code_uq").on(t.code) }));

export const rolePermissions = pgTable("role_permissions", {
  ...base,
  roleId: uuid("role_id").notNull().references(() => roles.id),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id),
}, (t) => ({ uq: uniqueIndex("role_perm_uq").on(t.roleId, t.permissionId) }));

export const userRoles = pgTable("user_roles", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  scopeId: uuid("scope_id"),                          // fleet or jurisdiction scope
}, (t) => ({ uq: uniqueIndex("user_role_uq").on(t.userId, t.roleId) }));

/** DPDP Act 2023: purpose-scoped, versioned, withdrawable. */
export const consentPurposes = pgTable("consent_purposes", {
  ...base,
  code: varchar("code", { length: 48 }).notNull(),
  label: text("label").notNull(),
  policyVersion: varchar("policy_version", { length: 16 }).notNull(),
  required: boolean("required").notNull().default(false),
}, (t) => ({ codeUq: uniqueIndex("consent_purpose_uq").on(t.code, t.policyVersion) }));

export const consents = pgTable("consents", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  purposeId: uuid("purpose_id").notNull().references(() => consentPurposes.id),
  granted: boolean("granted").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
}, (t) => ({ userIdx: index("consents_user_idx").on(t.userId) }));

export const emergencyContacts = pgTable("emergency_contacts", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 120 }).notNull(),
  msisdn: varchar("msisdn", { length: 16 }).notNull(),
  relation: varchar("relation", { length: 40 }),
  priority: integer("priority").notNull().default(1),
}, (t) => ({ userIdx: index("emg_contacts_user_idx").on(t.userId) }));

/** Column-level encrypted at rest; break-glass access only, always audited. */
export const medicalProfiles = pgTable("medical_profiles", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  bloodGroup: varchar("blood_group", { length: 8 }),
  allergies: text("allergies"),
  conditions: text("conditions"),
  medications: text("medications"),
}, (t) => ({ userUq: uniqueIndex("medical_user_uq").on(t.userId) }));

export const notificationChannels = pgTable("notification_channels", {
  ...base,
  userId: uuid("user_id").notNull().references(() => users.id),
  channel: varchar("channel", { length: 16 }).notNull(),  // push | sms | whatsapp | ivr
  address: text("address").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  meta: jsonb("meta"),
}, (t) => ({ userIdx: index("notif_channel_user_idx").on(t.userId) }));
