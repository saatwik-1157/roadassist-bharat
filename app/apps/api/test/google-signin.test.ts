/**
 * Sign in with Google (domain/google-signin.ts): the configuration gate, PKCE,
 * the sealed cookies, Google's key cache, every check on the ID token, and
 * who a Google identity may become.
 *
 * Nothing here touches the network or Google. Tokens are signed with an RSA
 * key made in this file and published through an in-memory JWKS. The parts
 * that need a database and a running server - the nonce spent by a
 * conditional UPDATE, the callback's cookies, privileged accounts refused end
 * to end, a phone collision leaving both accounts as they were - run against a
 * local stub of Google in scripts/e2e-journey.mjs §42 and
 * scripts/security-audit.mjs §15.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import {
  CALLBACK_PATH, FLOW_COOKIE, GOOGLE_ISSUERS, JwksCache, authorizationUrl, cookieValue, decideGoogleLink,
  decideGoogleSignin, decidePhoneAttach, googleAccountRefusal, googleAndroidEnabled, googleConfigProblems,
  googleCookie, googleEndpoints, googleWebEnabled, hashNonce, isWellFormedNonce, maxAgeSeconds, pkceChallenge,
  randomToken, rsaKeys, sameString, seal, unseal, verifyGoogleIdToken,
  type AccountFacts, type GoogleConfig, type VerifyOptions,
} from "../src/domain/google-signin.js";
import { urlForLog } from "../src/domain/log-redaction.js";

// ── a stand-in for Google's signing key ────────────────────────────────────

const WEB = "123456789012-webclientabcdefgh.apps.googleusercontent.com";
const ANDROID = "123456789012-androidclientabcd.apps.googleusercontent.com";
const NOW = Date.parse("2026-10-15T06:00:00Z");
const NOW_S = Math.floor(NOW / 1000);

const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "stub-key-1";
const jwk = (k: KeyObject, kid: string) => ({ ...k.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });
const JWKS = { keys: [jwk(google.publicKey, KID)] };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function token(claims: Record<string, unknown>, o: { key?: KeyObject; header?: Record<string, unknown> } = {}): string {
  const head = b64(o.header ?? { alg: "RS256", kid: KID, typ: "JWT" });
  const body = b64(claims);
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), o.key ?? google.privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const NONCE = randomToken();
const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com", aud: WEB, azp: WEB, sub: "110248495921238986420",
  email: "Priya.Sharma@example.com", email_verified: true,
  iat: NOW_S - 10, exp: NOW_S + 3590, nonce: NONCE, ...over,
});

const keys = rsaKeys(JWKS);
function opts(over: Partial<VerifyOptions> = {}): VerifyOptions & { spent: Set<string>; consumed: string[] } {
  const spent = new Set<string>(), consumed: string[] = [];
  return {
    audience: WEB, azp: [WEB], azpRequired: false, expectedNonce: NONCE, now: NOW,
    keyFor: async (kid) => keys.get(kid) ?? null,
    consumeNonce: async (n) => { consumed.push(n); if (spent.has(n)) return false; spent.add(n); return true; },
    spent, consumed, ...over,
  };
}

// ── configuration ──────────────────────────────────────────────────────────

const FULL: GoogleConfig = {
  clientId: WEB, clientSecret: "GOCSPX-stubsecretforunittests", androidClientId: ANDROID,
  redirectUri: "https://app.example.in/v1/auth/google/callback", apiBase: "",
};
const OFF: GoogleConfig = { clientId: "", clientSecret: "", redirectUri: "", androidClientId: "", apiBase: "" };

test("off by default: no values, no problems, no button", () => {
  assert.deepEqual(googleConfigProblems(OFF, { production: true }), []);
  assert.equal(googleWebEnabled(OFF), false);
  assert.equal(googleAndroidEnabled(OFF), false);
});

test("a complete configuration boots, and turns on web and Android", () => {
  assert.deepEqual(googleConfigProblems(FULL, { production: true }), []);
  assert.equal(googleWebEnabled(FULL), true);
  assert.equal(googleAndroidEnabled(FULL), true);
  const webOnly = { ...FULL, androidClientId: "" };
  assert.deepEqual(googleConfigProblems(webOnly, { production: true }), []);
  assert.equal(googleWebEnabled(webOnly), true);
  assert.equal(googleAndroidEnabled(webOnly), false, "Android needs its own client id");
});

test("all or none: any one of the three web values missing refuses to boot", () => {
  for (const key of ["clientId", "clientSecret", "redirectUri"] as const) {
    const problems = googleConfigProblems({ ...FULL, [key]: "" }, { production: false });
    assert.equal(problems.length, 1, key);
    assert.match(problems[0], /together/);
  }
  assert.match(googleConfigProblems({ ...OFF, androidClientId: ANDROID }, { production: false }).join(" "),
    /GOOGLE_ANDROID_CLIENT_ID is set but the web client is not/);
});

test("malformed values are refused, and the secret is never echoed", () => {
  const secret = "has spaces and $ymbols!";
  const all = googleConfigProblems({
    ...FULL, clientId: "not-a-client-id", clientSecret: secret,
  }, { production: false }).join("\n");
  assert.match(all, /GOOGLE_CLIENT_ID does not look like/);
  assert.match(googleConfigProblems({ ...FULL, androidClientId: WEB }, { production: false }).join(),
    /must be the ANDROID client's id/);
  assert.match(all, /GOOGLE_CLIENT_SECRET must be/);
  assert.ok(!all.includes(secret), "a configuration error must not print the secret");
});

test("the redirect URI must be exactly our callback, https outside localhost", () => {
  const p = (redirectUri: string, production = false) => googleConfigProblems({ ...FULL, redirectUri }, { production });
  assert.deepEqual(p("http://localhost:4691" + CALLBACK_PATH), []);
  assert.deepEqual(p("http://127.0.0.1:4000" + CALLBACK_PATH), []);
  assert.match(p("http://app.example.in" + CALLBACK_PATH).join(), /must be https/);
  assert.match(p("http://localhost:4000" + CALLBACK_PATH, true).join(), /https in production/);
  assert.match(p("https://app.example.in/v1/auth/google/other").join(), /ending in/);
  assert.match(p("https://app.example.in" + CALLBACK_PATH + "?x=1").join(), /ending in/);
  assert.match(p("not a url").join(), /ending in/);
});

test("GOOGLE_API_BASE is a local stub only, never in production", () => {
  assert.deepEqual(googleConfigProblems({ ...FULL, apiBase: "http://127.0.0.1:4698" }, { production: false }), []);
  assert.match(googleConfigProblems({ ...FULL, apiBase: "https://evil.example.com" }, { production: false }).join(), /LOCAL test stub/);
  assert.match(googleConfigProblems({ ...FULL, apiBase: "http://127.0.0.1:4698" }, { production: true }).join(), /must not be set in production/);
});

test("Google's real endpoints by default; a stub replaces all three", () => {
  assert.deepEqual(googleEndpoints(""), {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
  });
  const stub = googleEndpoints("http://127.0.0.1:4698");
  for (const v of Object.values(stub)) assert.ok(v.startsWith("http://127.0.0.1:4698/"), v);
  assert.deepEqual([...GOOGLE_ISSUERS], ["accounts.google.com", "https://accounts.google.com"]);
});

// ── PKCE, state, nonce ─────────────────────────────────────────────────────

test("PKCE S256 matches RFC 7636 appendix B", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("state, verifier and nonce are 256-bit random, URL-safe, and the nonce is stored hashed", () => {
  const a = randomToken(), b = randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/, "43 characters is the RFC 7636 minimum verifier length");
  assert.ok(isWellFormedNonce(a));
  assert.ok(!isWellFormedNonce("short") && !isWellFormedNonce(a + "x") && !isWellFormedNonce(42));
  assert.equal(hashNonce(a), createHash("sha256").update(a).digest("hex"));
});

test("the authorization URL asks for openid and email only, with S256, state, nonce and an account chooser", () => {
  const verifier = randomToken();
  const u = new URL(authorizationUrl({
    endpoint: "https://accounts.google.com/o/oauth2/v2/auth", clientId: WEB,
    redirectUri: FULL.redirectUri, state: "S".repeat(43), nonce: NONCE, verifier,
  }));
  const q = u.searchParams;
  assert.equal(u.host, "accounts.google.com");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("client_id"), WEB);
  assert.equal(q.get("redirect_uri"), FULL.redirectUri);
  assert.equal(q.get("scope"), "openid email", "no profile: no name or photo is ever stored");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("code_challenge"), pkceChallenge(verifier));
  assert.ok(!u.href.includes(verifier), "the verifier itself never leaves the server");
  assert.equal(q.get("state"), "S".repeat(43));
  assert.equal(q.get("nonce"), NONCE);
  assert.equal(q.get("prompt"), "select_account");
  assert.equal(q.get("login_hint"), null, "no address is ever put in a URL");
});

// ── sealed cookies ─────────────────────────────────────────────────────────

const SECRET = "unit-test-jwt-secret-that-is-long-enough-0123456789";

test("a sealed cookie opens only unaltered, unexpired, as its own kind, with the same secret", () => {
  const v = { s: "state", v: "verifier", n: NONCE, p: "signin", u: null, exp: NOW + 60_000 };
  const sealed = seal("flow", v, SECRET);
  assert.ok(!sealed.includes("verifier") && !Buffer.from(sealed, "base64url").toString("latin1").includes("verifier"),
    "the browser cannot read what is inside");
  assert.deepEqual(unseal("flow", sealed, SECRET, NOW), v);
  assert.equal(unseal("flow", sealed, SECRET, NOW + 60_000), null, "expired");
  assert.equal(unseal("link", sealed, SECRET, NOW), null, "a flow cookie is not a link cookie");
  assert.equal(unseal("flow", sealed, SECRET + "x", NOW), null, "another server's secret");
  const raw = Buffer.from(sealed, "base64url");
  for (const i of [0, 12, 20, 30, raw.length - 1]) {
    const bent = Buffer.from(raw); bent[i] ^= 1;
    assert.equal(unseal("flow", bent.toString("base64url"), SECRET, NOW), null, `byte ${i} flipped`);
  }
  for (const junk of [undefined, "", "abc", "!!!!", "a".repeat(5000), 7]) assert.equal(unseal("flow", junk, SECRET, NOW), null);
});

test("the flow cookies are HttpOnly, SameSite=Lax, scoped to the Google routes, Secure on https", () => {
  const c = googleCookie({ name: FLOW_COOKIE, value: "abc", https: true, maxAgeMs: 600_000 });
  assert.equal(c, "ra_g_flow=abc; Path=/v1/auth/google; HttpOnly; Max-Age=600; SameSite=Lax; Secure");
  assert.ok(!googleCookie({ name: FLOW_COOKIE, value: "abc", https: false, maxAgeMs: 1000 }).includes("Secure"));
  assert.match(googleCookie({ name: FLOW_COOKIE, value: null, https: true, maxAgeMs: 0 }), /^ra_g_flow=; .*Max-Age=0/);
  assert.equal(cookieValue("a=1; ra_g_flow=xyz; b=2", FLOW_COOKIE), "xyz");
  assert.equal(cookieValue("ra_g_flowx=1", FLOW_COOKIE), undefined);
});

test("sameString is exact", () => {
  assert.ok(sameString("abc", "abc"));
  assert.ok(!sameString("abc", "abd") && !sameString("abc", "ab") && !sameString(undefined, "abc") && !sameString(["abc"], "abc"));
});

// ── Google's keys ──────────────────────────────────────────────────────────

test("Cache-Control decides how long Google's keys are reused", () => {
  assert.equal(maxAgeSeconds("public, max-age=19976, must-revalidate, no-transform"), 19976);
  assert.equal(maxAgeSeconds("max-age=0"), 0);
  assert.equal(maxAgeSeconds("no-store"), 0);
  assert.equal(maxAgeSeconds("no-cache, max-age=600"), 0);
  assert.equal(maxAgeSeconds("public"), 0, "no max-age: do not reuse");
  assert.equal(maxAgeSeconds(null), 0);
  assert.equal(maxAgeSeconds("max-age=99999999"), 86_400, "never trusted past a day");
});

test("only RSA signing keys are taken from a JWKS", () => {
  const ks = rsaKeys({ keys: [
    jwk(google.publicKey, "a"),
    { ...jwk(google.publicKey, "b"), use: "enc" },
    { ...jwk(google.publicKey, "c"), alg: "RS512" },
    { kty: "oct", kid: "d", k: "c2VjcmV0" },
    { kty: "RSA", kid: "e" },
  ] });
  assert.deepEqual([...ks.keys()], ["a"]);
  assert.equal(rsaKeys(null).size, 0);
  assert.equal(rsaKeys({ keys: "x" }).size, 0);
});

test("the key cache honours max-age, refetches for a new kid at most once per cooldown, and shares a fetch", async () => {
  let t = NOW, served: unknown = JWKS, cc: string | null = "public, max-age=3600";
  const cache = new JwksCache(async () => ({ body: served, cacheControl: cc }), () => t, 30_000);
  assert.ok(await cache.key(KID));
  assert.ok(await cache.key(KID));
  assert.equal(cache.fetches, 1, "cached within max-age");

  assert.equal(await cache.key("rotated"), null);
  assert.equal(cache.fetches, 1, "the keys were fetched this instant: an unknown kid waits out the cooldown");
  t += 30_000;
  assert.equal(await cache.key("rotated"), null);
  assert.equal(cache.fetches, 2, "an unknown kid refetches once");
  assert.equal(await cache.key("rotated"), null);
  assert.equal(cache.fetches, 2, "…and not again inside the cooldown");
  t += 30_000;
  served = { keys: [jwk(google.publicKey, KID), jwk(rogue.publicKey, "rotated")] };
  assert.ok(await cache.key("rotated"), "after the cooldown a rotated key is found");
  assert.equal(cache.fetches, 3);

  t += 3600_000;
  await Promise.all([cache.key(KID), cache.key(KID), cache.key(KID)]);
  assert.equal(cache.fetches, 4, "expired: refetched, once for three concurrent callers");

  cc = "no-store"; t += 3600_000;
  await cache.key(KID); t += 1; await cache.key(KID);
  assert.equal(cache.fetches, 6, "no-store is never reused");
});

test("a JWKS that cannot be fetched is no key, not an exception", async () => {
  const cache = new JwksCache(async () => { throw new Error("down"); }, () => NOW);
  assert.equal(await cache.key(KID), null);
});

// ── the ID token ───────────────────────────────────────────────────────────

test("a genuine token is accepted, its nonce spent, and only sub and email come back", async () => {
  const o = opts();
  const r = await verifyGoogleIdToken(token(goodClaims({ name: "Priya", picture: "https://x" })), o);
  assert.deepEqual(r, { ok: true, identity: { sub: "110248495921238986420", email: "priya.sharma@example.com" } });
  assert.deepEqual(o.consumed, [NONCE]);
  // The bare issuer form Google also uses.
  assert.equal((await verifyGoogleIdToken(token(goodClaims({ iss: "accounts.google.com", nonce: NONCE })), opts())).ok, true);
});

test("bad signature: signed by any other key is refused", async () => {
  const o = opts();
  const r = await verifyGoogleIdToken(token(goodClaims(), { key: rogue.privateKey }), o);
  assert.deepEqual(r, { ok: false, reason: "bad_signature" });
  assert.deepEqual(o.consumed, [], "a forged token never spends the real nonce");
  // Claims edited after signing.
  const [h, , s] = token(goodClaims()).split(".");
  assert.deepEqual(await verifyGoogleIdToken(`${h}.${b64(goodClaims({ sub: "someone-else" }))}.${s}`, opts()),
    { ok: false, reason: "bad_signature" });
});

test("only RS256 with a known key: alg none, HS256 and unknown kids are refused", async () => {
  const none = `${b64({ alg: "none", kid: KID })}.${b64(goodClaims())}.`;
  assert.equal((await verifyGoogleIdToken(none, opts())).ok, false);
  // HS256 keyed with the public key's bytes - the classic confusion attack.
  const pub = google.publicKey.export({ format: "pem", type: "spki" });
  const head = b64({ alg: "HS256", kid: KID }), body = b64(goodClaims());
  const hs = `${head}.${body}.${createHmac("sha256", pub).update(`${head}.${body}`).digest("base64url")}`;
  assert.deepEqual(await verifyGoogleIdToken(hs, opts()), { ok: false, reason: "bad_alg" });
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims(), { header: { alg: "RS256", kid: "nope" } }), opts()),
    { ok: false, reason: "unknown_key" });
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims(), { header: { alg: "RS256" } }), opts()),
    { ok: false, reason: "bad_alg" });
  for (const junk of ["", "a.b", "a.b.c.d", "!!.!!.!!", 42, null, "x".repeat(9000)]) {
    assert.equal((await verifyGoogleIdToken(junk, opts())).ok, false, String(junk).slice(0, 20));
  }
});

test("wrong issuer is refused", async () => {
  for (const iss of ["https://evil.example.com", "https://accounts.google.com/", "google.com", undefined]) {
    assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ iss })), opts()), { ok: false, reason: "bad_issuer" }, String(iss));
  }
});

test("wrong audience is refused, including another app's client id and an array", async () => {
  for (const aud of ["999999999999-someoneelsesapp.apps.googleusercontent.com", ANDROID, [WEB], [WEB, "x"], undefined]) {
    assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ aud })), opts()), { ok: false, reason: "bad_audience" }, JSON.stringify(aud));
  }
});

test("azp: for Android it must be present and be our Android client", async () => {
  const android = (over: Record<string, unknown>) =>
    verifyGoogleIdToken(token(goodClaims(over)), opts({ azp: [ANDROID], azpRequired: true }));
  assert.equal((await android({ azp: ANDROID })).ok, true);
  assert.deepEqual(await android({ azp: WEB }), { ok: false, reason: "bad_azp" });
  assert.deepEqual(await android({ azp: "999999999999-otherandroidapp.apps.googleusercontent.com" }), { ok: false, reason: "bad_azp" });
  assert.deepEqual(await android({ azp: undefined }), { ok: false, reason: "bad_azp" });
  // On the web an absent azp is allowed (single audience); a wrong one is not.
  assert.equal((await verifyGoogleIdToken(token(goodClaims({ azp: undefined })), opts())).ok, true);
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ azp: ANDROID })), opts()), { ok: false, reason: "bad_azp" });
});

test("expired is refused, with one minute of skew either way", async () => {
  const at = (claims: Record<string, unknown>) => verifyGoogleIdToken(token(goodClaims(claims)), opts());
  assert.deepEqual(await at({ exp: NOW_S - 61 }), { ok: false, reason: "expired" });
  assert.equal((await at({ exp: NOW_S - 59 })).ok, true, "inside the skew");
  assert.deepEqual(await at({ exp: "never" }), { ok: false, reason: "expired" });
  assert.deepEqual(await at({ iat: NOW_S + 120 }), { ok: false, reason: "not_yet_valid" });
  assert.equal((await at({ iat: NOW_S + 30 })).ok, true, "a clock 30 s ahead is fine");
  assert.deepEqual(await at({ iat: undefined }), { ok: false, reason: "not_yet_valid" });
  assert.deepEqual(await at({ nbf: NOW_S + 300 }), { ok: false, reason: "not_yet_valid" });
});

test("nonce: it must be the one issued, and it is single-use", async () => {
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ nonce: randomToken() })), opts()), { ok: false, reason: "nonce_mismatch" });
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ nonce: undefined })), opts()), { ok: false, reason: "nonce_mismatch" });
  const o = opts();
  const t = token(goodClaims());
  assert.equal((await verifyGoogleIdToken(t, o)).ok, true);
  assert.deepEqual(await verifyGoogleIdToken(t, o), { ok: false, reason: "nonce_replayed" }, "the same token twice");
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ sub: "another" })), o), { ok: false, reason: "nonce_replayed" },
    "a second token minted for the same nonce");
});

test("email_verified must be true", async () => {
  for (const v of [false, "false", undefined, 1, null]) {
    assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ email_verified: v })), opts()), { ok: false, reason: "email_unverified" }, String(v));
  }
  assert.equal((await verifyGoogleIdToken(token(goodClaims({ email_verified: "true" })), opts())).ok, true, "old tokens said \"true\"");
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ email: undefined })), opts()), { ok: false, reason: "email_unverified" });
  assert.deepEqual(await verifyGoogleIdToken(token(goodClaims({ sub: "" })), opts()), { ok: false, reason: "no_subject" });
});

// ── whose account ──────────────────────────────────────────────────────────

const citizen = (over: Partial<AccountFacts> = {}): AccountFacts =>
  ({ id: "u-citizen", roles: ["citizen"], msisdn: "+917000001234", googleSub: null, ...over });
const PROTECTED = new Set(["+919999900001"]);

test("privileged accounts are refused: a Google sign-in never enters or links admin, officer, mechanic, fleet or support", () => {
  for (const role of ["admin", "gov_officer", "mechanic", "fleet_admin", "fleet_driver", "support"]) {
    const acct = citizen({ roles: ["citizen", role], googleSub: "sub-1" });
    assert.equal(googleAccountRefusal(acct, PROTECTED), "privileged_account", role);
    assert.deepEqual(decideGoogleSignin(acct, PROTECTED), { action: "refuse", reason: "privileged_account" }, role);
    assert.deepEqual(decideGoogleLink(acct, "sub-1", null, PROTECTED), { action: "refuse", reason: "privileged_account" }, role);
  }
});

test("an account in EMAIL_SIGNIN is refused even as a citizen", () => {
  const acct = citizen({ msisdn: "+919999900001", googleSub: "sub-1" });
  assert.deepEqual(decideGoogleSignin(acct, PROTECTED), { action: "refuse", reason: "email_signin_account" });
  assert.deepEqual(decideGoogleLink(acct, "sub-1", null, PROTECTED), { action: "refuse", reason: "email_signin_account" });
});

test("sign-in is decided by sub alone: an unknown sub is a NEW citizen account, whatever its email", () => {
  assert.deepEqual(decideGoogleSignin(null, PROTECTED), { action: "create" });
  assert.equal(decideGoogleSignin.length, 2, "there is no email parameter to match an existing account on");
  assert.deepEqual(decideGoogleSignin(citizen({ googleSub: "sub-1" }), PROTECTED), { action: "enter", userId: "u-citizen" });
  assert.deepEqual(decideGoogleSignin(citizen({ deleted: true }), PROTECTED), { action: "refuse", reason: "account_closed" });
});

test("Link Google: only into a signed-in citizen, never stealing a Google account another proven account uses", () => {
  const me = citizen();
  assert.deepEqual(decideGoogleLink(me, "sub-1", null, PROTECTED), { action: "link" });
  assert.deepEqual(decideGoogleLink(citizen({ googleSub: "sub-1" }), "sub-1", citizen({ googleSub: "sub-1" }), PROTECTED), { action: "already" });
  assert.deepEqual(decideGoogleLink(citizen({ googleSub: "sub-0" }), "sub-1", null, PROTECTED),
    { action: "refuse", reason: "other_google_linked" });
  // Held by another account that has a phone: two proven accounts, never merged.
  const other = citizen({ id: "u-other", msisdn: "+917000005678", googleSub: "sub-1" });
  assert.deepEqual(decideGoogleLink(me, "sub-1", other, PROTECTED), { action: "refuse", reason: "google_in_use" });
  // Held by an empty Google-only sign-up (no phone): it moves, that one closes.
  const empty = citizen({ id: "u-empty", msisdn: null, googleSub: "sub-1" });
  assert.deepEqual(decideGoogleLink(me, "sub-1", empty, PROTECTED), { action: "move", fromUserId: "u-empty" });
  // …but never out of a privileged account, even one with no phone.
  assert.deepEqual(decideGoogleLink(me, "sub-1", { ...empty, roles: ["admin"] }, PROTECTED), { action: "refuse", reason: "google_in_use" });
});

test("phone collision: a number that belongs to another account is refused and nothing is taken over", () => {
  const google = { id: "u-google", msisdn: null };
  assert.deepEqual(decidePhoneAttach(google, "+917000001234", { id: "u-phone" }), { action: "refuse", reason: "phone_in_use" });
  assert.deepEqual(decidePhoneAttach(google, "+917000001234", null), { action: "attach" });
  assert.deepEqual(decidePhoneAttach({ id: "u-x", msisdn: "+917000001234" }, "+917000001234", { id: "u-x" }), { action: "already" });
  assert.deepEqual(decidePhoneAttach({ id: "u-x", msisdn: "+917000001234" }, "+917000009999", null),
    { action: "refuse", reason: "phone_already_set" }, "a number is not swapped by this route");
});

// ── logs ───────────────────────────────────────────────────────────────────

test("the callback's one-time code and state never reach the access log", () => {
  assert.equal(urlForLog("/v1/auth/google/callback?state=abc&code=4/0AQSTgQ"), "/v1/auth/google/callback?[redacted]");
  assert.equal(urlForLog("/v1/auth/google/callback"), "/v1/auth/google/callback");
  assert.equal(urlForLog("/v1/bookings?limit=10"), "/v1/bookings?limit=10");
});

// ── the web page's half (apps/web/google-signin.js) ────────────────────────

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

interface WebGoogle {
  parse(hash: string): { outcome: string; reason: string | null; isNew: boolean } | null;
  message(reason: string | null, t?: (k: string, f: string) => string): string;
  startUrl(api: string): string;
}
const webGoogle = (): WebGoogle => {
  const ctx: { window: Record<string, unknown> } = { window: {} };
  runInNewContext(readFileSync(new URL("../../web/google-signin.js", import.meta.url), "utf8"), ctx);
  return ctx.window.RAGoogle as WebGoogle;
};

test("web: the page reads only the three outcomes the server sends back", () => {
  const G = webGoogle();
  assert.deepEqual({ ...G.parse("#google=signedin&new=1") }, { outcome: "signedin", reason: null, isNew: true });
  assert.deepEqual({ ...G.parse("#google=linked") }, { outcome: "linked", reason: null, isNew: false });
  assert.deepEqual({ ...G.parse("#google=error&reason=google_cancelled") }, { outcome: "error", reason: "google_cancelled", isNew: false });
  for (const h of ["", "#map", "#google=", "#google=owned", "#googlex=signedin", "#report&google=signedin"]) {
    assert.equal(G.parse(h), null, h);
  }
});

test("web: a reason in the fragment only ever becomes one of the fixed messages", () => {
  const G = webGoogle();
  const evil = G.parse("#google=error&reason=<img src=x onerror=alert(1)>");
  assert.equal(evil?.reason, null, "anything but a short snake_case code is dropped");
  assert.equal(G.message("privileged_account"), "This account cannot use Google sign-in. Sign in with your phone number.");
  assert.equal(G.message("constructor"), "Google sign-in did not complete. Try again.", "no prototype keys");
  assert.equal(G.message("made_up_reason"), "Google sign-in did not complete. Try again.");
  assert.equal(G.message("google_in_use", (k) => `[${k}]`), "[google.err.inUse]", "translated by catalogue key");
  assert.equal(G.startUrl("https://app.example.in"), "https://app.example.in/v1/auth/google/start",
    "the button goes to this server, never to Google directly");
});
