-- Content dedup for model detections. The ingest route's idempotency key is
-- (device_id, op_id), so the same detection sent by a SECOND device was a new
-- row: `raksha-simulator.mjs --from-json` from a fresh device doubled the boot
-- seed's 34 detections, and a REJECTED detection re-sent by another credential
-- came back as a new incident. source_key is a sha256 of what the sighting is
-- (apps/api/src/domain/raksha-input.ts) and the route conflicts on it.
-- Nullable and additive: citizen reports, and every row before this migration,
-- keep NULL, which a unique index admits any number of. No backfill: existing
-- rows are left exactly as they were.
ALTER TABLE "raksha_detections" ADD COLUMN "source_key" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "raksha_detections_source_uq" ON "raksha_detections" USING btree ("source_key");
