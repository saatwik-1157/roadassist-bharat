#!/usr/bin/env node
/**
 * Check a DEPLOYED RoadAssist against what this repository promises.
 *
 *   node scripts/verify-deployment.mjs https://roadassist.dpdns.org
 *
 * The suites already prove the code. This proves the thing on the internet,
 * which is a different claim: a deployment can serve a perfect application over
 * a broken certificate, or reintroduce a privacy leak through a static mount,
 * or quietly expose an OTP that lets anyone sign in as the authority. None of
 * those are visible from the source tree.
 *
 * Checks are FAIL (the deployment is wrong) or WARN (true, and you should know
 * it). A warning never fails the run - a free tier that sleeps is a fact about
 * the tier, not a defect in the deployment - but it is printed every time,
 * because the ones worth knowing are exactly the ones that get forgotten.
 */
import { argv, exit } from "node:process";

const BASE = (argv[2] ?? process.env.API ?? "").replace(/\/+$/, "");
if (!BASE) {
  console.error("usage: node scripts/verify-deployment.mjs https://your-deployment");
  exit(2);
}

const results = [];
const pass = (name, detail = "") => results.push({ state: "PASS", name, detail });
const fail = (name, detail = "") => results.push({ state: "FAIL", name, detail });
const warn = (name, detail = "") => results.push({ state: "WARN", name, detail });

/** A cold free tier can take a minute to wake; that is not a failure. */
async function get(path, { timeoutMs = 90_000, method = "GET" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { method, signal: ctrl.signal, redirect: "manual" });
    const body = await res.text().catch(() => "");
    return { res, body, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n  verifying ${BASE}\n`);

// ── 1. is it there at all ────────────────────────────────────────────────────
let first;
try {
  first = await get("/v1/ping");
} catch (e) {
  console.error(`  FAIL  unreachable — ${e.message}`);
  console.error(`\n  Nothing else can be checked. If this is a free tier it may be asleep;`);
  console.error(`  a cold start takes about a minute, so try once more before believing it.\n`);
  exit(1);
}

if (first.res.status === 200) {
  pass("reachable", `/v1/ping 200 in ${first.ms} ms`);
  if (first.ms > 10_000) {
    warn("cold start", `${Math.round(first.ms / 1000)}s to first byte — a sleeping free instance`);
  }
} else if (first.res.headers.get("x-render-routing") === "suspend") {
  fail("reachable", "the host reports the service is SUSPENDED, not merely asleep");
} else {
  fail("reachable", `/v1/ping returned ${first.res.status}`);
}

// ── 2. readiness tells the truth about the database ──────────────────────────
{
  const { res, body } = await get("/health");
  let json = null;
  try { json = JSON.parse(body); } catch { /* handled below */ }
  const db = json?.data?.database;

  if (res.status === 200 && db === "ok") {
    pass("database", `/health 200, database ok (${json?.data?.dbLatencyMs ?? "?"} ms)`);
  } else if (res.status === 503) {
    fail("database", `/health 503 — the app is up and its database is not: ${db ?? "unknown"}`);
  } else {
    fail("database", `/health ${res.status}, database=${db ?? "unknown"}`);
  }

  // The distinction the platform exists to make: "you have no network" is not
  // the same as "the platform is unwell", and /v1/ping must keep answering.
  if (res.status === 503 && first.res.status === 200) {
    pass("honest degradation", "/health 503 while /v1/ping 200 — the split still works");
  }
}

// ── 3. every surface it claims to serve ──────────────────────────────────────
for (const [path, what] of [
  ["/app.html", "citizen app"],
  ["/mechanic.html", "mechanic console"],
  ["/raksha.html", "authority dashboard"],
  ["/map.html", "live map"],
]) {
  const { res } = await get(path);
  if (res.status === 200) pass(`serves ${what}`, path);
  else fail(`serves ${what}`, `${path} -> ${res.status}`);
}

// ── 4. the privacy regression that already happened once ─────────────────────
// site/ is mounted at /media for demo video. Mounting it whole published half a
// dozen prototype pages that pulled webfonts from Google, so every visitor's IP
// left India to render a page nothing linked to. A 200 here means it is back.
{
  const { res } = await get("/media/app.html");
  if (res.status === 200) {
    fail("no prototype pages at /media", "/media/app.html is being served — the webfont leak is back");
  } else {
    pass("no prototype pages at /media", `/media/app.html -> ${res.status}`);
  }
}

// ── 5. residency, checked against what is actually served ────────────────────
// Stronger than the static gate: this reads the deployed HTML and looks for a
// third-party subresource, whatever the repository happens to say.
{
  const ALLOWED_CLIENT_HOSTS = ["checkout.razorpay.com"];   // Indian, and unavoidable
  const offenders = new Set();
  for (const path of ["/app.html", "/mechanic.html", "/raksha.html", "/map.html", "/landing.html"]) {
    const { res, body } = await get(path);
    if (res.status !== 200) continue;
    const subresource = /(?:\bsrc\s*=|<link[^>]*\bhref\s*=|@import\b|\burl\()\s*["']?(https?:\/\/[a-zA-Z0-9._-]+)/gi;
    for (const m of body.matchAll(subresource)) {
      const host = new URL(m[1]).hostname;
      if (host === new URL(BASE).hostname) continue;
      if (ALLOWED_CLIENT_HOSTS.includes(host)) continue;
      offenders.add(`${host} (${path})`);
    }
  }
  if (offenders.size === 0) {
    pass("no served page makes the browser contact a third party", "no third-party subresource in any served page");
  } else {
    fail("no served page makes the browser contact a third party", [...offenders].join(", "));
  }
}

// ── 6. transport ─────────────────────────────────────────────────────────────
if (BASE.startsWith("https://")) {
  pass("TLS", "served over https");
  const { res } = await get("/app.html");
  const hsts = res.headers.get("strict-transport-security");
  if (hsts) pass("HSTS", hsts);
  else warn("HSTS", "no Strict-Transport-Security header");
  const csp = res.headers.get("content-security-policy");
  if (csp) pass("CSP", csp.slice(0, 60) + (csp.length > 60 ? "…" : ""));
  else warn("CSP", "no Content-Security-Policy header");
} else if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE)) {
  warn("TLS", "plain http, but this is localhost — fine for a smoke test, never for a deployment");
} else {
  fail("TLS", "not https — an OTP and a JWT would cross the network in clear text");
}

// ── 7. the door that is deliberately open ────────────────────────────────────
// EXPOSE_DEV_OTP is what makes a demo usable with no SMS provider, and it means
// anyone with the URL can sign in as any seeded account, the authority included.
{
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let exposed = null;
  try {
    const res = await fetch(BASE + "/v1/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msisdn: "+919999999999" }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    exposed = Boolean(json?.meta?.devOtp);
  } catch { /* leave null */ } finally { clearTimeout(timer); }

  if (exposed === true) {
    warn("dev OTP is exposed",
      "the API returns the code, so ANYONE with this URL can sign in as any seeded " +
      "account including the authority — intended for a demo, never with real data");
  } else if (exposed === false) {
    pass("dev OTP not exposed", "codes are not returned in the response");
  } else {
    warn("dev OTP", "could not determine — the OTP endpoint did not answer as expected");
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((r) => r.name.length));
console.log();
for (const r of results) {
  const mark = r.state === "PASS" ? "✓" : r.state === "WARN" ? "!" : "✗";
  console.log(`  ${mark} ${r.state.padEnd(4)} ${r.name.padEnd(width)}  ${r.detail}`);
}

const failed = results.filter((r) => r.state === "FAIL");
const warned = results.filter((r) => r.state === "WARN");
console.log(`\n  ${results.length - failed.length - warned.length} passed · ${warned.length} warned · ${failed.length} failed\n`);

if (failed.length) {
  console.error("  This deployment does not match what the repository promises.\n");
  exit(1);
}
console.log("  The deployment matches what the repository promises.\n");
