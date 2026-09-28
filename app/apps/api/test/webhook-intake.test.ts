/**
 * Who may speak on the inbound SMS webhook.
 *
 * The sending number IS the identity on the feature-phone path, so an intake
 * that accepts unsigned requests lets anyone raise an SOS, read a booking or
 * cancel one as any phone number. The hosted demo ran exactly like that,
 * because the signature was only checked when a secret happened to be set.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { decideWebhookIntake, signatureFor, type IntakeInput } from "../src/domain/webhook-intake.js";
import { isDemoNumber } from "../src/domain/demo-numbers.js";
import { LOCAL_ENVS } from "../src/domain/local-env.js";

const SECRET = "whsec-unit-test";
const BODY = JSON.stringify({ from: "+919123456789", text: "SOS" });

const input = (over: Partial<IntakeInput> = {}): IntakeInput => ({
  secret: "", nodeEnv: "demo", rawBody: BODY, signature: undefined,
  from: "+919123456789", isDemoNumber, ...over,
});

describe("decideWebhookIntake — no secret configured", () => {
  it("refuses a real number outside development with 503 webhook_not_configured", () => {
    for (const nodeEnv of ["demo", "production", "staging", "prodution"]) {
      const d = decideWebhookIntake(input({ nodeEnv }));
      assert.equal(d.accept, false, nodeEnv);
      if (!d.accept) {
        assert.equal(d.status, 503);
        assert.equal(d.code, "webhook_not_configured");
      }
    }
  });

  it("still accepts the published demo numbers, so the demo keeps its feature-phone walkthrough", () => {
    for (const from of ["+917000000042", "+917000000000", "+917000009999", "+919876543210"]) {
      assert.deepEqual(decideWebhookIntake(input({ from })), { accept: true, mode: "unsigned_demo_number" }, from);
    }
  });

  it("does not stretch the demo range by one", () => {
    for (const from of ["+917000010000", "+916999999999", "+919876543211"]) {
      assert.equal(decideWebhookIntake(input({ from })).accept, false, from);
    }
  });

  it("refuses a missing or malformed `from` rather than guessing", () => {
    for (const from of [undefined, null, 917000000042, ["+917000000042"], " +917000000042"]) {
      assert.equal(decideWebhookIntake(input({ from })).accept, false, String(from));
    }
  });

  // The same allow-list every other local-only shortcut uses (domain/local-env).
  it("stays open in local environments (development, test, the CI smoke test), and says so", () => {
    for (const nodeEnv of [...LOCAL_ENVS, undefined]) {
      assert.deepEqual(decideWebhookIntake(input({ nodeEnv })), { accept: true, mode: "unsigned_development" });
    }
  });
});

describe("decideWebhookIntake — secret configured", () => {
  const good = signatureFor(SECRET, BODY);

  it("accepts a correct signature", () => {
    assert.deepEqual(decideWebhookIntake(input({ secret: SECRET, signature: good })),
      { accept: true, mode: "signed" });
  });

  it("refuses an unsigned request with 401, even in development", () => {
    for (const nodeEnv of ["development", "demo", "production"]) {
      const d = decideWebhookIntake(input({ secret: SECRET, nodeEnv }));
      assert.equal(d.accept, false);
      if (!d.accept) assert.equal(d.status, 401);
    }
  });

  it("refuses an unsigned demo number too — the exemption is only for a server with no secret", () => {
    const d = decideWebhookIntake(input({ secret: SECRET, from: "+917000000042" }));
    assert.equal(d.accept, false);
    if (!d.accept) assert.equal(d.code, "webhook_unsigned");
  });

  it("refuses a wrong, truncated or other-body signature", () => {
    for (const signature of ["deadbeef".repeat(8), good.slice(0, 32), signatureFor(SECRET, BODY + " ")]) {
      assert.equal(decideWebhookIntake(input({ secret: SECRET, signature })).accept, false);
    }
  });
});
