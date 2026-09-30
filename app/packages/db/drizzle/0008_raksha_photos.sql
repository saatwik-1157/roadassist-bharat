-- Citizen hazard-report photos in the database (ADR-0013). The hosted demo's
-- disk is wiped on every redeploy and there is no object-storage account, so a
-- PHOTO_STORE=db server keeps the bytes here: one row per detection, capped at
-- 600 KiB by a CHECK in migrate.ts. Additive: nothing existing reads or writes
-- it, and photos already on disk keep being served from disk.
CREATE TABLE "raksha_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"detection_id" uuid NOT NULL,
	"mime" varchar(32) NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raksha_photos" ADD CONSTRAINT "raksha_photos_detection_id_raksha_detections_id_fk" FOREIGN KEY ("detection_id") REFERENCES "public"."raksha_detections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raksha_photos_detection_uq" ON "raksha_photos" USING btree ("detection_id");
--> statement-breakpoint
-- JPEG, PNG and WebP are already compressed; EXTERNAL stores them out of line
-- without a pglz attempt that could only waste CPU.
ALTER TABLE "raksha_photos" ALTER COLUMN "bytes" SET STORAGE EXTERNAL;