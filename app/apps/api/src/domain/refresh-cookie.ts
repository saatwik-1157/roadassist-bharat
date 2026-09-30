/**
 * The web pages' refresh cookie: its name, its attributes, and who may use it.
 * Pure functions over header values, so they are tested without a server
 * (refresh-cookie.test.ts); auth.ts applies them to a request. The reasoning
 * behind each attribute is in auth.ts, next to where the cookie is issued.
 */

/** The header a web page sends to opt into the cookie: `web` or `web-<slot>`. */
export const WEB_CLIENT_HEADER = "x-ra-client";
const WEB_CLIENT = /^web(?:-([a-z]{1,16}))?$/;
const COOKIE_PREFIX = "ra_rt_";
/** Only the refresh and sign-out routes ever see the cookie. */
export const REFRESH_COOKIE_PATH = "/v1/auth";

/** The web slot a header value names, or null for a native (body-token) client. */
export function webClientSlot(header: string | string[] | undefined): string | null {
  const m = typeof header === "string" ? WEB_CLIENT.exec(header.trim().toLowerCase()) : null;
  return m ? (m[1] ?? "web") : null;
}

export const refreshCookieName = (slot: string) => COOKIE_PREFIX + slot;

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

/** The slot's refresh token from a Cookie header, if it is shaped like one this server issues. */
export function refreshTokenFromCookies(header: string | undefined, slot: string): string | undefined {
  const v = parseCookies(header).get(refreshCookieName(slot));
  // Issued tokens are base64url (auth.ts newRefreshToken), so no decoding.
  return v && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : undefined;
}

/** Whether a Cookie header carries any web refresh cookie at all. */
export const carriesRefreshCookie = (header: string | undefined) =>
  [...parseCookies(header).keys()].some((k) => k.startsWith(COOKIE_PREFIX));

/**
 * The Set-Cookie value carrying `token` for `maxAgeSeconds`, or clearing the
 * slot's cookie when the token is null. HTTPS: SameSite=None; Secure;
 * Partitioned. Plain http: SameSite=Lax (None needs Secure).
 */
export function refreshCookie(o: { https: boolean; slot: string; token: string | null; maxAgeSeconds: number }): string {
  return [
    `${refreshCookieName(o.slot)}=${o.token ?? ""}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    `Max-Age=${o.token ? Math.round(o.maxAgeSeconds) : 0}`,
    ...(o.https ? ["SameSite=None", "Secure", "Partitioned"] : ["SameSite=Lax"]),
  ].join("; ");
}
