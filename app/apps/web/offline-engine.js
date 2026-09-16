/**
 * RoadAssist — the on-device engine.
 *
 * Everything in this file is a PURE function over its arguments: no network, no
 * storage, no DOM. That is what makes it the one piece of Off-Grid Mode that
 * can be unit-tested in Node (apps/api/test/offline-engine.test.ts) and shipped
 * to a phone unchanged.
 *
 * It holds four things:
 *
 *   1. `diagnose` — the local rules engine. It MIRRORS the server's
 *      `apps/api/src/domain/ai-rules.ts` table, and a CI test asserts the two
 *      agree across a corpus of inputs. A phone that diagnoses differently from
 *      the cloud is a phone that lies about what the cloud would have said, so
 *      divergence is a build failure rather than a footnote.
 *   2. `classifyConnectivity` — the ONLINE / LIMITED / OFFLINE decision.
 *   3. Identity and integrity: incident ids, operation ids, canonical hashing.
 *   4. `backoffMs` — the retry schedule the sync journal runs on.
 *
 * Loadable three ways on purpose: as an ES module in the browser, as an ES
 * module in Node, and (via the `globalThis` assignment at the foot) from the
 * classic script that app.html has always been.
 */

export const ENGINE_VERSION = "local-rules-1.0.0";

/* ═══ 1. local diagnosis ═══════════════════════════════════════════════════
   Mirror of apps/api/src/domain/ai-rules.ts. Keep the rule ORDER identical:
   ties are broken by position, so reordering changes answers.
   `safetyAction` is the one field the server table does not carry — offline
   there is nobody to ask, so the immediate do-not-do-this matters more.       */

export const RULES = [
  {
    cause: "Battery discharged or terminals loose",
    severity: 3, driveable: false, parts: ["jump starter", "battery terminal cleaner", "12V battery"],
    advice: "A jump start will usually get you moving. If it dies again within the hour the battery needs replacing.",
    safetyAction: "Do not repeatedly crank the starter — it flattens what charge is left and can overheat the motor. Switch off the lights and every accessory first.",
    keywords: ["not start", "won't start", "wont start", "no crank", "click", "dead battery", "battery", "lights dim"],
    dtc: ["B1318", "P0562"],
  },
  {
    cause: "Flat or punctured tyre",
    severity: 2, driveable: false, parts: ["puncture kit", "spare tyre", "inflator"],
    advice: "Do not drive on a flat — it destroys the rim. Stop well off the carriageway before changing it.",
    safetyAction: "Stop well off the carriageway on firm level ground, hazards on, and work from the side away from traffic.",
    keywords: ["flat", "puncture", "tyre", "tire", "wheel deflate", "air out"],
  },
  {
    cause: "Engine overheating — coolant loss or thermostat",
    severity: 5, driveable: false, parts: ["coolant", "radiator cap", "thermostat", "hose"],
    advice: "Stop immediately and let it cool for 30 minutes. Driving on will warp the head and turn this into an engine rebuild.",
    safetyAction: "Never open the radiator cap on a hot engine — the coolant is above boiling and under pressure. Stop, switch off, wait 30 minutes.",
    keywords: ["overheat", "temperature", "steam", "smoke from bonnet", "coolant", "hot engine"],
    dtc: ["P0217", "P0128"],
  },
  {
    cause: "Out of fuel",
    severity: 1, driveable: false, parts: ["5L fuel can"],
    advice: "Fuel delivery will have you moving in about half an hour. Diesel vehicles may also need bleeding.",
    safetyAction: "Do not walk along a highway carriageway to fetch fuel. Stay with the vehicle, hazards on, and wait for delivery.",
    keywords: ["fuel", "petrol", "diesel", "empty tank", "ran out"],
  },
  {
    cause: "Keys locked inside the vehicle",
    severity: 1, driveable: true, parts: ["lockout tool kit"],
    advice: "Do not break a window — a technician can open most vehicles without damage in a few minutes.",
    safetyAction: "If a child or an animal is shut inside in the heat, treat it as a medical emergency and break the glass furthest from them. Otherwise wait.",
    keywords: ["lock", "keys inside", "locked out", "key stuck"],
  },
  {
    cause: "Clutch or transmission fault",
    severity: 4, driveable: false, parts: ["clutch cable", "clutch plate", "transmission fluid"],
    advice: "Do not force the gearbox. This needs a workshop, so expect a tow rather than a roadside fix.",
    safetyAction: "Do not force a gear or ride the clutch to limp on — a partial engagement can lock a driven wheel at speed.",
    keywords: ["clutch", "gear", "transmission", "not engaging", "slipping"],
  },
  {
    cause: "Brake system fault",
    severity: 5, driveable: false, parts: ["brake fluid", "brake pads", "wheel speed sensor"],
    advice: "Do not drive. Brake faults do not get better on the way to the garage.",
    safetyAction: "Do not drive, not even slowly and not even downhill. Chock a wheel if you are standing on any slope.",
    keywords: ["brake", "abs", "spongy", "grinding", "squeal"],
    dtc: ["C0035"],
  },
  {
    cause: "Engine misfire",
    severity: 4, driveable: false, parts: ["spark plugs", "ignition coil", "fuel injector"],
    advice: "Continued driving with a misfire can destroy the catalytic converter. Get it looked at before moving on.",
    safetyAction: "Switch off rather than idling through it. Raw fuel reaching a hot catalytic converter is a fire risk.",
    keywords: ["misfire", "juddering", "shaking", "rough idle", "jerking", "loss of power"],
    dtc: ["P0300", "P0301"],
  },
  {
    cause: "EV traction battery or charging fault",
    severity: 4, driveable: false, parts: ["mobile charger", "HV diagnostic kit"],
    advice: "Do not attempt a jump start on a high-voltage system. A technician with EV certification is required.",
    safetyAction: "Do not open any orange-cabled compartment and do not jump-start the high-voltage pack. If you see or smell smoke, move everyone at least 15 m away.",
    keywords: ["ev", "charge", "charging", "range", "battery percent", "not charging", "state of charge"],
  },
];

export const GENERIC = {
  cause: "Cause not determined from the description",
  confidence: 0.25,
  severity: 3,
  driveable: false,
  parts: ["general diagnostic kit"],
  advice: "There is not enough detail to be confident. A technician will diagnose on site — please stay with the vehicle.",
  safetyAction: "Stay with the vehicle, off the carriageway, hazards on. Do not attempt a repair you are unsure of at the roadside.",
};

/** Score a rule against free text and any scanned trouble codes. */
function score(rule, text, dtcs) {
  let hits = 0;
  for (const k of rule.keywords) if (text.includes(k)) hits++;
  const dtcHit = rule.dtc ? rule.dtc.some((d) => dtcs.includes(d.toUpperCase())) : false;
  if (!hits && !dtcHit) return 0;
  // A scanned code is hard evidence; free text is soft. Weight accordingly.
  const textScore = Math.min(hits / 2, 1) * 0.55;
  return dtcHit ? Math.min(0.95, 0.7 + textScore * 0.4) : Math.min(0.8, 0.35 + textScore);
}

/**
 * Diagnose locally.
 *
 * Returns the same six fields the server returns, so a caller cannot tell the
 * two apart by shape — plus three the server has no need for: the engine that
 * produced it, the safety action, and the runners-up. Offline there is no
 * second opinion to ask for, so the alternatives ARE the second opinion, and
 * listing them is more honest than presenting one guess as a finding.
 */
export function diagnose(input) {
  const text = String((input && input.symptoms) || "").toLowerCase();
  const dtcs = ((input && input.dtcCodes) || []).map((d) => String(d).toUpperCase());
  const stamp = { engine: ENGINE_VERSION, local: true };

  if (!text && dtcs.length === 0) return Object.assign({}, GENERIC, stamp, { alternatives: [] });

  const ranked = RULES
    .map((rule) => ({ rule, s: score(rule, text, dtcs) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);

  if (ranked.length === 0) return Object.assign({}, GENERIC, stamp, { alternatives: [] });

  const top = ranked[0];
  return Object.assign({
    cause: top.rule.cause,
    confidence: Number(top.s.toFixed(2)),
    severity: top.rule.severity,
    driveable: top.rule.driveable,
    parts: top.rule.parts,
    advice: top.rule.advice,
    safetyAction: top.rule.safetyAction,
    // Runners-up, so "possible causes" is a list rather than a single claim.
    alternatives: ranked.slice(1, 4).map((r) => ({
      cause: r.rule.cause, confidence: Number(r.s.toFixed(2)),
    })),
  }, stamp);
}

/* ═══ 2. connectivity classification ═══════════════════════════════════════ */

export const ONLINE = "ONLINE";
export const LIMITED = "LIMITED";
export const OFFLINE = "OFFLINE";

/** A probe slower than this is a working-but-unusable connection. */
export const LIMITED_RTT_MS = 2500;
/** Consecutive request failures that demote ONLINE to LIMITED. */
export const LIMITED_FAILURES = 1;
/** …and the count at which we stop claiming there is a connection at all. */
export const OFFLINE_FAILURES = 3;

/**
 * Decide the connectivity tier from evidence, not from optimism.
 *
 * `navigator.onLine` is famously weak: it reports whether the OS has *a*
 * network interface, so a phone attached to a cell with no backhaul — the exact
 * situation on most of a rural Indian highway — reports true. So it is one
 * input among several, and it can only ever make the verdict worse:
 *
 *   navigator.onLine === false      → OFFLINE, always. The OS is certain.
 *   the last probe failed           → LIMITED, then OFFLINE once failures pile up
 *   probe succeeded but was slow    → LIMITED
 *   Network Information says 2g     → LIMITED
 *   failures but no probe result    → LIMITED, then OFFLINE
 *
 * The asymmetry is deliberate and matches the emergency rule elsewhere in this
 * codebase: under-claiming connectivity costs a queued request, over-claiming
 * it costs somebody who believes help was called.
 */
export function classifyConnectivity(signal) {
  const s = signal || {};
  if (s.navigatorOnLine === false) return OFFLINE;
  if (s.simulatedOffline === true) return OFFLINE;

  const failures = s.consecutiveFailures || 0;

  if (s.probeOk === false) {
    return failures >= OFFLINE_FAILURES ? OFFLINE : LIMITED;
  }

  if (s.probeOk === true) {
    if (typeof s.probeRttMs === "number" && s.probeRttMs >= LIMITED_RTT_MS) return LIMITED;
    // A probe that came back is hard evidence the path works, so a run of
    // unrelated request failures degrades it only as far as LIMITED.
    return failures >= OFFLINE_FAILURES ? LIMITED : ONLINE;
  }

  // No probe result yet — fall back to the failure count and the radio's report.
  if (failures >= OFFLINE_FAILURES) return OFFLINE;
  if (failures >= LIMITED_FAILURES) return LIMITED;
  if (s.effectiveType === "slow-2g" || s.effectiveType === "2g") return LIMITED;
  if (s.saveData === true) return LIMITED;
  return ONLINE;
}

/* ═══ 3. identity and integrity ════════════════════════════════════════════ */

/** Crockford base32 minus the letters that read as digits on a cracked screen. */
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** Characters after the `RA-` prefix. The server's pattern hard-codes the same. */
const ID_LENGTH = 6;

function randomBytes(n) {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && c.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * A local incident reference: RA-XXXXXX.
 *
 * Short enough to read aloud over a borrowed phone or a police radio, which is
 * the entire point — this id may be the only handle on the incident until the
 * device finds signal again. 30^6 ≈ 7.3e8 values from the CSPRNG; the server's
 * uniqueness constraint is what actually guarantees no collision.
 */
export function newIncidentId() {
  // Rejection sampling rather than a bare `% 30`.
  //
  // 256 is not a multiple of 30: a plain modulo maps 16 of the 30 letters to
  // nine byte values each and the other 14 to eight, making the first half of
  // the alphabet 12.5% likelier. That is a biased identifier, and the bias eats
  // the keyspace the paragraph above rests on. Discarding the 16 byte values
  // above the last whole multiple costs a few extra draws and makes every
  // letter exactly equally likely.
  const LIMIT = 256 - (256 % ID_ALPHABET.length);   // 240
  let s = "";
  while (s.length < ID_LENGTH) {
    for (const b of randomBytes(ID_LENGTH)) {
      if (b >= LIMIT) continue;                     // would skew the alphabet
      s += ID_ALPHABET[b % ID_ALPHABET.length];
      if (s.length === ID_LENGTH) break;
    }
  }
  return "RA-" + s;
}

/** A journal operation id, which doubles as the server-side idempotency key. */
export function newOpId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return "ogs-" + c.randomUUID();
  const b = randomBytes(16);
  let hex = "";
  for (let i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, "0");
  return "ogs-" + hex;
}

/** Sorts object keys recursively so a hash does not depend on key order. */
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    const keys = Object.keys(v).sort();
    for (let i = 0; i < keys.length; i++) out[keys[i]] = canonical(v[keys[i]]);
    return out;
  }
  return v;
}

/**
 * SHA-256 over the canonical JSON of a value, hex encoded.
 *
 * Travels with every journal entry and every synced incident. It is an
 * INTEGRITY check, not an authenticity one: it proves the payload the server
 * received is the payload the device wrote, which catches a truncated or
 * half-written IndexedDB record. It proves nothing about who wrote it — that is
 * the access token's job, and the server re-validates every field regardless.
 * Claiming more would be security theatre.
 */
export async function integrityDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle) {
    const buf = await subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, "0");
    return hex;
  }
  // A runtime without WebCrypto exposed — same algorithm, Node's implementation.
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

/* ═══ 4. retry schedule ════════════════════════════════════════════════════ */

export const BACKOFF_BASE_MS = 5000;
export const BACKOFF_CAP_MS = 15 * 60 * 1000;   // 15 minutes

/**
 * Exponential backoff with full jitter.
 *
 * A convoy coming out of a tunnel puts every phone back online in the same
 * second. Without jitter they retry in lockstep, and a sync storm is exactly
 * what a platform handling emergencies cannot afford at the moment connectivity
 * returns. Full jitter — uniform over [0, exponential] — is what is used here.
 */
export function backoffMs(retryCount, rand) {
  const n = Math.max(0, retryCount | 0);
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, n));
  const r = typeof rand === "number" ? rand : Math.random();
  return Math.round(exp * r);
}

/* ── classic-script interop ────────────────────────────────────────────────
   app.html has always been one classic <script>. Exposing the module's surface
   on globalThis lets it use the engine without rewriting that whole file as a
   module, and costs nothing anywhere else. */
const api = {
  ENGINE_VERSION, RULES, GENERIC, diagnose,
  ONLINE, LIMITED, OFFLINE, classifyConnectivity,
  LIMITED_RTT_MS, LIMITED_FAILURES, OFFLINE_FAILURES,
  newIncidentId, newOpId, canonical, integrityDigest,
  backoffMs, BACKOFF_BASE_MS, BACKOFF_CAP_MS,
};
globalThis.RAEngine = api;
export default api;
