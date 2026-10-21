/**
 * Self-serve account deletion and Unlink Google: the rules in
 * src/domain/account-deletion.ts. The database side (what is deleted, kept
 * and detached) is driven end to end by scripts/e2e-journey.mjs section 44
 * and attacked by scripts/security-audit.mjs.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DELETE_PHRASE, REAUTH_WINDOW_MS, anonymisedPlate, deletionRefusal, phraseMatches, selfDeleteRefusal,
  signInIsFresh, unlinkDecision,
} from "../src/domain/account-deletion.js";

const now = new Date("2026-10-21T10:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const citizen = { roles: ["citizen"], msisdn: "+917000004444" };
const none = new Set<string>();
const base = { account: citizen, protectedNumbers: none, phrase: DELETE_PHRASE, signInStartedAt: minutesAgo(2), now, openBookings: 0, openIncidents: 0 };

describe("the phrase", () => {
  it("is matched exactly, spaces around it ignored", () => {
    assert.ok(phraseMatches("DELETE MY ACCOUNT"));
    assert.ok(phraseMatches("  DELETE MY ACCOUNT \n"));
  });
  it("refuses anything else", () => {
    for (const v of ["delete my account", "DELETE", "DELETE  MY ACCOUNT", "", undefined, null, true, ["DELETE MY ACCOUNT"]]) {
      assert.equal(phraseMatches(v), false, JSON.stringify(v));
    }
  });
});

describe("who may delete themselves", () => {
  it("a plain citizen may", () => assert.equal(selfDeleteRefusal(citizen, none), null));
  it("any other role is refused, alone or beside citizen", () => {
    for (const r of [["admin"], ["mechanic"], ["support"], ["fleet_admin"], ["fleet_driver"], ["gov_officer"], ["citizen", "mechanic"]]) {
      assert.equal(selfDeleteRefusal({ roles: r, msisdn: null }, none), "privileged_account", r.join(","));
    }
  });
  it("an account with no roles fails closed", () => {
    assert.equal(selfDeleteRefusal({ roles: [], msisdn: null }, none), "privileged_account");
  });
  it("an EMAIL_SIGNIN number is refused", () => {
    assert.equal(selfDeleteRefusal(citizen, new Set([citizen.msisdn])), "email_signin_account");
  });
});

describe("a fresh sign-in", () => {
  it("is one that began within ten minutes", () => {
    assert.equal(REAUTH_WINDOW_MS, 600_000);
    assert.ok(signInIsFresh(minutesAgo(0), now));
    assert.ok(signInIsFresh(minutesAgo(9.9), now));
    assert.equal(signInIsFresh(minutesAgo(10.1), now), false);
  });
  it("an unknown, invalid or far-future start is not fresh", () => {
    assert.equal(signInIsFresh(null, now), false);
    assert.equal(signInIsFresh(new Date("nope"), now), false);
    assert.equal(signInIsFresh(new Date(now.getTime() + 5 * 60_000), now), false);
  });
});

describe("deletionRefusal", () => {
  it("allows a citizen with the phrase, a fresh sign-in and nothing open", () => {
    assert.equal(deletionRefusal(base), null);
  });
  it("names each refusal", () => {
    assert.equal(deletionRefusal({ ...base, phrase: "yes" }), "confirmation_required");
    assert.equal(deletionRefusal({ ...base, signInStartedAt: minutesAgo(11) }), "reauth_required");
    assert.equal(deletionRefusal({ ...base, openBookings: 1 }), "active_booking");
    assert.equal(deletionRefusal({ ...base, openIncidents: 1 }), "active_sos");
  });
  it("tells a privileged account about the by-request path before anything else", () => {
    assert.equal(deletionRefusal({ ...base, account: { roles: ["admin"], msisdn: null }, phrase: "", signInStartedAt: null }),
      "privileged_account");
  });
  it("refuses a shared demo number on a demo that shows its code, before the phrase", () => {
    assert.equal(deletionRefusal({ ...base, sharedDemo: true }), "shared_demo_account");
    assert.equal(deletionRefusal({ ...base, sharedDemo: true, phrase: "" }), "shared_demo_account");
    assert.equal(deletionRefusal({ ...base, sharedDemo: false }), null);
  });
  it("checks the phrase before the sign-in's age", () => {
    assert.equal(deletionRefusal({ ...base, phrase: "", signInStartedAt: null }), "confirmation_required");
  });
});

describe("Unlink Google", () => {
  it("unlinks when the account has a verified phone", () => {
    assert.deepEqual(unlinkDecision({ msisdn: "+917000004444", isVerified: true, googleSub: "sub-1" }), { action: "unlink" });
  });
  it("refuses without a phone, or with an unverified one", () => {
    assert.deepEqual(unlinkDecision({ msisdn: null, isVerified: false, googleSub: "sub-1" }), { action: "refuse", reason: "phone_required" });
    assert.deepEqual(unlinkDecision({ msisdn: "+917000004444", isVerified: false, googleSub: "sub-1" }), { action: "refuse", reason: "phone_required" });
  });
  it("nothing linked changes nothing", () => {
    assert.deepEqual(unlinkDecision({ msisdn: null, isVerified: false, googleSub: null }), { action: "nothing" });
  });
});

describe("anonymisedPlate", () => {
  it("fits the column, is unique per vehicle and is no real plate", () => {
    const p = anonymisedPlate("7d0c1e9a-1234-4567-8901-123456789012");
    assert.equal(p, "DEL-7D0C1E9A1234");
    assert.ok(p.length <= 16);
    assert.notEqual(p, anonymisedPlate("8d0c1e9a-1234-4567-8901-123456789012"));
  });
});
