/**
 * GET /v1/impact/summary - the public Impact dashboard's one data source.
 *
 *   public        no sign-in: it carries aggregates only (domain/impact.ts
 *                 refuses to publish anything that looks like personal data)
 *   rate-limited  RATE.max requests per RATE.windowMs per address (route-limits.ts)
 *   cached        the whole answer is computed at most once per CACHE_TTL_MS
 *                 per instance, and concurrent misses share one computation,
 *                 so a page left open, or a room full of them, cannot hammer
 *                 the database
 *
 * Every figure is one of the queries below, run against the live database.
 * The SQL is returned with the answer (meta.sources) so the page can show,
 * under each number, exactly what produced it. What is seeded or simulated
 * is said by the answer itself - see PROVENANCE in domain/impact.ts.
 *
 * The test count is not in the database: it is read from app/docs/measured.json
 * when this process can see that file (a source checkout). The Docker image
 * does not ship docs/, so there it is null and the page shows the figure it
 * was built with, which scripts/check-claims.mjs holds to the same file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { sql as raw } from "drizzle-orm";

import { db } from "../db.js";
import { LOCALES } from "../i18n.js";
import { bucket } from "../route-limits.js";
import {
  CACHE_TTL_MS, CELL_DEG, RATE, REACH_KM, SingleFlightCache, assertNoPii,
  shapeAccounts, shapeBookings, shapeCells, shapeCoverage, shapeRaksha, shapeSos, testsFromMeasured,
  type AccountsRow, type BookingStatusRow, type CellRow, type CoverageRow, type DetectionRow,
  type SosRow, type TimingRow,
} from "../domain/impact.js";

/**
 * The queries, as the exact text that runs. Constants only - nothing a caller
 * sends reaches them - so they are executed as written and shown as written.
 */
export const SOURCES = {
  bookings: `
SELECT b.status::text AS status,
       count(*)::int AS n,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM booking_events e
                                       WHERE e.booking_id = b.id))::int AS via_api,
       count(*) FILTER (WHERE b.created_offline)::int AS created_offline
  FROM bookings b
 WHERE b.deleted_at IS NULL
 GROUP BY b.status`,

  timings: `
WITH ev AS (
  SELECT booking_id,
         min(created_at) FILTER (WHERE to_status = 'REQUESTED') AS requested,
         min(created_at) FILTER (WHERE to_status = 'ASSIGNED')  AS assigned,
         min(created_at) FILTER (WHERE to_status = 'ON_SITE')   AS arrived
    FROM booking_events
   WHERE deleted_at IS NULL
   GROUP BY booking_id)
SELECT count(*) FILTER (WHERE assigned >= requested)::int AS n_assign,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM assigned - requested)::float8)
         FILTER (WHERE assigned >= requested) AS assign_p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM assigned - requested)::float8)
         FILTER (WHERE assigned >= requested) AS assign_p90,
       count(*) FILTER (WHERE arrived >= requested)::int AS n_arrive,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM arrived - requested)::float8)
         FILTER (WHERE arrived >= requested) AS arrive_p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM arrived - requested)::float8)
         FILTER (WHERE arrived >= requested) AS arrive_p90
  FROM ev`,

  // RAKSHA's own road signals (model-raised, no owner) are not SOS; they are
  // counted under coverage.raksha.incidentSignals instead.
  sos: `
SELECT count(*)::int AS raised,
       count(*) FILTER (WHERE i.confirmed_at IS NOT NULL)::int AS confirmed,
       count(*) FILTER (WHERE i.status = 'RESOLVED')::int AS resolved,
       count(*) FILTER (WHERE i.status = 'CANCELLED')::int AS cancelled,
       count(*) FILTER (WHERE i.status IN ('DETECTED', 'AWAITING_CONFIRMATION'))::int AS awaiting,
       count(*) FILTER (WHERE i.status IN ('CONFIRMED', 'RESPONDING'))::int AS active,
       count(*) FILTER (WHERE i.synced_at IS NOT NULL)::int AS offline_synced,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM incident_signals s
                                       WHERE s.incident_id = i.id AND s.kind = 'sms'))::int AS sms,
       count(*) FILTER (WHERE i.detected_by_model)::int AS crash_detected,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM incident_signals s
                                       WHERE s.incident_id = i.id))::int AS via_api,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM i.synced_at - i.occurred_at)::float8)
         FILTER (WHERE i.synced_at IS NOT NULL AND i.occurred_at IS NOT NULL) AS offline_p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM i.synced_at - i.occurred_at)::float8)
         FILTER (WHERE i.synced_at IS NOT NULL AND i.occurred_at IS NOT NULL) AS offline_p90
  FROM incidents i
 WHERE i.deleted_at IS NULL
   AND NOT (i.detected_by_model AND i.user_id IS NULL)`,

  detections: `
SELECT d.detection_type::text AS type, d.severity, d.status::text AS status,
       coalesce(d.raw->>'source' = 'citizen', false) AS citizen,
       e.simulated, count(*)::int AS n
  FROM raksha_detections d
  JOIN edge_devices e ON e.id = d.device_id
 WHERE d.deleted_at IS NULL
 GROUP BY 1, 2, 3, 4, 5`,

  // Dismissed (REJECTED) detections are not drawn: a false positive is not a hazard.
  cells: `
SELECT (floor(ST_Y(d.location) / ${CELL_DEG}) + 0.5) * ${CELL_DEG} AS lat,
       (floor(ST_X(d.location) / ${CELL_DEG}) + 0.5) * ${CELL_DEG} AS lng,
       count(*)::int AS n,
       max(d.severity)::int AS max_severity,
       count(*) FILTER (WHERE d.raw->>'source' = 'citizen')::int AS citizen
  FROM raksha_detections d
 WHERE d.deleted_at IS NULL AND d.location IS NOT NULL AND d.status <> 'REJECTED'
 GROUP BY 1, 2`,

  coverage: `
SELECT
  (SELECT count(*)::int FROM mechanics WHERE deleted_at IS NULL) AS mechanics_total,
  (SELECT count(*)::int FROM mechanics WHERE deleted_at IS NULL AND verified) AS mechanics_verified,
  (SELECT count(*)::int FROM mechanics m JOIN service_partners p ON p.id = m.partner_id
    WHERE m.deleted_at IS NULL AND m.verified AND p.name = 'Demo Fleet (simulated)') AS mechanics_demo_fleet,
  (SELECT count(DISTINCT m.zone_id)::int FROM mechanics m
    WHERE m.deleted_at IS NULL AND m.verified) AS zones,
  (SELECT count(DISTINCT z.state)::int FROM mechanics m JOIN service_zones z ON z.id = m.zone_id
    WHERE m.deleted_at IS NULL AND m.verified) AS states,
  (SELECT round(ST_Area(ST_Union(ST_Buffer(m.last_location::geography, ${REACH_KM * 1000})::geometry)::geography) / 1e6)::int
     FROM mechanics m
    WHERE m.deleted_at IS NULL AND m.verified AND m.last_location IS NOT NULL) AS reach_km2,
  (SELECT count(*)::int FROM responder_units WHERE deleted_at IS NULL) AS responders_total,
  (SELECT count(*)::int FROM responder_units WHERE deleted_at IS NULL AND active) AS responders_active,
  (SELECT count(*)::int FROM responder_units
    WHERE deleted_at IS NULL AND name LIKE '%(simulated)') AS responders_labelled_simulated,
  (SELECT count(*)::int FROM edge_devices
    WHERE deleted_at IS NULL AND hardware_ref <> 'CITIZEN-CROWDSOURCE') AS devices_total,
  (SELECT count(*)::int FROM edge_devices
    WHERE deleted_at IS NULL AND hardware_ref <> 'CITIZEN-CROWDSOURCE' AND simulated) AS devices_simulated,
  (SELECT count(*)::int FROM road_segments WHERE deleted_at IS NULL) AS segments,
  (SELECT count(*)::int FROM incidents
    WHERE deleted_at IS NULL AND detected_by_model AND user_id IS NULL) AS raksha_incidents`,

  // +91 70000 00000-09999: the seed's synthetic citizens (domain/demo-numbers.ts).
  accounts: `
SELECT count(DISTINCT u.id)::int AS citizens,
       count(DISTINCT u.id) FILTER (WHERE u.msisdn ~ '^\\+9170000[0-9]{5}$')::int AS citizens_seed_range
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
  JOIN roles r ON r.id = ur.role_id AND r.name = 'citizen'
 WHERE u.deleted_at IS NULL`,
} as const;

/** What the remaining figures are read from, for the page to cite. */
const FILE_SOURCES = {
  languages: "LOCALES in apps/api/src/i18n.ts",
  tests: "app/docs/measured.json (assertions.total and assertions.suites)",
} as const;

const LANGUAGE_CAVEAT =
  "Seven of the eight are machine-translated and NOT native-reviewed: the strings exist, their quality is unverified.";

/** app/docs/measured.json, found by walking up from this module (source or dist), or null. */
function readMeasured(): unknown {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const p = join(dir, "docs", "measured.json");
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
    }
    const up = resolve(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const run = async <T>(text: string) => db.execute<T & Record<string, unknown>>(raw.raw(text)) as unknown as Promise<T[]>;

export async function computeImpact() {
  const t0 = Date.now();
  const [bookings, [timings], [sos], detections, cells, [coverage], [accounts]] = await Promise.all([
    run<BookingStatusRow>(SOURCES.bookings),
    run<TimingRow>(SOURCES.timings),
    run<SosRow>(SOURCES.sos),
    run<DetectionRow>(SOURCES.detections),
    run<CellRow>(SOURCES.cells),
    run<CoverageRow>(SOURCES.coverage),
    run<AccountsRow>(SOURCES.accounts),
  ]);
  const raksha = shapeRaksha(detections);
  const answer = {
    data: {
      asOf: new Date().toISOString(),
      source: "live database",
      bookings: shapeBookings(bookings, timings),
      sos: shapeSos(sos),
      raksha: { ...raksha, map: shapeCells(cells) },
      coverage: shapeCoverage(coverage),
      accounts: shapeAccounts(accounts),
      languages: { codes: [...LOCALES], count: LOCALES.length, caveat: LANGUAGE_CAVEAT },
      tests: testsFromMeasured(readMeasured()),
    },
    meta: {
      queryMs: Date.now() - t0,
      estimates: "None. Every figure is a count, a percentile of measured durations, or a value read from a file.",
      sources: { ...SOURCES, ...FILE_SOURCES },
    },
  };
  assertNoPii(answer);
  return answer;
}

const cache = new SingleFlightCache<Awaited<ReturnType<typeof computeImpact>>>(CACHE_TTL_MS);
/** Exported for test/impact.test.ts, which drives it past its ceiling. */
export const impactLimit = bucket("impact", RATE.max, RATE.windowMs);

export async function impactRoutes(app: FastifyInstance) {
  app.get("/v1/impact/summary", { preHandler: impactLimit }, async (_req, reply) => {
    const { value, hit, ageMs } = await cache.get(computeImpact);
    reply.header("x-impact-cache", hit ? "hit" : "miss");
    return {
      data: value.data,
      meta: {
        ...value.meta,
        cache: { hit, ageSeconds: Math.round(ageMs / 1000), ttlSeconds: CACHE_TTL_MS / 1000 },
        rateLimit: { max: RATE.max, windowSeconds: RATE.windowMs / 1000, per: "client address" },
      },
    };
  });
}
