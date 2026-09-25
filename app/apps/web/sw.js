/**
 * RoadAssist service worker.
 *
 * "Offline is a first-class mode, not a fallback" is a stated non-negotiable,
 * but until now only *map tiles* survived a dead network — the app shell itself
 * needed the server to render at all. This makes the shell survive too.
 *
 * The routing rules follow ADR-0004: booking state is server-authoritative, so
 * API responses are NEVER served from cache. A stale booking status is worse
 * than an honest failure, and the page already has its own offline queue that
 * replays idempotently. Only the shell and map tiles are cached.
 */
// Bump whenever SHELL_ASSETS changes: the old cache is dropped on activate, so
// a viewer who already installed v1 does not keep a shell missing the new files.
const VERSION = "ra-v8";
const SHELL = `${VERSION}-shell`;
// Versioned: the basemap URL is stable but its upstream is not, so a changed
// tile source has to be able to retire everything cached under the old one.
// Trip Guardian writes to this same name (see app.html) — bump both together.
const TILES = "ra-tiles-v2";

// Everything needed to boot the app with no network at all.
const SHELL_ASSETS = [
  "/app.html",
  "/map.html",
  // A mechanic works from the same dead zones their customers break down in.
  "/mechanic.html",
  "/ds.css",
  "/depth.js",
  "/email-signin.js",
  // app.html runs on it before its own script does — uncached, no screen draws.
  "/journey.js",
  "/manifest.webmanifest",
  // Off-Grid Mode (ADR-0009). Without these cached, the feature that exists for
  // a dead network would need the network to load.
  "/offline-engine.js",
  "/offline-store.js",
  "/connectivity.js",
  // The same argument, and it was missed when the language switch landed: a
  // reader who needs Hindi or Tamil needs it MOST on the hard shoulder with no
  // signal. Uncached, every off-grid user silently fell back to English.
  "/i18n.js",
  "/icon.svg",
  "/icon-maskable.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  // Self-hosted now, so the typography survives offline too rather than
  // silently dropping to the fallback stack.
  "/vendor/fonts.css",
  "/vendor/fonts/fraunces-latin.woff2",
  "/vendor/fonts/fraunces-latin-ext.woff2",
  "/vendor/fonts/manrope-latin.woff2",
  "/vendor/fonts/manrope-latin-ext.woff2",
  "/vendor/leaflet.css",
  "/vendor/leaflet.js",
  "/vendor/MarkerCluster.css",
  "/vendor/markercluster.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // addAll is all-or-nothing; one 404 would leave the app with no shell at
      // all, so each asset is added independently and failures are tolerated.
      Promise.all(SHELL_ASSETS.map((url) =>
        cache.add(url).catch(() => { /* asset unavailable — shell still installs */ }),
      )),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                 // never cache a mutation

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // fonts etc. — leave alone

  // API: always the network. A cached booking status would be a lie.
  if (url.pathname.startsWith("/v1/") || url.pathname === "/health") return;

  // Map tiles: cache-first and shared with the tiles Trip Guardian pre-downloads,
  // so a prepared route keeps rendering with the radio off.
  if (url.pathname.startsWith("/tiles/") || url.pathname.startsWith("/basemap/")) {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          // No tile and no network: let the map draw its own empty ground.
          return new Response("", { status: 504, statusText: "tile unavailable offline" });
        }
      }),
    );
    return;
  }

  // Shell: serve instantly from cache, refresh in the background.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) return hit;
      const res = await fresh;
      if (res) return res;
      // Nothing cached, nothing reachable — hand back the app shell so a
      // navigation still lands somewhere useful instead of the browser's
      // dinosaur.
      return (await cache.match("/app.html")) ??
        new Response("Offline and this page was never cached.", {
          status: 503, headers: { "content-type": "text/plain" },
        });
    }),
  );
});
