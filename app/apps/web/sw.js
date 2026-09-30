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
// v10: keys are the bare pathname, so v9's query-string entries are dropped.
// v11: the hazard-report photo, the mechanic sign-in hint (app.html, mechanic.html).
// v12: near.js ("Near you", road ETA) joins the shell; app.html and ds.css changed.
// v13: session.js (the refresh cookie) joins the shell; app, mechanic and email-signin changed.
const VERSION = "ra-v13";
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
  // The session and its refresh cookie; without it a cached page cannot sign in.
  "/session.js",
  // app.html runs on it before its own script does — uncached, no screen draws.
  "/journey.js",
  // "Near you" and road ETAs; it degrades to "needs a connection" offline.
  "/near.js",
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
// The shell cache holds exactly these paths, keyed without their query string:
// keyed by full URL, every distinct ?x=... link added an entry, without bound.
const SHELL_PATHS = new Set(SHELL_ASSETS);
// Only a complete 200 is stored. A 206 (a Range request, e.g. /media/*.mp4)
// is a fragment, and Cache.put rejects it outright.
const cacheable = (res) => res && res.status === 200 && res.type === "basic";

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
          if (cacheable(res)) cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          // No tile and no network: let the map draw its own empty ground.
          return new Response("", { status: 504, statusText: "tile unavailable offline" });
        }
      }),
    );
    return;
  }

  // A page itself: the network first, the cache when it is slow or gone.
  // Cache-first served a returning visitor the previous release of every page
  // once - a fixed map kept making the request the fix removed. A deploy now
  // shows on the next load; three seconds of dead air falls back to the copy.
  // Only a shell page is written to the cache, under its bare pathname.
  const key = SHELL_PATHS.has(url.pathname) ? url.pathname : null;
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const fresh = fetch(req).then((res) => {
          if (key && cacheable(res)) cache.put(key, res.clone()).catch(() => {});
          return res;
        });
        const slow = new Promise((resolve) => setTimeout(resolve, 3000, null));
        const res = await Promise.race([fresh.catch(() => null), slow]);
        if (res) return res;
        return (key && (await cache.match(key))) ?? (await fresh.catch(() => null)) ??
          (await cache.match("/app.html")) ??
          new Response("Offline and this page was never cached.", { status: 503, headers: { "content-type": "text/plain" } });
      }),
    );
    return;
  }

  // Anything else that is not a shell asset (media, 3D assets, feeds) goes to
  // the network untouched - including its Range requests and 206 answers.
  if (!key) return;

  // Shell assets: serve instantly from cache, refresh in the background.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(key);
      const fresh = fetch(req)
        .then((res) => { if (cacheable(res)) cache.put(key, res.clone()).catch(() => {}); return res; })
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
