#!/usr/bin/env node
/**
 * Non-negotiable #4, made enforceable: no PII leaves India.
 *
 * The claim is in the README, the team charter and the RAKSHA requirements. It
 * was enforced by nobody, which is the same shape of problem the claims and
 * citation gates exist for: the most serious promise in the project was the one
 * thing no mechanism checked.
 *
 * The distinction this gate turns on is WHO makes the request, because that
 * decides whose address is disclosed:
 *
 *   * A host in a page the browser loads is fetched BY THE VISITOR. Their IP
 *     address reaches that third party, and an IP is personal data. There is no
 *     allowlist for this: a page served to a user may only load from itself.
 *
 *   * A host in server or client-app code is fetched BY US. No visitor address
 *     is disclosed, and where the data lands is a decision we can document. So
 *     those are allowed, but only when declared below with a region and a
 *     reason — an undeclared one fails, because "we always meant to check" is
 *     how the font CDN got in.
 *
 * Third: analytics and crash-reporting SDKs ship device identifiers and stack
 * traces abroad by default. The charter names them explicitly ("including logs,
 * backups, error reports, and third-party analytics"), so they are refused
 * outright rather than configured carefully.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SELF = "check-data-residency.mjs";

/**
 * Hosts our own code may contact, each with where the data lands and why that
 * is acceptable. Adding a row here is a deliberate act with a reviewer.
 */
const DECLARED_EGRESS = {
  "api.msg91.com":
    "INDIA - SMS provider, Indian company and Indian data centres. Carries a phone number " +
    "and the message body. This is the default provider (ADR-0005 telecom path).",
  "api.razorpay.com":
    "INDIA - Razorpay Software Pvt Ltd, Bengaluru. Carries order and payment references, " +
    "never card data, which goes to the gateway origin from the browser instead.",
  "tile.openstreetmap.org":
    "OUTSIDE INDIA (EU) - basemap tiles fetched SERVER-SIDE and cached, so no visitor address " +
    "reaches it. Carries tile coordinates only: never a user identifier, and never a position " +
    "a user chose.",
  "ndownloader.figshare.com":
    "OUTSIDE INDIA - the RDD2022 training dataset is downloaded from here at TRAINING time only. " +
    "Carries nothing: it is an outbound download, never reached by the running platform.",
  "api.open-meteo.com":
    "OUTSIDE INDIA (Germany) - trip weather for GET /v1/trip/prepare (raksha.ts forecast()). " +
    "Carries only two FIXED corridor points - the midpoints of the first and last monitored road " +
    "segments, read from road_segments - never a user's position: the route takes no coordinates " +
    "at all. Server-side (no visitor IP), degrades to null. (This note used to say the call carried " +
    "the user's coordinates; the code has never sent them.)",
  "api.resend.com":
    "OUTSIDE INDIA (USA) - OPTIONAL operator alerts, off unless ALERT_EMAIL_TO is set, and sent " +
    "SERVER-SIDE so no visitor address reaches it. Each email carries a phone number MASKED to its " +
    "last three digits, a role, an event and a time, addressed to the project owner. Never a name, " +
    "a position, an IP address or a device - apps/api/test/alerts.test.ts fails if the number leaks.",
  "nominatim.openstreetmap.org":
    "OUTSIDE INDIA (OSMF, EU) - addresses for a point (routes/geo.ts). Carries a signed-in user's " +
    "position COARSENED to 3 decimals (~110 m) - still personal data, so it is in the same tension " +
    "with non-negotiable #4. Server-side, cached 24 h, one request a second, off in " +
    "development/test/CI. The production answer is a self-hosted Nominatim in an Indian region.",
  "overpass-api.de":
    "OUTSIDE INDIA (Germany) - nearest hospitals, police, fuel, EV chargers and repair shops " +
    "(routes/geo.ts). Carries a search point coarsened to 2 decimals (~1 km) and a radius. " +
    "Server-side, cached 6 h, paced.",
  "router.project-osrm.org":
    "OUTSIDE INDIA (FOSSGIS, Germany) - road distance and driving time between a mechanic and a " +
    "customer (routes/geo.ts). Carries both points coarsened to ~110 m, no identifier. Demo router: " +
    "fair use only, so server-side, cached, one request a second.",
  "air-quality-api.open-meteo.com":
    "OUTSIDE INDIA (Germany) - air quality for the RAKSHA corridor report. Carries only the fixed " +
    "corridor segment midpoints, never a user's position.",
  "earthquake.usgs.gov":
    "OUTSIDE INDIA (USA) - recent earthquakes in and around India for the RAKSHA dashboard. " +
    "Carries nothing about any user: a fixed bounding box and a date.",
  "api.telegram.org":
    "OUTSIDE INDIA (Telegram FZ-LLC, Dubai; data centres outside India) - OPTIONAL, free SOS alerts " +
    "to emergency contacts (providers.ts, routes/telegram.ts), off unless TELEGRAM_BOT_TOKEN, " +
    "TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET are all set. Sent SERVER-SIDE, so no visitor " +
    "address reaches it, and only to a chat whose owner opened a one-time invite and pressed Start. " +
    "An SOS alert carries the user's FIRST NAME, the incident reference, the time and the POSITION " +
    "as a map link - personal data, in the same tension with non-negotiable #4 as Nominatim, and " +
    "accepted because the alternative on the demo is that nobody is told. Never a phone number " +
    "(apps/api/test/telegram.test.ts fails if one appears).",
  "oauth2.googleapis.com":
    "OUTSIDE INDIA (Google LLC, USA; global infrastructure) - OPTIONAL Sign in with Google " +
    "(routes/google-auth.ts), off unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI " +
    "are all set. SERVER-SIDE: the authorization code a person's own browser brought back is exchanged " +
    "here, with the PKCE verifier and the client secret, for an ID token. Carries no visitor address and " +
    "nothing about the person beyond that one-time code; what comes back is Google's statement of the " +
    "account the PERSON chose to sign in with, and only its subject id and verified email are stored.",
  "www.googleapis.com":
    "OUTSIDE INDIA (Google LLC, USA) - Google's public signing keys (/oauth2/v3/certs), fetched " +
    "SERVER-SIDE to verify an ID token's signature and cached as long as Google's Cache-Control allows. " +
    "Carries nothing at all: a GET of a public document.",
  "api.twilio.com":
    "OUTSIDE INDIA (USA) - an OPTIONAL fallback SMS provider, selected only by setting " +
    "SMS_PROVIDER=twilio. Carries a phone number and message body, so enabling it for Indian " +
    "users would breach non-negotiable #4. MSG91 is the default and the only provider used in " +
    "any documented run.",
};

/**
 * Third parties a PAGE may load, because there is no alternative and the
 * company is Indian. A payment gateway must be loaded from the gateway's own
 * origin - PCI scope is exactly why it cannot be proxied through us.
 */
const DECLARED_CLIENT_EGRESS = {
  "checkout.razorpay.com":
    "India - Razorpay Software Pvt Ltd, Bengaluru; card data must load from the gateway origin " +
    "and must never touch our servers",
};

/**
 * Hosts the SERVER sends a visitor's browser to with a redirect, after the
 * visitor clicked something that says where it goes. Neither of the two
 * categories above fits these honestly: the server never fetches them (so they
 * are not our egress), and no page loads them (so the page rule holds), but
 * the visitor's own browser does reach them - because they chose to.
 *
 * "Continue with Google" is a plain link to this origin's /v1/auth/google/start,
 * which answers 302 to Google's consent screen. Nothing reaches Google until
 * that click; the page loads no Google script, iframe, font or image, and the
 * gate below fails if one ever names a Google sign-in host at all.
 */
const DECLARED_NAVIGATION = {
  "accounts.google.com":
    "OUTSIDE INDIA (Google LLC) - Google's sign-in and consent screen. Reached only by a top-level " +
    "NAVIGATION the visitor starts by pressing \"Continue with Google\" or \"Link Google\": their browser " +
    "follows our 302 there, so their address reaches Google as it does on any visit to Google, by their " +
    "choice. Off unless Google sign-in is configured. Never fetched by the server, never loaded by a page.",
};

/**
 * Google sign-in hosts no page may name - not even as a link. The pages reach
 * Google only through the server's redirect (DECLARED_NAVIGATION), so a page
 * that mentions one of these is loading Google's sign-in script or button,
 * which would contact Google on every page view, before anybody clicks.
 */
const SIGNIN_HOSTS_FORBIDDEN_IN_PAGES = /(accounts\.google\.com|apis\.google\.com|[a-z0-9.-]*gstatic\.com|gsi\/client)/i;

/** Local, private and placeholder addresses are never third parties. */
const NOT_THIRD_PARTY = [
  /^localhost$/i, /^127\.\d+\.\d+\.\d+$/, /^0\.0\.0\.0$/, /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/, /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^\[?::1\]?$/, /^roadassist\.(local|in)$/i,
  /^([a-z0-9-]+\.)*example\.(com|in|org|net)$/i,
  /^x$/i,
  // XML and document namespaces. These are identifiers, not addresses: nothing
  // is ever fetched from them.
  /^(www\.)?w3\.org$/i, /^schemas\.(openxmlformats|microsoft)\.com$/i,
  /^graphml\.graphdrawing\.org$/i, /^purl\.org$/i,
];

/** SDKs whose purpose is to send telemetry to somebody else's servers. */
const TELEMETRY_SDKS = [
  "crashlytics", "firebase-analytics", "firebaseanalytics", "google-analytics",
  "googletagmanager", "@sentry/", "sentry-sdk", "mixpanel", "bugsnag",
  "appcenter", "segment.com", "analytics.js", "posthog", "datadog-rum",
];

/** Field names that must never be built into a URL path or query string. */
const PII_IN_URL = /[?&/](msisdn|phone|mobile|email|aadhaar|aadhar|pan|dob|otp|password)=/i;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".claude", ".venv", ".venv-gpu", "venv", "__pycache__", "build", "dist",
  ".gradle", ".idea", "runs", "outputs", "coverage", "test-results", "presentation",
]);

/**
 * What the browser loads, and therefore what discloses a visitor's address.
 *
 * `site/` is deliberately NOT here. It holds demo video, and the API serves
 * it at /media/ with a media-type filter. It once also held prototype pages
 * that pulled webfonts from Google (removed in September 2026); the filter
 * stays, and `checkMediaMountIsFiltered` below asserts it still exists, so an
 * HTML page dropped into site/ can never be published by accident.
 */
const CLIENT_ROOTS = ["app/apps/web", "pages"];   // pages/ is the public GitHub Pages showcase
/** What we run ourselves. */
const SERVER_ROOTS = ["app/apps/api/src", "app/packages", "app/scripts", "mobile/app/src/main", "ai"];

const CLIENT_EXT = new Set([".html", ".css", ".js"]);
const SERVER_EXT = new Set([".ts", ".kt", ".mjs", ".js", ".py"]);

const violations = [];
const seenDeclared = new Set();
const seenNavigation = new Set();

const URL_RE = /https?:\/\/([a-zA-Z0-9._-]+)/g;

/**
 * A hyperlink discloses nothing until somebody clicks it, and that is their
 * choice. Only a SUBRESOURCE - something the browser fetches on its own while
 * rendering - leaks a visitor's address, so only these count.
 */
const SUBRESOURCE = /(\bsrc\s*=|<link\b[^>]*\bhref\s*=|@import\b|\burl\(|\bfetch\(|\bimport\(|rel\s*=\s*["']?(preconnect|dns-prefetch|preload|stylesheet))/i;

/**
 * A server-side URL only matters if we actually call it. The last alternative
 * is any function handed a URL literal as its first argument - a wrapper such
 * as routes/geo.ts's getJson("https://…") is a call like any other, and the
 * pattern list without it let exactly that line through unseen.
 */
const OUTBOUND_CALL = /(\bfetch\(|\brequests?\.(get|post|put)|\burlopen\(|HttpURLConnection|\baxios|\b(base|url|endpoint|host|origin|uri)\b\s*[:=]|["'`]\s*\+|\$\{|\b[A-Za-z_$][\w$]*\(\s*["'`]https?:\/\/)/i;

function within(rel, roots) {
  return roots.some((r) => rel === r || rel.startsWith(r + "/"));
}

function isThirdParty(host) {
  return !NOT_THIRD_PARTY.some((re) => re.test(host));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (entry === SELF) continue;

    const rel = relative(ROOT, full).split(sep).join("/");
    // Vendored third-party code is checked for what it FETCHES, but a bundled
    // library naming its own homepage is not egress.
    const vendored = rel.includes("/vendor/");
    const ext = extname(entry).toLowerCase();
    const client = within(rel, CLIENT_ROOTS) && CLIENT_EXT.has(ext);
    const server = within(rel, SERVER_ROOTS) && SERVER_EXT.has(ext);
    if (!client && !server) continue;

    check(full, rel, client, vendored);
  }
}

function check(full, rel, client, vendored) {
  const text = readFileSync(full, "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    // A comment explaining why a host was REMOVED must not re-trip the gate.
    const isComment = /^\s*(\/\/|\*|#|<!--)/.test(line);

    if (client && !vendored && !isComment && SIGNIN_HOSTS_FORBIDDEN_IN_PAGES.test(line)) {
      violations.push(`${at}: a page names a Google sign-in host. Pages reach Google only by the ` +
        `server's redirect from /v1/auth/google/start, never by loading or linking Google themselves.`);
    }

    for (const m of line.matchAll(URL_RE)) {
      const host = m[1].replace(/\.$/, "");
      if (!isThirdParty(host)) continue;
      if (isComment) continue;

      if (client) {
        if (!SUBRESOURCE.test(line)) continue;          // a link, not a load
        // rel="canonical" and rel="alternate" are METADATA. They name a URL for
        // a search engine; the browser never fetches them, so they disclose
        // nothing. Without this a page cannot state its own canonical URL
        // without tripping a check about third-party loads.
        if (/rel\s*=\s*["']?(canonical|alternate)/i.test(line)) continue;
        if (host in DECLARED_CLIENT_EGRESS) { seenDeclared.add(host); continue; }
        // A vendored library is reviewed once, when it is vendored, and then it
        // is a fixed artefact. Minified bundles carry their own homepage in an
        // attribution string on the same line as unrelated `url(` calls, which
        // is not egress - Leaflet's only hosts are its homepage and the SVG
        // namespace, and it fetches neither.
        if (vendored) continue;
        violations.push(
          `${at}: a page the browser loads reaches ${host} - the visitor's IP address leaves India. ` +
          `Serve it from this origin instead.`);
      } else if (vendored) {
        // fall through: a vendored library's own URL is not our egress
      } else if (host in DECLARED_NAVIGATION) {
        // A redirect target the visitor's browser follows after their click, not a fetch of ours.
        seenNavigation.add(host);
      } else if (!OUTBOUND_CALL.test(line)) {
        // a URL printed in help text or quoted in a message is not egress
      } else if (!(host in DECLARED_EGRESS)) {
        violations.push(
          `${at}: undeclared outbound host ${host}. Add it to DECLARED_EGRESS with a region and a reason, ` +
          `or stop calling it.`);
      } else {
        seenDeclared.add(host);
      }
    }

    if (!isComment && PII_IN_URL.test(line)) {
      violations.push(`${at}: personal data in a URL - ${line.trim().slice(0, 80)}`);
    }

    if (!isComment && !vendored) {
      const low = line.toLowerCase();
      for (const sdk of TELEMETRY_SDKS) {
        if (low.includes(sdk)) {
          violations.push(`${at}: telemetry SDK "${sdk}" - ships identifiers and stack traces abroad by default`);
          break;
        }
      }
    }
  });
}

/**
 * The /media/ mount must stay media-only.
 *
 * This is a structural check rather than a textual one: mounting site/ whole
 * published half a dozen prototype pages at /media/*.html, every one of them
 * loading webfonts from Google. Nothing linked to them, so nothing noticed.
 */
function checkMediaMountIsFiltered() {
  const server = join(ROOT, "app", "apps", "api", "src", "server.ts");
  let text;
  try { text = readFileSync(server, "utf8"); } catch { return; }

  const mount = /fastifyStatic,\s*{[^}]*prefix:\s*["']\/media\/["'][^}]*}/s.exec(text);
  if (!mount) {
    violations.push("app/apps/api/src/server.ts: the /media/ static mount has moved or gone - " +
      "this check can no longer confirm it is media-only, so update it deliberately.");
    return;
  }
  if (!/allowedPath\s*:/.test(mount[0])) {
    violations.push("app/apps/api/src/server.ts: the /media/ mount lost its allowedPath filter. " +
      "Serving site/ whole would publish any HTML page placed there - the prototype pages it once " +
      "held loaded webfonts from Google, so every visitor's IP address left India.");
  }
}

walk(ROOT);
checkMediaMountIsFiltered();

if (violations.length) {
  console.error("✗ data residency: something leaves India that should not\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error(`
Non-negotiable #4 is "No PII leaves India - including logs, backups and crash
reports". If one of these is genuinely acceptable, it belongs in DECLARED_EGRESS
in this file with the region it lands in, not in a comment somewhere.`);
  process.exit(1);
}

const declared = Object.keys(DECLARED_EGRESS).filter((h) => seenDeclared.has(h));
console.log(
  // What this gate proves is about third parties, not about where the platform
  // itself runs: the hosted demo is in Singapore (no free tier offers an Indian
  // region), so "nothing leaves India" would be a claim this check cannot make.
  `✓ data residency: no page makes a visitor's browser contact a third party; ` +
  `${declared.length} declared server-side egress host${declared.length === 1 ? "" : "s"}` +
  (declared.length ? ` (${declared.join(", ")})` : "") +
  (seenNavigation.size ? `; ${seenNavigation.size} declared click-through navigation (${[...seenNavigation].join(", ")})` : ""));
