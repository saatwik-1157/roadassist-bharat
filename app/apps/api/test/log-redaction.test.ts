/**
 * The console SMS provider's output outside development.
 *
 * The hosted demo runs on the console provider, so its stdout — the host's log
 * stream — printed every phone number, every sign-in code and the text of every
 * emergency alert in full. These pin what is hidden there and, just as much,
 * that development output is untouched: developers read their codes from it.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  consoleEmailLine, consoleSmsLine, isDeveloperConsole, maskEmail, maskMsisdn, redactCodes,
} from "../src/domain/log-redaction.js";

describe("maskMsisdn", () => {
  it("keeps the country code and the last four digits only", () => {
    assert.equal(maskMsisdn("+919876543210"), "+91******3210");
  });
  it("never reveals a short value", () => {
    assert.equal(maskMsisdn("1234"), "****");
  });
  it("hides a short +91 value entirely rather than throwing or showing it", () => {
    assert.equal(maskMsisdn("+91123"), "+91****");
    assert.equal(maskMsisdn("+911234"), "+91****");
    assert.equal(maskMsisdn("+9112345"), "+91*2345");
  });
});

describe("redactCodes", () => {
  it("removes a six-digit sign-in code", () => {
    const out = redactCodes("Your RoadAssist code is 482913. It expires in 5 minutes.");
    assert.ok(!out.includes("482913"));
    assert.equal(out, "Your RoadAssist code is ••••••. It expires in 5 minutes.");
  });
  it("removes every code in a message, not only the first", () => {
    assert.equal(redactCodes("111111 then 222222"), "•••••• then ••••••");
  });
  it("leaves longer digit runs alone — a phone number is not a code", () => {
    assert.equal(redactCodes("call 9876543210"), "call 9876543210");
    assert.equal(redactCodes("ref 1234567"), "ref 1234567");
  });
});

describe("consoleSmsLine", () => {
  const to = "+919876543210";
  const body = "Your code is 482913";

  it("prints development output exactly as before", () => {
    for (const env of ["development", "test"]) {
      assert.ok(isDeveloperConsole(env));
      assert.equal(consoleSmsLine(to, body, env), `[sms:console] → ${to}\n            ${body}`);
    }
  });

  it("masks the number and the code everywhere else", () => {
    for (const env of ["demo", "production", "ci"]) {
      const line = consoleSmsLine(to, body, env);
      assert.ok(!line.includes(to), `${env}: number leaked`);
      assert.ok(!line.includes("482913"), `${env}: code leaked`);
      assert.ok(line.includes("3210"), `${env}: last four digits should remain for correlation`);
    }
  });

  it("keeps multi-line bodies indented", () => {
    assert.equal(consoleSmsLine(to, "a\nb", "development"),
      `[sms:console] → ${to}\n            a\n            b`);
  });
});

describe("consoleEmailLine", () => {
  it("masks the address and the sign-in code outside development", () => {
    const line = consoleEmailLine("someone@example.com", "Your code 482913", "Code: 482913", "demo");
    assert.ok(!line.includes("someone@"), "address leaked");
    assert.ok(!line.includes("482913"), "code leaked");
    assert.ok(line.includes("s***@example.com"));
  });
  it("prints development output in full", () => {
    const line = consoleEmailLine(["a@x.in", "b@y.in"], "Hi", "Code: 482913", "development");
    assert.equal(line, "[email:console] → a@x.in, b@y.in\n  subject: Hi\n  Code: 482913");
  });
  it("hides a malformed address entirely", () => {
    assert.equal(maskEmail("nobody"), "***");
  });
});
