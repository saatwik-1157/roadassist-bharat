/**
 * Phase 4 authentication: phone OTP → short-lived access token + rotating
 * refresh token, with resource-scoped RBAC.
 *
 * Reuse of a consumed refresh token revokes the entire family — the standard
 * defence against a stolen token, and threat #6 in the threat model.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";
import { db as appDb, type Db } from "./db.js";
import * as S from "@roadassist/db";

const key = new TextEncoder().encode(env.jwtSecret);

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export interface Claims {
  sub: string;
  roles: string[];
  sid: string;
}

export async function issueAccessToken(claims: Claims): Promise<string> {
  return new SignJWT({ roles: claims.roles, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("roadassist")
    .setExpirationTime(`${env.accessTtlSeconds}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, key, { issuer: "roadassist" });
  return {
    sub: String(payload.sub),
    roles: (payload.roles as string[]) ?? [],
    sid: String(payload.sid ?? ""),
  };
}

/** Opaque refresh token; only its hash is ever stored. */
export function newRefreshToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function rolesFor(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: S.roles.name })
    .from(S.userRoles)
    .innerJoin(S.roles, eq(S.roles.id, S.userRoles.roleId))
    .where(and(eq(S.userRoles.userId, userId), isNull(S.userRoles.deletedAt)));
  return rows.map((r) => String(r.name));
}

/**
 * Roles held by the account with this phone number, or [] when there is none.
 *
 * The phone sign-in path asks before it issues a code (routes/auth.ts,
 * domain/demo-numbers.ts): an admin or officer must never be reachable with a
 * code that is printed on screen. A soft-deleted user row still counts - the
 * verify handler would sign it in, so this must see it too.
 */
export async function rolesForMsisdn(db: Db, msisdn: string): Promise<string[]> {
  const rows = await db
    .select({ name: S.roles.name })
    .from(S.users)
    .innerJoin(S.userRoles, eq(S.userRoles.userId, S.users.id))
    .innerJoin(S.roles, eq(S.roles.id, S.userRoles.roleId))
    .where(and(eq(S.users.msisdn, msisdn), isNull(S.userRoles.deletedAt)));
  return rows.map((r) => String(r.name));
}

/** Why a session was ended by its owner; authenticate refuses these sids. */
export const LOGOUT_REASON = "logout";

/**
 * Sign out: end the caller's refresh-token family, and every access token
 * minted from it that could still be alive.
 *
 * The same family-wide revocation reuse detection performs (rotateSession's
 * burnFamily), with its own reason so authenticate can tell the two apart.
 * Rows that were already rotated are relabelled too when they are younger than
 * the access-token lifetime: each of those minted an access token that has not
 * expired yet, and authenticate checks the token's own sid with one primary-key
 * lookup - so that row is where the "signed out" fact has to be.
 *
 * Only the caller's own family: a sid belonging to somebody else revokes nothing.
 */
export async function revokeSessionFamily(db: Db, sid: string, userId: string): Promise<number> {
  const [row] = await db.select({ familyId: S.sessions.familyId, userId: S.sessions.userId })
    .from(S.sessions).where(eq(S.sessions.id, sid)).limit(1);
  if (!row || row.userId !== userId) return 0;
  // Under the family lock rotateSession also takes: a refresh in flight had
  // already claimed its token and was about to insert the next session, which
  // this UPDATE could not see - so sign-out answered 200 and that new session
  // went on working.
  return db.transaction(async (tx) => {
    await lockFamily(tx, row.familyId);
    const now = new Date();
    const stillMinting = new Date(now.getTime() - env.accessTtlSeconds * 1000);
    const revoked = await tx.update(S.sessions)
      .set({
        revokedAt: sql`coalesce(${S.sessions.revokedAt}, now())`,
        revokedReason: LOGOUT_REASON,
        updatedAt: now,
      })
      .where(and(
        eq(S.sessions.familyId, row.familyId),
        or(isNull(S.sessions.revokedAt), gt(S.sessions.createdAt, stillMinting)),
      ))
      .returning({ id: S.sessions.id });
    return revoked.length;
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serialise sign-out and rotation within one refresh-token family. Rotation is
 * claim-then-insert; without this, a sign-out landing between the two revoked
 * the claimed row and never saw the one inserted after it.
 */
async function lockFamily(tx: Tx, familyId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4, hashtext(${familyId}))`);
}

/** Creates a session and returns both tokens. */
export async function startSession(db: Db, userId: string, meta: { ip?: string; ua?: string }) {
  const roles = await rolesFor(db, userId);
  const familyId = randomUUID();
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 864e5);

  const [session] = await db.insert(S.sessions).values({
    userId, familyId, refreshHash: hash, expiresAt, ip: meta.ip, userAgent: meta.ua,
  }).returning({ id: S.sessions.id });

  return {
    accessToken: await issueAccessToken({ sub: userId, roles, sid: session.id }),
    refreshToken: raw,
    expiresIn: env.accessTtlSeconds,
    roles,
  };
}

/**
 * Rotates a refresh token. If the presented token was already consumed we treat
 * it as theft and revoke every session in the family.
 */
export async function rotateSession(db: Db, presented: string, meta: { ip?: string; ua?: string }) {
  const hash = sha256(presented);
  const [row] = await db.select().from(S.sessions).where(eq(S.sessions.refreshHash, hash)).limit(1);

  if (!row) return { ok: false as const, reason: "unknown_token" };

  /** Reuse of a consumed token: burn every live session in the family. */
  const burnFamily = () => db.update(S.sessions)
    .set({ revokedAt: new Date(), revokedReason: "reuse_detected", updatedAt: new Date() })
    .where(and(eq(S.sessions.familyId, row.familyId), isNull(S.sessions.revokedAt)));

  // Signed out by its owner: the family is already dead, and a refresh after
  // sign-out is not theft - it is a client that has not noticed yet.
  if (row.revokedAt && row.revokedReason === LOGOUT_REASON) {
    return { ok: false as const, reason: "signed_out" };
  }

  if (row.revokedAt) {
    await burnFamily();
    return { ok: false as const, reason: "reuse_detected", familyId: row.familyId };
  }

  if (row.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: "expired" };

  const next = newRefreshToken();

  /**
   * Claim the token with the UPDATE, not with the SELECT above.
   *
   * The read is a courtesy that produces the friendly answers — unknown,
   * expired, already-consumed. It cannot be the guard: two requests presenting
   * the SAME refresh token in the same instant both read `revoked_at IS NULL`,
   * both passed, and both minted a session. That is the exact scenario refresh
   * rotation exists to detect — one of those two callers is holding a stolen
   * token — and it was the one case that slipped through, because the theft
   * signal is "this token was used twice" and nothing made the two uses
   * serialise. Reuse a second later was caught; reuse a millisecond later was
   * rewarded with a valid session.
   *
   * `WHERE revoked_at IS NULL … RETURNING` makes Postgres the arbiter: exactly
   * one caller gets a row back. Whoever gets nothing has presented a token
   * somebody else just consumed, which is the same fact the branch above acts
   * on, so it gets the same answer — the family burns and both sides sign in
   * again.
   */
  // Claim and successor in one transaction, under the family lock that
  // revokeSessionFamily takes (see lockFamily).
  const outcome = await db.transaction(async (tx) => {
    await lockFamily(tx, row.familyId);
    const claimed = await tx.update(S.sessions)
      .set({ revokedAt: new Date(), revokedReason: "rotated", updatedAt: new Date() })
      .where(and(eq(S.sessions.id, row.id), isNull(S.sessions.revokedAt)))
      .returning({ id: S.sessions.id });

    if (!claimed.length) {
      // Signed out while this request waited for the lock: not theft.
      const [now] = await tx.select({ reason: S.sessions.revokedReason })
        .from(S.sessions).where(eq(S.sessions.id, row.id)).limit(1);
      if (now?.reason === LOGOUT_REASON) return { reason: "signed_out" as const };
      await tx.update(S.sessions)
        .set({ revokedAt: new Date(), revokedReason: "reuse_detected", updatedAt: new Date() })
        .where(and(eq(S.sessions.familyId, row.familyId), isNull(S.sessions.revokedAt)));
      return { reason: "reuse_detected" as const };
    }

    const [created] = await tx.insert(S.sessions).values({
      userId: row.userId, familyId: row.familyId, refreshHash: next.hash,
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 864e5),
      ip: meta.ip, userAgent: meta.ua,
    }).returning({ id: S.sessions.id });
    return { created };
  });

  if ("reason" in outcome) {
    return outcome.reason === "signed_out"
      ? { ok: false as const, reason: "signed_out" }
      : { ok: false as const, reason: "reuse_detected", familyId: row.familyId };
  }
  const { created } = outcome;

  const roles = await rolesFor(db, row.userId);
  return {
    ok: true as const,
    accessToken: await issueAccessToken({ sub: row.userId, roles, sid: created.id }),
    refreshToken: next.raw,
    expiresIn: env.accessTtlSeconds,
    roles,
  };
}

// ── request guards ─────────────────────────────────────────────────────────
declare module "fastify" {
  interface FastifyRequest { user?: Claims }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  // `requestId` is on every other error envelope and was missing here, which
  // made the two most common failures in the system — no token and an expired
  // one — the only two a user could not quote a reference for when reporting a
  // problem. It is the same id the structured logs are keyed on.
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({
      error: {
        code: "AUTH_REQUIRED", title: "Sign in to continue",
        retryable: false, requestId: req.id,
      },
    });
  }
  let claims: Claims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch {
    return reply.code(401).send({
      error: {
        // Retryable: the client's refresh path can very likely fix this without
        // the user doing anything, and it does.
        code: "AUTH_EXPIRED", title: "Your session has expired. Sign in again.",
        retryable: true, requestId: req.id,
      },
    });
  }
  // A signature proves who minted the token, not that its session is still
  // wanted: after POST /v1/auth/logout the access token would otherwise keep
  // working for the rest of its ten minutes. One primary-key lookup on the
  // token's own session. Tokens with no session (device tokens, sid "") are
  // not tied to a sign-in and skip it. Only a sign-out is refused here: a
  // family burned by reuse detection keeps its already-issued access tokens
  // until they expire, as it always has (the suites rely on that).
  if (claims.sid) {
    const revoked = await sessionSignedOut(claims.sid);
    if (revoked) {
      return reply.code(401).send({
        error: {
          code: "AUTH_REVOKED", title: "You signed out of this session. Sign in again.",
          retryable: false, requestId: req.id,
        },
      });
    }
  }
  req.user = claims;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the token's session was ended by sign-out. A malformed sid fails closed. */
async function sessionSignedOut(sid: string): Promise<boolean> {
  if (!UUID.test(sid)) return true;
  const [row] = await appDb.select({ reason: S.sessions.revokedReason })
    .from(S.sessions).where(eq(S.sessions.id, sid)).limit(1);
  return row?.reason === LOGOUT_REASON;
}

/** Role gate. Resource ownership is checked separately, at the resource. */
export function requireRole(...allowed: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.code(401).send({ error: { code: "unauthenticated", title: "Sign in to continue", retryable: false } });
    }
    if (!req.user.roles.some((r) => allowed.includes(r))) {
      return reply.code(403).send({
        error: { code: "forbidden", title: "Your account cannot perform this action", retryable: false },
      });
    }
  };
}

/**
 * Per-IP OTP request ceiling (threat #1's second axis). Counts every request
 * from the address in the window, consumed or not — an SMS-flood costs money
 * whether or not the codes get redeemed.
 */
export async function otpRequestsFromIp(db: Pick<Db, "select">, ip: string): Promise<number> {
  const since = new Date(Date.now() - env.otpWindowMinutes * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(S.otpChallenges)
    .where(and(eq(S.otpChallenges.ip, ip), gt(S.otpChallenges.createdAt, since)));
  return row?.n ?? 0;
}

/** Rate limit for OTP requests — threat #1. Counts unconsumed challenges. */
export async function otpAttemptsInWindow(db: Pick<Db, "select">, msisdn: string): Promise<number> {
  const since = new Date(Date.now() - env.otpWindowMinutes * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(S.otpChallenges)
    // gt() rather than a raw sql fragment: inside sql`` a JS Date is passed to the
    // driver untyped and postgres-js rejects it. Consumed challenges don't count:
    // a successful sign-in is not brute-force signal, only unredeemed codes are.
    .where(and(
      eq(S.otpChallenges.msisdn, msisdn),
      gt(S.otpChallenges.createdAt, since),
      isNull(S.otpChallenges.consumedAt),
    ));
  return row?.n ?? 0;
}

/**
 * Count both OTP limits and record the new challenge as ONE step.
 *
 * Counting and inserting separately let simultaneous requests all read the
 * same count: 200 requests for one address sent together all saw 0 and all
 * sent a real message. Each request now holds two transaction-scoped advisory
 * locks - one for the address or number, one for the connection - while it
 * counts and inserts, so the next request's count includes this one. Always
 * taken in the same order (key, then IP), so two requests cannot deadlock.
 */
export async function claimOtpChallenge(
  db: Db, key: string, ip: string, values: typeof S.otpChallenges.$inferInsert,
): Promise<{ limited: "key" | "ip" } | { id: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1, hashtext(${key}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2, hashtext(${ip}))`);
    if (await otpAttemptsInWindow(tx, key) >= env.otpMaxAttempts) return { limited: "key" as const };
    if (await otpRequestsFromIp(tx, ip) >= env.otpIpMax) return { limited: "ip" as const };
    const [row] = await tx.insert(S.otpChallenges).values(values).returning({ id: S.otpChallenges.id });
    return { id: row.id };
  });
}
