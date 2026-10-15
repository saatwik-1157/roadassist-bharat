-- Sign in with Google (routes/google-auth.ts). An account is matched on Google's
-- stable subject id only (users.google_sub, unique), never on the email; the
-- address Google verified is kept beside it so Settings can name the linked
-- account. users.msisdn becomes nullable: a Google sign-up has no phone until its
-- owner verifies one by OTP. Every existing row keeps its number, and the unique
-- index on msisdn still holds (Postgres admits many NULLs under it).
-- google_auth_nonces holds the SHA-256 of each sign-in nonce, used once.
CREATE TABLE "google_auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"nonce_hash" varchar(64) NOT NULL,
	"purpose" varchar(8) NOT NULL,
	"link_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "msisdn" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_email" varchar(160);--> statement-breakpoint
ALTER TABLE "google_auth_nonces" ADD CONSTRAINT "google_auth_nonces_link_user_id_users_id_fk" FOREIGN KEY ("link_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_auth_nonces_hash_uq" ON "google_auth_nonces" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "google_auth_nonces_expires_idx" ON "google_auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");