/**
 * Send an SOS alert to every emergency contact who linked a Telegram chat.
 *
 * Shared by the two places a confirmed SOS alerts contacts — the app's
 * POST /v1/sos/:id/confirm (routes/emergency.ts) and the feature-phone SMS
 * path (routes/telecom.ts) — so the message and the counting are one thing.
 * Each caller has already won the escalation claim and passed the per-owner
 * sosAlerts ceiling, so nothing here decides WHETHER to alert, only how.
 *
 * Never throws and never holds the emergency hostage: the sends run in
 * parallel, each with its own timeout and retries (domain/telegram.ts), and
 * the whole batch is awaited for at most SEND_BUDGET_MS. A send still in
 * flight then is left to finish on its own and is NOT counted, because the
 * count is what the SOS screen tells the person in trouble.
 */
import type { FastifyBaseLogger } from "fastify";
import { eq, sql as raw } from "drizzle-orm";

import * as S from "@roadassist/db";
import { db } from "./db.js";
import { telegram } from "./providers.js";
import { displayFirstName, sosAlertMessage } from "./domain/telegram.js";

const SEND_BUDGET_MS = 7_000;

export interface TelegramAlertResult {
  /** Messages Telegram accepted. The only number a screen may call "alerted". */
  sent: number;
  /** Sends that ended in an error after their retries. */
  failed: number;
  /** Sends still running when the budget ran out: unknown, so not counted. */
  pending: number;
}

export const NO_TELEGRAM: TelegramAlertResult = { sent: 0, failed: 0, pending: 0 };

export async function alertContactsOnTelegram(input: {
  incidentId: string;
  ownerId: string;
  contacts: Array<{ telegramChatId: string | null }>;
  log: FastifyBaseLogger;
}): Promise<TelegramAlertResult> {
  if (!telegram.enabled) return NO_TELEGRAM;
  // One message per chat: one person who opened the invites for two of this
  // user's contact entries still gets one alert per incident.
  const chats = [...new Set(input.contacts.map((c) => c.telegramChatId).filter((c): c is string => Boolean(c)))];
  if (!chats.length) return NO_TELEGRAM;

  try {
    const [owner] = await db.select({ fullName: S.users.fullName }).from(S.users)
      .where(eq(S.users.id, input.ownerId)).limit(1);
    const [inc] = await db.execute<{ ref: string | null; at: string | Date; lat: number | null; lng: number | null }>(raw`
      SELECT client_incident_id AS ref, COALESCE(occurred_at, created_at) AS at,
             ST_Y(location) AS lat, ST_X(location) AS lng
        FROM incidents WHERE id = ${input.incidentId}`);
    const text = sosAlertMessage({
      ownerFirstName: displayFirstName(owner?.fullName),
      ref: inc?.ref ?? input.incidentId.slice(0, 8),
      at: inc?.at ? new Date(inc.at) : new Date(),
      position: inc?.lat != null && inc?.lng != null ? { lat: Number(inc.lat), lng: Number(inc.lng) } : null,
    });

    const result = { sent: 0, failed: 0, pending: 0 };
    let settled = 0;
    const sends = chats.map((chatId) => telegram.send(chatId, text).then((o) => {
      settled++;
      if (o.ok) result.sent++;
      else {
        result.failed++;
        // Never the chat id: it identifies a person who is not our user.
        input.log.error({ incidentId: input.incidentId, attempts: o.attempts, status: o.status, reason: o.error },
          "telegram emergency alert failed");
      }
    }));

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(sends),
      new Promise<void>((r) => { timer = setTimeout(r, SEND_BUDGET_MS); }),
    ]).finally(() => clearTimeout(timer));

    // Snapshot now: a late success must not change a count already answered.
    const answered = { sent: result.sent, failed: result.failed, pending: chats.length - settled };
    if (answered.pending) {
      input.log.warn({ incidentId: input.incidentId, pending: answered.pending },
        "telegram emergency alerts still in flight after the budget; not counted");
    }
    return answered;
  } catch (err) {
    input.log.error({ incidentId: input.incidentId, err: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      "telegram emergency alerts could not be prepared");
    return { sent: 0, failed: chats.length, pending: 0 };
  }
}
