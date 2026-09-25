/**
 * Sign-in by email, for the accounts the owner names, and nothing else.
 *
 * The demo deployment has no SMS gateway, so the phone OTP is shown on screen
 * (EXPOSE_DEV_OTP) - which means anyone who types the admin's number is the
 * admin. Email closes that for the accounts that matter: EMAIL_SIGNIN maps an
 * address to an existing account's number, the code goes to that inbox and is
 * never shown, and that number stops accepting the on-screen code.
 *
 *   EMAIL_SIGNIN="owner@example.com=+919999900001, mech@example.com=+919600000000"
 *
 * It lives in the host's environment, not in the repository: the addresses are
 * personal data and the mapping is a decision about who may act as whom.
 *
 * No new identity model: an email here is a second way to prove you are an
 * existing account, not a new account. That keeps roles, audit and sessions
 * exactly as they are, and needs no migration.
 */
import { createHash } from "node:crypto";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MSISDN = /^\+91[6-9]\d{9}$/;

export interface EmailSignin {
  /** lower-cased email -> E.164 number of the account it signs into */
  accounts: Map<string, string>;
  /** numbers that must use email while the phone code is shown on screen */
  protectedNumbers: Set<string>;
  /**
   * entries dropped, with the reason - reported at boot, never silently. By
   * position only: a malformed entry is exactly the one whose parts cannot be
   * told apart to mask, and the boot log is no place for a phone number.
   */
  rejected: string[];
}

export function parseEmailSignin(raw: string): EmailSignin {
  const accounts = new Map<string, string>(), protectedNumbers = new Set<string>(), rejected: string[] = [];
  let n = 0;
  for (const part of raw.split(/[,;\n]/)) {
    const entry = part.trim();
    if (!entry) continue;
    n++;
    const [left, right, extra] = entry.split("=").map((s) => s.trim());
    const email = (left ?? "").toLowerCase(), msisdn = right ?? "";
    if (extra !== undefined || !EMAIL.test(email) || !MSISDN.test(msisdn)) {
      rejected.push(`entry ${n} is not email=+91XXXXXXXXXX`);
      continue;
    }
    if (accounts.has(email)) { rejected.push(`entry ${n} repeats an address listed earlier`); continue; }
    accounts.set(email, msisdn);
    protectedNumbers.add(msisdn);
  }
  return { accounts, protectedNumbers, rejected };
}

/**
 * The key an email challenge is stored and rate-limited under.
 *
 * otp_challenges keys on a 16-character "msisdn" column. Rather than widen it
 * with a migration, an email challenge is stored under "e:" + 14 hex characters
 * of its SHA-256 - which cannot collide with a real number (those start "+"),
 * keeps the address itself out of the table, and lets the existing per-key and
 * per-IP rate limits apply unchanged.
 */
export function emailChallengeKey(email: string): string {
  return "e:" + createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 14);
}

/**
 * Whether a phone sign-in must be refused: whenever the phone code is not a
 * random one that only the handset receives. Echoed to the screen is the
 * obvious case, but EXPOSE_DEV_OTP=false does not close it - with no SMS
 * gateway the code is still the fixed DEV_OTP, just not printed. With a real
 * gateway the code reaches the handset, and the phone path is as good as the
 * email one.
 */
export function phoneSignInBlocked(msisdn: string, cfg: EmailSignin, policy: { random: boolean }): boolean {
  return !policy.random && cfg.protectedNumbers.has(msisdn);
}
