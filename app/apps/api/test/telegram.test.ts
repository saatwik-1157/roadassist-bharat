/**
 * Telegram alerts for emergency contacts (domain/telegram.ts): the invite
 * code, its expiry and single use, the chat commands, the configuration
 * gate, the retries — and that no message can carry a phone number.
 *
 * The database half of single use (one conditional UPDATE claims a code) and
 * the webhook's secret check run against a live server and a local stub of
 * the Bot API in scripts/e2e-journey.mjs §41 and scripts/security-audit.mjs §14.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  DEMO_DISCLAIMER, LINK_CODE_TTL_MS, MESSAGES, displayFirstName, hashLinkCode, inviteLink, isWellFormedLinkCode,
  linkCodeState, linkedMessage, newLinkCode, parseChatCommand, sendTelegramMessage, sosAlertMessage,
  telegramConfigProblems, telegramEnabled, webhookSecretMatches,
} from "../src/domain/telegram.js";

const NOW = new Date("2026-10-13T08:30:00Z");

// ── codes ──────────────────────────────────────────────────────────────────

test("a new code is random, link-safe, and stored only as its SHA-256", () => {
  const a = newLinkCode(NOW), b = newLinkCode(NOW);
  assert.notEqual(a.code, b.code);
  assert.ok(isWellFormedLinkCode(a.code), a.code);
  assert.match(a.code, /^[A-Za-z0-9_-]{24}$/, "Telegram start parameters allow only A-Z a-z 0-9 _ -");
  assert.equal(a.hash, createHash("sha256").update(a.code).digest("hex"));
  assert.equal(a.hash, hashLinkCode(a.code));
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.ok(!a.hash.includes(a.code), "the stored value does not contain the code");
});

test("a code expires seven days after it is made", () => {
  const { expiresAt } = newLinkCode(NOW);
  assert.equal(expiresAt.getTime() - NOW.getTime(), LINK_CODE_TTL_MS);
  assert.equal(LINK_CODE_TTL_MS, 7 * 24 * 3600 * 1000);
  const row = { expiresAt, usedAt: null };
  assert.equal(linkCodeState(row, new Date(expiresAt.getTime() - 1)), "usable");
  assert.equal(linkCodeState(row, expiresAt), "expired", "the exact expiry instant is already expired");
  assert.equal(linkCodeState(row, new Date(expiresAt.getTime() + 1)), "expired");
});

test("a code links once: a used, withdrawn or unknown code is refused", () => {
  const expiresAt = new Date(NOW.getTime() + LINK_CODE_TTL_MS);
  assert.equal(linkCodeState({ expiresAt, usedAt: null }, NOW), "usable");
  assert.equal(linkCodeState({ expiresAt, usedAt: NOW }, NOW), "used");
  assert.equal(linkCodeState({ expiresAt: new Date(0), usedAt: NOW }, NOW), "used", "used wins over expired");
  assert.equal(linkCodeState({ expiresAt, usedAt: null, deletedAt: NOW }, NOW), "unknown", "a replaced invite is withdrawn");
  assert.equal(linkCodeState(undefined, NOW), "unknown");
});

test("the invite link is t.me/<bot>?start=<code>", () => {
  assert.equal(inviteLink("RoadAssistAlertsBot", "abcdefghijklmnopqrstuvwx"),
    "https://t.me/RoadAssistAlertsBot?start=abcdefghijklmnopqrstuvwx");
});

// ── chat commands ──────────────────────────────────────────────────────────

test("/start, /stop and /help are read, with or without the bot's name", () => {
  const code = newLinkCode().code;
  assert.deepEqual(parseChatCommand(`/start ${code}`), { cmd: "start", code });
  assert.deepEqual(parseChatCommand(`/start@RoadAssistAlertsBot ${code}`), { cmd: "start", code });
  assert.deepEqual(parseChatCommand("/start"), { cmd: "start", code: null });
  assert.deepEqual(parseChatCommand("/start not-a-code"), { cmd: "start", code: null }, "too short to be ours");
  assert.deepEqual(parseChatCommand("/start ' OR 1=1 --"), null, "two words after /start is not a start");
  assert.deepEqual(parseChatCommand("/STOP"), { cmd: "stop" });
  assert.deepEqual(parseChatCommand("/stop@RoadAssistAlertsBot"), { cmd: "stop" });
  assert.deepEqual(parseChatCommand("/help"), { cmd: "help" });
  assert.equal(parseChatCommand("hello"), null);
  assert.equal(parseChatCommand("stop"), null, "only the command form unlinks");
  assert.equal(parseChatCommand(undefined), null);
});

// ── the webhook secret and the configuration gate ──────────────────────────

test("the webhook secret is compared exactly, and a missing one never matches", () => {
  const secret = "s3cret-for-the-webhook-header_0123";
  assert.equal(webhookSecretMatches(secret, secret), true);
  assert.equal(webhookSecretMatches(secret + "x", secret), false);
  assert.equal(webhookSecretMatches(secret.slice(1), secret), false);
  assert.equal(webhookSecretMatches(undefined, secret), false);
  assert.equal(webhookSecretMatches(["a", "b"], secret), false);
  assert.equal(webhookSecretMatches("", ""), false, "an unset secret authenticates nothing");
});

test("Telegram is on only with all three variables, and a half setup is refused at boot", () => {
  const full = { botToken: "123456:stub-token-for-tests", botUsername: "RoadAssistAlertsBot",
                 webhookSecret: "a".repeat(32), apiBase: "" };
  assert.equal(telegramEnabled(full), true);
  assert.deepEqual(telegramConfigProblems(full), []);
  const off = { botToken: "", botUsername: "", webhookSecret: "", apiBase: "" };
  assert.equal(telegramEnabled(off), false);
  assert.deepEqual(telegramConfigProblems(off), [], "all unset is simply off");

  const half = { ...full, webhookSecret: "" };
  assert.equal(telegramEnabled(half), false);
  const p = telegramConfigProblems(half);
  assert.equal(p.length, 1);
  assert.match(p[0], /TELEGRAM_WEBHOOK_SECRET is unset/);

  const bad = { botToken: "not a token", botUsername: "RoadAssist", webhookSecret: "short", apiBase: "ftp://x/y" };
  const problems = telegramConfigProblems(bad).join("\n");
  assert.match(problems, /TELEGRAM_BOT_TOKEN does not look like/);
  assert.match(problems, /ending in "bot"/);
  assert.match(problems, /24-256 characters/);
  assert.match(problems, /TELEGRAM_API_BASE/);
  assert.ok(!problems.includes("not a token"), "a config error never echoes the token");
});

// ── what the messages say ──────────────────────────────────────────────────

const PHONE = /(\+?91[\s-]?)?[6-9]\d{9}|\d{7,}/;

test("the first name is letters only, so a number typed as a name never reaches a contact", () => {
  assert.equal(displayFirstName("Priya Sharma"), "Priya");
  assert.equal(displayFirstName("  प्रिया  शर्मा "), "प्रिया");
  assert.equal(displayFirstName("O'Brien"), "O'Brien");
  assert.equal(displayFirstName("+919812345678"), null);
  assert.equal(displayFirstName("9812345678 Priya"), null, "the first word is the number, so no name at all");
  assert.equal(displayFirstName("Priya9812345678"), "Priya");
  assert.equal(displayFirstName(""), null);
  assert.equal(displayFirstName(null), null);
});

test("the link confirmation names the user by first name, or not at all", () => {
  assert.equal(linkedMessage("Priya").split("\n")[0],
    "You are now an emergency contact for Priya. You will get a message here if they raise an SOS.");
  assert.match(linkedMessage(null), /^You are now an emergency contact for a RoadAssist user\. /);
  assert.match(linkedMessage(null), /\/stop/);
  assert.doesNotMatch(linkedMessage(displayFirstName("+91 98123 45678")), PHONE);
});

test("an SOS alert says who, the ref, the time and the place, and never a phone number", () => {
  const text = sosAlertMessage({
    ownerFirstName: displayFirstName("Priya 9812345678"), ref: "RA-K7P2QX",
    at: NOW, position: { lat: 28.4595, lng: 77.0266 },
  });
  assert.match(text, /^SOS: Priya has raised an emergency on RoadAssist\./);
  assert.match(text, /Ref: RA-K7P2QX/);
  assert.match(text, /Time: 13 Oct 2026, 2:00 pm IST/i, "India's clock: 08:30 UTC is 14:00 IST");
  assert.doesNotMatch(text, /[\u202f\u00a0]/, "plain spaces, whatever the ICU version");
  assert.ok(text.includes("https://www.google.com/maps?q=28.45950,77.02660"), text);
  assert.ok(text.includes("https://www.openstreetmap.org/?mlat=28.45950&mlon=77.02660"), text);
  assert.ok(text.includes(DEMO_DISCLAIMER));
  assert.equal(DEMO_DISCLAIMER, "This is an automated RoadAssist demo alert; call 112 in an emergency.");
  assert.doesNotMatch(text.replace(/https:\S+/g, ""), PHONE, "no phone number outside the map links");
});

test("an SOS with no fix says so instead of inventing a place, and an unnamed user stays unnamed", () => {
  const text = sosAlertMessage({ ownerFirstName: null, ref: "1a2b3c4d", at: NOW, position: null });
  assert.match(text, /^SOS: A RoadAssist user who listed you as an emergency contact has raised/);
  assert.match(text, /Location: not known/);
  assert.doesNotMatch(text, /maps|openstreetmap/);
  assert.doesNotMatch(text, PHONE);
});

test("no fixed reply carries a phone number either", () => {
  for (const m of Object.values(MESSAGES)) assert.doesNotMatch(m, PHONE, m);
});

// ── sending: timeouts, retries, and a token that never leaks ───────────────

const TOKEN = "123456:stub-token-for-tests";
type Reply = { status: number; body: unknown } | "network" | "hang";
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = async (url: string, init: { body: string; signal: AbortSignal }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === "network") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    if (r === "hang") {
      return new Promise<never>((_, reject) => init.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    return { status: r.status, ok: r.status < 300, json: async () => r.body };
  };
  return { calls, impl };
}
const send = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => sendTelegramMessage({
  apiBase: "http://stub", token: TOKEN, chatId: "424242", text: "hi",
  fetchImpl: f.impl as never, sleep: async () => {}, ...extra,
});

test("a send is one sendMessage call with the chat and the text", async () => {
  const f = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 1 } } }]);
  const out = await send(f);
  assert.deepEqual(out, { ok: true, attempts: 1, status: 200 });
  assert.equal(f.calls[0].url, `http://stub/bot${TOKEN}/sendMessage`);
  assert.equal(f.calls[0].body.chat_id, "424242");
  assert.equal(f.calls[0].body.text, "hi");
});

test("a 5xx, a 429 and a network error are retried; the third failure is final", async () => {
  const f = fakeFetch([{ status: 502, body: {} }, { status: 429, body: { ok: false, parameters: { retry_after: 0 } } },
                       { status: 200, body: { ok: true } }]);
  assert.deepEqual(await send(f), { ok: true, attempts: 3, status: 200 });

  const g = fakeFetch(["network"]);
  const out = await send(g);
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 3);
  assert.match(out.error ?? "", /network error: ECONNRESET/);
});

test("a 403 (the contact blocked the bot) is not retried", async () => {
  const f = fakeFetch([{ status: 403, body: { ok: false, description: "Forbidden: bot was blocked by the user" } }]);
  const out = await send(f);
  assert.equal(out.attempts, 1);
  assert.equal(out.status, 403);
  assert.match(out.error ?? "", /blocked/);
});

test("a hung request times out instead of holding the emergency open", async () => {
  const f = fakeFetch(["hang"]);
  const t0 = Date.now();
  const out = await send(f, { attemptTimeoutMs: 30, maxAttempts: 2 });
  assert.equal(out.ok, false);
  assert.equal(out.error, "telegram timeout");
  assert.ok(Date.now() - t0 < 2000, "both attempts gave up on their timeouts");
});

test("an error never carries the bot token", async () => {
  const f = fakeFetch([{ status: 400, body: { ok: false, description: `Bad Request: url /bot${TOKEN}/sendMessage` } }]);
  const out = await send(f);
  assert.ok(!(out.error ?? "").includes(TOKEN), out.error);
  assert.match(out.error ?? "", /<token>/);
});
