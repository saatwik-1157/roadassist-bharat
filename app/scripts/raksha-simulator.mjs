#!/usr/bin/env node
/**
 * RAKSHA EDGE SIMULATOR — ALL DATA IS SIMULATED.
 *
 * Stands in for a camera+GPS edge device so the platform can be developed
 * with zero hardware. It walks a GPS track along the seeded NH-48 corridor,
 * "detects" road problems with a deterministic pseudo-model
 * (sim-rules-0.1.0, SIMULATED — not a trained network), queues every event
 * locally while OFFLINE, then syncs when "connectivity returns" and proves
 * the replay is idempotent by sending the same batch twice.
 *
 * Usage:  node scripts/raksha-simulator.mjs            (API on :4000, seeded DB)
 *         node scripts/raksha-simulator.mjs --from-json <detect.py output>
 *           Real-CV mode: uploads detections produced by ai/road_damage/detect.py
 *           (a genuine YOLO model, usedFallback=false). The RDD2022 images carry
 *           no GPS, so LOCATIONS remain SIMULATED along the NH-48 corridor and
 *           are labeled as such — the detections themselves are real model output.
 * State:  scripts/.raksha-sim-state.json (gitignored — holds the device credential)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.API ?? "http://localhost:4000";
const ADMIN_MSISDN = "+919999900001";               // seeded by npm run db:seed:raksha
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".raksha-sim-state.json");
const MODEL = "sim-rules-0.1.0";                     // SIMULATED detector, not a trained model

// Deterministic PRNG so every run is reproducible (mulberry32).
let seed = Number(process.env.SIM_SEED ?? 20260823);
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The seeded NH-48 corridor, Rajiv Chowk → Bilaspur Chowk ([lng, lat]).
const TRACK = [
  [77.0266, 28.4595], [77.0170, 28.4480], [77.0080, 28.4350], [76.9990, 28.4230],
  [76.9880, 28.4120], [76.9760, 28.4020], [76.9640, 28.3930], [76.9520, 28.3840],
  [76.9400, 28.3760], [76.9280, 28.3690], [76.9150, 28.3610], [76.9020, 28.3540],
];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

function banner(msg) { console.log(`\n═══ ${msg} ${"═".repeat(Math.max(0, 56 - msg.length))}`); }

banner("RAKSHA EDGE SIMULATOR — ALL DATA SIMULATED");

// ── 1. ensure we have a registered device (admin registers; hash-only server side)
//
// Two ways in. A device already registered on RAKSHA (by an officer, from the
// dashboard) can be named with RAKSHA_DEVICE_ID / RAKSHA_DEVICE_SECRET, and then
// no admin session is needed at all - which is the only way against a
// deployment where the admin signs in by email and the phone code is refused.
// Otherwise the demo admin signs in with the dev OTP and registers one.
const fromEnv = process.env.RAKSHA_DEVICE_ID && process.env.RAKSHA_DEVICE_SECRET
  ? { deviceId: process.env.RAKSHA_DEVICE_ID.trim(), deviceSecret: process.env.RAKSHA_DEVICE_SECRET.trim() }
  : null;
let state = fromEnv;
if (!state) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* first run */ } }

let adminTokenCache = null;
async function adminToken() {
  if (adminTokenCache) return adminTokenCache;
  const otp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: ADMIN_MSISDN } });
  const verified = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: ADMIN_MSISDN, code: otp.meta.devOtp } });
  if (!verified.data.roles.includes("admin")) {
    console.error("✗ %s is not admin — run `npm run db:seed:raksha` first", ADMIN_MSISDN);
    process.exit(1);
  }
  return (adminTokenCache = verified.data.accessToken);
}

let deviceToken = null;
if (state?.deviceId && state?.deviceSecret) {
  try {
    const t = await call("POST", "/v1/raksha/devices/token", {
      body: { deviceId: state.deviceId, deviceSecret: state.deviceSecret },
    });
    deviceToken = t.data.accessToken;
    console.log(`→ using device ${state.deviceId} (${fromEnv ? "credential from the environment" : "credential from local state file"})`);
  } catch (e) {
    if (fromEnv) { console.error("✗ RAKSHA_DEVICE_ID / RAKSHA_DEVICE_SECRET were rejected: " + e.message); process.exit(1); }
    console.log("→ stored credential rejected — registering a fresh device");
  }
}
if (!deviceToken) {
  const reg = await call("POST", "/v1/raksha/devices", {
    token: await adminToken(),
    body: { name: "SIM-EDGE-NH48 [SIMULATED]", lat: TRACK[0][1], lng: TRACK[0][0], hardwareRef: "SIMULATED rpi-class" },
  });
  state = { deviceId: reg.data.id, deviceSecret: reg.data.deviceSecret };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`→ registered device ${state.deviceId} (secret stored ONLY in ${STATE_FILE})`);
  const t = await call("POST", "/v1/raksha/devices/token", { body: state });
  deviceToken = t.data.accessToken;
}

// ── 2. build the queue: either a SIMULATED patrol, or REAL CV output ──────
const fromJsonIdx = process.argv.indexOf("--from-json");
const queue = [];
const runTag = Date.now().toString(36);
let battery = 87;

if (fromJsonIdx > -1) {
  // REAL-CV mode: detections come from ai/road_damage/detect.py (a genuine
  // YOLO model). Locations stay SIMULATED along NH-48 — RDD2022 images have
  // no GPS — and op ids are deterministic per image+index so re-uploading the
  // same detection file is idempotent.
  const file = process.argv[fromJsonIdx + 1];
  if (!file) { console.error("✗ --from-json needs a path to detect.py output"); process.exit(1); }
  banner("REAL CV DETECTIONS (model output · locations SIMULATED)");
  const report = JSON.parse(readFileSync(file, "utf8"));
  let n = 0;
  for (const img of report.results ?? []) {
    for (const [i, det] of (img.detections ?? []).entries()) {
      const f = (n * 7 + 3) % 100 / 100;               // spread along the corridor
      const leg = Math.min(TRACK.length - 2, Math.floor(f * (TRACK.length - 1)));
      const t = f * (TRACK.length - 1) - leg;
      queue.push({
        opId: `cv-${img.imageRef.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}-${i}`,
        type: det.type, severity: det.severity, confidence: det.confidence,
        lat: Number((TRACK[leg][1] + (TRACK[leg + 1][1] - TRACK[leg][1]) * t).toFixed(6)),
        lng: Number((TRACK[leg][0] + (TRACK[leg + 1][0] - TRACK[leg][0]) * t).toFixed(6)),
        capturedAt: new Date(Date.now() - n * 30_000).toISOString(),
        ranOffline: true,
        imageRef: img.imageRef,
        modelVersion: det.modelVersion,
        usedFallback: false,                            // honest: real model output
      });
      n++;
      console.log(`  [REAL CV] ${det.type.padEnd(12)} sev ${det.severity} conf ${det.confidence} ← ${img.imageRef}`);
    }
  }
  console.log(`→ ${queue.length} real detections from ${report.model} queued (locations SIMULATED)`);
} else {

banner("OFFLINE PATROL (no network — events queue locally)");
for (let i = 0; i < TRACK.length - 1; i++) {
  // interpolate 3 points per leg for a denser patrol
  for (let s = 0; s < 3; s++) {
    const f = s / 3;
    const lng = TRACK[i][0] + (TRACK[i + 1][0] - TRACK[i][0]) * f;
    const lat = TRACK[i][1] + (TRACK[i + 1][1] - TRACK[i][1]) * f;
    const roll = rand();
    let type = null;
    if (roll < 0.16) type = "pothole";
    else if (roll < 0.24) type = "road_damage";
    else if (roll < 0.27) type = "obstruction";
    if (!type) continue;

    const severity = type === "obstruction" ? (rand() < 0.5 ? 4 : 5) : 1 + Math.floor(rand() * 4);
    const detection = {
      opId: `sim-${runTag}-${queue.length.toString().padStart(3, "0")}`,
      type, severity,
      confidence: Number((0.65 + rand() * 0.3).toFixed(2)),
      lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)),
      capturedAt: new Date(Date.now() - (TRACK.length - i) * 60_000).toISOString(), // device clock, preserved
      ranOffline: true,
      modelVersion: MODEL,
      usedFallback: true,   // honest: this is the rules fallback, not a trained model
    };
    queue.push(detection);
    console.log(`  [SIMULATED] ${type.padEnd(12)} sev ${severity} conf ${detection.confidence} @ ${detection.lat},${detection.lng} → queued (${queue.length})`);
  }
  battery -= rand() < 0.3 ? 1 : 0;
}
console.log(`→ patrol complete: ${queue.length} events in the local queue, battery ${battery}% — still NO network used`);
}

// ── 3. connectivity returns: sync, then replay to prove idempotency
banner("CONNECTIVITY RESTORED — SYNCING QUEUE");
const first = await call("POST", "/v1/raksha/detections", { token: deviceToken, body: { detections: queue } });
console.log(`→ first sync:  ${first.meta.applied} applied, ${first.meta.duplicates} duplicates`);
const incidents = first.data.results.filter((r) => r.incidentId);
if (incidents.length) {
  console.log(`→ ${incidents.length} severe obstruction(s) raised incident SIGNALS (AWAITING_CONFIRMATION — a human must confirm; nothing was dispatched)`);
}

const replay = await call("POST", "/v1/raksha/detections", { token: deviceToken, body: { detections: queue } });
console.log(`→ replay sync: ${replay.meta.applied} applied, ${replay.meta.duplicates} duplicates (idempotent — no double-reporting)`);

await call("POST", "/v1/raksha/devices/heartbeat", {
  token: deviceToken,
  body: { batteryPercent: battery, storagePercent: 12 + Math.floor(rand() * 10), uptimeSeconds: 86_400, queueDepth: 0, lat: TRACK.at(-1)[1], lng: TRACK.at(-1)[0] },
});
console.log("→ heartbeat sent (battery, storage, position)");

// ── 4. road health after the patrol
banner("ROAD HEALTH (rule-based v1 — not an official standard)");
// Recomputing is an officer's action. With a device credential from the
// environment there is no admin session to do it with, so say how instead.
if (fromEnv) {
  console.log("  Sign in to RAKSHA and click “Recompute” to score the corridor with these detections.");
} else {
  const health = await call("POST", "/v1/raksha/road-health/recompute", { token: await adminToken() });
  for (const s of health.data) {
    console.log(`  ${s.code}  score ${String(s.score).padStart(3)}  ${s.level.toUpperCase().padEnd(8)}  potholes:${s.factors.potholes} damage:${s.factors.roadDamage} obstructions:${s.factors.obstructions}`);
  }
}

banner("DONE");
console.log(fromJsonIdx > -1
  ? `Dashboard: ${BASE}/raksha.html  ·  detections above are REAL model output; their GPS locations are SIMULATED\n`
  : `Dashboard: ${BASE}/raksha.html  ·  every event above is SIMULATED\n`);
