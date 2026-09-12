#!/usr/bin/env node
/**
 * Measured latency for the paths that matter.
 *
 * Single-user, against a local database, on one machine. That is stated on
 * every line of the output because it is the honest scope: these numbers say
 * "no query here is accidentally quadratic", not "the platform sustains N
 * users". A load test is a different exercise and has not been run.
 *
 * Percentiles rather than an average: an average hides the tail, and the tail
 * is what somebody at the roadside actually experiences.
 *
 *   node scripts/perf-audit.mjs [samples]
 */
const BASE = process.env.API ?? "http://localhost:4000";
const SAMPLES = Number(process.argv[2] ?? 30);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function measure(label, fn, samples = SAMPLES) {
  const times = [];
  let failures = 0;
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      const r = await fn(i);
      if (r && r.status >= 400) failures++;
    } catch { failures++; }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    label, samples,
    p50: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1],
    failures,
  };
}

const newMsisdn = () => "+91" + (9000000000 + Math.floor(Math.random() * 899999999));

async function signIn() {
  const msisdn = newMsisdn();
  const req = await call("POST", "/v1/auth/otp/request", { body: { msisdn } });
  const v = await call("POST", "/v1/auth/otp/verify", { body: { msisdn, code: req.meta?.devOtp } });
  return v.data?.accessToken;
}

/**
 * How fine a measurement this run can actually make.
 *
 * `/v1/ping` touches no database and the server answers it in well under a
 * millisecond — a minimum of 0.78ms was observed repeatedly. Yet the median
 * comes back at 15-16ms in a standalone run (200 sequential samples: p50 15.4,
 * min 0.78, and it does NOT warm down — the last hundred look like the first).
 * In other contexts the same probe reports ~3ms.
 *
 * The mechanism is not established here and is deliberately not guessed at in a
 * comment. What IS established is the consequence: anything this tool prints in
 * that band is dominated by measurement overhead rather than by the endpoint,
 * so "ping 14ms" is not a fact about ping. Four of the figures quoted in the
 * docs sit in it.
 *
 * So each run measures its own floor, in the same process and the same state as
 * the rows, and marks what sits at it. A number the instrument cannot resolve
 * is not a measurement, and this project does not publish those unlabelled.
 */
async function resolutionFloor(probes = 60) {
  const t = [];
  for (let i = 0; i < probes; i++) {
    const t0 = performance.now();
    await call("GET", "/v1/ping");
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const fastest = t[0];
  const median = t[Math.floor(t.length / 2)];
  // The test is mechanism-free on purpose: if the median of a no-op endpoint is
  // several times its own fastest sample, the median is overhead, whatever is
  // producing it. Counting a modal bucket does not work — the mass splits
  // across two adjacent milliseconds (15 and 16) and neither reaches half.
  const dominated = median >= fastest * 3 && median - fastest > 2;
  const within = t.filter((v) => Math.abs(v - median) <= 1.5).length / probes;
  return { floor: dominated ? Math.round(median) : 0, fastest, median, share: within };
}

/** Below this, a p95 is just the slowest sample wearing a percentile's name. */
const MIN_N_FOR_P95 = 20;

console.log(`\nRoadAssist — measured latency  (${BASE}, ${SAMPLES} samples each)`);
console.log("Single-user, local database, one machine. NOT a load test.");

// Probed here, before anything is timed, so the floor reflects the same process
// state the rows below are measured in. Taken at the end it reported ~3ms while
// the rows measured 15ms, which would have marked nothing and told no one.
const res = await resolutionFloor();
if (res.floor) {
  console.log(
    `Measurement floor for this run: ~${res.floor}ms — /v1/ping medians ` +
    `${res.median.toFixed(1)}ms while its fastest sample is ${res.fastest.toFixed(2)}ms ` +
    `(${Math.round(res.share * 100)}% of probes within 1.5ms of the median).\n` +
    "Rows marked † sit at or under it: that is the measurement, not the endpoint.",
  );
}
console.log("");

const token = await signIn();
const reg = "TS77PF" + Math.floor(1000 + Math.random() * 8999);
const veh = await call("POST", "/v1/vehicles", { token, body: { registrationNo: reg, vehicleClass: "car" } });
const vehicleId = veh.data?.id;

// A booking to read repeatedly, and one to dispatch from.
const booking = await call("POST", "/v1/bookings", {
  token, body: { vehicleId, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266 },
});
const bookingId = booking.data?.id;

const results = [];

results.push(await measure("GET  /v1/ping                (no database at all)",
  () => call("GET", "/v1/ping")));
results.push(await measure("GET  /health                 (one round trip to Postgres)",
  () => call("GET", "/health")));
results.push(await measure("POST /v1/diagnose            (rules engine, no I/O beyond the write)",
  () => call("POST", "/v1/diagnose", { token, body: { symptoms: "car won't start, clicking" } })));
results.push(await measure("GET  /v1/bookings/:id        (booking + events + mechanic + provider state)",
  () => call("GET", `/v1/bookings/${bookingId}`, { token })));
results.push(await measure("GET  /v1/bookings            (the caller's list)",
  () => call("GET", "/v1/bookings", { token })));
results.push(await measure("GET  /v1/map/live            (3 PostGIS radius queries)",
  () => call("GET", "/v1/map/live?lat=28.4595&lng=77.0266&radiusKm=60", { token })));
results.push(await measure("GET  /v1/service-types       (small reference read)",
  () => call("GET", "/v1/service-types")));

/**
 * Dispatch — the heaviest query in the platform.
 *
 * A PostGIS nearest-neighbour search with two correlated `NOT EXISTS`
 * subqueries per candidate, plus a second aggregate for the skipped-provider
 * counts. Each sample needs its own booking (a dispatched booking cannot be
 * dispatched again) and its own account: the booking rate limit is 10 per five
 * minutes, and reusing one account made the measurement mostly count 429s.
 *
 * Only the dispatch call is timed. The set-up and tear-down around it are done
 * outside the clock, so the number is the query and not three round trips.
 */
const dispatchTimes = [];
let dispatchFailures = 0;
// Enough samples that p95 is a percentile rather than "the slowest of eight".
// At n=8 a single outlier IS the p95: one run of this tool reported 675ms for
// dispatch and the next three reported 112-130ms, which is how a threshold
// gate teaches people to re-run it instead of reading it.
const DISPATCH_N = Math.max(8, Math.min(SAMPLES, 25));
for (let i = 0; i < DISPATCH_N; i++) {
  const t = await signIn();
  const v = await call("POST", "/v1/vehicles", {
    token: t, body: { registrationNo: "TS78PF" + Math.floor(1000 + Math.random() * 8999), vehicleClass: "car" },
  });
  const b = await call("POST", "/v1/bookings", {
    token: t, body: { vehicleId: v.data?.id, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266 },
  });
  if (b.status !== 201) { dispatchFailures++; continue; }

  const t0 = performance.now();
  const d = await call("POST", `/v1/bookings/${b.data.id}/dispatch`, { token: t, body: { radiusKm: 40, limit: 5 } });
  dispatchTimes.push(performance.now() - t0);
  if (d.status >= 400) dispatchFailures++;

  // Hand the provider back — dispatch refuses to offer work to a committed one,
  // so a measurement run must not drain the pool it is measuring.
  await call("POST", `/v1/bookings/${b.data.id}/transition`, { token: t, body: { command: "cancel" } });
}
dispatchTimes.sort((a, b) => a - b);
results.push({
  label: "POST /v1/bookings/:id/dispatch  (PostGIS KNN + provider-state exclusions)",
  samples: dispatchTimes.length,
  p50: pct(dispatchTimes, 50) ?? 0, p95: pct(dispatchTimes, 95) ?? 0,
  max: dispatchTimes[dispatchTimes.length - 1] ?? 0,
  failures: dispatchFailures,
});

// Off-grid sync: the reconnection path, one incident per call.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const clientId = () => "RA-" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
results.push(await measure("POST /v1/sos/offline-sync    (validate + insert + signal + journal + audit)",
  () => call("POST", "/v1/sos/offline-sync", {
    token,
    body: { incidents: [{
      clientIncidentId: clientId(), opId: "perf-" + Math.random().toString(36).slice(2, 12),
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      emergencyType: "breakdown", lat: 28.47, lng: 77.04,
    }] },
  }), 15));

// The live stream: time from opening the connection to the first frame.
results.push(await measure("GET  /v1/events              (SSE connect → first frame)",
  async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    await reader.read();                                   // first frame: stream.open
    ctrl.abort();
    return { status: res.status };
  }, 10));

const w = Math.max(...results.map((r) => r.label.length));
console.log(`${"operation".padEnd(w)}   p50      p95      max      n   fail`);
console.log("─".repeat(w + 40));
for (const r of results) {
  const marks =
    (res.floor && r.p50 <= res.floor + 1 ? " †" : "") +
    (r.samples < MIN_N_FOR_P95 ? " ‡" : "");
  console.log(
    `${r.label.padEnd(w)}  ${r.p50.toFixed(1).padStart(6)}ms ${r.p95.toFixed(1).padStart(6)}ms ` +
    `${r.max.toFixed(1).padStart(6)}ms ${String(r.samples).padStart(3)} ${String(r.failures).padStart(5)}` +
    marks,
  );
}

// Anything past this is worth looking at rather than assuming is fine.
const SLOW_P95_MS = 400;
// Small-n rows are reported but not gated: their "p95" is the slowest sample,
// so gating on it fails the run on noise rather than on a regression.
const slow = results.filter((r) => r.p95 > SLOW_P95_MS && r.samples >= MIN_N_FOR_P95);
const noisy = results.filter((r) => r.p95 > SLOW_P95_MS && r.samples < MIN_N_FOR_P95);
console.log("\n" + "─".repeat(w + 40));
if (slow.length) {
  console.log(`  ${slow.length} operation(s) above ${SLOW_P95_MS}ms at p95 — investigate:`);
  for (const r of slow) console.log(`    · ${r.label.trim()}  p95=${r.p95.toFixed(0)}ms`);
} else {
  console.log(`  No operation exceeds ${SLOW_P95_MS}ms at p95 on this machine.`);
}
for (const r of noisy) {
  console.log(`  ‡ ${r.label.trim()} p95=${r.p95.toFixed(0)}ms on only ${r.samples} samples — the slowest sample, not a percentile.`);
}
if (res.floor && results.some((r) => r.p50 <= res.floor + 1)) {
  console.log(`  † at or under this run's ~${res.floor}ms measurement floor — quote as "under ${res.floor}ms", never as a figure.`);
}
console.log("  Reminder: single-user, local database. This is not a load test.");
console.log("─".repeat(w + 40));
