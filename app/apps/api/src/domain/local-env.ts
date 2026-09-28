/**
 * Whether this process is a developer's own machine or a test run.
 *
 * The shortcuts that make local work pleasant - a fixed or echoed OTP for any
 * number, an admin signed in by phone, the obvious development JWT secret - are
 * safe only where nobody but the developer can reach the port. Anything else
 * ("demo", "staging", "production", or a value nobody expected) is treated as
 * reachable by strangers.
 *
 * An allow-list on purpose: a typo such as NODE_ENV=prodution must land on the
 * strict side, not the permissive one.
 */
// "ci" is the image smoke test in publish-image.yml: a runner's port that only
// the workflow itself can reach, running the same suites as development.
export const LOCAL_ENVS: ReadonlySet<string> = new Set(["development", "test", "ci"]);

export function isLocalEnv(nodeEnv: string | undefined): boolean {
  // Unset means development everywhere else in env.ts, so it does here too.
  return LOCAL_ENVS.has(nodeEnv ?? "development");
}
