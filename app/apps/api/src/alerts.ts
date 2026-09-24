/**
 * Operator alerts by email: sign-ins, and the rare events worth reading.
 *
 * Four kinds, chosen by the project owner:
 *
 *   · every sign-in       - capped per hour; the rest are counted and reported
 *                           in the next email that goes out, never dropped silently
 *   · a first sign-in     - the first time a number ever signs in
 *   · emergencies         - an SOS confirmed, and an off-grid SOS that reached
 *                           the server later (the email says how long it waited
 *                           on the device: evidence the off-grid path worked)
 *   · suspicious activity - a burst of wrong OTP codes for one number, and any
 *                           admin or authority sign-in
 *
 * Sent SERVER-SIDE through the email provider in providers.ts, so the provider
 * key lives in the host's environment and never reaches a browser, and no
 * visitor's IP goes anywhere. What an email carries is deliberately thin: a
 * masked number (last three digits), a role, an event and a time. Never a
 * name, a position, an IP address or a device.
 *
 * Alerts never sit in the path of the thing they describe. A slow or failing
 * mail provider cannot delay a sign-in or an SOS: delivery is fire-and-forget,
 * and a failure is logged with its reason. Off unless ALERT_EMAIL_TO is set,
 * and the boot log says which state it is in, including the case where it is
 * "on" but the provider is the console one that emails nobody.
 */
import { env } from "./env.js";
import { email } from "./providers.js";

export type AlertKind =
  | "signin" | "first-signin" | "privileged-signin"
  | "otp-burst" | "sos-confirmed" | "sos-synced";

export interface Alert { kind: AlertKind; subject: string; lines: string[] }

/** Roles whose every sign-in is worth a look, whatever the hourly cap says. */
const PRIVILEGED = new Set(["admin", "authority", "ops", "operator"]);

/**
 * "+919876543210" -> "+91 ••••••• 210". Only the last three digits survive,
 * and the mask is a fixed width so it does not give away the length either.
 */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  const cc = msisdn.startsWith("+91") && digits.length === 12 ? "+91 " : "";
  return cc + "•••••••" + " " + digits.slice(-3);
}

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
});
const when = (ms: number) => IST.format(new Date(ms)) + " IST";

/**
 * The decisions, with no I/O: what to send, what to hold back, what to count.
 * `send` is injected so tests observe exactly what would have gone out.
 */
export class AlertGate {
  private signinWindowStart = 0;
  private signinsSent = 0;
  private suppressed = 0;
  private suppressedSince = 0;
  private readonly otpFailures = new Map<string, number[]>();
  private readonly burstAlerted = new Map<string, number>();

  constructor(
    private readonly send: (a: Alert) => void,
    private readonly opts: { signinsPerHour: number; otpBurst: number; otpWindowMs: number; now?: () => number },
  ) {}

  private now() { return (this.opts.now ?? Date.now)(); }

  signin(msisdn: string, roles: string[], newAccount: boolean) {
    const t = this.now(), who = maskMsisdn(msisdn), role = roles.join(", ") || "citizen";
    const privileged = roles.some((r) => PRIVILEGED.has(r));
    if (privileged) {
      return this.send({ kind: "privileged-signin", subject: `Privileged sign-in: ${role} · ${who}`,
        lines: [`${/^[aeiou]/i.test(role) ? "An" : "A"} ${role} account signed in.`, `Account: ${who}`, `Time: ${when(t)}`,
          "If this was not expected, revoke the session from the admin console."] });
    }
    if (newAccount) {
      return this.send({ kind: "first-signin", subject: `New account signed in · ${who}`,
        lines: ["A number signed in for the first time.", `Account: ${who}`, `Role: ${role}`, `Time: ${when(t)}`] });
    }
    if (t - this.signinWindowStart >= 3_600_000) { this.signinWindowStart = t; this.signinsSent = 0; }
    if (this.signinsSent >= this.opts.signinsPerHour) {
      if (!this.suppressed) this.suppressedSince = t;
      this.suppressed++;
      return;
    }
    this.signinsSent++;
    const lines = ["A returning account signed in.", `Account: ${who}`, `Role: ${role}`, `Time: ${when(t)}`];
    if (this.suppressed) {
      lines.push(`Also: ${this.suppressed} more sign-in${this.suppressed === 1 ? "" : "s"} since ${when(this.suppressedSince)} ` +
        `were not emailed one by one (limit ${this.opts.signinsPerHour} an hour).`);
      this.suppressed = 0;
    }
    this.send({ kind: "signin", subject: `Sign-in · ${who}`, lines });
  }

  /** A wrong or locked-out code. Alerts once per number per window, at the threshold. */
  otpFailure(msisdn: string) {
    const t = this.now(), w = this.opts.otpWindowMs;
    const recent = (this.otpFailures.get(msisdn) ?? []).filter((x) => t - x < w);
    recent.push(t);
    this.otpFailures.set(msisdn, recent);
    if (this.otpFailures.size > 10_000) this.prune(t);
    const last = this.burstAlerted.get(msisdn);
    if (recent.length >= this.opts.otpBurst && (last === undefined || t - last >= w)) {
      this.burstAlerted.set(msisdn, t);
      const who = maskMsisdn(msisdn);
      this.send({ kind: "otp-burst", subject: `Possible code guessing · ${who}`,
        lines: [`${recent.length} wrong sign-in codes for one number in ${Math.round(w / 60000)} minutes.`,
          `Account: ${who}`, `Time: ${when(t)}`,
          "Each code is still capped at a few attempts; this is a heads-up, not a breach."] });
    }
  }

  sosConfirmed(incidentId: string, contactsAlerted: number) {
    this.send({ kind: "sos-confirmed", subject: `SOS confirmed · incident ${incidentId.slice(0, 8)}`,
      lines: ["A person confirmed an emergency and it was escalated.", `Incident: ${incidentId.slice(0, 8)}`,
        `Emergency contacts alerted: ${contactsAlerted}`, `Time: ${when(this.now())}`] });
  }

  sosSynced(count: number, longestOfflineMs: number) {
    const mins = Math.max(1, Math.round(longestOfflineMs / 60000));
    this.send({ kind: "sos-synced", subject: `Off-grid SOS reached the server (${count})`,
      lines: [`${count} emergenc${count === 1 ? "y" : "ies"} raised with no network just arrived.`,
        `The longest had waited on the device for about ${mins} minute${mins === 1 ? "" : "s"}.`,
        "Nothing is alerted until the person confirms; this is the record arriving.", `Time: ${when(this.now())}`] });
  }

  private prune(t: number) {
    for (const [k, v] of this.otpFailures) if (!v.some((x) => t - x < this.opts.otpWindowMs)) this.otpFailures.delete(k);
  }
}

/**
 * ALERT_EMAIL_TO as a list: comma- or semicolon-separated, trimmed, anything
 * that is not an address dropped, duplicates removed however they are cased,
 * and capped at 50, the most one Resend request accepts.
 */
export function recipients(raw: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const addr = part.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || seen.has(addr.toLowerCase())) continue;
    seen.add(addr.toLowerCase());
    out.push(addr);
  }
  return out.slice(0, 50);
}

// ── wiring ────────────────────────────────────────────────────────────────
const stats = { sent: 0, failed: 0, lastError: "" };
const TO = recipients(env.alerts.to);

function deliver(a: Alert) {
  const body = [...a.lines, "",
    "Phone numbers are masked. These emails never carry a name, a location, an IP address or a device.",
    `Sent by ${env.alerts.label}.`].join("\n");
  email.send(TO, `[RoadAssist] ${a.subject}`, body)
    .then(() => { stats.sent++; })
    .catch((err: unknown) => {
      stats.failed++;
      stats.lastError = err instanceof Error ? err.message.slice(0, 160) : String(err);
      console.warn(`[alerts] ${a.kind} not delivered: ${stats.lastError}`);
    });
}

export const alerts = new AlertGate(
  (a) => { if (TO.length) deliver(a); },
  { signinsPerHour: env.alerts.signinsPerHour, otpBurst: env.alerts.otpBurst, otpWindowMs: 10 * 60_000 },
);

/** One line for the boot log, so "on" and "off" are never a guess. */
export function alertsStatus(): string {
  if (!TO.length) return env.alerts.to ? "alerts: off (ALERT_EMAIL_TO has no valid address)" : "alerts: off (ALERT_EMAIL_TO unset)";
  const to = TO.length === 1 ? TO[0].replace(/^(.).*(@.*)$/, "$1…$2") : `${TO.length} recipients`;
  return email.name === "console"
    ? `alerts: to ${to} via console - LOGGED ONLY, nothing is emailed (set EMAIL_PROVIDER=http)`
    : `alerts: to ${to} via ${email.name}`;
}

export const alertStats = () => ({ ...stats });
