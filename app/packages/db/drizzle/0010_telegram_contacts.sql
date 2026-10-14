-- Free Telegram alerts for emergency contacts (routes/telegram.ts). A contact
-- opens a one-time invite link and presses Start; the webhook stores their
-- private chat id on the contact. Only the SHA-256 of each invite code is kept,
-- with a 7-day expiry and a used_at stamped once. Additive: the new column is
-- nullable and nothing existing reads or writes either object.
CREATE TABLE "telegram_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"contact_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD COLUMN "telegram_chat_id" varchar(32);--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_contact_id_emergency_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."emergency_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_codes_hash_uq" ON "telegram_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_link_codes_contact_idx" ON "telegram_link_codes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "emg_contacts_tg_chat_idx" ON "emergency_contacts" USING btree ("telegram_chat_id");