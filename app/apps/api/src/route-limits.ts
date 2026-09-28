/**
 * Limits for the routes ratelimit.ts's policy table does not cover: the two
 * tile proxies, which anyone can call, and the live map, which runs three
 * geospatial queries per request. Same counters (ratelimit.hit), same 429.
 *
 * The tile proxies fetch from tile.openstreetmap.org under this platform's
 * name. Unbounded, a loop over random tiles turns the server into a bulk
 * downloader against OSM's tile policy - and gets the host blocked for every
 * real map user. So: only tiles that exist, only over and around India, and
 * a per-address ceiling well above what panning a map ever needs.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { hit } from "./ratelimit.js";

export function bucket(name: string, max: number, windowMs: number) {
  return async function limiter(req: FastifyRequest, reply: FastifyReply) {
    const principal = req.user?.sub ?? `ip:${req.ip}`;
    const v = hit(`${name}:${principal}`, max, windowMs);
    if (v.allowed) return;
    reply.header("retry-after", String(v.resetInSeconds));
    return reply.code(429).send({ error: {
      code: "rate_limited", title: `Too many requests. Try again in ${v.resetInSeconds} seconds.`,
      retryable: true, retryAfterSeconds: v.resetInSeconds, requestId: req.id,
    } });
  };
}

/** A map view loads a few dozen tiles; a fling or a zoom a few hundred. */
export const tileLimit = bucket("tiles", 1200, 60_000);
export const mapLimit = bucket("map", 120, 60_000);

/** The tile's centre in degrees (Web Mercator). */
export function tileCentre(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lat, lng };
}

/** India with a generous margin - the platform maps nothing else. */
const REGION = { minLat: -2, maxLat: 42, minLng: 60, maxLng: 104 };

/**
 * Whether a tile is one the proxies should fetch: it must exist at its zoom,
 * and from zoom 6 (where a tile is ~6° wide) its centre must fall over the
 * region. Below that a single tile spans a subcontinent and is always allowed.
 */
export function tileAllowed(z: number, x: number, y: number): boolean {
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) return false;
  if (z < 6) return true;
  const { lat, lng } = tileCentre(z, x, y);
  return lat >= REGION.minLat && lat <= REGION.maxLat && lng >= REGION.minLng && lng <= REGION.maxLng;
}
