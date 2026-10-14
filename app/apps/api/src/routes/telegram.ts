/**
 * Telegram linking for emergency contacts: the invite, and the bot's webhook.
 *
 * The flow, and the rule each step enforces:
 *
 *   1. The user asks for an invite for ONE of their contacts. The server makes
 *      a random code (domain/telegram.ts newLinkCode), stores only its SHA-256
 *      with a 7-day expiry, withdraws any older unused code for that contact,
 *      and returns https://t.me/<bot>?start=<code> once.
 *   2. The user sends that link to their contact however they like. The
 *      contact opens it and presses Start, which makes Telegram POST
 *      "/start <code>" to the webhook below.
 *   3. The webhook believes only a request carrying our secret in
 *      X-Telegram-Bot-Api-Secret-Token (set with setWebhook; see
 *      scripts/telegram-set-webhook.mjs). It claims the code with ONE
 *      conditional UPDATE (unused, unexpired, not withdrawn), so a replayed,
 *      expired or raced code links nothing, and stores the chat id on the
 *      contact. Only private chats are linked: a group would turn one person's
 *      emergency into a broadcast.
 *   4. "/stop" in that chat unlinks it from every contact entry it is on.
 *
 * Replies name the user by first name only, never by phone number.
 *
 * When the bot is not configured (env.telegram, all three variables), the
 * invite answers 404 telegram_disabled and the webhook 404, and the apps do
 * not show the button: GET /v1/me/emergency-contacts says enabled: false.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok } from "../http.js";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { limit } from "../ratelimit.js";
import { telegram } from "../providers.js";
import {
  MESSAGES, displayFirstName, hashLinkCode, inviteLink, linkCodeState, linkedMessage, newLinkCode,
  parseChatCommand, webhookSecretMatches,
} from "../domain/telegram.js";

/** What Telegram sends for a message; everything else in an update is ignored. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    text: z.string().max(4096).optional(),
    chat: z.object({
      // Up to 52 significant bits by Telegram's own guarantee, so a JS number is exact.
      id: z.number().int(),
      type: z.string().max(20),
    }),
  }).passthrough().optional(),
}).passthrough();

export async function telegramRoutes(app: FastifyInstance) {
  // ══ the invite ════════════════════════════════════════════════════════════
  app.post("/v1/me/emergency-contacts/:id/telegram-invite",
    { preHandler: [authenticate, limit("telegramInvite")] }, async (req, reply) => {
      if (!telegram.enabled) {
        return reply.code(404).send({ error: {
          code: "telegram_disabled", title: "Telegram alerts are not turned on for this server.",
          retryable: false, requestId: req.id } });
      }
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { code, hash, expiresAt } = newLinkCode();

      // Owner-scoped, like the delete next door: a contact id alone is not
      // authority, and another account's contact is simply not found.
      const made = await db.transaction(async (tx) => {
        const [contact] = await tx.select({ id: S.emergencyContacts.id, chat: S.emergencyContacts.telegramChatId })
          .from(S.emergencyContacts)
          .where(and(eq(S.emergencyContacts.id, id), eq(S.emergencyContacts.userId, req.user!.sub),
                     isNull(S.emergencyContacts.deletedAt)))
          .limit(1).for("update");
        if (!contact) return null;
        // One live invite per contact: a new link withdraws the old one, so a
        // link sent to the wrong person can be cancelled by making another.
        await tx.update(S.telegramLinkCodes).set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(S.telegramLinkCodes.contactId, id), isNull(S.telegramLinkCodes.usedAt),
                     isNull(S.telegramLinkCodes.deletedAt)));
        await tx.insert(S.telegramLinkCodes).values({ codeHash: hash, contactId: id, expiresAt });
        return contact;
      });
      if (!made) {
        return reply.code(404).send({ error: {
          code: "not_found", title: "Contact not found", retryable: false, requestId: req.id } });
      }
      await audit({
        actorId: req.user!.sub, actorRole: "citizen", action: "telegram.invite_created",
        entity: "emergency_contact", entityId: id, after: { expiresAt: expiresAt.toISOString() }, ip: req.ip,
      });
      return reply.code(201).send(ok({
        link: inviteLink(telegram.botUsername, code),
        expiresAt: expiresAt.toISOString(),
        linked: Boolean(made.chat),
      }, {
        note: "Send this link to your contact. It works once, for 7 days; making a new one cancels this one.",
      }));
    });

  // ══ the bot's webhook ═════════════════════════════════════════════════════
  app.post("/v1/telegram/webhook", async (req, reply) => {
    if (!telegram.enabled) {
      return reply.code(404).send({ error: { code: "not_found", title: "Not found", retryable: false, requestId: req.id } });
    }
    if (!webhookSecretMatches(req.headers["x-telegram-bot-api-secret-token"], env.telegram.webhookSecret)) {
      req.log.warn("telegram webhook refused: missing or wrong secret token");
      return reply.code(401).send({ error: {
        code: "unauthorized", title: "Not from Telegram", retryable: false, requestId: req.id } });
    }

    // From here on the request is Telegram's, and Telegram redelivers anything
    // that is not a 2xx: so every outcome below answers 200, including an
    // update we do not understand.
    const parsed = updateSchema.safeParse(req.body);
    const message = parsed.success ? parsed.data.message : undefined;
    const command = parseChatCommand(message?.text);
    if (!message || !command) return ok({ handled: false });

    const chatId = String(message.chat.id);
    const answer = async (text: string, outcome: string) => {
      const sent = await telegram.send(chatId, text, { deadlineMs: 5_000 });
      if (!sent.ok) req.log.error({ outcome, attempts: sent.attempts, reason: sent.error }, "telegram reply not delivered");
      return ok({ handled: true, outcome, replied: sent.ok });
    };

    if (message.chat.type !== "private") return answer(MESSAGES.notPrivate, "not_private");

    if (command.cmd === "help") return answer(MESSAGES.help, "help");

    if (command.cmd === "stop") {
      const unlinked = await db.update(S.emergencyContacts)
        .set({ telegramChatId: null, updatedAt: new Date() })
        .where(eq(S.emergencyContacts.telegramChatId, chatId))
        .returning({ id: S.emergencyContacts.id });
      for (const c of unlinked) {
        await audit({ actorRole: "telegram_contact", action: "telegram.unlinked",
                      entity: "emergency_contact", entityId: c.id, after: { via: "/stop" } });
      }
      return answer(unlinked.length ? MESSAGES.stopped : MESSAGES.stoppedNothing,
                    unlinked.length ? "unlinked" : "nothing_to_stop");
    }

    // /start
    if (!command.code) return answer(MESSAGES.noCode, "no_code");
    const hash = hashLinkCode(command.code);

    /**
     * The claim. Unused, unexpired and not withdrawn, in the WHERE of one
     * UPDATE: two Starts of the same link race on the row lock and exactly one
     * gets a row back. The contact must still exist, so a link made before the
     * contact was removed links nothing.
     */
    const linked = await db.transaction(async (tx) => {
      const [claim] = await tx.update(S.telegramLinkCodes)
        .set({ usedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(S.telegramLinkCodes.codeHash, hash), isNull(S.telegramLinkCodes.usedAt),
                   isNull(S.telegramLinkCodes.deletedAt), gt(S.telegramLinkCodes.expiresAt, raw`now()`)))
        .returning({ contactId: S.telegramLinkCodes.contactId });
      if (!claim) return null;
      const [contact] = await tx.update(S.emergencyContacts)
        .set({ telegramChatId: chatId, updatedAt: new Date() })
        .where(and(eq(S.emergencyContacts.id, claim.contactId), isNull(S.emergencyContacts.deletedAt)))
        .returning({ id: S.emergencyContacts.id, userId: S.emergencyContacts.userId });
      return contact ?? null;
    });

    if (!linked) {
      // Said the same way whatever the reason, so the reply is no oracle; the
      // log keeps the reason for whoever is debugging.
      const [row] = await db.select().from(S.telegramLinkCodes)
        .where(eq(S.telegramLinkCodes.codeHash, hash)).limit(1);
      req.log.info({ state: linkCodeState(row, new Date()) }, "telegram link code refused");
      return answer(MESSAGES.badCode, "refused");
    }

    const [owner] = await db.select({ fullName: S.users.fullName }).from(S.users)
      .where(eq(S.users.id, linked.userId)).limit(1);
    await audit({ actorRole: "telegram_contact", action: "telegram.linked",
                  entity: "emergency_contact", entityId: linked.id, after: { via: "/start" } });
    return answer(linkedMessage(displayFirstName(owner?.fullName)), "linked");
  });
}
