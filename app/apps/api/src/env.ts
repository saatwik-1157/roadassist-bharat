/**
 * Configuration. Every external service is optional: when its credentials are
 * absent the provider falls back to a local development implementation, so the
 * whole platform runs with zero third-party accounts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader — avoids a dependency for four lines of parsing.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* no .env — environment variables or defaults are used */ }

const bool = (v: string | undefined, d = false) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",

  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://roadassist:devpassword@localhost:5434/roadassist",

  /** Dev default is deliberately obvious so nobody ships it by accident. */
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me",
  accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 600),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),

  /** In development every OTP is this code, and it is returned in the response. */
  devOtp: process.env.DEV_OTP ?? "000000",
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  otpWindowMinutes: Number(process.env.OTP_WINDOW_MINUTES ?? 15),
  /** Per-IP OTP request ceiling in the same window (threat #1 needs both). */
  otpIpMax: Number(process.env.OTP_IP_MAX ?? 30),

  /**
   * HMAC secret for the inbound telecom webhook. When set, every
   * POST /v1/telecom/sms must carry x-roadassist-signature =
   * HMAC-SHA256(raw body). Unset = development mode (endpoint open, flagged).
   */
  telecomWebhookSecret: process.env.TELECOM_WEBHOOK_SECRET ?? "",

  // ── pluggable providers ────────────────────────────────────────────────
  sms: {
    provider: process.env.SMS_PROVIDER ?? "console", // console | twilio | msg91
    apiKey: process.env.SMS_API_KEY ?? "",
    senderId: process.env.SMS_SENDER_ID ?? "RDASST",
    dltTemplateId: process.env.SMS_DLT_TEMPLATE_ID ?? "",
    /** MSG91 template variable name that carries the message text. */
    dltVar: process.env.SMS_DLT_VAR ?? "otp",
    baseUrl: process.env.SMS_BASE_URL ?? "",
  },
  maps: {
    provider: process.env.MAPS_PROVIDER ?? "local", // local | mapbox | ola | google
    apiKey: process.env.MAPS_API_KEY ?? "",
    baseUrl: process.env.MAPS_BASE_URL ?? "",
  },
  ai: {
    provider: process.env.AI_PROVIDER ?? "rules", // rules | http
    apiKey: process.env.AI_API_KEY ?? "",
    baseUrl: process.env.AI_BASE_URL ?? "",
    /** Below this the rules result is used instead (ADR-0006). */
    minConfidence: Number(process.env.AI_MIN_CONFIDENCE ?? 0.45),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 3000),
  },
  payments: {
    provider: process.env.PAYMENTS_PROVIDER ?? "mock", // mock | razorpay | cashfree
    keyId: process.env.PAYMENTS_KEY_ID ?? "",
    keySecret: process.env.PAYMENTS_KEY_SECRET ?? "",
  },

  exposeDevOtp: bool(process.env.EXPOSE_DEV_OTP, true),
} as const;

export const isProd = env.nodeEnv === "production";

/** Fails fast rather than booting a production server with dev defaults. */
export function assertProductionSafe() {
  if (!isProd) return;
  const problems: string[] = [];
  if (env.jwtSecret.startsWith("dev-only")) problems.push("JWT_SECRET is still the development default");
  if (env.exposeDevOtp) problems.push("EXPOSE_DEV_OTP must be false in production");
  if (env.sms.provider === "console") problems.push("SMS_PROVIDER is 'console' — no real messages would be sent");
  if (!env.telecomWebhookSecret) problems.push("TELECOM_WEBHOOK_SECRET is unset — the inbound SMS webhook would accept unsigned requests");
  if (problems.length) {
    throw new Error("Refusing to start in production:\n  - " + problems.join("\n  - "));
  }
}
