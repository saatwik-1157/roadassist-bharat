-- STOP on the SMS line used to reply "you will receive no further messages" and
-- store nothing. This is where the opt-out now lives: one row per number (not
-- per user, since an emergency contact is usually not a user), active while
-- opted_back_in_at is NULL. Additive: nothing existing reads or writes it.
CREATE TABLE "sms_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"msisdn" varchar(16) NOT NULL,
	"keyword" varchar(16) NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opted_back_in_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_outs_msisdn_uq" ON "sms_opt_outs" USING btree ("msisdn");