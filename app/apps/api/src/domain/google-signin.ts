/**
 * Sign in with Google: the rules, with no database and no network of their
 * own, so apps/api/test/google-signin.test.ts can pin every one of them.
 * routes/google-auth.ts applies them.
 *
 * ── the two flows ─────────────────────────────────────────────────────────
 * WEB: an OAuth 2.0 authorization-code flow with PKCE (S256), state and nonce,
 * run entirely by the server. The page holds a plain link to our own
 * /v1/auth/google/start; that route answers with a 302 to Google, so the
 * visitor's browser NAVIGATES there because they clicked. No page loads
 * Google's script, button or iframe - the residency gate and the CSP are
 * unchanged. Google redirects back to /v1/auth/google/callback, where the
 * server exchanges the code (with the PKCE verifier and the client secret) and
 * verifies the ID token that comes back.
 *
 * ANDROID: Credential Manager with the WEB client id as serverClientId and a
 * nonce this server issued. The app posts the ID token; the server verifies it
 * exactly as it verifies the web one, plus `azp` = the Android client id.
 *
 * ── what makes a token acceptable ─────────────────────────────────────────
 * RS256 only, signed by a key in Google's JWKS (cached as long as Google's
 * Cache-Control says); iss is Google; aud is OUR web client id; azp, where
 * given, is one of our client ids; exp/iat/nbf within a minute of skew; the
 * nonce is the one we issued, and is spent exactly once; email_verified is
 * true. Any failure is a refusal with a reason, never an exception.
 *
 * ── who a Google identity may be ─────────────────────────────────────────
 * Keyed on `sub` alone, never the email (an address can change hands, and
 * matching on it would let anyone who controls an address claim the account).
 * A Google sign-in only ever creates or enters a CITIZEN account: never an
 * admin, officer, mechanic, fleet or support account, and never one listed in
 * EMAIL_SIGNIN, whatever the emails say. Linking needs the account's own
 * session plus a fresh Google token. See decideGoogleSignin / decideGoogleLink
 * / decidePhoneAttach below.
 */
import {
  createCipheriv, createDecipheriv, createHash, createPublicKey, hkdfSync, randomBytes,
  timingSafeEqual, verify as verifySignature, type KeyObject,
} from "node:crypto";

// ── configuration ──────────────────────────────────────────────────────────

export interface GoogleConfig {
  /** The WEB OAuth client id: the audience of every ID token we accept. */
  clientId: string;
  clientSecret: string;
  /** Exactly the redirect URI registered on the web client. */
  redirectUri: string;
  /** The Android OAuth client id: the `azp` of a token from the app. Optional. */
  androidClientId: string;
  /** Tests only: a local stub standing in for all three Google hosts. */
  apiBase: string;
}

/** The web flow is on only when all three web values are set. */
export function googleWebEnabled(c: GoogleConfig): boolean {
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

/** The Android flow additionally needs the Android client id. */
export function googleAndroidEnabled(c: GoogleConfig): boolean {
  return googleWebEnabled(c) && Boolean(c.androidClientId);
}

const CLIENT_ID = /^[0-9]{6,32}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/;
export const CALLBACK_PATH = "/v1/auth/google/callback";

/**
 * What is wrong with a Google configuration, for validateEnv to refuse at
 * boot. All or none, as with Telegram: a half-set configuration would show a
 * button that fails on the first press. Never echoes the secret.
 */
export function googleConfigProblems(c: GoogleConfig, o: { production: boolean }): string[] {
  const named: Array<[string, string]> = [
    ["GOOGLE_CLIENT_ID", c.clientId],
    ["GOOGLE_CLIENT_SECRET", c.clientSecret],
    ["GOOGLE_REDIRECT_URI", c.redirectUri],
  ];
  const missing = named.filter(([, v]) => !v).map(([k]) => k);
  const problems: string[] = [];
  if (missing.length === 3) {
    if (c.androidClientId) {
      problems.push("GOOGLE_ANDROID_CLIENT_ID is set but the web client is not: Android sign-in is verified " +
        "against the web client id, so set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI too, " +
        "or unset it.");
    }
    return problems;
  }
  if (missing.length) {
    problems.push(
      "Google sign-in needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI together; " +
      `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} unset. ` +
      "Set all three, or unset all three (and GOOGLE_ANDROID_CLIENT_ID) to turn the feature off.",
    );
  }
  if (c.clientId && !CLIENT_ID.test(c.clientId)) {
    problems.push("GOOGLE_CLIENT_ID does not look like a Google OAuth client id (<digits>-<letters>.apps.googleusercontent.com).");
  }
  if (c.androidClientId && !CLIENT_ID.test(c.androidClientId)) {
    problems.push("GOOGLE_ANDROID_CLIENT_ID does not look like a Google OAuth client id (<digits>-<letters>.apps.googleusercontent.com).");
  }
  if (c.androidClientId && c.androidClientId === c.clientId) {
    problems.push("GOOGLE_ANDROID_CLIENT_ID must be the ANDROID client's id, not the web client's.");
  }
  if (c.clientSecret && !/^[A-Za-z0-9_-]{16,128}$/.test(c.clientSecret)) {
    problems.push("GOOGLE_CLIENT_SECRET must be 16-128 characters of A-Z, a-z, 0-9, _ and - (as Google issues it).");
  }
  if (c.redirectUri) {
    let u: URL | null = null;
    try { u = new URL(c.redirectUri); } catch { /* reported below */ }
    const local = u ? ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) : false;
    if (!u || u.pathname !== CALLBACK_PATH || u.search || u.hash) {
      problems.push(`GOOGLE_REDIRECT_URI must be an absolute URL ending in ${CALLBACK_PATH}, with no query, ` +
        "exactly as registered on the web client.");
    } else if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
      problems.push("GOOGLE_REDIRECT_URI must be https (plain http is only for localhost).");
    } else if (o.production && u.protocol !== "https:") {
      problems.push("GOOGLE_REDIRECT_URI must be https in production.");
    }
  }
  if (c.apiBase && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(c.apiBase)) {
    problems.push("GOOGLE_API_BASE is for a LOCAL test stub only, an origin like http://127.0.0.1:4698 with no path.");
  }
  if (c.apiBase && o.production) {
    problems.push("GOOGLE_API_BASE (a test stub) must not be set in production.");
  }
  return problems;
}

// ── Google's endpoints ─────────────────────────────────────────────────────

export interface GoogleEndpoints { authorize: string; token: string; jwks: string }

/**
 * Where each step goes. `authorize` is never fetched by this server: it is
 * only the Location of the 302 the visitor's browser follows after they click
 * (declared as a navigation in scripts/check-data-residency.mjs). `token` and
 * `jwks` are fetched server-side and are declared egress.
 */
const GOOGLE = {
  authorize: { endpoint: "https://accounts.google.com/o/oauth2/v2/auth" },
  token: { endpoint: "https://oauth2.googleapis.com/token" },
  jwks: { endpoint: "https://www.googleapis.com/oauth2/v3/certs" },
} as const;

export function googleEndpoints(apiBase: string): GoogleEndpoints {
  if (apiBase) {
    return { authorize: `${apiBase}/o/oauth2/v2/auth`, token: `${apiBase}/token`, jwks: `${apiBase}/oauth2/v3/certs` };
  }
  return { authorize: GOOGLE.authorize.endpoint, token: GOOGLE.token.endpoint, jwks: GOOGLE.jwks.endpoint };
}

/** The two values Google writes into `iss`. */
export const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;

/** Only what identifies the account. Not `profile`: no name or photo is ever stored. */
export const SCOPES = "openid email";

// ── PKCE, state and nonce ──────────────────────────────────────────────────

/** 32 random bytes, base64url: a state, a nonce or a PKCE verifier (43 characters). */
export const randomToken = () => randomBytes(32).toString("base64url");

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

/** What is stored for a nonce: its SHA-256, so a copy of the table spends nothing. */
export const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** A nonce as this server issues it, and the only shape it will look up. */
export const isWellFormedNonce = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

export function authorizationUrl(o: {
  endpoint: string; clientId: string; redirectUri: string; state: string; nonce: string; verifier: string;
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    scope: SCOPES,
    state: o.state,
    nonce: o.nonce,
    code_challenge: pkceChallenge(o.verifier),
    code_challenge_method: "S256",
    // Always ask which account: on a shared phone or a family laptop the
    // account the browser is already signed in to is often somebody else's.
    prompt: "select_account",
  });
  return `${o.endpoint}?${q.toString()}`;
}

// ── sealed cookies ─────────────────────────────────────────────────────────
/**
 * The short-lived cookies the web flow keeps between start and callback are
 * SEALED: AES-256-GCM under a key derived (HKDF) from JWT_SECRET, with the
 * cookie's kind in the derivation, so a cookie is unreadable to the browser
 * and to anything that copies it, any change to it fails authentication, and
 * one kind of cookie can never be presented as another. Each carries its own
 * expiry, checked on open, besides the cookie's Max-Age.
 */
export type SealKind = "flow" | "link";

function sealKey(secret: string, kind: SealKind): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "roadassist-google-signin", `cookie:${kind}:v1`, 32));
}

export function seal(kind: SealKind, value: Record<string, unknown>, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(secret, kind), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

/** The sealed value, or null when it is malformed, forged, of another kind or past its `exp`. */
export function unseal<T extends { exp: number }>(kind: SealKind, sealed: unknown, secret: string, now = Date.now()): T | null {
  if (typeof sealed !== "string" || sealed.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < 12 + 16 + 2) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", sealKey(secret, kind), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    const v = JSON.parse(text) as T;
    if (!v || typeof v.exp !== "number" || v.exp <= now) return null;
    return v;
  } catch {
    return null;
  }
}

export const FLOW_COOKIE = "ra_g_flow";
export const LINK_COOKIE = "ra_g_link";
export const COOKIE_PATH = "/v1/auth/google";
/** Ten minutes from the click to Google's redirect back: a person choosing an account. */
export const FLOW_TTL_MS = 10 * 60_000;
/** Five minutes from "Link Google" to the start of the flow it opens. */
export const LINK_TTL_MS = 5 * 60_000;

/** One cookie for the flow: HttpOnly, SameSite=Lax (sent on Google's top-level redirect back), path-scoped. */
export function googleCookie(o: { name: string; value: string | null; https: boolean; maxAgeMs: number }): string {
  return [
    `${o.name}=${o.value ?? ""}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    `Max-Age=${o.value ? Math.round(o.maxAgeMs / 1000) : 0}`,
    "SameSite=Lax",
    ...(o.https ? ["Secure"] : []),
  ].join("; ");
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Constant-time comparison of two strings that may differ in length. */
export function sameString(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── Google's signing keys ──────────────────────────────────────────────────

export interface Jwk { kid?: unknown; kty?: unknown; alg?: unknown; use?: unknown; n?: unknown; e?: unknown }

/**
 * How long a JWKS answer may be reused, from its Cache-Control header, in
 * seconds. Google sends `public, max-age=<about six hours>, must-revalidate`.
 * no-store / no-cache / a missing or unreadable max-age mean "do not reuse";
 * a day is the most we will ever trust, whatever the header says.
 */
export function maxAgeSeconds(cacheControl: string | null | undefined): number {
  const cc = String(cacheControl ?? "").toLowerCase();
  if (/(^|[\s,])(no-store|no-cache)([\s,=]|$)/.test(cc)) return 0;
  const m = /(?:^|[\s,])max-age\s*=\s*"?(\d{1,10})"?/.exec(cc);
  if (!m) return 0;
  return Math.min(Number(m[1]), 86_400);
}

/** The RSA signing keys in a JWKS document, by kid. Anything else is ignored. */
export function rsaKeys(doc: unknown): Map<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  const keys = (doc as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) return out;
  for (const k of keys as Jwk[]) {
    if (typeof k?.kid !== "string" || k.kty !== "RSA" || typeof k.n !== "string" || typeof k.e !== "string") continue;
    if (k.use !== undefined && k.use !== "sig") continue;
    if (k.alg !== undefined && k.alg !== "RS256") continue;
    try {
      out.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" }));
    } catch { /* a key Node cannot read is a key nothing can verify against */ }
  }
  return out;
}

/**
 * Google's keys, fetched when needed and kept for as long as the answer's
 * Cache-Control allows. An unknown kid refetches - Google rotates keys - but
 * at most once per `cooldownMs`, so a stream of tokens with made-up kids
 * cannot turn this server into a JWKS hammer. Concurrent misses share one fetch.
 */
export class JwksCache {
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private lastFetch = -Infinity;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly fetchJwks: () => Promise<{ body: unknown; cacheControl: string | null }>,
    private readonly now: () => number = Date.now,
    private readonly cooldownMs = 30_000,
  ) {}

  /** How many fetches have completed - for the tests. */
  fetches = 0;

  private refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = (async () => {
        this.lastFetch = this.now();
        try {
          const { body, cacheControl } = await this.fetchJwks();
          this.keys = rsaKeys(body);
          this.expiresAt = this.now() + maxAgeSeconds(cacheControl) * 1000;
          this.fetches++;
        } finally {
          this.inFlight = null;
        }
      })();
    }
    return this.inFlight;
  }

  async key(kid: string): Promise<KeyObject | null> {
    const fresh = this.now() < this.expiresAt;
    if (fresh && this.keys.has(kid)) return this.keys.get(kid)!;
    if (!fresh || this.now() - this.lastFetch >= this.cooldownMs) {
      try { await this.refresh(); } catch { return null; }
    }
    return this.keys.get(kid) ?? null;
  }
}

// ── the ID token ───────────────────────────────────────────────────────────

export type IdTokenFailure =
  | "malformed" | "bad_alg" | "unknown_key" | "bad_signature" | "bad_issuer" | "bad_audience"
  | "bad_azp" | "expired" | "not_yet_valid" | "nonce_mismatch" | "email_unverified" | "no_subject"
  | "nonce_replayed";

export interface VerifiedGoogleIdentity { sub: string; email: string }

export interface VerifyOptions {
  /** Our web client id. Every accepted token is addressed to it. */
  audience: string;
  /** Client ids `azp` may name. Web: [web id]. Android: [android id]. */
  azp: string[];
  /** Whether a token without `azp` is refused (the Android flow: azp must say it came from our app). */
  azpRequired: boolean;
  /** The nonce this server issued for this attempt. */
  expectedNonce: string;
  keyFor: (kid: string) => Promise<KeyObject | null>;
  /** Spend the nonce. Called last, only for a token that passed every other check; false = already spent. */
  consumeNonce: (nonce: string) => Promise<boolean>;
  now?: number;
  /** Allowed clock difference with Google, in seconds. */
  skewSeconds?: number;
}

function part(s: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * Verify a Google ID token. The order matters only in one place: the nonce is
 * spent LAST, so a forged or expired token cannot use up somebody's real one.
 */
export async function verifyGoogleIdToken(
  token: unknown, o: VerifyOptions,
): Promise<{ ok: true; identity: VerifiedGoogleIdentity } | { ok: false; reason: IdTokenFailure }> {
  const fail = (reason: IdTokenFailure) => ({ ok: false as const, reason });
  if (typeof token !== "string" || token.length > 8192) return fail("malformed");
  const pieces = token.split(".");
  if (pieces.length !== 3) return fail("malformed");
  const header = part(pieces[0]), claims = part(pieces[1]);
  if (!header || !claims || !/^[A-Za-z0-9_-]+$/.test(pieces[2])) return fail("malformed");

  // RS256 and nothing else: not "none", not HS256 keyed with a public key.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return fail("bad_alg");
  const key = await o.keyFor(header.kid);
  if (!key) return fail("unknown_key");
  const signed = verifySignature("RSA-SHA256", Buffer.from(`${pieces[0]}.${pieces[1]}`),
    key, Buffer.from(pieces[2], "base64url"));
  if (!signed) return fail("bad_signature");

  if (!GOOGLE_ISSUERS.includes(claims.iss as typeof GOOGLE_ISSUERS[number])) return fail("bad_issuer");
  if (typeof claims.aud !== "string" || !sameString(claims.aud, o.audience)) return fail("bad_audience");
  if (claims.azp === undefined) {
    if (o.azpRequired) return fail("bad_azp");
  } else if (typeof claims.azp !== "string" || !o.azp.some((a) => sameString(a, claims.azp))) {
    return fail("bad_azp");
  }

  const now = Math.floor((o.now ?? Date.now()) / 1000), skew = o.skewSeconds ?? 60;
  if (typeof claims.exp !== "number" || claims.exp + skew <= now) return fail("expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > now) return fail("not_yet_valid");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - skew > now)) return fail("not_yet_valid");

  if (!sameString(claims.nonce, o.expectedNonce)) return fail("nonce_mismatch");
  // Google sends a boolean; very old tokens carried the string "true".
  if (claims.email_verified !== true && claims.email_verified !== "true") return fail("email_unverified");
  if (typeof claims.sub !== "string" || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)) return fail("no_subject");
  if (typeof claims.email !== "string" || claims.email.length > 160 || !/^[^\s@]+@[^\s@]+$/.test(claims.email)) {
    return fail("email_unverified");
  }

  if (!(await o.consumeNonce(o.expectedNonce))) return fail("nonce_replayed");
  return { ok: true, identity: { sub: claims.sub, email: claims.email.toLowerCase() } };
}

// ── whose account ──────────────────────────────────────────────────────────

/** The only role a Google identity may ever act with. */
const GOOGLE_ROLES = new Set(["citizen"]);

export interface AccountFacts {
  id: string;
  roles: string[];
  msisdn: string | null;
  googleSub?: string | null;
  deleted?: boolean;
}

export type GoogleRefusal =
  | "privileged_account"     // holds any role but citizen
  | "email_signin_account"   // its number is in EMAIL_SIGNIN
  | "account_closed"         // soft-deleted
  | "google_in_use"          // the Google account already enters another RoadAssist account
  | "other_google_linked";   // this account already has a different Google account

/** Why a Google identity may not enter or link this account, or null if it may. */
export function googleAccountRefusal(a: AccountFacts, protectedNumbers: ReadonlySet<string>): GoogleRefusal | null {
  if (a.deleted) return "account_closed";
  if (a.roles.some((r) => !GOOGLE_ROLES.has(r))) return "privileged_account";
  if (a.msisdn && protectedNumbers.has(a.msisdn)) return "email_signin_account";
  return null;
}

export type SigninDecision =
  | { action: "enter"; userId: string }
  | { action: "create" }
  | { action: "refuse"; reason: GoogleRefusal };

/**
 * A Google sign-in: the account already holding this `sub`, or a new citizen
 * account. There is deliberately no email parameter - an account that shares
 * the address but not the sub is somebody else's as far as this is concerned.
 */
export function decideGoogleSignin(bySub: AccountFacts | null, protectedNumbers: ReadonlySet<string>): SigninDecision {
  if (!bySub) return { action: "create" };
  const refusal = googleAccountRefusal(bySub, protectedNumbers);
  return refusal ? { action: "refuse", reason: refusal } : { action: "enter", userId: bySub.id };
}

export type LinkDecision =
  | { action: "link" }
  | { action: "already" }
  /** The sub sits on a Google-only account with no phone: it moves here, and that empty account is closed. */
  | { action: "move"; fromUserId: string }
  | { action: "refuse"; reason: GoogleRefusal };

/**
 * "Link Google", from inside a signed-in account (`target`), for the Google
 * identity `sub` just proven by a fresh token with this server's nonce.
 *
 * The sub may already enter a DIFFERENT account. If that account is a
 * Google-only sign-up that never verified a phone - the usual case: someone
 * pressed "Continue with Google" before linking, then found their number was
 * already registered - the same person has now proven both the phone account
 * (its session) and the Google account (the token), so the sub moves to the
 * phone account and the empty one is closed. Anything else that holds the sub
 * (it has a phone, or a role) is refused: two proven accounts are never merged.
 */
export function decideGoogleLink(
  target: AccountFacts, sub: string, bySub: AccountFacts | null, protectedNumbers: ReadonlySet<string>,
): LinkDecision {
  const refusal = googleAccountRefusal(target, protectedNumbers);
  if (refusal) return { action: "refuse", reason: refusal };
  if (bySub && bySub.id === target.id) return { action: "already" };
  if (target.googleSub && target.googleSub !== sub) return { action: "refuse", reason: "other_google_linked" };
  if (!bySub) return { action: "link" };
  if (!bySub.msisdn && !bySub.deleted && !googleAccountRefusal(bySub, protectedNumbers)) {
    return { action: "move", fromUserId: bySub.id };
  }
  return { action: "refuse", reason: "google_in_use" };
}

export type PhoneDecision =
  | { action: "attach" }
  | { action: "already" }
  | { action: "refuse"; reason: "phone_already_set" | "phone_in_use" };

/**
 * A signed-in account adding a phone it just proved with an OTP.
 *
 * A number that already belongs to ANOTHER account is refused, and neither
 * account changes: proving a phone proves you hold it now, not that you are
 * the person who made the account on it, and handing that account over (or
 * merging into it) would let anyone with a moment's access to somebody's SMS
 * walk off with their bookings, contacts and medical details. The way to join
 * the two is from the other side: sign in with that number, then Link Google.
 */
export function decidePhoneAttach(
  caller: { id: string; msisdn: string | null }, msisdn: string, owner: { id: string } | null,
): PhoneDecision {
  if (caller.msisdn === msisdn) return { action: "already" };
  if (caller.msisdn) return { action: "refuse", reason: "phone_already_set" };
  if (owner && owner.id !== caller.id) return { action: "refuse", reason: "phone_in_use" };
  return { action: "attach" };
}

/** What a person is told for each refusal (the web shows it; Android uses its own strings by code). */
export const REFUSAL_TITLES: Record<GoogleRefusal | IdTokenFailure | "phone_already_set" | "phone_in_use" | "google_cancelled" | "google_failed" | "link_expired", string> = {
  privileged_account: "This account cannot use Google sign-in. Sign in with your phone number.",
  email_signin_account: "This account signs in with its email address, not Google.",
  account_closed: "This account has been closed.",
  google_in_use: "That Google account is already linked to another RoadAssist account.",
  other_google_linked: "A different Google account is already linked to this account.",
  phone_already_set: "This account already has a verified phone number.",
  phone_in_use: "That number already has a RoadAssist account. Sign in with that number, then use Link Google in Settings.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in did not complete. Try again.",
  link_expired: "That Link Google request expired. Press Link Google again.",
  malformed: "Google sign-in did not complete. Try again.",
  bad_alg: "Google sign-in did not complete. Try again.",
  unknown_key: "Google sign-in did not complete. Try again.",
  bad_signature: "Google sign-in did not complete. Try again.",
  bad_issuer: "Google sign-in did not complete. Try again.",
  bad_audience: "Google sign-in did not complete. Try again.",
  bad_azp: "Google sign-in did not complete. Try again.",
  expired: "Google sign-in took too long. Try again.",
  not_yet_valid: "Google sign-in did not complete. Check this device's clock and try again.",
  nonce_mismatch: "Google sign-in did not complete. Try again.",
  nonce_replayed: "That Google sign-in was already used. Try again.",
  email_unverified: "Your Google account's email address is not verified with Google, so it cannot be used to sign in.",
  no_subject: "Google sign-in did not complete. Try again.",
};
