/**
 * Browser journey tests for the RoadAssist web app.
 *
 * The API has `e2e-journey.mjs`, which proves the *server* behaves. Nothing
 * proved the thing a user actually touches: that the app boots without a
 * console error, that a session survives a reload, that an offline payment is
 * refused rather than queued. Those are client-side facts, so they need a
 * client.
 *
 * It drives real Chrome over the DevTools protocol rather than adding a
 * headless-browser dependency to a project that deliberately has none — the
 * only requirement is a Chrome install, which any machine running this demo
 * already has.
 *
 *   node scripts/ui-journey.mjs            # headless
 *   node scripts/ui-journey.mjs --headed   # watch it happen
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const HEADED = process.argv.includes("--headed");
// UI_CDP_PORT: a second run on the same machine (another API, another DB) needs its own.
const PORT = Number(process.env.UI_CDP_PORT ?? 9333);

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

let pass = 0, fail = 0;
const section = (t) => console.log(`\n${t}`);
const ok = (t, detail = "") => { pass++; console.log(`  \u2713 ${t}${detail ? "  " + detail : ""}`); };
const bad = (t, detail = "") => { fail++; console.log(`  \u2717 ${t}${detail ? "  " + detail : ""}`); };
const check = (cond, t, detail) => (cond ? ok(t, detail) : bad(t, detail));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── minimal CDP client ───────────────────────────────────────────────────────
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    this.errors = [];
    this.dialogs = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "").join(" ");
        this.console.push({ type: msg.params.type, text });
        if (msg.params.type === "error") this.errors.push(text);
      }
      // A confirm() (sign-out with an unsent SOS) is recorded and accepted.
      if (msg.method === "Page.javascriptDialogOpening") {
        this.dialogs.push(msg.params.message);
        this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.errors.push(d.exception?.description ?? d.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /** Evaluate in the page and return the JSON value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }

  async waitFor(condition, timeoutMs = 12000, label = condition) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(`return Boolean(${condition});`)) return true;
      } catch { /* page mid-navigation — try again */ }
      await sleep(150);
    }
    throw new Error(`timed out waiting for: ${label}`);
  }

  click(selector) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no element: " + ${JSON.stringify(selector)});
      el.click();
      return true;
    `);
  }

  setValue(selector, value) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("no element: " + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `);
  }

  text(selector) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? (el.textContent || "").trim() : null;
    `);
  }
}

async function launch() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome not found — set a path in CHROME_CANDIDATES");
  const profile = mkdtempSync(join(tmpdir(), "ra-ui-"));

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-background-timer-throttling",
    // The app asks for geolocation; denying it exercises the fallback path
    // rather than hanging the run on a permission prompt nobody will answer.
    "--deny-permission-prompts",
    "--window-size=390,860",
    // A LAN name with no secure context, for §29 (it resolves to this machine).
    "--host-resolver-rules=MAP roadassist.local 127.0.0.1",
  ];
  if (!HEADED) args.push("--headless=new");
  // CI runners have no usable user namespace for Chrome's sandbox. This is the
  // one place it is safe to drop: the browser only ever visits localhost.
  if (process.env.CI) args.push("--no-sandbox", "--disable-dev-shm-usage");

  const proc = spawn(exe, [...args, "about:blank"], { stdio: "ignore", detached: false });

  // Wait for the debugging endpoint.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("no page target");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  const page = new Page(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  return { page, proc, profile };
}

// ── the journeys ─────────────────────────────────────────────────────────────
const run = async () => {
  const { page, proc, profile } = await launch();
  // Carried from the customer journey into the mechanic journey so both sides
  // drive the same booking.
  let assignedMechanic = null;
  let customerBookingId = null;
  const cleanup = () => {
    try { proc.kill(); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* leave it */ }
  };

  try {
    // ══ 1. Boot ═════════════════════════════════════════════════════════════
    section("1. App boots clean");
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("a-send")`);
    ok("app.html loads and renders the sign-in screen");

    const criticalBoot = page.errors.filter((e) => !/favicon|manifest/i.test(e));
    check(criticalBoot.length === 0, "no uncaught exceptions on boot",
      criticalBoot.length ? criticalBoot[0].slice(0, 140) : "clean");

    const overflow = await page.eval(`
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    `);
    check(overflow <= 0, "no horizontal overflow at 390px", `overflow=${overflow}px`);

    // ══ 1b. Every surface still loads ═══════════════════════════════════════
    // The citizen app and the mechanic console get driven properly below; these
    // four only have to load, render and stay quiet in the console.
    //
    // map.html, raksha.html and showcase.html share ds.css, so a token change
    // can break them silently. index.html does NOT — it keeps its own
    // highway-signage palette on purpose (see the comment at the top of that
    // file), which is exactly why it needs its own smoke check: nothing else
    // here would notice if that separate stylesheet broke.
    section("1b. All surfaces load");
    for (const surface of ["index.html", "map.html", "raksha.html", "showcase.html"]) {
      page.errors.length = 0;
      await page.goto(`${BASE}/${surface}`);
      await sleep(1200);
      const state = await page.eval(`
        return {
          title: document.title,
          body: document.body.innerText.trim().length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      `);
      const errs = page.errors.filter((e) => !/favicon|manifest|geolocation|Permission|401|Sign in/i.test(e));
      check(state.body > 50 && errs.length === 0, `${surface} renders without error`,
        errs.length ? errs[0].slice(0, 90) : `"${state.title}"`);
    }
    page.errors.length = 0;
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("a-send")`);

    // ══ 2. Validation ═══════════════════════════════════════════════════════
    section("2. Inline validation, input preserved");
    await page.setValue("#a-msisdn", "12345");
    await page.click("#a-send");
    await sleep(400);
    const err = await page.text("#a-msisdn-err");
    check(Boolean(err), "a bad number produces an inline field error", err ?? "(none)");
    const kept = await page.eval(`return document.getElementById("a-msisdn").value;`);
    check(kept === "12345", "what the user typed is preserved", `value="${kept}"`);
    const invalid = await page.eval(`
      return document.getElementById("a-msisdn").getAttribute("aria-invalid");
    `);
    check(invalid === "true", "the field is marked invalid for a screen reader");

    // ══ 2b. Numbers as people actually write them ═══════════════════════════
    // The API requires strict E.164. Nobody in India types their own number
    // that way, so the client normalizes before it validates.
    section("2b. Phone number normalization");
    const norm = await page.eval(`
      const f = window.__ra.normalizeMsisdn;
      return {
        plain:     f("7000009876"),
        spaced:    f("70000 09876"),
        contact:   f("+91 70000 09876"),
        stdZero:   f("07000009876"),
        noPlus:    f("917000009876"),
        dashed:    f("70000-09876"),
        canonical: f("+917000009876"),
        starts5:   f("5000009876"),
        tooShort:  f("700000987"),
        us:        f("+12025550123"),
      };
    `);
    check(norm.plain === "+917000009876", "10 digits gets the +91", norm.plain);
    check(norm.spaced === "+917000009876", "spaces are stripped", norm.spaced);
    check(norm.contact === "+917000009876", "a pasted contact-card number works", norm.contact);
    check(norm.stdZero === "+917000009876", "a leading STD zero is dropped", norm.stdZero);
    check(norm.noPlus === "+917000009876", "91 without the plus works", norm.noPlus);
    check(norm.dashed === "+917000009876", "dashes are stripped", norm.dashed);
    check(norm.canonical === "+917000009876", "an already-correct number is unchanged");
    check(norm.starts5 === null, "a number starting 5 is still rejected");
    check(norm.tooShort === null, "a 9-digit number is still rejected");
    check(norm.us === null, "a non-Indian number is still rejected");

    // And it works through the real field, end to end.
    await page.setValue("#a-msisdn", "70000 00000");
    await page.click("#a-send");
    await page.waitFor(`document.getElementById("a-step2").hidden === false`, 15000);
    const normalized = await page.eval(`return document.getElementById("a-msisdn").value;`);
    check(normalized === "+917000000000",
      "typing it with a space still signs in", normalized);
    // Reset for the sign-in section below.
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("a-send")`);

    // ══ 3. Sign in ══════════════════════════════════════════════════════════
    section("3. Sign in (real OTP against the live API)");
    await page.setValue("#a-msisdn", "+917000000000");
    await page.click("#a-send");
    await page.waitFor(`document.getElementById("a-step2").hidden === false`);
    ok("OTP requested, code step revealed");

    await page.click("#a-verify");
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    ok("verified and landed on Home");

    const tabsShown = await page.eval(`return document.getElementById("tabs").hidden === false;`);
    check(tabsShown, "navigation appears once signed in");

    // ══ 4. Session survives a reload ════════════════════════════════════════
    section("4. Session persistence (the PWA relaunch case)");
    // The refresh token is an HttpOnly cookie now (routes/auth.ts): the page
    // keeps a flag that a session exists, and no token is readable by script.
    const stored = await page.eval(`
      const s = JSON.parse(localStorage.getItem("ra.app.session") || "null");
      return Boolean(s?.cookie) && !s.refresh && !s.token && !/ra_rt_/.test(document.cookie);
    `);
    check(stored, "the session persists as an HttpOnly cookie, with no token in localStorage");

    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    ok("a reload lands back in the app, not on sign-in");

    // ══ 5. Expired access token is refreshed, not surfaced ══════════════════
    section("5. Token refresh");
    await page.eval(`
      const s = JSON.parse(sessionStorage.getItem("ra.app.session"));
      s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";  // forced expiry
      sessionStorage.setItem("ra.app.session", JSON.stringify(s));
      return true;
    `);
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    ok("a dead access token is silently exchanged for a live one");
    const newTok = await page.eval(`
      return JSON.parse(sessionStorage.getItem("ra.app.session")).token.split(".")[1];
    `);
    check(newTok && newTok.length > 20, "the stored token was actually replaced");

    // ══ 6. Home leads with the task ═════════════════════════════════════════
    section("6. Home prioritises the current task");
    const task = await page.text("#home-task");
    check(/assistance|track|finding/i.test(task ?? ""),
      "home shows a task card, not just a menu", (task ?? "").slice(0, 60));

    const ready = await page.eval(`
      return Array.from(document.querySelectorAll("#sos-ready li"))
        .map(li => li.querySelector(".ready-k").textContent + ": " +
                   li.querySelector(".ready-v").textContent).join(" | ");
    `);
    check(/Location|Network|Contacts/.test(ready), "SOS readiness is stated before it is needed", ready);

    // ══ 6b. Your name ═══════════════════════════════════════════════════════
    // Accounts created by signing in have no name, so a real customer used to
    // reach the mechanic's screen as the literal word "Customer".
    section("6b. Setting your own name");
    await page.eval(`location.hash = "#more"; return true;`);
    await sleep(900);
    await page.setValue("#p-name", "Demo Customer");
    await page.click("#p-save");
    await sleep(1500);
    const named = await page.eval(`
      return {
        greeting: document.getElementById("home-sub").textContent,
        field: document.getElementById("p-name").value,
      };
    `);
    check(/Demo Customer/.test(named.greeting),
      "the name appears in the greeting", named.greeting);

    // It survives a reload, because it lives on the server not in the page.
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 20000);
    const nameKept = await page.eval(`return document.getElementById("p-name").value;`);
    check(nameKept === "Demo Customer", "the name persists across a reload", nameKept);

    // ══ 7. Offline safety ═══════════════════════════════════════════════════
    section("7. Offline queue refuses money and emergencies");
    const guard = await page.eval(`
      const q = (m, p) => window.__ra.neverQueue(m, p);
      return {
        pay:        q("POST", "/v1/bookings/abc/pay"),
        confirm:    q("POST", "/v1/payments/abc/confirm"),
        sos:        q("POST", "/v1/sos"),
        sosConfirm: q("POST", "/v1/sos/abc/confirm"),
        transition: q("POST", "/v1/bookings/abc/transition"),
        dispatch:   q("POST", "/v1/bookings/abc/dispatch"),
        accept:     q("POST", "/v1/offers/abc/accept"),
        vehicle:    q("POST", "/v1/vehicles"),
        report:     q("POST", "/v1/raksha/report"),
        reason:     window.__ra.offlineReason("/v1/bookings/abc/pay"),
      };
    `);
    check(guard.pay, "payment is never queued offline");
    check(guard.confirm, "payment confirmation is never queued offline");
    check(guard.sos, "SOS is never queued offline");
    check(guard.sosConfirm, "SOS confirmation is never queued offline");
    check(guard.transition, "booking transitions are never queued offline");
    check(guard.dispatch && guard.accept, "dispatch and offer-accept are never queued offline");
    check(guard.vehicle === false, "a safe operation (add vehicle) still queues");
    check(guard.report === false, "a hazard report still queues");
    check(/nothing was charged/i.test(guard.reason),
      "the refusal explains that no money moved", guard.reason);

    // And the queue itself really does accept the safe one while offline.
    const queued = await page.eval(`
      document.getElementById("net").click();               // simulate offline
      const before = JSON.parse(localStorage.getItem("ra.app.queue") || "[]").length;
      document.getElementById("v-reg").value = "KA05MZ4321";
      document.getElementById("v-class").value = "car";
      document.getElementById("v-add").click();
      await new Promise(r => setTimeout(r, 700));
      const after = JSON.parse(localStorage.getItem("ra.app.queue") || "[]").length;
      const banner = !document.getElementById("offline-banner").hidden;
      const pill = document.getElementById("net").textContent;
      document.getElementById("net").click();               // back online
      await new Promise(r => setTimeout(r, 900));
      return { before, after, banner, pill };
    `);
    check(queued.after > queued.before, "an offline vehicle add lands in the queue",
      `${queued.before} -> ${queued.after}`);
    check(queued.banner, "an offline banner explains what still works");
    check(/off-grid/i.test(queued.pill), "the status pill names the tier in words", queued.pill);

    // ══ 7b'. Online SOS with no GPS fix ════════════════════════════════════
    // Location permission denied, network up. The SOS must go WITHOUT a
    // position (locationUnknown), not at the demo point, and the sheet must put
    // 112 one tap away, because a call is now how the location gets told.
    section("7b'. Online SOS with no fix: no made-up position");
    await page.waitFor(`window.__ra && window.__ra.tier() === "ONLINE"`, 15000, "tier ONLINE");
    await page.eval(`location.hash = "#home"; return true;`);
    await page.send("Browser.setPermission", {
      origin: BASE, permission: { name: "geolocation" }, setting: "denied",
    });
    const nofix = await page.eval(`
      const sent = [];
      const realFetch = window.fetch;
      window.fetch = function (url, init) {
        if (/\\/v1\\/sos$/.test(String(url)) && init && init.method === "POST") sent.push(JSON.parse(init.body));
        return realFetch.apply(this, arguments);
      };
      try {
        document.getElementById("sos").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const t0 = Date.now();
        while (Date.now() - t0 < 4000 && !document.getElementById("sos-nofix")) await new Promise(r => setTimeout(r, 100));
        const out = document.getElementById("sos-out");
        const res = {
          body: sent[0] || null,
          toast: document.getElementById("toast").textContent,
          sheetOpen: document.getElementById("sheet-sos").classList.contains("show"),
          nofix: Boolean(document.getElementById("sos-nofix")),
          tel112: Boolean(out.querySelector('a[href="tel:112"]')),
        };
        // Stand it down inside the grace window, so nobody is "alerted" by a test.
        if (!document.getElementById("sos-abort").hidden) document.getElementById("sos-abort").click();
        await new Promise(r => setTimeout(r, 1200));
        return res;
      } finally { window.fetch = realFetch; }
    `);
    check(nofix.body && nofix.body.locationUnknown === true && !("lat" in nofix.body) && !("lng" in nofix.body),
      "with no fix the SOS is sent with locationUnknown and no lat/lng", JSON.stringify(nofix.body));
    check(/without a location/i.test(nofix.toast) && /call 112/i.test(nofix.toast),
      "the toast says it was raised without a location and to call 112", nofix.toast);
    check(nofix.sheetOpen && nofix.nofix, "the SOS sheet says the location is not known");
    check(nofix.tel112, "…and offers Call 112 (tel:112) right there");
    // 7b grants geolocation next, which lifts this denial.

    // ══ 7b. Off-Grid Mode, end to end (ADR-0009) ════════════════════════════
    // The demo scenario, driven as a test: online → lose the network → SOS →
    // a local incident with a real reference and a real GPS fix → local
    // diagnosis → network returns → automatic sync → the incident is in the
    // database → a replay creates no duplicate. Every assertion below is about
    // something the user is *told*, because the feature's whole claim is that
    // it never says a thing happened that did not.
    section("7b. Off-grid mode: store, forward, never overclaim");

    // A real fix, so the honest-location path is exercised rather than skipped.
    await page.send("Browser.grantPermissions", {
      origin: BASE, permissions: ["geolocation"],
    });
    await page.send("Emulation.setGeolocationOverride", {
      latitude: 28.4601, longitude: 77.0301, accuracy: 12,
    });

    await page.waitFor(`window.__ra && window.__ra.offGrid().storeLoaded`, 15000,
      "the off-grid modules to load");
    const modules = await page.eval(`return window.__ra.offGrid();`);
    check(modules.engineLoaded && modules.storeLoaded && modules.managerLoaded,
      "the engine, the store and the connectivity manager all load",
      JSON.stringify(modules));

    await page.eval(`await window.__ra.clearOffGrid(); return true;`);

    // 1–2. Confirm ONLINE before anything is disabled.
    await page.waitFor(`window.__ra.tier() === "ONLINE"`, 15000, "tier ONLINE");
    ok("the app reports ONLINE while the network is up");

    // 5–6. Lose the network. The UI must change immediately.
    const wentOff = await page.eval(`
      document.getElementById("net").click();
      await new Promise(r => setTimeout(r, 400));
      return {
        tier: window.__ra.tier(),
        pill: document.getElementById("net").textContent,
        bodyClass: document.body.classList.contains("offgrid"),
        banner: document.getElementById("offline-banner").innerHTML,
      };
    `);
    check(wentOff.tier === "OFFLINE", "the connectivity manager drops to OFFLINE", wentOff.tier);
    check(/off-grid/i.test(wentOff.pill), "the indicator says the words off-grid", wentOff.pill);
    check(wentOff.bodyClass, "the shell takes on its off-grid treatment");
    check(/no internet connection/i.test(wentOff.banner),
      "the banner states plainly that there is no connection");
    check(/stored on this device|off-grid incident/i.test(wentOff.banner),
      "…and says what an SOS will do instead of pretending it will be sent");

    // 10. Local diagnosis with no cloud to ask.
    const localDiag = await page.eval(`
      document.querySelector('.tab[data-nav="book"]').click();
      document.getElementById("b-symptoms").value = "car wont start, just a click";
      document.getElementById("b-diagnose").click();
      await new Promise(r => setTimeout(r, 900));
      const html = document.getElementById("b-diag").innerHTML;
      return {
        labelled: /LOCAL OFFLINE DIAGNOSIS/.test(html),
        cause: (document.querySelector("#b-diag .title") || {}).textContent || "",
        engine: /local-rules/.test(html),
        safety: /Recommended safety action/i.test(html),
        claimsCloud: /AI vehicle diagnosis/.test(html),
      };
    `);
    check(localDiag.labelled, "an offline diagnosis is labelled LOCAL OFFLINE DIAGNOSIS");
    check(/batter/i.test(localDiag.cause), "the on-device rules engine reaches a cause",
      localDiag.cause);
    check(localDiag.engine, "the engine version is shown, so nobody has to guess what ran");
    check(localDiag.safety, "a recommended safety action is given");
    check(!localDiag.claimsCloud, "it never presents itself as the cloud AI");

    // 7–9. Raise the SOS. Keyboard parity is the accessible path and needs no hold.
    const raised = await page.eval(`
      document.querySelector('.tab[data-nav="home"]').click();
      const sos = document.getElementById("sos");
      sos.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise(r => setTimeout(r, 2500));
      const sheet = document.getElementById("sheet-sos");
      const list = await window.__ra.listOffGrid();
      const journal = await window.__ra.journal();
      return {
        sheetOpen: sheet.classList.contains("show"),
        heading: document.getElementById("sos-h").textContent,
        copy: document.getElementById("sos-copy").textContent,
        out: document.getElementById("sos-out").innerText,
        incidents: list.length,
        id: list[0] && list[0].incidentId,
        status: list[0] && list[0].status,
        serverId: list[0] && list[0].serverId,
        lat: list[0] && list[0].lat,
        // The local diagnosis above journals an entry of its own, so the SOS
        // entry is picked out by type rather than by position.
        sosEntries: journal.filter(e => e.type === "sos.offgrid").length,
        diagnosisJournalled: journal.some(e => e.type === "diagnosis.offgrid"),
        opId: (journal.find(e => e.type === "sos.offgrid") || {}).opId,
        idempotencyKey: (journal.find(e => e.type === "sos.offgrid") || {}).idempotencyKey,
        retryCount: (journal.find(e => e.type === "sos.offgrid") || {}).retryCount,
        digest: (journal.find(e => e.type === "sos.offgrid") || {}).digest,
      };
    `);
    check(raised.sheetOpen && /off-grid sos/i.test(raised.heading),
      "an SOS with no network opens the off-grid sheet", raised.heading);
    check(/no network connection detected/i.test(raised.copy),
      "it says: No network connection detected", raised.copy);
    check(/stored securely on this device/i.test(raised.out),
      "…and that the information is stored on the device and will sync later");
    check(/Nothing has been transmitted/i.test(raised.out),
      "…and explicitly that nothing was transmitted");
    check(raised.incidents === 1, "exactly one incident is stored locally", `${raised.incidents}`);
    check(/^RA-[A-Z0-9]{6}$/.test(raised.id ?? ""), "it has a readable local reference", raised.id);
    check(raised.status === "STORED_LOCALLY", "its state is STORED_LOCALLY, not sent",
      raised.status);
    check(raised.serverId === null, "it carries no server id, because there is no server yet");
    check(Math.abs((raised.lat ?? 0) - 28.4601) < 0.01,
      "the GPS fix was captured — a satellite receiver needs no internet", `${raised.lat}`);
    check(raised.sosEntries === 1, "exactly one journal entry carries the SOS",
      `${raised.sosEntries}`);
    check(raised.diagnosisJournalled,
      "the offline diagnosis was journalled too — dead-zone data worth having");
    check(Boolean(raised.opId) && raised.opId === raised.idempotencyKey,
      "the journal entry carries an operation id that doubles as the idempotency key",
      raised.opId);
    check(raised.retryCount === 0, "with a retry count starting at zero");
    check(/^[0-9a-f]{64}$/.test(raised.digest ?? ""),
      "…and an integrity digest over the stored payload");

    // The dialler and the messaging app still work with no data. The sheet
    // offers both — and the text it pre-fills is this incident, not a template.
    const reach = await page.eval(`
      const out = document.getElementById("sos-out");
      const sms = out.querySelector('a[href^="sms:"]');
      const href = sms ? sms.getAttribute("href") : "";
      return {
        tel112: Boolean(out.querySelector('a[href="tel:112"]')),
        tel1033: Boolean(out.querySelector('a[href="tel:1033"]')),
        sms: href,
        body: href ? decodeURIComponent(href.replace(/^sms:[?&]body=/, "")) : "",
        note: out.innerText,
      };
    `);
    check(reach.tel112, "the off-grid sheet has a Call 112 button (tel:112)");
    check(reach.tel1033, "…and the NHAI highway helpline, tap to call (tel:1033)");
    check(/^sms:[?&]body=/.test(reach.sms), "…and a Text my location link that opens the SMS app",
      reach.sms.slice(0, 40));
    check(raised.id && reach.body.includes(raised.id),
      "the prefilled text carries this incident's RA- reference", reach.body.slice(0, 40));
    check(/-?\d{1,3}\.\d{5},-?\d{1,3}\.\d{5}/.test(reach.body) || /Location unknown/.test(reach.body),
      "…and either the GPS fix or 'Location unknown', never a stand-in", reach.body);
    check(/press Send yourself/i.test(reach.note) && /has not sent anything/i.test(reach.note),
      "it says the user chooses the recipient and sends it — the app has sent nothing");
    // UI_SHOT_DIR=<dir>: also photograph the sheet at a phone's width (390 px).
    if (process.env.UI_SHOT_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.UI_SHOT_DIR, { recursive: true });
      await page.send("Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      for (const [name, target] of [["offgrid-sos-sheet.png", null], ["offgrid-sos-sheet-actions.png", ".em-note"]]) {
        if (target) await page.eval(`document.querySelector("#sos-out ${target}").scrollIntoView({ block: "end" }); return true;`);
        await sleep(300);
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(process.env.UI_SHOT_DIR, name), Buffer.from(data, "base64"));
      }
      await page.send("Emulation.clearDeviceMetricsOverride");
      await sleep(300);
    }

    // 6. The dedicated off-grid screen.
    const screen = await page.eval(`
      document.getElementById("og-close").click();
      location.hash = "#offgrid";
      await new Promise(r => setTimeout(r, 700));
      const body = document.getElementById("scr-offgrid").innerText;
      return {
        active: document.querySelector(".screen.active").id,
        body,
        hasId: /RA-[A-Z0-9]{6}/.test(body),
        stateWord: /SOS STORED LOCALLY/.test(body),
        waiting: /WAITING FOR CONNECTION/.test(body),
        // innerText applies text-transform, so the eyebrows come back uppercased.
        available: /available/i.test(body) && /local diagnosis/i.test(body),
        unavailable: /unavailable/i.test(body) && /live mechanic dispatch/i.test(body),
      };
    `);
    check(screen.active === "scr-offgrid", "the off-grid screen is reachable", screen.active);
    check(screen.hasId, "it shows the incident reference");
    check(screen.stateWord, "it states the current state: SOS STORED LOCALLY");
    check(screen.waiting, "and the synchronisation state: WAITING FOR CONNECTION");
    check(screen.available, "it lists what genuinely still works");
    check(screen.unavailable, "and, separately, what genuinely does not");

    // 12–13. The network comes back; sync should be automatic.
    const restored = await page.eval(`
      document.getElementById("net").click();     // back online
      await new Promise(r => setTimeout(r, 3500));
      const list = await window.__ra.listOffGrid();
      const journal = await window.__ra.journal();
      return {
        tier: window.__ra.tier(),
        status: list[0] && list[0].status,
        serverId: list[0] && list[0].serverId,
        clientId: list[0] && list[0].incidentId,
        journalled: journal.length,
        progress: (document.getElementById("og-sync-status") || {}).innerText || "",
      };
    `);
    check(restored.tier === "ONLINE", "the manager comes back to ONLINE", restored.tier);
    check(restored.status === "SYNCED", "the stored incident synchronises automatically",
      restored.status);
    check(Boolean(restored.serverId), "the platform's own incident id comes back",
      restored.serverId);
    check(restored.journalled === 0, "the journal empties once the server has acknowledged it",
      `${restored.journalled} left`);
    check(/synchronized/i.test(restored.progress),
      "the screen says SOS synchronized rather than leaving it ambiguous",
      restored.progress.slice(0, 90));

    // 14–15. It really is in the database, and a replay makes no second one.
    const backend = await page.eval(`
      const tok = JSON.parse(sessionStorage.getItem("ra.app.session")).token;
      const list = await window.__ra.listOffGrid();
      const res = await fetch("/v1/sos/offline-sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + tok },
        body: JSON.stringify({ incidents: [{
          clientIncidentId: list[0].incidentId,
          opId: list[0].opId,
          occurredAt: list[0].occurredAt,
          emergencyType: list[0].emergencyType,
          lat: list[0].lat, lng: list[0].lng,
        }] }),
      });
      const j = await res.json();
      return { status: res.status, result: j.data && j.data.results && j.data.results[0], meta: j.meta };
    `);
    check(backend.result?.status === "duplicate",
      "the incident is in the backend — a replay of it comes back as a duplicate",
      backend.result?.status);
    check(backend.result?.id === restored.serverId,
      "the replay resolves to the same incident, not a new one");
    check(backend.meta?.created === 0,
      "no duplicate incident was created", JSON.stringify(backend.meta));

    // The store's retention rule, checked rather than asserted in a comment.
    const retention = await page.eval(`
      const before = (await window.__ra.listOffGrid()).length;
      return { before };
    `);
    check(retention.before === 1, "a synchronised incident stays readable to its owner for now",
      `${retention.before} kept`);

    // Stand the synced incident down: it is escalated, and one open emergency
    // is enough to refuse the next SOS (§25), including in a rerun on this DB.
    await page.eval(`
      const h = { "content-type": "application/json", authorization: "Bearer " + JSON.parse(sessionStorage.getItem("ra.app.session")).token };
      for (const i of (await (await fetch("/v1/me/incidents", { headers: h })).json()).data || []) {
        await fetch("/v1/sos/" + i.id + "/cancel", { method: "POST", headers: h, body: "{}" });
      }
      return true;`);
    await page.eval(`await window.__ra.clearOffGrid(); location.hash = "#home"; return true;`);
    await page.send("Emulation.clearGeolocationOverride", {}).catch(() => {});

    // ══ 7c. The live event stream ═══════════════════════════════════════════
    // The customer's screen used to follow the mechanic on a six-second timer.
    // It now follows a stream, and the poll drops to a background heartbeat —
    // both of which are facts about the running client, so they are checked
    // here rather than asserted in a comment.
    section("7c. Live updates arrive without polling");

    await page.waitFor(`window.__ra.stream().alive === true`, 15000, "the live stream to connect");
    const live = await page.eval(`return window.__ra.stream();`);
    check(live.alive, "the client holds an open event stream");
    check(live.pollMs === 60000,
      "polling drops to a background heartbeat while the stream is up", `${live.pollMs}ms`);

    const pushed = await page.eval(`
      const before = window.__ra.stream().events;
      const tok = JSON.parse(sessionStorage.getItem("ra.app.session")).token;
      // Raise an SOS through the API directly — the server publishes to this
      // user, so anything that arrives came over the wire, not from a refetch.
      const res = await fetch("/v1/sos", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + tok },
        body: JSON.stringify({ lat: 28.46, lng: 77.03, source: "manual" }),
      });
      const j = await res.json();
      await new Promise(r => setTimeout(r, 1200));
      // Tidy up: this SOS exists only to produce an event.
      await fetch("/v1/sos/" + j.data.id + "/cancel", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + tok },
      });
      await new Promise(r => setTimeout(r, 600));
      return { before, after: window.__ra.stream().events };
    `);
    check(pushed.after > pushed.before,
      "a server-side change is delivered to the open stream",
      `${pushed.before} -> ${pushed.after} events`);

    const survives = await page.eval(`
      // Losing the network must close the stream rather than leave a socket
      // that reports itself alive and delivers nothing.
      document.getElementById("net").click();
      await new Promise(r => setTimeout(r, 600));
      const offline = window.__ra.stream().alive;
      document.getElementById("net").click();
      await new Promise(r => setTimeout(r, 2500));
      return { offline, back: window.__ra.stream().alive };
    `);
    check(survives.offline === false, "going off-grid closes the stream honestly");
    check(survives.back === true, "and it reconnects by itself when the network returns");

    // ══ 8. PWA shortcuts ════════════════════════════════════════════════════
    section("8. PWA shortcuts route");
    const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    const routed = [];
    for (const s of manifest.shortcuts) {
      const hash = new URL(s.url, BASE).hash;
      await page.eval(`location.hash = ${JSON.stringify(hash)}; return true;`);
      await sleep(500);
      const active = await page.eval(`
        const el = document.querySelector(".screen.active");
        return el ? el.id : null;
      `);
      const landed = active && active !== "scr-auth";
      routed.push(`${hash}->${active}`);
      check(landed, `shortcut ${hash} lands on a real screen`, active ?? "(nothing)");
    }

    // ══ 9. Booking journey ══════════════════════════════════════════════════
    section("9. Assistance journey");
    // A real fix, set here rather than inherited: 7b cleared its override, and a
    // booking with no fix is (correctly) not sent — section 16 proves that side.
    await page.send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] });
    await page.send("Emulation.setGeolocationOverride", { latitude: 28.4601, longitude: 77.0301, accuracy: 12 });
    await page.eval(`location.hash = "#assist"; return true;`);
    await sleep(500);

    const rail0 = await page.eval(`
      return {
        steps: document.querySelectorAll("#b-steps li").length,
        done: document.querySelectorAll("#b-steps li.done").length,
        headings: document.querySelectorAll("#scr-book .step-h").length,
      };
    `);
    check(rail0.steps === 5, "the request is presented as numbered steps", `${rail0.steps} steps`);
    check(rail0.headings === 5, "each step has its own heading", `${rail0.headings} headings`);
    check(rail0.done >= 1, "steps already satisfied are marked done", `${rail0.done} done`);

    // Step 3 — location, confirmed before booking rather than silently taken.
    await page.click("#b-locate");
    await sleep(2500);
    const loc = await page.eval(`
      return {
        state: document.getElementById("b-loc-state").textContent,
        done: document.querySelector('#b-steps [data-step="location"]').classList.contains("done"),
      };
    `);
    check(loc.done && /Location ready/.test(loc.state), "checking location completes step 3", loc.state);

    await page.setValue("#b-symptoms", "wont start, clicking sound");
    await sleep(200);
    const problemDone = await page.eval(`
      return document.querySelector('#b-steps [data-step="problem"]').classList.contains("done");
    `);
    check(problemDone, "describing the fault completes step 2");
    await page.click("#b-diagnose");
    await page.waitFor(`document.querySelector("#b-diag .diag-grid")`, 15000);
    ok("diagnosis returns and renders the structured readout");

    const diag = await page.eval(`
      return {
        confidence: document.querySelector("#b-diag .diag-v")?.textContent,
        hasSeverity: /Severity/i.test(document.getElementById("b-diag").textContent),
        hasCauses: Boolean(document.querySelector("#b-diag .diag-list")),
        hasCta: Boolean(document.getElementById("d-request")),
        bar: Boolean(document.querySelector("#b-diag .conf-fill")),
      };
    `);
    check(/%/.test(diag.confidence ?? ""), "confidence is shown as a number", diag.confidence);
    check(diag.hasSeverity, "severity is shown");
    check(diag.hasCauses, "possible causes are listed");
    check(diag.hasCta, "the result offers a request-assistance action");

    await page.click("#b-book");
    await page.waitFor(
      `document.querySelector("#b-offers .card.offer, #b-offers .btn.sm, #b-offers button")`, 25000);
    const offerCount = await page.eval(`
      return document.querySelectorAll("#b-offers .card").length;
    `);
    check(offerCount > 0, "dispatch returned mechanic offers", `${offerCount} card(s)`);

    // Accept the first offer.
    await page.eval(`
      const btns = Array.from(document.querySelectorAll("#b-offers button"))
        .filter(b => /accept/i.test(b.textContent));
      if (!btns.length) throw new Error("no accept button");
      btns[0].click();
      return true;
    `);
    await page.waitFor(`document.getElementById("scr-track").classList.contains("active")`, 20000);
    ok("accepting an offer moves to live tracking");

    // ══ 10. Tracking detail ═════════════════════════════════════════════════
    section("10. Tracking shows what Phase 8 asks for");
    await page.waitFor(`document.getElementById("t-eta")`, 15000);
    const track = await page.eval(`
      const body = document.getElementById("t-body").textContent;
      return {
        eta: document.getElementById("t-eta")?.textContent,
        steps: document.querySelectorAll("#t-body ul li").length,
        hasNavigate: Boolean(Array.from(document.querySelectorAll("#t-contact a"))
          .find(a => /navigate/i.test(a.textContent))),
        hasCall: Boolean(Array.from(document.querySelectorAll("#t-contact a"))
          .find(a => /call/i.test(a.textContent))),
        telHref: (Array.from(document.querySelectorAll("#t-contact a"))
          .find(a => /call/i.test(a.textContent)) || {}).href,
        named: /Request created|Mechanic accepted/i.test(body),
      };
    `);
    check(/km|ETA/.test(track.eta ?? ""), "distance and ETA are shown", track.eta);
    check(track.steps >= 8, "the journey is a named timeline", `${track.steps} steps`);
    check(track.named, "steps are named, not anonymous ticks");
    check(track.hasNavigate, "NAVIGATE is offered");
    check(track.hasCall, "CALL is offered", track.telHref ?? "");
    check((track.telHref ?? "").startsWith("tel:+91"), "the call button dials a real number");

    // Remember who was actually assigned, so the mechanic console below signs
    // in as *that* mechanic rather than a seeded default who owns a different
    // customer's job.
    assignedMechanic = (track.telHref ?? "").replace("tel:", "");
    customerBookingId = await page.eval(`
      return JSON.parse(localStorage.getItem("ra.app.session") || "{}").bookingId || null;
    `);

    // ══ 11. Console hygiene ═════════════════════════════════════════════════
    section("11. Quality control");
    const errs = page.errors.filter((e) => !/favicon|manifest|geolocation|Permission/i.test(e));
    check(errs.length === 0, "no uncaught exceptions across the whole journey",
      errs.length ? errs.slice(0, 2).join(" | ").slice(0, 200) : "clean");

    const dead = await page.eval(`
      // A button with no handler and no form is a dead control.
      const suspects = Array.from(document.querySelectorAll(".screen.active button"))
        .filter(b => !b.onclick && !b.closest("form") && !b.hasAttribute("data-nav") &&
                     !b.hasAttribute("data-pane") && !b.disabled);
      return suspects.map(b => (b.textContent || "").trim().slice(0, 30)).filter(Boolean);
    `);
    check(dead.length === 0, "no dead buttons on the active screen",
      dead.length ? dead.join(", ") : "none");

    // ══ 11b. Accessibility ══════════════════════════════════════════════════
    section("11b. Accessibility");
    const a11y = await page.eval(`
      const out = {};
      // Every control a screen reader has to announce needs a name.
      const named = (el) =>
        (el.textContent || "").trim() ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby")));
      out.unnamed = Array.from(document.querySelectorAll("button, a[href]"))
        .filter(el => el.offsetParent !== null && !named(el))
        .map(el => el.id || el.className).slice(0, 5);

      // Every visible input needs a label, explicit or wrapping.
      out.unlabelled = Array.from(document.querySelectorAll("input, select, textarea"))
        .filter(el => el.offsetParent !== null)
        .filter(el => !el.closest("label") &&
                      !el.getAttribute("aria-label") &&
                      !document.querySelector('label[for="' + el.id + '"]'))
        .map(el => el.id).slice(0, 5);

      out.htmlLang = document.documentElement.lang;
      out.liveRegion = Boolean(document.querySelector("[aria-live]"));
      out.hasH1 = document.querySelectorAll("h1").length > 0;

      // The SOS control is the highest-stakes button on the screen.
      const sos = document.getElementById("sos");
      out.sosLabel = sos ? sos.getAttribute("aria-label") : null;

      // Focus must be visible for keyboard users.
      const btn = document.querySelector(".screen.active button");
      if (btn) {
        btn.focus();
        const st = getComputedStyle(btn, ":focus-visible");
        out.focusStyled = st.outlineStyle !== "none" || st.outlineWidth !== "0px";
      }
      return out;
    `);
    check(a11y.unnamed.length === 0, "every visible control has an accessible name",
      a11y.unnamed.length ? a11y.unnamed.join(", ") : "all named");
    check(a11y.unlabelled.length === 0, "every visible input is labelled",
      a11y.unlabelled.length ? a11y.unlabelled.join(", ") : "all labelled");
    check(a11y.htmlLang === "en", "the document declares its language", a11y.htmlLang);
    check(a11y.liveRegion, "status messages are announced via a live region");
    check(a11y.hasH1, "each screen has a heading");
    check(Boolean(a11y.sosLabel), "the SOS control is labelled", a11y.sosLabel ?? "");
    check(a11y.focusStyled !== false, "focus is visible for keyboard users");

    // Status must never be carried by colour alone.
    const colourOnly = await page.eval(`
      location.hash = "#track";
      await new Promise(r => setTimeout(r, 400));
      const pills = Array.from(document.querySelectorAll("#t-body .pill"))
        .map(p => (p.textContent || "").trim());
      const steps = Array.from(document.querySelectorAll("#t-body ul li"))
        .map(li => (li.textContent || "").trim());
      return { pills, wordy: steps.filter(Boolean).length };
    `);
    check(colourOnly.pills.every((p) => p.length > 0),
      "status pills carry text, not just colour", colourOnly.pills.join(" / "));
    check(colourOnly.wordy >= 8, "timeline steps are words, not coloured dots",
      `${colourOnly.wordy} labelled steps`);

    // ══ 12. Small screens ═══════════════════════════════════════════════════
    section("12. Mobile widths");
    for (const w of [320, 360, 375, 390, 414, 768]) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: w, height: 780, deviceScaleFactor: 1, mobile: true,
      });
      await sleep(250);
      const over = await page.eval(`
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      `);
      check(over <= 0, `no horizontal overflow at ${w}px`, over > 0 ? `overflow=${over}px` : "");
    }
    await page.send("Emulation.clearDeviceMetricsOverride");

    // ══ 13. Touch targets ═══════════════════════════════════════════════════
    section("13. Touch targets");
    const small = await page.eval(`
      const tabs = Array.from(document.querySelectorAll(".tab"));
      return tabs.map(t => Math.round(t.getBoundingClientRect().height))
                 .filter(h => h > 0 && h < 44);
    `);
    check(small.length === 0, "bottom navigation targets are at least 44px",
      small.length ? `too small: ${small.join(", ")}` : "");

    // ══ 14. Mechanic console ════════════════════════════════════════════════
    section("14. Mechanic console");
    await page.goto(`${BASE}/mechanic.html`);
    await page.waitFor(`document.getElementById("m-signin")`);
    ok("mechanic.html loads");

    if (assignedMechanic) await page.setValue("#m-msisdn", assignedMechanic);
    await page.click("#m-signin");
    await page.waitFor(`document.getElementById("scr-work").hidden === false`, 45000);
    ok("mechanic signs in", assignedMechanic ? `as ${assignedMechanic}` : "");

    // The first fetch has to land before the record is real — over a tunnel
    // that is not instantaneous.
    await page.waitFor(
      `!/Loading/.test(document.getElementById("m-name").textContent)`, 25000);
    const console0 = await page.eval(`
      return {
        duty: document.getElementById("duty-state")?.textContent,
        switch: document.getElementById("duty-switch")?.getAttribute("aria-checked"),
        stats: document.querySelectorAll("#m-stats > div").length,
        tabs: document.querySelectorAll(".tab").length,
      };
    `);
    check(Boolean(console0.duty), "availability is shown in words", console0.duty);
    check(console0.stats >= 4, "the dashboard shows the mechanic's record", `${console0.stats} tiles`);
    check(console0.tabs === 4, "the console has its own navigation", `${console0.tabs} tabs`);

    // Toggle duty and confirm it round-trips through the server.
    const before = console0.switch;
    await page.click("#duty-switch");
    await sleep(2500);
    const after = await page.eval(`
      return document.getElementById("duty-switch").getAttribute("aria-checked");
    `);
    check(before !== after, "the duty switch changes state", `${before} -> ${after}`);

    // The job card names a person. Accounts created by signing in have no name
    // until they set one, so this used to read as the literal word "Customer".
    const jobCard = await page.eval(`
      const t = document.querySelector('.tab[data-pane="job"]');
      if (t) t.click();
      await new Promise(r => setTimeout(r, 1200));
      const tiles = [...document.querySelectorAll("#job-full .jobgrid > div")];
      const cust = tiles.find(d => /Customer/i.test(d.querySelector(".k")?.textContent || ""));
      return cust ? (cust.querySelector(".v")?.textContent || "").trim() : null;
    `);
    check(jobCard !== null && jobCard !== "Customer",
      "the mechanic's job card names a person, not the word Customer",
      jobCard ?? "(no active job)");

    const persisted = await page.eval(`
      const r = await fetch("/v1/mechanic/jobs", {
        headers: { authorization: "Bearer " +
          JSON.parse(sessionStorage.getItem("ra.mechanic.session")).token },
      });
      const j = await r.json();
      return String(j.data.mechanic.isAvailable);
    `);
    check(persisted === (after === "true" ? "true" : "false"),
      "the change reached the server", `server=${persisted}`);

    // Mechanic session persistence.
    await page.goto(`${BASE}/mechanic.html`);
    await page.waitFor(`document.getElementById("scr-work").hidden === false`, 45000);
    ok("the mechanic console survives a reload too");

    // A dispatch offer lives 90 seconds. Waiting up to 8 of those for the next
    // poll spent a tenth of the window doing nothing, so the console now holds
    // its own stream — and says which mode it is in rather than looking the
    // same either way.
    await page.waitFor(`document.getElementById("m-live").textContent === "Live"`, 15000,
      "the mechanic console to go live");
    ok("the mechanic console connects to the live dispatch stream");

    const mErrs = page.errors.filter((e) => !/favicon|manifest|geolocation|Permission/i.test(e));
    check(mErrs.length === 0, "mechanic console raises no uncaught exceptions",
      mErrs.length ? mErrs.slice(0, 2).join(" | ").slice(0, 200) : "clean");

    // ══ 14b. Authority dashboard ════════════════════════════════════════════
    // RAKSHA is a flagship surface and it polls every 10 seconds, so an expired
    // access token used to turn the whole console into a repeating error.
    section("14b. RAKSHA authority dashboard");
    page.errors.length = 0;
    await page.goto(`${BASE}/raksha.html`);
    await page.waitFor(`document.getElementById("login-btn")`);
    await page.setValue("#msisdn", "+919999900001");
    await page.click("#login-btn");
    await page.waitFor(`document.getElementById("login-panel").hidden === true`, 30000);
    ok("authority signs in");

    const authority = await page.eval(`
      return {
        who: document.getElementById("who").textContent,
        live: document.getElementById("live").textContent,
        signout: document.getElementById("signout-btn").hidden === false,
        stored: Boolean(JSON.parse(localStorage.getItem("ra.raksha.session") || "null")?.cookie)
          && !JSON.parse(localStorage.getItem("ra.raksha.session")).refresh,
        panels: ["health-panel","det-panel","dev-panel"]
          .filter(id => document.getElementById(id).hidden === false).length,
      };
    `);
    check(/gov_officer|admin/.test(authority.who), "the role is shown", authority.who);
    check(authority.stored, "the session is persisted, as an HttpOnly cookie (it used to be discarded)");
    check(authority.signout, "a sign-out control exists");
    check(authority.panels === 3, "the dashboard panels are populated", `${authority.panels}/3`);

    // Corrupt the access token and confirm the polling loop recovers silently.
    await page.eval(`
      const s = JSON.parse(sessionStorage.getItem("ra.raksha.session"));
      s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";
      sessionStorage.setItem("ra.raksha.session", JSON.stringify(s));
      return true;
    `);
    await page.goto(`${BASE}/raksha.html`);
    await page.waitFor(`document.getElementById("login-panel").hidden === true`, 30000);
    ok("a dead access token is exchanged rather than surfaced");

    const recovered = await page.eval(`
      // Let one live tick run against the refreshed token.
      await new Promise(r => setTimeout(r, 3000));
      return {
        status: document.getElementById("status").textContent,
        live: document.getElementById("live").textContent,
      };
    `);
    check(!/✗|expired|Sign in/i.test(recovered.status),
      "the live loop keeps working after the refresh", recovered.status.slice(0, 80));

    // The "Open detections" and "Severity 4–5" tiles counted the filtered,
    // 100-row page, so filtering to Rejected read 0 open on a corridor full of
    // open hazards. They are corridor-wide totals, whatever the filter shows.
    const tiles = await page.eval(`
      const sel = document.getElementById("f-status");
      sel.value = "REJECTED"; sel.onchange();
      await new Promise(r => setTimeout(r, 2500));
      const s = (await (await fetch("/v1/raksha/stats")).json()).data;
      const out = { open: Number(document.getElementById("n-open").textContent),
                    crit: Number(document.getElementById("n-crit").textContent),
                    statsOpen: s.open, statsCrit: s.open_critical };
      sel.value = ""; sel.onchange();
      await new Promise(r => setTimeout(r, 1500));
      return out;
    `);
    check(tiles.statsOpen > 0 && tiles.open === tiles.statsOpen && tiles.crit === tiles.statsCrit,
      "the open and severity tiles count the whole corridor, not the filtered page", JSON.stringify(tiles));

    const rErrs = page.errors.filter((e) => !/favicon|manifest|geolocation|Permission/i.test(e));
    check(rErrs.length === 0, "the dashboard raises no uncaught exceptions",
      rErrs.length ? rErrs.slice(0, 2).join(" | ").slice(0, 180) : "clean");

    // ══ 15. The full demo journey, both sides ═══════════════════════════════
    // This is the flow that gets demonstrated, so it is the flow that is
    // tested: the mechanic drives the job to COMPLETED, the customer pays and
    // rates it, and the customer's screen is checked for the *mechanic's*
    // actions arriving without a reload.
    section("15. Full journey: mechanic drives, customer pays and rates");

    // The mechanic side runs headlessly through the API using the console's own
    // stored session, so the browser can stay on the customer's screen and
    // prove the polling actually delivers.
    const drive = await page.eval(`
      const tok = JSON.parse(sessionStorage.getItem("ra.mechanic.session")).token;
      const call = async (m, p, b) => {
        const r = await fetch(p, {
          method: m,
          headers: { "content-type": "application/json", authorization: "Bearer " + tok },
          body: b ? JSON.stringify(b) : undefined,
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      };
      const jobs = await call("GET", "/v1/mechanic/jobs");
      const id = jobs.body.data.activeBookingId;
      if (!id) return { error: "mechanic has no active job" };
      const steps = [];
      for (const cmd of ["mechanic.start_travel", "arrive", "work.start", "work.complete"]) {
        const r = await call("POST", "/v1/bookings/" + id + "/transition", { command: cmd });
        steps.push(cmd + "=" + (r.body.data ? r.body.data.status : r.status));
      }
      return { id, steps };
    `);
    check(!drive.error, "mechanic drove the job through the state machine",
      drive.error ?? drive.steps.join(" → "));
    check(!drive.error && drive.id === customerBookingId,
      "the mechanic's active job is the very booking the customer made",
      drive.id === customerBookingId ? drive.id : `${drive.id} != ${customerBookingId}`);

    if (!drive.error) {
      // Back to the customer, on the booking the mechanic just finished.
      await page.goto(`${BASE}/app.html#track`);
      await page.waitFor(`document.getElementById("scr-home").classList.contains("active") ||
                          document.getElementById("scr-track").classList.contains("active")`, 15000);
      await page.eval(`
        const s = JSON.parse(localStorage.getItem("ra.app.session"));
        s.bookingId = ${JSON.stringify(drive.id)};
        localStorage.setItem("ra.app.session", JSON.stringify(s));
        return true;
      `);
      await page.goto(`${BASE}/app.html#track`);
      await page.waitFor(`document.querySelector("#t-invoice .num, #t-cmds button")`, 20000);

      const completed = await page.eval(`
        return {
          status: (document.querySelector("#t-body .pill") || {}).textContent,
          invoice: (document.querySelector("#t-invoice .num") || {}).textContent,
          pending: /Payment pending/i.test(document.getElementById("t-invoice").textContent),
        };
      `);
      check(/COMPLETED/i.test(completed.status ?? ""),
        "the customer sees COMPLETED without touching anything", completed.status);
      check(/₹/.test(completed.invoice ?? ""), "the invoice is shown with a total", completed.invoice);
      check(completed.pending, "payment is labelled pending, not claimed as paid");

      // Pay.
      await page.eval(`
        const b = Array.from(document.querySelectorAll("#t-cmds button"))
          .find(x => /pay/i.test(x.textContent));
        if (!b) throw new Error("no pay button; chips were: " +
          Array.from(document.querySelectorAll("#t-cmds button")).map(x => x.textContent).join(", "));
        b.click();
        return true;
      `);
      await page.waitFor(`document.getElementById("t-stars")`, 20000);
      ok("payment settled and the review prompt appeared");

      const paid = await page.eval(`
        return {
          status: (document.querySelector("#t-body .pill") || {}).textContent,
          // The invoice's own pill, not the card's concatenated textContent.
          invoicePill: (document.querySelector("#t-invoice .pill") || {}).textContent,
          submitDisabled: document.getElementById("t-submit").disabled,
        };
      `);
      check(/PAID/i.test(paid.status ?? ""), "the booking reached PAID", paid.status);
      check(paid.invoicePill === "Paid", "the invoice now reads Paid", paid.invoicePill);
      check(paid.submitDisabled, "review submit is disabled until a rating is chosen");

      // Rate it — pick 5, type a comment, then submit deliberately.
      await page.eval(`
        document.querySelectorAll("#t-stars .chip")[4].click();
        document.getElementById("t-comment").value = "Arrived fast, sorted it in ten minutes";
        return true;
      `);
      const armed = await page.eval(`return document.getElementById("t-submit").disabled === false;`);
      check(armed, "choosing a rating arms the submit button");

      await page.click("#t-submit");
      await page.waitFor(`/Rated/.test(document.getElementById("t-review").textContent)`, 15000);
      ok("review submitted with its comment");

      const dup = await page.eval(`
        const tok = JSON.parse(sessionStorage.getItem("ra.app.session")).token;
        const r = await fetch("/v1/bookings/${drive.id}/review", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + tok },
          body: JSON.stringify({ rating: 1 }),
        });
        const j = await r.json();
        return r.status + " " + (j.error ? j.error.code : "accepted");
      `);
      check(/409 already_reviewed/.test(dup), "a duplicate review is refused", dup);

      const finalErrs = page.errors.filter((e) => !/favicon|manifest|geolocation|Permission/i.test(e));
      check(finalErrs.length === 0, "the complete journey raises no uncaught exceptions",
        finalErrs.length ? finalErrs.slice(0, 2).join(" | ").slice(0, 200) : "clean");
    }

    // ══ 16. Booking with no GPS fix ═════════════════════════════════════════
    // locate() resolves with the NH-48 demo point when there is no fix. A
    // booking must not be sent there silently — a real mechanic would drive to
    // Gurugram. Last, so the extra booking it creates touches no other section.
    section("16. Booking with no fix: not sent, demo point only by choice");
    await page.send("Emulation.clearGeolocationOverride", {}).catch(() => {});
    await page.send("Browser.setPermission", {
      origin: BASE, permission: { name: "geolocation" }, setting: "denied",
    });
    await page.goto(`${BASE}/app.html#assist`);
    await page.waitFor(`document.getElementById("scr-book").classList.contains("active") &&
      document.querySelector('#b-steps [data-step="vehicle"]').classList.contains("done") &&
      document.getElementById("b-service").value`, 20000, "the booking screen with a vehicle and a service");
    await page.eval(`
      // The permission above is not honoured by every Chrome build (CI's kept
      // answering from an earlier override), so refuse at the API as well:
      // this is exactly what a browser with location turned off reports.
      const denied = { code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1 };
      navigator.geolocation.getCurrentPosition = function (ok, fail) { setTimeout(() => fail && fail(denied), 0); };
      navigator.geolocation.watchPosition = function (ok, fail) { setTimeout(() => fail && fail(denied), 0); return 0; };
      window.__bk = []; window.__bkRes = [];
      const realFetch = window.fetch;
      window.fetch = async function (url, init) {
        const mine = /\\/v1\\/bookings$/.test(String(url)) && init && init.method === "POST";
        if (mine) window.__bk.push(JSON.parse(init.body));
        const res = await realFetch.apply(this, arguments);
        if (mine) res.clone().json().then((j) => window.__bkRes.push({ status: res.status, data: j.data || null }));
        return res;
      };
      return true;
    `);

    await page.click("#b-locate");
    await page.waitFor(`/No location yet/.test(document.getElementById("b-loc-state").textContent)`, 15000,
      "step 3 to say there is no location");
    const nf = await page.eval(`
      const demo = document.querySelector('#b-location [data-loc="demo"]');
      return {
        detail: document.getElementById("b-loc-detail").textContent,
        retry: Boolean(document.querySelector('#b-location [data-loc="retry"]')),
        demo: demo ? demo.textContent : null,
        demoGhost: Boolean(demo && demo.classList.contains("ghost")),
        note: document.getElementById("b-loc-choice").textContent,
        done: document.querySelector('#b-steps [data-step="location"]').classList.contains("done"),
      };
    `);
    check(/Allow location in your browser and try again/.test(nf.detail),
      "with permission off, step 3 says to allow location and try again", nf.detail);
    check(nf.retry && nf.demo === "Use the NH-48 demo point (demo only)" && nf.demoGhost,
      "…offers Try again and a secondary 'Use the NH-48 demo point (demo only)' button", nf.demo);
    check(/sent to NH-48, Gurugram — for the classroom demo only/.test(nf.note),
      "…and says where a mechanic would be sent if the demo point is used", nf.note);
    check(!nf.done, "with no fix and no choice, step 3 is not complete");

    if (process.env.UI_SHOT_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.UI_SHOT_DIR, { recursive: true });
      await page.send("Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await page.eval(`document.getElementById("b-location").scrollIntoView({ block: "center" }); return true;`);
      await sleep(500);
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.UI_SHOT_DIR, "booking-no-location.png"), Buffer.from(data, "base64"));
      await page.send("Emulation.clearDeviceMetricsOverride");
      await sleep(300);
    }

    await page.click("#b-book");
    await page.waitFor(`document.getElementById("b-notsent")`, 15000, "the not-sent card");
    await sleep(500);
    const unsent = await page.eval(`
      return {
        posts: window.__bk.length,
        card: document.getElementById("b-notsent").textContent,
        demo: Boolean(document.querySelector('#b-notsent [data-loc="demo"]')),
        toast: document.getElementById("toast").textContent,
      };
    `);
    check(unsent.posts === 0, "'Request assistance' with no fix sends no /v1/bookings request",
      `${unsent.posts} POST(s)`);
    check(/Not sent: no location/.test(unsent.card) && /Not sent: no location/.test(unsent.toast) && unsent.demo,
      "…says 'Not sent: no location' and offers the same choice", unsent.toast);

    await page.click('#b-notsent [data-loc="demo"]');
    const chosen = await page.eval(`
      return {
        state: document.getElementById("b-loc-state").textContent,
        done: document.querySelector('#b-steps [data-step="location"]').classList.contains("done"),
      };
    `);
    check(chosen.done && /demo point/.test(chosen.state),
      "choosing the demo point completes step 3 and says it is the demo point", chosen.state);

    // Every toast is recorded: on a fast machine "N mechanics found" replaces
    // the "created" toast before a single read could see it.
    await page.eval(`
      window.__toasts = [];
      const el = document.getElementById("toast");
      new MutationObserver(() => window.__toasts.push(el.textContent))
        .observe(el, { childList: true, subtree: true, characterData: true });
      return true;
    `);
    await page.click("#b-book");
    await page.waitFor(`window.__bkRes.length === 1`, 20000, "the demo-point booking to be created");
    await page.waitFor(`window.__toasts.some((t) => /created/.test(t)) ||
      !document.getElementById("b-book").classList.contains("is-busy")`, 10000);
    const made = await page.eval(`
      return {
        body: window.__bk[0], res: window.__bkRes[0],
        toast: window.__toasts.find((t) => /created/.test(t)) || document.getElementById("toast").textContent,
      };
    `);
    check(made.res.status === 201 || made.res.status === 200, "…and then the booking is created",
      `${made.res.status} ${made.res.data && made.res.data.reference}`);
    check(made.body.lat === 28.4595 && made.body.lng === 77.0266 &&
      /\(demo point\)/.test(made.body.highwayMarker ?? "") && /\(demo point\)/.test(made.res.data?.highwayMarker ?? ""),
      "it is sent at the demo point with highwayMarker '… (demo point)', and stored that way",
      made.res.data?.highwayMarker);
    check(/\(demo point, chosen by you\)/.test(made.toast), "the toast says the demo point was the user's choice",
      made.toast);

    await page.waitFor(`!document.getElementById("b-book").classList.contains("is-busy")`, 25000);
    await page.click("#b-book");
    await page.waitFor(`document.getElementById("b-notsent")`, 15000, "the not-sent card again");
    const again = await page.eval(`return window.__bk.length;`);
    check(again === 1, "the choice was for that booking only: the next request with no fix is not sent",
      `${again} POST(s) in all`);

    // ══ 17. Online SOS: only what the server did ════════════════════════════
    // The sheet said "Help is on the way." after every confirm, including one
    // that reached no contact and no responder, because a unit had been
    // LOCATED. Driven here end to end against the real API: an account with no
    // emergency contacts, then the same account with one. Nothing is mocked —
    // the server's own answer decides the words, and both are checked.
    section("17. Online SOS says only what the server did");
    await page.send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] });
    await page.send("Emulation.setGeolocationOverride", { latitude: 28.4601, longitude: 77.0301, accuracy: 12 });
    // A number outside the seeded block (seeds own +917000000000–3999), so the
    // account has no contacts unless a previous run left one — removed below.
    const SOS_USER = "+917000009871";
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 20000);
    await page.eval(`document.getElementById("s-out").click(); return true;`);
    await page.waitFor(`document.getElementById("a-send") && document.getElementById("tabs").hidden === true`, 10000);
    await page.setValue("#a-msisdn", SOS_USER);
    await page.click("#a-send");
    await page.waitFor(`document.getElementById("a-step2").hidden === false`, 15000);
    await page.click("#a-verify");
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    const sosApi = (body) => page.eval(`
      const tok = JSON.parse(sessionStorage.getItem("ra.app.session")).token;
      const call = async (method, path, payload) => {
        const res = await fetch(path, { method, headers: { authorization: "Bearer " + tok,
          ...(payload ? { "content-type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
        return res.status === 204 ? null : res.json();
      };
      ${body}
    `);
    await sosApi(`
      // A clean slate from any earlier run: no contacts, no emergency left open.
      for (const c of (await call("GET", "/v1/me/emergency-contacts")).data || []) {
        await call("DELETE", "/v1/me/emergency-contacts/" + c.id);
      }
      for (const i of (await call("GET", "/v1/me/incidents")).data || []) {
        await call("POST", "/v1/sos/" + i.id + "/cancel", {});
      }
      return true;
    `);

    // Raise from the SOS control, press "Alert now", and read what the sheet says.
    const raiseAndConfirm = () => page.eval(`
      window.__sosAns = null;
      const realFetch = window.fetch;
      window.fetch = async function (url) {
        const res = await realFetch.apply(this, arguments);
        if (/\\/v1\\/sos\\/[^/]+\\/confirm$/.test(String(url))) res.clone().json().then((j) => { window.__sosAns = j.data || null; });
        return res;
      };
      try {
        document.querySelector('.tab[data-nav="home"]').click();
        document.getElementById("sos").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const t0 = Date.now(), sheet = document.getElementById("sheet-sos");
        while (Date.now() - t0 < 10000 && !(sheet.classList.contains("show") && !document.getElementById("sos-now").hidden)) {
          await new Promise(r => setTimeout(r, 100));
        }
        const grace = document.getElementById("sos-copy").textContent;
        document.getElementById("sos-now").click();
        while (Date.now() - t0 < 20000 && !(window.__sosAns && document.querySelector("#sos-out .card.feature"))) {
          await new Promise(r => setTimeout(r, 100));
        }
        await new Promise(r => setTimeout(r, 300));
        const out = document.getElementById("sos-out");
        const call = document.getElementById("sos-call");
        const card = out.querySelector(".card.feature");
        return {
          ans: window.__sosAns,
          grace,
          dial: document.getElementById("sos-n").textContent,
          copy: document.getElementById("sos-copy").textContent,
          sheet: sheet.innerText,
          call: call ? { href: call.getAttribute("href"), text: call.textContent.trim(),
            leads: Boolean(card) && Boolean(call.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) } : null,
        };
      } finally { window.fetch = realFetch; }
    `);
    const shoot = async (name) => {
      if (!process.env.UI_SHOT_DIR) return;
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.UI_SHOT_DIR, { recursive: true });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await page.eval(`document.getElementById("sheet-sos").scrollTop = 0; return true;`);
      await sleep(600);
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.UI_SHOT_DIR, name), Buffer.from(data, "base64"));
      await page.send("Emulation.clearDeviceMetricsOverride");
      await sleep(300);
    };
    // "I'm safe now" on the sheet: the real way out, so nothing is left open.
    const standDown = () => page.eval(`
      const safe = Array.from(document.querySelectorAll("#sos-out button")).find((b) => /safe now/i.test(b.textContent));
      if (safe) safe.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && document.getElementById("sheet-sos").classList.contains("show")) {
        await new Promise(r => setTimeout(r, 100));
      }
      return { pressed: Boolean(safe), closed: !document.getElementById("sheet-sos").classList.contains("show") };
    `);
    const NOT_ON_FAITH = /on the way|help is coming|responders have been alerted/i;

    const none = await raiseAndConfirm();
    const ref0 = String(none.ans?.id ?? "").slice(0, 8);
    check(none.ans && none.ans.contactsAlerted === 0 && none.ans.respondersNotified === 0,
      "no contacts on file: the server reports 0 contacts alerted and 0 responders notified",
      JSON.stringify({ contacts: none.ans?.contactsAlerted, responders: none.ans?.respondersNotified,
        located: none.ans?.nearestResponder?.name ?? null }));
    check(none.copy === `Emergency recorded (ref ${ref0}). No responder or contact was reached. Call 112 now.`,
      "…and the sheet says exactly that: recorded, nobody reached, call 112", none.copy);
    check(!NOT_ON_FAITH.test(none.sheet), "…and nowhere claims help is on the way or responders were alerted");
    check(none.dial !== "✓", "…and shows no success tick when nobody was reached", none.dial);
    check(none.call && none.call.href === "tel:112" && none.call.text === "Call 112 now" && none.call.leads,
      "a 'Call 112 now' button (tel:112) leads the sheet, above the escalation card", JSON.stringify(none.call));
    check(none.ans?.nearestResponder
      ? /unit located, not contacted/.test(none.sheet) && !/ETA/.test(none.sheet)
      : /no unit in range/.test(none.sheet),
      "a located responder unit is shown as not contacted, with no ETA");
    await shoot("sos-no-contacts.png");
    const closed0 = await standDown();
    check(closed0.pressed && closed0.closed, "'I'm safe now' closes it, so the test leaves nothing open");

    await sosApi(`
      await call("POST", "/v1/me/emergency-contacts", { name: "Test Contact", msisdn: "+919812345601", relation: "friend" });
      return true;
    `);
    const one = await raiseAndConfirm();
    const ref1 = String(one.ans?.id ?? "").slice(0, 8);
    check(one.ans && one.ans.contactsAlerted === 1 && one.ans.respondersNotified === 0 &&
      typeof one.ans.smsLive === "boolean",
      "with one contact on file: the server counts 1 contact, 0 responders, and says whether SMS is live",
      JSON.stringify({ contacts: one.ans?.contactsAlerted, responders: one.ans?.respondersNotified,
        smsLive: one.ans?.smsLive }));
    // The suite runs on SMS_PROVIDER=console, as the hosted demo does: the
    // "send" is a log line, so the sheet must not say the contact was alerted.
    // Against a live provider the same check expects "was alerted".
    check(one.copy === (one.ans?.smsLive
      ? `Emergency recorded (ref ${ref1}). Your 1 emergency contact was alerted. No responder was contacted. Call 112 now.`
      : `Emergency recorded (ref ${ref1}). Your 1 emergency contact would be texted. On this demo server SMS is ` +
        "only logged, not sent. No responder or contact was reached. Call 112 now."),
      "…and the sheet says what happened to that contact's text, and that no responder was contacted", one.copy);
    check(one.ans?.smsLive
      ? /1 alerted/.test(one.sheet) && one.dial === "✓"
      : /1 logged, not sent/.test(one.sheet) && !/1 alerted|was alerted/.test(one.sheet) && one.dial !== "✓" &&
        /only logged, not sent/.test(one.grace),
      "…the card row, the dial and the countdown agree (logged, not sent, when SMS is not live)",
      `${one.dial} | ${one.grace}`);
    check(!NOT_ON_FAITH.test(one.sheet) && one.call?.leads === true,
      "…with no 'on the way', and Call 112 still leading the sheet");
    await shoot("sos-with-contacts.png");
    await standDown();
    await sosApi(`
      for (const c of (await call("GET", "/v1/me/emergency-contacts")).data || []) {
        await call("DELETE", "/v1/me/emergency-contacts/" + c.id);
      }
      return true;
    `);


    // ══ 18–35. The web bug hunt of 7 Oct 2026 ═══════════════════════════════
    // Each of these reproduced in a real Chrome before it was fixed, and each
    // check below failed against the code before the fix. Every section signs
    // in its own number (+9170000047xx, clear of the seeds), so it stands
    // alone, and stands down any emergency it raised.
    // A section that throws is a failed check, not the end of the run: the
    // ones after it still report.
    const part = async (title, fn) => {
      section(title);
      try { await fn(); } catch (e) {
        bad("aborted: " + title.replace(/^\d+\. /, ""), e.message.slice(0, 160));
        await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
      }
    };
    const APP = `${BASE}/app.html`;
    const NET_OFF = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    const NET_ON = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    const TOK = `JSON.parse(sessionStorage.getItem("ra.app.session")).token`;
    // Registrations are unique server-wide: a rerun on the same database gets new ones.
    const RUN = String(Date.now() % 10000).padStart(4, "0");
    const settled = `document.readyState === "complete" && document.getElementById("auth-restoring").hidden === true &&
      (document.getElementById("scr-home").classList.contains("active") || document.getElementById("scr-auth").classList.contains("active"))`;
    const signInAs = async (msisdn, base = BASE) => {
      await page.goto(`${base}/app.html`);
      await page.waitFor(settled, 25000, "the app to settle");
      if (await page.eval(`return document.getElementById("tabs").hidden === false;`)) {
        await page.eval(`document.getElementById("s-out").click(); return true;`);
        await page.waitFor(`document.getElementById("tabs").hidden === true`, 10000, "sign-out");
      }
      await page.setValue("#a-msisdn", msisdn);
      await page.click("#a-send");
      await page.waitFor(`/^\\d{6}$/.test(document.getElementById("a-code").value)`, 15000, "the dev code");
      await page.click("#a-verify");
      await page.waitFor(`document.getElementById("scr-home").classList.contains("active") && !document.getElementById("tabs").hidden`, 20000, "home");
      await page.waitFor(`window.__ra && window.__ra.offGrid().storeLoaded && window.__ra.offGrid().managerLoaded`, 15000, "off-grid modules");
    };
    const offGrid = async (on) => {
      await page.eval(`if ((window.__ra.tier() === "OFFLINE") !== ${on}) document.getElementById("net").click(); return true;`);
      await page.waitFor(on ? `window.__ra.tier() === "OFFLINE"` : `window.__ra.tier() !== "OFFLINE"`, 15000, `tier ${on ? "OFFLINE" : "back"}`);
    };
    const pressSos = () => page.eval(`document.getElementById("sos").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true;`);
    // Every toast, in order: one replaces another faster than a single read can see.
    const recordToasts = () => page.eval(`
      window.__toasts = [];
      const el = document.getElementById("toast");
      new MutationObserver(() => window.__toasts.push(el.textContent))
        .observe(el, { childList: true, subtree: true, characterData: true });
      return true;`);
    // Cancel every emergency this account has open, until the server lists none
    // (an escalation still in flight can land after the first cancel), and wait
    // for the page to hear of it: one left open refuses the next SOS (§25).
    const standDownAll = () => page.eval(`
      const call = async (method, path, body) => {
        const send = () => fetch(path, { method, body, headers: { "content-type": "application/json", authorization: "Bearer " + ${TOK} } });
        let r = await send();
        if (r.status === 401 && await window.__ra.refreshSession()) r = await send();
        return r.json();
      };
      let left = [];
      for (let n = 0; n < 4; n++) {
        for (const i of (await call("GET", "/v1/me/incidents")).data || []) await call("POST", "/v1/sos/" + i.id + "/cancel", "{}");
        await new Promise((r) => setTimeout(r, 800));
        left = (await call("GET", "/v1/me/incidents")).data || [];
        if (!left.length) break;
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 6000 && Object.keys(JSON.parse(localStorage.getItem("ra.app.sos") || "{}")).length) {
        await new Promise((r) => setTimeout(r, 150));
      }
      return left.length;`);
    await page.send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] });
    await page.send("Emulation.setGeolocationOverride", { latitude: 28.4601, longitude: 77.0301, accuracy: 12 });

    // ══ 18. No signal is not a sign-out ═════════════════════════════════════
    await part("18. Reopened with no signal: still signed in, SOS in reach", async () => {
      await signInAs("+917000004701");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await page.waitFor(`navigator.serviceWorker.controller`, 20000, "the service worker to control the page");
      await page.send("Network.emulateNetworkConditions", NET_OFF);
      await page.goto(APP);
      await page.waitFor(settled, 25000, "the app to settle offline");
      await sleep(800);
      const reopened = await page.eval(`return {
        screen: document.querySelector(".screen.active").id, tabs: !document.getElementById("tabs").hidden,
        sos: Boolean(document.getElementById("sos").offsetParent), kept: Boolean(localStorage.getItem("ra.app.session")) };`);
      check(reopened.screen === "scr-home" && reopened.tabs && reopened.sos,
        "reopened with no signal, the app opens on Home with SOS in reach — not on sign-in", JSON.stringify(reopened));
      check(reopened.kept, "…and the stored session is kept, not wiped");
      await page.waitFor(`window.__ra && window.__ra.offGrid().storeLoaded && window.__ra.tier() === "OFFLINE"`, 15000, "off-grid tier");
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      ok("…and an SOS raised there is stored on this device");
      await page.eval(`document.getElementById("og-close").click(); return true;`);
      await page.send("Network.emulateNetworkConditions", NET_ON);
      await page.waitFor(`window.__ra.tier() !== "OFFLINE" && !/offline/.test(document.getElementById("home-sub").textContent)`, 40000,
        "the app to reload itself online");
      await page.waitFor(`await window.__ra.listOffGrid().then((l) => l.length && l[0].status === "SYNCED")`, 20000, "the stored SOS to send");
      const reconnected = await page.eval(`return { tabs: !document.getElementById("tabs").hidden, sub: document.getElementById("home-sub").textContent };`);
      check(reconnected.tabs, "when the signal returns it reloads itself, still signed in, and sends the stored SOS", reconnected.sub);
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);

    });

    await part("18b. The mechanic console: its own service worker, and an offline reopen", async () => {
      // It never registered the worker, so it only worked offline if the citizen
      // app had registered it first; and a reopen with no signal signed it out.
      await page.goto(`${BASE}/mechanic.html`);
      await page.waitFor(`document.getElementById("m-signin")`);
      await page.eval(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); return true;`);
      await page.goto(`${BASE}/mechanic.html`);
      await sleep(1500);
      const mReg = await page.eval(`
        const t0 = Date.now();
        while (Date.now() - t0 < 10000 && !(await navigator.serviceWorker.getRegistration())) await new Promise((r) => setTimeout(r, 200));
        return Boolean(await navigator.serviceWorker.getRegistration());`);
      check(mReg, "mechanic.html registers the service worker itself");
      // (If it did not, the check above has failed; register it here so the offline check below still runs.)
      await page.eval(`if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("sw.js"); return true;`);
      if (await page.eval(`return document.getElementById("scr-work").hidden;`)) {
        await page.setValue("#m-msisdn", "+919600000440");
        await page.click("#m-signin");
      }
      await page.waitFor(`document.getElementById("scr-work").hidden === false`, 45000, "the mechanic console");
      await page.waitFor(`navigator.serviceWorker.controller`, 20000, "the worker to control the console");
      await page.goto(`${BASE}/mechanic.html`);
      await page.waitFor(`document.getElementById("scr-work").hidden === false`, 30000);
      await page.send("Network.emulateNetworkConditions", NET_OFF);
      await page.goto(`${BASE}/mechanic.html`);
      await sleep(4000);
      const mOff = await page.eval(`return { work: !document.getElementById("scr-work").hidden,
        kept: Boolean(localStorage.getItem("ra.mechanic.session")) };`);
      await page.send("Network.emulateNetworkConditions", NET_ON);
      check(mOff.work && mOff.kept, "the mechanic console reopened with no signal stays signed in", JSON.stringify(mOff));
    });
    // ══ 19. One phone, two people ═══════════════════════════════════════════
    await part("19. A shared phone: the queue and an off-grid SOS stay with their owner", async () => {
      await signInAs("+917000004702");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await page.setValue("#v-reg", `KA01AB${RUN}`);
      await page.click("#v-add");
      await sleep(600);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "A's off-grid incident");
      const incA = await page.eval(`const id = window.__ra.offGrid().incidentId; document.getElementById("og-close").click(); return id;`);
      page.dialogs.length = 0;
      await page.eval(`document.getElementById("s-out").click(); return true;`);
      await page.waitFor(`document.getElementById("tabs").hidden === true`, 10000, "A signed out");
      check(page.dialogs.some((d) => /not reached RoadAssist yet/.test(d)),
        "signing out with an unsent SOS warns first, and says it stays on this device", (page.dialogs[0] || "(no warning)").slice(0, 90));
      // B signs in on the same page (sign-in is never queued), then signal returns.
      await page.setValue("#a-msisdn", "+917000004703");
      await page.click("#a-send");
      await page.waitFor(`/^\\d{6}$/.test(document.getElementById("a-code").value)`, 15000);
      await page.click("#a-verify");
      await page.waitFor(`!document.getElementById("tabs").hidden`, 20000);
      await offGrid(false);
      await sleep(6000);
      const shared = await page.eval(`
        const me = await (await fetch("/v1/me", { headers: { authorization: "Bearer " + ${TOK} } })).json();
        const inc = (await window.__ra.listOffGrid()).find((i) => i.incidentId === ${JSON.stringify(incA)});
        return { bVehicles: me.data.vehicles.map((v) => v.registrationNo), aStatus: inc ? inc.status : null,
          queue: localStorage.getItem("ra.app.queue") || "", screen: document.getElementById("og-body").innerText };`);
      check(!shared.bVehicles.includes(`KA01AB${RUN}`), "the next user's reconnect does not replay the last user's queued vehicle",
        JSON.stringify(shared.bVehicles));
      check(shared.aStatus && shared.aStatus !== "SYNCED", "…nor send the last user's off-grid SOS under their own account", shared.aStatus);
      check(shared.queue.includes(`KA01AB${RUN}`), "…which both stay on the device, still the first user's");
      check(!shared.screen.includes(incA), "…and the off-grid screen does not show the next user someone else's incident");
      await signInAs("+917000004702");
      await page.waitFor(`await window.__ra.listOffGrid().then((l) => (l.find((i) => i.incidentId === ${JSON.stringify(incA)}) || {}).status === "SYNCED")`,
        20000, "A's SOS to send when A is back");
      const own = await page.eval(`
        const me = await (await fetch("/v1/me", { headers: { authorization: "Bearer " + ${TOK} } })).json();
        return me.data.vehicles.map((v) => v.registrationNo);`);
      check(own.includes(`KA01AB${RUN}`), "when its owner signs in again, their queue and their SOS go out", JSON.stringify(own));
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);

    });
    // ══ 20. Cancel while the off-grid SOS is on the wire ════════════════════
    await part("20. 'Cancel — false alarm' during the reconnect upload", async () => {
      await signInAs("+917000004704");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      await recordToasts();
      await page.eval(`
        window.__calls = []; window.__held = false;
        const real = window.__realFetch = window.fetch;
        let release; window.__release = () => release();
        const hold = new Promise((r) => { release = r; });
        window.fetch = async function (url) {
          const u = String(url);
          if (/\\/v1\\/sos\\//.test(u)) window.__calls.push(u.replace(/^.*\\/v1\\/sos\\//, ""));
          if (/offline-sync$/.test(u)) { window.__held = true; await hold; }
          return real.apply(this, arguments);
        };
        document.getElementById("net").click();     // signal returns: the upload starts, and is held
        return true;`);
      await page.waitFor(`window.__held`, 15000, "the upload to be in flight");
      const midway = await page.eval(`
        document.getElementById("sos-abort").click();
        await new Promise((r) => setTimeout(r, 500));
        const l = await window.__ra.listOffGrid();
        return { toast: window.__toasts.join(" | "), status: l[0] && l[0].status };`);
      check(!/nothing was ever transmitted/.test(midway.toast),
        "pressed mid-upload, it no longer says 'nothing was ever transmitted'", midway.toast.slice(0, 120));
      check(midway.status === "SYNCING", "…because the record is marked as on the wire, so it cannot be withdrawn locally", midway.status);
      await page.eval(`window.__release(); return true;`);
      await sleep(4000);
      const cancelled = await page.eval(`
        window.fetch = window.__realFetch;
        const open = (await (await fetch("/v1/me/incidents", { headers: { authorization: "Bearer " + ${TOK} } })).json()).data || [];
        return { calls: window.__calls, open: open.length };`);
      check(!cancelled.calls.some((c) => /confirm$/.test(c)) && cancelled.calls.some((c) => /cancel$/.test(c)) && cancelled.open === 0,
        "once the server has it, it is cancelled there as a false alarm — and nobody is alerted", JSON.stringify(cancelled));
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);

    });
    // ══ 21–22. The generic queue ════════════════════════════════════════════
    await part("21. A queued action lost on the way back is kept, not dropped", async () => {
      await signInAs("+917000004705");
      await offGrid(true);
      await page.setValue("#v-reg", `KA01AC${RUN}`);
      await page.click("#v-add");
      await sleep(600);
      await page.eval(`
        const real = window.__realFetch = window.fetch;
        window.fetch = function (url, init) {
          if (/\\/v1\\/vehicles$/.test(String(url)) && init && init.method === "POST") {
            return Promise.reject(new TypeError("Failed to fetch"));      // the link drops mid-replay, until restored
          }
          return real.apply(this, arguments);
        };
        return true;`);
      await recordToasts();
      await offGrid(false);
      // Each failed attempt is retried as the connection settles; between two of
      // them the entry is briefly out of storage, so wait for it to be put back.
      const kept = await page.waitFor(`window.__toasts.some((t) => /still waiting/.test(t)) &&
        (localStorage.getItem("ra.app.queue") || "").includes("KA01AC${RUN}")`, 10000).then(() => true, () => false);
      const dropped = await page.eval(`return { toasts: window.__toasts.join(" | ") };`);
      check(kept, "a replay the network dropped goes back in the queue", dropped.toasts.slice(-90));
      await page.eval(`window.fetch = window.__realFetch; document.getElementById("q-flush").click(); return true;`);
      await sleep(3000);
      const replayed = await page.eval(`
        const me = await (await fetch("/v1/me", { headers: { authorization: "Bearer " + ${TOK} } })).json();
        return { vehicles: me.data.vehicles.map((v) => v.registrationNo), queue: localStorage.getItem("ra.app.queue") || "" };`);
      check(replayed.vehicles.includes(`KA01AC${RUN}`) && !replayed.queue.includes(`KA01AC${RUN}`),
        "…and lands on the next attempt", JSON.stringify(replayed.vehicles));

    });
    await part("22. A booking needs a connection, and says so", async () => {
      await page.goto(APP);                         // the replayed vehicle, now in the app's own state
      await page.waitFor(settled, 20000);
      await page.eval(`location.hash = "#assist"; return true;`);
      await page.waitFor(`document.getElementById("b-service").value`, 15000, "the services");
      await page.click("#b-locate");
      await page.waitFor(`/Location ready/.test(document.getElementById("b-loc-state").textContent)`, 15000, "a fix");
      await offGrid(true);
      await recordToasts();
      await page.click("#b-book");
      await sleep(1200);
      const booked = await page.eval(`return { toasts: window.__toasts.join(" | "), offers: document.getElementById("b-offers").innerText,
        queue: localStorage.getItem("ra.app.queue") || "" };`);
      check(!/\/v1\/bookings/.test(booked.queue) && /needs a connection/.test(booked.offers),
        "off-grid, a booking is not queued (it could never be dispatched) and the screen says it needs a connection",
        booked.offers.slice(0, 100));
      await offGrid(false);

    });
    // ══ 23. Hazard reports go through the queue ═════════════════════════════
    await part("23. An off-grid hazard report is queued, never sent", async () => {
      await page.eval(`location.hash = "#home"; return true;`);
      await offGrid(true);
      await page.eval(`
        window.__reports = 0;
        const real = window.__realFetch = window.fetch;
        window.fetch = function (url, init) {
          if (/\\/v1\\/raksha\\/report$/.test(String(url))) window.__reports++;
          return real.apply(this, arguments);
        };
        document.getElementById("q-report").click();
        document.getElementById("r-note").value = "pothole, reported off-grid";
        document.getElementById("r-send").click();
        await new Promise((r) => setTimeout(r, 2500));
        return true;`);
      const rep0 = await page.eval(`return { sent: window.__reports, queue: localStorage.getItem("ra.app.queue") || "",
        open: document.getElementById("sheet-report").classList.contains("show"), toast: document.getElementById("toast").textContent };`);
      check(rep0.sent === 0, "with 'Off-grid' on the pill, a hazard report sends nothing", `${rep0.sent} request(s)`);
      check(/\/v1\/raksha\/report/.test(rep0.queue) && !rep0.open && /queued/i.test(rep0.toast),
        "…it joins the queue, the sheet closes, and the toast says queued", rep0.toast);
      // A full device: the report keeps its place in the queue and the photo is the part that gives.
      const full = await page.eval(`
        const blob = await (await fetch("/icon-512.png")).blob();
        const dt = new DataTransfer(); dt.items.add(new File([blob], "pothole.png", { type: "image/png" }));
        const input = document.getElementById("r-photo"); input.files = dt.files; input.dispatchEvent(new Event("change"));
        await new Promise((r) => setTimeout(r, 1500));
        const big = "x".repeat(256 * 1024); let i = 0;
        try { for (;;) localStorage.setItem("fill-" + i++, big); } catch (e) { /* full */ }
        const small = "y".repeat(1024); let j = 0;
        try { for (;;) localStorage.setItem("fillsmall-" + j++, small); } catch (e) { /* brim */ }
        localStorage.removeItem("fillsmall-" + (j - 2)); localStorage.removeItem("fillsmall-" + (j - 3));
        window.__toasts = [];
        const el = document.getElementById("toast");
        new MutationObserver(() => window.__toasts.push(el.textContent)).observe(el, { childList: true, subtree: true, characterData: true });
        document.getElementById("q-report").click();
        document.getElementById("r-note").value = "pothole with a photo, storage full";
        document.getElementById("r-send").click();
        await new Promise((r) => setTimeout(r, 2500));
        for (let k = 0; k < i; k++) localStorage.removeItem("fill-" + k);
        for (let k = 0; k < j; k++) localStorage.removeItem("fillsmall-" + k);
        return { toasts: window.__toasts.join(" | "), stored: /storage full/.test(localStorage.getItem("ra.app.queue") || "") };`);
      check(/without its photo/.test(full.toasts), "with the device's storage full, the report is queued without its photo, and says so",
        full.toasts.slice(0, 120));
      await page.eval(`window.fetch = window.__realFetch; return true;`);
      await offGrid(false);
      await sleep(3500);
      const rep1 = await page.eval(`
        const r = await (await fetch("/v1/me/reports", { headers: { authorization: "Bearer " + ${TOK} } })).json();
        return { notes: (r.data || []).map((d) => d.notes), queue: localStorage.getItem("ra.app.queue") || "" };`);
      check(rep1.notes.includes("pothole, reported off-grid") && !/raksha\/report/.test(rep1.queue),
        "…and both reports are filed when the signal returns", JSON.stringify(rep1.notes));

    });
    // ══ 24. The confirm after an off-grid sync ══════════════════════════════
    await part("24. An off-grid SOS whose alerting fails says so, and retries", async () => {
      await signInAs("+917000004706");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      await page.eval(`document.getElementById("og-close").click(); location.hash = "#offgrid"; return true;`);
      await recordToasts();
      await page.eval(`
        window.__confirms = 0;
        const real = window.__realFetch = window.fetch;
        window.fetch = function (url) {
          if (/\\/confirm$/.test(String(url)) && window.__confirms++ === 0) {
            return Promise.resolve(new Response(JSON.stringify({ error: { code: "unavailable", title: "Service unavailable", retryable: true } }),
              { status: 503, headers: { "content-type": "application/json" } }));
          }
          return real.apply(this, arguments);
        };
        document.getElementById("net").click();
        return true;`);
      await page.waitFor(`await window.__ra.listOffGrid().then((l) => l.length && l[0].status === "SYNCED")`, 20000, "the sync");
      await sleep(800);
      const alertFail = await page.eval(`return { toasts: window.__toasts.join(" | "),
        screen: (document.getElementById("og-sync-status") || {}).innerText || "" };`);
      check(/alerting failed — call 112/.test(alertFail.toasts) && !/dispatch can now process/.test(alertFail.toasts),
        "a failed escalation after the sync says 'Recorded, but alerting failed — call 112', not success", alertFail.toasts.slice(0, 120));
      check(/alerting failed/.test(alertFail.screen), "…and so does the off-grid screen", alertFail.screen.slice(0, 80));
      await page.waitFor(`window.__confirms >= 2`, 15000, "the confirm to be retried").catch(() => {});
      await sleep(1500);
      const retried = await page.eval(`window.fetch = window.__realFetch; return { n: window.__confirms, toasts: window.__toasts.join(" | ") };`);
      check(retried.n >= 2 && /now been escalated/.test(retried.toasts), "…and the confirm is retried until it lands", `${retried.n} confirm(s)`);
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); location.hash = "#home"; return true;`);

    });
    // ══ 25. One emergency at a time ═════════════════════════════════════════
    await part("25. A second SOS while the first is open points to the first", async () => {
      await signInAs("+917000004707");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await page.eval(`
        window.__raises = 0;
        const real = window.__realFetch = window.fetch;
        window.fetch = function (url, init) {
          if (/\\/v1\\/sos$/.test(String(url)) && init && init.method === "POST") window.__raises++;
          return real.apply(this, arguments);
        };
        return true;`);
      await pressSos();
      await page.waitFor(`document.getElementById("sheet-sos").classList.contains("show") && !document.getElementById("sos-now").hidden`, 15000);
      await page.click("#sos-now");
      await page.waitFor(`document.getElementById("sos-done")`, 20000, "the escalation");
      await page.click("#sos-done");
      await recordToasts();
      await pressSos();
      await sleep(2500);
      const second = await page.eval(`return { raises: window.__raises, toasts: window.__toasts.join(" | "),
        sheet: document.getElementById("sheet-sos").classList.contains("show") };`);
      check(second.raises === 1 && /already open/.test(second.toasts) && !second.sheet,
        "online: holding SOS again raises nothing new and points to the open one", `${second.raises} raised | ${second.toasts.slice(0, 80)}`);
      await standDownAll();
      await page.goto(APP);                         // the server's list replaces what the device remembered
      await page.waitFor(settled, 20000);
      await page.waitFor(`window.__ra.offGrid().storeLoaded && window.__ra.offGrid().managerLoaded`, 15000);
      await offGrid(true);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      await page.eval(`document.getElementById("og-close").click(); return true;`);
      await recordToasts();
      await pressSos();
      await sleep(2000);
      const second2 = await page.eval(`return { n: (await window.__ra.listOffGrid()).length, toasts: window.__toasts.join(" | ") };`);
      check(second2.n === 1 && /already open/.test(second2.toasts),
        "off-grid: a second hold while the first is still on the device stores no second incident", `${second2.n} stored`);
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);   // the reload above already dropped the wrapper
      await offGrid(false);

    });
    // ══ 26. The map in the app keeps up with the app's token ════════════════
    await part("26. The in-app map follows the app's own session", async () => {
      const mapTok = await page.eval(`
        const badge = (f) => (f.contentDocument && f.contentDocument.getElementById("badge") || {}).innerText || "";
        const wait = async (f) => { const t0 = Date.now(); while (Date.now() - t0 < 12000 && !/mechanic|⚠|OFFLINE/.test(badge(f))) await new Promise((r) => setTimeout(r, 200)); };
        const f = document.createElement("iframe");
        f.style.cssText = "position:fixed;left:0;top:0;width:320px;height:320px;opacity:0";
        // The token the frame was opened with has expired (ten minutes on); the page's session has not.
        f.src = "map.html#base=" + encodeURIComponent(location.origin) +
          "&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef&slot=ra.app.session";
        document.body.appendChild(f);
        await wait(f);
        const first = badge(f);
        // Now the page's own access token expires: the frame asks the page to refresh it.
        const s = JSON.parse(sessionStorage.getItem("ra.app.session"));
        s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";
        sessionStorage.setItem("ra.app.session", JSON.stringify(s));
        f.contentDocument.getElementById("badge").innerText = "";
        f.contentWindow.__refresh && f.contentWindow.__refresh();
        await wait(f);
        const second = badge(f);
        f.remove();
        return { first, second };`);
      check(/mechanic/.test(mapTok.first) && !/expired/.test(mapTok.first),
        "a frame opened with a since-expired token reads the page's current session", mapTok.first.split("\n")[0]);
      check(/mechanic/.test(mapTok.second) && !/expired/.test(mapTok.second),
        "…and when that expires too, the map has the page refresh it rather than saying 'session expired'", mapTok.second.split("\n")[0]);

    });
    // ══ 27. The mechanic console does not drop a refresh ════════════════════
    await part("27. Mechanic console: a refresh asked for mid-poll is not dropped", async () => {
      await page.goto(`${BASE}/mechanic.html`);
      await page.waitFor(`document.getElementById("m-signin")`);
      if (await page.eval(`return document.getElementById("scr-work").hidden;`)) {
        await page.setValue("#m-msisdn", "+919600000440");
        await page.click("#m-signin");
      }
      await page.waitFor(`document.getElementById("scr-work").hidden === false && !/Loading/.test(document.getElementById("m-name").textContent)`, 45000);
      await sleep(1500);
      const coalesce = await page.eval(`
        window.__jobs = 0; let release; const hold = new Promise((r) => { release = r; }); let held = false;
        const real = window.fetch;
        window.fetch = async function (url) {
          if (/\\/v1\\/mechanic\\/jobs/.test(String(url))) { window.__jobs++; if (!held) { held = true; await hold; } }
          return real.apply(this, arguments);
        };
        document.getElementById("m-refresh").click();             // a poll goes out, and is slow
        await new Promise((r) => setTimeout(r, 300));
        document.dispatchEvent(new Event("visibilitychange"));     // a second refresh arrives mid-flight, as a pushed offer's does
        await new Promise((r) => setTimeout(r, 300));
        const during = window.__jobs;
        release();
        await new Promise((r) => setTimeout(r, 2500));
        window.fetch = real;
        return { during, after: window.__jobs };`);
      check(coalesce.during === 1 && coalesce.after >= 2,
        "a refresh asked for while one is in flight runs after it, instead of being dropped", JSON.stringify(coalesce));

    });
    // ══ 28. A deploy: pages and scripts agree on the first load ═════════════
    await part("28. After a deploy, a page's scripts come from the network, not the old cache", async () => {
      await page.goto(APP);
      await page.waitFor(`navigator.serviceWorker.controller`, 20000);
      await page.eval(`
        const key = (await caches.keys()).find((k) => /-shell$/.test(k));
        const c = await caches.open(key);
        const fresh = await (await fetch("/near.js", { cache: "no-store" })).text();
        await c.put("/near.js", new Response("window.__staleShell = true;\\n" + fresh, { headers: { "content-type": "text/javascript" } }));
        return true;`);
      await page.goto(APP);
      await page.waitFor(settled, 20000);
      const stale = await page.eval(`return window.__staleShell === true;`);
      check(!stale, "a script cached by the previous release is not run once the network has the new one");
      await page.send("Network.emulateNetworkConditions", NET_OFF);
      await page.goto(APP);
      await page.waitFor(settled, 25000);
      const offShell = await page.eval(`return { near: typeof window.RANear, journey: typeof window.RAJourney, stale: window.__staleShell === true };`);
      await page.send("Network.emulateNetworkConditions", NET_ON);
      check(offShell.near === "object" && offShell.journey === "object" && !offShell.stale,
        "…and with no network the scripts still come from the cache (refreshed by that load)", JSON.stringify(offShell));

    });
    // ══ 29. A plain-http address on the LAN ═════════════════════════════════
    await part("29. Served over plain http on a LAN name (no secure context)", async () => {
      const LAN = `http://roadassist.local:${new URL(BASE).port || 80}`;
      await signInAs("+917000004708", LAN);
      await standDownAll();
      const insecure = await page.eval(`return { secure: isSecureContext, uuid: typeof crypto.randomUUID };`);
      check(!insecure.secure, "the page really has no secure context (no WebCrypto, no randomUUID)", JSON.stringify(insecure));
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await recordToasts();
      await page.setValue("#v-reg", `KA01AD${RUN}`);
      await page.click("#v-add");
      await sleep(800);
      const lanQueue = await page.eval(`return { queue: localStorage.getItem("ra.app.queue") || "", toasts: window.__toasts.join(" | ") };`);
      check(lanQueue.queue.includes(`KA01AD${RUN}`), "an action taken offline is queued (crypto.randomUUID threw here)", lanQueue.toasts.slice(0, 80));
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId || /not sent/i.test(document.getElementById("sos-h").textContent)`, 20000);
      const lanSos = await page.eval(`const l = await window.__ra.listOffGrid(); const j = await window.__ra.journal();
        return { n: l.length, digest: (j.find((e) => e.type === "sos.offgrid") || {}).digest || "" };`);
      check(lanSos.n === 1 && /^[0-9a-f]{64}$/.test(lanSos.digest),
        "an off-grid SOS is stored, with its SHA-256 digest, without WebCrypto", JSON.stringify(lanSos));
      await page.eval(`const c = document.getElementById("og-close"); if (c) c.click(); return true;`);
      await offGrid(false);
      await page.waitFor(`await window.__ra.listOffGrid().then((l) => l.length && l[0].status === "SYNCED")`, 20000, "the LAN SOS to send").catch(() => {});
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);

    });
    // ══ 30. The request console ═════════════════════════════════════════════
    await part("30. Request console: queued calls are replayed, and money is never queued", async () => {
      await page.goto(`${BASE}/index.html`);
      await page.waitFor(`document.querySelector('[data-act="send-otp"]')`, 15000);
      const act = (a) => page.eval(`document.querySelector('[data-act="${a}"]').click(); return true;`);
      const logText = () => page.eval(`return [...document.querySelectorAll("#log > div")].map((d) => d.textContent).join("\\n");`);
      await page.setValue("#msisdn", "+917000004709");
      await act("send-otp");
      await page.waitFor(`document.querySelector('[data-act="verify-otp"]')`, 15000);
      await sleep(500);
      await act("verify-otp");
      await page.waitFor(`document.querySelector('[data-act="add-vehicle"]')`, 15000);
      await page.setValue("#reg", `KA01AE${RUN}`);
      await act("add-vehicle");                          // the console starts with no signal: queued
      await sleep(800);
      await page.click("#toggle-net");                   // signal: journal, then replay
      await sleep(3000);
      const replay = await logText();
      check(/replayed POST \/v1\/vehicles/.test(replay) && /← 201/.test(replay.split("replaying")[1] || ""),
        "going online replays the queued call itself, not only its journal entry", (replay.match(/.*replayed.*/) || ["(no replay)"])[0].trim());
      await page.waitFor(`document.querySelector('[data-act="go-request"]')`, 10000, "the garage with a vehicle");
      await act("go-request");
      await page.waitFor(`document.querySelector('[data-act="diagnose"]')`, 10000);
      await act("diagnose");
      await page.waitFor(`document.querySelector('[data-act="book"]')`, 10000);
      await act("book");
      await page.waitFor(`document.querySelector('[data-act="dispatch"]')`, 15000, "a booking");
      await page.click("#toggle-net");                   // no signal again
      await sleep(500);
      await act("dispatch");
      await sleep(800);
      const refused = await page.eval(`return { log: [...document.querySelectorAll("#log > div")].slice(-3).map((d) => d.textContent).join(" | "),
        queue: JSON.parse(localStorage.getItem("ra.queue") || "[]").length };`);
      check(refused.queue === 0 && /NOT QUEUED/.test(refused.log), "offline, a dispatch is refused rather than queued", refused.log.slice(0, 100));
      await page.click("#toggle-net");
      await sleep(800);
      await act("cancel");
      await sleep(800);

    });
    // ══ 31. Sheets keep keyboard focus ══════════════════════════════════════
    await part("31. A sheet holds keyboard focus until it closes", async () => {
      await signInAs("+917000004710");
      const tabWalk = async (sheet, n, shift = false) => {
        const seen = [];
        for (let i = 0; i < n; i++) {
          const k = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
          await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
          await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
          await sleep(40);
          seen.push(await page.eval(`return Boolean(document.activeElement && document.activeElement.closest("${sheet}"));`));
        }
        return seen;
      };
      await page.click("#q-report");
      await sleep(500);
      const fwd = await tabWalk("#sheet-report", 14), back = await tabWalk("#sheet-report", 6, true);
      const inert = await page.eval(`return document.querySelector(".shell").inert === true;`);
      check(fwd.every(Boolean) && back.every(Boolean), "Tab and Shift+Tab stay inside the open report sheet",
        `${fwd.filter((x) => !x).length + back.filter((x) => !x).length} escapes in 20`);
      check(inert, "…and the page behind it is inert while it is open");
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(400);
      check(await page.eval(`return document.querySelector(".shell").inert === false;`), "…and no longer inert once it closes");

    });
    // ══ 32. Words that were not true ════════════════════════════════════════
    await part("32. What the screens say is what the server does", async () => {
      await signInAs("+917000004712");
      await page.eval(`location.hash = "#more"; return true;`);
      await page.waitFor(`/contact/.test(document.getElementById("ec-count").textContent)`, 15000);
      const words = await page.eval(`
        const src = await (await fetch("/app.html", { cache: "no-store" })).text();
        const land = await (await fetch("/landing.html", { cache: "no-store" })).text();
        const metas = (h) => [...h.matchAll(/<meta[^>]+(?:name|property)="(?:og:|twitter:)?description"[^>]*>/g)].map((m) => m[0]).join(" ");
        return { hint: document.getElementById("ec-list").innerText, contactsMeta: document.querySelector("#ec-list").closest(".card").querySelector(".meta").textContent,
          frees: /frees the responder/.test(src), appMeta: metas(src), landMeta: metas(land) };`);
      check(/reaches nobody automatically/.test(words.hint) && /call 112/.test(words.hint) && !/still reaches/.test(words.hint),
        "with no contact on file the app says an SOS reaches nobody automatically — call 112", words.hint);
      check(!/on this demo server SMS is only logged/.test(words.contactsMeta) && /live SMS provider/.test(words.contactsMeta),
        "the contacts card no longer asserts SMS is only logged; it says it depends on the server");
      check(!words.frees, "the open-emergency card no longer says 'it frees the responder' (none is ever assigned)");
      check(!/falls back to SMS|reach a responder/.test(words.appMeta + words.landMeta),
        "the page descriptions claim no SMS fallback and no responder reached");
      // No fix and a refused SOS: nothing may say "SOS raised" before the server has it.
      await page.eval(`location.hash = "#home"; return true;`);
      await recordToasts();
      const notRaised = await page.eval(`
        const denied = { code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1 };
        const realGeo = navigator.geolocation.getCurrentPosition;
        navigator.geolocation.getCurrentPosition = function (ok, fail) { setTimeout(() => fail && fail(denied), 0); };
        const real = window.fetch;
        window.fetch = function (url, init) {
          if (/\\/v1\\/sos$/.test(String(url)) && init && init.method === "POST") {
            return Promise.resolve(new Response(JSON.stringify({ error: { code: "internal", title: "Server error" } }),
              { status: 500, headers: { "content-type": "application/json" } }));
          }
          return real.apply(this, arguments);
        };
        try {
          document.getElementById("sos").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          const t0 = Date.now();
          while (Date.now() - t0 < 8000 && !/not sent/i.test(document.getElementById("sos-h").textContent)) await new Promise((r) => setTimeout(r, 100));
          return { toasts: window.__toasts.join(" | "), heading: document.getElementById("sos-h").textContent };
        } finally {
          window.fetch = real; navigator.geolocation.getCurrentPosition = realGeo;
          const d = document.getElementById("sos-done"); if (d) d.click();
        }`);
      check(/not sent/i.test(notRaised.heading) && !/SOS raised/.test(notRaised.toasts),
        "an SOS the server refused is never announced as 'SOS raised'", notRaised.toasts.slice(0, 100) || "(no toast)");

    });
    // ══ 33. Language ════════════════════════════════════════════════════════
    await part("33. Hindi reaches the tabs, the pill, the banner and the SOS hint", async () => {
      await page.eval(`I18N.set("hi"); location.hash = "#home"; return true;`);
      await offGrid(true);
      await sleep(400);
      const hi = await page.eval(`return {
        pill: document.getElementById("net").textContent, want: I18N.t("net.offline"),
        tabs: [...document.querySelectorAll(".tab")].map((t) => t.textContent.trim()),
        wantTabs: ["nav.home", "nav.assist", "nav.map", "nav.activity", "nav.more"].map((k) => I18N.t(k)),
        banner: document.getElementById("offline-banner").innerText, detail: I18N.t("net.offline.detail") };`);
      check(hi.pill === hi.want, "the connection pill is in Hindi", hi.pill);
      check(hi.tabs.every((t, i) => t.startsWith(hi.wantTabs[i])), "the tab labels are in Hindi", hi.tabs.join(" · "));
      check(hi.banner.includes(hi.want) && hi.banner.includes(hi.detail.slice(0, 20)), "the off-grid banner carries the Hindi strings");
      await offGrid(false);
      const box = await page.eval(`const s = document.getElementById("sos"); s.scrollIntoView({ block: "center" });
        const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await sleep(250);
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await sleep(250);
      const hint = await page.eval(`return { now: document.getElementById("sos-sub").textContent, want: I18N.t("sos.hold") };`);
      check(hint.now === hint.want, "a short press restores the hint in Hindi, not 'hold 1.5s'", hint.now);
      await page.eval(`I18N.set("en"); return true;`);

    });
    // ══ 34. Narrow screens, leftovers, the back button ══════════════════════
    await part("34. Landing at 320 px, sign-out leftovers, back/forward cache", async () => {
      await page.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 780, deviceScaleFactor: 1, mobile: true });
      await page.goto(`${BASE}/landing.html`);
      await sleep(1200);
      const land = await page.eval(`return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        impact: Boolean(document.querySelector('a.card[href="/impact.html"]')), scan: Boolean(document.querySelector('a.card[href="/scan.html"]')) };`);
      await page.send("Emulation.clearDeviceMetricsOverride");
      check(land.over <= 0, "landing.html has no horizontal overflow at 320 px", `overflow=${land.over}px`);
      check(land.impact && land.scan, "the landing page links the Impact page and the live road scan as surface cards");

      await signInAs("+917000004711");
      const leftovers = await page.eval(`
        localStorage.setItem("ra.trip", JSON.stringify({ t: Date.now(), data: { segments: [], tiles: [] } }));
        const el = document.createElement("div"); document.body.appendChild(el);
        const fake = async (m, p) => p.indexOf("address") >= 0 ? { data: { address: { label: "THE LAST USER'S STREET" } } } : { data: { groups: {} } };
        RANear.mount({ el, api: fake, locate: async () => ({ lat: 1, lng: 1 }), online: () => true, auto: true });
        await new Promise((r) => setTimeout(r, 300));
        document.getElementById("s-out").click();
        await new Promise((r) => setTimeout(r, 300));
        const el2 = document.createElement("div"); document.body.appendChild(el2);
        RANear.mount({ el: el2, api: fake, locate: async () => ({ lat: 1, lng: 1 }), online: () => true, auto: false });
        const out = { code: document.getElementById("a-code").value, step2: !document.getElementById("a-step2").hidden,
          near: /THE LAST USER'S STREET/.test(el2.innerHTML), trip: localStorage.getItem("ra.trip") };
        el.remove(); el2.remove();
        return out;`);
      check(!leftovers.code && !leftovers.step2, "sign-out clears the one-time code and hides its step", JSON.stringify({ code: leftovers.code, step2: leftovers.step2 }));
      check(!leftovers.near && leftovers.trip === null, "…and forgets the last user's 'Near you' card and prepared trip");

      await signInAs("+917000004711");
      await page.waitFor(`window.__ra.stream().alive`, 15000, "the live stream");
      await page.eval(`window.__bf = 1; return true;`);
      await page.goto(`${BASE}/landing.html`);
      await sleep(800);
      const hist = await page.send("Page.getNavigationHistory");
      await page.send("Page.navigateToHistoryEntry", { entryId: hist.entries[hist.currentIndex - 1].id });
      await sleep(3500);
      const bf = await page.eval(`return { restored: window.__bf === 1, alive: window.__ra.stream().alive };`);
      check(bf.restored && bf.alive, "back from another page (the back/forward cache), the live stream is running again", JSON.stringify(bf));

    });
    // ══ 35. The live road scan and the Impact page ══════════════════════════
    await part("35. Live road scan from Home, and offline after one visit", async () => {
      const shell = await page.eval(`const key = (await caches.keys()).find((k) => /-shell$/.test(k)); const c = await caches.open(key);
        return { key, impact: Boolean(await c.match("/impact.html")), scan: Boolean(await c.match("/scan.html")) };`);
      check(shell.impact && shell.scan, "the Impact page and scan.html are in the offline shell", shell.key);
      await page.eval(`location.hash = "#home"; document.getElementById("q-scan").click(); return true;`);
      await page.waitFor(`location.pathname === "/scan.html" && document.readyState === "complete"`, 15000, "scan.html");
      ok("the Live road scan tile on Home opens scan.html in the same tab");
      await page.waitFor(`window.__scan && window.__scan.ready()`, 120000, "the detector to start online");
      await page.waitFor(`navigator.serviceWorker.controller`, 10000);
      await page.send("Network.emulateNetworkConditions", NET_OFF);
      await page.goto(`${BASE}/scan.html`);
      let scanOff = { ready: false };
      try {
        await page.waitFor(`window.__scan && window.__scan.ready()`, 120000, "the detector to start offline");
        scanOff = await page.eval(`
          const dets = await window.__scan.detectUrl("assets/scan/India_002049.jpg");
          return { ready: true, isolated: crossOriginIsolated, threads: window.__scan.state.ort ? window.__scan.state.ort.env.wasm.numThreads : null,
            ep: window.__scan.state.ep, dets: dets.length };`);
      } catch (e) { scanOff.error = e.message; }
      await page.send("Network.emulateNetworkConditions", NET_ON);
      check(scanOff.ready && scanOff.dets >= 0, "with no network, scan.html opens from the cache with its model loaded and detects", JSON.stringify(scanOff));
      check(scanOff.isolated === true, "…still cross-origin isolated (the cached responses kept COOP/COEP), so ORT may use threads",
        `threads=${scanOff.threads}`);

    });
    // ══ 36. A server that could not answer is not a refusal ════════════════
    // refreshSession() read every failed refresh the server answered as "the
    // session is over": a 503 from /v1/auth/refresh (the database restarting)
    // on a reopen wiped the stored session and landed on sign-in.
    await part("36. A refresh the server could not answer (503) does not sign the person out", async () => {
      await signInAs("+917000004713");
      await page.eval(`
        const s = JSON.parse(sessionStorage.getItem("ra.app.session"));
        s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";   // an expired access token
        sessionStorage.setItem("ra.app.session", JSON.stringify(s));
        return true;`);
      const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
        (function () {
          var real = window.fetch;
          window.fetch = function (input) {
            var url = typeof input === "string" ? input : input && input.url;
            if (/\\/v1\\/auth\\/refresh/.test(String(url))) {
              return Promise.resolve(new Response(JSON.stringify({ error: { code: "internal", title: "database restarting" } }),
                { status: 503, headers: { "content-type": "application/json" } }));
            }
            return real.apply(this, arguments);
          };
        })();` });
      let hiccup;
      try {
        await page.goto(APP);
        await page.waitFor(settled, 25000, "the app to settle");
        await sleep(600);
        hiccup = await page.eval(`return { screen: document.querySelector(".screen.active").id,
          tabs: !document.getElementById("tabs").hidden, kept: Boolean(localStorage.getItem("ra.app.session")) };`);
      } finally {
        await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      }
      check(hiccup.screen !== "scr-auth" && hiccup.tabs && hiccup.kept,
        "a 503 from the refresh on reopen keeps the session and the app, not sign-in", JSON.stringify(hiccup));
      await page.goto(APP);
      await page.waitFor(`document.getElementById("scr-home").classList.contains("active") && !document.getElementById("tabs").hidden`, 25000, "home");
      const healed = await page.eval(`return ${TOK}.split(".")[1].length > 20;`);
      check(healed, "…and once the server answers again, the same session refreshes and carries on");

    });
    // ══ 37. A wrong model in the scan cache heals itself ═══════════════════
    // The service worker serves the detector cache-first, for good. When the
    // stored .onnx was not the one its sidecar names (a half-deployed or older
    // file cached under the current name), scan.html refused it and said
    // "reload the page" - and every reload got the same bad copy from the cache.
    await part("37. A model in the scan cache that fails its sha256 is fetched again, not refused for good", async () => {
      await page.goto(`${BASE}/scan.html`);
      await page.waitFor(`window.__scan && window.__scan.ready()`, 120000, "the detector to start");
      await page.waitFor(`navigator.serviceWorker.controller`, 10000);
      const poisoned = await page.eval(`
        const key = (await caches.keys()).find((k) => /^ra-scan-/.test(k));
        const c = await caches.open(key);
        const path = "/assets/models/raksha-yolo11n-india-ft-gpu-416.onnx";
        if (!(await c.match(path))) return null;
        await c.put(path, new Response(new Uint8Array(1024), { headers: { "content-type": "application/octet-stream" } }));
        return key;`);
      check(Boolean(poisoned), "the 416 px model was in the scan cache, and is replaced with a wrong file", String(poisoned));
      await page.goto(`${BASE}/scan.html?ep=wasm`);
      let healed = false, why = "";
      try { await page.waitFor(`window.__scan && window.__scan.ready()`, 120000, "the detector to start"); healed = true; }
      catch { why = await page.text("#status"); }
      check(healed, "the page fetches the model again past the cache and starts, instead of failing on every reload", why.slice(0, 120));
      const fixedCopy = await page.eval(`
        const c = await caches.open(${JSON.stringify(poisoned)});
        const r = await c.match("/assets/models/raksha-yolo11n-india-ft-gpu-416.onnx");
        return r ? (await r.arrayBuffer()).byteLength : 0;`);
      check(fixedCopy > 1024 * 1024, "…and the cache now holds the real file", `${fixedCopy} bytes`);

    });
    // ══ 38. The consoles: a server that could not answer is not a refusal ═══
    // Part 36's rule, for mechanic.html and raksha.html: their refreshSession()
    // still read a 5xx or a 429 from /v1/auth/refresh as "the session is over",
    // so a database restart signed a mechanic out mid-job. Only a 4xx other
    // than 408/429 is a refusal.
    await part("38. Mechanic and RAKSHA consoles: a 503 or 429 refresh keeps the session; a 401 still ends it", async () => {
      const consoles = [
        { name: "mechanic", url: `${BASE}/mechanic.html`, key: "ra.mechanic.session",
          signedIn: `!document.getElementById("scr-work").hidden`,
          settled: `document.readyState === "complete" && document.getElementById("m-restoring").hidden === true`,
          signIn: async () => {
            await page.waitFor(`document.getElementById("m-signin")`);
            if (await page.eval(`return document.getElementById("scr-work").hidden;`)) {
              await page.setValue("#m-msisdn", "+919600000440");
              await page.click("#m-signin");
            }
            await page.waitFor(`!document.getElementById("scr-work").hidden && !/Loading/.test(document.getElementById("m-name").textContent)`, 45000, "the mechanic console");
          },
          working: `!/Loading/.test(document.getElementById("m-name").textContent)` },
        { name: "RAKSHA", url: `${BASE}/raksha.html`, key: "ra.raksha.session",
          signedIn: `document.getElementById("login-panel").hidden === true`,
          settled: `document.readyState === "complete" && !/Restoring/.test(document.getElementById("status").textContent)`,
          signIn: async () => {
            await page.waitFor(`document.getElementById("login-btn")`);
            await sleep(1500);
            if (await page.eval(`return document.getElementById("login-panel").hidden === false;`)) {
              await page.setValue("#msisdn", "+919999900001");
              await page.click("#login-btn");
            }
            await page.waitFor(`document.getElementById("login-panel").hidden === true && /gov_officer|admin/.test(document.getElementById("who").textContent)`, 30000, "the RAKSHA console");
          },
          working: `/gov_officer|admin/.test(document.getElementById("who").textContent)` },
      ];
      const stub = (status) => `
        (function () {
          var real = window.fetch;
          window.fetch = function (input) {
            var url = typeof input === "string" ? input : input && input.url;
            if (/\\/v1\\/auth\\/refresh/.test(String(url))) {
              return Promise.resolve(new Response(JSON.stringify({ error: { code: "x", title: "refresh " + ${status} } }),
                { status: ${status}, headers: { "content-type": "application/json" } }));
            }
            return real.apply(this, arguments);
          };
        })();`;
      const expire = (key) => page.eval(`
        const s = JSON.parse(sessionStorage.getItem(${JSON.stringify(key)}));
        s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";
        sessionStorage.setItem(${JSON.stringify(key)}, JSON.stringify(s));
        return true;`);
      const reopen = async (c, status) => {
        const { identifier } = status ? await page.send("Page.addScriptToEvaluateOnNewDocument", { source: stub(status) }) : {};
        try {
          await page.goto(c.url);
          await page.waitFor(c.settled, 30000, `${c.name} to settle`);
          await sleep(1500);
          return await page.eval(`return { in: ${c.signedIn}, kept: Boolean(localStorage.getItem(${JSON.stringify(c.key)})) };`);
        } finally {
          if (identifier) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
        }
      };
      for (const c of consoles) {
        await page.goto(c.url);
        await c.signIn();
        for (const status of [503, 429]) {
          await expire(c.key);
          const got = await reopen(c, status);
          check(got.in && got.kept, `${c.name}: a ${status} from the refresh on reopen keeps the session and the console`, JSON.stringify(got));
        }
        await reopen(c, 0);
        await page.waitFor(c.working, 30000, `${c.name} to work again`);
        const healed = await page.eval(`return JSON.parse(sessionStorage.getItem(${JSON.stringify(c.key)})).token.split(".")[1].length > 20;`);
        check(healed, `…${c.name}: once the server answers again, the same session refreshes and carries on`);
        await expire(c.key);
        const refused = await reopen(c, 401);
        check(!refused.in && !refused.kept, `…${c.name}: a 401 refusal from the refresh still signs out`, JSON.stringify(refused));
      }
    });
    // ══ 39. A false alarm pressed during a failed sync survives a reload ═══
    // "Cancel — false alarm" pressed mid-upload was kept only in memory, and
    // only a "created" answer applied it. When the upload reached the server
    // but its reply was lost, the sync failed, a reload forgot the cancel, and
    // the retry came back "duplicate" - so the withdrawn SOS stayed open.
    await part("39. Off-grid cancel during a failing sync is kept across a reload and applied to a duplicate", async () => {
      await signInAs("+917000004714");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      await recordToasts();
      await page.eval(`
        window.__held = false;
        const real = window.__realFetch = window.fetch;
        let release; window.__release = () => release();
        const hold = new Promise((r) => { release = r; });
        window.fetch = async function (url) {
          if (/offline-sync$/.test(String(url))) {
            window.__held = true; await hold;
            await real.apply(this, arguments);              // the server records it...
            throw new TypeError("Failed to fetch");         // ...and the reply is lost
          }
          return real.apply(this, arguments);
        };
        document.getElementById("net").click();     // signal returns: the upload starts, and is held
        return true;`);
      await page.waitFor(`window.__held`, 15000, "the upload to be in flight");
      await page.eval(`document.getElementById("sos-abort").click(); return true;`);
      await sleep(500);
      await page.eval(`window.__release(); return true;`);
      await page.waitFor(`(await window.__ra.listOffGrid())[0]?.status === "SYNC_RETRY_PENDING"`, 15000, "the sync to fail");
      const kept = await page.eval(`const l = await window.__ra.listOffGrid(); window.fetch = window.__realFetch;
        return { status: l[0].status, cancel: l[0].cancelRequested === true, toast: window.__toasts.join(" | ").slice(0, 160) };`);
      check(kept.cancel, "the cancel pressed during the failing upload is stored on the incident, not held in memory", JSON.stringify(kept));
      const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
        (function () {
          var real = window.fetch; window.__calls = [];
          window.fetch = function (input) {
            var u = String(typeof input === "string" ? input : input && input.url);
            var p = real.apply(this, arguments);
            if (/\\/v1\\/sos\\//.test(u)) {
              var c = { call: u.replace(/^.*\\/v1\\/sos\\//, "") }; window.__calls.push(c);
              p.then(function (r) { return r.clone().json(); }).then(function (j) { c.status = j && j.data && j.data.status; }, function () {});
            }
            return p;
          };
        })();` });
      let after;
      try {
        await page.goto(APP);
        await page.waitFor(settled, 25000, "the app to settle");
        await page.waitFor(`window.__ra && window.__ra.offGrid().storeLoaded`, 15000, "off-grid modules");
        await page.waitFor(`(await window.__ra.listOffGrid())[0]?.status === "SYNCED" && window.__calls.some((c) => /cancel$/.test(c.call) && c.status)`,
          40000, "the next sync to send it and cancel it");
        after = await page.eval(`
          const l = await window.__ra.listOffGrid();
          const open = (await (await fetch("/v1/me/incidents", { headers: { authorization: "Bearer " + ${TOK} } })).json()).data || [];
          return { calls: window.__calls, open: open.length, cancelLeft: l[0].cancelRequested === true };`);
      } finally {
        await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      }
      check(after.calls.some((c) => /offline-sync$/.test(c.call)) && after.calls.some((c) => /cancel$/.test(c.call) && c.status === "CANCELLED")
        && !after.calls.some((c) => /confirm$/.test(c.call)) && after.open === 0 && !after.cancelLeft,
        "after a reload the next sync - answered 'duplicate' - cancels it on the server (CANCELLED), and nothing is confirmed", JSON.stringify(after));
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
    });
    // ══ 40. A lost reply still gets the SOS escalated ═══════════════════════
    // Only a "created" answer was confirmed. When the upload reached the server
    // but its reply was lost, the retry came back "duplicate" and nobody was
    // ever alerted, while the screen said "synchronized".
    await part("40. Off-grid SOS whose upload reply was lost is escalated once on the duplicate", async () => {
      await signInAs("+917000004715");
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
      await offGrid(true);
      await pressSos();
      await page.waitFor(`window.__ra.offGrid().incidentId`, 15000, "an off-grid incident");
      await page.eval(`
        const real = window.__realFetch = window.fetch;
        window.fetch = async function (url) {
          if (/offline-sync$/.test(String(url))) {
            await real.apply(this, arguments);              // the server records it...
            throw new TypeError("Failed to fetch");         // ...and the reply is lost
          }
          return real.apply(this, arguments);
        };
        document.getElementById("net").click();
        return true;`);
      await page.waitFor(`(await window.__ra.listOffGrid())[0]?.status === "SYNC_RETRY_PENDING"`, 20000, "the sync to fail");
      await page.eval(`window.fetch = window.__realFetch; return true;`);
      const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
        (function () {
          var real = window.fetch; window.__calls = [];
          window.fetch = function (input) {
            var u = String(typeof input === "string" ? input : input && input.url);
            var p = real.apply(this, arguments);
            if (/\\/v1\\/sos\\//.test(u)) {
              var c = { call: u.replace(/^.*\\/v1\\/sos\\//, "") }; window.__calls.push(c);
              p.then(function (r) { return r.clone().json(); }).then(function (j) {
                c.status = j && j.data && (j.data.status || (j.data.results && j.data.results[0] && j.data.results[0].status)); }, function () {});
            }
            return p;
          };
        })();` });
      let after;
      try {
        await page.goto(APP);
        await page.waitFor(settled, 25000, "the app to settle");
        await page.waitFor(`window.__ra && window.__ra.offGrid().storeLoaded`, 15000, "off-grid modules");
        await page.waitFor(`(await window.__ra.listOffGrid())[0]?.status === "SYNCED" && window.__calls.some((c) => /confirm$/.test(c.call) && c.status)`,
          40000, "the next sync to send and escalate it");
        await sleep(1500);
        after = await page.eval(`
          const l = await window.__ra.listOffGrid();
          const open = (await (await fetch("/v1/me/incidents", { headers: { authorization: "Bearer " + ${TOK} } })).json()).data || [];
          return { calls: window.__calls, serverId: l[0].serverId, open: open.map((i) => ({ id: i.id, status: i.status })),
            toast: document.getElementById("toast").textContent.slice(0, 120) };`);
      } finally {
        await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      }
      const confirms = after.calls.filter((c) => /confirm$/.test(c.call));
      check(after.calls.some((c) => /offline-sync$/.test(c.call) && c.status === "duplicate") && confirms.length === 1
        && /^(CONFIRMED|RESPONDING)$/.test(confirms[0].status || ""),
        "the replay is answered 'duplicate' and the SOS is confirmed exactly once", JSON.stringify(after.calls));
      check(after.open.length === 1 && after.open[0].id === after.serverId && /^(CONFIRMED|RESPONDING)$/.test(after.open[0].status),
        "…the server holds one incident, escalated, and no duplicate was created", JSON.stringify(after.open));
      check(!/alerting failed/i.test(after.toast), "…and the screen does not report an alerting failure", after.toast);
      await standDownAll();
      await page.eval(`await window.__ra.clearOffGrid(); return true;`);
    });

  } catch (e) {
    bad("journey aborted", e.message);
    console.error(e.stack?.split("\n").slice(0, 4).join("\n"));
  } finally {
    cleanup();
  }

  console.log("\n" + "\u2500".repeat(58));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("\u2500".repeat(58));
  process.exit(fail ? 1 : 0);
};

run();
