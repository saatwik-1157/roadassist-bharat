-- Telegram alerts in the user's language (domain/telegram-i18n.ts).
-- telegram_link_codes.lang is the app language an invite was made in;
-- emergency_contacts.telegram_lang copies it when the invite links a chat, so
-- the bot's replies (/start, /stop, /help) are in that language. NULL on every
-- existing row means English, which is what those rows were answered in.
ALTER TABLE "emergency_contacts" ADD COLUMN "telegram_lang" varchar(8);--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD COLUMN "lang" varchar(8);