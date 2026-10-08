/**
 * The public Impact summary (GET /v1/impact/summary, impact.html).
 *
 * The route is public, so these pin the three things that make that safe and
 * honest: the counts are right on a known fixture, nothing personal survives
 * into the answer, and the database is protected by a cache and a ceiling.
 * The live route against a seeded database is scripts/impact-journey.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  CELL_DEG, MIN_CELL_COUNT, RATE, SingleFlightCache, assertNoPii, findPii, shapeAccounts, shapeBookings,
  shapeCells, shapeCoverage, shapeRaksha, shapeSos, testsFromMeasured,
  type BookingStatusRow, type CellRow, type DetectionRow,
} from "../src/domain/impact.js";
import { SOURCES, impactLimit } from "../src/routes/impact.js";
import { resetAllLimits } from "../src/ratelimit.js";

// ── a seeded fixture, as the queries return it ───────────────────────────────
// Extra columns a careless query might return (msisdn, user_id, full_name) are
// included on purpose: the shapers must drop them.
const LEAK = { msisdn: "+917000000001", user_id: "0b6f1c1e-6f1d-4c55-9b7e-2f6f3f1d9a10", full_name: "Asha Rao" };

const BOOKINGS: BookingStatusRow[] = [
  { status: "DRAFT", n: 2, via_api: 2, created_offline: 0, ...LEAK },
  { status: "REQUESTED", n: 10, via_api: 1, created_offline: 3 },
  { status: "MATCHING", n: 5, via_api: 0, created_offline: 0 },
  { status: "NO_SUPPLY", n: 1, via_api: 1, created_offline: 0 },
  { status: "ASSIGNED", n: 4, via_api: 2, created_offline: 1 },
  { status: "ON_SITE", n: 3, via_api: 3, created_offline: 0 },
  { status: "COMPLETED", n: 20, via_api: 0, created_offline: 5 },
  { status: "PAID", n: 30, via_api: 4, created_offline: 2 },
  { status: "CANCELLED", n: 6, via_api: 1, created_offline: 0 },
];
const DETECTIONS: DetectionRow[] = [
  { type: "pothole", severity: 5, status: "DETECTED", citizen: false, simulated: true, n: 7 },
  { type: "pothole", severity: 3, status: "VERIFIED", citizen: false, simulated: true, n: 4 },
  { type: "road_damage", severity: 2, status: "REJECTED", citizen: false, simulated: true, n: 2 },
  { type: "road_damage", severity: 4, status: "CLOSED", citizen: false, simulated: true, n: 1 },
  { type: "obstruction", severity: 1, status: "REPAIRED", citizen: false, simulated: false, n: 3 },
  { type: "pothole", severity: 4, status: "DETECTED", citizen: true, simulated: true, n: 2, ...LEAK },
  { type: "obstruction", severity: 3, status: "VERIFIED", citizen: true, simulated: true, n: 1 },
];

test("bookings: every status counted once, DRAFT is not a request, and the seeded split adds up", () => {
  const b = shapeBookings(BOOKINGS, {
    n_assign: 3, assign_p50: 41.26, assign_p90: 88, n_arrive: 0, arrive_p50: null, arrive_p90: null,
  });
  const total = BOOKINGS.reduce((a, r) => a + r.n, 0);
  assert.equal(Object.values(b.byStatus).reduce((a, n) => a + n, 0), total);
  assert.equal(b.requests, total - 2);
  assert.equal(b.matched, 4 + 3 + 20 + 30, "ASSIGNED, ON_SITE, COMPLETED, PAID");
  assert.equal(b.completed, 50);
  assert.equal(b.cancelled, 6);
  assert.equal(b.noSupply, 1);
  assert.equal(b.open, 10 + 5 + 4 + 3);
  assert.equal(b.createdOffline, 11);
  assert.equal(b.provenance.viaApi, 14);
  assert.equal(b.provenance.viaApi + b.provenance.seededDirect, total);
  assert.equal(b.label, "DEMO DATA");
  assert.deepEqual(b.timings.timeToAssign, { n: 3, medianSeconds: 41.3, p90Seconds: 88 });
  // No samples is "unknown", never a zero-second response time.
  assert.deepEqual(b.timings.timeToArrive, { n: 0, medianSeconds: null, p90Seconds: null });
});

test("SOS: the derived seeded split and the offline delay come through unchanged", () => {
  const s = shapeSos({
    raised: 12, confirmed: 9, resolved: 4, cancelled: 2, awaiting: 1, active: 5,
    offline_synced: 3, sms: 1, crash_detected: 2, via_api: 7, offline_p50: 125.04, offline_p90: 600,
  });
  assert.equal(s.raised, 12);
  assert.equal(s.raisedOfflineThenSynced, 3);
  assert.deepEqual(s.provenance.viaApi + s.provenance.seededDirect, 12);
  assert.deepEqual(s.offlineDelay, { n: 3, medianSeconds: 125, p90Seconds: 600 });
  assert.equal(shapeSos(undefined).raised, 0, "an empty table is zeroes, not an error");
});

test("RAKSHA: class x severity, the review funnel and the citizen split all reconcile with the rows", () => {
  const { detections: d, citizenReports: c } = shapeRaksha(DETECTIONS);
  const device = DETECTIONS.filter((r) => !r.citizen).reduce((a, r) => a + r.n, 0);
  assert.equal(d.total, device);
  assert.equal(c.total, 3);
  assert.deepEqual(d.byClass, { pothole: 11, road_damage: 3, obstruction: 3 });
  assert.deepEqual(d.bySeverity, { 1: 3, 2: 2, 3: 4, 4: 1, 5: 7 });
  const matrix = Object.values(d.byClassSeverity).flatMap((row) => Object.values(row)).reduce((a, n) => a + n, 0);
  assert.equal(matrix, device, "the class x severity grid sums to the total");
  // Verified includes everything that passed review and moved on.
  assert.deepEqual(d.funnel, { pending: 7, verified: 4 + 1 + 3, dismissed: 2, repairScheduled: 0, repaired: 3, closed: 1 });
  assert.equal(d.funnel.pending + d.funnel.verified + d.funnel.dismissed, device);
  assert.deepEqual(d.positions, { simulated: 14, deviceGps: 3 });
  assert.equal(d.label, "MIXED", "one measured device means the block is no longer all simulated");
  assert.equal(shapeRaksha(DETECTIONS.filter((r) => r.simulated)).detections.label, "SIMULATED POSITIONS");
  assert.deepEqual(c.funnel.pending + c.funnel.verified, 3);
});

test("the map withholds thin cells, counts what it withheld, and loses nothing", () => {
  const rows: CellRow[] = [
    { lat: 28.45, lng: 77.01, n: 9, max_severity: 5, citizen: 0 },
    { lat: 28.43, lng: 76.99, n: MIN_CELL_COUNT, max_severity: 3, citizen: 1 },
    { lat: 28.39, lng: 76.95, n: 1, max_severity: 2, citizen: 1 },
    { lat: 28.37, lng: 76.93, n: 2, max_severity: 4, citizen: 0 },
  ];
  const m = shapeCells(rows);
  assert.equal(m.cellDegrees, CELL_DEG);
  assert.deepEqual(m.cells.map((c) => c.count), [9, MIN_CELL_COUNT], "busiest first, the threshold itself drawn");
  assert.deepEqual(m.suppressed, { cells: 2, detections: 3 });
  assert.equal(m.drawn + m.suppressed.detections, rows.reduce((a, r) => a + r.n, 0));
  for (const c of m.cells) assert.deepEqual(Object.keys(c).sort(), ["citizen", "count", "lat", "lng", "maxSeverity"]);
});

test("a drawn cell never publishes a citizen share below the floor (one report padded by devices is not placed)", () => {
  const m = shapeCells([
    { lat: 28.37, lng: 76.93, n: MIN_CELL_COUNT, max_severity: 4, citizen: 1 },
    { lat: 28.45, lng: 77.01, n: 9, max_severity: 5, citizen: MIN_CELL_COUNT },
    { lat: 28.43, lng: 76.99, n: 5, max_severity: 3, citizen: 0 },
  ]);
  const at = (lat: number) => m.cells.find((c) => c.lat === lat)!;
  assert.equal(at(28.37).citizen, null, "1 citizen report among 3 detections is withheld, not published as 1");
  assert.equal(at(28.43).citizen, null, "0 is withheld too, so a null does not reveal that someone reported");
  assert.equal(at(28.45).citizen, MIN_CELL_COUNT, "at the floor the share is published");
});

test("no personal field survives shaping, even when a query returns one", () => {
  const answer = {
    data: {
      asOf: new Date().toISOString(),
      bookings: shapeBookings(BOOKINGS, undefined),
      raksha: { ...shapeRaksha(DETECTIONS), map: shapeCells([{ lat: 28.45, lng: 77.01, n: 5, max_severity: 4, citizen: 1, ...LEAK } as CellRow]) },
      sos: shapeSos(undefined), coverage: shapeCoverage(undefined), accounts: shapeAccounts(undefined),
    },
    meta: { sources: SOURCES },
  };
  assert.deepEqual(findPii(answer), []);
  const json = JSON.stringify(answer);
  for (const v of [LEAK.msisdn, LEAK.user_id, LEAK.full_name]) assert.ok(!json.includes(v), `${v} leaked`);
});

test("the privacy guard refuses an answer carrying a key, an id or a phone number", () => {
  assert.deepEqual(findPii({ data: { mechanics: [{ displayName: "x" }] } }), ["$.data.mechanics[0].displayName: forbidden key"]);
  assert.match(findPii({ data: { last: "0b6f1c1e-6f1d-4c55-9b7e-2f6f3f1d9a10" } })[0], /row id/);
  assert.match(findPii({ data: { who: "call +919876543210" } })[0], /phone number/);
  assert.match(findPii({ data: { who: "9876543210" } })[0], /phone number/);
  assert.throws(() => assertNoPii({ data: { userId: 1 } }), /refused/);
  // The SQL shown under each figure may quote a phone pattern; its keys are still checked.
  assert.deepEqual(findPii({ meta: { sources: { accounts: "msisdn ~ '^\\+9170000[0-9]{5}$' 9876543210" } } }), []);
  assert.doesNotThrow(() => assertNoPii({ data: { count: 1162, asOf: "2026-10-07T10:00:00.000Z" } }));
});

test("the queries select aggregates only: no personal column is ever returned", () => {
  const all = Object.values(SOURCES).join("\n");
  for (const col of ["full_name", "email", "address_text", "display_name", "symptoms", "notes", "image_ref",
    "registration_no", "reportedBy", "client_incident_id", "reference", "ST_AsGeoJSON", "ST_AsText"]) {
    assert.ok(!all.includes(col), `a query mentions ${col}`);
  }
  // msisdn appears once, inside a FILTER predicate that only COUNTS seeded numbers.
  assert.equal(all.match(/msisdn/g)?.length, 1);
  assert.match(SOURCES.accounts, /count\(DISTINCT u\.id\) FILTER \(WHERE u\.msisdn ~ /);
  // Positions leave only as grid-cell centres.
  assert.match(SOURCES.cells, /floor\(ST_Y\(d\.location\) \/ 0\.02\) \+ 0\.5/);
  assert.ok(!/ST_[XY]\((?!d\.location\) \/)/.test(all), "a raw coordinate is selected somewhere");
});

test("the cache computes once for a burst, reuses within the TTL, and never caches a failure", async () => {
  let now = 0, runs = 0;
  const cache = new SingleFlightCache<number>(45_000, () => now);
  const compute = async () => { runs++; await new Promise((r) => setTimeout(r, 5)); return runs; };
  const burst = await Promise.all(Array.from({ length: 20 }, () => cache.get(compute)));
  assert.equal(runs, 1, "twenty concurrent misses, one computation");
  assert.ok(burst.every((r) => r.value === 1));
  now = 44_999;
  assert.deepEqual(await cache.get(compute), { value: 1, hit: true, ageMs: 44_999 });
  now = 45_000;
  assert.equal((await cache.get(compute)).value, 2, "expired at the TTL exactly");

  const failing = new SingleFlightCache<number>(45_000, () => now);
  await assert.rejects(failing.get(async () => { throw new Error("db down"); }));
  assert.equal((await failing.get(async () => 7)).value, 7, "the next caller tries again");
});

test(`the public route is limited to ${RATE.max} a minute per address, and other addresses are unaffected`, async () => {
  resetAllLimits();
  const reply = () => {
    const r = { statusCode: 200, headers: {} as Record<string, string>,
      header(k: string, v: string) { r.headers[k] = v; return r; },
      code(c: number) { r.statusCode = c; return r; }, send() { return r; } };
    return r;
  };
  const req = (ip: string) => ({ ip, id: "t" }) as unknown as FastifyRequest;
  for (let i = 0; i < RATE.max; i++) {
    const r = reply();
    await impactLimit(req("203.0.113.9"), r as unknown as FastifyReply);
    assert.equal(r.statusCode, 200);
  }
  const over = reply();
  await impactLimit(req("203.0.113.9"), over as unknown as FastifyReply);
  assert.equal(over.statusCode, 429);
  assert.ok(Number(over.headers["retry-after"]) > 0);
  const other = reply();
  await impactLimit(req("203.0.113.10"), other as unknown as FastifyReply);
  assert.equal(other.statusCode, 200);
  resetAllLimits();
});

test("the test count is read from measured.json, and a breakdown that does not add up says so", () => {
  const file = JSON.parse(readFileSync(new URL("../../../docs/measured.json", import.meta.url), "utf8"));
  const t = testsFromMeasured(file);
  assert.ok(t);
  assert.equal(t.total, file.assertions.total);
  assert.deepEqual(t.suites, file.assertions.suites);
  assert.equal(t.consistent, true);
  const bad = testsFromMeasured({ assertions: { total: 10, suites: { unit: 4, e2e: 5 } } });
  assert.equal(bad?.consistent, false);
  assert.equal(testsFromMeasured(null), null);
  assert.equal(testsFromMeasured({ assertions: { total: "many" } }), null);
});

test("impact.html states the test figures measured.json holds (the claims gate reads the same table)", () => {
  const html = readFileSync(new URL("../../web/impact.html", import.meta.url), "utf8");
  const file = JSON.parse(readFileSync(new URL("../../../docs/measured.json", import.meta.url), "utf8"));
  const cell = (suite: string) => html.match(new RegExp(`data-suite="${suite}"><th[^>]*>[^<]+</th><td>(\\d+)</td>`))?.[1];
  for (const [k, v] of Object.entries(file.assertions.suites)) assert.equal(cell(k), String(v), k);
  assert.equal(cell("total"), String(file.assertions.total));
  assert.ok(!/https?:\/\/(?!localhost)/.test(html.replace(/<!--[\s\S]*?-->/g, "")), "the page names no third-party host");
});
