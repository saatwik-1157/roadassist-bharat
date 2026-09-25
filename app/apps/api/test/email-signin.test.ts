/**
 * Email sign-in: who is allowed, what key a challenge is stored under, and when
 * the phone path is closed. Pure functions, no server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emailChallengeKey, parseEmailSignin, phoneSignInBlocked } from "../src/domain/email-signin.js";
import { otpPolicy } from "../src/domain/otp-policy.js";

test("EMAIL_SIGNIN maps addresses to accounts, case-insensitively", () => {
  const cfg = parseEmailSignin(" Owner@Example.com=+919999900001 ;mech@college.ac.in = +919600000000\n");
  assert.equal(cfg.accounts.get("owner@example.com"), "+919999900001");
  assert.equal(cfg.accounts.get("mech@college.ac.in"), "+919600000000");
  assert.deepEqual([...cfg.protectedNumbers].sort(), ["+919600000000", "+919999900001"]);
  assert.deepEqual(cfg.rejected, []);
});

test("malformed entries are dropped and reported, never half-applied", () => {
  const cfg = parseEmailSignin("a@b.co=919999900001, not-an-email=+919999900001, c@d.io=+919999900001=x, e@f.in=+915999900001, g@h.in=+919600000001, G@h.in=+919600000002");
  assert.deepEqual([...cfg.accounts.keys()], ["g@h.in"]);
  assert.equal(cfg.rejected.length, 5);
  assert.ok(!cfg.protectedNumbers.has("+919600000002"), "a duplicate address cannot take a second account");
});

test("a rejected entry is reported by position, never by its contents", () => {
  // The boot log prints these. A malformed entry cannot be masked reliably:
  // a missing "=" or a spaced number left the whole number in the log.
  const cfg = parseEmailSignin("owner@example.com+919999900001, ownerexample.com=+919999900001, " +
    "owner@example.com=+91 99999 00001, a@b.co=+919600000001, A@b.co=+919600000002");
  assert.equal(cfg.rejected.length, 4);
  for (const r of cfg.rejected) {
    assert.ok(!/\d{5}/.test(r.replace(/\s/g, "")), `a number reached the log: ${r}`);
    assert.ok(!/owner|example|b\.co/i.test(r), `an address reached the log: ${r}`);
  }
  assert.match(cfg.rejected[0], /^entry 1 /);
  assert.match(cfg.rejected[3], /^entry 5 /);
});

test("an email challenge key cannot collide with a phone number and hides the address", () => {
  const k = emailChallengeKey(" Owner@Example.com ");
  assert.equal(k, emailChallengeKey("owner@example.com"));
  assert.equal(k.length, 16, "fits the 16-character column");
  assert.ok(k.startsWith("e:") && !k.includes("owner"));
  assert.notEqual(emailChallengeKey("a@b.co"), emailChallengeKey("a@b.cc"));
});

test("a protected number is refused whenever the phone code is not a random one only the handset gets", () => {
  const cfg = parseEmailSignin("owner@example.com=+919999900001");
  const shown = otpPolicy({ smsProvider: "console", exposeDevOtp: true });
  const hiddenButFixed = otpPolicy({ smsProvider: "console", exposeDevOtp: false });
  const delivered = otpPolicy({ smsProvider: "twilio", exposeDevOtp: true });
  assert.equal(phoneSignInBlocked("+919999900001", cfg, shown), true);
  assert.equal(phoneSignInBlocked("+919999900001", cfg, hiddenButFixed), true,
    "EXPOSE_DEV_OTP=false hides the code, but with no gateway it is still the fixed DEV_OTP");
  assert.equal(phoneSignInBlocked("+919999900001", cfg, delivered), false, "a real SMS gateway delivers the code");
  assert.equal(phoneSignInBlocked("+919876543210", cfg, shown), false, "unlisted numbers keep the demo path");
});
