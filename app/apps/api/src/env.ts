/**
 * Configuration. Every external service is optional: when its credentials are
 * absent the provider falls back to a local development implementation, so the
 * whole platform runs with zero third-party accounts.
 */
import { resolve } from "node:path";
import { loadDotEnv } from "@roadassist/db";

// Shared with the migrator and the seeders so every entry point reads the same
// file regardless of which workspace directory it was launched from.
loadDotEnv();

const bool = (v: string | undefined, d = false) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));

/**
 * The development database, named once so the production guard below can
 * compare against the exact value rather than a copy that could drift.
 *
 * It is deliberately obvious — `devpassword` on a non-standard local port — so
 * that seeing it anywhere near a real deployment is unambiguous.
 */
const DEV_DATABASE_URL = "postgres://roadassist:devpassword@localhost:5434/roadassist";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * Whether an upstream proxy's forwarded-for header may be believed.
   *
   * Behind a tunnel, load balancer or CDN every request arrives from the
   * proxy's address, so `req.ip` is the same value for every user on earth —
   * which silently collapses the per-IP OTP ceiling (threat #1) into one
   * shared bucket that a handful of legitimate users can exhaust between them.
   *
   * It is deliberately OFF by default and never inferred. Trusting
   * X-Forwarded-For when nothing upstream actually rewrites it is strictly
   * worse than not trusting it: any client could then set the header itself
   * and mint a fresh "IP" per request, bypassing the ceiling entirely.
   *
   * Accepts `true` (trust every hop — only safe when the proxy is the sole
   * ingress) or a comma-separated list of trusted proxy addresses/CIDRs.
   * Passed straight through to Fastify.
   *
   * Hop counts are NOT accepted. Fastify 5.12.3 removed them (GHSA-3m5p-2c4r-xxw2):
   * counting hops decides how much of X-Forwarded-For to believe without
   * checking *who* sent it, so a client that can reach the port directly can
   * pad the header and land on any address it likes — which is exactly the
   * per-IP OTP ceiling this setting exists to protect. A numeric value is
   * rejected outright rather than coerced to `true`, because silently
   * upgrading a narrow setting into "trust everybody" is the failure this
   * whole option is guarding against.
   */
  trustProxy: ((): boolean | string[] => {
    const raw = process.env.TRUST_PROXY;
    if (raw === undefined || raw === "") return false;
    if (/^(true|yes)$/i.test(raw)) return true;
    if (/^(false|no)$/i.test(raw)) return false;
    if (/^\d+$/.test(raw)) {
      throw new Error(
        `TRUST_PROXY=${raw} is a hop count, which is no longer supported (it was ` +
        "removed upstream as CVE GHSA-3m5p-2c4r-xxw2). Set it to the proxy's own " +
        'address instead — TRUST_PROXY="127.0.0.1,::1" behind a local tunnel, or ' +
        "your load balancer's subnet — or TRUST_PROXY=true only when that proxy is " +
        "genuinely the sole route to this port.",
      );
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  })(),

  databaseUrl: process.env.DATABASE_URL ?? DEV_DATABASE_URL,

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
   * How long a dispatch offer stays acceptable.
   *
   * 90 seconds is right for real dispatch — a stranded customer should not wait
   * on a mechanic who has walked away from their phone. It is too short to
   * *narrate*, though: showing the offer, switching to the mechanic console and
   * signing in takes longer than that, and the offer is dead before anyone can
   * accept it. Configurable so a demo can breathe without the production
   * default moving.
   */
  offerTtlSeconds: Number(process.env.OFFER_TTL_SECONDS ?? 90),

  /**
   * How many providers each dispatch wave offers the job to.
   *
   * 1 is the strict one-at-a-time ladder the dispatch brief describes: A is
   * asked, A does not answer, the offer expires, B is asked. 5 — the default,
   * and what the platform has always done — broadcasts to the best five and
   * escalates to the next five only if none of them answer.
   *
   * Both are correct and the trade is real: breadth finds somebody faster for a
   * person on a hard shoulder at 2am, order is fairer to providers and cheaper
   * in notifications. It is configuration rather than a hardcoded choice
   * because the right answer differs between a city depot and a highway at
   * night.
   */
  dispatchWaveSize: Number(process.env.DISPATCH_WAVE_SIZE ?? 5),
  /** Search radius used when the ladder escalates on its own (no caller to ask). */
  dispatchRadiusKm: Number(process.env.DISPATCH_RADIUS_KM ?? 25),
  /**
   * How often expired offers are swept and the ladder advanced.
   *
   * This is the timeout mechanism. Without it an unanswered offer simply
   * stopped being listed while the booking sat in MATCHING forever and the
   * customer watched a spinner.
   */
  offerSweepSeconds: Number(process.env.OFFER_SWEEP_SECONDS ?? 10),

  /**
   * Which browser origins may call this API.
   *
   * Development reflects whatever origin asks, which is right for a demo served
   * from a tunnel, a LAN address and localhost on the same afternoon. Production
   * must not: reflecting the caller's own Origin is functionally the same as
   * allowing every site on the internet to make credentialed calls on a user's
   * behalf, and `assertProductionSafe` refuses to boot without an explicit list.
   *
   * Set as a comma-separated list of full origins:
   *   CORS_ORIGINS="https://app.roadassist.in,https://admin.roadassist.in"
   */
  cors: ((): { mode: "reflect" | "list"; origins: string[] } => {
    const raw = process.env.CORS_ORIGINS;
    if (raw === undefined) return { mode: "reflect", origins: [] };
    return {
      mode: "list",
      origins: raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    };
  })(),

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
    provider: process.env.PAYMENTS_PROVIDER ?? "mock", // mock | razorpay
    keyId: process.env.PAYMENTS_KEY_ID ?? "",
    keySecret: process.env.PAYMENTS_KEY_SECRET ?? "",
    /**
     * Razorpay webhook signing secret — set in the Razorpay dashboard, and a
     * different value from the API key secret.
     *
     * The browser callback after checkout is not a reliable settlement signal:
     * the customer can pay and then close the tab, lose signal, or have the
     * page killed by the OS, and the money has still moved. The webhook is the
     * path that does not depend on the payer's device surviving.
     */
    webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET ?? "",
    /** Overrides the gateway host — for stub testing only. */
    baseUrl: process.env.PAYMENTS_BASE_URL ?? "",
  },

  email: {
    // console = log only (default). http = POST to an email API (SendGrid/
    // Mailgun/Resend-style) at EMAIL_BASE_URL with a Bearer key.
    provider: process.env.EMAIL_PROVIDER ?? "console", // console | http
    apiKey: process.env.EMAIL_API_KEY ?? "",
    baseUrl: process.env.EMAIL_BASE_URL ?? "",
    from: process.env.EMAIL_FROM ?? "RoadAssist <no-reply@roadassist.in>",
  },
  // Email sign-in (domain/email-signin.ts): "email=+91XXXXXXXXXX, ..." set in
  // the host's environment. Empty = no email sign-in, phone only.
  emailSignin: process.env.EMAIL_SIGNIN ?? "",
  // Operator alerts (alerts.ts). Off unless ALERT_EMAIL_TO is set; delivered
  // through the email provider above, so EMAIL_PROVIDER=http is what makes them
  // real mail rather than console lines.
  alerts: {
    to: process.env.ALERT_EMAIL_TO ?? "",
    signinsPerHour: Number(process.env.ALERT_SIGNINS_PER_HOUR ?? 6),
    otpBurst: Number(process.env.ALERT_OTP_BURST ?? 5),
    label: process.env.ALERT_LABEL ?? "the RoadAssist API",
  },

  exposeDevOtp: bool(process.env.EXPOSE_DEV_OTP, true),

  /**
   * Local disk store for hazard-report photos. Honours ADR-0006: raw frames
   * never enter the database — only a reference (the file key) is stored. In a
   * real deployment UPLOAD_DIR would be a mounted volume or swapped for object
   * storage; here it is a plain directory so the platform runs with no cloud.
   */
  uploadDir: process.env.UPLOAD_DIR ?? resolve(process.cwd(), "uploads"),
  /** Max decoded photo size accepted by the report endpoint (bytes). */
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 4_000_000),

  /** Per-user ceiling on crowdsourced hazard reports, so one account cannot
   *  flood the RAKSHA queue / map (the edge-device path has its own backstops). */
  reportMaxPerWindow: Number(process.env.REPORT_MAX_PER_WINDOW ?? 20),
  reportWindowMinutes: Number(process.env.REPORT_WINDOW_MINUTES ?? 60),
} as const;

export const isProd = env.nodeEnv === "production";

/** Fails fast rather than booting a production server with dev defaults. */
/**
 * Fail at boot rather than at 3am.
 *
 * Runs in EVERY environment, because the failures it catches are not
 * production-specific: `Number(undefined)` is `NaN`, and a NaN TTL produced a
 * token that expired at the epoch — a class of bug that surfaces as
 * "authentication is randomly broken" hours later rather than as a startup
 * error. Numbers are the common case, so they are checked as a group.
 *
 * Every message names the variable and says what to set it to. A config error
 * that only says "invalid configuration" costs somebody an hour.
 */
export function validateEnv(): void {
  const problems: string[] = [];

  const numbers: Array<[string, number, string]> = [
    ["PORT", env.port, "a TCP port, e.g. 4000"],
    ["ACCESS_TTL_SECONDS", env.accessTtlSeconds, "seconds, e.g. 600"],
    ["REFRESH_TTL_DAYS", env.refreshTtlDays, "days, e.g. 30"],
    ["OTP_MAX_ATTEMPTS", env.otpMaxAttempts, "a small integer, e.g. 5"],
    ["ALERT_SIGNINS_PER_HOUR", env.alerts.signinsPerHour, "emails an hour, e.g. 6"],
    ["ALERT_OTP_BURST", env.alerts.otpBurst, "wrong codes before an alert, e.g. 5"],
    ["OTP_WINDOW_MINUTES", env.otpWindowMinutes, "minutes, e.g. 15"],
    ["OTP_IP_MAX", env.otpIpMax, "requests per window, e.g. 30"],
    ["OFFER_TTL_SECONDS", env.offerTtlSeconds, "seconds, e.g. 90"],
    ["DISPATCH_WAVE_SIZE", env.dispatchWaveSize, "providers per wave, e.g. 5"],
    ["DISPATCH_RADIUS_KM", env.dispatchRadiusKm, "kilometres, e.g. 25"],
    ["OFFER_SWEEP_SECONDS", env.offerSweepSeconds, "seconds, e.g. 10"],
    // These five were missing, and each one fails SILENTLY rather than loudly:
    // a NaN ceiling makes `length > NaN` and `count >= NaN` both false, so the
    // photo size cap and the hazard-report ceiling simply stop existing; a NaN
    // window reaches Postgres as make_interval(mins => NaN) and throws on every
    // report; and a NaN timeout makes setTimeout fire at 1ms, so a configured
    // model always aborts into the rules fallback and looks merely "slow".
    ["AI_TIMEOUT_MS", env.ai.timeoutMs, "milliseconds, e.g. 3000"],
    ["UPLOAD_MAX_BYTES", env.uploadMaxBytes, "bytes, e.g. 4000000"],
    ["REPORT_MAX_PER_WINDOW", env.reportMaxPerWindow, "reports per window, e.g. 20"],
    ["REPORT_WINDOW_MINUTES", env.reportWindowMinutes, "minutes, e.g. 60"],
  ];
  for (const [name, value, hint] of numbers) {
    if (!Number.isFinite(value) || value <= 0) {
      problems.push(`${name}="${process.env[name]}" is not a positive number — expected ${hint}`);
    }
  }

  // A confidence threshold is a probability, not a count: 0 accepts anything the
  // model says and >1 rejects everything, so both ends are checked, not just NaN.
  if (!Number.isFinite(env.ai.minConfidence) || env.ai.minConfidence <= 0 || env.ai.minConfidence > 1) {
    problems.push(
      `AI_MIN_CONFIDENCE="${process.env.AI_MIN_CONFIDENCE}" is not a probability — ` +
      "expected a value above 0 and at most 1, e.g. 0.45",
    );
  }

  /**
   * A configured gateway with no credentials boots happily and then throws on
   * the first OTP — a 500 at the exact moment somebody is trying to sign in,
   * and nothing in the startup log hints at why. This is the case validateEnv
   * exists for, and it was missing: `assertProductionSafe` checked it, but only
   * in production, which is precisely where nobody is experimenting.
   */
  if (env.sms.provider !== "console") {
    if (!env.sms.apiKey) {
      problems.push(
        `SMS_PROVIDER="${env.sms.provider}" but SMS_API_KEY is empty. ` +
        (env.sms.provider === "twilio"
          ? 'Set SMS_API_KEY="ACCOUNT_SID:AUTH_TOKEN" from the Twilio console.'
          : "Set SMS_API_KEY to the gateway's auth key.") +
        ' Or set SMS_PROVIDER=console to sign in with the fixed DEV_OTP instead.',
      );
    } else if (env.sms.provider === "twilio" && !/^AC[0-9a-f]{32}:.+/i.test(env.sms.apiKey)) {
      // Two values in one variable is easy to get wrong, and the failure is a
      // 401 from Twilio that reads like a bad password rather than a typo.
      problems.push(
        'SMS_API_KEY does not look like "ACCOUNT_SID:AUTH_TOKEN" — the SID starts ' +
        'with AC and is 34 characters, then a colon, then the auth token.',
      );
    }

    if (env.sms.provider === "twilio" && !/^\+[1-9]\d{6,14}$/.test(env.sms.senderId)) {
      // Twilio's From must be a number it has issued you (or an approved
      // alphanumeric sender, which India does not permit for A2P).
      problems.push(
        `SMS_SENDER_ID="${env.sms.senderId}" is not an E.164 number. For Twilio ` +
        "this must be the number in your console, e.g. +15551234567.",
      );
    }

    if (env.sms.provider === "msg91" && !env.sms.dltTemplateId) {
      problems.push(
        "MSG91 needs SMS_DLT_TEMPLATE_ID — Indian A2P messages are template-bound " +
        "under TRAI DLT and a send without one is rejected by the gateway.",
      );
    }
  }

  if (!/^postgres(ql)?:\/\//.test(env.databaseUrl)) {
    problems.push(
      `DATABASE_URL does not look like a Postgres URL. ` +
      `Expected postgres://user:password@host:port/database`,
    );
  }

  if (env.cors.mode === "list" && env.cors.origins.length === 0) {
    problems.push(
      `CORS_ORIGINS is set but empty. Give a comma-separated list of full origins, ` +
      `e.g. CORS_ORIGINS="https://app.example.in,https://admin.example.in"`,
    );
  }
  for (const origin of env.cors.origins) {
    if (!/^https?:\/\/[^/]+$/.test(origin)) {
      problems.push(
        `CORS_ORIGINS entry "${origin}" is not an origin. ` +
        `An origin is scheme://host[:port] with no path — "https://app.example.in", not "https://app.example.in/".`,
      );
    }
  }

  if (problems.length) {
    throw new Error(
      "Configuration is not usable:\n  - " + problems.join("\n  - ") +
      "\n\nFix these in your .env (see app/.env.example) and start again.",
    );
  }
}

export function assertProductionSafe() {
  if (!isProd) return;
  const problems: string[] = [];

  // A production server that silently fell back to a localhost development
  // database would start, pass its health check, and serve an empty platform.
  //
  // Presence was never the check that mattered. `loadDotEnv` populates
  // process.env from a `.env` beside the code, so an image that shipped one —
  // an ordinary packaging mistake — satisfied "is it set?" while pointing at a
  // database that does not exist on that host. The value is what has to be
  // judged, so both the unset case and the development value are refused.
  if (!process.env.DATABASE_URL) {
    problems.push("DATABASE_URL is unset — production must never fall back to the local development database");
  } else if (env.databaseUrl === DEV_DATABASE_URL) {
    problems.push(
      "DATABASE_URL is still the development database (localhost:5434, devpassword). " +
      "A shipped .env satisfies a presence check but not a real deployment — set it " +
      "in the environment of the host that is actually running this.",
    );
  } else if (/:devpassword@/.test(env.databaseUrl)) {
    problems.push("DATABASE_URL still carries the development password — rotate it before deploying");
  }
  // `origin: true` reflects whatever Origin the caller sent, which is the same
  // as allowing every site on the internet to call this API with a user's
  // credentials attached.
  if (env.cors.mode !== "list") {
    problems.push(
      'CORS_ORIGINS is unset — production would reflect any Origin. Set it to your ' +
      'front-end origins, e.g. CORS_ORIGINS="https://app.example.in"',
    );
  }
  if (env.cors.origins.some((o) => o.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(o))) {
    problems.push("CORS_ORIGINS contains a plain-http origin — production origins must be https");
  }
  if (env.jwtSecret.startsWith("dev-only")) problems.push("JWT_SECRET is still the development default");
  if (env.exposeDevOtp) problems.push("EXPOSE_DEV_OTP must be false in production");
  if (env.sms.provider === "console") problems.push("SMS_PROVIDER is 'console' — no real messages would be sent");
  if (!env.telecomWebhookSecret) problems.push("TELECOM_WEBHOOK_SECRET is unset — the inbound SMS webhook would accept unsigned requests");
  // Every other provider was gated here; payments was not, so a production
  // build would have settled invoices against a local stub and marked real
  // jobs PAID without a rupee moving.
  if (env.payments.provider === "mock") problems.push("PAYMENTS_PROVIDER is 'mock' — invoices would settle without any money moving");
  if (env.payments.provider !== "mock" && !(env.payments.keyId && env.payments.keySecret)) {
    problems.push("PAYMENTS_KEY_ID and PAYMENTS_KEY_SECRET are required for a real payment gateway");
  }
  // Without the webhook secret the only settlement signal is the payer's own
  // browser, so a customer who pays and closes the tab is charged for a booking
  // that never leaves COMPLETED. That is a money bug, not a configuration nit.
  if (env.payments.provider !== "mock" && !env.payments.webhookSecret) {
    problems.push(
      "PAYMENTS_WEBHOOK_SECRET is unset — settlement would depend entirely on the " +
      "customer's browser surviving checkout",
    );
  }
  if (problems.length) {
    throw new Error("Refusing to start in production:\n  - " + problems.join("\n  - "));
  }
}
