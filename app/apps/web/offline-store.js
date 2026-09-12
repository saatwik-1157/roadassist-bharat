/**
 * RoadAssist — the off-grid store: local incidents and the sync journal.
 *
 * The one place anything survives a dead network. IndexedDB rather than
 * localStorage because this holds structured records that must survive a tab
 * crash mid-write, be queryable by index, and hold more than the ~5 MB a
 * synchronous string store gives us — and because a synchronous write on the
 * main thread is the last thing a phone should do while someone is standing at
 * the roadside.
 *
 * ── what is stored ────────────────────────────────────────────────────────
 * `incidents`  one row per off-grid SOS. Payload encrypted (see below).
 * `journal`    one row per operation waiting to reach the server. Carries the
 *              operation id, the idempotency key, retry count and next attempt.
 * `meta`       the wrapping key, the last-known map snapshot, timestamps.
 *
 * ── what is NOT stored ────────────────────────────────────────────────────
 * No access token, no refresh token, no payment credential, no card or UPI
 * handle, no server secret. Authentication happens at sync time from the
 * session the app already holds; this store never needs a credential to do its
 * job, so it never keeps one. That is a design constraint, not an oversight.
 *
 * ── what "encrypted" means here, exactly ──────────────────────────────────
 * Incident and journal payloads are encrypted with AES-GCM-256. The key is a
 * NON-EXTRACTABLE `CryptoKey` generated on this device and held in `meta`: the
 * browser will use it but will not hand its bytes to any script, so a copy of
 * the IndexedDB files taken off the device — a forensic dump, a shared or
 * stolen phone, a backup — does not yield the plaintext.
 *
 * It is NOT protection against script running on this origin, which can simply
 * ask this module to decrypt. Claiming otherwise would be the kind of
 * overstatement this project refuses to make elsewhere. Where WebCrypto is
 * unavailable (a plain-http origin that is not localhost) the store falls back
 * to plaintext and SAYS SO through `encryption()` — the UI surfaces it rather
 * than pretending.
 */

import { canonical, integrityDigest, backoffMs } from "./offline-engine.js";

const DB_NAME = "roadassist-offgrid";
const DB_VERSION = 1;
const STORE_INCIDENTS = "incidents";
const STORE_JOURNAL = "journal";
const STORE_META = "meta";

/** How long a SYNCED incident stays on the device before it is purged. */
export const RETENTION_AFTER_SYNC_MS = 24 * 60 * 60 * 1000;   // 24 hours
/** Give up automatic retries after this many attempts; the entry stays for a manual one. */
export const MAX_AUTO_RETRIES = 12;

export const STATUS_LOCAL = "STORED_LOCALLY";
export const STATUS_SYNCING = "SYNCING";
export const STATUS_SYNCED = "SYNCED";
export const STATUS_FAILED = "SYNC_RETRY_PENDING";

let dbPromise = null;
let cryptoKey = null;
/** The in-flight `resolveKey()`, so concurrent callers share one outcome. */
let keyPromise = null;
let encryptionAvailable = null;

/* ── plumbing ─────────────────────────────────────────────────────────────── */

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error || new Error("IndexedDB transaction aborted"));
  });
  return { t, done };
}

export function available() {
  return typeof indexedDB !== "undefined";
}

export function open() {
  if (dbPromise) return dbPromise;
  if (!available()) return Promise.reject(new Error("This browser has no IndexedDB — off-grid storage is unavailable."));

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
        const s = db.createObjectStore(STORE_INCIDENTS, { keyPath: "incidentId" });
        s.createIndex("status", "status");
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
        const j = db.createObjectStore(STORE_JOURNAL, { keyPath: "opId" });
        j.createIndex("status", "status");
        j.createIndex("nextAttemptAt", "nextAttemptAt");
        j.createIndex("incidentId", "incidentId");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "k" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open the off-grid database"));
    req.onblocked = () => reject(new Error("The off-grid database is locked by another tab"));
  });
  return dbPromise;
}

async function metaGet(key) {
  const db = await open();
  const { t } = tx(db, [STORE_META], "readonly");
  const row = await idbRequest(t.objectStore(STORE_META).get(key));
  return row ? row.v : undefined;
}

async function metaPut(key, value) {
  const db = await open();
  const { t, done } = tx(db, [STORE_META], "readwrite");
  t.objectStore(STORE_META).put({ k: key, v: value });
  await done;
  return value;
}

/**
 * Write only if nothing is there, and return whoever won.
 *
 * The read and the conditional write are the same readwrite transaction, so two
 * tabs racing to create the device key cannot both win. The `await` between them
 * is safe specifically because `idbRequest` resolves inside `onsuccess`: the
 * continuation runs on the microtask checkpoint of that event, while the
 * transaction is still active. Awaiting anything else here — a fetch, a
 * `generateKey` — would let the transaction auto-close and the put would throw.
 */
async function metaPutIfAbsent(key, value) {
  const db = await open();
  const { t, done } = tx(db, [STORE_META], "readwrite");
  const store = t.objectStore(STORE_META);
  const row = await idbRequest(store.get(key));
  if (row) { await done; return row.v; }
  store.put({ k: key, v: value });
  await done;
  return value;
}

/* ── encryption at rest ───────────────────────────────────────────────────── */

function subtle() {
  return globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto.subtle : null;
}

/**
 * The device key: generated once, non-extractable, stored as a CryptoKey.
 *
 * IndexedDB can hold a live `CryptoKey` handle, so the key never exists as
 * bytes in JavaScript at all — not at generation, not at use, not in a backup
 * of this store. That is the whole reason to use IndexedDB rather than
 * localStorage for it.
 */
async function getKey() {
  if (cryptoKey) return cryptoKey;
  // One resolution per page, shared by every concurrent caller.
  //
  // Without this, two seals that start before either finishes each find no key,
  // each generate one, and the second overwrites the first — leaving whatever
  // was sealed with the loser permanently unreadable. It is reachable: the
  // off-grid diagnosis journals itself WITHOUT being awaited (app.html), so
  // diagnosing in a dead zone and then tapping SOS is exactly the sequence that
  // races, and the record that loses can be the SOS incident itself.
  if (!keyPromise) keyPromise = resolveKey();
  return keyPromise;
}

async function resolveKey() {
  const s = subtle();
  if (!s) { encryptionAvailable = false; return null; }
  try {
    const existing = await metaGet("cryptoKey");
    if (existing) { cryptoKey = existing; encryptionAvailable = true; return cryptoKey; }
    // Generate first, then claim the slot: `generateKey` cannot be awaited
    // inside the transaction. If another tab got there first, metaPutIfAbsent
    // hands back THEIR key and this one is discarded — which is the point.
    const candidate = await s.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    cryptoKey = await metaPutIfAbsent("cryptoKey", candidate);
    encryptionAvailable = true;
    return cryptoKey;
  } catch {
    // Some browsers refuse to structured-clone a CryptoKey in private mode.
    encryptionAvailable = false;
    return null;
  }
}

/** Whether payloads on this device are actually encrypted. Surfaced in the UI. */
export async function encryption() {
  await getKey();
  return {
    encrypted: encryptionAvailable === true,
    algorithm: encryptionAvailable === true ? "AES-GCM-256 (non-extractable device key)" : null,
    reason: encryptionAvailable === true
      ? null
      : subtle()
        ? "This browser would not store a non-extractable key — payloads are stored unencrypted."
        : "WebCrypto is unavailable on this origin (it needs HTTPS or localhost) — payloads are stored unencrypted.",
  };
}

async function seal(value) {
  const digest = await integrityDigest(value);
  const key = await getKey();
  const plaintext = JSON.stringify(canonical(value));
  if (!key) return { encrypted: false, body: plaintext, digest };
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext),
  );
  return { encrypted: true, iv, cipher, digest };
}

async function unseal(sealed) {
  if (!sealed) return null;
  if (!sealed.encrypted) return JSON.parse(sealed.body);
  const key = await getKey();
  if (!key) throw new Error("The device key for this record is gone — it cannot be read.");
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: sealed.iv }, key, sealed.cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ── incidents ────────────────────────────────────────────────────────────── */

/**
 * Write an off-grid incident and the journal entry that will carry it.
 *
 * Both land in ONE transaction. An incident stored without its journal entry
 * would sit on the device forever with nothing scheduled to send it, and a
 * journal entry without its incident would send an empty payload — so either
 * both are written or neither is.
 */
export async function createIncident(record) {
  const db = await open();
  const now = Date.now();
  const sealed = await seal(record.payload);

  const incident = {
    incidentId: record.incidentId,
    opId: record.opId,
    createdAt: now,
    occurredAt: record.payload.occurredAt || new Date(now).toISOString(),
    emergencyType: record.payload.emergencyType || "unknown",
    status: STATUS_LOCAL,
    syncedAt: null,
    serverId: null,
    lastError: null,
    // A copy of the coordinates outside the sealed body, so the incident screen
    // can render without a decrypt on every paint. Nothing here identifies a
    // person; everything that does stays inside the sealed payload.
    lat: record.payload.lat ?? null,
    lng: record.payload.lng ?? null,
    accuracyM: record.payload.accuracyM ?? null,
    sealed,
  };

  const entry = {
    opId: record.opId,
    idempotencyKey: record.opId,
    incidentId: record.incidentId,
    type: record.type || "sos.offgrid",
    createdAt: now,
    ts: incident.occurredAt,
    status: STATUS_LOCAL,
    retryCount: 0,
    nextAttemptAt: 0,           // eligible immediately
    lastError: null,
    digest: sealed.digest,
    sealed,
  };

  const { t, done } = tx(db, [STORE_INCIDENTS, STORE_JOURNAL], "readwrite");
  t.objectStore(STORE_INCIDENTS).put(incident);
  t.objectStore(STORE_JOURNAL).put(entry);
  await done;
  return incident;
}

/**
 * Correct a stored incident that has not yet left the device.
 *
 * The one field people get wrong under stress is the emergency type — SOS fires
 * with a safe default so the incident exists in under a second, and the type is
 * refined a moment later on the off-grid screen. Rewriting the record (same
 * incident id, same operation id, re-sealed, re-digested) is safe precisely
 * because nothing has been sent: the idempotency key is still unused, so there
 * is no server-side state to contradict.
 *
 * Refusing once the record is SYNCING or SYNCED is the whole point of the
 * guard. Editing a payload the server may already hold would leave the device
 * and the platform disagreeing about the same incident, with the digest as
 * evidence of a discrepancy nobody could resolve.
 */
export async function reviseIncident(incidentId, patch) {
  const row = await getIncident(incidentId);
  if (!row) return null;
  if (row.status !== STATUS_LOCAL && row.status !== STATUS_FAILED) return null;
  const payload = Object.assign({}, await unseal(row.sealed), patch);
  return createIncident({ incidentId, opId: row.opId, type: "sos.offgrid", payload });
}

/**
 * Withdraw an incident that never left the device — a false alarm.
 *
 * Refused once the record has been sent, for the same reason `reviseIncident`
 * is: the platform may already hold it, and the cancellation has to travel
 * through POST /v1/sos/:id/cancel so it is recorded rather than silently
 * vanishing. A false alarm is data — ADR-0005 feeds it to the false-positive
 * dataset — so it is never simply deleted from both sides.
 */
export async function discardIncident(incidentId) {
  const row = await getIncident(incidentId);
  if (!row) return false;
  if (row.status === STATUS_SYNCING || row.status === STATUS_SYNCED) return false;
  const db = await open();
  const { t, done } = tx(db, [STORE_INCIDENTS, STORE_JOURNAL], "readwrite");
  t.objectStore(STORE_INCIDENTS).delete(incidentId);
  if (row.opId) t.objectStore(STORE_JOURNAL).delete(row.opId);
  await done;
  return true;
}

/** Append a journal entry that is not an incident — a local diagnosis, say. */
export async function journalOperation(record) {
  const db = await open();
  const now = Date.now();
  const sealed = await seal(record.payload);
  const entry = {
    opId: record.opId,
    idempotencyKey: record.opId,
    incidentId: record.incidentId || null,
    type: record.type,
    createdAt: now,
    ts: record.ts || new Date(now).toISOString(),
    status: STATUS_LOCAL,
    retryCount: 0,
    nextAttemptAt: 0,
    lastError: null,
    digest: sealed.digest,
    sealed,
  };
  const { t, done } = tx(db, [STORE_JOURNAL], "readwrite");
  t.objectStore(STORE_JOURNAL).put(entry);
  await done;
  return entry;
}

export async function listIncidents() {
  const db = await open();
  const { t } = tx(db, [STORE_INCIDENTS], "readonly");
  const rows = await idbRequest(t.objectStore(STORE_INCIDENTS).getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getIncident(incidentId) {
  const db = await open();
  const { t } = tx(db, [STORE_INCIDENTS], "readonly");
  return idbRequest(t.objectStore(STORE_INCIDENTS).get(incidentId));
}

/** The incident with its payload decrypted — the only path that decrypts. */
export async function readIncident(incidentId) {
  const row = await getIncident(incidentId);
  if (!row) return null;
  return Object.assign({}, row, { payload: await unseal(row.sealed) });
}

/* ── the journal ──────────────────────────────────────────────────────────── */

/**
 * Entries eligible to be sent right now: never synced, and past their backoff.
 *
 * Ordered oldest-first so an incident raised twenty minutes ago reaches dispatch
 * before one raised thirty seconds ago.
 */
export async function dueEntries(now) {
  const at = typeof now === "number" ? now : Date.now();
  const db = await open();
  const { t } = tx(db, [STORE_JOURNAL], "readonly");
  const rows = await idbRequest(t.objectStore(STORE_JOURNAL).getAll());
  return rows
    .filter((r) => r.status !== STATUS_SYNCED && (r.nextAttemptAt || 0) <= at)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function allEntries() {
  const db = await open();
  const { t } = tx(db, [STORE_JOURNAL], "readonly");
  const rows = await idbRequest(t.objectStore(STORE_JOURNAL).getAll());
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/** The decrypted payload for one journal entry, ready to put on the wire. */
export async function entryPayload(entry) {
  return unseal(entry.sealed);
}

async function patch(store, key, fields) {
  const db = await open();
  const { t, done } = tx(db, [store], "readwrite");
  const os = t.objectStore(store);
  const row = await idbRequest(os.get(key));
  if (!row) { await done; return null; }
  const next = Object.assign({}, row, fields);
  os.put(next);
  await done;
  return next;
}

export function markSyncing(opId) {
  return patch(STORE_JOURNAL, opId, { status: STATUS_SYNCING });
}

/**
 * Record a successful sync.
 *
 * The journal entry is deleted — it exists only to describe work still to do —
 * while the incident is KEPT and marked SYNCED, because the person who raised
 * it should still be able to see it and read back its reference. It is purged
 * later by `purge()`, on the retention clock.
 */
export async function markSynced(opId, serverId) {
  const db = await open();
  const entry = await patch(STORE_JOURNAL, opId, { status: STATUS_SYNCED });
  const { t, done } = tx(db, [STORE_INCIDENTS, STORE_JOURNAL], "readwrite");
  t.objectStore(STORE_JOURNAL).delete(opId);
  if (entry && entry.incidentId) {
    const os = t.objectStore(STORE_INCIDENTS);
    const inc = await idbRequest(os.get(entry.incidentId));
    if (inc) {
      os.put(Object.assign({}, inc, {
        status: STATUS_SYNCED, syncedAt: Date.now(), serverId: serverId || null, lastError: null,
      }));
    }
  }
  await done;
  return entry;
}

/**
 * Record a failed attempt and schedule the next one.
 *
 * The entry is never dropped. Past MAX_AUTO_RETRIES the automatic schedule
 * stops, but the record stays and "Sync now" still sends it — losing somebody's
 * emergency because the twelfth retry failed is not an acceptable outcome.
 */
export async function markFailed(opId, message, now) {
  const at = typeof now === "number" ? now : Date.now();
  const db = await open();
  const { t, done } = tx(db, [STORE_JOURNAL, STORE_INCIDENTS], "readwrite");
  const os = t.objectStore(STORE_JOURNAL);
  const row = await idbRequest(os.get(opId));
  if (!row) { await done; return null; }
  const retryCount = (row.retryCount || 0) + 1;
  const next = Object.assign({}, row, {
    status: STATUS_FAILED,
    retryCount,
    lastError: String(message || "unknown error").slice(0, 300),
    nextAttemptAt: retryCount > MAX_AUTO_RETRIES ? Infinity : at + backoffMs(retryCount),
  });
  os.put(next);
  if (row.incidentId) {
    const is = t.objectStore(STORE_INCIDENTS);
    const inc = await idbRequest(is.get(row.incidentId));
    if (inc && inc.status !== STATUS_SYNCED) {
      is.put(Object.assign({}, inc, { status: STATUS_FAILED, lastError: next.lastError }));
    }
  }
  await done;
  return next;
}

/* ── last-known cache (map, services) ─────────────────────────────────────── */

/**
 * The last snapshot of live data, kept so the map can show SOMETHING offline.
 *
 * Deliberately not encrypted: it is public map data — mechanic pins, responder
 * units, hazard markers — that the server serves to any signed-in user. Sealing
 * it would cost a decrypt on every map paint and protect nothing.
 */
export async function putSnapshot(key, data) {
  return metaPut("snapshot:" + key, { at: Date.now(), data });
}

export async function getSnapshot(key) {
  const row = await metaGet("snapshot:" + key);
  return row || null;
}

export function setLastOnlineAt(at) { return metaPut("lastOnlineAt", at || Date.now()); }
export function getLastOnlineAt() { return metaGet("lastOnlineAt"); }

/* ── retention ────────────────────────────────────────────────────────────── */

/**
 * Delete what no longer needs to be here.
 *
 * Only SYNCED incidents past the retention window are removed: the server holds
 * them now, so the device copy is a duplicate of somebody's medical-adjacent
 * emergency data sitting on a phone. Anything unsynced is untouchable at any
 * age — the whole promise of the feature is that it is never lost.
 */
export async function purge(now, retentionMs) {
  const at = typeof now === "number" ? now : Date.now();
  const keep = typeof retentionMs === "number" ? retentionMs : RETENTION_AFTER_SYNC_MS;
  const db = await open();
  const { t, done } = tx(db, [STORE_INCIDENTS], "readwrite");
  const os = t.objectStore(STORE_INCIDENTS);
  const rows = await idbRequest(os.getAll());
  let removed = 0;
  for (const r of rows) {
    if (r.status === STATUS_SYNCED && r.syncedAt && at - r.syncedAt > keep) {
      os.delete(r.incidentId);
      removed++;
    }
  }
  await done;
  return removed;
}

/** Counts for the badge and the off-grid screen. */
export async function stats() {
  const [incidents, entries] = await Promise.all([listIncidents(), allEntries()]);
  return {
    incidents: incidents.length,
    pendingIncidents: incidents.filter((i) => i.status !== STATUS_SYNCED).length,
    syncedIncidents: incidents.filter((i) => i.status === STATUS_SYNCED).length,
    pendingOperations: entries.length,
    oldestPendingAt: entries.length ? entries[0].createdAt : null,
  };
}

/** Used by the browser journey suite to start each run from a known state. */
export async function clearAll() {
  const db = await open();
  const { t, done } = tx(db, [STORE_INCIDENTS, STORE_JOURNAL], "readwrite");
  t.objectStore(STORE_INCIDENTS).clear();
  t.objectStore(STORE_JOURNAL).clear();
  await done;
}

const api = {
  available, open, encryption,
  createIncident, reviseIncident, discardIncident, journalOperation,
  listIncidents, getIncident, readIncident,
  dueEntries, allEntries, entryPayload,
  markSyncing, markSynced, markFailed,
  putSnapshot, getSnapshot, setLastOnlineAt, getLastOnlineAt,
  purge, stats, clearAll,
  STATUS_LOCAL, STATUS_SYNCING, STATUS_SYNCED, STATUS_FAILED,
  RETENTION_AFTER_SYNC_MS, MAX_AUTO_RETRIES,
};
globalThis.RAStore = api;
export default api;
