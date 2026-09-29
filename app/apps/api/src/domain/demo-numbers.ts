/**
 * Which phone numbers a demo deployment may sign in, and who it must refuse.
 *
 * The hosted demo has no SMS gateway (SMS_PROVIDER=console, EXPOSE_DEV_OTP on),
 * so the phone "code" is the fixed development one and is printed on screen.
 * That is fine for a made-up number and is an open door for a real one: typing
 * a stranger's number signed you in as them, and typing a team member's or an
 * officer's number signed you in as that account, roles and all.
 *
 * So while the code is fixed or echoed, and the process is not local
 * development or a test run, the phone path accepts only numbers that are
 * demo numbers by construction:
 *
 *   +91 70000 00000 ... +91 70000 09999   the seeded synthetic citizens
 *   +91 98765 43210                       the documented demo citizen
 *   +91 96000 00000 ... +91 96000 00099   the seeded simulated fleet mechanics
 *
 * Hard-coded rather than configurable on purpose: the refusal message quotes
 * these ranges, the seeders create exactly these numbers, and a setting that
 * could widen the list would be one more way to reopen the door by accident.
 * Change the list, the message and the seeders together.
 *
 * Even inside those ranges an account holding a privileged role (admin,
 * gov_officer) is refused on the phone path: a role that can see every incident
 * must never be reachable with a code anybody can read off the screen. Those
 * accounts use email sign-in (EMAIL_SIGNIN) instead.
 *
 * In development and tests nothing here applies - the suites sign in random
 * numbers and the seeded admin with echoed codes, and must keep doing so.
 *
 * Pure, so the whole decision is unit-tested without a server.
 */
import { isLocalEnv } from "./local-env.js";

/** The one documented demo citizen outside the synthetic ranges. */
export const DEMO_CITIZEN = "+919876543210";

/** Inclusive ranges, as the national-significant number after +91. */
export const DEMO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [7000000000, 7000009999], // seed.ts synthetic citizens (+917000000000 ...)
  [9600000000, 9600000099], // seed.ts / seed-demo-fleet.ts simulated mechanics
];

/** Roles that are never signed in by a fixed or on-screen phone code outside development. */
export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set(["admin", "gov_officer"]);

const E164_IN = /^\+91(\d{10})$/;

export function isDemoNumber(msisdn: string): boolean {
  if (typeof msisdn !== "string") return false;
  const m = E164_IN.exec(msisdn);
  if (!m) return false;
  if (msisdn === DEMO_CITIZEN) return true;
  const n = Number(m[1]);
  return DEMO_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

export function holdsPrivilegedRole(roles: readonly string[]): boolean {
  return roles.some((r) => PRIVILEGED_ROLES.has(r));
}

/**
 * Whether the demo restrictions apply: the phone code is not a random one only
 * the handset receives (fixed, or echoed over HTTP), and this is not local
 * development or a test run.
 */
export function demoRestrictionsApply(opts: {
  nodeEnv: string | undefined;
  policy: { random: boolean; echo: boolean };
}): boolean {
  if (isLocalEnv(opts.nodeEnv)) return false;
  return !opts.policy.random || opts.policy.echo;
}

export interface PhoneSignInRefusal {
  status: 403;
  code: "email_signin_required" | "demo_number_required";
  title: string;
}

export const EMAIL_SIGNIN_REQUIRED: PhoneSignInRefusal = {
  status: 403,
  code: "email_signin_required",
  title: "This account signs in with its email address. Choose “Sign in with email”.",
};

export const DEMO_NUMBER_REQUIRED: PhoneSignInRefusal = {
  status: 403,
  code: "demo_number_required",
  title: "This demo signs in demo numbers only (real SMS is not connected). " +
    "Use +91 70000 00000 to +91 70000 09999, the demo citizen +91 98765 43210, " +
    "or a demo mechanic +91 96000 00000 to +91 96000 00099.",
};

/**
 * The seeded privileged demo accounts (seed-raksha.ts's authority), and the
 * only ones LOCAL_DEMO_PRIVILEGED_OTP opens.
 *
 * The one-command local demo (docker-compose.demo.yml) runs NODE_ENV=demo with
 * the code echoed, which refuses the authority account - so the documented
 * local walkthrough could not reach the RAKSHA dashboard. That compose file
 * sets LOCAL_DEMO_PRIVILEGED_OTP=true on a machine nobody else can reach. The
 * hosted demo never sets it, and production refuses to boot with it
 * (localDemoPrivilegedProblem). It opens these numbers and nothing else: every
 * other number, and every number behind EMAIL_SIGNIN, is refused as before.
 */
export const DEMO_PRIVILEGED_ACCOUNTS: ReadonlySet<string> = new Set(["+919999900001"]);

/** A description of why LOCAL_DEMO_PRIVILEGED_OTP may not be on here, or null. */
export function localDemoPrivilegedProblem(nodeEnv: string | undefined, enabled: boolean): string | null {
  if (!enabled || nodeEnv !== "production") return null;
  return "LOCAL_DEMO_PRIVILEGED_OTP is on and NODE_ENV is \"production\" - it lets the on-screen demo code " +
    "sign in the seeded admin, and is only for a local docker demo. Unset it.";
}

/**
 * The whole phone-path decision, applied both where the code is issued and
 * where it is redeemed. Null means the number may proceed.
 *
 * Order matters for what a refusal reveals:
 *   1. a number its owner put behind email (EMAIL_SIGNIN) is told to use email,
 *      exactly as before - in every environment;
 *   2. otherwise, under the demo restrictions, any number outside the demo
 *      ranges gets the same generic answer, so the endpoint does not reveal
 *      which real numbers hold an admin or officer account;
 *   3. a demo-range number whose account holds a privileged role is refused
 *      as email-only (fail closed, whether or not EMAIL_SIGNIN lists it).
 */
export function phoneSignInRefusal(input: {
  msisdn: string;
  nodeEnv: string | undefined;
  policy: { random: boolean; echo: boolean };
  /** phoneSignInBlocked(...) from email-signin.ts */
  emailBlocked: boolean;
  /** roles currently held by the account with this number; [] when there is none */
  roles: readonly string[];
  /** LOCAL_DEMO_PRIVILEGED_OTP: the local docker demo's opt-in, see above. */
  localDemoPrivileged?: boolean;
}): PhoneSignInRefusal | null {
  if (input.emailBlocked) return EMAIL_SIGNIN_REQUIRED;
  if (!demoRestrictionsApply(input)) return null;
  if (input.localDemoPrivileged && input.nodeEnv !== "production" &&
      DEMO_PRIVILEGED_ACCOUNTS.has(input.msisdn)) return null;
  if (!isDemoNumber(input.msisdn)) return DEMO_NUMBER_REQUIRED;
  if (holdsPrivilegedRole(input.roles)) return EMAIL_SIGNIN_REQUIRED;
  return null;
}
