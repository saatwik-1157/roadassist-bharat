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
// v14: photo-shrink.js (hazard photos shrunk to the server's cap, ADR-0013) joins the shell; app.html changed.
// v15: emergency-numbers.js (tap-to-call 112/1033/..., "Text my location") joins the shell; app.html and ds.css changed.
// v16: booking-position.js (no GPS fix is never booked silently; the demo point only by choice) joins the shell; app.html changed.
// v17: app.css (app.html's styles, moved out of the page) and ui.js (sheet focus, top-bar hairline) join the shell; app.html, ds.css and depth.js changed.
// v18: the fonts change to Space Grotesk / Inter / JetBrains Mono (vendor/fonts).
// v19: Call 112 contrast, low-power SOS halo, motion-sensor and focus-return fixes (app.css, depth.js, ui.js).
// v20: three national helplines (181, 1098, 14567) under "Other national helplines" (emergency-numbers.js, app.css).
// v21: the Volt reskin of the citizen app (near-black ground, one chartreuse accent, round service tiles): app.html, app.css, ds.css, ui.js.
// v22: the pre-filled sign-in number moves into the demo block (+917000009876): app.html.
// v23: lime map markers and the edge-pin popup fix (map.html); a missing space in app.html's sign-in field.
// v24: the online SOS sheet says only what the server did — no "Help is on the way." when no contact or responder was reached (app.html, journey.js, i18n.js).
// v25: SOS contacts are "alerted" only when the server says SMS is live (smsLive); on a console SMS provider the sheet says "would be texted … only logged, not sent" (app.html, journey.js, i18n.js, index.html).
// v26: same-origin scripts, styles and JSON are network-first (a deploy no longer runs new HTML
//      with old scripts once); mechanic.html registers this worker; the Impact page and the live
//      road scan join the shell, the scan's detector and engine are cached on first use (SCAN);
//      plus this round's app fixes: an offline reopen stays signed in, the queue and off-grid
//      incidents belong to the user who made them, one open SOS at a time, translated tabs and
//      pill (app.html, mechanic.html, map.html, index.html, ui.js, near.js, i18n.js,
//      offline-engine.js, offline-store.js, landing.html).
// v27: the live road scan's detector becomes yolo11n-multi-rich-gpu (4 classes, 640 px; a new
//      SCAN cache name, so the old model is dropped), with the reason each class it cannot report
//      is not reportable (scan.html, scan.js, scan-core.js, the model sidecar).
// v28: the live road scan's detector becomes yolo11n-india-ft-gpu (the same 4 classes and 640 px,
//      fine-tuned on India; a new SCAN cache name, so the previous model is dropped): the sidecar.
// v29: the road scan runs a second, 416 px detector (the same yolo11n-india-ft-gpu weights) when
//      it falls back to WebAssembly, which runs a frame in about half the time; WebGPU keeps the
//      640 px model. Both are in SCAN (renamed, so the old cache is dropped) and both sidecars are in
//      the shell; the off-grid SOS cancel re-reads after a 409 (scan.js, app.html, the 416 sidecar).
// v30: the shell's pages changed without a bump last round; this round the mechanic and RAKSHA
//      consoles keep their session on a 5xx/429 refresh (session.js refused()), an off-grid false
//      alarm is kept on the IndexedDB row across a reload (offline-store.js, app.html), a synced
//      SOS answered "duplicate" is still escalated (app.html), and the scan sends a clientReportId
//      per draft (scan.js).
const VERSION = "ra-v30";
const SHELL = `${VERSION}-shell`;
// Versioned: the basemap URL is stable but its upstream is not, so a changed
// tile source has to be able to retire everything cached under the old one.
// Trip Guardian writes to this same name (see app.html) — bump both together.
const TILES = "ra-tiles-v2";
// The live road scan's detector (10.6 MB .onnx), its engine (ONNX Runtime, 28 MB
// of wasm) and the sample photos: far too heavy to put on every install, so they
// are cached the first time scan.html fetches them, and the page then works with
// no network. Named after the model and the engine build rather than VERSION, so
// a shell bump keeps them and a new model or ORT drops them: change this name
// whenever assets/models/ or vendor/ort/ changes.
// Both detectors: the 640 px one WebGPU runs and the 416 px WebAssembly fallback.
const SCAN = "ra-scan-yolo11n-india-ft-gpu-7b26bec8-416-04a66285-ort-1.30.0";
const SCAN_DIRS = ["/assets/models/", "/vendor/ort/", "/assets/scan/"];

// Everything needed to boot the app with no network at all.
const SHELL_ASSETS = [
  "/app.html",
  "/map.html",
  // A mechanic works from the same dead zones their customers break down in.
  "/mechanic.html",
  // The public Impact page: live counts, labelled as live, with the last copy offline.
  "/impact.html",
  // The live road scan. Only the small files: the model and the engine are SCAN, below.
  "/scan.html",
  "/scan.css",
  "/scan-core.js",
  "/scan.js",
  "/assets/models/raksha-yolo11n-india-ft-gpu.json",
  "/assets/models/raksha-yolo11n-india-ft-gpu-416.json",
  "/ds.css",
  // app.html's own stylesheet; uncached, an off-grid launch would draw unstyled.
  "/app.css",
  "/depth.js",
  // Sheet focus and the top-bar hairline on app.html.
  "/ui.js",
  "/email-signin.js",
  // The session and its refresh cookie; without it a cached page cannot sign in.
  "/session.js",
  // app.html runs on it before its own script does — uncached, no screen draws.
  "/journey.js",
  // "Near you" and road ETAs; it degrades to "needs a connection" offline.
  "/near.js",
  // Shrinks a hazard photo before upload; without it a report cannot attach one.
  "/photo-shrink.js",
  // The emergency numbers and the off-grid "Text my location" link. Off-grid is
  // exactly when the dialler is the only thing left that works.
  "/emergency-numbers.js",
  // Decides the position a booking is sent with; app.html's booking step needs it.
  "/booking-position.js",
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
  "/vendor/fonts/space-grotesk-latin.woff2",
  "/vendor/fonts/space-grotesk-latin-ext.woff2",
  "/vendor/fonts/inter-latin.woff2",
  "/vendor/fonts/inter-latin-ext.woff2",
  "/vendor/fonts/jetbrains-mono-latin.woff2",
  "/vendor/fonts/jetbrains-mono-latin-ext.woff2",
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
        keys.filter((k) => k !== SHELL && k !== TILES && k !== SCAN).map((k) => caches.delete(k)),
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

  // The road scan's model, engine and samples: cache-first, stored on first use.
  // A cached response keeps the headers it came with, so the engine's worker
  // script still carries the COEP header an isolated page requires of it.
  if (!key && SCAN_DIRS.some((d) => url.pathname.startsWith(d)) && !req.headers.has("range")) {
    event.respondWith(
      caches.open(SCAN).then(async (cache) => {
        // cache: "reload" is scan.js asking past a copy that failed its sha256
        // check: without this way round the cache, a wrong file stored once
        // was served on every reload, and "reload the page" could never help.
        const hit = req.cache === "reload" ? null : await cache.match(url.pathname);
        if (hit) return hit;
        const res = await fetch(req);
        if (cacheable(res)) await cache.put(url.pathname, res.clone()).catch(() => {});
        return res;
      }),
    );
    return;
  }

  // Anything else that is not a shell asset (media, 3D assets, feeds) goes to
  // the network untouched - including its Range requests and 206 answers.
  if (!key) return;

  // Scripts, styles and JSON: the network first, like the pages, with the cache
  // when it is slow or gone. Served cache-first, the first load after a deploy
  // ran the NEW page (network-first above) against the OLD scripts, and a page
  // and a script that changed together disagreed until the next load.
  if (/\.(m?js|css|json)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const fresh = fetch(req).then((res) => {
          if (cacheable(res)) cache.put(key, res.clone()).catch(() => {});
          return res;
        });
        const slow = new Promise((resolve) => setTimeout(resolve, 3000, null));
        const res = await Promise.race([fresh.catch(() => null), slow]);
        if (res) return res;
        return (await cache.match(key)) ?? (await fresh.catch(() => null)) ??
          new Response("", { status: 504, statusText: "offline and not cached" });
      }),
    );
    return;
  }

  // Fonts and icons: serve instantly from cache, refresh in the background.
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
