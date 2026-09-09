#!/usr/bin/env node
/**
 * Capture screenshots of the RUNNING application.
 *
 * Every image this produces is a photograph of the real system doing the real
 * thing — it signs in against the live API, creates a real booking, runs a real
 * diagnosis, and drives the connectivity toggle to reach off-grid mode. Nothing
 * is mocked, staged or drawn.
 *
 * That matters because a deck full of hand-made mockups is indistinguishable
 * from a deck full of screenshots until somebody asks to see the app. These are
 * regenerable in ninety seconds, so they can never drift from the product.
 *
 *   npm start                       # in another shell
 *   node scripts/capture-screens.mjs
 *   node scripts/capture-screens.mjs --headed    # watch it happen
 *
 * Output: docs/screenshots/*.png at 2x device pixel ratio.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const HEADED = process.argv.includes("--headed");
const PORT = 9444;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }
  async waitFor(cond, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await this.eval(`return Boolean(${cond});`)) return true; } catch { /* mid-navigation */ }
      await sleep(150);
    }
    throw new Error(`timed out waiting for: ${cond}`);
  }
  /** Viewport size + device pixel ratio, so a phone shot looks like a phone. */
  async viewport(width, height, mobile = true) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 2, mobile,
    });
  }
  /**
   * Refuse to capture the wrong screen.
   *
   * The first run of this script produced three screenshots of a *validation
   * error* — the random registration it generated was malformed, the vehicle
   * was never added, and the flow silently stayed on the form. The images
   * looked plausible at a glance and would have gone into a deck. A capture
   * step now has to assert what it is looking at before it presses the shutter.
   */
  async expect(condition, what) {
    const okNow = await this.eval(`return Boolean(${condition});`);
    if (!okNow) throw new Error(`expected ${what}, but the page does not show it`);
  }

  async shot(name, caption) {
    await sleep(500);                                  // let animations settle
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push({ name, caption });
    console.log(`  ✓ ${name}.png  — ${caption}`);
  }
}

async function launch() {
  if (!CHROME) throw new Error("Chrome not found");
  const profile = mkdtempSync(join(tmpdir(), "ra-shot-"));
  const args = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    // A real fix so SOS screenshots show a real position rather than "unknown".
    `--unsafely-treat-insecure-origin-as-secure=${BASE}`,
    ...(HEADED ? [] : ["--headless=new"]),
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ];
  const proc = spawn(CHROME, [...args, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* starting */ }
    await sleep(250);
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const page = new Page(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return { page, proc, profile };
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const { page, proc, profile } = await launch();
  const cleanup = () => {
    try { proc.kill(); } catch { /* gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* leave it */ }
  };

  try {
    await page.send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] });
    await page.send("Emulation.setGeolocationOverride", { latitude: 28.4601, longitude: 77.0301, accuracy: 12 });

    // ── customer app, phone-sized ────────────────────────────────────────
    console.log("\ncustomer app (390×844, 2x)");
    await page.viewport(390, 844);
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("a-send")`);
    await page.shot("01-login", "OTP sign-in — real API, dev OTP returned in the response");

    const msisdn = "+91" + (9000000000 + Math.floor(Math.random() * 899999999));
    await page.eval(`
      document.getElementById("a-msisdn").value = ${JSON.stringify(msisdn)};
      document.getElementById("a-send").click(); return true;`);
    await page.waitFor(`document.getElementById("a-step2").hidden === false`);
    await page.eval(`
      const r = await fetch("/v1/auth/otp/request", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msisdn: ${JSON.stringify(msisdn)} }) });
      const j = await r.json();
      document.getElementById("a-code").value = j.meta.devOtp;
      document.getElementById("a-verify").click(); return true;`);
    await page.waitFor(`document.getElementById("tabs").hidden === false`, 20000);
    await page.shot("02-home", "Home — SOS, emergency readiness, quick actions");

    // TS09 AB 1234 — two LETTERS then four digits. base36 could yield a digit
    // in the letter positions, which the client (correctly) rejected.
    const L = () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
    const reg = "TS09" + L() + L() + Math.floor(1000 + Math.random() * 8999);
    await page.eval(`
      document.getElementById("v-reg").value = ${JSON.stringify(reg)};
      document.getElementById("v-class").value = "car";
      document.getElementById("v-nickname").value = "Amma's Swift";
      document.getElementById("v-add").click();
      await new Promise(r => setTimeout(r, 2000)); return true;`);
    await page.expect(
      `document.getElementById("vehicle-card") && !document.getElementById("vehicle-card").hidden`,
      "the vehicle card after adding a vehicle");
    // Scroll to the card. Without this the shot is the top of Home again and
    // sits next to 02-home looking like a duplicate — technically real, and
    // useless as evidence that a vehicle was added.
    await page.eval(`
      document.getElementById("vehicle-card").scrollIntoView({ block: "center" });
      await new Promise(r => setTimeout(r, 700)); return true;`);
    await page.shot("03-vehicle", "Vehicle added — dispatch is against a specific vehicle");

    await page.eval(`
      document.querySelector('.tab[data-nav="book"]').click();
      document.getElementById("b-symptoms").value = "Won't start, clicking sound";
      document.getElementById("b-diagnose").click();
      await new Promise(r => setTimeout(r, 2200)); return true;`);
    await page.expect(`/batter/i.test(document.getElementById("b-diag").innerText)`,
      "a diagnosis result naming a cause");
    // The result renders below the fold on a 390px viewport; a screenshot of the
    // form above it would be technically real and useless.
    await page.eval(`
      document.getElementById("b-diag").scrollIntoView({ block: "start" });
      await new Promise(r => setTimeout(r, 700)); return true;`);
    await page.shot("04-ai-diagnosis", "Diagnosis — cause, confidence, severity, safety action, engine version");

    await page.eval(`
      document.getElementById("b-book").click();
      await new Promise(r => setTimeout(r, 5000)); return true;`);
    await page.expect(
      `/mechanic|offer|assigned|matching/i.test(document.getElementById("scr-book").innerText)`,
      "dispatch offers or an assignment");
    await page.eval(`
      const el = document.getElementById("b-offers") || document.getElementById("b-progress");
      if (el) el.scrollIntoView({ block: "start" });
      await new Promise(r => setTimeout(r, 700)); return true;`);
    await page.shot("05-dispatch", "Dispatch — ranked offers with distance, ETA and score");

    // Accept the first offer so the tracking screen has a real assignment on it.
    await page.eval(`
      const accept = document.querySelector("#b-offers button, .offer button, [id^='acc-']");
      if (accept) accept.click();
      await new Promise(r => setTimeout(r, 3000));
      document.querySelector('.tab[data-nav="track"]')?.click();
      await new Promise(r => setTimeout(r, 1500)); return true;`);
    await page.shot("06-tracking", "Tracking — live status, provider, ETA, last updated");

    // ── the emergency and off-grid story ─────────────────────────────────
    console.log("\noff-grid mode");
    await page.eval(`
      location.hash = "#home";
      await new Promise(r => setTimeout(r, 500));
      document.getElementById("net").click();          // simulate off-grid
      await new Promise(r => setTimeout(r, 900)); return true;`);
    await page.shot("07-offline-banner", "OFF-GRID — the indicator and banner say what still works");

    await page.eval(`
      document.querySelector('.tab[data-nav="book"]').click();
      document.getElementById("b-symptoms").value = "Won't start, clicking sound";
      document.getElementById("b-diagnose").click();
      await new Promise(r => setTimeout(r, 2000));
      document.getElementById("b-diag").scrollIntoView({ block: "start" });
      await new Promise(r => setTimeout(r, 700)); return true;`);
    await page.expect(`/LOCAL OFFLINE DIAGNOSIS/.test(document.getElementById("b-diag").innerText)`,
      "the local offline diagnosis label");
    await page.shot("08-offline-diagnosis", "LOCAL OFFLINE DIAGNOSIS — on-device rules engine, labelled");

    await page.eval(`
      document.querySelector('.tab[data-nav="home"]').click();
      await new Promise(r => setTimeout(r, 400));
      document.getElementById("sos").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise(r => setTimeout(r, 2600)); return true;`);
    await page.expect(`/OFF-GRID SOS CREATED/i.test(document.getElementById("sos-out").innerText)`,
      "the off-grid SOS confirmation");
    await page.shot("09-offgrid-sos", "OFF-GRID SOS CREATED — 'Nothing has been transmitted'");

    await page.eval(`
      document.getElementById("og-close")?.click();
      location.hash = "#offgrid";
      await new Promise(r => setTimeout(r, 1200)); return true;`);
    await page.expect(`/RA-[A-Z0-9]{6}/.test(document.getElementById("scr-offgrid").innerText)`,
      "the stored incident reference on the off-grid screen");
    await page.shot("10-offgrid-screen", "Off-grid incident — reference, GPS, available vs unavailable");

    await page.eval(`
      document.getElementById("net").click();          // reconnect
      await new Promise(r => setTimeout(r, 5000)); return true;`);
    await page.expect(`/synchroniz/i.test(document.getElementById("scr-offgrid").innerText)`,
      "the synchronisation result on the off-grid screen");
    await page.shot("11-sync-complete", "SOS SYNCHRONIZED — journal empty, platform reference returned");

    await page.eval(`
      document.querySelector('.tab[data-nav="activity"]').click();
      await new Promise(r => setTimeout(r, 1600)); return true;`);
    await page.shot("12-activity", "Activity — bookings and hazard reports");

    // ── mechanic console, tablet width ───────────────────────────────────
    console.log("\nmechanic console (1280×860)");
    await page.viewport(1280, 860, false);
    await page.goto(`${BASE}/mechanic.html`);
    await page.waitFor(`document.getElementById("m-msisdn")`);
    await page.shot("13-mechanic-login", "Mechanic console sign-in");

    // ── authority dashboard ──────────────────────────────────────────────
    console.log("\nauthority dashboard + map");
    await page.goto(`${BASE}/raksha.html`);
    await page.waitFor(`document.getElementById("login-btn")`);
    await page.eval(`
      document.getElementById("msisdn").value = "+919999900001";
      document.getElementById("login-btn").click(); return true;`);
    try {
      await page.waitFor(`document.getElementById("login-panel").hidden === true`, 25000);
      await sleep(2500);
      await page.shot("14-authority", "RAKSHA authority dashboard — live map, road health, detections");
    } catch {
      console.log("  – authority dashboard skipped (seed operator absent)");
    }

    // ── the citizen live map ─────────────────────────────────────────────
    // Its own capture because it is the clearest single picture of the
    // geospatial tier: clustered mechanics, responders and detections drawn
    // from real PostGIS rows, not a static image.
    console.log("\nlive map");
    await page.viewport(430, 900, true);
    await page.goto(`${BASE}/map.html`);
    try {
      await page.waitFor(
        `document.querySelectorAll(".leaflet-marker-icon, .marker-cluster").length > 0`, 25000);
      await sleep(2500);
      await page.expect(`document.querySelectorAll(".leaflet-marker-icon, .marker-cluster").length > 0`,
        "live markers drawn on the map");
      await page.shot("18-live-map", "RAKSHA live map — clustered mechanics, responders and detections");
    } catch {
      console.log("  – live map skipped (no markers rendered)");
    }

    await page.viewport(1280, 860, false);
    await page.goto(`${BASE}/index.html`);
    await sleep(2200);
    await page.shot("15-landing", "Product landing page");

    // A manifest so the deck and the docs reference captured files, never
    // hand-picked ones that might not exist.
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
      capturedAt: new Date().toISOString(), base: BASE, shots,
    }, null, 2));
    console.log(`\n${shots.length} screenshots written to docs/screenshots/`);
  } catch (e) {
    console.error("\ncapture failed:", e.message);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
};

run();
