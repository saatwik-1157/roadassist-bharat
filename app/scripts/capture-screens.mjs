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
// SHOTS_OUT writes somewhere else - a trial run that should not touch the
// committed captures until every shot in it has been looked at.
const OUT = process.env.SHOTS_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The session this run signed in with, and the bookings it must hand back.
 *
 * This script accepts a real offer so the tracking shot has a real assignment
 * on it, and then never completes or cancels that booking. Every run therefore
 * retired one mechanic from the pool permanently. Three runs in an afternoon
 * emptied the demo radius, and the next `npm run test:e2e` failed on
 * "dispatch ran status=NO_SUPPLY / 0 offers" — a failure that looks like a
 * dispatch bug and is really this script's litter. The concurrency suite has
 * released its providers since the same thing bit it; this does the same.
 */
let sessionToken = "";
let assignedMech = "";
const ACTIVE = ["MATCHING", "ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS",
                "AWAITING_PARTS", "ESCALATED"];

async function releaseBookings() {
  if (!sessionToken) return { total: 0, stillHolding: 0 };
  const auth = { authorization: `Bearer ${sessionToken}` };
  const list = await fetch(`${BASE}/v1/bookings`, { headers: auth }).then((r) => r.json());
  const held = (list.data ?? []).filter((b) => ACTIVE.includes(b.status));
  let stillHolding = 0;
  for (const b of held) {
    await fetch(`${BASE}/v1/bookings/${b.id}/transition`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ command: "cancel" }),
    }).catch(() => {});
    const after = await fetch(`${BASE}/v1/bookings/${b.id}`, { headers: auth })
      .then((r) => r.json()).catch(() => ({}));
    if (ACTIVE.includes(after.data?.status)) stillHolding++;
  }
  return { total: held.length, stillHolding };
}
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

  /**
   * Wait for the page to be in a state worth photographing.
   *
   * Three things made a capture look half-loaded or staged without failing
   * anything: a webfont still swapping in (the 2026-10 redesign self-hosts
   * Space Grotesk, Inter and JetBrains Mono, and a shot taken before
   * document.fonts.ready is set in the fallback face); an <img> still
   * decoding; and a status toast ("Payment successful", "Signed in") parked
   * over the content it describes. The toast clears itself after 3.2 s
   * (app.html toast()); this waits for that rather than racing it, and only
   * hides one that outlives the wait.
   */
  async settle() {
    await this.eval(`
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const t0 = Date.now();
      while (document.querySelector(".toast.show") && Date.now() - t0 < 4500) {
        await new Promise(r => setTimeout(r, 100));
      }
      document.querySelectorAll(".toast.show").forEach(t => t.classList.remove("show"));
      await Promise.all([...document.images].filter(i => !i.complete).map(i =>
        new Promise(r => { i.addEventListener("load", r, { once: true });
          i.addEventListener("error", r, { once: true }); setTimeout(r, 4000); })));
      return true;`);
  }

  async shot(name, caption) {
    await this.settle();
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
  // Dark, as every published capture has been: headless Chrome reports a light
  // scheme, and the apps follow the system theme when none is chosen. Reduced
  // motion makes every CSS transition land on its final frame (ds.css), so a
  // card that animates in is photographed where it comes to rest, not mid-slide.
  await page.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
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

    // These screenshots are published. A random 9xxxxxxxxx number could be
    // somebody's real phone, so the account lives in the seed's own demo block
    // (+917000…), fresh per run so the screens still show a new account.
    // The field is filled BEFORE the sign-in shot: app.html pre-fills the demo
    // citizen +917000009876 (it once pre-filled a real-looking 98765 number,
    // which every earlier 01-login.png published). The shot shows the number
    // this run actually signs in with.
    // Inside the demo block (+91 70000 00000-09999), above the seeded 0000-3999
    // citizens and below the demo citizen 09876.
    const msisdn = "+91700000" + (4000 + Math.floor(Math.random() * 5000));
    await page.eval(`
      document.getElementById("a-msisdn").value = ${JSON.stringify(msisdn)}; return true;`);
    await page.shot("01-login", "OTP sign-in — real API, dev OTP returned in the response");
    await page.eval(`
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
    // Captured here rather than at the end: the cleanup below has to work for a
    // run that dies half way, which is exactly the run that leaves a booking
    // assigned. app.html keeps the session under this key (see loadSession).
    // The access token moved to sessionStorage when the refresh token became
    // an HttpOnly cookie (apps/web/session.js); localStorage now holds only
    // who and which vehicle. Reading localStorage alone returned "", so the
    // release below silently released nothing and the map got no token.
    sessionToken = await page.eval(
      `const k = "ra.app.session";
       const s = JSON.parse(sessionStorage.getItem(k) || "null") || {};
       const l = JSON.parse(localStorage.getItem(k) || "null") || {};
       return s.token || l.token || "";`);
    if (!sessionToken) throw new Error("signed in, but no access token found in the session store");
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
    await page.waitFor(`document.querySelector("#t-contact a[href^='tel:']")`, 20000);
    await page.expect(`/assigned|en route/i.test(document.getElementById("scr-track").innerText)`,
      "an assigned mechanic on the tracking screen");
    // The mechanic the customer just accepted, so the console shot further
    // down is of the same job, seen from the other side. The tracking card is
    // the only place the platform hands a customer the mechanic's number.
    assignedMech = await page.eval(
      `return document.querySelector("#t-contact a[href^='tel:']").href.replace("tel:", "");`);
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

    // The console signed in, phone-sized, as the mechanic assigned above: the
    // availability toggle, their stats and the job this run created, still
    // ASSIGNED because nothing releases it until the end of the run.
    console.log("\nmechanic console, signed in (390×844, 2x)");
    await page.viewport(390, 844);
    await page.goto(`${BASE}/mechanic.html`);
    await page.waitFor(`document.getElementById("m-msisdn")`);
    await page.eval(`
      document.getElementById("m-msisdn").value = ${JSON.stringify(assignedMech)};
      document.getElementById("m-signin").click(); return true;`);
    await page.waitFor(`document.getElementById("scr-work").hidden === false`, 25000);
    await page.waitFor(`document.getElementById("job-box").hidden === false &&
      document.getElementById("job").innerText.trim().length > 10`, 25000);
    await page.expect(`/assigned/i.test(document.getElementById("job").innerText)`,
      "the assigned job on the mechanic's dashboard");
    await page.shot("24-mechanic-console", "Mechanic console — availability, stats, the active job");
    await page.viewport(1280, 860, false);             // back to desktop for RAKSHA

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
    // map.html has no localStorage fallback — it reads the session out of the
    // URL hash, exactly as app.html hands it over (apps/web/app.html:3469).
    // Navigated bare it still renders, but every authenticated fetch 401s, so
    // not one mechanic, responder or detection arrives. The citizen session is
    // still in storage here: the authority step above keys its own under
    // ra.raksha.session and leaves ra.app.session alone.
    const mapToken = sessionToken;
    await page.goto(
      `${BASE}/map.html#base=${encodeURIComponent(BASE)}&token=${encodeURIComponent(mapToken)}`);
    // What counts as "the map has content".
    //
    // The "you are here" dot is added straight to the map rather than to the
    // cluster (apps/web/map.html:280), so it satisfies a bare
    // .leaflet-marker-icon count entirely on its own. Counting it is how an
    // unauthenticated map — the sign-in gate and a single blue dot — was
    // captured and published under a caption promising clustered mechanics,
    // responders and detections. Assert the content, not the dot.
    const CONTENT = `document.querySelectorAll(".marker-cluster").length + ` +
      `[...document.querySelectorAll(".leaflet-marker-icon")]` +
      `.filter(m => !m.querySelector(".me")).length > 0`;
    try {
      await page.waitFor(CONTENT, 25000);
      await sleep(2500);
      await page.expect(CONTENT, "mechanic, responder or detection markers on the map");
      await page.shot("18-live-map", "RAKSHA live map — clustered mechanics, responders and detections");
    } catch {
      console.log("  – live map skipped (no mechanic/responder/detection markers rendered)");
    }

    // The landing page, which is what "/" serves. This step used to shoot
    // index.html — the request console — under the caption "Product landing
    // page", and with no assertion at all: a bare sleep, then the shutter. It
    // published the console sitting on its red "API unreachable" banner, which
    // is the console's honest resting state before you press GO ONLINE, and a
    // poor thing to lead a deck with. Assert the hero before shooting.
    await page.viewport(1280, 860, false);
    await page.goto(`${BASE}/`);
    await page.waitFor(`document.querySelector(".hero .display")`, 15000);
    await sleep(1200);
    await page.expect(`document.querySelectorAll(".card").length > 8`,
      "the landing page sections rendered");
    await page.shot("15-landing", "Product landing page — what RoadAssist does, and what it does not");

    // The console gets its own shot, captioned as what it actually is.
    await page.goto(`${BASE}/index.html`);
    await sleep(2200);
    // The console pre-fills the same +917000009876 as app.html; show this
    // run's demo-block number instead (see the 01-login step).
    await page.eval(`
      const f = document.getElementById("msisdn");
      if (f) f.value = ${JSON.stringify(msisdn)}; return true;`);
    await page.shot("23-console", "Request console — every API call the client makes, with the server's reply");

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
    // Before the browser dies, and on the failure path too — a run that crashed
    // after accepting is precisely the one holding a mechanic.
    try {
      const freed = await releaseBookings();
      if (freed.total) {
        console.log(`
released ${freed.total} booking(s) back to the pool` +
                    `${freed.stillHolding ? ` (${freed.stillHolding} still held)` : ""}`);
      }
    } catch (e) {
      console.error("could not release bookings:", e.message);
    }
    cleanup();
  }
};

run();
