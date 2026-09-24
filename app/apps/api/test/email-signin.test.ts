/**
 * Email sign-in: who is allowed, what key a challenge is stored under, and when
 * the phone path is closed. Pure functions, no server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { emailChallengeKey, parseEmailSignin, phoneSignInBlocked } from "../src/domain/email-signin.js";

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

test("an email challenge key cannot collide with a phone number and hides the address", () => {
  const k = emailChallengeKey(" Owner@Example.com ");
  assert.equal(k, emailChallengeKey("owner@example.com"));
  assert.equal(k.length, 16, "fits the 16-character column");
  assert.ok(k.startsWith("e:") && !k.includes("owner"));
  assert.notEqual(emailChallengeKey("a@b.co"), emailChallengeKey("a@b.cc"));
});

test("a protected number is refused only while the phone code is shown on screen", () => {
  const cfg = parseEmailSignin("owner@example.com=+919999900001");
  assert.equal(phoneSignInBlocked("+919999900001", cfg, true), true);
  assert.equal(phoneSignInBlocked("+919999900001", cfg, false), false, "a real SMS gateway delivers the code");
  assert.equal(phoneSignInBlocked("+919876543210", cfg, true), false, "unlisted numbers keep the demo path");
});
