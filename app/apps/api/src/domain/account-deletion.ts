/**
 * Self-serve account deletion and Unlink Google: the rules, with no database
 * of their own, so apps/api/test/account-deletion.test.ts can pin every one.
 * routes/account.ts applies them; app/docs/SECURITY.md ("Deleting an
 * account") says what is deleted, what is kept and why.
 *
 * ── who may delete themselves ─────────────────────────────────────────────
 * A plain citizen account only. An admin, mechanic, operator (support,
 * fleet), RAKSHA officer or any account listed in EMAIL_SIGNIN is refused
 * with its own code and keeps the by-request path in privacy.html: those
 * accounts hold other people's work (jobs, reviews, verified hazards,
 * device registrations) and one click must not orphan it.
 *
 * ── the deliberate confirmation ───────────────────────────────────────────
 * Two things, both required:
 *
 *   1. The body carries the exact phrase DELETE_PHRASE. A stray tap, a
 *      replayed request body from another endpoint, or a client bug that
 *      POSTs {} deletes nothing.
 *   2. A FRESH SIGN-IN: the session's refresh-token family began less than
 *      REAUTH_WINDOW_MS ago. Chosen over an OTP re-verification because:
 *        - it works for every way a citizen signs in. A Google sign-up that
 *          never added a phone has no number to send a code to, so an OTP
 *          step would lock exactly those people out of deleting themselves;
 *        - it proves the same thing an OTP would (the person holds the sign-in
 *          factor now) without a second, separately rate-limited code path
 *          and its SMS cost;
 *        - it is measured from the FAMILY's first session, not the access
 *          token's iat: every refresh mints a new session row in the same
 *          family, so a stolen refresh token - which can be rotated for 30
 *          days - never makes a session fresh. Only signing in again does.
 *
 * ── what cannot be deleted mid-job ────────────────────────────────────────
 * An open booking (anything but PAID or CANCELLED: a mechanic may be on the
 * way, or is owed for finished work) and an open SOS (an emergency somebody
 * may be acting on) are refused with their own codes; the person cancels or
 * finishes them first.
 */

/** Typed by the person, exactly (surrounding spaces ignored). Never translated: it is a key, not a sentence. */
export const DELETE_PHRASE = "DELETE MY ACCOUNT";

/** How recent the sign-in must be. */
export const REAUTH_WINDOW_MS = 10 * 60_000;

/** sessions.revoked_reason for every session of a deleted account; authenticate refuses it. */
export const ACCOUNT_DELETED_REASON = "account_deleted";

/** Booking statuses that end a booking's claim on anyone. Everything else blocks deletion. */
export const SETTLED_BOOKING_STATUSES: readonly string[] = ["PAID", "CANCELLED"];

/** Incident statuses that are over. Everything else is an open SOS. */
export const CLOSED_INCIDENT_STATUSES: readonly string[] = ["CANCELLED", "RESOLVED"];

export type DeletionRefusal =
  | "privileged_account"      // holds any role but citizen
  | "email_signin_account"    // its number is in EMAIL_SIGNIN
  | "shared_demo_account"     // a published demo number on a demo that shows the sign-in code
  | "confirmation_required"   // the phrase is missing or wrong
  | "reauth_required"         // the sign-in is older than REAUTH_WINDOW_MS
  | "active_booking"          // a booking that is not PAID or CANCELLED
  | "active_sos";             // an incident that is not CANCELLED or RESOLVED

export const DELETION_STATUS: Record<DeletionRefusal, number> = {
  privileged_account: 403,
  email_signin_account: 403,
  shared_demo_account: 403,
  confirmation_required: 400,
  reauth_required: 403,
  active_booking: 409,
  active_sos: 409,
};

export const DELETION_TITLES: Record<DeletionRefusal | "phone_required", string> = {
  privileged_account: "This kind of account is deleted on request, not from the app. See the privacy policy for how to ask.",
  email_signin_account: "This account signs in by email and is deleted on request. See the privacy policy for how to ask.",
  shared_demo_account: "This is a shared demo number that anyone can sign in with, so it cannot be deleted. Sign in with Google for an account of your own.",
  confirmation_required: `Type ${DELETE_PHRASE} exactly to confirm.`,
  reauth_required: "For your safety, sign out and sign in again, then delete your account within 10 minutes.",
  active_booking: "Finish, pay or cancel your open booking first.",
  active_sos: "Resolve or cancel your open SOS first.",
  phone_required: "Add and verify a phone number first, or you could not sign in again after unlinking Google.",
};

/** The phrase, exactly. Anything that is not a string is not the phrase. */
export function phraseMatches(value: unknown): boolean {
  return typeof value === "string" && value.trim() === DELETE_PHRASE;
}

/** Whether this kind of account may delete itself from the app (null: it may). */
export function selfDeleteRefusal(
  account: { roles: readonly string[]; msisdn: string | null },
  protectedNumbers: ReadonlySet<string>,
): "privileged_account" | "email_signin_account" | null {
  // No roles at all is not "a citizen": fail closed.
  if (!account.roles.length || account.roles.some((r) => r !== "citizen")) return "privileged_account";
  if (account.msisdn && protectedNumbers.has(account.msisdn)) return "email_signin_account";
  return null;
}

/**
 * Whether a sign-in that began at `startedAt` is fresh at `now`. A start in
 * the future beyond a minute of clock skew is not trusted; an unknown start
 * is not fresh.
 */
export function signInIsFresh(startedAt: Date | null | undefined, now: Date, windowMs = REAUTH_WINDOW_MS): boolean {
  if (!startedAt || Number.isNaN(startedAt.getTime())) return false;
  const age = now.getTime() - startedAt.getTime();
  return age >= -60_000 && age <= windowMs;
}

/**
 * Every check, in the order a person should hear them: what kind of account
 * this is first (an admin with a wrong phrase is told about the by-request
 * path, not about the phrase), then the phrase, then the sign-in's age, then
 * what is still open.
 */
export function deletionRefusal(input: {
  account: { roles: readonly string[]; msisdn: string | null };
  protectedNumbers: ReadonlySet<string>;
  phrase: unknown;
  signInStartedAt: Date | null | undefined;
  now: Date;
  openBookings: number;
  openIncidents: number;
  /**
   * The account is a published demo number on a deployment whose phone code
   * is shown on screen (demo-numbers.ts demoRestrictionsApply): everyone who
   * tries the demo shares it, so one visitor must not delete it for the rest.
   */
  sharedDemo?: boolean;
}): DeletionRefusal | null {
  const kind = selfDeleteRefusal(input.account, input.protectedNumbers);
  if (kind) return kind;
  if (input.sharedDemo) return "shared_demo_account";
  if (!phraseMatches(input.phrase)) return "confirmation_required";
  if (!signInIsFresh(input.signInStartedAt, input.now)) return "reauth_required";
  if (input.openBookings > 0) return "active_booking";
  if (input.openIncidents > 0) return "active_sos";
  return null;
}

/**
 * Unlink Google. Refused unless the account has a VERIFIED phone: a Google
 * sign-up that never added one would be left with no way to sign in at all.
 * Nothing linked is not an error - the answer just says nothing changed.
 */
export function unlinkDecision(account: { msisdn: string | null; isVerified: boolean; googleSub: string | null }):
  { action: "unlink" } | { action: "nothing" } | { action: "refuse"; reason: "phone_required" } {
  if (!account.googleSub) return { action: "nothing" };
  if (!account.msisdn || !account.isVerified) return { action: "refuse", reason: "phone_required" };
  return { action: "unlink" };
}

/**
 * The replacement registration number for an anonymised vehicle: unique (from
 * the row id), at most 16 characters (the column), and never a real plate
 * (Indian plates do not start with "DEL-"), so the real plate is free to be
 * registered again by a new account.
 */
export function anonymisedPlate(vehicleId: string): string {
  return "DEL-" + vehicleId.replace(/-/g, "").slice(0, 12).toUpperCase();
}
