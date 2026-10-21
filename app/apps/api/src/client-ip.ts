/**
 * The caller's address, from a header the edge sets and the caller cannot.
 *
 * With TRUST_PROXY=true, req.ip is the leftmost X-Forwarded-For entry - the
 * one the client wrote. Every per-address limit (OTP requests, signed-out
 * rate limits) could then be dodged by sending a new fake address each time.
 *
 * The hosted platform sits behind Cloudflare, which overwrites
 * CF-Connecting-IP with the address that actually connected. So when
 * CLIENT_IP_HEADER names such a header, it is the only place a client
 * address comes from: a valid IP in it is the caller's address, and a request
 * without one is keyed on the TCP peer (the socket), never on
 * X-Forwarded-For, which TRUST_PROXY=true would otherwise believe. The peer
 * may be the platform's proxy, shared by everyone who arrives that way; that
 * is coarse but cannot be forged. When the header is not configured (local
 * development, CI, the self-hosted VM), nothing changes: req.ip is Fastify's.
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
    const ip = clientIpFrom(req.headers[name]) ?? req.raw.socket?.remoteAddress;
    if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });
  });
}

/** Which client-address headers a request arrived with: presence and a count, never a value. */
export interface IpHeaderPresence {
  cfConnectingIp: boolean;
  trueClientIp: boolean;
  xRealIp: boolean;
  /** How many comma-separated entries X-Forwarded-For holds; 0 when absent. */
  xffEntries: number;
}

function present(v: unknown): boolean {
  return (typeof v === "string" && v.trim() !== "") || (Array.isArray(v) && v.some((x) => String(x).trim() !== ""));
}

/**
 * For the access log: which of the headers an edge uses to carry the client's
 * address reached this process. It answers "which header does this platform
 * deliver?" - the one question CLIENT_IP_HEADER depends on - from the log
 * alone, without ever writing an address. Booleans and a count only.
 */
export function ipHeaderPresence(headers: Record<string, unknown> | undefined): IpHeaderPresence {
  const h = headers ?? {};
  const xff = [h["x-forwarded-for"]].flat().filter((v): v is string => typeof v === "string");
  return {
    cfConnectingIp: present(h["cf-connecting-ip"]),
    trueClientIp: present(h["true-client-ip"]),
    xRealIp: present(h["x-real-ip"]),
    xffEntries: xff.join(",").split(",").filter((s) => s.trim() !== "").length,
  };
}
