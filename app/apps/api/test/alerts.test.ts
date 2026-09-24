/**
 * Operator alerts: what goes out, what is held back, and what never appears.
 *
 * The gate is tested with an injected clock and an injected send, so nothing
 * here touches a network or waits on real time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { AlertGate, maskMsisdn, type Alert } from "../src/alerts.js";

const NUMBER = "+919876543210";

function gate(o: Partial<{ signinsPerHour: number; otpBurst: number; otpWindowMs: number }> = {}) {
  const sent: Alert[] = [];
  let t = Date.UTC(2026, 8, 24, 12, 0, 0);
  const g = new AlertGate((a) => sent.push(a), {
    signinsPerHour: 2, otpBurst: 3, otpWindowMs: 10 * 60_000, ...o, now: () => t,
  });
  return { g, sent, advance: (ms: number) => { t += ms; } };
}

test("a number is masked to its last three digits, at a fixed width", () => {
  assert.equal(maskMsisdn(NUMBER), "+91 ••••••• 210");
  assert.equal(maskMsisdn("+14155550123"), "••••••• 123");
  assert.equal(maskMsisdn("12"), "•••");
});

test("no alert ever carries the full number", () => {
  const { g, sent } = gate({ signinsPerHour: 1 });
  g.signin(NUMBER, ["citizen"], true);
  g.signin(NUMBER, ["citizen"], false);
  g.signin(NUMBER, ["citizen"], false);
  g.signin(NUMBER, ["authority"], false);
  for (let i = 0; i < 3; i++) g.otpFailure(NUMBER);
  for (const a of sent) {
    const text = a.subject + "\n" + a.lines.join("\n");
    assert.ok(!text.includes("9876543210") && !text.includes("98765"), `${a.kind} leaked the number`);
  }
});

test("a first sign-in sends one first-signin alert, not a sign-in as well", () => {
  const { g, sent } = gate();
  g.signin(NUMBER, ["citizen"], true);
  assert.deepEqual(sent.map((a) => a.kind), ["first-signin"]);
});

test("sign-ins over the hourly cap are counted and reported, never dropped silently", () => {
  const { g, sent, advance } = gate({ signinsPerHour: 2 });
  for (let i = 0; i < 5; i++) g.signin(NUMBER, ["citizen"], false);
  assert.equal(sent.length, 2, "only the cap goes out inside the hour");
  advance(3_600_000);
  g.signin(NUMBER, ["citizen"], false);
  assert.equal(sent.length, 3);
  assert.match(sent[2].lines.join("\n"), /3 more sign-ins since .* were not emailed/);
  g.signin(NUMBER, ["citizen"], false);
  assert.doesNotMatch(sent[3].lines.join("\n"), /more sign-in/, "the count is reported once, then reset");
});

test("a privileged sign-in always alerts, whatever the cap", () => {
  const { g, sent } = gate({ signinsPerHour: 0 });
  g.signin(NUMBER, ["citizen"], false);
  g.signin(NUMBER, ["authority"], false);
  g.signin(NUMBER, ["admin"], false);
  assert.deepEqual(sent.map((a) => a.kind), ["privileged-signin", "privileged-signin"]);
});

test("a burst of wrong codes alerts once per number per window", () => {
  const { g, sent, advance } = gate({ otpBurst: 3 });
  g.otpFailure(NUMBER); g.otpFailure(NUMBER);
  assert.equal(sent.length, 0, "two wrong codes are a typo, not a burst");
  g.otpFailure(NUMBER);
  assert.deepEqual(sent.map((a) => a.kind), ["otp-burst"]);
  g.otpFailure(NUMBER); g.otpFailure(NUMBER);
  assert.equal(sent.length, 1, "the same burst is not re-announced");
  g.otpFailure("+919999900001"); g.otpFailure("+919999900001"); g.otpFailure("+919999900001");
  assert.equal(sent.length, 2, "another number is its own burst");
  advance(10 * 60_000);
  g.otpFailure(NUMBER); g.otpFailure(NUMBER); g.otpFailure(NUMBER);
  assert.equal(sent.length, 3, "a new window can alert again");
});

test("wrong codes spread wider than the window never add up to a burst", () => {
  const { g, sent, advance } = gate({ otpBurst: 3, otpWindowMs: 10 * 60_000 });
  for (let i = 0; i < 6; i++) { g.otpFailure(NUMBER); advance(6 * 60_000); }
  assert.equal(sent.length, 0);
});

test("an off-grid SOS alert says how long it waited on the device", () => {
  const { g, sent } = gate();
  g.sosSynced(2, 7 * 60_000 + 20_000);
  assert.equal(sent[0].kind, "sos-synced");
  assert.match(sent[0].lines.join("\n"), /2 emergencies .* about 7 minutes/s);
  g.sosConfirmed("3f2a9c1e-0000-4000-8000-000000000000", 2);
  assert.match(sent[1].subject, /incident 3f2a9c1e$/);
});
