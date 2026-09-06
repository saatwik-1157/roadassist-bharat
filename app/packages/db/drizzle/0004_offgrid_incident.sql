ALTER TABLE "incidents" ADD COLUMN "client_incident_id" varchar(64);--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "emergency_type" varchar(24);--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_client_id_uq" ON "incidents" USING btree ("client_incident_id");
