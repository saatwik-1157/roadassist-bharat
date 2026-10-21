/**
 * What the console SMS provider may print.
 *
 * The console provider is not only a development tool: the hosted demo runs on
 * it, and its stdout is the host's log stream. Printed in full, every line was a
 * phone number, a live sign-in code or the text of somebody's emergency — in a
 * log that more people can read than should.
 *
 * In development and test nothing changes: developers read their sign-in codes
 * from exactly this output. Everywhere else the number keeps only its last four
 * digits and any six-digit code in the body is replaced.
 */

/** Environments whose console output is a developer's own terminal. */
export function isDeveloperConsole(nodeEnv: string): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** `+917000009876` → `+91******9876`. Anything shorter than five digits is hidden entirely. */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, "");
  if (digits.length < 5) return "****";
  const prefix = msisdn.startsWith("+91") ? "+91" : msisdn.startsWith("+") ? "+" : "";
  const rest = prefix === "+91" ? digits.slice(2) : digits;
  // "+91" plus four digits or fewer: the last four would be all of them, and
  // three or fewer threw a RangeError from repeat(-1) inside the SMS provider.
  if (rest.length <= 4) return prefix + "****";
  return prefix + "*".repeat(rest.length - 4) + rest.slice(-4);
}

/**
 * Replace every standalone six-digit run — the shape of every OTP this
 * platform issues. Longer digit runs (a phone number, a reference) are left
 * alone, so the redaction removes codes without shredding the rest.
 */
export function redactCodes(body: string): string {
  return body.replace(/(?<!\d)\d{6}(?!\d)/g, "••••••");
}

/** `someone@example.com` → `s***@example.com`. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 1 ? "***" : `${address[0]}***${address.slice(at)}`;
}

/** What the console EMAIL provider prints: same rule — sign-in codes and addresses masked. */
export function consoleEmailLine(to: string | string[], subject: string, body: string, nodeEnv: string): string {
  const dev = isDeveloperConsole(nodeEnv);
  const shownTo = [to].flat().map((a) => (dev ? a : maskEmail(a))).join(", ");
  const shownBody = dev ? body : redactCodes(body);
  return `[email:console] → ${shownTo}\n  subject: ${dev ? subject : redactCodes(subject)}\n  ${shownBody.replace(/\n/g, "\n  ")}`;
}

/** The line the console provider prints for one message. */
export function consoleSmsLine(to: string, body: string, nodeEnv: string): string {
  const shownTo = isDeveloperConsole(nodeEnv) ? to : maskMsisdn(to);
  const shownBody = isDeveloperConsole(nodeEnv) ? body : redactCodes(body);
  return `[sms:console] → ${shownTo}\n            ${shownBody.replace(/\n/g, "\n            ")}`;
}

// ── the access log and every other log line ────────────────────────────────
//
// The host's log stream is read by more people, and kept longer, than any
// table holding the same facts. A full request URL put a person's position in
// it on every map and geo call (/v1/map/live?lat=..&lng=.., /v1/geo/route?
// fromLat=..), a map tile's x/y pinned the area they were looking at, and the
// client's address went beside each one. None of that is needed to run or
// debug the service, so none of it is written (logging.ts applies these to
// every line, whoever logs it).

/**
 * Query keys whose values are never personal: paging, filters, flags. Every
 * other key is dropped, value and all, so a new route's `?lat=` is left out
 * by default rather than by remembering to add it to a denylist.
 */
export const LOGGED_QUERY_KEYS: ReadonlySet<string> = new Set([
  "link", "limit", "type", "source", "overdueOnly", "radiusKm", "detail",
]);

/**
 * A request URL as the access log may record it: the path, plus only the
 * allow-listed query keys. When anything was dropped the URL ends in
 * `[redacted]`, so a reader knows a query was there.
 *
 * Map tiles are the one path that carries a position: /tiles/z/x/y and
 * /basemap/z/x/y name a square a few hundred metres wide at street zoom, and
 * the app centres on the user. Only the zoom is kept.
 *
 * Google's redirect back (code and state) is covered by the same rule.
 */
export function urlForLog(url: string): string {
  const q = url.indexOf("?");
  let path = q === -1 ? url : url.slice(0, q);
  const tile = /^\/(tiles|basemap)\/(\d{1,2})\/.+$/.exec(path);
  if (tile) path = `/${tile[1]}/${tile[2]}/[redacted]`;
  if (q === -1) return path;
  const kept: string[] = [];
  let dropped = false;
  for (const part of url.slice(q + 1).split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    let key = eq === -1 ? part : part.slice(0, eq);
    try { key = decodeURIComponent(key); } catch { /* malformed: judged as written */ }
    if (LOGGED_QUERY_KEYS.has(key)) kept.push(part);
    else dropped = true;
  }
  if (!kept.length && !dropped) return path;
  return `${path}?${[...kept, ...(dropped ? ["[redacted]"] : [])].join("&")}`;
}

/**
 * A client address coarsened for a log line: IPv4 to its /24, IPv6 to its
 * /48. Used only where an address genuinely helps an investigation (the
 * rate limiter's "limit exceeded" line, which is what an abuse report starts
 * from); the access log carries no address at all.
 *
 * Why a truncated prefix and not a daily-salted hash: the action an abuse
 * investigation leads to is blocking a range at the edge (Cloudflare acts on
 * prefixes), which a hash cannot express; a prefix needs no secret to keep or
 * rotate, and correlates across days without a lookup table. A /24 is shared
 * by up to 256 addresses and, on Indian mobile networks, by a carrier NAT
 * pool, so it does not single out a person; a /48 is one site's allocation.
 * Loopback and unspecified addresses are not personal and stay as they are.
 */
export function ipForLog(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip.trim());
  if (v4) {
    if (v4[1] === "127" || ip.trim() === "0.0.0.0") return v4.slice(1, 5).join(".");
    return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  }
  if (ip.includes(":")) {
    if (ip === "::1" || ip === "::") return ip;
    const [head] = ip.split("%");
    const halves = head.split("::");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
    const groups = halves.length > 1
      ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
      : left;
    if (groups.length < 3 || groups.slice(0, 3).some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return "[ip]";
    return `${groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/48`;
  }
  return "[ip]";
}

/**
 * A rate-limit principal as it may be logged: an account id as it is (a
 * pseudonymous key, the same one every other line carries), an address
 * coarsened (ipForLog), a sending number masked to its last four digits.
 */
export function principalForLog(principal: string): string {
  if (principal.startsWith("ip:")) return `ip:${ipForLog(principal.slice(3))}`;
  if (principal.startsWith("msisdn:")) return `msisdn:${maskMsisdn(principal.slice(7))}`;
  return principal;
}

/**
 * Field names never written to a log with their value, at any depth, by any
 * call site (logging.ts). Narrower than observability.ts's list on purpose:
 * this one runs on every line the server writes, including Fastify's own and
 * the boot lines, so it holds only names that are personal or secret
 * whatever they are attached to - not "code" or "email", which also name an
 * error code and an email provider.
 */
export const NEVER_LOGGED_KEYS: ReadonlySet<string> = new Set([
  "lat", "lng", "latitude", "longitude", "fromlat", "fromlng", "tolat", "tolng", "position", "coords",
  "msisdn", "phone", "mobile",
  "telegramchatid", "chatid", "chat_id",
  "googleemail", "googlesub", "idtoken", "nonce",
  "token", "accesstoken", "refreshtoken", "authorization", "cookie", "password", "secret", "otp",
  "ip", "remoteaddress", "remoteport", "x-forwarded-for", "cf-connecting-ip",
  "fullname",
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** +91 7000009876, +917000009876, 7000009876: an Indian mobile, or any +CC number of 10-15 digits. */
const PHONE = /(?<![\w.+-])(?:\+\d{1,3}[ -]?)?[6-9]\d{9}(?![\w.-])|\+\d{10,15}(?![\w.-])/g;
/** A coordinate as a client sends one: three or more decimals, not part of a dotted address or version. */
const COORD = /(?<![\w.])-?\d{1,3}\.\d{3,}(?![\d.])/g;
const IPV4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const BOT_TOKEN = /\b\d{6,12}:[\w-]{30,}\b/g;
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi;
/** Drizzle's "Failed query: ...\nparams: a,b,c" puts every bound value in the message. */
const PARAMS = /\bparams:[^\n]*/g;

/**
 * Scrub a free-text log message or field: bound query parameters, bearer
 * tokens and JWTs, bot tokens, email addresses (masked), phone numbers (last
 * four kept), coordinates and IPv4 addresses (to their /24). The last line
 * of defence for text a call site did not build itself - an error message
 * from a driver or a vendor, a template string.
 */
export function scrubLogText(text: string): string {
  return text
    .replace(PARAMS, "params: [redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[jwt]")
    .replace(BOT_TOKEN, "[token]")
    .replace(EMAIL, (m) => maskEmail(m))
    .replace(PHONE, (m) => maskMsisdn(m.replace(/[ -]/g, "")))
    .replace(IPV4, (m) => ipForLog(m))
    .replace(COORD, "[coord]");
}

/**
 * A log object made safe: NEVER_LOGGED_KEYS replaced at any depth, every
 * string scrubbed. Only plain objects and arrays are walked - a request, a
 * reply or an Error is left to its own serializer (logging.ts), and a deep or
 * huge value is cut off rather than walked forever.
 */
export function scrubLogObject(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubLogText(value);
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubLogObject(v, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = NEVER_LOGGED_KEYS.has(key.toLowerCase()) ? "[redacted]" : scrubLogObject(v, depth + 1);
  }
  return out;
}

/**
 * An error as a log may carry it: type, scrubbed message and stack, and a
 * code. Not the driver's own `query` and `parameters` properties, which hold
 * the SQL's bound values - a phone number, a position - verbatim.
 */
export function errForLog(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: scrubLogText(String(err)) };
  const e = err as Error & { code?: unknown; statusCode?: unknown; cause?: unknown };
  return {
    type: e.name,
    message: scrubLogText(e.message),
    ...(e.stack ? { stack: scrubLogText(e.stack) } : {}),
    ...(typeof e.code === "string" || typeof e.code === "number" ? { code: e.code } : {}),
    ...(typeof e.statusCode === "number" ? { statusCode: e.statusCode } : {}),
    ...(e.cause instanceof Error ? { cause: scrubLogText(`${e.cause.name}: ${e.cause.message}`) } : {}),
  };
}
