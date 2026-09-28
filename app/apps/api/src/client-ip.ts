/**
 * The caller's address, from a header the edge sets and the caller cannot.
 *
 * With TRUST_PROXY=true, req.ip is the leftmost X-Forwarded-For entry - the
 * one the client wrote. Every per-address limit (OTP requests, signed-out
 * rate limits) could then be dodged by sending a new fake address each time.
 *
 * The hosted platform sits behind Cloudflare, which overwrites
 * CF-Connecting-IP with the address that actually connected. So when
 * CLIENT_IP_HEADER names such a header and the request carries a valid IP in
 * it, that is the caller's address. When the header is not configured, or
 * absent (local development, CI), nothing changes.
 */
import type { FastifyInstance } from "fastify";
import { isIP } from "node:net";

export function clientIpFrom(headerValue: unknown): string | null {
  if (typeof headerValue !== "string") return null;
  const v = headerValue.trim();
  return isIP(v) ? v : null;
}

export function registerClientIp(app: FastifyInstance, header = process.env.CLIENT_IP_HEADER) {
  const name = header?.trim().toLowerCase();
  if (!name) return;
  app.addHook("onRequest", async (req) => {
    const ip = clientIpFrom(req.headers[name]);
    if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });
  });
}
