/**
 * Whether the JWT signing secret is fit for a server strangers can reach.
 *
 * Every access token is an HS256 signature over this one value. Anybody who
 * knows it can mint a token for any user with any role - admin included - and
 * no database row, rate limit or OTP stands in the way. The development default
 * is in the repository, so a reachable server still using it has no
 * authentication at all.
 *
 * assertProductionSafe already refused the default, but only for
 * NODE_ENV=production; the hosted demo runs as "demo" and was not covered.
 * This applies to everything that is not local development or a test run.
 */
import { isLocalEnv } from "./local-env.js";

/** The development default. Deliberately obvious so nobody ships it. */
export const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me";

/**
 * 32 characters is the floor, not the goal: 32 random bytes (as
 * `openssl rand -hex 32` or Render's generateValue produces) is what to use.
 */
export const MIN_JWT_SECRET_LENGTH = 32;

/** A description of what is wrong with JWT_SECRET, or null when it is usable. */
export function jwtSecretProblem(nodeEnv: string | undefined, raw: string | undefined): string | null {
  if (isLocalEnv(nodeEnv)) return null;
  const mode = nodeEnv ?? "development";
  const fix = 'Set it to 32+ random bytes, e.g. JWT_SECRET="$(openssl rand -hex 32)".';
  if (raw === undefined || raw.trim() === "") {
    return `JWT_SECRET is unset and NODE_ENV is "${mode}" - tokens would be signed with the public development default. ${fix}`;
  }
  if (raw === DEV_JWT_SECRET || raw.startsWith("dev-only")) {
    return `JWT_SECRET is still the development default, which is in the repository - anyone could mint an admin token. ${fix}`;
  }
  if (raw.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET is ${raw.length} characters; at least ${MIN_JWT_SECRET_LENGTH} are required when NODE_ENV is "${mode}". ${fix}`;
  }
  return null;
}
