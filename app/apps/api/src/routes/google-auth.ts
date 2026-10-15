/**
 * Sign in with Google, on the web and on Android, and the phone a Google
 * sign-up adds afterwards. The rules are in domain/google-signin.ts; this file
 * applies them to requests and the database.
 *
 *   GET  /v1/auth/google/start      web: seal state + PKCE verifier + nonce into a cookie, 302 to Google
 *   GET  /v1/auth/google/callback   web: exchange the code, verify the ID token, sign in or link, 302 to the app
 *   POST /v1/auth/google/nonce      Android: a single-use nonce for Credential Manager (link: signed in)
 *   POST /v1/auth/google/token      Android: verify the ID token, sign in (the OTP verify's answer shape)
 *   POST /v1/me/google              Android: Link Google to the signed-in account
 *   POST /v1/me/google/web-link     web: Link Google - a sealed cookie naming the account, then /start?link=1
 *   POST /v1/me/phone               a signed-in account with no phone adds one it proved by OTP
 *
 * Off - every route 404 - unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
 * GOOGLE_REDIRECT_URI are all set (the Android routes also need
 * GOOGLE_ANDROID_CLIENT_ID). /v1/me/phone is always on: it is how any
 * phone-less account gets a phone, and it is the existing OTP underneath.
 *
 * What works before a Google sign-up has verified a phone: everything except
 * booking a mechanic, which answers 409 phone_required (server.ts) because a
 * mechanic driving to a breakdown has to be able to call the customer. SOS is
 * never gated - it works signed out, so it works here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok, msisdnSchema } from "../http.js";
import { audit } from "../audit.js";
import { alerts } from "../alerts.js";
import { isUniqueViolation } from "../errors.js";
import { limit } from "../ratelimit.js";
import { emailSignin } from "./email-auth.js";
import { phonePolicy, phoneRefusal, refuse } from "./auth.js";
import {
  LOGOUT_REASON, authenticate, constantTimeEquals, deliverSession, refreshCookie, rolesFor, sha256, startSession,
} from "../auth.js";
import {
  COOKIE_PATH, FLOW_COOKIE, FLOW_TTL_MS, JwksCache, LINK_COOKIE, LINK_TTL_MS, REFUSAL_TITLES,
  authorizationUrl, cookieValue, decideGoogleLink, decideGoogleSignin, decidePhoneAttach,
  googleAccountRefusal, googleAndroidEnabled, googleCookie, googleEndpoints, googleWebEnabled,
  hashNonce, isWellFormedNonce, randomToken, sameString, seal, unseal,
  type AccountFacts, type GoogleRefusal, type IdTokenFailure, type VerifiedGoogleIdentity,
  verifyGoogleIdToken,
} from "../domain/google-signin.js";

const cfg = env.google;
const webOn = googleWebEnabled(cfg);
const androidOn = googleAndroidEnabled(cfg);
const endpoints = googleEndpoints(cfg.apiBase);

/** The web page a Google round trip lands back on. Always this origin's citizen app. */
const APP_PAGE = "/app.html";
/** The citizen app's refresh-cookie slot (session.js): Google signs in citizens only. */
const APP_SLOT = "app";

/**
 * What /health tells the apps, signed out: whether to draw the button, and
 * for Android the web client id it must pass as serverClientId. A client id is
 * public - it is in every authorization URL - so this discloses nothing.
 */
export const googleFeature = () => ({
  web: webOn,
  android: androidOn,
  ...(androidOn ? { serverClientId: cfg.clientId } : {}),
});

/** Google's signing keys, fetched server-side and cached as Google's Cache-Control allows. */
const jwks = new JwksCache(async () => {
  const res = await fetch(endpoints.jwks, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`JWKS answered ${res.status}`);
  return { body: await res.json(), cacheControl: res.headers.get("cache-control") };
});

// ── nonces ─────────────────────────────────────────────────────────────────

type Purpose = "signin" | "link";

async function issueNonce(purpose: Purpose, linkUserId: string | null): Promise<string> {
  const nonce = randomToken();
  // Rows a day past their expiry are of no further use; dropped as new ones arrive.
  await db.delete(S.googleAuthNonces)
    .where(lt(S.googleAuthNonces.expiresAt, new Date(Date.now() - 24 * 3600_000)));
  await db.insert(S.googleAuthNonces).values({
    nonceHash: hashNonce(nonce), purpose, linkUserId, expiresAt: new Date(Date.now() + FLOW_TTL_MS),
  });
  return nonce;
}

/**
 * Spend a nonce: one conditional UPDATE, so of two requests racing with the
 * same token exactly one gets the row. It must be unexpired, of the purpose
 * the caller is acting under, and - for a link - issued to this very account.
 */
async function consumeNonce(nonce: string, purpose: Purpose, linkUserId: string | null): Promise<boolean> {
  const rows = await db.update(S.googleAuthNonces)
    .set({ usedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(S.googleAuthNonces.nonceHash, hashNonce(nonce)),
      eq(S.googleAuthNonces.purpose, purpose),
      isNull(S.googleAuthNonces.usedAt),
      gt(S.googleAuthNonces.expiresAt, new Date()),
      linkUserId ? eq(S.googleAuthNonces.linkUserId, linkUserId) : isNull(S.googleAuthNonces.linkUserId),
    ))
    .returning({ id: S.googleAuthNonces.id });
  return rows.length === 1;
}

// ── accounts ───────────────────────────────────────────────────────────────

async function facts(where: ReturnType<typeof eq>): Promise<AccountFacts | null> {
  const [u] = await db.select({
    id: S.users.id, msisdn: S.users.msisdn, googleSub: S.users.googleSub, deletedAt: S.users.deletedAt,
  }).from(S.users).where(where).limit(1);
  if (!u) return null;
  return { id: u.id, msisdn: u.msisdn, googleSub: u.googleSub, deleted: Boolean(u.deletedAt), roles: await rolesFor(db, u.id) };
}

const bySub = (sub: string) => facts(eq(S.users.googleSub, sub));
const byId = (id: string) => facts(eq(S.users.id, id));

type SigninOutcome = { ok: true; userId: string; created: boolean } | { ok: false; reason: GoogleRefusal };

/**
 * The account a verified Google identity enters: the one holding its sub, or
 * a new citizen account with no phone. Looked up by sub ONLY.
 */
async function signInAs(identity: VerifiedGoogleIdentity): Promise<SigninOutcome> {
  const decision = decideGoogleSignin(await bySub(identity.sub), emailSignin.protectedNumbers);
  if (decision.action === "refuse") return { ok: false, reason: decision.reason };
  if (decision.action === "enter") return { ok: true, userId: decision.userId, created: false };
  try {
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx.insert(S.users).values({
        msisdn: null, googleSub: identity.sub, googleEmail: identity.email, isVerified: false,
      }).returning({ id: S.users.id });
      const [citizen] = await tx.select().from(S.roles).where(eq(S.roles.name, "citizen")).limit(1);
      if (citizen) await tx.insert(S.userRoles).values({ userId: user.id, roleId: citizen.id });
      return user.id;
    });
    return { ok: true, userId, created: true };
  } catch (err) {
    // Two first sign-ins with one Google account at the same moment: the
    // unique index let one create the account; the other enters it.
    if (!isUniqueViolation(err, "users_google_sub_uq")) throw err;
    const again = decideGoogleSignin(await bySub(identity.sub), emailSignin.protectedNumbers);
    return again.action === "enter" ? { ok: true, userId: again.userId, created: false }
      : again.action === "refuse" ? { ok: false, reason: again.reason } : { ok: false, reason: "google_in_use" };
  }
}

type LinkOutcome = { ok: true; moved: boolean } | { ok: false; reason: GoogleRefusal };

/** Link the verified Google identity to the signed-in account `userId` (decideGoogleLink). */
async function linkTo(userId: string, identity: VerifiedGoogleIdentity, ip: string): Promise<LinkOutcome> {
  const target = await byId(userId);
  if (!target) return { ok: false, reason: "account_closed" };
  const decision = decideGoogleLink(target, identity.sub, await bySub(identity.sub), emailSignin.protectedNumbers);
  if (decision.action === "refuse") return { ok: false, reason: decision.reason };
  if (decision.action === "already") return { ok: true, moved: false };
  try {
    await db.transaction(async (tx) => {
      if (decision.action === "move") {
        // The empty Google-only sign-up gives up the sub and is closed: its
        // sessions end, and it has no phone and no Google left to enter by.
        const now = new Date();
        await tx.update(S.users).set({ googleSub: null, googleEmail: null, deletedAt: now, updatedAt: now })
          .where(and(eq(S.users.id, decision.fromUserId), isNull(S.users.msisdn), eq(S.users.googleSub, identity.sub)));
        await tx.update(S.sessions).set({ revokedAt: now, revokedReason: LOGOUT_REASON, updatedAt: now })
          .where(and(eq(S.sessions.userId, decision.fromUserId), isNull(S.sessions.revokedAt)));
      }
      const [done] = await tx.update(S.users)
        .set({ googleSub: identity.sub, googleEmail: identity.email, updatedAt: new Date() })
        .where(and(eq(S.users.id, userId), isNull(S.users.deletedAt)))
        .returning({ id: S.users.id });
      if (!done) throw Object.assign(new Error("account gone"), { closed: true });
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_google_sub_uq")) return { ok: false, reason: "google_in_use" };
    if ((err as { closed?: boolean }).closed) return { ok: false, reason: "account_closed" };
    throw err;
  }
  await audit({
    actorId: userId, actorRole: "citizen", action: "auth.google.linked", entity: "user", entityId: userId,
    after: { moved: decision.action === "move", closedAccount: decision.action === "move" ? decision.fromUserId : null },
    ip,
  });
  return { ok: true, moved: decision.action === "move" };
}

/** A session for `userId`, audited and alerted exactly as an OTP sign-in is. */
async function sessionFor(req: FastifyRequest, userId: string, created: boolean) {
  const session = await startSession(db, userId, { ip: req.ip, ua: req.headers["user-agent"] });
  const [user] = await db.select({ id: S.users.id, msisdn: S.users.msisdn, fullName: S.users.fullName })
    .from(S.users).where(eq(S.users.id, userId)).limit(1);
  await audit({
    actorId: userId, actorRole: "citizen", action: "auth.login", entity: "user", entityId: userId,
    after: { newAccount: created, sessionCreated: true, channel: "google" },
    ip: req.ip,
  });
  alerts.signin(user?.msisdn ?? "", session.roles, created);
  return { session, user: { id: userId, msisdn: user?.msisdn ?? null, fullName: user?.fullName ?? null } };
}

// ── Google's token endpoint ────────────────────────────────────────────────

/** Trade the authorization code for an ID token, server-side, with the PKCE verifier and our secret. */
async function exchangeCode(code: string, verifier: string): Promise<string | null> {
  try {
    const res = await fetch(endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, code_verifier: verifier,
        client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    // Only the ID token is read. The access token Google also returns is
    // never used, stored or logged: nothing here calls a Google API as the user.
    const body = await res.json() as { id_token?: unknown };
    return typeof body.id_token === "string" ? body.id_token : null;
  } catch {
    return null;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

const off = (reply: FastifyReply) => reply.code(404).send({
  error: { code: "google_signin_off", title: "Google sign-in is not turned on for this server.", retryable: false },
});

const refusal = (reply: FastifyReply, status: number, reason: keyof typeof REFUSAL_TITLES) =>
  reply.code(status).send({ error: { code: reason, title: REFUSAL_TITLES[reason], retryable: false } });

/** HTTP status for an ID-token failure: a replay or expiry is the client's to retry; the rest are refusals. */
const tokenStatus = (r: IdTokenFailure) => (r === "unknown_key" ? 502 : 401);

const tokenBody = z.object({ idToken: z.string().min(20).max(8192), nonce: z.string().max(64) });

/** Back to the app page with an outcome in the fragment (never the query: a fragment is not sent anywhere). */
function backToApp(reply: FastifyReply, fragment: string, cookies: string[]) {
  return reply.code(302)
    .header("set-cookie", cookies)
    .header("location", `${APP_PAGE}#${fragment}`)
    .header("referrer-policy", "no-referrer")
    .header("cache-control", "no-store")
    .send();
}

interface FlowCookie { s: string; v: string; n: string; p: Purpose; u: string | null; exp: number }
interface LinkCookie { u: string; exp: number }

// ── routes ─────────────────────────────────────────────────────────────────

export async function googleAuthRoutes(app: FastifyInstance) {
  app.get("/v1/auth/google/start", { preHandler: limit("googleSignin") }, async (req, reply) => {
    if (!webOn) return off(reply);
    const https = req.protocol === "https";
    const q = req.query as { link?: string };

    // Google sends the person back to the ONE registered redirect URI. A page
    // opened on another host of this server (a Render address, a tunnel)
    // would set its cookie where the callback cannot read it, so the start
    // hops to the registered origin first. A fixed, configured origin: never
    // one taken from the request, so this is not an open redirect.
    const registered = new URL(cfg.redirectUri);
    if (`${req.protocol}:` !== registered.protocol || req.headers.host !== registered.host) {
      return reply.code(302).header("location", `${registered.origin}/v1/auth/google/start${q.link === "1" ? "?link=1" : ""}`)
        .header("cache-control", "no-store").send();
    }

    const clearLink = googleCookie({ name: LINK_COOKIE, value: null, https, maxAgeMs: 0 });
    let purpose: Purpose = "signin", linkUserId: string | null = null;
    if (q.link === "1") {
      const lc = unseal<LinkCookie>("link", cookieValue(req.headers.cookie, LINK_COOKIE), env.jwtSecret);
      if (!lc) return backToApp(reply, "google=error&reason=link_expired", [clearLink]);
      purpose = "link"; linkUserId = lc.u;
    }

    const state = randomToken(), verifier = randomToken();
    const nonce = await issueNonce(purpose, linkUserId);
    const flow: FlowCookie = { s: state, v: verifier, n: nonce, p: purpose, u: linkUserId, exp: Date.now() + FLOW_TTL_MS };
    return reply.code(302)
      .header("set-cookie", [
        googleCookie({ name: FLOW_COOKIE, value: seal("flow", { ...flow }, env.jwtSecret), https, maxAgeMs: FLOW_TTL_MS }),
        clearLink,
      ])
      .header("location", authorizationUrl({
        endpoint: endpoints.authorize, clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, nonce, verifier,
      }))
      .header("referrer-policy", "no-referrer")
      .header("cache-control", "no-store")
      .send();
  });

  app.get("/v1/auth/google/callback", async (req, reply) => {
    if (!webOn) return off(reply);
    const https = req.protocol === "https";
    const q = req.query as { code?: unknown; state?: unknown; error?: unknown };
    // The flow cookie is spent whatever happens next: one round trip per click.
    const cookies = [googleCookie({ name: FLOW_COOKIE, value: null, https, maxAgeMs: 0 })];
    const fail = (reason: string) => backToApp(reply, `google=error&reason=${encodeURIComponent(reason)}`, cookies);

    const flow = unseal<FlowCookie>("flow", cookieValue(req.headers.cookie, FLOW_COOKIE), env.jwtSecret);
    // state binds this callback to the browser that pressed the button: a
    // callback URL planted on somebody else (login CSRF) carries a state
    // their browser never sealed.
    if (!flow || !sameString(q.state, flow.s)) {
      req.log.warn({ hasFlow: Boolean(flow) }, "google callback: state did not match");
      return fail("google_failed");
    }
    if (q.error !== undefined) return fail(q.error === "access_denied" ? "google_cancelled" : "google_failed");
    if (typeof q.code !== "string" || q.code.length < 4 || q.code.length > 2048) return fail("google_failed");

    const idToken = await exchangeCode(q.code, flow.v);
    if (!idToken) return fail("google_failed");
    const verified = await verifyGoogleIdToken(idToken, {
      audience: cfg.clientId, azp: [cfg.clientId], azpRequired: false, expectedNonce: flow.n,
      keyFor: (kid) => jwks.key(kid),
      consumeNonce: (n) => consumeNonce(n, flow.p, flow.u),
    });
    if (!verified.ok) {
      req.log.warn({ reason: verified.reason }, "google callback: ID token refused");
      return fail(verified.reason);
    }

    if (flow.p === "link" && flow.u) {
      const linked = await linkTo(flow.u, verified.identity, req.ip);
      return linked.ok ? backToApp(reply, "google=linked", cookies) : fail(linked.reason);
    }

    const who = await signInAs(verified.identity);
    if (!who.ok) return fail(who.reason);
    const { session } = await sessionFor(req, who.userId, who.created);
    // The app's normal web session: the refresh token as the citizen app's
    // HttpOnly cookie, exactly as an OTP sign-in from that page sets it. The
    // page then trades it for an access token with POST /v1/auth/refresh.
    cookies.push(refreshCookie(https, APP_SLOT, session.refreshToken));
    return backToApp(reply, `google=signedin${who.created ? "&new=1" : ""}`, cookies);
  });

  app.post("/v1/auth/google/nonce", { preHandler: limit("googleSignin") }, async (req, reply) => {
    if (!androidOn) return off(reply);
    const { purpose } = z.object({ purpose: z.enum(["signin", "link"]).default("signin") }).parse(req.body ?? {});
    let linkUserId: string | null = null;
    if (purpose === "link") {
      await authenticate(req, reply);
      if (reply.sent) return reply;
      const target = await byId(req.user!.sub);
      const why = target ? googleAccountRefusal(target, emailSignin.protectedNumbers) : "account_closed";
      if (why) return refusal(reply, 403, why);
      linkUserId = req.user!.sub;
    }
    const nonce = await issueNonce(purpose, linkUserId);
    return ok({ nonce, serverClientId: cfg.clientId, expiresInSeconds: FLOW_TTL_MS / 1000 });
  });

  app.post("/v1/auth/google/token", { preHandler: limit("googleRedeem") }, async (req, reply) => {
    if (!androidOn) return off(reply);
    const body = tokenBody.parse(req.body);
    if (!isWellFormedNonce(body.nonce)) return refusal(reply, 401, "nonce_mismatch");
    const verified = await verifyGoogleIdToken(body.idToken, {
      audience: cfg.clientId, azp: [cfg.androidClientId], azpRequired: true, expectedNonce: body.nonce,
      keyFor: (kid) => jwks.key(kid),
      consumeNonce: (n) => consumeNonce(n, "signin", null),
    });
    if (!verified.ok) return refusal(reply, tokenStatus(verified.reason), verified.reason);
    const who = await signInAs(verified.identity);
    if (!who.ok) return refusal(reply, 403, who.reason);
    const { session, user } = await sessionFor(req, who.userId, who.created);
    return ok(deliverSession(req, reply, { ...session, user }),
      { newAccount: who.created, channel: "google", phoneRequired: !user.msisdn });
  });

  app.post("/v1/me/google", { preHandler: [authenticate, limit("googleRedeem")] }, async (req, reply) => {
    if (!androidOn) return off(reply);
    const body = tokenBody.parse(req.body);
    if (!isWellFormedNonce(body.nonce)) return refusal(reply, 401, "nonce_mismatch");
    const verified = await verifyGoogleIdToken(body.idToken, {
      audience: cfg.clientId, azp: [cfg.androidClientId], azpRequired: true, expectedNonce: body.nonce,
      keyFor: (kid) => jwks.key(kid),
      consumeNonce: (n) => consumeNonce(n, "link", req.user!.sub),
    });
    if (!verified.ok) return refusal(reply, tokenStatus(verified.reason), verified.reason);
    const linked = await linkTo(req.user!.sub, verified.identity, req.ip);
    if (!linked.ok) return refusal(reply, linked.reason === "google_in_use" || linked.reason === "other_google_linked" ? 409 : 403, linked.reason);
    return ok({ linked: true, email: verified.identity.email, moved: linked.moved });
  });

  app.post("/v1/me/google/web-link", { preHandler: [authenticate, limit("googleSignin")] }, async (req, reply) => {
    if (!webOn) return off(reply);
    const target = await byId(req.user!.sub);
    const why = target ? googleAccountRefusal(target, emailSignin.protectedNumbers) : "account_closed";
    if (why) return refusal(reply, 403, why);
    // Bearer-authenticated, so a cross-site page cannot plant this cookie for
    // somebody. It only names the account the next /start?link=1 links to.
    const sealed = seal("link", { u: req.user!.sub, exp: Date.now() + LINK_TTL_MS }, env.jwtSecret);
    reply.header("set-cookie", googleCookie({ name: LINK_COOKIE, value: sealed, https: req.protocol === "https", maxAgeMs: LINK_TTL_MS }));
    return ok({ next: `${COOKIE_PATH}/start?link=1` });
  });

  /**
   * Add a phone to a signed-in account that has none (a Google sign-up),
   * proved with a code from the ordinary POST /v1/auth/otp/request. The code
   * is checked exactly as the OTP verify checks it - expiry, the attempt cap
   * taken before comparing, constant-time compare, consumed once.
   *
   * A number that already belongs to another account is refused with 409
   * phone_in_use AFTER the code is proven (before, it would tell anyone
   * which numbers are registered), and neither account changes
   * (decidePhoneAttach). The unique index decides a race.
   */
  app.post("/v1/me/phone", { preHandler: [authenticate, limit("googleRedeem")] }, async (req, reply) => {
    const { msisdn, code } = z.object({ msisdn: msisdnSchema, code: z.string().length(6) }).parse(req.body);
    const userId = req.user!.sub;
    const [caller] = await db.select({ id: S.users.id, msisdn: S.users.msisdn }).from(S.users)
      .where(eq(S.users.id, userId)).limit(1);
    if (!caller) return refusal(reply, 403, "account_closed");
    const early = decidePhoneAttach(caller, msisdn, null);
    if (early.action === "already") return ok({ msisdn, added: false });
    if (early.action === "refuse") return refusal(reply, 409, early.reason);

    const policyRefusal = await phoneRefusal(msisdn, phonePolicy());
    if (policyRefusal) return reply.code(policyRefusal.status).send(refuse(policyRefusal));

    const invalid = () => reply.code(401).send({
      error: { code: "otp_invalid", title: "That code is not right. Check it and try again.", retryable: true },
    });
    const [challenge] = await db.select().from(S.otpChallenges)
      .where(and(eq(S.otpChallenges.msisdn, msisdn), isNull(S.otpChallenges.consumedAt)))
      .orderBy(desc(S.otpChallenges.createdAt)).limit(1);
    if (!challenge) return invalid();
    if (challenge.expiresAt.getTime() <= Date.now()) {
      return reply.code(401).send({ error: { code: "otp_expired", title: "That code has expired. Request a new one.", retryable: true } });
    }
    const [slot] = await db.update(S.otpChallenges)
      .set({ attempts: sql`${S.otpChallenges.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(S.otpChallenges.id, challenge.id), lt(S.otpChallenges.attempts, env.otpMaxAttempts)))
      .returning({ id: S.otpChallenges.id });
    if (!slot) {
      return reply.code(429).send({ error: { code: "otp_locked", title: "Too many wrong attempts. Request a new code.", retryable: true } });
    }
    if (!constantTimeEquals(sha256(code), challenge.codeHash)) return invalid();
    const [won] = await db.update(S.otpChallenges)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(S.otpChallenges.id, challenge.id), isNull(S.otpChallenges.consumedAt)))
      .returning({ id: S.otpChallenges.id });
    if (!won) return invalid();

    const [owner] = await db.select({ id: S.users.id }).from(S.users).where(eq(S.users.msisdn, msisdn)).limit(1);
    const decision = decidePhoneAttach(caller, msisdn, owner ?? null);
    const refused = async (reason: "phone_in_use" | "phone_already_set") => {
      await audit({
        actorId: userId, actorRole: "citizen", action: "user.phone.refused", entity: "user", entityId: userId,
        after: { reason }, ip: req.ip,
      });
      return refusal(reply, 409, reason);
    };
    if (decision.action === "refuse") return refused(decision.reason);
    if (decision.action === "already") return ok({ msisdn, added: false });
    try {
      const [done] = await db.update(S.users)
        .set({ msisdn, isVerified: true, updatedAt: new Date() })
        .where(and(eq(S.users.id, userId), isNull(S.users.msisdn)))
        .returning({ id: S.users.id });
      if (!done) return refused("phone_already_set");
    } catch (err) {
      if (isUniqueViolation(err, "users_msisdn_uq")) return refused("phone_in_use");
      throw err;
    }
    // The number is not written to the audit row, as at sign-in (routes/auth.ts).
    await audit({
      actorId: userId, actorRole: "citizen", action: "user.phone.added", entity: "user", entityId: userId,
      after: { verifiedBy: "otp" }, ip: req.ip,
    });
    return ok({ msisdn, added: true });
  });
}
