/**
 * Security headers on every response - pages, files and API alike.
 *
 * Until this existed the platform sent none: no HSTS, no content security
 * policy, no nosniff, no referrer policy. Everything the pages do had to be
 * allowed explicitly for the policy to be switched on without breaking them:
 *
 *   · scripts and styles are this origin's own, plus inline blocks - every
 *     page carries its code inline and wires handlers in markup, so
 *     'unsafe-inline' stays until they move to files or nonces. What the
 *     policy still takes away is loading script from anywhere else, plugins,
 *     <base> hijacking, and form posts to other origins.
 *   · 'wasm-unsafe-eval' - the 3D page decodes its model with Draco's
 *     WebAssembly decoder, in a worker started from a blob: URL.
 *   · connect and images are this origin (the map tiles are proxied through
 *     /basemap), plus data:/blob: for canvases and downloaded exports.
 *   · frame-ancestors lets the project site frame these pages - it shows the
 *     live app and the 3D model inside its own sections - and nobody else.
 *   · Razorpay Checkout is only allowed when the real gateway is configured;
 *     the mock provider never loads it, so the policy does not either.
 */
import type { FastifyInstance } from "fastify";

export interface HeaderOptions {
  /** Origins allowed to frame these pages (the project site). */
  frameAncestors: string[];
  razorpay: boolean;
}

export function contentSecurityPolicy(o: HeaderOptions): string {
  const rzp = o.razorpay;
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(rzp ? ["https://checkout.razorpay.com"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(rzp ? ["https://*.razorpay.com"] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(rzp ? ["https://*.razorpay.com"] : [])],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", ...(rzp ? ["https://api.razorpay.com", "https://checkout.razorpay.com"] : [])],
    "frame-ancestors": ["'self'", ...o.frameAncestors],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/** The fixed headers; HSTS only over HTTPS, where it means something. */
export function staticHeaders(https: boolean): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    // Location is the citizen app's own feature; nothing else is asked for.
    "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    "cross-origin-opener-policy": "same-origin-allow-popups",
    "cross-origin-resource-policy": "same-site",
    "x-permitted-cross-domain-policies": "none",
    ...(https ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

export function registerSecurityHeaders(app: FastifyInstance, o: HeaderOptions) {
  const csp = contentSecurityPolicy(o);
  app.addHook("onSend", async (req, reply, payload) => {
    const https = req.protocol === "https";
    for (const [k, v] of Object.entries(staticHeaders(https))) reply.header(k, v);
    if (!reply.hasHeader("content-security-policy")) reply.header("content-security-policy", csp);
    // API answers are about a person - their bookings, their emergencies - and
    // must never sit in a shared or back-button cache.
    const path = req.url.split("?")[0];
    if ((path.startsWith("/v1/") || path === "/health") && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }
    return payload;
  });
}
