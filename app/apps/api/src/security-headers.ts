/**
 * Security headers on every response - pages, files and API alike.
 *
 * Until this existed the platform sent none: no HSTS, no content security
 * policy, no nosniff, no referrer policy. Everything the pages do had to be
 * allowed explicitly for the policy to be switched on without breaking them:
 *
 *   · scripts are this origin's files plus the pages' own inline <script>
 *     blocks, each allowed by its SHA-256 hash - never 'unsafe-inline'. The
 *     hashes are computed from the served pages when the server starts
 *     (inlineScriptHashes), so editing a page moves its hash with it on the
 *     next restart; a development server also recomputes them when a page
 *     changes on disk. A script injected into a page matches no hash and does
 *     not run. Hashes do not cover handler attributes (onclick=) or
 *     javascript: URLs, so the pages have none - security-headers.test.ts
 *     fails the build if one appears.
 *   · styles keep 'unsafe-inline': the pages set style="" throughout and
 *     build styled markup in script. Injected CSS can restyle a page but not
 *     run code, which is why it is left for later.
 *   · 'wasm-unsafe-eval' - the 3D page decodes its model with Draco's
 *     WebAssembly decoder, in a worker started from a blob: URL, and the
 *     live road scan runs its detector on ONNX Runtime's WebAssembly build
 *     (vendor/ort/, served from this origin like everything else).
 *   · one page gets headers of its own (pageHeaders): the road scan may use
 *     the camera and is cross-origin isolated; nothing else changes.
 *   · connect and images are this origin (the map tiles are proxied through
 *     /basemap), plus data:/blob: for canvases and downloaded exports.
 *   · frame-ancestors lets the project site frame these pages - it shows the
 *     live app and the 3D model inside its own sections - and nobody else.
 *   · Razorpay Checkout is only allowed when the real gateway is configured;
 *     the mock provider never loads it, so the policy does not either.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

export interface HeaderOptions {
  /** Origins allowed to frame these pages (the project site). */
  frameAncestors: string[];
  razorpay: boolean;
  /** 'sha256-…' sources for the pages' inline scripts (inlineScriptHashes). */
  scriptHashes?: string[];
}

/** The served pages under `root`, recursively (vendor/ included: it is served too). */
export function servedPages(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;   // @fastify/static denies dotfiles
    const p = join(root, entry.name);
    if (entry.isDirectory()) out.push(...servedPages(p));
    else if (/\.html?$/i.test(entry.name)) out.push(p);
  }
  return out.sort();
}

/**
 * The text of every inline <script> in a page, as the browser hashes it.
 *
 * A browser hashes the script element's text after the HTML parser has
 * normalised line endings (CRLF and lone CR become LF), so a page checked
 * out with Windows line endings must be normalised the same way or none of
 * its hashes would match. Script content is raw text: no entity decoding.
 * An element with src= has no inline body to allow.
 */
export function inlineScripts(html: string): string[] {
  const text = html.replace(/\r\n?/g, "\n");
  const out: string[] = [];
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

export const scriptHash = (body: string) =>
  `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

/** Hash sources for every inline script in every page under `root`, deduplicated. */
export function inlineScriptHashes(root: string): string[] {
  const all = servedPages(root).flatMap((p) => inlineScripts(readFileSync(p, "utf8")).map(scriptHash));
  return [...new Set(all)].sort();
}

/**
 * The project site, always allowed to frame these pages - not only when
 * CORS_ORIGINS is set. Its live mode (?live=http://localhost:4000) frames a
 * local or docker server, which runs with no CORS list, and was refused.
 */
export const SHOWCASE_ORIGINS = ["https://roadassistbharat.online", "https://www.roadassistbharat.online"] as const;

export function contentSecurityPolicy(o: HeaderOptions): string {
  const rzp = o.razorpay;
  const framers = [...new Set([...SHOWCASE_ORIGINS, ...o.frameAncestors])];
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...(o.scriptHashes ?? []), "'wasm-unsafe-eval'", ...(rzp ? ["https://checkout.razorpay.com"] : [])],
    // 'unsafe-inline' for styles only - see the header comment.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(rzp ? ["https://*.razorpay.com"] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(rzp ? ["https://*.razorpay.com"] : [])],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", ...(rzp ? ["https://api.razorpay.com", "https://checkout.razorpay.com"] : [])],
    "frame-ancestors": ["'self'", ...framers],
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

/**
 * Headers one page needs and no other page gets.
 *
 * scan.html (the live road scan) is the only page that opens the camera, so
 * it alone is granted camera=(self); everywhere else the camera stays off, as
 * staticHeaders says. It also runs a detection model on ONNX Runtime's
 * WebAssembly build, whose threads need SharedArrayBuffer, which a browser
 * only grants a cross-origin-isolated document: hence COOP same-origin and
 * COEP require-corp. That costs this page nothing - it loads only this
 * origin's files, which carry cross-origin-resource-policy already - and
 * without it the model runs on a single thread. No other page is isolated:
 * the citizen app opens payment popups that same-origin would sever.
 */
const PAGE_HEADERS: Record<string, Record<string, string>> = {
  "/scan.html": {
    "permissions-policy": "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  },
};

/**
 * ONNX Runtime starts its WebAssembly threads as workers from its own script
 * (vendor/ort/*.mjs). A worker started by an isolated page is itself held to
 * COEP, and Chrome refuses a worker script that does not declare it - the
 * runtime then waits for threads that never start. So that folder declares it
 * too. It is a restriction (only same-origin or CORP-marked subresources),
 * never a relaxation.
 */
const ISOLATED_WORKER_DIRS = ["/vendor/ort/"];

/** The overrides for one request path (query string ignored), or none. */
export function pageHeaders(path: string): Record<string, string> {
  const p = path.split("?")[0];
  if (ISOLATED_WORKER_DIRS.some((d) => p.startsWith(d))) return { "cross-origin-embedder-policy": "require-corp" };
  return PAGE_HEADERS[p] ?? {};
}

/**
 * `pagesRoot` is the directory the pages are served from; its inline scripts
 * are hashed into script-src. With `watchPages` (a development server) the
 * hashes are recomputed whenever a page's size or modification time changes,
 * so editing a page never needs a restart to keep it running.
 */
export function registerSecurityHeaders(
  app: FastifyInstance,
  o: HeaderOptions & { pagesRoot?: string; watchPages?: boolean },
) {
  const signature = () => o.pagesRoot
    ? servedPages(o.pagesRoot).map((p) => { const s = statSync(p); return `${p}:${s.size}:${s.mtimeMs}`; }).join("|")
    : "";
  const build = () => contentSecurityPolicy({
    ...o, scriptHashes: [...(o.scriptHashes ?? []), ...(o.pagesRoot ? inlineScriptHashes(o.pagesRoot) : [])],
  });
  let seen = signature();
  let csp = build();
  app.addHook("onSend", async (req, reply, payload) => {
    const https = req.protocol === "https";
    for (const [k, v] of Object.entries(staticHeaders(https))) reply.header(k, v);
    for (const [k, v] of Object.entries(pageHeaders(req.url))) reply.header(k, v);
    if (o.watchPages && o.pagesRoot && /text\/html/.test(String(reply.getHeader("content-type") ?? ""))) {
      const now = signature();
      if (now !== seen) { seen = now; csp = build(); }
    }
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
