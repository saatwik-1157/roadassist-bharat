/**
 * Location services from open data: addresses, nearest help, road ETAs, air
 * quality and earthquakes. Everything here is pure - parsing, coarsening,
 * caching, pacing - so it is unit-tested without the network. routes/geo.ts
 * does the fetching.
 *
 * Every provider is a public service run on donated capacity (OpenStreetMap's
 * Nominatim and Overpass, the OSRM demo router), so the rules are theirs:
 * identify the application, cache, and never exceed about one request a second.
 * A position sent to any of them is personal data leaving India, so it is
 * coarsened first (see coarsen) and the host is declared, with that tension
 * stated, in scripts/check-data-residency.mjs.
 */

/** Round a coordinate. 3 dp is ~110 m: enough for a street, not a doorstep. */
export function coarsen(v: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** India with a margin. The platform's services are for Indian roads only. */
export function inIndia(lat: number, lng: number): boolean {
  return lat >= 5 && lat <= 38 && lng >= 67 && lng <= 98;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** A small cache with a time-to-live and a size cap (oldest entry evicted first). */
export class TtlCache<V> {
  private map = new Map<string, { v: V; at: number }>();
  constructor(private ttlMs: number, private max: number, private now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.map.delete(k); return undefined; }
    return e.v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, { v, at: this.now() });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size(): number { return this.map.size; }
}

/**
 * Runs calls one at a time, at least `gapMs` apart - a provider's "one request
 * per second" as a mechanism rather than a hope. A queue longer than `maxQueue`
 * is refused outright (the caller answers 503) instead of growing without end.
 */
export class Pacer {
  private chain: Promise<unknown> = Promise.resolve();
  private last = -Infinity;   // no call yet, so the first one never waits
  private waiting = 0;
  constructor(private gapMs: number, private maxQueue = 20,
              private now: () => number = Date.now,
              private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.waiting >= this.maxQueue) return Promise.reject(new PacerFull());
    this.waiting++;
    const next = this.chain.then(async () => {
      const wait = this.last + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      try { return await fn(); } finally { this.waiting--; }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
export class PacerFull extends Error { constructor() { super("provider queue full"); } }

// ── addresses (Nominatim reverse geocoding) ─────────────────────────────────

export interface Address {
  label: string; road: string | null; area: string | null; city: string | null;
  district: string | null; state: string | null; postcode: string | null;
}

/** A readable one-line place from Nominatim's structured address. */
export function parseNominatim(j: unknown): Address | null {
  const a = (j as { address?: Record<string, string> } | null)?.address;
  if (!a) return null;
  const road = a.road ?? a.highway ?? a.pedestrian ?? null;
  const area = a.suburb ?? a.neighbourhood ?? a.village ?? a.hamlet ?? a.quarter ?? null;
  const city = a.city ?? a.town ?? a.municipality ?? a.county ?? null;
  const district = a.state_district ?? a.district ?? null;
  const state = a.state ?? null;
  const postcode = a.postcode ?? null;
  const parts = [road, area, city ?? district, state].filter((p, i, all) => p && all.indexOf(p) === i);
  const label = parts.join(", ") + (postcode ? ` ${postcode}` : "");
  return label ? { label, road, area, city, district, state, postcode } : null;
}

// ── nearest help (Overpass) ─────────────────────────────────────────────────

export const HELP_KINDS = {
  hospital: { label: "Hospitals", tags: [["amenity", "hospital"], ["amenity", "clinic"]] },
  police: { label: "Police", tags: [["amenity", "police"]] },
  fuel: { label: "Fuel", tags: [["amenity", "fuel"]] },
  charging: { label: "EV charging", tags: [["amenity", "charging_station"]] },
  repair: { label: "Repair and tyres", tags: [["shop", "car_repair"], ["shop", "tyres"], ["shop", "motorcycle_repair"]] },
} as const;
export type HelpKind = keyof typeof HELP_KINDS;

/** Overpass QL for every help kind within `radiusM` of a point. */
export function overpassQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
  const parts: string[] = [];
  for (const k of Object.values(HELP_KINDS)) for (const [key, val] of k.tags) parts.push(`nwr["${key}"="${val}"]${around};`);
  return `[out:json][timeout:15];(${parts.join("")});out center tags 200;`;
}

export interface Place { name: string; kind: HelpKind; lat: number; lng: number; distanceKm: number; phone: string | null; hours: string | null }

function kindOf(tags: Record<string, string>): HelpKind | null {
  for (const [kind, def] of Object.entries(HELP_KINDS) as [HelpKind, (typeof HELP_KINDS)[HelpKind]][]) {
    if (def.tags.some(([k, v]) => tags[k] === v)) return kind;
  }
  return null;
}

/** The nearest `perKind` of each kind, nearest first; unnamed places are labelled by kind. */
export function parseOverpass(j: unknown, origin: { lat: number; lng: number }, perKind = 4): Record<HelpKind, Place[]> {
  const out = Object.fromEntries(Object.keys(HELP_KINDS).map((k) => [k, [] as Place[]])) as Record<HelpKind, Place[]>;
  const els = (j as { elements?: Array<Record<string, unknown>> } | null)?.elements ?? [];
  for (const e of els) {
    const tags = (e.tags ?? {}) as Record<string, string>;
    const kind = kindOf(tags);
    const c = (e.center ?? e) as { lat?: number; lon?: number };
    if (!kind || typeof c.lat !== "number" || typeof c.lon !== "number") continue;
    const phone = tags.phone ?? tags["contact:phone"] ?? null;
    out[kind].push({
      name: tags.name ?? tags["name:en"] ?? `${HELP_KINDS[kind].label.replace(/s$/, "")} (unnamed)`,
      kind, lat: c.lat, lng: c.lon,
      distanceKm: Number(haversineKm(origin, { lat: c.lat, lng: c.lon }).toFixed(2)),
      phone: phone && /^[+\d][\d\s-]{5,}$/.test(phone) ? phone.split(";")[0].trim() : null,
      hours: tags.opening_hours ?? null,
    });
  }
  for (const k of Object.keys(out) as HelpKind[]) out[k] = out[k].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, perKind);
  return out;
}

// ── road distance and time (OSRM) ───────────────────────────────────────────

export function parseOsrm(j: unknown): { distanceKm: number; durationMin: number } | null {
  const r = (j as { code?: string; routes?: Array<{ distance: number; duration: number }> } | null);
  const best = r?.code === "Ok" ? r.routes?.[0] : undefined;
  if (!best || !Number.isFinite(best.distance) || !Number.isFinite(best.duration)) return null;
  return { distanceKm: Number((best.distance / 1000).toFixed(1)), durationMin: Math.max(1, Math.round(best.duration / 60)) };
}

// ── air quality (Open-Meteo) ────────────────────────────────────────────────

/** The US EPA AQI bands, which is the scale Open-Meteo's `us_aqi` reports. */
export function aqiBand(aqi: number): string {
  return aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy for sensitive groups"
    : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very unhealthy" : "Hazardous";
}

export function parseAirQuality(j: unknown): { usAqi: number; pm25: number | null; pm10: number | null; band: string } | null {
  const c = (j as { current?: { us_aqi?: number; pm2_5?: number; pm10?: number } } | null)?.current;
  if (!c || typeof c.us_aqi !== "number") return null;
  return { usAqi: Math.round(c.us_aqi), pm25: c.pm2_5 ?? null, pm10: c.pm10 ?? null, band: aqiBand(c.us_aqi) };
}

// ── earthquakes (USGS) ──────────────────────────────────────────────────────

export interface Quake { magnitude: number; place: string; time: string; lat: number; lng: number; depthKm: number; url: string | null }

export function parseUsgs(j: unknown, limit = 12): Quake[] {
  const fs = (j as { features?: Array<{ properties: Record<string, unknown>; geometry: { coordinates: number[] } }> } | null)?.features ?? [];
  return fs
    .filter((f) => typeof f.properties?.mag === "number" && Array.isArray(f.geometry?.coordinates))
    .map((f) => ({
      magnitude: Number((f.properties.mag as number).toFixed(1)),
      place: String(f.properties.place ?? "Unknown place"),
      time: new Date(Number(f.properties.time)).toISOString(),
      lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      depthKm: Number((f.geometry.coordinates[2] ?? 0).toFixed(0)),
      url: typeof f.properties.url === "string" && f.properties.url.startsWith("https://earthquake.usgs.gov/") ? f.properties.url : null,
    }))
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, limit);
}

/** On by default where the platform is deployed; off in development, test and CI, which must not hammer donated services. */
export function geoServicesEnabled(setting: string | undefined, local: boolean): boolean {
  const s = (setting ?? "").trim().toLowerCase();
  if (s === "on" || s === "true") return true;
  if (s === "off" || s === "false") return false;
  return !local;
}
