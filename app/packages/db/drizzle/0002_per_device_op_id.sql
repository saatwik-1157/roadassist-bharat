DROP INDEX "raksha_detections_op_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "raksha_detections_op_uq" ON "raksha_detections" USING btree ("device_id","op_id");