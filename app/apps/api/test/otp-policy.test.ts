/**
 * The two OTP decisions that look like configuration and are security.
 *
 * The case that motivated this module is the last one: `EXPOSE_DEV_OTP=true` is
 * the default in `.env.example`, and the moment a real gateway is configured
 * that flag must stop meaning anything. Before, the code was echoed over HTTP
 * regardless — which is fine on localhost and is handing out credentials the
 * moment the app is shared over a tunnel.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LOCAL_ONLY_PROVIDER, otpPolicy } from "../src/domain/otp-policy.js";

const REAL = ["twilio", "msg91", "some-future-vendor"];

describe("otpPolicy", () => {
  describe("with no gateway configured", () => {
    it("uses the fixed development code, because nothing can carry a real one", () => {
      const p = otpPolicy({ smsProvider: LOCAL_ONLY_PROVIDER, exposeDevOtp: true });
      assert.equal(p.random, false);
      assert.equal(p.channel, "console");
    });

    it("echoes it, because there is no other way to sign in", () => {
      assert.equal(otpPolicy({ smsProvider: "console", exposeDevOtp: true }).echo, true);
    });

    it("still respects EXPOSE_DEV_OTP=false", () => {
      assert.equal(otpPolicy({ smsProvider: "console", exposeDevOtp: false }).echo, false);
    });
  });

  describe("with a real gateway configured", () => {
    it("generates a real code for every provider that can deliver", () => {
      for (const provider of REAL) {
        const p = otpPolicy({ smsProvider: provider, exposeDevOtp: false });
        assert.equal(p.random, true, provider);
        assert.equal(p.channel, provider, provider);
      }
    });

    it("NEVER echoes the code, even with EXPOSE_DEV_OTP on", () => {
      // The flag is a convenience for developers with no gateway. It must not be
      // able to publish a credential that was actually sent to a handset — and
      // it is on by default, so this is the case that would have bitten.
      for (const provider of REAL) {
        assert.equal(
          otpPolicy({ smsProvider: provider, exposeDevOtp: true }).echo,
          false,
          `${provider} must not echo a delivered code`,
        );
      }
    });
  });

  it("a real code and an echoed code are mutually exclusive, always", () => {
    // The invariant behind both rules: a code is either undeliverable and
    // visible, or deliverable and secret. Never both.
    for (const provider of [LOCAL_ONLY_PROVIDER, ...REAL]) {
      for (const exposeDevOtp of [true, false]) {
        const p = otpPolicy({ smsProvider: provider, exposeDevOtp });
        assert.ok(
          !(p.random && p.echo),
          `${provider}/expose=${exposeDevOtp} would send a real code AND publish it`,
        );
      }
    }
  });

  it("does not depend on NODE_ENV at all", () => {
    // The whole point. Getting a real OTP used to require NODE_ENV=production,
    // which assertProductionSafe refuses without live payment keys among other
    // things — so testing a login needed a payment gateway.
    assert.equal(otpPolicy.length, 1, "takes only its explicit options");
    const src = otpPolicy.toString();
    assert.ok(!src.includes("NODE_ENV"), "policy must not read NODE_ENV");
  });
});
