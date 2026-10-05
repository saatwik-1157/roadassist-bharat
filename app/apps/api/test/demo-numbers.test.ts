/**
 * Who the phone path may sign in on a demo with no SMS gateway.
 *
 * The hosted demo runs NODE_ENV=demo, SMS_PROVIDER=console, EXPOSE_DEV_OTP=true:
 * the code is fixed and printed on screen. Before this, typing any real number
 * signed you in as its owner, and typing an admin's or officer's number signed
 * you in with their role.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DEMO_CITIZEN,
  DEMO_NUMBER_REQUIRED,
  DEMO_PRIVILEGED_ACCOUNTS,
  localDemoPrivilegedProblem,
  EMAIL_SIGNIN_REQUIRED,
  demoRestrictionsApply,
  holdsPrivilegedRole,
  isDemoNumber,
  phoneSignInRefusal,
} from "../src/domain/demo-numbers.js";
import { isLocalEnv } from "../src/domain/local-env.js";
import { otpPolicy } from "../src/domain/otp-policy.js";
import { parseEmailSignin, phoneSignInBlocked } from "../src/domain/email-signin.js";

/** Exactly what the hosted demo configures (render.yaml). */
const DEMO_POLICY = otpPolicy({ smsProvider: "console", exposeDevOtp: true });
const GATEWAY_POLICY = otpPolicy({ smsProvider: "twilio", exposeDevOtp: true });

describe("isDemoNumber", () => {
  it("accepts the whole synthetic citizen range and nothing either side", () => {
    assert.equal(isDemoNumber("+917000000000"), true);
    assert.equal(isDemoNumber("+917000000042"), true);
    assert.equal(isDemoNumber("+917000009999"), true);
    assert.equal(isDemoNumber("+917000010000"), false, "one past the top");
    assert.equal(isDemoNumber("+916999999999"), false, "one below the bottom");
  });

  it("accepts the documented demo citizen, which sits inside the synthetic range", () => {
    assert.equal(DEMO_CITIZEN, "+917000009876");
    assert.equal(isDemoNumber(DEMO_CITIZEN), true);
  });

  it("no longer accepts the retired real-looking default +919876543210", () => {
    assert.equal(isDemoNumber("+919876543210"), false, "it may be somebody's phone");
    assert.equal(isDemoNumber("+919876543211"), false);
  });

  it("accepts the simulated fleet mechanics +919600000000..+919600000099", () => {
    assert.equal(isDemoNumber("+919600000000"), true);
    assert.equal(isDemoNumber("+919600000023"), true);
    assert.equal(isDemoNumber("+919600000099"), true);
    assert.equal(isDemoNumber("+919600000100"), false);
  });

  it("refuses ordinary and privileged real-looking numbers", () => {
    for (const n of ["+919123456789", "+919999900001", "+919999999999", "+918888888888"]) {
      assert.equal(isDemoNumber(n), false, n);
    }
  });

  it("refuses anything that is not exactly +91 and ten digits", () => {
    for (const n of ["917000000042", "+9170000000420", "+91700000004", "+1 7000000042", " +917000000042", "+91700000004x", ""]) {
      assert.equal(isDemoNumber(n), false, JSON.stringify(n));
    }
    assert.equal(isDemoNumber(undefined as unknown as string), false);
  });
});

describe("demoRestrictionsApply", () => {
  it("never applies in development or tests - the suites depend on it", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      assert.equal(isLocalEnv(nodeEnv), true, String(nodeEnv));
      assert.equal(demoRestrictionsApply({ nodeEnv, policy: DEMO_POLICY }), false, String(nodeEnv));
    }
  });

  it("applies to the demo's console + echo policy outside development", () => {
    for (const nodeEnv of ["demo", "staging", "production", "prodution", ""]) {
      assert.equal(demoRestrictionsApply({ nodeEnv, policy: DEMO_POLICY }), true, nodeEnv);
    }
  });

  it("applies to a fixed code that is merely not echoed", () => {
    const fixedHidden = otpPolicy({ smsProvider: "console", exposeDevOtp: false });
    assert.equal(fixedHidden.random, false);
    assert.equal(demoRestrictionsApply({ nodeEnv: "demo", policy: fixedHidden }), true);
  });

  it("does not apply once a real gateway delivers a random code", () => {
    assert.equal(demoRestrictionsApply({ nodeEnv: "demo", policy: GATEWAY_POLICY }), false);
    assert.equal(demoRestrictionsApply({ nodeEnv: "production", policy: GATEWAY_POLICY }), false);
  });
});

describe("phoneSignInRefusal under NODE_ENV=demo with the demo's policy", () => {
  const demo = (msisdn: string, roles: string[] = [], emailBlocked = false) =>
    phoneSignInRefusal({ msisdn, nodeEnv: "demo", policy: DEMO_POLICY, emailBlocked, roles });

  it("refuses an arbitrary number with demo_number_required", () => {
    const r = demo("+919123456789");
    assert.deepEqual(r, DEMO_NUMBER_REQUIRED);
    assert.equal(r?.status, 403);
    assert.equal(r?.code, "demo_number_required");
    assert.match(r!.title, /\+91 70000 00000 to \+91 70000 09999/);
    assert.match(r!.title, /\+91 70000 09876/, "the demo citizen is named");
    assert.doesNotMatch(r!.title, /98765/, "the retired default is not offered");
    assert.match(r!.title, /\+91 96000 00000 to \+91 96000 00099/, "the mechanic range is named too");
  });

  it("lets a demo number through", () => {
    assert.equal(demo("+917000000042"), null);
    assert.equal(demo(DEMO_CITIZEN, ["citizen"]), null);
    assert.equal(demo("+919600000005", ["mechanic"]), null);
  });

  it("fails closed for admin and gov_officer even inside the demo range", () => {
    assert.deepEqual(demo("+917000000001", ["citizen", "admin"]), EMAIL_SIGNIN_REQUIRED);
    assert.deepEqual(demo("+917000000002", ["gov_officer"]), EMAIL_SIGNIN_REQUIRED);
    assert.equal(EMAIL_SIGNIN_REQUIRED.code, "email_signin_required");
  });

  it("refuses the seeded admin whether or not EMAIL_SIGNIN lists it", () => {
    const unlisted = parseEmailSignin("");
    const listed = parseEmailSignin("owner@example.com=+919999900001");
    const admin = "+919999900001";
    assert.notEqual(demo(admin, ["admin"], phoneSignInBlocked(admin, unlisted, DEMO_POLICY)), null);
    assert.deepEqual(demo(admin, ["admin"], phoneSignInBlocked(admin, listed, DEMO_POLICY)), EMAIL_SIGNIN_REQUIRED);
  });

  it("does not reveal which real numbers are privileged", () => {
    // Outside the demo ranges an admin and a stranger get the same answer.
    assert.deepEqual(demo("+919999900001", ["admin"]), demo("+919123456789", []));
  });

  it("keeps an email-listed number on email, as before", () => {
    assert.deepEqual(demo("+917000000003", [], true), EMAIL_SIGNIN_REQUIRED);
  });
});

describe("LOCAL_DEMO_PRIVILEGED_OTP (the local docker demo's opt-in)", () => {
  const local = (msisdn: string, roles: string[] = [], emailBlocked = false, nodeEnv = "demo") =>
    phoneSignInRefusal({ msisdn, nodeEnv, policy: DEMO_POLICY, emailBlocked, roles, localDemoPrivileged: true });

  it("lets the seeded authority sign in with the on-screen code", () => {
    assert.deepEqual([...DEMO_PRIVILEGED_ACCOUNTS], ["+919999900001"]);
    assert.equal(local("+919999900001", ["admin"]), null);
  });

  it("opens nothing else: other admins, officers and real numbers are refused as before", () => {
    assert.deepEqual(local("+919999900002", ["admin"]), DEMO_NUMBER_REQUIRED);
    assert.deepEqual(local("+919123456789"), DEMO_NUMBER_REQUIRED);
    assert.deepEqual(local("+917000000002", ["gov_officer"]), EMAIL_SIGNIN_REQUIRED);
  });

  it("does not override EMAIL_SIGNIN", () => {
    assert.deepEqual(local("+919999900001", ["admin"], true), EMAIL_SIGNIN_REQUIRED);
  });

  it("is ignored in production even if it were set", () => {
    assert.deepEqual(local("+919999900001", ["admin"], false, "production"), DEMO_NUMBER_REQUIRED);
  });

  it("is off unless set: the hosted demo still refuses the authority", () => {
    assert.deepEqual(
      phoneSignInRefusal({ msisdn: "+919999900001", nodeEnv: "demo", policy: DEMO_POLICY, emailBlocked: false, roles: ["admin"] }),
      DEMO_NUMBER_REQUIRED,
    );
  });

  it("stops a production boot, and nothing else", () => {
    assert.match(localDemoPrivilegedProblem("production", true) ?? "", /LOCAL_DEMO_PRIVILEGED_OTP/);
    assert.equal(localDemoPrivilegedProblem("production", false), null);
    assert.equal(localDemoPrivilegedProblem("demo", true), null);
    assert.equal(localDemoPrivilegedProblem("development", true), null);
  });
});

describe("phoneSignInRefusal in development", () => {
  it("changes nothing: any number and the seeded admin sign in by phone", () => {
    for (const nodeEnv of ["development", "test"]) {
      const dev = { nodeEnv, policy: DEMO_POLICY, emailBlocked: false };
      assert.equal(phoneSignInRefusal({ ...dev, msisdn: "+919123456789", roles: [] }), null);
      assert.equal(phoneSignInRefusal({ ...dev, msisdn: "+919999900001", roles: ["admin"] }), null);
      assert.equal(phoneSignInRefusal({ ...dev, msisdn: "+919000000001", roles: ["gov_officer"] }), null);
    }
  });

  it("still honours EMAIL_SIGNIN exactly as before", () => {
    assert.deepEqual(
      phoneSignInRefusal({ msisdn: "+919999900001", nodeEnv: "development", policy: DEMO_POLICY, emailBlocked: true, roles: [] }),
      EMAIL_SIGNIN_REQUIRED,
    );
  });
});

describe("phoneSignInRefusal with a real SMS gateway", () => {
  it("lets any number and any role sign in: the code reaches only the handset", () => {
    for (const nodeEnv of ["demo", "production"]) {
      assert.equal(phoneSignInRefusal({ msisdn: "+919123456789", nodeEnv, policy: GATEWAY_POLICY, emailBlocked: false, roles: [] }), null);
      assert.equal(phoneSignInRefusal({ msisdn: "+919999900001", nodeEnv, policy: GATEWAY_POLICY, emailBlocked: false, roles: ["admin"] }), null);
    }
  });
});

describe("holdsPrivilegedRole", () => {
  it("is admin and gov_officer, and nothing else", () => {
    assert.equal(holdsPrivilegedRole(["admin"]), true);
    assert.equal(holdsPrivilegedRole(["citizen", "gov_officer"]), true);
    assert.equal(holdsPrivilegedRole(["citizen", "mechanic", "fleet_admin", "support"]), false);
    assert.equal(holdsPrivilegedRole([]), false);
  });
});
