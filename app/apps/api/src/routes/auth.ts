/**
 * Phone-OTP sign-in: request a code, verify it, rotate the refresh token.
 *
 * First group lifted out of server.ts, which had grown to 3,000 lines and 49
 * routes. Nothing here changed on the way out — the handlers are verbatim, only
 * the wrapper and the imports are new. `rakshaRoutes` established the shape: a
 * plugin taking the app, reading shared state through module imports rather
 * than injection, so the seam is a registration line and nothing else.
 *
 * Auth went first because it is the most self-contained: three routes, one
 * shared schema, and no other group calls into it.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { randomInt } from "node:crypto";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok, msisdnSchema } from "../http.js";
import { audit } from "../audit.js";
import { alerts } from "../alerts.js";
import { emailSignin } from "./email-auth.js";
import { phoneSignInBlocked } from "../domain/email-signin.js";
import { sms } from "../providers.js";
import { t, resolveLocale } from "../i18n.js";
import { otpPolicy } from "../domain/otp-policy.js";
import {
  constantTimeEquals,
  otpAttemptsInWindow,
  otpRequestsFromIp,
  rotateSession,
  sha256,
  startSession,
} from "../auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/otp/request", async (req, reply) => {
    const { msisdn } = z.object({ msisdn: msisdnSchema }).parse(req.body);

    if (await otpAttemptsInWindow(db, msisdn) >= env.otpMaxAttempts) {
      return reply.code(429).send({
        error: {
          code: "too_many_requests",
          title: `Too many codes requested. Try again in ${env.otpWindowMinutes} minutes.`,
          retryable: true,
        },
      });
    }
    // Second axis of threat #1: one address hammering many numbers.
    if (await otpRequestsFromIp(db, req.ip) >= env.otpIpMax) {
      return reply.code(429).send({
        error: {
          code: "otp_ip_limited",
          title: `Too many codes requested from this connection. Try again in ${env.otpWindowMinutes} minutes.`,
          retryable: true,
        },
      });
    }

    // Whether the code is real, and whether it may be shown — see otp-policy.ts.
    const policy = otpPolicy({
      smsProvider: env.sms.provider,
      exposeDevOtp: env.exposeDevOtp,
    });

    // randomInt, not Math.random. Math.random is a PRNG seeded per process and is
    // not unpredictable to an attacker who has seen previous outputs — for a
    // credential with a five-minute life and a six-digit space, that is the
    // difference between guessing 1-in-900000 and computing the next one.
    // An account its owner put behind email sign-in cannot be entered with a
    // code that is printed on the screen, or with the fixed development code
    // that is merely not printed - either would make the email pointless.
    if (phoneSignInBlocked(msisdn, emailSignin, policy)) {
      return reply.code(403).send({
        error: {
          code: "email_signin_required",
          title: "This account signs in with its email address. Choose “Sign in with email”.",
          retryable: false,
        },
      });
    }

    const code = policy.random ? String(randomInt(100000, 1000000)) : env.devOtp;
    await db.insert(S.otpChallenges).values({
      msisdn, codeHash: sha256(code), ip: req.ip,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });

    /**
     * The OTP is the first message the platform ever sends somebody, and until
     * now it was always English.
     *
     * A returning number already told us its language — possibly by texting
     * `LANG HI` from a phone with no settings screen. A number we have never
     * seen has told us nothing, so the browser's Accept-Language is the only
     * hint available, and English is the floor.
     */
    const [known] = await db.select({ lang: S.users.preferredLanguage })
      .from(S.users).where(eq(S.users.msisdn, msisdn)).limit(1);
    const otpLocale = resolveLocale({
      stored: known?.lang,
      acceptLanguage: req.headers["accept-language"],
    });
    await sms.send(msisdn, t(otpLocale, "otp.code", { code }));

    return ok(
      { sent: true, expiresInSeconds: 300, channel: policy.channel },
      policy.echo
        ? { devOtp: code, note: "Returned only because SMS_PROVIDER=console and EXPOSE_DEV_OTP is on" }
        : {},
    );
  });

  app.post("/v1/auth/otp/verify", async (req, reply) => {
    const { msisdn, code } = z.object({ msisdn: msisdnSchema, code: z.string().length(6) }).parse(req.body);

    const [challenge] = await db.select().from(S.otpChallenges)
      .where(and(eq(S.otpChallenges.msisdn, msisdn), isNull(S.otpChallenges.consumedAt)))
      .orderBy(desc(S.otpChallenges.createdAt)).limit(1);

    const invalid = () => (alerts.otpFailure(msisdn), reply.code(401).send({
      error: { code: "otp_invalid", title: "That code is not right. Check it and try again.", retryable: true },
    }));

    if (!challenge) return invalid();
    if (challenge.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({
        error: { code: "otp_expired", title: "That code has expired. Request a new one.", retryable: true },
      });
    }
    if (challenge.attempts >= env.otpMaxAttempts) {
      alerts.otpFailure(msisdn);
      return reply.code(429).send({
        error: { code: "otp_locked", title: "Too many wrong attempts. Request a new code.", retryable: true },
      });
    }
    if (!constantTimeEquals(sha256(code), challenge.codeHash)) {
      await db.update(S.otpChallenges)
        .set({ attempts: challenge.attempts + 1, updatedAt: new Date() })
        .where(eq(S.otpChallenges.id, challenge.id));
      return invalid();
    }

    await db.update(S.otpChallenges)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(eq(S.otpChallenges.id, challenge.id));

    let [user] = await db.select().from(S.users).where(eq(S.users.msisdn, msisdn)).limit(1);
    let created = false;
    if (!user) {
      [user] = await db.insert(S.users).values({ msisdn, isVerified: true }).returning();
      const [citizen] = await db.select().from(S.roles).where(eq(S.roles.name, "citizen")).limit(1);
      if (citizen) await db.insert(S.userRoles).values({ userId: user.id, roleId: citizen.id });
      created = true;
    } else if (!user.isVerified) {
      await db.update(S.users).set({ isVerified: true, updatedAt: new Date() }).where(eq(S.users.id, user.id));
    }

    const session = await startSession(db, user.id, { ip: req.ip, ua: req.headers["user-agent"] });

    // Sign-in is an auditable event, and it is one of the few whose ABSENCE is
    // also evidence — a session that exists with no login behind it means a token
    // was minted some other way. The MSISDN is deliberately not written here: the
    // subject id already identifies the account, and repeating the phone number
    // in an append-only table only widens what a leak of that table exposes.
    await audit({
      actorId: user.id, actorRole: "citizen", action: "auth.login",
      entity: "user", entityId: user.id,
      after: { newAccount: created, sessionCreated: true },
      ip: req.ip,
    });

    alerts.signin(msisdn, session.roles, created);
    return ok({ ...session, user: { id: user.id, msisdn: user.msisdn, fullName: user.fullName } }, { newAccount: created });
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    const result = await rotateSession(db, refreshToken, { ip: req.ip, ua: req.headers["user-agent"] });
    if (!result.ok) {
      return reply.code(401).send({
        error: {
          code: result.reason,
          title: result.reason === "reuse_detected"
            ? "For your security every session has been signed out. Please sign in again."
            : "Your session has expired. Sign in again.",
          retryable: false,
        },
      });
    }
    return ok(result);
  });
}
