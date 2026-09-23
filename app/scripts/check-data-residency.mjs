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
    "OUTSIDE INDIA (Germany) - trip weather. Carries the USER'S COORDINATES, which is personal " +
    "data, so this is the one declared host that sits in tension with non-negotiable #4. It is " +
    "server-side (no visitor IP) and degrades to null, but the position is real. Coarsening the " +
    "coordinates before the call, or dropping the feature, is an open decision - see ADR-0011 " +
    "for the shape of that argument.",
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
  "node_modules", ".git", ".venv", "venv", "__pycache__", "build", "dist",
  ".gradle", ".idea", "runs", "outputs", "coverage", "test-results", "presentation",
]);

/**
 * What the browser loads, and therefore what discloses a visitor's address.
 *
 * `site/` is deliberately NOT here. It holds demo video plus some dead
 * prototype pages, and the API serves it at /media/ with a media-type filter,
 * so those pages are unreachable. That filter is the whole protection, so
 * `checkMediaMountIsFiltered` below asserts it still exists - without it the
 * prototypes return, and each one pulls webfonts from Google.
 */
const CLIENT_ROOTS = ["app/apps/web"];
/** What we run ourselves. */
const SERVER_ROOTS = ["app/apps/api/src", "app/packages", "app/scripts", "mobile/app/src/main", "ai"];

const CLIENT_EXT = new Set([".html", ".css", ".js"]);
const SERVER_EXT = new Set([".ts", ".kt", ".mjs", ".js", ".py"]);

const violations = [];
const seenDeclared = new Set();

const URL_RE = /https?:\/\/([a-zA-Z0-9._-]+)/g;

/**
 * A hyperlink discloses nothing until somebody clicks it, and that is their
 * choice. Only a SUBRESOURCE - something the browser fetches on its own while
 * rendering - leaks a visitor's address, so only these count.
 */
const SUBRESOURCE = /(\bsrc\s*=|<link\b[^>]*\bhref\s*=|@import\b|\burl\(|\bfetch\(|\bimport\(|rel\s*=\s*["']?(preconnect|dns-prefetch|preload|stylesheet))/i;

/** A server-side URL only matters if we actually call it. */
const OUTBOUND_CALL = /(\bfetch\(|\brequests?\.(get|post|put)|\burlopen\(|HttpURLConnection|\baxios|\b(base|url|endpoint|host|origin|uri)\b\s*[:=]|["'`]\s*\+|\$\{)/i;

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

    for (const m of line.matchAll(URL_RE)) {
      const host = m[1].replace(/\.$/, "");
      if (!isThirdParty(host)) continue;
      if (isComment) continue;

      if (client) {
        if (!SUBRESOURCE.test(line)) continue;          // a link, not a load
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
      "site/ holds prototype pages that load webfonts from Google; serving the directory whole " +
      "publishes them and every visitor's IP address leaves India.");
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
  `✓ data residency: no visitor address leaves India; ` +
  `${declared.length} declared server-side egress host${declared.length === 1 ? "" : "s"}` +
  (declared.length ? ` (${declared.join(", ")})` : ""));
