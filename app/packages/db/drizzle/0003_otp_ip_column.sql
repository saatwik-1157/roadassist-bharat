ALTER TABLE "otp_challenges" ADD COLUMN "ip" varchar(45);--> statement-breakpoint
CREATE INDEX "otp_ip_idx" ON "otp_challenges" USING btree ("ip","created_at");