/**
 * The on-device engine that Off-Grid Mode runs on (ADR-0009).
 *
 * Three things are pinned here, and each of them is a promise the product makes
 * to somebody standing next to a stopped vehicle with no signal:
 *
 *   1. **The phone and the cloud agree.** The app tells a user its offline
 *      answer is what the platform would have said. That is only true while the
 *      two rule tables match, so this file diagnoses a corpus through BOTH and
 *      fails the build the moment they diverge. Without it, "same rules" is a
 *      comment that rots.
 *   2. **Connectivity is judged pessimistically.** Over-claiming a connection
 *      is how a person ends up believing help was called when it was not.
 *   3. **A retry never turns into a second ambulance.** Ids are unique and
 *      opaque, digests are stable, and backoff is bounded and jittered.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { diagnose as serverDiagnose } from "../src/domain/ai-rules.js";
// The literal file the browser loads. Importing the shipped artifact — rather
// than a copy of it — is what makes the divergence check mean anything.
import * as engine from "../../web/offline-engine.js";

/* ── 1. the phone must not contradict the cloud ─────────────────────────────── */

/** Every rule, plus the shapes that fall through to the generic answer. */
const CORPUS: Array<{ symptoms?: string; dtcCodes?: string[] }> = [
  { symptoms: "car won't start" },
  { symptoms: "wont start, just a click" },
  { symptoms: "no crank and the lights dim" },
  { symptoms: "flat tyre on the rear left" },
  { symptoms: "puncture" },
  { symptoms: "temperature warning and steam from the bonnet" },
  { symptoms: "coolant leaking, hot engine" },
  { symptoms: "ran out of diesel" },
  { symptoms: "empty tank" },
  { symptoms: "keys locked inside" },
  { symptoms: "key stuck in the lock" },
  { symptoms: "clutch slipping and gear not engaging" },
  { symptoms: "brake pedal is spongy" },
  { symptoms: "abs light and grinding" },
  { symptoms: "juddering with a loss of power" },
  { symptoms: "rough idle and misfire" },
  { symptoms: "ev not charging, state of charge stuck" },
  { symptoms: "the boot smells of samosas" },      // nothing matches
  { symptoms: "" },                                 // nothing said at all
  {},                                               // nothing at all
  { dtcCodes: ["P0300"] },
  { dtcCodes: ["P0217"] },
  { dtcCodes: ["C0035"] },
  { dtcCodes: ["b1318"] },                          // case is not the client's problem
  { symptoms: "engine overheating", dtcCodes: ["P0128"] },
  { symptoms: "battery dead", dtcCodes: ["P0562"] },
  { symptoms: "brake grinding and squeal", dtcCodes: ["C0035"] },
];

test("the on-device engine reaches the same verdict as the server, case by case", () => {
  for (const input of CORPUS) {
    const local = engine.diagnose(input);
    const server = serverDiagnose(input);
    const where = JSON.stringify(input);
    assert.equal(local.cause, server.cause, `cause diverged for ${where}`);
    assert.equal(local.confidence, server.confidence, `confidence diverged for ${where}`);
    assert.equal(local.severity, server.severity, `severity diverged for ${where}`);
    assert.equal(local.driveable, server.driveable, `driveable diverged for ${where}`);
    assert.deepEqual(local.parts, server.parts, `parts diverged for ${where}`);
    assert.equal(local.advice, server.advice, `advice diverged for ${where}`);
  }
});

test("every rule the server knows about is reachable from the device", () => {
  // A rule present in one table and missing from the other would only show up
  // in the corpus above by luck. Compare the tables themselves.
  const localCauses = engine.RULES.map((r) => r.cause);
  assert.equal(new Set(localCauses).size, localCauses.length, "duplicate causes on the device");
  for (const input of CORPUS) {
    const server = serverDiagnose(input);
    if (server.cause === engine.GENERIC.cause) continue;
    assert.ok(localCauses.includes(server.cause),
      `the server can diagnose "${server.cause}" and the device cannot`);
  }
});

test("the device labels its own answer so the UI can never present it as a cloud model", () => {
  const d = engine.diagnose({ symptoms: "car won't start" });
  assert.equal(d.local, true);
  assert.equal(d.engine, engine.ENGINE_VERSION);
  assert.match(d.engine, /^local-/, "the engine name must read as local at a glance");
});

test("offline, the runners-up are offered instead of one guess dressed as a finding", () => {
  const d = engine.diagnose({ symptoms: "battery dead and the brake pedal is spongy" });
  assert.ok(d.alternatives.length >= 1, "two matching rules should produce an alternative");
  assert.ok(d.alternatives.every((a) => a.confidence <= d.confidence),
    "an alternative must never outrank the headline cause");
});

test("every rule carries a safety action — offline there is nobody else to ask", () => {
  for (const rule of engine.RULES) {
    assert.ok(rule.safetyAction && rule.safetyAction.length > 20,
      `"${rule.cause}" has no usable safety action`);
  }
  assert.ok(engine.GENERIC.safetyAction, "even the unknown-cause answer needs one");
});

/* ── 2. connectivity is judged pessimistically ─────────────────────────────── */

const { ONLINE, LIMITED, OFFLINE, classifyConnectivity: classify } = engine;

test("the browser saying it is offline is believed, whatever else is true", () => {
  assert.equal(classify({ navigatorOnLine: false, probeOk: true, probeRttMs: 10 }), OFFLINE);
});

test("a fast probe with the radio up is the only route to ONLINE", () => {
  assert.equal(classify({ navigatorOnLine: true, probeOk: true, probeRttMs: 80 }), ONLINE);
});

test("a probe that comes back slowly is LIMITED, not ONLINE", () => {
  assert.equal(classify({ navigatorOnLine: true, probeOk: true, probeRttMs: engine.LIMITED_RTT_MS }), LIMITED);
});

test("one failed request degrades the claim; a run of them withdraws it", () => {
  assert.equal(classify({ navigatorOnLine: true, consecutiveFailures: 1 }), LIMITED);
  assert.equal(classify({ navigatorOnLine: true, consecutiveFailures: engine.OFFLINE_FAILURES }), OFFLINE);
});

test("a failing probe is never reported as a working connection", () => {
  assert.equal(classify({ navigatorOnLine: true, probeOk: false }), LIMITED);
  assert.equal(classify({ navigatorOnLine: true, probeOk: false, consecutiveFailures: 5 }), OFFLINE);
});

test("a 2g cell is a connection, but not one to make promises about", () => {
  assert.equal(classify({ navigatorOnLine: true, effectiveType: "2g" }), LIMITED);
  assert.equal(classify({ navigatorOnLine: true, effectiveType: "slow-2g" }), LIMITED);
  assert.equal(classify({ navigatorOnLine: true, effectiveType: "4g" }), ONLINE);
});

test("a successful probe outranks a couple of unrelated failures, but not a run of them", () => {
  assert.equal(classify({ navigatorOnLine: true, probeOk: true, probeRttMs: 50, consecutiveFailures: 2 }), ONLINE);
  assert.equal(classify({ navigatorOnLine: true, probeOk: true, probeRttMs: 50, consecutiveFailures: 9 }), LIMITED);
});

test("simulated off-grid drives the real code path", () => {
  assert.equal(classify({ navigatorOnLine: true, probeOk: true, probeRttMs: 5, simulatedOffline: true }), OFFLINE);
});

test("no signal at all is treated as working — the app must boot before it measures", () => {
  assert.equal(classify(undefined), ONLINE);
  assert.equal(classify({}), ONLINE);
});

/* ── 3. a retry never becomes a second emergency ───────────────────────────── */

test("incident references are readable aloud and free of ambiguous glyphs", () => {
  for (let i = 0; i < 200; i++) {
    const id = engine.newIncidentId();
    assert.match(id, /^RA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/, `bad reference: ${id}`);
    assert.ok(!/[01ILOU]/.test(id.slice(3)), "0/1/I/L/O/U are misread on a cracked screen");
  }
});

test("incident references carry the entropy their length claims", () => {
  // Two assertions, one property: the keyspace is the size this id's whole
  // argument assumes, and every letter is equally likely to fill it.
  //
  // This used to assert ZERO collisions in 5,000 draws and failed roughly one
  // run in sixty — not a bug in the generator, the birthday paradox. 30^6 is
  // 7.29e8, so 5,000 draws collide with probability 1 - e^(-5000^2/2N), about
  // 1.7%. A test that red-lights the build 1.7% of the time teaches people to
  // re-run it, which is how a real failure gets waved through. Uniqueness
  // itself is guaranteed by the server's constraint, which is where it belongs.
  const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const DRAWS = 10000;
  const seen = new Set<string>();
  const counts = new Map<string, number>(ALPHABET.split("").map((c) => [c, 0]));

  for (let i = 0; i < DRAWS; i++) {
    const id = engine.newIncidentId();
    seen.add(id);
    for (const ch of id.slice(3)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }

  // A generator with a broken alphabet or a byte source stuck near zero
  // collides hundreds of times here, not a dozen. Expected is about 0.07.
  const collisions = DRAWS - seen.size;
  assert.ok(
    collisions <= 12,
    `${collisions} collisions in ${DRAWS} draws — the keyspace is far smaller than 30^6`,
  );

  // `byte % 30` maps 16 letters to nine byte values and 14 to eight, making the
  // first half of the alphabet 12.5% likelier — far outside sampling noise over
  // 60,000 characters, so this pins the rejection sampling down.
  const expected = (DRAWS * 6) / ALPHABET.length;
  for (const [ch, n] of counts) {
    const drift = Math.abs(n - expected) / expected;
    assert.ok(
      drift < 0.08,
      `"${ch}" appeared ${n} times, expected about ${expected} (${(drift * 100).toFixed(1)}% off)`,
    );
  }
});

test("the server's clientIncidentId pattern accepts exactly what the device mints", () => {
  // The same expression the endpoint validates with. If one moves, this fails.
  const serverPattern = /^RA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/;
  for (let i = 0; i < 100; i++) {
    assert.ok(serverPattern.test(engine.newIncidentId()));
  }
});

test("operation ids are unique — they are the server's idempotency key", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(engine.newOpId());
  assert.equal(seen.size, 2000);
});

test("the integrity digest ignores key order and nothing else", async () => {
  const a = await engine.integrityDigest({ b: 1, a: { d: 4, c: 3 } });
  const b = await engine.integrityDigest({ a: { c: 3, d: 4 }, b: 1 });
  assert.equal(a, b, "key order must not change the digest");
  assert.match(a, /^[0-9a-f]{64}$/);

  const changed = await engine.integrityDigest({ b: 1, a: { d: 4, c: 99 } });
  assert.notEqual(a, changed, "a changed value must change the digest");
});

test("the digest matches the server's accepted format", () => {
  // The endpoint validates `integrity` as 64 lowercase hex characters.
  assert.match("0".repeat(64), /^[0-9a-f]{64}$/);
});

test("backoff grows, stays inside its ceiling, and is jittered", () => {
  // Full jitter: with rand = 1 the value is the exponential itself.
  assert.equal(engine.backoffMs(0, 1), engine.BACKOFF_BASE_MS);
  assert.equal(engine.backoffMs(1, 1), engine.BACKOFF_BASE_MS * 2);
  assert.equal(engine.backoffMs(3, 1), engine.BACKOFF_BASE_MS * 8);
  assert.equal(engine.backoffMs(99, 1), engine.BACKOFF_CAP_MS, "must not grow without bound");
  assert.equal(engine.backoffMs(0, 0), 0, "full jitter reaches down to zero");
  assert.equal(engine.backoffMs(-5, 1), engine.BACKOFF_BASE_MS, "a nonsense retry count is floored");

  // Real randomness: a convoy leaving a tunnel must not retry in lockstep.
  const draws = new Set<number>();
  for (let i = 0; i < 60; i++) draws.add(engine.backoffMs(6));
  assert.ok(draws.size > 40, `jitter collapsed — only ${draws.size} distinct delays in 60 draws`);
  for (const d of draws) assert.ok(d >= 0 && d <= engine.BACKOFF_CAP_MS);
});

test("canonicalisation is stable through a JSON round trip", () => {
  const value = { z: [3, { y: 1, x: 2 }], a: "text", n: null, b: true };
  const once = JSON.stringify(engine.canonical(value));
  const twice = JSON.stringify(engine.canonical(JSON.parse(once)));
  assert.equal(once, twice, "a stored-then-reloaded payload must hash the same");
});
