/**
 * Email sign-in: request a code by email, verify it. See domain/email-signin.ts
 * for why it exists and who may use it.
 *
 * The verify half deliberately repeats the phone verify's checks - expiry, the
 * attempt cap, the constant-time compare - rather than sharing a helper with
 * it: the phone handler is the one every test and the security audit exercise,
 * and it stays untouched by this addition.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { randomInt } from "node:crypto";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok } from "../http.js";
import { audit } from "../audit.js";
import { alerts } from "../alerts.js";
import { email as mail } from "../providers.js";
import { otpPolicy } from "../domain/otp-policy.js";
import { emailChallengeKey, parseEmailSignin } from "../domain/email-signin.js";
import { constantTimeEquals, otpAttemptsInWindow, otpRequestsFromIp, sha256, startSession } from "../auth.js";

export const emailSignin = parseEmailSignin(env.emailSignin);

const emailSchema = z.string().trim().toLowerCase().email().max(160);

export async function emailAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/email/request", async (req, reply) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const key = emailChallengeKey(email);

    if (await otpAttemptsInWindow(db, key) >= env.otpMaxAttempts) {
      return reply.code(429).send({ error: { code: "too_many_requests",
        title: `Too many codes requested. Try again in ${env.otpWindowMinutes} minutes.`, retryable: true } });
    }
    if (await otpRequestsFromIp(db, req.ip) >= env.otpIpMax) {
      return reply.code(429).send({ error: { code: "otp_ip_limited",
        title: `Too many codes requested from this connection. Try again in ${env.otpWindowMinutes} minutes.`, retryable: true } });
    }

    // Same rule as the phone code (otp-policy.ts), keyed on the email provider:
    // a code that can reach an inbox is random and never echoed.
    const policy = otpPolicy({ smsProvider: mail.name, exposeDevOtp: env.exposeDevOtp });
    const accepted = ok({ sent: true, expiresInSeconds: 300, channel: "email" });

    // An address nobody listed gets the same answer and no email, so the
    // endpoint cannot be used to find out which addresses are registered.
    if (!emailSignin.accounts.has(email)) return accepted;

    const code = policy.random ? String(randomInt(100000, 1000000)) : env.devOtp;
    const [challenge] = await db.insert(S.otpChallenges).values({
      msisdn: key, codeHash: sha256(code), ip: req.ip, channel: "email",
      expiresAt: new Date(Date.now() + 5 * 60_000),
    }).returning({ id: S.otpChallenges.id });

    try {
      await mail.send(email, "Your RoadAssist-Bharat sign-in code",
        [`Your RoadAssist-Bharat sign-in code is ${code}.`, "",
          "It expires in 5 minutes and works once.",
          "If you did not ask to sign in, ignore this email: nobody can sign in without the code."].join("\n"));
    } catch (err) {
      // A code that was never delivered must not stay redeemable.
      await db.delete(S.otpChallenges).where(eq(S.otpChallenges.id, challenge.id));
      req.log.warn({ err: err instanceof Error ? err.message.slice(0, 200) : String(err) }, "email sign-in code not delivered");
      return reply.code(502).send({ error: { code: "email_not_sent",
        title: "The code could not be emailed. Try again in a minute.", retryable: true } });
    }

    return policy.echo
      ? ok({ sent: true, expiresInSeconds: 300, channel: "email" },
        { devOtp: code, note: "Returned only because EMAIL_PROVIDER=console and EXPOSE_DEV_OTP is on" })
      : accepted;
  });

  app.post("/v1/auth/email/verify", async (req, reply) => {
    const { email, code } = z.object({ email: emailSchema, code: z.string().length(6) }).parse(req.body);
    const msisdn = emailSignin.accounts.get(email);
    const key = emailChallengeKey(email);

    const invalid = () => {
      if (msisdn) alerts.otpFailure(msisdn);
      return reply.code(401).send({ error: { code: "otp_invalid",
        title: "That code is not right. Check it and try again.", retryable: true } });
    };
    if (!msisdn) return invalid();

    const [challenge] = await db.select().from(S.otpChallenges)
      .where(and(eq(S.otpChallenges.msisdn, key), isNull(S.otpChallenges.consumedAt)))
      .orderBy(desc(S.otpChallenges.createdAt)).limit(1);
    if (!challenge) return invalid();
    if (challenge.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({ error: { code: "otp_expired", title: "That code has expired. Request a new one.", retryable: true } });
    }
    if (challenge.attempts >= env.otpMaxAttempts) {
      alerts.otpFailure(msisdn);
      return reply.code(429).send({ error: { code: "otp_locked", title: "Too many wrong attempts. Request a new code.", retryable: true } });
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

    // The listed number is the account. If it does not exist yet it is created
    // exactly as a first phone sign-in would create it: a verified citizen.
    let [user] = await db.select().from(S.users).where(eq(S.users.msisdn, msisdn)).limit(1);
    let created = false;
    if (!user) {
      [user] = await db.insert(S.users).values({ msisdn, email, isVerified: true }).returning();
      const [citizen] = await db.select().from(S.roles).where(eq(S.roles.name, "citizen")).limit(1);
      if (citizen) await db.insert(S.userRoles).values({ userId: user.id, roleId: citizen.id });
      created = true;
    } else if (!user.email) {
      // Record the address the account has now proved it owns.
      await db.update(S.users).set({ email, updatedAt: new Date() }).where(eq(S.users.id, user.id));
    }

    const session = await startSession(db, user.id, { ip: req.ip, ua: req.headers["user-agent"] });
    await audit({
      actorId: user.id, actorRole: session.roles[0] ?? "citizen", action: "auth.login",
      entity: "user", entityId: user.id,
      after: { newAccount: created, sessionCreated: true, channel: "email" },
      ip: req.ip,
    });
    alerts.signin(msisdn, session.roles, created);

    return ok({ ...session, user: { id: user.id, msisdn: user.msisdn, fullName: user.fullName } }, { newAccount: created, channel: "email" });
  });
}
