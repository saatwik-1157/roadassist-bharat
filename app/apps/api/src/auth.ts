/**
 * Phase 4 authentication: phone OTP → short-lived access token + rotating
 * refresh token, with resource-scoped RBAC.
 *
 * Reuse of a consumed refresh token revokes the entire family — the standard
 * defence against a stolen token, and threat #6 in the threat model.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";
import type { Db } from "./db.js";
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
  const claimed = await db.update(S.sessions)
    .set({ revokedAt: new Date(), revokedReason: "rotated", updatedAt: new Date() })
    .where(and(eq(S.sessions.id, row.id), isNull(S.sessions.revokedAt)))
    .returning({ id: S.sessions.id });

  if (!claimed.length) {
    await burnFamily();
    return { ok: false as const, reason: "reuse_detected", familyId: row.familyId };
  }

  const [created] = await db.insert(S.sessions).values({
    userId: row.userId, familyId: row.familyId, refreshHash: next.hash,
    expiresAt: new Date(Date.now() + env.refreshTtlDays * 864e5),
    ip: meta.ip, userAgent: meta.ua,
  }).returning({ id: S.sessions.id });

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
  try {
    req.user = await verifyAccessToken(header.slice(7));
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
export async function otpRequestsFromIp(db: Db, ip: string): Promise<number> {
  const since = new Date(Date.now() - env.otpWindowMinutes * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(S.otpChallenges)
    .where(and(eq(S.otpChallenges.ip, ip), gt(S.otpChallenges.createdAt, since)));
  return row?.n ?? 0;
}

/** Rate limit for OTP requests — threat #1. Counts unconsumed challenges. */
export async function otpAttemptsInWindow(db: Db, msisdn: string): Promise<number> {
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
