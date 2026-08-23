CREATE TYPE "public"."fuel_type" AS ENUM('petrol', 'diesel', 'cng', 'lpg', 'electric', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."vehicle_class" AS ENUM('car', 'motorcycle', 'scooter', 'auto_rickshaw', 'truck', 'bus', 'tractor', 'ev');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('citizen', 'mechanic', 'fleet_admin', 'fleet_driver', 'gov_officer', 'support', 'admin');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('DETECTED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'RESPONDING', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('DRAFT', 'REQUESTED', 'MATCHING', 'NO_SUPPLY', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'AWAITING_PARTS', 'ESCALATED', 'COMPLETED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "diagnostic_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"session_id" uuid NOT NULL,
	"cause" text NOT NULL,
	"confidence" double precision NOT NULL,
	"severity" integer NOT NULL,
	"driveable" boolean NOT NULL,
	"predicted_parts" jsonb,
	"model_version" varchar(40),
	"used_fallback" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid,
	"source" varchar(16) NOT NULL,
	"symptoms_text" text,
	"ran_offline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dtc_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(12) NOT NULL,
	"system" varchar(24),
	"severity" integer DEFAULT 3 NOT NULL,
	"driveable" boolean DEFAULT true NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dtc_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"dtc_id" uuid NOT NULL,
	"lang" varchar(8) NOT NULL,
	"plain_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"fleet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(24) DEFAULT 'driver' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"gstin" varchar(20),
	"contact_msisdn" varchar(16),
	"plan" varchar(24) DEFAULT 'standard' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"serviced_on" timestamp with time zone NOT NULL,
	"odometer_km" integer,
	"summary" text,
	"cost_paise" integer
);
--> statement-breakpoint
CREATE TABLE "user_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"relationship" varchar(16) DEFAULT 'owner' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"doc_type" varchar(24) NOT NULL,
	"object_key" text NOT NULL,
	"expires_on" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"make" varchar(60) NOT NULL,
	"model" varchar(80) NOT NULL,
	"year_from" integer,
	"year_to" integer,
	"vehicle_class" "vehicle_class" NOT NULL,
	"fuel" "fuel_type",
	"has_obd" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"speed_kph" double precision,
	"engine_temp_c" double precision,
	"battery_volts" double precision,
	"fuel_level_pct" double precision,
	"state_of_charge_pct" double precision,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"model_id" uuid,
	"registration_no" varchar(16) NOT NULL,
	"nickname" varchar(60),
	"odometer_km" integer DEFAULT 0 NOT NULL,
	"vehicle_class" "vehicle_class" NOT NULL,
	"fuel" "fuel_type",
	"fleet_id" uuid
);
--> statement-breakpoint
CREATE TABLE "consent_purposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(48) NOT NULL,
	"label" text NOT NULL,
	"policy_version" varchar(16) NOT NULL,
	"required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose_id" uuid NOT NULL,
	"granted" boolean NOT NULL,
	"granted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"model" varchar(80),
	"push_token" text
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"msisdn" varchar(16) NOT NULL,
	"relation" varchar(40),
	"priority" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"blood_group" varchar(8),
	"allergies" text,
	"conditions" text,
	"medications" text
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"address" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"msisdn" varchar(16) NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"channel" varchar(12) DEFAULT 'sms' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" "role_name" NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"family_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(40),
	"ip" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"msisdn" varchar(16) NOT NULL,
	"full_name" varchar(120),
	"email" varchar(160),
	"preferred_language" varchar(8) DEFAULT 'en' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(24),
	"action" varchar(64) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(45),
	"prev_hash" varchar(64),
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(24) NOT NULL,
	"reason" text NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"user_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conflict_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"sync_operation_id" uuid NOT NULL,
	"entity" varchar(40) NOT NULL,
	"field" varchar(60) NOT NULL,
	"rule" varchar(32) NOT NULL,
	"server_value" jsonb,
	"client_value" jsonb,
	"resolved_value" jsonb
);
--> statement-breakpoint
CREATE TABLE "gov_jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"level" varchar(16) NOT NULL,
	"parent_id" uuid,
	"code" varchar(24) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gov_officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"designation" varchar(80),
	"certificate_serial" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "gov_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"officer_id" uuid NOT NULL,
	"endpoint" varchar(120) NOT NULL,
	"purpose_code" varchar(40) NOT NULL,
	"params" jsonb,
	"rows_returned" integer,
	"suppressed_cells" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"key" varchar(80) NOT NULL,
	"user_id" uuid,
	"endpoint" varchar(120) NOT NULL,
	"response_status" integer,
	"response_body" jsonb
);
--> statement-breakpoint
CREATE TABLE "incident_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"incident_id" uuid NOT NULL,
	"responder_id" uuid,
	"step" varchar(32) NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latency_ms" integer,
	"acknowledged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid,
	"vehicle_id" uuid,
	"booking_id" uuid,
	"status" "incident_status" DEFAULT 'DETECTED' NOT NULL,
	"severity" "incident_severity" DEFAULT 'HIGH' NOT NULL,
	"location" geometry(point),
	"detected_by_model" boolean DEFAULT false NOT NULL,
	"model_confidence" double precision,
	"confirmed_by" varchar(24),
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"handed_off_to_112_at" timestamp with time zone,
	"degraded_path" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"capability" varchar(40) NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"confidence" double precision,
	"latency_ms" integer,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"subject_id" uuid
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"topic" varchar(80) NOT NULL,
	"key" varchar(80),
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responder_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"msisdn" varchar(16),
	"last_location" geometry(point),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"op_id" varchar(64) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"operation" varchar(16) NOT NULL,
	"payload" jsonb NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"rejected_reason" text
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"command" varchar(48) NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(24),
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"reference" varchar(16) NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"service_type_id" uuid,
	"mechanic_id" uuid,
	"status" "booking_status" DEFAULT 'DRAFT' NOT NULL,
	"location" geometry(point),
	"address_text" text,
	"highway_marker" varchar(40),
	"symptoms" text,
	"quoted_paise" integer,
	"final_paise" integer,
	"requested_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(80),
	"created_offline" boolean DEFAULT false NOT NULL,
	"client_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispatch_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"booking_id" uuid NOT NULL,
	"mechanic_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'SENT' NOT NULL,
	"rank" integer NOT NULL,
	"score" double precision,
	"distance_km" double precision,
	"eta_minutes" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"used_fallback" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"mechanic_id" uuid NOT NULL,
	"part_code" varchar(48) NOT NULL,
	"part_name" varchar(120) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit_price_paise" integer
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"booking_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"labour_paise" integer DEFAULT 0 NOT NULL,
	"parts_paise" integer DEFAULT 0 NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"breakdown" jsonb
);
--> statement-breakpoint
CREATE TABLE "mechanic_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"mechanic_id" uuid NOT NULL,
	"service_type_id" uuid NOT NULL,
	"vehicle_class" varchar(24) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mechanics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid,
	"display_name" varchar(120) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"rating" double precision DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"is_available" boolean DEFAULT false NOT NULL,
	"last_location" geometry(point),
	"last_location_at" timestamp with time zone,
	"zone_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" varchar(16) NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"provider_ref" varchar(80),
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mechanic_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "service_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(140) NOT NULL,
	"gstin" varchar(20),
	"contact_msisdn" varchar(16),
	"verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(40) NOT NULL,
	"label" text NOT NULL,
	"base_fare_paise" integer NOT NULL,
	"per_km_paise" integer DEFAULT 0 NOT NULL,
	"eta_minutes" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"state" varchar(60),
	"district" varchar(80),
	"centre" geometry(point),
	"radius_km" double precision DEFAULT 25 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostic_findings" ADD CONSTRAINT "diagnostic_findings_session_id_diagnostic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."diagnostic_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dtc_translations" ADD CONSTRAINT "dtc_translations_dtc_id_dtc_codes_id_fk" FOREIGN KEY ("dtc_id") REFERENCES "public"."dtc_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_members" ADD CONSTRAINT "fleet_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_id_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_purpose_id_consent_purposes_id_fk" FOREIGN KEY ("purpose_id") REFERENCES "public"."consent_purposes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_profiles" ADD CONSTRAINT "medical_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_access" ADD CONSTRAINT "break_glass_access_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_access" ADD CONSTRAINT "break_glass_access_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_log" ADD CONSTRAINT "conflict_log_sync_operation_id_sync_operations_id_fk" FOREIGN KEY ("sync_operation_id") REFERENCES "public"."sync_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov_officers" ADD CONSTRAINT "gov_officers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov_officers" ADD CONSTRAINT "gov_officers_jurisdiction_id_gov_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."gov_jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gov_queries" ADD CONSTRAINT "gov_queries_officer_id_gov_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."gov_officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_responses" ADD CONSTRAINT "incident_responses_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_responses" ADD CONSTRAINT "incident_responses_responder_id_responder_units_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."responder_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_signals" ADD CONSTRAINT "incident_signals_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanic_skills" ADD CONSTRAINT "mechanic_skills_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanic_skills" ADD CONSTRAINT "mechanic_skills_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_partner_id_service_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."service_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_zone_id_service_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diag_findings_session_idx" ON "diagnostic_findings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "diag_sessions_vehicle_idx" ON "diagnostic_sessions" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dtc_code_uq" ON "dtc_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "dtc_translation_uq" ON "dtc_translations" USING btree ("dtc_id","lang");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_member_uq" ON "fleet_members" USING btree ("fleet_id","user_id");--> statement-breakpoint
CREATE INDEX "service_records_vehicle_idx" ON "service_records" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_vehicle_uq" ON "user_vehicles" USING btree ("user_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "user_vehicles_user_idx" ON "user_vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_docs_vehicle_idx" ON "vehicle_documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_models_make_model_idx" ON "vehicle_models" USING btree ("make","model");--> statement-breakpoint
CREATE INDEX "telemetry_vehicle_time_idx" ON "vehicle_telemetry" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_reg_uq" ON "vehicles" USING btree ("registration_no");--> statement-breakpoint
CREATE INDEX "vehicles_fleet_idx" ON "vehicles" USING btree ("fleet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_purpose_uq" ON "consent_purposes" USING btree ("code","policy_version");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_fp_uq" ON "devices" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "emg_contacts_user_idx" ON "emergency_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medical_user_uq" ON "medical_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_channel_user_idx" ON "notification_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_msisdn_idx" ON "otp_challenges" USING btree ("msisdn","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_uq" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "role_perm_uq" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_uq" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_uq" ON "sessions" USING btree ("refresh_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_uq" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_msisdn_uq" ON "users" USING btree ("msisdn");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "break_glass_incident_idx" ON "break_glass_access" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gov_jurisdiction_code_uq" ON "gov_jurisdictions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "gov_officer_user_uq" ON "gov_officers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gov_queries_officer_idx" ON "gov_queries" USING btree ("officer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_uq" ON "idempotency_keys" USING btree ("key","endpoint");--> statement-breakpoint
CREATE INDEX "incident_responses_idx" ON "incident_responses" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incident_signals_idx" ON "incident_signals" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_user_idx" ON "incidents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "model_predictions_cap_idx" ON "model_predictions" USING btree ("capability","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_op_uq" ON "sync_operations" USING btree ("op_id");--> statement-breakpoint
CREATE INDEX "sync_ops_user_idx" ON "sync_operations" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reference_uq" ON "bookings" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_mechanic_idx" ON "bookings" USING btree ("mechanic_id");--> statement-breakpoint
CREATE INDEX "offers_booking_idx" ON "dispatch_offers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "offers_mechanic_idx" ON "dispatch_offers" USING btree ("mechanic_id","status");--> statement-breakpoint
CREATE INDEX "inventory_mechanic_idx" ON "inventory_items" USING btree ("mechanic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "mechanic_skill_uq" ON "mechanic_skills" USING btree ("mechanic_id","service_type_id","vehicle_class");--> statement-breakpoint
CREATE UNIQUE INDEX "mechanics_user_uq" ON "mechanics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mechanics_available_idx" ON "mechanics" USING btree ("is_available","verified");--> statement-breakpoint
CREATE INDEX "mechanics_zone_idx" ON "mechanics" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_uq" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_type_code_uq" ON "service_types" USING btree ("code");