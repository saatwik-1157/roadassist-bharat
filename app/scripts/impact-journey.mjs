#!/usr/bin/env node
/**
 * GET /v1/impact/summary, exercised against the running API and its database.
 *
 *   API=http://localhost:4000 DATABASE_URL=postgres://... node scripts/impact-journey.mjs
 *
 * What it proves, each step asserting (so this is a test, not a demo):
 *   1. the route is public, answers the documented shape, and carries no
 *      personal data - no forbidden key, no id-shaped or phone-shaped value;
 *   2. it is cached: a second call inside the TTL is a hit with the same asOf;
 *   3. its counts are right: after this script books, accepts, arrives, raises
 *      an SOS online and one off-grid, and reports a hazard, the next refresh
 *      moves by exactly those amounts AND agrees with counts this script takes
 *      from the database itself, written independently of the route's SQL;
 *   4. it is rate-limited per address.
 *
 * Needs a quiet database (nothing else writing while it runs) and waits for
 * one cache expiry (up to ~50 s). Not part of the six counted suites.
 */
const BASE = process.env.API ?? "http://localhost:4000";
const DB_URL = process.env.DATABASE_URL ?? "postgres://roadassist:devpassword@localhost:5434/roadassist";
const STEP_MS = Number(process.env.IMPACT_STEP_MS ?? 1500);
const MSISDN = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✗ ${label}  ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers ?? {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, ...json };
}
const summary = (headers) => call("GET", "/v1/impact/summary", { headers });

/** Same rule as domain/impact.ts findPii, restated here so the test does not trust the code it tests. */
const FORBIDDEN = /^(id|userid|user_id|msisdn|phone|mobile|fullname|full_name|name|displayname|display_name|email|address|addresstext|address_text|reference|registrationno|vehicleid|deviceid|mechanicid|reportedby|symptoms|imageref|token|ip)$/i;
function piiIn(v, p = "$", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => piiIn(x, `${p}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) { if (FORBIDDEN.test(k)) out.push(`${p}.${k}`); piiIn(x, `${p}.${k}`, out); }
  } else if (typeof v === "string" && !p.startsWith("$.meta.sources")) {
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v)) out.push(`${p} (uuid)`);
    if (/(?:\+91)?[6-9]\d{9}\b/.test(v)) out.push(`${p} (phone)`);
  }
  return out;
}

console.log(`\nRoadAssist — impact summary  (${BASE})\n`);

// ── 1. public, shaped, no personal data ──────────────────────────────────────
console.log("1. Public aggregates");
const s0 = await summary();
ok("answers without a session", s0.status === 200, `got ${s0.status}`);
const withJunk = await summary({ authorization: "Bearer not-a-token" });
ok("a bad token does not turn it into a 401", withJunk.status === 200, `got ${withJunk.status}`);
const d0 = s0.data ?? {};
ok("names its source and time", d0.source === "live database" && !Number.isNaN(Date.parse(d0.asOf)), `${d0.source} ${d0.asOf}`);
for (const k of ["bookings", "sos", "raksha", "coverage", "accounts", "languages"]) ok(`carries the ${k} block`, Boolean(d0[k]));
ok("every block that is seeded says so", d0.bookings?.label === "DEMO DATA" && d0.sos?.label === "DEMO DATA" && d0.coverage?.label === "DEMO DATA");
ok("the device positions are labelled simulated", /SIMULATED|MIXED/.test(d0.raksha?.detections?.label ?? ""), d0.raksha?.detections?.label);
ok("claims no estimates", /^None\./.test(s0.meta?.estimates ?? ""));
ok("shows the SQL behind each block", ["bookings", "timings", "sos", "detections", "cells", "coverage", "accounts"].every((k) => /SELECT/.test(s0.meta?.sources?.[k] ?? "")));
const leaks = piiIn({ data: s0.data, meta: s0.meta });
ok("no key, id or phone number that could identify anyone", leaks.length === 0, leaks.slice(0, 3).join(", "));
const cellsOk = (d0.raksha?.map?.cells ?? []).every((c) => c.count >= d0.raksha.map.minCount && Object.keys(c).length === 5);
ok("map cells are coarse counts above the threshold, nothing more", cellsOk, `${d0.raksha?.map?.cells?.length ?? 0} cells`);
ok("languages come from the code", d0.languages?.count === d0.languages?.codes?.length && d0.languages.count > 0, `${d0.languages?.codes?.join(" ")}`);

// ── 2. cached ────────────────────────────────────────────────────────────────
console.log("\n2. Server-side cache");
const s1 = await summary();
ok("a second call inside the TTL is served from the cache", s1.headers.get("x-impact-cache") === "hit" && s1.data?.asOf === d0.asOf,
   `${s1.headers.get("x-impact-cache")} ttl=${s1.meta?.cache?.ttlSeconds}s`);
ok("the TTL is between 30 and 60 seconds", s1.meta?.cache?.ttlSeconds >= 30 && s1.meta?.cache?.ttlSeconds <= 60);

// ── 3. the counts move by exactly what happened ─────────────────────────────
console.log("\n3. Counts follow the database");
const otp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: MSISDN } });
const ver = await call("POST", "/v1/auth/otp/verify", { body: { msisdn: MSISDN, code: otp.meta?.devOtp } });
const token = ver.data?.accessToken;
ok("a fresh citizen signs in", Boolean(token));
const veh = await call("POST", "/v1/vehicles", { token, body: {
  registrationNo: "IM" + Math.floor(10 + Math.random() * 89) + Math.random().toString(36).slice(2, 4).toUpperCase() + Math.floor(1000 + Math.random() * 8999),
  vehicleClass: "car" } });
const book = await call("POST", "/v1/bookings", { token, body: {
  vehicleId: veh.data?.id, serviceTypeCode: "battery_jumpstart", lat: 28.4595, lng: 77.0266, symptoms: "impact journey" } });
ok("booking requested", book.status === 201, `${book.status}`);
const disp = await call("POST", `/v1/bookings/${book.data?.id}/dispatch`, { token, body: { radiusKm: 30, limit: 3 } });
const offer = disp.data?.offers?.[0];
ok("dispatch found a mechanic", Boolean(offer), `${disp.data?.offers?.length ?? 0} offers`);
// Only the mechanic an offer was sent to may accept it, so the harness signs in
// as that mechanic. The offer carries only a public identity; the owning
// account is resolved directly, the same join dispatch used (as e2e-journey does).
const { default: postgres } = await import("postgres");
const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const [mech] = offer ? await sql`SELECT u.msisdn FROM dispatch_offers o JOIN mechanics m ON m.id = o.mechanic_id
  JOIN users u ON u.id = m.user_id WHERE o.id = ${offer.id}` : [];
const mOtp = await call("POST", "/v1/auth/otp/request", { body: { msisdn: mech?.msisdn } });
const mToken = (await call("POST", "/v1/auth/otp/verify", { body: { msisdn: mech?.msisdn, code: mOtp.meta?.devOtp } })).data?.accessToken;
ok("the offered mechanic signs in", Boolean(mToken));
await sleep(STEP_MS);
const acc = await call("POST", `/v1/offers/${offer?.id}/accept`, { token: mToken });
ok("accepted", acc.data?.status === "ASSIGNED", `${acc.status} ${acc.data?.status}`);
await call("POST", `/v1/bookings/${book.data?.id}/transition`, { token: mToken, body: { command: "mechanic.start_travel" } });
await sleep(STEP_MS);
const arr = await call("POST", `/v1/bookings/${book.data?.id}/transition`, { token: mToken, body: { command: "arrive" } });
ok("mechanic on site", arr.data?.status === "ON_SITE", `${arr.status} ${arr.data?.status}`);

const sos = await call("POST", "/v1/sos", { token, body: { lat: 28.44, lng: 77.0, source: "manual" } });
ok("an online SOS is raised", sos.status === 201, `${sos.status}`);
const ALPHA = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const ref = "RA-" + Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");
const offgrid = await call("POST", "/v1/sos/offline-sync", { token, body: { incidents: [{
  clientIncidentId: ref, opId: "impact-" + Date.now(), occurredAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  emergencyType: "breakdown", lat: 28.41, lng: 76.99, accuracyM: 12 }] } });
ok("an SOS stored offline syncs", offgrid.status === 200 && offgrid.data?.results?.[0]?.status === "created",
   `${offgrid.status} ${offgrid.data?.results?.[0]?.status}`);
const rep = await call("POST", "/v1/raksha/report", { token, body: { type: "pothole", severity: 4, lat: 28.4482, lng: 77.0171, accuracyM: 9 } });
ok("a citizen hazard report is filed", rep.status === 201, `${rep.status}`);

// Wait out the cache: the next answer must be computed after everything above.
const after = Date.now();
let s2 = null;
for (let i = 0; i < 40; i++) {
  const r = await summary();
  if (r.status === 200 && Date.parse(r.data.asOf) >= after) { s2 = r; break; }
  await sleep(2000);
}
ok("the cache expired and the figures were recomputed", Boolean(s2), s2 ? `after ${Math.round((Date.parse(s2.data.asOf) - after) / 1000)} s` : "never refreshed");
const d2 = s2?.data ?? d0;
const delta = (f) => (f(d2) ?? 0) - (f(d0) ?? 0);
ok("requests +1", delta((d) => d.bookings.requests) === 1, `${delta((d) => d.bookings.requests)}`);
ok("bookings through the app +1", delta((d) => d.bookings.provenance.viaApi) === 1);
ok("time-to-assign gained one sample", delta((d) => d.bookings.timings.timeToAssign.n) === 1,
   `median ${d2.bookings?.timings?.timeToAssign?.medianSeconds}s`);
ok("time-to-arrive gained one sample", delta((d) => d.bookings.timings.timeToArrive.n) === 1,
   `median ${d2.bookings?.timings?.timeToArrive?.medianSeconds}s`);
ok("a measured duration is never reported as zero when there are no samples",
   d2.bookings.timings.timeToArrive.n > 0 ? d2.bookings.timings.timeToArrive.medianSeconds > 0 : d2.bookings.timings.timeToArrive.medianSeconds === null);
ok("SOS raised +2", delta((d) => d.sos.raised) === 2, `${delta((d) => d.sos.raised)}`);
ok("raised offline then synced +1", delta((d) => d.sos.raisedOfflineThenSynced) === 1);
ok("the offline wait is measured (about four minutes)", d2.sos.offlineDelay.medianSeconds > 0, `${d2.sos.offlineDelay.medianSeconds}s`);
ok("citizen reports +1", delta((d) => d.raksha.citizenReports.total) === 1);
ok("device detections unchanged by a citizen report", delta((d) => d.raksha.detections.total) === 0);
ok("citizen accounts +1, none of them in the seeded range", delta((d) => d.accounts.citizens) === 1 && delta((d) => d.accounts.inSeedRange) === 0);

// Independent counts, written differently from the route's SQL.
try {
  const statuses = await sql`SELECT status::text AS s, count(*)::int AS n FROM bookings WHERE deleted_at IS NULL GROUP BY 1`;
  const byStatus = Object.fromEntries(statuses.map((r) => [r.s, r.n]));
  ok("bookings by status match the table", JSON.stringify(Object.entries(byStatus).sort()) === JSON.stringify(Object.entries(d2.bookings.byStatus).sort()));
  const [{ n: viaApi }] = await sql`SELECT count(DISTINCT booking_id)::int AS n FROM booking_events e
    JOIN bookings b ON b.id = e.booking_id AND b.deleted_at IS NULL`;
  ok("bookings with an event history match", viaApi === d2.bookings.provenance.viaApi, `${viaApi}`);
  const [{ n: assigned }] = await sql`SELECT count(DISTINCT booking_id)::int AS n FROM booking_events
    WHERE to_status = 'ASSIGNED' AND deleted_at IS NULL`;
  ok("time-to-assign sample count = bookings ever accepted through the app", assigned === d2.bookings.timings.timeToAssign.n, `${assigned}`);
  const [inc] = await sql`SELECT count(*)::int AS raised, sum((synced_at IS NOT NULL)::int)::int AS synced,
      sum((status = 'RESOLVED')::int)::int AS resolved
    FROM incidents WHERE deleted_at IS NULL AND (user_id IS NOT NULL OR NOT detected_by_model)`;
  ok("SOS raised / synced / resolved match the table", inc.raised === d2.sos.raised && inc.synced === d2.sos.raisedOfflineThenSynced && inc.resolved === d2.sos.resolved,
     `${inc.raised}/${inc.synced}/${inc.resolved}`);
  const det = await sql`SELECT detection_type::text AS t, count(*)::int AS n FROM raksha_detections
    WHERE deleted_at IS NULL AND (raw->>'source' IS DISTINCT FROM 'citizen') GROUP BY 1`;
  const detBy = Object.fromEntries(det.map((r) => [r.t, r.n]));
  ok("device detections by class match", ["pothole", "road_damage", "obstruction"].every((k) => (detBy[k] ?? 0) === d2.raksha.detections.byClass[k]),
     JSON.stringify(detBy));
  const [{ n: cit }] = await sql`SELECT count(*)::int AS n FROM raksha_detections WHERE deleted_at IS NULL AND raw->>'source' = 'citizen'`;
  ok("citizen reports match", cit === d2.raksha.citizenReports.total, `${cit}`);
  const [cov] = await sql`SELECT sum(verified::int)::int AS v, count(*)::int AS t FROM mechanics WHERE deleted_at IS NULL`;
  ok("verified mechanics match", cov.v === d2.coverage.mechanics.verified && cov.t === d2.coverage.mechanics.total, `${cov.v} of ${cov.t}`);
  const [{ n: resp }] = await sql`SELECT count(*)::int AS n FROM responder_units WHERE deleted_at IS NULL AND active`;
  ok("active responders match", resp === d2.coverage.responders.active, `${resp}`);
  const drawnPlusHeld = d2.raksha.map.drawn + d2.raksha.map.suppressed.detections;
  const [{ n: mappable }] = await sql`SELECT count(*)::int AS n FROM raksha_detections
    WHERE deleted_at IS NULL AND location IS NOT NULL AND status <> 'REJECTED'`;
  ok("every mappable detection is either drawn or counted as withheld", drawnPlusHeld === mappable, `${drawnPlusHeld} = ${mappable}`);
} finally {
  await sql.end({ timeout: 5 });
}

// ── 4. rate-limited ──────────────────────────────────────────────────────────
console.log("\n4. Rate limit");
let limited = null, sent = 0;
for (let i = 0; i < 80 && !limited; i++) {
  const r = await summary(); sent++;
  if (r.status === 429) limited = r;
}
ok("a client that keeps asking is refused with 429", Boolean(limited), `after ${sent} more request(s)`);
ok("…and told when to retry", Number(limited?.headers.get("retry-after")) > 0, `retry-after=${limited?.headers.get("retry-after")}`);
ok("…in the platform's error envelope", limited?.error?.code === "rate_limited");

console.log(`\n${"─".repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(58)}\n`);
process.exit(fail ? 1 : 0);
