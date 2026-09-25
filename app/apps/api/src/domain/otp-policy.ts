/**
 * Whether an OTP is real, and whether it may be shown.
 *
 * Two decisions that look like configuration and are actually security:
 *
 *   · A fixed code is safe ONLY when it cannot reach anybody. The console
 *     provider prints to a terminal the developer already controls; every other
 *     provider puts the code on a stranger's phone, and a fixed one there is not
 *     a credential at all.
 *
 *   · A code may be returned over HTTP ONLY when there is no other way to get
 *     it. The moment a real gateway is configured, echoing it hands the
 *     credential to anyone who can reach the endpoint — which, once the app is
 *     shared over a tunnel, is the internet.
 *
 * These were previously keyed off NODE_ENV, which coupled them to an unrelated
 * thing and made the ordinary case impossible: configuring Twilio in
 * development sent a real SMS containing the literal string 000000, and the
 * only way to get a random code was NODE_ENV=production — which
 * `assertProductionSafe` refuses without live payment keys, a non-dev database,
 * CORS origins and a telecom webhook secret. Nobody should need a payment
 * gateway to test a login.
 *
 * What actually matters is whether the code can be delivered. That is this
 * module, and it is pure so it can be tested without a server or a gateway.
 */

/** The provider that only logs. Anything else can reach a real handset. */
export const LOCAL_ONLY_PROVIDER = "console";

export interface OtpPolicy {
  /** Generate a fresh random code rather than using the fixed development one. */
  random: boolean;
  /** Include the code in the API response. */
  echo: boolean;
  /** What the caller should be told carried it. */
  channel: string;
}

export function otpPolicy(opts: {
  smsProvider: string;
  exposeDevOtp: boolean;
  /**
   * The code is the only way into an account that was taken off the demo path
   * (EMAIL_SIGNIN). Such a code is always random and never echoed, whatever the
   * provider: with the console one it reaches the server log and nowhere else.
   * The fixed development code here would let anyone who knows the address in.
   */
  guardsAccount?: boolean;
}): OtpPolicy {
  const canDeliver = opts.smsProvider !== LOCAL_ONLY_PROVIDER;
  if (opts.guardsAccount) {
    return { random: true, echo: false, channel: canDeliver ? opts.smsProvider : LOCAL_ONLY_PROVIDER };
  }
  return {
    random: canDeliver,
    // `exposeDevOtp` can only ever loosen this for the provider that cannot
    // deliver. It is never able to expose a code that was actually sent.
    echo: !canDeliver && opts.exposeDevOtp,
    channel: canDeliver ? opts.smsProvider : LOCAL_ONLY_PROVIDER,
  };
}
