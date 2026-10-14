/**
 * Telegram alerts for emergency contacts: the rules, with no database and no
 * network of their own, so apps/api/test/telegram.test.ts can pin every one.
 *
 * ── why Telegram ──────────────────────────────────────────────────────────
 * The hosted demo runs SMS_PROVIDER=console, so an SOS "alerts" its contacts
 * by writing a log line (smsLive: false), and real SMS in India costs money
 * per text and needs a DLT-registered template. The Telegram Bot API is free.
 * A contact who opts in on Telegram can therefore genuinely be told — and the
 * SOS answer counts only the messages Telegram accepted.
 *
 * ── the consent model ─────────────────────────────────────────────────────
 * Nobody is messaged because somebody else typed their number in. The user
 * gets a one-time invite link per contact and sends it to them; the CONTACT
 * opens it and presses Start, which is their own act in their own chat. Only
 * then does the webhook store their chat id. "/stop" in that chat undoes it.
 *
 * ── what a message may carry ──────────────────────────────────────────────
 * The user's first name (or "a RoadAssist user"), the incident reference, the
 * time and, for an SOS, the position as a map link. Never the user's phone
 * number: the builders below are not even given it, and the first name is
 * reduced to letters, so a number typed into the name field cannot leak.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ── configuration ──────────────────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  apiBase: string;
}

/** On only when all three are set; any one missing means the feature is off. */
export function telegramEnabled(c: TelegramConfig): boolean {
  return Boolean(c.botToken && c.botUsername && c.webhookSecret);
}

/**
 * What is wrong with a Telegram configuration, for validateEnv to refuse at
 * boot. Never echoes the token or the secret: a config error is printed to a
 * log, and a log is the wrong place for a credential.
 */
export function telegramConfigProblems(c: TelegramConfig): string[] {
  const named: Array<[string, string]> = [
    ["TELEGRAM_BOT_TOKEN", c.botToken],
    ["TELEGRAM_BOT_USERNAME", c.botUsername],
    ["TELEGRAM_WEBHOOK_SECRET", c.webhookSecret],
  ];
  const missing = named.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 3) return [];
  const problems: string[] = [];
  if (missing.length) {
    problems.push(
      `Telegram alerts need TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET ` +
      `together; ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} unset. ` +
      "Set all three, or unset all three to turn the feature off.",
    );
  }
  if (c.botToken && !/^\d{3,20}:[A-Za-z0-9_-]{10,}$/.test(c.botToken)) {
    problems.push("TELEGRAM_BOT_TOKEN does not look like a token from @BotFather (digits, a colon, then the secret part).");
  }
  if (c.botUsername && !/^[A-Za-z][A-Za-z0-9_]{1,29}bot$/i.test(c.botUsername)) {
    problems.push(
      `TELEGRAM_BOT_USERNAME="${c.botUsername}" is not a bot username: 5-32 letters, digits or ` +
      'underscores, ending in "bot", without the @.',
    );
  }
  if (c.webhookSecret && !/^[A-Za-z0-9_-]{24,256}$/.test(c.webhookSecret)) {
    problems.push(
      "TELEGRAM_WEBHOOK_SECRET must be 24-256 characters of A-Z, a-z, 0-9, _ and - " +
      "(Telegram's rule for the header, and long enough not to be guessed).",
    );
  }
  if (c.apiBase && !/^https?:\/\/[^/\s]+$/.test(c.apiBase)) {
    problems.push("TELEGRAM_API_BASE must be an origin like http://127.0.0.1:4697 (tests only), with no path.");
  }
  return problems;
}

/**
 * The X-Telegram-Bot-Api-Secret-Token check, in constant time. Both sides are
 * hashed first so the compare never depends on, or throws over, the length of
 * what the caller sent.
 */
export function webhookSecretMatches(given: unknown, expected: string): boolean {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// ── one-time invite codes ──────────────────────────────────────────────────

/** An invite is good for seven days, then a new one has to be made. */
export const LINK_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What Telegram allows in a start parameter, at the length newLinkCode makes. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{24,64}$/;

export const isWellFormedLinkCode = (code: unknown): code is string =>
  typeof code === "string" && CODE_SHAPE.test(code);

/** SHA-256, hex. The code is 144 random bits, so no salt or stretching is needed. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/**
 * A fresh code and the hash to store. The code is returned to the user once,
 * inside the invite link, and is never written anywhere by the server.
 */
export function newLinkCode(now = new Date()): { code: string; hash: string; expiresAt: Date } {
  const code = randomBytes(18).toString("base64url");   // 24 characters, 144 bits
  return { code, hash: hashLinkCode(code), expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS) };
}

export type LinkCodeState = "usable" | "used" | "expired" | "unknown";

/**
 * Whether a stored code may link a chat now. The webhook claims a code with
 * one conditional UPDATE that encodes exactly this rule (unused, unexpired,
 * not withdrawn), so two Starts racing cannot both win; this function is the
 * same rule in a form a unit test can reach, and names why a claim failed.
 */
export function linkCodeState(
  row: { expiresAt: Date; usedAt: Date | null; deletedAt?: Date | null } | undefined,
  now: Date,
): LinkCodeState {
  if (!row || row.deletedAt) return "unknown";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

/**
 * Written as a constant plus concatenation: the link is shown to the user and
 * opened by their contact, and the server itself never fetches t.me.
 */
const TELEGRAM_LINK = "https://t.me/";

export function inviteLink(botUsername: string, code: string): string {
  return TELEGRAM_LINK + encodeURIComponent(botUsername) + "?start=" + encodeURIComponent(code);
}

// ── chat commands ──────────────────────────────────────────────────────────

export type ChatCommand =
  | { cmd: "start"; code: string | null }
  | { cmd: "stop" }
  | { cmd: "help" };

/**
 * "/start <code>" (what an invite link sends), "/stop", "/help". A command may
 * carry the bot's name ("/stop@RoadAssistBot"), as Telegram clients add it.
 * Anything else is not a command and gets no answer.
 */
export function parseChatCommand(text: unknown): ChatCommand | null {
  if (typeof text !== "string") return null;
  const m = /^\/(start|stop|help)(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S+))?\s*$/i.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (cmd === "start") return { cmd: "start", code: isWellFormedLinkCode(m[2]) ? m[2] : null };
  return cmd === "stop" ? { cmd: "stop" } : { cmd: "help" };
}

// ── what the messages say ──────────────────────────────────────────────────

/**
 * The user's first name as it may appear in a message to their contact, or
 * null. Only letters, combining marks and the punctuation names use survive,
 * so a phone number typed into the name field becomes nothing at all.
 */
export function displayFirstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const clean = first.replace(/[^\p{L}\p{M}'.-]/gu, "").replace(/^[.'-]+|[.'-]+$/g, "").slice(0, 32);
  return /\p{L}/u.test(clean) ? clean : null;
}

const SOMEONE = "a RoadAssist user";

export function linkedMessage(ownerFirstName: string | null): string {
  return `You are now an emergency contact for ${ownerFirstName ?? SOMEONE}. ` +
    "You will get a message here if they raise an SOS.\n\n" +
    "Send /stop at any time to stop these messages.";
}

export const MESSAGES = {
  stopped: "Unlinked. You will no longer get RoadAssist SOS alerts in this chat.",
  stoppedNothing: "This chat is not linked to anyone on RoadAssist, so there is nothing to stop.",
  badCode: "This invite link has expired or was already used. Ask the person who sent it for a new one.",
  noCode: "To become someone's emergency contact, open the invite link they sent you.",
  help: "RoadAssist sends an SOS alert here for each person whose invite link you opened. " +
    "Send /stop to stop all of them.",
  notPrivate: "Emergency alerts can only go to a private chat. Open the invite link in a one-to-one chat with this bot.",
} as const;

/** Map links, written as constants: they go into a message, the server never fetches them. */
const GOOGLE_MAP = "https://www.google.com/maps?q=";
const OSM_MAP = "https://www.openstreetmap.org/";

export function mapLinks(lat: number, lng: number): { google: string; osm: string } {
  const la = lat.toFixed(5), ln = lng.toFixed(5);
  return {
    google: GOOGLE_MAP + la + "," + ln,
    osm: OSM_MAP + "?mlat=" + la + "&mlon=" + ln + "#map=17/" + la + "/" + ln,
  };
}

/** "13 Oct 2026, 2:05 pm IST": India's clock, whatever the server's zone. */
export function istTime(at: Date): string {
  return at.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).replace(/[\u202f\u00a0]/g, " ") + " IST";   // newer ICU puts a narrow no-break space before "pm"
}

export const DEMO_DISCLAIMER = "This is an automated RoadAssist demo alert; call 112 in an emergency.";

/**
 * The SOS alert. Who, the incident reference, when, where if known, and the
 * disclaimer. There is no parameter for a phone number, by design.
 */
export function sosAlertMessage(input: {
  ownerFirstName: string | null;
  ref: string;
  at: Date;
  position: { lat: number; lng: number } | null;
}): string {
  const who = input.ownerFirstName ?? "A RoadAssist user who listed you as an emergency contact";
  const lines = [
    `SOS: ${who} has raised an emergency on RoadAssist.`,
    "",
    `Ref: ${input.ref}`,
    `Time: ${istTime(input.at)}`,
  ];
  if (input.position) {
    const links = mapLinks(input.position.lat, input.position.lng);
    lines.push(`Location: ${links.google}`, `OpenStreetMap: ${links.osm}`);
  } else {
    lines.push("Location: not known (the phone had no GPS fix).");
  }
  lines.push("", DEMO_DISCLAIMER, "Send /stop to stop these alerts.");
  return lines.join("\n");
}

// ── sending, with timeouts and retries ─────────────────────────────────────

export interface SendOutcome {
  ok: boolean;
  attempts: number;
  /** HTTP status of the last answer, when there was one. */
  status?: number;
  /** Why it failed, with the bot token scrubbed out. */
  error?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/**
 * sendMessage, retried for what a retry can fix: a timeout, a network error,
 * a 5xx, or a 429 (after the retry_after Telegram names, if it fits in the
 * deadline). A 400/401/403/404 is final: a chat that blocked the bot or a
 * revoked token will not change its mind in a second.
 *
 * Never throws. Every attempt has its own timeout and the whole call has a
 * deadline, so an emergency is never held open by Telegram.
 */
export async function sendTelegramMessage(opts: {
  apiBase: string;
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: FetchLike;
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SendOutcome> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const deadline = Date.now() + (opts.deadlineMs ?? 8000);
  const scrub = (s: string) => (opts.token ? s.split(opts.token).join("<token>") : s).slice(0, 200);

  let last: SendOutcome = { ok: false, attempts: 0, error: "not attempted" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const ctl = new AbortController();
    // A timer cleared in finally rather than AbortSignal.timeout, which is
    // unref'd (the same reason as the email provider in providers.ts).
    const timer = setTimeout(() => ctl.abort(), Math.min(attemptTimeoutMs, left));
    let retryAfterMs = 0;
    try {
      const res = await fetchImpl(`${opts.apiBase}/bot${opts.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId, text: opts.text,
          link_preview_options: { is_disabled: true },
        }),
        signal: ctl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; description?: string; parameters?: { retry_after?: number };
      };
      if (res.ok && body.ok === true) return { ok: true, attempts: attempt, status: res.status };
      last = { ok: false, attempts: attempt, status: res.status,
               error: scrub(`telegram ${res.status}: ${body.description ?? "no description"}`) };
      if (res.status !== 429 && res.status < 500) return last;   // final: retrying cannot help
      if (res.status === 429) retryAfterMs = Math.max(0, Number(body.parameters?.retry_after ?? 1)) * 1000;
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { code?: string } };
      last = { ok: false, attempts: attempt,
               error: scrub(e.name === "AbortError" ? "telegram timeout"
                 : `telegram network error: ${e.cause?.code ?? e.message ?? "unknown"}`) };
    } finally {
      clearTimeout(timer);
    }
    if (attempt === maxAttempts) break;
    const wait = Math.max(retryAfterMs, 250 * 2 ** (attempt - 1));
    if (Date.now() + wait >= deadline) break;
    await sleep(wait);
  }
  return last;
}
