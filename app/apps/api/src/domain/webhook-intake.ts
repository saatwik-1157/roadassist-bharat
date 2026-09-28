/**
 * Whether an inbound SMS webhook request may be acted on.
 *
 * The feature-phone path treats the sending MSISDN as the identity, so a request
 * that is not provably from the telecom vendor lets anybody pose as any phone
 * number: raise an SOS in their name, read their booking, cancel it. The
 * signature is the only thing standing between that and the internet.
 *
 * It used to be checked only when TELECOM_WEBHOOK_SECRET was set, and the hosted
 * demo does not set it — `assertProductionSafe` covers NODE_ENV=production
 * alone, so the demo was an open intake for every number in India. The rule now:
 *
 *   · a secret is configured → every request must carry a valid signature,
 *     demo numbers included (401 webhook_unsigned otherwise);
 *   · no secret, a local environment (development, test, or the CI image
 *     smoke test — the allow-list in domain/local-env.ts) → accepted unsigned,
 *     as before, and the response says so;
 *   · no secret, anything else → refused (503 webhook_not_configured), EXCEPT
 *     for the published demo numbers, so the demo keeps its feature-phone
 *     demonstration without being a way to act as a real person.
 *
 * Pure, so every branch is unit-tested without a server.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isLocalEnv } from "./local-env.js";

export type IntakeMode = "signed" | "unsigned_development" | "unsigned_demo_number";

export type IntakeDecision =
  | { accept: true; mode: IntakeMode }
  | {
      accept: false;
      status: 401 | 503;
      code: "webhook_unsigned" | "webhook_not_configured";
      title: string;
    };

export interface IntakeInput {
  /** TELECOM_WEBHOOK_SECRET; empty when unset. */
  secret: string;
  nodeEnv: string | undefined;
  /** The exact bytes the vendor signed. */
  rawBody: string;
  /** x-roadassist-signature, hex HMAC-SHA256(secret, rawBody). */
  signature: string | undefined;
  /** The claimed sender, as it arrived — before validation, so it may be anything. */
  from: unknown;
  isDemoNumber: (msisdn: string) => boolean;
}

export function signatureFor(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function decideWebhookIntake(input: IntakeInput): IntakeDecision {
  if (input.secret) {
    const presented = input.signature ?? "";
    if (presented && sameHex(presented, signatureFor(input.secret, input.rawBody))) {
      return { accept: true, mode: "signed" };
    }
    return { accept: false, status: 401, code: "webhook_unsigned",
             title: "Missing or invalid webhook signature" };
  }

  if (isLocalEnv(input.nodeEnv)) {
    return { accept: true, mode: "unsigned_development" };
  }

  if (typeof input.from === "string" && input.isDemoNumber(input.from)) {
    return { accept: true, mode: "unsigned_demo_number" };
  }

  return {
    accept: false, status: 503, code: "webhook_not_configured",
    title: "The SMS webhook is not configured on this server (TELECOM_WEBHOOK_SECRET is unset), " +
           "so it accepts unsigned messages only from the published demo numbers.",
  };
}
