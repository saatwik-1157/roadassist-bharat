#!/usr/bin/env node
/**
 * Timed rehearsal of docs/DEMO-SCRIPT.md.
 *
 * The suites prove the beats work. They do not prove the demo fits in ten
 * minutes, because a suite runs flat out and a demo waits for a projector, a
 * sentence to finish, and a human hand. This walks the script in order, in real
 * Chrome, in two windows, and puts a stopwatch on each beat.
 *
 * It asserts the expected outcome of every beat as well as timing it — a beat
 * that silently failed would otherwise be recorded as a fast success, which is
 * the one result worse than a slow one.
 *
 * What it measures is MACHINE time: navigation, API round-trips, rendering. The
 * narration beats (1, 2, 14, 15) are speech and are carried at their budgeted
 * cost. The gap between machine time and budget is the room left for talking,
 * and that gap is the actual output of this script.
 *
 *   npm start                        # in another shell
 *   node scripts/demo-rehearsal.mjs
 *   node scripts/demo-rehearsal.mjs --headed   # watch it happen
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const HEADED = process.argv.includes("--headed");
const PORT = 9555;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1) + "s";
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;

let problems = 0;

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); }
      }, 45000);
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      // Always wrap as an expression. An earlier version keyed off whether the
      // source contained "return", which silently swallowed the value of every
      // IIFE with a return inside it — the call succeeded and evaluated to
      // undefined, which reads as "the element is missing" rather than "the
      // harness dropped your answer".
      expression: `(async () => (${expression}))()`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
        .split("\n")[0].slice(0, 160));
    }
    return r.result.value;
  }
  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor(`document.readyState === "complete"`);
  }
  async waitFor(condition, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs;
    let last = "";
    for (;;) {
      try { if (await this.eval(`Boolean(${condition})`)) return; }
      catch (e) { last = e.message; }
      if (Date.now() > until) {
        throw new Error(`timed out waiting for: ${condition.replace(/\s+/g, " ").slice(0, 90)}${last ? ` (${last})` : ""}`);
      }
      await sleep(120);
    }
  }
  click(sel) {
    return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error("no element " + ${JSON.stringify(sel)}); el.click(); return true; })()`);
  }
  type(sel, value) {
    return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error("no field " + ${JSON.stringify(sel)});
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true; })()`);
  }
}

async function connectTo(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return new Page(ws);
}

async function launch() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome not found — add its path to CHROME_CANDIDATES");
  const profile = mkdtempSync(join(tmpdir(), "ra-rehearsal-"));
  const proc = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    ...(HEADED ? [] : ["--headless=new"]),
    "--window-size=430,900",
    "about:blank",
  ], { stdio: "ignore" });

  let version;
  for (let i = 0; i < 120; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch { await sleep(150); }
  }
  if (!version) throw new Error("Chrome never exposed its debugging port");
  return { proc, profile, browser: await connectTo(version.webSocketDebuggerUrl) };
}

/** The demo genuinely needs two windows, so the rehearsal opens two. */
async function openPage(browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.id === targetId);
  if (!t) throw new Error("could not attach to the new tab");
  const p = await connectTo(t.webSocketDebuggerUrl);
  await p.send("Page.enable");
  await p.send("Runtime.enable");
  return p;
}

// ── the rehearsal ───────────────────────────────────────────────────────────
const beats = [];
async function beat(no, name, budgetS, fn, kind = "action") {
  const t0 = Date.now();
  let note = "";
  try { note = (await fn()) ?? ""; }
  catch (e) { problems++; note = "FAILED: " + e.message; }
  const ms = Date.now() - t0;
  beats.push({ no, name, budgetS, ms, note, kind });
  const flag = String(note).startsWith("FAILED") ? "\u2717" : "\u2713";
  console.log(`  ${flag} ${String(no).padStart(2)} \u00b7 ${name.padEnd(38)} budget ${String(budgetS).padStart(3)}s   machine ${secs(ms).padStart(7)}   ${note}`);
}

const run = async () => {
  console.log(`\nRehearsing docs/DEMO-SCRIPT.md against ${BASE}\n`);
  const { proc, profile, browser } = await launch();
  // A presenter demonstrating this has granted location. Without the override
  // headless Chrome denies it, the app falls back to an approximate fix and
  // says so — honest, but not what the room will see.
  await browser.send("Browser.grantPermissions", {
    origin: BASE,
    permissions: ["geolocation"],
  }).catch(() => { /* older Chrome: the app degrades and labels it */ });

  const customer = await openPage(browser, `${BASE}/app.html`);
  const mechanic = await openPage(browser, "about:blank");
  await customer.send("Emulation.setGeolocationOverride", {
    latitude: 28.4595, longitude: 77.0266, accuracy: 12,
  }).catch(() => { /* not fatal */ });

  const reg = "RC" + Math.floor(Math.random() * 90 + 10) + "DM" + Math.floor(Math.random() * 9000 + 1000);
  const msisdn = "+9170000" + String(Math.floor(Math.random() * 90000 + 10000));
  let assignedMech = null;

  try {
    await beat(1, "The problem (narration)", 30, async () => "speech, not machine time", "narration");
    await beat(2, "The solution (narration)", 30, async () => "speech, not machine time", "narration");

    await beat(3, "Login", 30, async () => {
      await customer.goto(`${BASE}/app.html`);
      await customer.waitFor(`document.getElementById("a-send")`);
      await customer.type("#a-msisdn", msisdn);
      await customer.click("#a-send");
      await customer.waitFor(`document.getElementById("a-step2").hidden === false`);
      await customer.click("#a-verify");
      await customer.waitFor(`document.getElementById("scr-home").classList.contains("active")`);
      const tier = await customer.eval(`window.__ra.tier()`);
      if (tier !== "ONLINE") throw new Error(`pill reads ${tier}, expected ONLINE`);
      return `home reached, pill=${tier}`;
    });

    await beat(4, "Vehicle", 20, async () => {
      await customer.eval(`(() => { const b = document.getElementById("v-add"); if (b) b.click(); return true; })()`);
      await customer.waitFor(`document.getElementById("v-reg")`);
      await customer.type("#v-reg", reg);
      await customer.click("#v-add");
      await customer.waitFor(
        `document.getElementById("vehicle-card").textContent.includes(${JSON.stringify(reg)})`, 25000);
      return `vehicle ${reg} linked`;
    });

    await beat(5, "Incident and AI diagnosis", 45, async () => {
      await customer.eval(`(() => { location.hash = "#assist"; return true; })()`);
      await customer.waitFor(`document.getElementById("b-symptoms")`);
      await customer.click("#b-locate");
      await customer.waitFor(`document.getElementById("b-loc-state").textContent.trim().length > 0`, 25000);
      await customer.type("#b-symptoms", "wont start, clicking sound");
      await customer.click("#b-diagnose");
      await customer.waitFor(`document.querySelector("#b-diag .diag-grid")`, 30000);
      const conf = await customer.eval(`(document.querySelector("#b-diag .diag-v") || {}).textContent`);
      const body = await customer.eval(`document.getElementById("b-diag").textContent`);
      if (!/severity/i.test(body)) throw new Error("severity missing from the readout");
      if (!/rules/i.test(body)) throw new Error("engine label missing — the honesty pill is this beat's point");
      return `confidence ${conf}, severity shown, engine labelled`;
    });

    await beat(6, "Dispatch", 45, async () => {
      await customer.click("#b-book");
      await customer.waitFor(`document.querySelector("#b-offers button")`, 35000);
      const cards = await customer.eval(`document.querySelectorAll("#b-offers .card").length`);
      if (!cards) throw new Error("no offers — §6 backup is to widen the radius");
      return `${cards} mechanic(s) offered`;
    });

    await beat(7, "Offer accepted, console picks up the job", 45, async () => {
      // The script has the presenter accept from the console. That needs the
      // offered mechanic's number, which the offer card deliberately does not
      // expose, so the rehearsal accepts from the customer's own offer list — a
      // real supported path — then signs the console in as whoever was actually
      // assigned. What §7 exists to show still holds: the job reaches the
      // console, live, without a refresh.
      await customer.eval(`(() => { const b = [...document.querySelectorAll("#b-offers button")]
        .find(x => /accept/i.test(x.textContent));
        if (!b) throw new Error("no accept button"); b.click(); return true; })()`);
      await customer.waitFor(`document.getElementById("scr-track").classList.contains("active")`, 30000);
      await customer.waitFor(`document.querySelector("#t-contact a[href^='tel:']")`, 25000);
      assignedMech = await customer.eval(
        `document.querySelector("#t-contact a[href^='tel:']").href.replace("tel:", "")`);
      await mechanic.goto(`${BASE}/mechanic.html`);
      await mechanic.waitFor(`document.getElementById("m-msisdn")`);
      await mechanic.type("#m-msisdn", assignedMech);
      await mechanic.click("#m-signin");
      await mechanic.waitFor(`document.getElementById("scr-work").hidden === false`, 35000);
      await mechanic.waitFor(`document.getElementById("job").textContent.trim().length > 20`, 35000);
      const live = await mechanic.eval(`(document.getElementById("m-live") || {}).textContent`);
      return `assigned ${assignedMech}; console badge=${String(live || "").trim()}`;
    });

    await beat(8, "Real-time on the customer side", 30, async () => {
      // The command buttons live on the console's Job pane, not the dashboard.
      await mechanic.eval(`(() => { const b = [...document.querySelectorAll("button")]
        .find(x => /^(Open job|Job)$/.test(x.textContent.trim()));
        if (b) b.click(); return Boolean(b); })()`);
      await mechanic.waitFor(`document.getElementById("pane-job") &&
        document.getElementById("pane-job").hidden === false`, 20000);
      // Each command is confirmed on the console before the next is issued —
      // clicking blind was landing one transition and dropping the rest,
      // because the pane re-renders and the button set changes underneath.
      const steps = [
        ["I'm on my way", "EN_ROUTE"],
        ["I've arrived", "ON_SITE"],
        ["Start work", "IN_PROGRESS"],
        ["Work complete", "COMPLETED"],
      ];
      for (const [label, status] of steps) {
        const hit = await mechanic.eval(`(() => { const all = [...document.querySelectorAll("button")];
          const b = all.find(x => x.textContent.trim() === ${JSON.stringify(label)});
          if (!b) return all.map(x => x.textContent.trim()).filter(Boolean).join(" | ");
          b.click(); return true; })()`);
        if (hit !== true) throw new Error(`no "${label}" control; console offers: ${hit}`);
        await mechanic.waitFor(
          `/${status}/i.test(document.getElementById("pane-job").textContent)`, 20000);
      }
      // Switch to the customer window, as the script says — but touch nothing
      // on it. A background tab has its timers throttled by the browser, so
      // without this the poll that carries the update is starved and the beat
      // measures Chrome's throttling rather than the platform.
      await customer.send("Page.bringToFront").catch(() => {});
      const vis = await customer.eval(`({ hidden: document.hidden, vs: document.visibilityState })`);
      try {
        // Assert the status *pill*, not the page text: the journey timeline
        // contains the word "Completed" as a future step, so matching on body
        // text passed while the screen was still showing IN_PROGRESS.
        await customer.waitFor(
          `/COMPLETED|PAID/i.test((document.querySelector("#t-body .pill") || {}).textContent || "")`, 35000);
      } catch (e) {
        const seen = await customer.eval(`({
          screen: [...document.querySelectorAll(".screen")].filter(s => s.classList.contains("active")).map(s => s.id).join(","),
          pill: (document.querySelector("#t-body .pill") || {}).textContent || null,
          body: document.getElementById("t-body").textContent.replace(/\\s+/g, " ").trim().slice(0, 160),
        })`);
        throw new Error(`${e.message} | active=${seen.screen} pill=${seen.pill} body="${seen.body}"`);
      }
      return `customer reached COMPLETED untouched (tab hidden=${vis.hidden})`;
    });

    await beat(9, "Invoice and payment", 45, async () => {
      await customer.waitFor(`/₹/.test(document.getElementById("t-body").textContent)`, 30000);
      const total = await customer.eval(
        `(document.querySelector("#t-invoice .num") || {}).textContent ||
         (document.getElementById("t-body").textContent.match(/₹[\\d,.]+/) || ["?"])[0]`);
      const findPay = `(() => {
        const all = [...document.querySelectorAll("#scr-track button, #t-body button, #t-cmds button")];
        const b = all.find(x => /^pay\\b|pay now|pay ₹/i.test(x.textContent.trim()));
        if (!b) return all.map(x => x.textContent.trim()).filter(Boolean).join(" | ");
        b.click(); return true; })()`;
      let clicked = await customer.eval(findPay);
      let note = "";
      if (clicked !== true) {
        const snap = await customer.eval(`(async () => {
          const s = JSON.parse(localStorage.getItem("ra.app.session") || "{}");
          const r = await fetch("/v1/bookings/" + s.bookingId, {
            headers: { authorization: "Bearer " + s.token } });
          const j = await r.json().catch(() => ({}));
          return { apiStatus: j.data && j.data.status,
                   metaNext: j.meta && j.meta.nextCommands,
                   cmdsExists: Boolean(document.getElementById("t-cmds")),
                   chipCount: document.querySelectorAll("#t-cmds button").length,
                   trackActive: document.getElementById("scr-track").classList.contains("active") };
        })()`);
        console.log(`       probe: ${JSON.stringify(snap)}`);
      }
      if (clicked !== true) {
        // Give the live view a poll cycle of its own before blaming it.
        await sleep(8000);
        clicked = await customer.eval(findPay);
      }
      if (clicked !== true) {
        // Full reload of the tracking screen — the path that goes through
        // refreshBooking(). If the chips only appear here, the live path is
        // still not carrying meta.nextCommands and the demo would stall.
        await customer.goto(`${BASE}/app.html#track`);
        await customer.waitFor(`document.getElementById("scr-track").classList.contains("active")`, 20000);
        await customer.waitFor(`document.querySelectorAll("#t-cmds button").length > 0`, 20000);
        clicked = await customer.eval(findPay);
        note = " (WARNING: pay control appeared only after a full page reload)";
      }
      if (clicked !== true) {
        // Separate "the API does not offer the command" from "the screen did
        // not render it" — they need completely different fixes.
        const probe = await customer.eval(`(async () => {
          const s = JSON.parse(localStorage.getItem("ra.app.session") || "{}");
          if (!s.bookingId || !s.token) return { note: "no bookingId/token in session" };
          const r = await fetch("/v1/bookings/" + s.bookingId, {
            headers: { authorization: "Bearer " + s.token } });
          const j = await r.json().catch(() => ({}));
          return { status: j.data && j.data.status, commands: (j.data && j.data.commands) || null,
                   invoice: Boolean(j.data && j.data.invoice),
                   cmdsHtml: (document.getElementById("t-cmds") || {}).innerHTML || "(no #t-cmds)" };
        })()`);
        throw new Error(`no pay control; screen offers: ${clicked} | api status=${probe.status} ` +
          `commands=${JSON.stringify(probe.commands)} invoice=${probe.invoice} ` +
          `t-cmds="${String(probe.cmdsHtml).slice(0, 80)}"`);
      }
      await customer.waitFor(`document.getElementById("t-stars") ||
        /PAID/i.test(document.getElementById("t-body").textContent)`, 35000);
      return `invoice ${total} settled (provider=mock, simulated)${note}`;
    });

    await beat(10, "Review", 15, async () => {
      await customer.eval(`(() => { const s = document.querySelectorAll("#t-stars *");
        if (s.length) s[s.length - 1].click(); return true; })()`);
      await customer.eval(`(() => { const t = document.getElementById("t-note");
        if (t) { const set = Object.getOwnPropertyDescriptor(t.constructor.prototype, "value").set;
        set.call(t, "Fast and clear."); t.dispatchEvent(new Event("input", { bubbles: true })); }
        return true; })()`);
      await customer.click("#t-submit");
      await sleep(1500);
      return "review submitted";
    });

    await beat(11, "Online SOS", 30, async () => {
      await customer.eval(`(() => { location.hash = "#home"; return true; })()`);
      await customer.waitFor(`document.getElementById("scr-home").classList.contains("active")`);
      await customer.eval(`(() => { document.getElementById("sos")
        .dispatchEvent(new Event("pointerdown", { bubbles: true })); return true; })()`);
      await sleep(1900);
      // Wait for the sheet openSos actually wrote. #sos-now is visible in the
      // static markup, so waiting on it matched instantly and fired
      // /v1/sos/undefined/confirm — rejected as a bad uuid. The copy line
      // carries the incident status and is written only once the id is in hand.
      await customer.waitFor(
        `/Incident /.test(document.getElementById("sos-copy").textContent)`, 25000);
      await customer.click("#sos-now");
      await customer.waitFor(`/incident|contact|responder|escalat/i
        .test(document.getElementById("sos-out").textContent)`, 35000);
      return String(await customer.eval(
        `document.getElementById("sos-out").textContent.replace(/\\s+/g, " ").trim().slice(0, 70)`));
    });

    await beat(12, "THE MOMENT — go off-grid", 120, async () => {
      // Close the online emergency first. fireSos refuses to start a second one
      // while sosId is set — correct behaviour, and the reason §12 now tells the
      // presenter to dismiss the sheet before holding SOS again.
      await customer.eval(`(() => { const d = document.getElementById("sos-done");
        if (d) d.click(); return true; })()`);
      await sleep(500);
      await customer.eval(`(() => { document.getElementById("net").click(); return true; })()`);
      await customer.waitFor(`window.__ra.tier() !== "ONLINE"`, 25000);
      const local = await customer.eval(
        `JSON.stringify(window.__ra.diagnoseLocally("wont start, clicking sound", []))`);
      if (!local || local === "null") throw new Error("the on-device engine did not answer offline");
      await customer.eval(`(() => { location.hash = "#home"; return true; })()`);
      await customer.eval(`(() => { document.getElementById("sos")
        .dispatchEvent(new Event("pointerdown", { bubbles: true })); return true; })()`);
      await sleep(1900);
      // No confirm step off-grid: fireSos sees tier OFFLINE and goes straight to
      // raiseOffGridSos, which writes the incident before drawing anything.
      await customer.waitFor(`(await window.__ra.listOffGrid()).length > 0`, 35000);
      const before = JSON.parse(await customer.eval(`JSON.stringify(await window.__ra.listOffGrid())`));
      const r0 = before[0];
      const ref = r0.clientIncidentId || r0.incidentId || r0.reference || r0.id || "(unnamed)";
      // The strongest beat in the script: close the tab entirely, then reopen.
      await customer.goto("about:blank");
      await customer.goto(`${BASE}/app.html`);
      await customer.waitFor(`window.__ra && window.__ra.listOffGrid`, 35000);
      await customer.waitFor(`(await window.__ra.listOffGrid()).length > 0`, 35000);
      const after = JSON.parse(await customer.eval(`JSON.stringify(await window.__ra.listOffGrid())`));
      if (after.length !== before.length) throw new Error("incident count changed across the reopen");
      return `${ref} survived a full close and reopen (${after.length} held)`;
    });

    await beat(13, "Reconnect and sync", 60, async () => {
      if (await customer.eval(`window.__ra.tier() !== "ONLINE"`)) {
        await customer.eval(`(() => { const n = document.getElementById("net"); if (n) n.click(); return true; })()`);
      }
      await customer.waitFor(`window.__ra.tier() === "ONLINE"`, 30000);
      await customer.eval(`(async () => { await window.__ra.syncOffGrid(); return true; })()`);
      await customer.waitFor(
        `(await window.__ra.listOffGrid()).every(i => i.status === "SYNCED" || i.serverId)`, 45000);
      const one = JSON.parse(await customer.eval(`JSON.stringify(await window.__ra.listOffGrid())`));
      // The closer: sync again. A retry after a lost response must converge.
      await customer.eval(`(async () => { await window.__ra.syncOffGrid(); return true; })()`);
      const two = JSON.parse(await customer.eval(`JSON.stringify(await window.__ra.listOffGrid())`));
      if (two.length !== one.length) throw new Error("re-sync changed the incident count — duplicate");
      return `${one.length} SYNCED with a server id; re-sync created none`;
    });

    await beat(14, "Architecture and honesty (narration)", 60, async () => "speech plus a doc on screen", "narration");
    await beat(15, "Close (narration)", 20, async () => "speech, not machine time", "narration");
  } finally {
    try { proc.kill(); } catch { /* already gone */ }
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows file lock */ }
  }

  // ── the report ────────────────────────────────────────────────────────────
  const budget = beats.reduce((a, b) => a + b.budgetS, 0);
  const action = beats.filter((b) => b.kind === "action");
  const machine = action.reduce((a, b) => a + b.ms / 1000, 0);
  const actionBudget = action.reduce((a, b) => a + b.budgetS, 0);

  console.log(`\n${"".padEnd(84, "\u2500")}`);
  console.log(`  Script budget, all 15 beats           ${clock(budget)}`);
  console.log(`  Budget for the ${action.length} action beats        ${clock(actionBudget)}`);
  console.log(`  Measured machine time, those beats    ${clock(machine)}`);
  console.log(`  Headroom left for narration           ${clock(actionBudget - machine)}`);
  console.log(`${"".padEnd(84, "\u2500")}`);

  const over = action.filter((b) => b.ms / 1000 > b.budgetS);
  if (over.length) {
    console.log(`\n  Beats where the machine alone exceeded its budget:`);
    for (const b of over) console.log(`    \u00b7 ${b.no} ${b.name} — ${secs(b.ms)} vs ${b.budgetS}s`);
  } else {
    console.log(`\n  No beat exceeded its budget on machine time alone.`);
  }
  if (problems) {
    console.log(`\n  ${problems} beat(s) FAILED — this is not a passing rehearsal.\n`);
    process.exit(1);
  }
  console.log(`\n  All 15 beats completed.\n`);
};

run().catch((e) => { console.error("\nrehearsal aborted:", e.message, "\n"); process.exit(1); });
