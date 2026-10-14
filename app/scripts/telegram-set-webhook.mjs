#!/usr/bin/env node
/**
 * Point the Telegram bot at this API's webhook, with the secret header set.
 *
 *   export TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET   # both set without echo, e.g. read -rs
 *   node scripts/telegram-set-webhook.mjs https://<your-api-host>
 *
 *   node scripts/telegram-set-webhook.mjs --info      # what Telegram has now
 *   node scripts/telegram-set-webhook.mjs --delete    # stop deliveries
 *
 * It calls setWebhook with url = <api>/v1/telegram/webhook and
 * secret_token = TELEGRAM_WEBHOOK_SECRET, so Telegram sends that value in
 * X-Telegram-Bot-Api-Secret-Token on every update and the API refuses any
 * request without it (401). Only "message" updates are asked for.
 *
 * Reads the two variables from the environment only — never from an argument,
 * so neither has to be typed onto a command line — and never prints either.
 * Run it once after the env vars are set on the host (DEPLOYMENT.md, "How to
 * turn on Telegram alerts"), and again only if the API's address changes.
 */
const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const base = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const arg = process.argv[2] ?? "";

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const scrub = (s) => (token ? String(s).split(token).join("<token>") : String(s));

if (!token) die("TELEGRAM_BOT_TOKEN is not set in the environment (the token @BotFather gave you).");

async function call(method, body) {
  const res = await fetch(`${base}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => die(`could not reach Telegram: ${scrub(e.cause?.code ?? e.message)}`));
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) die(`${method} failed: ${res.status} ${scrub(json.description ?? "")}`);
  return json.result;
}

if (arg === "--info") {
  const info = await call("getWebhookInfo");
  console.log(JSON.stringify({
    url: info.url || "(none)", pendingUpdates: info.pending_update_count,
    lastError: info.last_error_message ?? null, allowedUpdates: info.allowed_updates ?? null,
  }, null, 2));
  process.exit(0);
}

if (arg === "--delete") {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.log("✓ webhook removed; Telegram will not deliver updates until it is set again");
  process.exit(0);
}

if (!/^[A-Za-z0-9_-]{24,256}$/.test(secret)) {
  die("TELEGRAM_WEBHOOK_SECRET must be set: 24-256 characters of A-Z a-z 0-9 _ - (the same value the API has).");
}
let api;
try { api = new URL(arg); } catch { die("give the API's public origin, e.g. https://api.example.in"); }
if (api.protocol !== "https:") die("Telegram delivers webhooks only over HTTPS; give the https:// address of the API.");

const url = `${api.origin}/v1/telegram/webhook`;
await call("setWebhook", {
  url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true,
});
const me = await call("getMe");
console.log(`✓ @${me.username} now delivers to ${url} with the secret header set`);
console.log("  Check it with:  node scripts/telegram-set-webhook.mjs --info");
