/**
 * The Impact summary, as pure functions: what the public dashboard
 * (apps/web/impact.html) is allowed to say, and in what shape.
 *
 * routes/impact.ts runs the queries; everything here turns their rows into
 * the answer, so the counting, the labelling and the privacy rules are tested
 * without a database (test/impact.test.ts).
 *
 * ── the rules this module exists to hold ──────────────────────────────────
 *  1. Aggregates only. The answer carries counts, percentiles and coarse map
 *     cells - never an id, a name, a phone number or an exact position.
 *     assertNoPii() walks the finished answer and refuses it otherwise, so a
 *     careless new field fails closed rather than publishing.
 *  2. Every number comes from a query or a file. Nothing is projected,
 *     smoothed or estimated; a figure that cannot be computed is null.
 *  3. Provenance is stated, not implied. No table marks a seeded row with a
 *     column, so each block says how its split was DERIVED (see PROVENANCE),
 *     and the blocks with no derivable split are labelled DEMO DATA whole.
 */

/** Seconds the computed answer is reused for. The dashboard cannot hammer the DB. */
export const CACHE_TTL_MS = 45_000;

/**
 * Per-address ceiling on the public route. The page polls once a minute, so
 * this is sixty open pages behind one address (a venue NAT); the cache, not
 * this, is what protects the database.
 */
export const RATE = { max: 60, windowMs: 60_000 } as const;

/** Map cell size in degrees (~2.2 km north-south) and the fewest detections a drawn cell may hold. */
export const CELL_DEG = 0.02;
export const MIN_CELL_COUNT = 3;

/** "Area spanned" is the area within this many km of at least one verified mechanic. */
export const REACH_KM = 10;

export const DETECTION_CLASSES = ["pothole", "road_damage", "obstruction"] as const;
export const SEVERITIES = [1, 2, 3, 4, 5] as const;

/**
 * The words each block is labelled with. Written once so the API, the page
 * and the tests say the same thing.
 */
export const PROVENANCE = {
  bookings:
    "DEMO DATA. No column marks a seeded booking. seed.ts writes bookings directly and never writes a " +
    "booking_events row; every API path (POST /v1/bookings, the SMS BOOK command) writes one in the same " +
    "transaction. viaApi / seededDirect is derived from that, and both halves are demo accounts here.",
  timings:
    "From booking_events only, so only bookings that went through the API state machine count. seed.ts " +
    "sets assigned_at = requested_at, which would read as 0 s; those rows are excluded, not averaged in. " +
    "Arrival is the mechanic's 'arrive' command (ON_SITE), not a GPS fix.",
  sos:
    "DEMO DATA. No column marks a seeded incident. seed.ts writes 120 incidents with no incident_signals " +
    "row; every API path (POST /v1/sos, POST /v1/sos/offline-sync, the SMS SOS command) writes one. " +
    "viaApi / seededDirect is derived from that.",
  raksha:
    "Device detections: edge_devices.simulated marks the hardware. Every device on this build is " +
    "SIMULATED, so every device position is SIMULATED (placed along NH-48; RDD2022 images carry no GPS). " +
    "The demo detections are real YOLO11 output on real road photos; only their positions are placed.",
  citizenReports:
    "Submitted through the app (raw.source = 'citizen'); the position is the reporting phone's own GPS fix. " +
    "On this deployment every account is a demo account.",
  coverage:
    "DEMO DATA. Mechanics and responders are seeded: 'Demo Fleet (simulated)' partner and '(simulated)' " +
    "responder names mark seed-demo-fleet.ts rows; seed.ts's 600 mechanics and 32 responders carry no marker.",
  accounts:
    "Citizen accounts in +91 70000 00000-09999 are the seed's synthetic range (domain/demo-numbers.ts).",
} as const;

// ── raw rows, as routes/impact.ts selects them ───────────────────────────────
export interface BookingStatusRow { status: string; n: number; via_api: number; created_offline: number }
export interface TimingRow {
  n_assign: number; assign_p50: number | null; assign_p90: number | null;
  n_arrive: number; arrive_p50: number | null; arrive_p90: number | null;
}
export interface SosRow {
  raised: number; confirmed: number; resolved: number; cancelled: number; awaiting: number; active: number;
  offline_synced: number; sms: number; crash_detected: number; via_api: number;
  offline_p50: number | null; offline_p90: number | null;
}
export interface DetectionRow {
  type: string; severity: number; status: string; citizen: boolean; simulated: boolean; n: number;
}
export interface CellRow { lat: number; lng: number; n: number; max_severity: number; citizen: number }
export interface CoverageRow {
  mechanics_total: number; mechanics_verified: number; mechanics_demo_fleet: number;
  zones: number; states: number; reach_km2: number | null;
  responders_total: number; responders_active: number; responders_labelled_simulated: number;
  devices_total: number; devices_simulated: number; segments: number; raksha_incidents: number;
}
export interface AccountsRow { citizens: number; citizens_seed_range: number }

// ── shaping ──────────────────────────────────────────────────────────────────

const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
/** Seconds to one decimal, or null when there were no samples. Never 0 for "unknown". */
const secs = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

/** Booking statuses that only exist once a mechanic accepted the job. */
const MATCHED = new Set(["ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED", "COMPLETED", "PAID"]);

export function shapeBookings(rows: BookingStatusRow[], t: TimingRow | undefined) {
  const byStatus: Record<string, number> = {};
  let total = 0, viaApi = 0, createdOffline = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + int(r.n);
    total += int(r.n); viaApi += int(r.via_api); createdOffline += int(r.created_offline);
  }
  const sum = (...s: string[]) => s.reduce((a, k) => a + (byStatus[k] ?? 0), 0);
  // DRAFT is a request still being written; it was never sent to anyone.
  const requests = total - sum("DRAFT");
  const matched = Object.entries(byStatus).filter(([k]) => MATCHED.has(k)).reduce((a, [, v]) => a + v, 0);
  return {
    label: "DEMO DATA",
    requests,
    matched,
    completed: sum("COMPLETED", "PAID"),
    cancelled: sum("CANCELLED"),
    noSupply: sum("NO_SUPPLY"),
    open: sum("REQUESTED", "MATCHING", "ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "AWAITING_PARTS", "ESCALATED"),
    byStatus,
    createdOffline,
    provenance: { viaApi, seededDirect: total - viaApi, note: PROVENANCE.bookings },
    timings: {
      timeToAssign: { n: int(t?.n_assign), medianSeconds: secs(t?.assign_p50), p90Seconds: secs(t?.assign_p90) },
      timeToArrive: { n: int(t?.n_arrive), medianSeconds: secs(t?.arrive_p50), p90Seconds: secs(t?.arrive_p90) },
      basis: PROVENANCE.timings,
    },
  };
}

export function shapeSos(r: SosRow | undefined) {
  const raised = int(r?.raised);
  return {
    label: "DEMO DATA",
    raised,
    confirmed: int(r?.confirmed),
    resolved: int(r?.resolved),
    cancelled: int(r?.cancelled),
    awaitingConfirmation: int(r?.awaiting),
    active: int(r?.active),
    raisedOfflineThenSynced: int(r?.offline_synced),
    bySms: int(r?.sms),
    crashDetected: int(r?.crash_detected),
    offlineDelay: { n: int(r?.offline_synced), medianSeconds: secs(r?.offline_p50), p90Seconds: secs(r?.offline_p90) },
    provenance: { viaApi: int(r?.via_api), seededDirect: raised - int(r?.via_api), note: PROVENANCE.sos },
  };
}

type Funnel = { pending: number; verified: number; dismissed: number; repairScheduled: number; repaired: number; closed: number };
const emptyFunnel = (): Funnel => ({ pending: 0, verified: 0, dismissed: 0, repairScheduled: 0, repaired: 0, closed: 0 });

/**
 * The review funnel. "verified" counts every detection that PASSED review,
 * including those that moved on to repair or closure (CLOSED is reachable only
 * from VERIFIED or REPAIRED); the later stages are also given on their own.
 */
function addToFunnel(f: Funnel, status: string, n: number) {
  switch (status) {
    case "DETECTED": f.pending += n; break;
    case "REJECTED": f.dismissed += n; break;
    case "VERIFIED": f.verified += n; break;
    case "REPAIR_SCHEDULED": f.verified += n; f.repairScheduled += n; break;
    case "REPAIRED": f.verified += n; f.repaired += n; break;
    case "CLOSED": f.verified += n; f.closed += n; break;
    default: break;
  }
}

const zeroes = <K extends string | number>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function shapeRaksha(rows: DetectionRow[]) {
  const device = {
    total: 0,
    byClass: zeroes(DETECTION_CLASSES),
    bySeverity: zeroes(SEVERITIES),
    byClassSeverity: Object.fromEntries(DETECTION_CLASSES.map((c) => [c, zeroes(SEVERITIES)])) as Record<string, Record<number, number>>,
    funnel: emptyFunnel(),
    positions: { simulated: 0, deviceGps: 0 },
  };
  const citizen = {
    total: 0,
    byClass: zeroes(DETECTION_CLASSES),
    bySeverity: zeroes(SEVERITIES),
    funnel: emptyFunnel(),
  };
  for (const r of rows) {
    const n = int(r.n);
    const sev = int(r.severity);
    const into = r.citizen ? citizen : device;
    into.total += n;
    if (r.type in into.byClass) into.byClass[r.type as (typeof DETECTION_CLASSES)[number]] += n;
    if (sev in into.bySeverity) into.bySeverity[sev as (typeof SEVERITIES)[number]] += n;
    addToFunnel(into.funnel, r.status, n);
    if (!r.citizen) {
      if (device.byClassSeverity[r.type] && sev in device.byClassSeverity[r.type]) device.byClassSeverity[r.type][sev] += n;
      // Unknown counts as simulated, as in domain/report-position.ts.
      if (r.simulated === false) device.positions.deviceGps += n; else device.positions.simulated += n;
    }
  }
  return {
    detections: { label: device.positions.deviceGps === 0 ? "SIMULATED POSITIONS" : "MIXED", ...device, note: PROVENANCE.raksha },
    citizenReports: { label: "SUBMITTED IN APP", ...citizen, note: PROVENANCE.citizenReports },
  };
}

/**
 * The map: detections counted into CELL_DEG cells, each drawn at its centre.
 * A cell with fewer than `min` detections is not drawn - a single citizen
 * report would otherwise place one person at one time - and what was withheld
 * is counted, so the map never silently disagrees with the totals.
 */
export function shapeCells(rows: CellRow[], min = MIN_CELL_COUNT) {
  const cells = [];
  let suppressedCells = 0, suppressedDetections = 0;
  for (const r of rows) {
    const n = int(r.n);
    if (n < min) { suppressedCells++; suppressedDetections += n; continue; }
    // The citizen share of a drawn cell is held to the same floor. Two device
    // detections and one report made a drawn cell of 3 that said "1 citizen
    // report", which placed that one person in a 2 km square: exactly what the
    // floor exists to prevent. Below it the share is null ("fewer than min"),
    // and 0 is null too, so a null says nothing about whether anyone reported.
    const citizen = int(r.citizen);
    cells.push({
      lat: Math.round(Number(r.lat) * 1000) / 1000,
      lng: Math.round(Number(r.lng) * 1000) / 1000,
      count: n, maxSeverity: int(r.max_severity), citizen: citizen >= min ? citizen : null,
    });
  }
  cells.sort((a, b) => b.count - a.count || a.lat - b.lat || a.lng - b.lng);
  return {
    cellDegrees: CELL_DEG, minCount: min, cells,
    drawn: cells.reduce((a, c) => a + c.count, 0),
    suppressed: { cells: suppressedCells, detections: suppressedDetections },
  };
}

export function shapeCoverage(r: CoverageRow | undefined) {
  return {
    label: "DEMO DATA",
    mechanics: {
      verified: int(r?.mechanics_verified), total: int(r?.mechanics_total),
      demoFleet: int(r?.mechanics_demo_fleet),
    },
    responders: {
      active: int(r?.responders_active), total: int(r?.responders_total),
      labelledSimulated: int(r?.responders_labelled_simulated),
    },
    area: {
      serviceZones: int(r?.zones), states: int(r?.states),
      reachKm: REACH_KM,
      reachAreaKm2: r?.reach_km2 == null ? null : int(r.reach_km2),
      definition: `Land and water within ${REACH_KM} km (straight line) of at least one verified mechanic's last known position.`,
    },
    raksha: {
      devices: int(r?.devices_total), simulatedDevices: int(r?.devices_simulated),
      segments: int(r?.segments), incidentSignals: int(r?.raksha_incidents),
    },
    note: PROVENANCE.coverage,
  };
}

export function shapeAccounts(r: AccountsRow | undefined) {
  return { citizens: int(r?.citizens), inSeedRange: int(r?.citizens_seed_range), note: PROVENANCE.accounts };
}

// ── the test count, from app/docs/measured.json ──────────────────────────────

/**
 * The suite sizes as measured.json records them, or null if the file is
 * missing or not the shape expected. The six suites must sum to the total;
 * when they do not, `consistent` says so rather than the answer picking one.
 */
export function testsFromMeasured(json: unknown) {
  const a = (json as { assertions?: unknown } | null)?.assertions as
    | { total?: unknown; suites?: Record<string, unknown>; notExecuted?: Record<string, unknown> } | undefined;
  if (!a || typeof a.total !== "number" || !a.suites || typeof a.suites !== "object") return null;
  const suites: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.suites)) if (typeof v === "number") suites[k] = v;
  const sum = Object.values(suites).reduce((x, y) => x + y, 0);
  const j = json as { measuredOn?: unknown; measuredAgainst?: unknown };
  return {
    total: a.total,
    suites,
    consistent: sum === a.total,
    notExecuted: typeof a.notExecuted?.paymentSandbox === "number" ? { paymentSandbox: a.notExecuted.paymentSandbox } : {},
    measuredOn: typeof j.measuredOn === "string" ? j.measuredOn : null,
    measuredAgainst: typeof j.measuredAgainst === "string" ? j.measuredAgainst : null,
    source: "app/docs/measured.json",
  };
}

// ── privacy guard ────────────────────────────────────────────────────────────

/** Keys that would name, contact or locate a person, a vehicle or a row. */
export const PII_KEYS = new Set([
  "id", "userid", "user_id", "msisdn", "phone", "mobile", "fullname", "full_name", "name", "displayname",
  "display_name", "email", "address", "addresstext", "address_text", "reference", "registrationno",
  "registration_no", "vehicleid", "vehicle_id", "deviceid", "device_id", "mechanicid", "mechanic_id",
  "reportedby", "notes", "note_text", "symptoms", "imageref", "image_ref", "token", "ip",
]);
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const PHONE = /(?:\+91|\b91)?[6-9]\d{9}\b/;

/**
 * Every place in `value` that looks like personal data, as "path: reason".
 * Empty means clean. Strings under `skipValuesUnder` (the SQL shown as each
 * figure's source) are not scanned for phone-like digits; keys still are.
 */
export function findPii(value: unknown, path = "$", skipValuesUnder = "$.meta.sources"): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (PII_KEYS.has(k.toLowerCase())) out.push(`${p}.${k}: forbidden key`);
        walk(x, `${p}.${k}`);
      }
      return;
    }
    if (typeof v === "string" && !p.startsWith(skipValuesUnder)) {
      if (UUID.test(v)) out.push(`${p}: looks like a row id`);
      if (PHONE.test(v)) out.push(`${p}: looks like a phone number`);
    }
  };
  walk(value, path);
  return out;
}

export function assertNoPii(value: unknown): void {
  const found = findPii(value);
  if (found.length) throw new Error(`impact summary refused - it would publish personal data: ${found.slice(0, 5).join("; ")}`);
}

// ── the cache ────────────────────────────────────────────────────────────────

/**
 * One computed value, reused for `ttlMs`. Concurrent callers during a refresh
 * share the one in-flight computation (single flight), so a burst of page
 * loads costs one set of queries, not one per visitor. A failed computation is
 * not cached: the next caller tries again.
 *
 * In-process, like ratelimit.ts: behind N instances the database sees at most
 * N refreshes per TTL.
 */
export class SingleFlightCache<V> {
  private value: V | undefined;
  private at = -Infinity;
  private pending: Promise<V> | null = null;
  constructor(private ttlMs: number, private now: () => number = Date.now) {}

  async get(compute: () => Promise<V>): Promise<{ value: V; hit: boolean; ageMs: number }> {
    const t = this.now();
    if (this.value !== undefined && t - this.at < this.ttlMs) return { value: this.value, hit: true, ageMs: t - this.at };
    if (!this.pending) {
      this.pending = compute().then((v) => { this.value = v; this.at = this.now(); return v; })
        .finally(() => { this.pending = null; });
    }
    const value = await this.pending;
    return { value, hit: false, ageMs: Math.max(0, this.now() - this.at) };
  }

  /** Test seam. */
  clear() { this.value = undefined; this.at = -Infinity; }
}
