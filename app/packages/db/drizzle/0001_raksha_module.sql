CREATE TYPE "public"."raksha_detection_status" AS ENUM('DETECTED', 'VERIFIED', 'REJECTED', 'REPAIR_SCHEDULED', 'REPAIRED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."raksha_detection_type" AS ENUM('pothole', 'road_damage', 'obstruction');--> statement-breakpoint
CREATE TYPE "public"."raksha_device_status" AS ENUM('PROVISIONED', 'ACTIVE', 'DEGRADED', 'OFFLINE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "edge_device_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"device_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"battery_percent" integer,
	"storage_percent" integer,
	"temperature_c" double precision,
	"uptime_seconds" integer,
	"queue_depth" integer,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "edge_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(120) NOT NULL,
	"hardware_ref" varchar(80) DEFAULT 'SIMULATED' NOT NULL,
	"credential_hash" text NOT NULL,
	"firmware_version" varchar(40) DEFAULT 'sim-0.1.0' NOT NULL,
	"status" "raksha_device_status" DEFAULT 'PROVISIONED' NOT NULL,
	"battery_percent" integer,
	"storage_percent" integer,
	"last_seen_at" timestamp with time zone,
	"location" geometry(point),
	"zone_id" uuid,
	"registered_by" uuid NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raksha_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"device_id" uuid NOT NULL,
	"segment_id" uuid,
	"op_id" varchar(64) NOT NULL,
	"detection_type" "raksha_detection_type" NOT NULL,
	"confidence" double precision NOT NULL,
	"severity" integer NOT NULL,
	"status" "raksha_detection_status" DEFAULT 'DETECTED' NOT NULL,
	"location" geometry(point),
	"captured_at" timestamp with time zone NOT NULL,
	"ran_offline" boolean DEFAULT false NOT NULL,
	"image_ref" varchar(200),
	"model_version" varchar(40) NOT NULL,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"notes" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "road_health_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"segment_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"level" varchar(12) NOT NULL,
	"factors" jsonb NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"highway_ref" varchar(24),
	"km_start" double precision,
	"km_end" double precision,
	"length_km" double precision,
	"path" geometry
);
--> statement-breakpoint
ALTER TABLE "edge_device_telemetry" ADD CONSTRAINT "edge_device_telemetry_device_id_edge_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."edge_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_zone_id_service_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."service_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raksha_detections" ADD CONSTRAINT "raksha_detections_device_id_edge_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."edge_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raksha_detections" ADD CONSTRAINT "raksha_detections_segment_id_road_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."road_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raksha_detections" ADD CONSTRAINT "raksha_detections_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_health_scores" ADD CONSTRAINT "road_health_scores_segment_id_road_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."road_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edge_telemetry_device_time_idx" ON "edge_device_telemetry" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE INDEX "edge_devices_status_idx" ON "edge_devices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "edge_devices_seen_idx" ON "edge_devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raksha_detections_op_uq" ON "raksha_detections" USING btree ("op_id");--> statement-breakpoint
CREATE INDEX "raksha_detections_device_idx" ON "raksha_detections" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "raksha_detections_status_idx" ON "raksha_detections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "raksha_detections_segment_idx" ON "raksha_detections" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "road_health_segment_time_idx" ON "road_health_scores" USING btree ("segment_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "road_segments_code_uq" ON "road_segments" USING btree ("code");