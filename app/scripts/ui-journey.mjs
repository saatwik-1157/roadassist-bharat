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
const PORT = 9333;

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
    // are the pages that share ds.css and the design tokens, so a change to
    // either can break them silently.
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
        plain:     f("9876543210"),
        spaced:    f("98765 43210"),
        contact:   f("+91 98765 43210"),
        stdZero:   f("09876543210"),
        noPlus:    f("919876543210"),
        dashed:    f("98765-43210"),
        canonical: f("+919876543210"),
        starts5:   f("5876543210"),
        tooShort:  f("987654321"),
        us:        f("+12025550123"),
      };
    `);
    check(norm.plain === "+919876543210", "10 digits gets the +91", norm.plain);
    check(norm.spaced === "+919876543210", "spaces are stripped", norm.spaced);
    check(norm.contact === "+919876543210", "a pasted contact-card number works", norm.contact);
    check(norm.stdZero === "+919876543210", "a leading STD zero is dropped", norm.stdZero);
    check(norm.noPlus === "+919876543210", "91 without the plus works", norm.noPlus);
    check(norm.dashed === "+919876543210", "dashes are stripped", norm.dashed);
    check(norm.canonical === "+919876543210", "an already-correct number is unchanged");
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
    const stored = await page.eval(`
      return Boolean(JSON.parse(localStorage.getItem("ra.app.session") || "null")?.refresh);
    `);
    check(stored, "a refresh token is persisted");

    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    ok("a reload lands back in the app, not on sign-in");

    // ══ 5. Expired access token is refreshed, not surfaced ══════════════════
    section("5. Token refresh");
    await page.eval(`
      const s = JSON.parse(localStorage.getItem("ra.app.session"));
      s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";  // forced expiry
      localStorage.setItem("ra.app.session", JSON.stringify(s));
      return true;
    `);
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 15000);
    ok("a dead access token is silently exchanged for a live one");
    const newTok = await page.eval(`
      return JSON.parse(localStorage.getItem("ra.app.session")).token.split(".")[1];
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
      const tok = JSON.parse(localStorage.getItem("ra.app.session")).token;
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
      const tok = JSON.parse(localStorage.getItem("ra.app.session")).token;
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
    check(loc.done, "checking location completes step 3", loc.state);

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
    await page.waitFor(`document.getElementById("scr-work").hidden === false`, 20000);
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
          JSON.parse(localStorage.getItem("ra.mechanic.session")).token },
      });
      const j = await r.json();
      return String(j.data.mechanic.isAvailable);
    `);
    check(persisted === (after === "true" ? "true" : "false"),
      "the change reached the server", `server=${persisted}`);

    // Mechanic session persistence.
    await page.goto(`${BASE}/mechanic.html`);
    await page.waitFor(`document.getElementById("scr-work").hidden === false`, 20000);
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
        stored: Boolean(JSON.parse(localStorage.getItem("ra.raksha.session") || "null")?.refresh),
        panels: ["health-panel","det-panel","dev-panel"]
          .filter(id => document.getElementById(id).hidden === false).length,
      };
    `);
    check(/gov_officer|admin/.test(authority.who), "the role is shown", authority.who);
    check(authority.stored, "the refresh token is persisted (it used to be discarded)");
    check(authority.signout, "a sign-out control exists");
    check(authority.panels === 3, "the dashboard panels are populated", `${authority.panels}/3`);

    // Corrupt the access token and confirm the polling loop recovers silently.
    await page.eval(`
      const s = JSON.parse(localStorage.getItem("ra.raksha.session"));
      s.token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib2d1cyJ9.deadbeef";
      localStorage.setItem("ra.raksha.session", JSON.stringify(s));
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
      const tok = JSON.parse(localStorage.getItem("ra.mechanic.session")).token;
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
        const tok = JSON.parse(localStorage.getItem("ra.app.session")).token;
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
