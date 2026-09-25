/**
 * Operator alerts: what goes out, what is held back, and what never appears.
 *
 * The gate is tested with an injected clock and an injected send, so nothing
 * here touches a network or waits on real time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { AlertGate, maskMsisdn, recipients, type Alert } from "../src/alerts.js";

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

test("code-guessing alerts are capped across numbers, and the rest are counted, not dropped", () => {
  // One visitor, five wrong codes for each of forty made-up numbers.
  const { g, sent, advance } = gate({ otpBurst: 5 });
  for (let n = 0; n < 40; n++) for (let i = 0; i < 5; i++) g.otpFailure(`+9198765${String(n).padStart(5, "0")}`);
  assert.ok(sent.length <= 5, `${sent.length} emails for one burst of made-up numbers`);
  advance(3_600_000);
  for (let i = 0; i < 5; i++) g.otpFailure("+919999900001");
  const last = sent[sent.length - 1];
  assert.match(last.lines.join("\n"), /35 more numbers crossed the same threshold since .* not emailed one by one/);
});

test("the burst bookkeeping does not grow with every number that ever crossed it", () => {
  const { g, advance } = gate({ otpBurst: 1 });
  const burstAlerted = (g as unknown as { burstAlerted: Map<string, number> }).burstAlerted;
  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < 10_001; n++) g.otpFailure(`+91${7_000_000_000 + round * 100_000 + n}`);
    advance(10 * 60_000);
  }
  assert.ok(burstAlerted.size <= 10_002, `${burstAlerted.size} numbers still held after their window`);
});

test("wrong codes spread wider than the window never add up to a burst", () => {
  const { g, sent, advance } = gate({ otpBurst: 3, otpWindowMs: 10 * 60_000 });
  for (let i = 0; i < 6; i++) { g.otpFailure(NUMBER); advance(6 * 60_000); }
  assert.equal(sent.length, 0);
});

test("ALERT_EMAIL_TO takes a list: trimmed, de-duplicated, junk dropped", () => {
  assert.deepEqual(
    recipients(" owner@example.com, team.a@college.ac.in;team.b@college.ac.in ,OWNER@example.com, not-an-address, ,"),
    ["owner@example.com", "team.a@college.ac.in", "team.b@college.ac.in"],
  );
  assert.deepEqual(recipients(""), []);
  assert.equal(recipients(Array.from({ length: 60 }, (_, i) => `u${i}@x.io`).join(",")).length, 50);
});

test("an off-grid SOS alert says how long it waited on the device", () => {
  const { g, sent } = gate();
  g.sosSynced(2, 7 * 60_000 + 20_000);
  assert.equal(sent[0].kind, "sos-synced");
  assert.match(sent[0].lines.join("\n"), /2 emergencies .* about 7 minutes/s);
  g.sosConfirmed("3f2a9c1e-0000-4000-8000-000000000000", 2);
  assert.match(sent[1].subject, /incident 3f2a9c1e$/);
});

test("wrong codes for a protected account alert even after the hour's cap is spent", () => {
  // Made-up numbers use up the cap first; the account behind email sign-in
  // must still be reported, or the flood is how an attack on it hides.
  const { g, sent } = gate({ otpBurst: 5 });
  for (let n = 0; n < 40; n++) for (let i = 0; i < 5; i++) g.otpFailure(`+9198765${String(n).padStart(5, "0")}`);
  const capped = sent.length;
  for (let i = 0; i < 5; i++) g.otpFailure("+919999900001", true);
  assert.equal(sent.length, capped + 1, "the protected account's burst was dropped by the shared cap");
  assert.equal(sent[sent.length - 1].kind, "otp-burst");
});
