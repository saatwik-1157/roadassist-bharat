/**
 * RoadAssist — the connectivity manager.
 *
 * One authority on whether this device can reach the platform, so that every
 * surface says the same thing at the same moment. Before this, three different
 * places each formed their own opinion from `navigator.onLine` and disagreed.
 *
 * The tiers are the product's, not the browser's:
 *
 *   ONLINE    the cloud is reachable and answering promptly
 *   LIMITED   something is there, but it is failing or too slow to rely on
 *   OFFLINE   nothing is getting out
 *
 * The decision itself lives in `classifyConnectivity` in offline-engine.js,
 * which is pure and unit-tested. This file is only the plumbing that feeds it:
 * the radio's own report, the Network Information API where it exists, a cheap
 * server probe, and the running tally of request failures the app reports.
 *
 * The probe is `/v1/ping`, which touches no database. That is deliberate — it
 * measures the NETWORK, so a healthy path to a server with a sick database
 * reads as LIMITED (via /health) rather than OFFLINE, and the two failures stay
 * distinguishable.
 */

import { classifyConnectivity, ONLINE, LIMITED, OFFLINE } from "./offline-engine.js";

export { ONLINE, LIMITED, OFFLINE };

/** Probe cadence: relaxed when healthy, urgent when we want to know it came back. */
const PROBE_HEALTHY_MS = 45000;
const PROBE_DEGRADED_MS = 6000;
const PROBE_TIMEOUT_MS = 6000;

export class Connectivity extends EventTarget {
  constructor(options) {
    super();
    const o = options || {};
    this.base = o.base || "";
    this.probePath = o.probePath || "/v1/ping";
    this.tier = ONLINE;
    this.consecutiveFailures = 0;
    this.probeOk = null;
    this.probeRttMs = null;
    this.lastProbeAt = null;
    this.lastOnlineAt = null;
    /** Set by the demo toggle. Always surfaced as "simulated", never as truth. */
    this.simulatedOffline = false;
    this._timer = null;
    this._probing = null;
    this._started = false;
  }

  /* ── inputs ─────────────────────────────────────────────────────────────── */

  _networkInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return c ? { effectiveType: c.effectiveType, saveData: c.saveData === true, _c: c } : {};
  }

  signal() {
    const info = this._networkInfo();
    return {
      navigatorOnLine: navigator.onLine,
      simulatedOffline: this.simulatedOffline,
      consecutiveFailures: this.consecutiveFailures,
      probeOk: this.probeOk,
      probeRttMs: this.probeRttMs,
      effectiveType: info.effectiveType,
      saveData: info.saveData,
    };
  }

  /* ── the verdict ────────────────────────────────────────────────────────── */

  _settle(cause) {
    const next = classifyConnectivity(this.signal());
    const previous = this.tier;
    this.tier = next;
    if (next === ONLINE) this.lastOnlineAt = Date.now();
    if (next !== previous) {
      this.dispatchEvent(new CustomEvent("change", {
        detail: { tier: next, previous, cause, signal: this.signal() },
      }));
      // Reconnection is its own event because it is the trigger for sync, and a
      // listener that only cares about coming back should not have to diff.
      if (previous !== ONLINE && next === ONLINE) {
        this.dispatchEvent(new CustomEvent("restored", { detail: { previous, cause } }));
      }
    }
    this._reschedule();
    return next;
  }

  /* ── what the app reports back ──────────────────────────────────────────── */

  /**
   * A request reached the server. Any answer counts, including a 4xx: the
   * platform replied, which is exactly what this is measuring. Only a transport
   * failure is evidence about the network.
   */
  noteSuccess() {
    const had = this.consecutiveFailures;
    this.consecutiveFailures = 0;
    if (had) this._settle("request-succeeded");
    else if (this.tier !== ONLINE) this._settle("request-succeeded");
  }

  /** A request never got an answer — a transport error or a timeout. */
  noteFailure() {
    this.consecutiveFailures++;
    // Failures are evidence the probe result is stale, so it stops counting.
    this.probeOk = null;
    this._settle("request-failed");
    // A failure is the moment we most want a fresh reading.
    this.probe();
  }

  /* ── the probe ──────────────────────────────────────────────────────────── */

  /**
   * Ask the server whether it is there, and how long it took.
   *
   * `cache: "no-store"` matters: a cached 200 from the service worker would
   * make a dead network look healthy, which is the single worst failure mode
   * this class can have.
   */
  probe() {
    if (this._probing) return this._probing;
    if (this.simulatedOffline) {
      this.probeOk = false; this.probeRttMs = null; this.lastProbeAt = Date.now();
      return Promise.resolve(this._settle("simulated"));
    }

    const t0 = Date.now();
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;

    this._probing = fetch(this.base + this.probePath, {
      method: "GET",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    }).then((res) => {
      this.probeOk = res.ok;
      this.probeRttMs = Date.now() - t0;
    }).catch(() => {
      this.probeOk = false;
      this.probeRttMs = null;
    }).then(() => {
      if (timer) clearTimeout(timer);
      this.lastProbeAt = Date.now();
      this._probing = null;
      return this._settle("probe");
    });

    return this._probing;
  }

  _reschedule() {
    if (!this._started) return;
    clearTimeout(this._timer);
    const every = this.tier === ONLINE ? PROBE_HEALTHY_MS : PROBE_DEGRADED_MS;
    this._timer = setTimeout(() => {
      // A hidden tab probes nothing — a phone in a pocket must not hold the
      // radio awake every six seconds.
      if (typeof document !== "undefined" && document.hidden) { this._reschedule(); return; }
      this.probe();
    }, every);
  }

  /* ── lifecycle ──────────────────────────────────────────────────────────── */

  start() {
    if (this._started) return this;
    this._started = true;

    addEventListener("online", () => { this.consecutiveFailures = 0; this.probeOk = null; this._settle("browser-online"); this.probe(); });
    addEventListener("offline", () => { this.probeOk = false; this._settle("browser-offline"); });

    const info = this._networkInfo();
    if (info._c && info._c.addEventListener) {
      info._c.addEventListener("change", () => this._settle("network-information"));
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        // Coming back to the app should not wait out a 45-second timer to find
        // out the train left the tunnel an hour ago.
        if (!document.hidden) this.probe();
      });
    }

    this._settle("start");
    this.probe();
    return this;
  }

  stop() {
    this._started = false;
    clearTimeout(this._timer);
  }

  /**
   * The demo / diagnostic toggle.
   *
   * Simulated offline is a real state as far as every consumer is concerned —
   * requests are refused, incidents go to the local store — so the demo proves
   * the actual code path rather than a mock of it. What it must never do is
   * claim to be a *measurement*, which is why it is a separate flag the UI
   * labels as simulated.
   */
  simulate(offline) {
    this.simulatedOffline = Boolean(offline);
    if (!this.simulatedOffline) { this.probeOk = null; this.consecutiveFailures = 0; }
    this._settle("simulated");
    if (!this.simulatedOffline) this.probe();
    return this.tier;
  }

  get isOnline() { return this.tier === ONLINE; }
  get isOffline() { return this.tier === OFFLINE; }
  /** Anything that is not a healthy connection: LIMITED or OFFLINE. */
  get isDegraded() { return this.tier !== ONLINE; }
}

const api = { Connectivity, ONLINE, LIMITED, OFFLINE };
globalThis.RAConnectivity = api;
export default api;
