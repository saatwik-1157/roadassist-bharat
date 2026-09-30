/**
 * Location services from open data, all server-side.
 *
 *   GET /v1/geo/address      a readable place for a point      (OpenStreetMap Nominatim)
 *   GET /v1/geo/nearby       hospitals, police, fuel, EV chargers,
 *                            repair shops around a point       (OpenStreetMap Overpass)
 *   GET /v1/geo/route        road distance and driving time    (OSRM demo router)
 *   GET /v1/geo/earthquakes  recent quakes in and around India (USGS)
 *   airQuality()             current AQI, used by the RAKSHA corridor report (Open-Meteo)
 *
 * Why server-side: a browser calling these directly would hand every visitor's
 * address to each host (non-negotiable #4). Here only this server talks to
 * them, with coarsened coordinates, an identifying User-Agent, caching and one
 * request a second - the terms these donated services ask for. Each host is
 * declared, with what it receives, in scripts/check-data-residency.mjs.
 *
 * Off by default in development, test and CI (GEO_SERVICES=on turns them on);
 * on where the platform is deployed. When off or unreachable the endpoints
 * answer 503 and the screens say the lookup is unavailable - they never invent
 * a place, a distance or a phone number.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { authenticate } from "../auth.js";
import { env } from "../env.js";
import { ok } from "../http.js";
import { bucket } from "../route-limits.js";
import { isLocalEnv } from "../domain/local-env.js";
import {
  coarsen, inIndia, geoServicesEnabled, overpassQuery, parseAirQuality, parseNominatim,
  parseOsrm, parseOverpass, parseUsgs, Pacer, PacerFull, TtlCache,
} from "../domain/geo.js";

const ENABLED = geoServicesEnabled(process.env.GEO_SERVICES, isLocalEnv(env.nodeEnv));
const UA = "RoadAssist-Bharat/1.0 (+https://roadassistbharat.online; road-safety student project)";

const OSM = "© OpenStreetMap contributors, ODbL";
const addrCache = new TtlCache<unknown>(24 * 3600_000, 5000);
const nearCache = new TtlCache<unknown>(6 * 3600_000, 2000);
const routeCache = new TtlCache<unknown>(10 * 60_000, 3000);
const quakeCache = new TtlCache<unknown>(15 * 60_000, 4);
const airCache = new TtlCache<ReturnType<typeof parseAirQuality>>(30 * 60_000, 200);
// Nominatim's and OSRM's published limit is one request a second; Overpass
// asks for restraint, and a two-second gap is well inside it.
const nominatim = new Pacer(1100);
const osrm = new Pacer(1000);
const overpass = new Pacer(2000, 10);

const geoLimit = bucket("geo", 40, 60_000);

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init, signal: ctrl.signal,
      headers: { "user-agent": UA, referer: "https://roadassistbharat.online/", accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

function unavailable(req: FastifyRequest, reply: FastifyReply, disabled: boolean, busy = false) {
  return reply.code(503).send({ error: {
    code: disabled ? "geo_disabled" : "geo_unavailable",
    title: disabled
      ? "Location services are off on this server (GEO_SERVICES)."
      : busy ? "Location lookups are busy. Try again in a few seconds."
        : "The location service did not answer. Try again shortly.",
    retryable: !disabled, requestId: req.id,
  } });
}

const point = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

function outsideIndia(req: FastifyRequest, reply: FastifyReply) {
  return reply.code(400).send({ error: {
    code: "outside_region", title: "Location services cover India only.", retryable: false, requestId: req.id,
  } });
}

/** Current air quality at a point, or null. Cached 30 min; never throws. */
export async function airQuality(lat: number, lng: number) {
  if (!ENABLED) return null;
  const key = `${coarsen(lat, 2)},${coarsen(lng, 2)}`;
  const hit = airCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const j = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coarsen(lat, 2)}` +
      `&longitude=${coarsen(lng, 2)}&current=us_aqi,pm2_5,pm10`, {}, 6000);
    const v = parseAirQuality(j);
    airCache.set(key, v);
    return v;
  } catch { return null; }
}

export async function geoRoutes(app: FastifyInstance) {
  app.get("/v1/geo/address", { preHandler: [authenticate, geoLimit] }, async (req, reply) => {
    const q = point.parse(req.query);
    if (!inIndia(q.lat, q.lng)) return outsideIndia(req, reply);
    if (!ENABLED) return unavailable(req, reply, true);
    const lat = coarsen(q.lat), lng = coarsen(q.lng);
    const key = `${lat},${lng}`;
    let address = addrCache.get(key);
    if (address === undefined) {
      try {
        const j = await nominatim.run(() => getJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1&accept-language=en`));
        address = parseNominatim(j);
        addrCache.set(key, address);
      } catch (e) { return unavailable(req, reply, false, e instanceof PacerFull); }
    }
    return ok({ address }, { source: `OpenStreetMap Nominatim · ${OSM}`, coarsenedTo: "~110 m" });
  });

  app.get("/v1/geo/nearby", { preHandler: [authenticate, geoLimit] }, async (req, reply) => {
    const q = point.extend({ radiusKm: z.coerce.number().min(1).max(15).default(5) }).parse(req.query);
    if (!inIndia(q.lat, q.lng)) return outsideIndia(req, reply);
    if (!ENABLED) return unavailable(req, reply, true);
    // Coarser still for a search area (~1 km): the answer is a list of public
    // places, so precision here buys nothing and costs privacy.
    const lat = coarsen(q.lat, 2), lng = coarsen(q.lng, 2), r = Math.round(q.radiusKm);
    const key = `${lat},${lng},${r}`;
    let groups = nearCache.get(key);
    if (groups === undefined) {
      try {
        // The public Overpass server answers 429/504 when it is busy, which is
        // often; one paced retry turns most of those into an answer. The result
        // is then cached for six hours per ~1 km cell.
        const ask = () => getJson("https://overpass-api.de/api/interpreter", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(overpassQuery(lat, lng, r * 1000)),
        }, 18000);
        const j = await overpass.run(() => ask().catch((e: Error) =>
          /upstream (429|502|503|504)/.test(e.message) ? new Promise((ok) => setTimeout(ok, 2500)).then(ask) : Promise.reject(e)));
        groups = parseOverpass(j, { lat, lng });
        nearCache.set(key, groups);
      } catch (e) { return unavailable(req, reply, false, e instanceof PacerFull); }
    }
    return ok({ origin: { lat, lng }, radiusKm: r, groups },
      { source: `OpenStreetMap Overpass · ${OSM}`, coarsenedTo: "~1 km", note: "Distances are straight-line from the search point. Community map data: call before relying on hours." });
  });

  app.get("/v1/geo/route", { preHandler: [authenticate, geoLimit] }, async (req, reply) => {
    const q = z.object({
      fromLat: z.coerce.number(), fromLng: z.coerce.number(), toLat: z.coerce.number(), toLng: z.coerce.number(),
    }).parse(req.query);
    if (!inIndia(q.fromLat, q.fromLng) || !inIndia(q.toLat, q.toLng)) return outsideIndia(req, reply);
    if (!ENABLED) return unavailable(req, reply, true);
    const a = [coarsen(q.fromLng), coarsen(q.fromLat)], b = [coarsen(q.toLng), coarsen(q.toLat)];
    const key = `${a}|${b}`;
    let route = routeCache.get(key);
    if (route === undefined) {
      try {
        const j = await osrm.run(() => getJson(
          `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=false&alternatives=false`));
        route = parseOsrm(j);
        routeCache.set(key, route);
      } catch (e) { return unavailable(req, reply, false, e instanceof PacerFull); }
    }
    return ok({ route }, { source: `OSRM demo router · ${OSM}`, coarsenedTo: "~110 m", note: "Driving time with no live traffic." });
  });

  app.get("/v1/geo/earthquakes", { preHandler: [authenticate, geoLimit] }, async (req, reply) => {
    if (!ENABLED) return unavailable(req, reply, true);
    let quakes = quakeCache.get("india");
    if (quakes === undefined) {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      try {
        const j = await getJson("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
          `&starttime=${since}&minmagnitude=4&minlatitude=5&maxlatitude=38&minlongitude=67&maxlongitude=98&orderby=time`);
        quakes = parseUsgs(j);
        quakeCache.set("india", quakes);
      } catch { return unavailable(req, reply, false); }
    }
    return ok({ quakes, windowDays: 7, minMagnitude: 4 }, { source: "USGS Earthquake Hazards Program" });
  });
}
