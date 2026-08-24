/**
 * Adapters for every third-party service.
 *
 * Each has a local implementation used when no credentials are configured, so
 * the platform runs end to end with zero external accounts. Dropping in a real
 * vendor is an environment change, never a code change — which is also what
 * keeps us portable (ADR-0001's vendor-lock-in answer).
 */
import { env } from "./env.js";
import { diagnose, type Diagnosis } from "./domain/ai-rules.js";

// ── SMS ───────────────────────────────────────────────────────────────────
export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string, opts?: { templateId?: string }): Promise<{ id: string; delivered: boolean }>;
}

/** Logs instead of sending. Also what the SMS journey is tested against. */
const consoleSms: SmsProvider = {
  name: "console",
  async send(to, body) {
    console.log(`[sms:console] → ${to}\n            ${body.replace(/\n/g, "\n            ")}`);
    return { id: `dev-${Date.now()}`, delivered: true };
  },
};

/**
 * Twilio Messages API (shape per docs: POST
 * /2010-04-01/Accounts/{SID}/Messages.json, HTTP Basic SID:token, form-encoded
 * From/To/Body). SMS_API_KEY holds "ACCOUNT_SID:AUTH_TOKEN"; SMS_SENDER_ID is
 * the From number or alphanumeric sender. SMS_BASE_URL overrides the API host
 * for stub testing only.
 */
const twilioSms: SmsProvider = {
  name: "twilio",
  async send(to, body) {
    const [sid, token] = env.sms.apiKey.split(":");
    if (!sid || !token) throw new Error('Twilio needs SMS_API_KEY="ACCOUNT_SID:AUTH_TOKEN"');
    const base = env.sms.baseUrl || "https://api.twilio.com";
    const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: env.sms.senderId, To: to, Body: body }).toString(),
    });
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    return { id: json.sid ?? "unknown", delivered: true };
  },
};

/**
 * MSG91 Flow API (shape per docs: POST https://api.msg91.com/api/v5/flow/ with
 * an `authkey` header and a DLT-registered template). Indian SMS is
 * template-bound under TRAI DLT, so the message content travels as the
 * template variable named by SMS_DLT_VAR — it must match the variable name in
 * the registered template exactly. SMS_BASE_URL overrides the host for stubs.
 */
const msg91Sms: SmsProvider = {
  name: "msg91",
  async send(to, body, opts) {
    if (!env.sms.apiKey) throw new Error("MSG91 needs SMS_API_KEY (authkey)");
    const templateId = opts?.templateId ?? env.sms.dltTemplateId;
    if (!templateId) throw new Error("MSG91 needs SMS_DLT_TEMPLATE_ID (DLT-registered)");
    const base = env.sms.baseUrl || "https://api.msg91.com";
    const res = await fetch(`${base}/api/v5/flow/`, {
      method: "POST",
      headers: { "content-type": "application/json", authkey: env.sms.apiKey },
      body: JSON.stringify({
        template_id: templateId,
        sender: env.sms.senderId,
        short_url: "0",
        recipients: [{ mobiles: to.replace(/^\+/, ""), [env.sms.dltVar]: body }],
      }),
    });
    if (!res.ok) throw new Error(`MSG91 send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json().catch(() => ({}))) as { data?: string; message?: string };
    return { id: json.data ?? json.message ?? "unknown", delivered: true };
  },
};

/** Never guess a vendor's wire format: unverified providers refuse loudly. */
const unsupportedSms = (name: string): SmsProvider => ({
  name,
  async send() {
    throw new Error(
      `SMS provider "${name}" has no verified adapter yet — use twilio, msg91, or console, ` +
      `or add an adapter after checking the vendor's current API documentation`,
    );
  },
});

export const sms: SmsProvider =
  env.sms.provider === "console" ? consoleSms :
  env.sms.provider === "twilio" ? twilioSms :
  env.sms.provider === "msg91" ? msg91Sms :
  unsupportedSms(env.sms.provider);

// ── Maps ──────────────────────────────────────────────────────────────────
export interface MapsProvider {
  readonly name: string;
  /** Straight-line fallback is honest about being an estimate. */
  route(from: LatLng, to: LatLng): Promise<{ distanceKm: number; durationMinutes: number; estimated: boolean }>;
  reverseGeocode(at: LatLng): Promise<{ label: string; estimated: boolean }>;
}
export interface LatLng { lat: number; lng: number }

const R = 6371;
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const localMaps: MapsProvider = {
  name: "local",
  async route(from, to) {
    const straight = haversineKm(from, to);
    // Indian urban road networks run roughly 1.35x straight-line distance.
    const distanceKm = Number((straight * 1.35).toFixed(2));
    return { distanceKm, durationMinutes: Math.max(5, Math.round((distanceKm / 22) * 60) + 4), estimated: true };
  },
  async reverseGeocode(at) {
    return { label: `${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`, estimated: true };
  },
};

function httpMaps(): MapsProvider {
  return {
    name: env.maps.provider,
    async route(from, to) {
      const url = `${env.maps.baseUrl}/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${env.maps.apiKey}` } });
      if (!res.ok) return localMaps.route(from, to);           // degrade, never fail the booking
      const j = (await res.json()) as { distanceKm: number; durationMinutes: number };
      return { ...j, estimated: false };
    },
    async reverseGeocode(at) {
      const url = `${env.maps.baseUrl}/reverse?lat=${at.lat}&lng=${at.lng}`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${env.maps.apiKey}` } });
      if (!res.ok) return localMaps.reverseGeocode(at);
      const j = (await res.json()) as { label: string };
      return { label: j.label, estimated: false };
    },
  };
}

export const maps: MapsProvider = env.maps.provider === "local" ? localMaps : httpMaps();

// ── AI ────────────────────────────────────────────────────────────────────
export interface DiagnosisResult extends Diagnosis {
  modelVersion: string;
  usedFallback: boolean;
  latencyMs: number;
}

/**
 * ADR-0006: the rules result is always computed. A remote model is consulted
 * only if configured, and its answer is used only if it is confident AND it does
 * not claim the vehicle is safe to drive when the rules say it is not.
 */
export async function diagnoseWithFallback(input: {
  symptoms?: string; dtcCodes?: string[]; vehicleClass?: string;
}): Promise<DiagnosisResult> {
  const t0 = Date.now();
  const rules = diagnose(input);

  if (env.ai.provider === "rules" || !env.ai.baseUrl) {
    return { ...rules, modelVersion: "rules-1.0.0", usedFallback: true, latencyMs: Date.now() - t0 };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), env.ai.timeoutMs);
    const res = await fetch(`${env.ai.baseUrl}/diagnose`, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify(input),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`model returned ${res.status}`);
    const model = (await res.json()) as Partial<Diagnosis> & { modelVersion?: string };

    if (typeof model.confidence !== "number" || model.confidence < env.ai.minConfidence) {
      return { ...rules, modelVersion: "rules-1.0.0", usedFallback: true, latencyMs: Date.now() - t0 };
    }

    return {
      cause: model.cause ?? rules.cause,
      confidence: model.confidence,
      severity: (model.severity ?? rules.severity) as Diagnosis["severity"],
      // Safety asymmetry: a model may make a verdict stricter, never laxer.
      driveable: rules.driveable === false ? false : (model.driveable ?? rules.driveable),
      parts: model.parts?.length ? model.parts : rules.parts,
      advice: model.advice ?? rules.advice,
      modelVersion: model.modelVersion ?? "remote-unknown",
      usedFallback: false,
      latencyMs: Date.now() - t0,
    };
  } catch {
    // Timeout, network error, bad payload — the product keeps working.
    return { ...rules, modelVersion: "rules-1.0.0", usedFallback: true, latencyMs: Date.now() - t0 };
  }
}

// ── EMAIL ─────────────────────────────────────────────────────────────────
export interface EmailProvider {
  readonly name: string;
  send(to: string, subject: string, body: string, opts?: { html?: string }): Promise<{ id: string; delivered: boolean }>;
}

/** Logs instead of sending — the default, and what the email path is tested against. */
const consoleEmail: EmailProvider = {
  name: "console",
  async send(to, subject, body) {
    console.log(`[email:console] → ${to}\n  subject: ${subject}\n  ${body.replace(/\n/g, "\n  ")}`);
    return { id: `dev-${Date.now()}`, delivered: true };
  },
};

/**
 * Generic transactional-email API adapter (SendGrid / Mailgun / Resend all
 * accept a JSON POST with a Bearer key). EMAIL_BASE_URL is the vendor endpoint;
 * the {from,to,subject,text,html} shape is what those APIs converge on.
 */
const httpEmail: EmailProvider = {
  name: env.email.provider,
  async send(to, subject, body, opts) {
    if (!env.email.apiKey || !env.email.baseUrl) {
      throw new Error('Email provider "http" needs EMAIL_API_KEY and EMAIL_BASE_URL');
    }
    const res = await fetch(env.email.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.email.apiKey}` },
      body: JSON.stringify({ from: env.email.from, to, subject, text: body, html: opts?.html }),
    });
    if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? "unknown", delivered: true };
  },
};

export const email: EmailProvider = env.email.provider === "console" ? consoleEmail : httpEmail;

export const providerSummary = () => ({
  sms: sms.name,
  maps: maps.name,
  ai: env.ai.provider,
  payments: env.payments.provider,
  email: email.name,
});
