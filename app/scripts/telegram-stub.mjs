/**
 * A local stand-in for the Telegram Bot API's sendMessage, for the e2e and
 * security suites. Nothing in a test run ever reaches api.telegram.org.
 *
 * The API under test must have been started with
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET
 *   TELEGRAM_API_BASE=http://127.0.0.1:<port>
 * and the suite needs the same four in its own environment: it listens on that
 * port, records every message the API sends, and can be told to fail a chat
 * (a 500, once or always) to exercise the retries.
 *
 * telegramStub() returns null, with the reason, when the run is not set up for
 * it — the suites then skip their Telegram section and say why — and refuses a
 * TELEGRAM_API_BASE that is not this machine, so a misconfigured run cannot
 * message real people.
 */
import { createServer } from "node:http";

export function telegramStubEnv() {
  const { TELEGRAM_API_BASE: base, TELEGRAM_BOT_TOKEN: token,
          TELEGRAM_BOT_USERNAME: username, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
  if (!base || !token || !username || !secret) {
    return { why: "TELEGRAM_API_BASE, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET are not all set for this suite" };
  }
  let url;
  try { url = new URL(base); } catch { return { why: `TELEGRAM_API_BASE=${base} is not a URL` }; }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port) {
    return { why: `TELEGRAM_API_BASE must be a local stub (http://127.0.0.1:<port>), not ${url.host}` };
  }
  return { port: Number(url.port), token, username: username.replace(/^@/, ""), secret };
}

export async function telegramStub() {
  const cfg = telegramStubEnv();
  if (cfg.why) return { why: cfg.why };

  const messages = [];          // every accepted sendMessage: { chatId, text }
  const attempts = new Map();   // chatId -> sendMessage calls, accepted or not
  const failures = new Map();   // chatId -> remaining failures, or Infinity
  let nextId = 1;

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST" || req.url !== `/bot${cfg.token}/sendMessage`) {
        return send(404, { ok: false, error_code: 404, description: "Not Found" });
      }
      let body = {};
      try { body = JSON.parse(raw); } catch { return send(400, { ok: false, description: "Bad Request: invalid JSON" }); }
      const chatId = String(body.chat_id ?? "");
      attempts.set(chatId, (attempts.get(chatId) ?? 0) + 1);
      const left = failures.get(chatId) ?? 0;
      if (left > 0) {
        failures.set(chatId, left - 1);
        return send(500, { ok: false, error_code: 500, description: "Internal Server Error (stub)" });
      }
      messages.push({ chatId, text: String(body.text ?? "") });
      return send(200, { ok: true, result: { message_id: nextId++, chat: { id: Number(chatId), type: "private" } } });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, "127.0.0.1", resolve);
  });

  let updateId = Math.floor(Math.random() * 1e6);
  return {
    ...cfg,
    messages,
    /** Messages sent to one chat, oldest first. */
    to: (chatId) => messages.filter((m) => m.chatId === String(chatId)),
    attemptsFor: (chatId) => attempts.get(String(chatId)) ?? 0,
    /** Answer the next `n` sends to this chat with a 500 (Infinity: every one). */
    fail: (chatId, n = Infinity) => failures.set(String(chatId), n),
    /** A random private-chat id, so repeated runs on one database never collide. */
    newChatId: () => String(5_000_000_000 + Math.floor(Math.random() * 4_000_000_000)),
    /** POST an update to the API's webhook, as Telegram would. */
    async deliver(base, chatId, text, { secret = cfg.secret, type = "private" } = {}) {
      updateId++;
      const res = await fetch(`${base}/v1/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json",
                   ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
        body: JSON.stringify({
          update_id: updateId,
          message: { message_id: updateId, date: Math.floor(Date.now() / 1000), text,
                     chat: { id: Number(chatId), type, ...(type === "private" ? { first_name: "Contact" } : { title: "Group" }) },
                     from: { id: Number(chatId), is_bot: false, first_name: "Contact" } },
        }),
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, ...json };
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
