/**
 * Browser check for the live road scan (apps/web/scan.html).
 *
 * What it proves, in a real Chrome against a LOCAL API:
 *   1. the page loads the self-hosted detector with no third-party request,
 *      no console error and no horizontal overflow at 390 px;
 *   2. the in-browser detections match serve.py's on the same images
 *      (same class, box IoU > 0.9), on every engine this Chrome can run,
 *      each against the reference for the model THAT engine runs:
 *      scripts/scan-reference.json for the 640 px GPU model,
 *      scripts/scan-reference-416.json for the 416 px WebAssembly one;
 *   3. a fake camera (a .y4m made from a sample image) produces detections at
 *      a measured frame rate, per engine;
 *   4. "Report this hazard" posts the frame and its detections to
 *      POST /v1/raksha/report and the page says only what the server said;
 *   5. offline, the report is NOT claimed as sent or queued, and it goes once
 *      the connection is back; with location refused, nothing is sent.
 *
 * Same minimal DevTools-protocol client as ui-journey.mjs: no headless-browser
 * dependency, only a Chrome install. The fake camera needs ffmpeg to build the
 * .y4m; without it that section is reported as NOT RUN, never as passed.
 *
 *   BASE_URL=http://localhost:4611 node scripts/scan-check.mjs [--headed] [--shots <dir>]
 *
 * It refuses a non-local BASE_URL: it signs in and files real reports.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "apps", "web");
const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const HEADED = process.argv.includes("--headed");
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? process.argv[i + 1] : null; })();
const PORT = Number(process.env.CDP_PORT ?? 9334);
// A test number in the range the seeds leave free (+917000004000-9999).
const MSISDN = process.env.SCAN_MSISDN ?? "+917000004611";
// On the seeded NH-48 corridor, so the report snaps to a monitored segment.
const GEO = { latitude: 28.448, longitude: 77.017, accuracy: 12 };

const baseHost = new URL(BASE).hostname;
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseHost)) {
  console.error(`scan-check signs in and files reports; it only runs against a local API, not ${BASE}`);
  process.exit(2);
}

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

let pass = 0, fail = 0, notRun = 0;
const section = (t) => console.log(`\n${t}`);
const ok = (t, d = "") => { pass++; console.log(`  \u2713 ${t}${d ? "  " + d : ""}`); };
const bad = (t, d = "") => { fail++; console.log(`  \u2717 ${t}${d ? "  " + d : ""}`); };
const skip = (t, d = "") => { notRun++; console.log(`  - NOT RUN: ${t}${d ? "  " + d : ""}`); };
const check = (c, t, d) => (c ? ok(t, d) : bad(t, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.errors = []; this.requests = []; this.all = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.errors.push(d.exception?.description ?? d.text);
      }
      if (msg.method === "Network.requestWillBeSent") { this.requests.push(msg.params.request.url); this.all.push(msg.params.request.url); }
    });
  }
  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, timeoutMs);
    });
  }
  async eval(expression, timeoutMs = 60000) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    }, timeoutMs);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'");
  }
  async waitFor(cond, timeoutMs = 15000, label = cond) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if (await this.eval(`return Boolean(${cond});`)) return true; } catch { /* navigating */ }
      await sleep(150);
    }
    throw new Error(`timed out waiting for: ${label}`);
  }
  click(sel) {
    return this.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("no element: ${sel}"); el.click(); return true;`);
  }
  text(sel) {
    return this.eval(`const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.textContent || "").trim() : null;`);
  }
  async shot(name) {
    if (!SHOTS) return;
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(SHOTS, name), Buffer.from(r.data, "base64"));
  }
}

/** A two-second .webm of a sample road image, for the "Photo or video" upload path. */
function makeWebm(dir) {
  const out = join(dir, "road.webm");
  const src = join(WEB, "assets", "scan", "India_008826-wide.jpg");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", src, "-t", "2", "-r", "10",
    "-c:v", "libvpx", "-b:v", "1M", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
  return r.status === 0 && existsSync(out) ? out : null;
}

/** A short .y4m of a sample road image, letterboxed to 1280x720, for Chrome's fake camera. */
function makeY4m(dir) {
  const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ff.status !== 0) return null;
  const out = join(dir, "road.y4m");
  const src = join(WEB, "assets", "scan", "India_008826-wide.jpg");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", src, "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-frames:v", "30", "-r", "15", out], { encoding: "utf8" });
  return r.status === 0 && existsSync(out) ? out : null;
}

async function launch(y4m) {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome not found");
  const profile = mkdtempSync(join(tmpdir(), "ra-scan-"));
  const args = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling",
    "--window-size=390,860",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    ...(y4m ? [`--use-file-for-fake-video-capture=${y4m}`] : []),
    "--enable-unsafe-webgpu",
  ];
  if (!HEADED) args.push("--headless=new");
  if (process.env.CI) args.push("--no-sandbox", "--disable-dev-shm-usage");
  const proc = spawn(exe, [...args, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* not yet */ }
    await sleep(250);
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const page = new Page(ws);
  await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("Network.enable");
  return { page, proc, profile };
}

/** Match every Python detection to a same-class browser detection by IoU. */
function compare(py, js) {
  const iou = (a, b) => {
    const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = iw * ih, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return u > 0 ? inter / u : 0;
  };
  const used = new Set(), rows = [];
  for (const p of py) {
    let best = -1, bestIou = 0;
    js.forEach((j, k) => { if (!used.has(k) && j.type === p.type && iou(p.box, j.box) > bestIou) { best = k; bestIou = iou(p.box, j.box); } });
    if (best >= 0) used.add(best);
    rows.push({ type: p.type, iou: bestIou, dConf: best >= 0 ? Math.abs(js[best].confidence - p.confidence) : null,
      sevSame: best >= 0 && js[best].severity === p.severity });
  }
  return { rows, extra: js.length - used.size };
}

const run = async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "ra-scan-y4m-"));
  const y4m = makeY4m(tmp);
  const { page, proc, profile } = await launch(y4m);
  const origin = new URL(BASE).origin;
  const summary = { parity: {}, fps: {}, engines: [] };
  const cleanup = () => {
    try { proc.kill(); } catch { /* gone */ }
    for (const d of [profile, tmp]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* leave */ } }
  };

  try {
    await page.send("Browser.grantPermissions", { origin, permissions: ["geolocation", "videoCapture"] });
    await page.send("Emulation.setGeolocationOverride", GEO);

    // ══ sign in on the citizen app, as a person would ══════════════════════
    section("1. Sign in on the citizen app (local API, dev OTP)");
    await page.goto(`${BASE}/app.html`);
    await page.waitFor(`document.getElementById("a-send")`);
    await page.eval(`const el = document.getElementById("a-msisdn"); el.value = ${JSON.stringify(MSISDN)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
    await page.click("#a-send");
    await page.waitFor(`document.getElementById("a-step2").hidden === false && /^\\d{6}$/.test(document.getElementById("a-code").value)`, 15000);
    await page.click("#a-verify");
    await page.waitFor(`document.getElementById("scr-home").classList.contains("active")`, 20000);
    ok("signed in as a test citizen", MSISDN);

    // ══ the page and its engine ════════════════════════════════════════════
    section("2. scan.html loads the self-hosted detector");
    page.errors.length = 0; page.requests.length = 0;
    const t0 = Date.now();
    await page.goto(`${BASE}/scan.html`);
    await page.waitFor(`window.__scan && window.__scan.ready()`, 90000, "the detector to start");
    ok("detector ready", `${Date.now() - t0} ms, engine ${await page.eval("return window.__scan.state.ep")}`);
    // The sidecar each engine runs, read from scan.js's own lines, so a model
    // swap cannot leave this check comparing against the old model.
    const scanJs = readFileSync(join(WEB, "scan.js"), "utf8");
    const sidecarOf = (name) => {
      const path = new RegExp(`var ${name} = "([^"]+)";`).exec(scanJs)[1];
      return JSON.parse(readFileSync(join(WEB, ...path.split("/")), "utf8"));
    };
    const sidecars = { gpu: sidecarOf("MODEL_SIDECAR_GPU"), wasm: sidecarOf("MODEL_SIDECAR_WASM") };
    const sidecarFor = (ep) => (ep === "wasm" ? sidecars.wasm : sidecars.gpu);
    const activeLine = async (ep) => {
      const c = sidecarFor(ep);
      const t = await page.text("#model-active");
      const want = `${c.inputSize[0]} px`, map = `mAP50 ${c.metrics.mAP50.toFixed(3)}`;
      return { t, good: t.includes(want) && t.includes(map) && (await page.text("#model-about")).includes(c.modelVersion) };
    };
    const startEp = await page.eval("return window.__scan.state.ep");
    const firstActive = await activeLine(startEp);
    check(startEp === "wasm" && sidecars.wasm.inputSize[0] === 416 && firstActive.good,
      "it starts on WebAssembly with the 416 px model, and says so with that model's accuracy", firstActive.t.slice(0, 90) + "…");
    const iso = await page.eval("return window.crossOriginIsolated");
    check(iso === true, "the page is cross-origin isolated (multi-threaded WebAssembly)", String(iso));
    const overflow = await page.eval("return document.documentElement.scrollWidth - document.documentElement.clientWidth");
    check(overflow <= 0, "no horizontal overflow at 390 px", `overflow=${overflow}px`);
    const about = await page.text("#model-about");
    check(/mAP50 0\.\d{3}/.test(about) && /prediction/.test(about), "the page states the measured mAP50 and calls results predictions", about.slice(0, 90) + "…");
    check(/CC BY-SA 4\.0/.test(await page.text(".credits")), "the RDD2022 dataset is credited with its licence");
    const signin = await page.text("#r-signin");
    check(/RoadAssist account/.test(signin), "the page found the citizen session", signin);

    // ══ JS vs Python parity, per engine ════════════════════════════════════
    section("3. In-browser detections match serve.py on the same images (IoU > 0.9)");
    const refs = {
      gpu: JSON.parse(readFileSync(join(HERE, "scan-reference.json"), "utf8")),
      wasm: JSON.parse(readFileSync(join(HERE, "scan-reference-416.json"), "utf8")),
    };
    check(refs.gpu.sha256 === sidecars.gpu.sha256, "the 640 px reference was made with the model WebGPU runs", refs.gpu.sha256.slice(0, 12));
    check(refs.wasm.sha256 === sidecars.wasm.sha256, "the 416 px reference was made with the model WebAssembly runs", refs.wasm.sha256.slice(0, 12));
    const engines = [];
    for (const ep of ["webgpu", "webgl", "wasm"]) {
      await page.eval(`window.__scan.useEngine(${JSON.stringify(ep)}); return true;`);
      await sleep(300);
      await page.waitFor(`window.__scan.ready() && document.getElementById("ep").value === ${JSON.stringify(ep)} && !/Starting/.test(document.getElementById("placeholder-text").textContent)`, 90000, `engine ${ep}`);
      await sleep(500);
      const got = await page.eval("return window.__scan.state.ep");
      if (got !== ep) { skip(`${ep} parity`, `this Chrome fell back to ${got}: ${await page.eval("return window.__scan.state.epTried.join('; ')")}`); continue; }
      engines.push(ep);
      const ref = ep === "wasm" ? refs.wasm : refs.gpu;
      const active = await activeLine(ep);
      check(active.good, `${ep}: the page names the ${sidecarFor(ep).inputSize[0]} px model it runs and that model's accuracy`, active.t.slice(0, 70) + "…");
      let worst = 1, n = 0, extra = 0, maxDConf = 0, sevAll = true;
      for (const img of ref.images) {
        const js = await page.eval(`return await window.__scan.detectUrl("assets/scan/${img.image}");`);
        const c = compare(img.detections, js);
        extra += c.extra;
        for (const r of c.rows) { worst = Math.min(worst, r.iou); n++; if (r.dConf != null) maxDConf = Math.max(maxDConf, r.dConf); sevAll = sevAll && r.sevSame; }
        summary.parity[`${ep}:${img.image}`] = c.rows.map((r) => `${r.type} IoU ${r.iou.toFixed(4)} dConf ${r.dConf?.toFixed(4)}`);
      }
      summary.parity[ep] = { detections: n, minIoU: Number(worst.toFixed(4)), maxConfDiff: Number(maxDConf.toFixed(4)), extra };
      check(worst > 0.9 && n >= 3, `${ep}: all ${n} Python detections reproduced`, `min IoU ${worst.toFixed(4)}, max |dconf| ${maxDConf.toFixed(4)}, ${extra} extra`);
      check(sevAll, `${ep}: every severity matches serve.py`);
    }
    summary.engines = engines;
    check(engines.includes("wasm"), "the WebAssembly fallback runs everywhere");

    // ══ sample mode ════════════════════════════════════════════════════════
    section("4. Sample images");
    await page.eval(`window.__scan.useEngine("auto"); return true;`);
    await page.waitFor(`window.__scan.ready() && !/Starting/.test(document.getElementById("placeholder-text").textContent)`, 90000);
    await sleep(400);
    await page.click("#src-sample");
    await page.waitFor(`document.querySelectorAll("#det-list li:not(.empty)").length > 0`, 20000, "sample detections");
    const list = await page.text("#det-list");
    check(/pothole/.test(list) && /Model prediction/.test(list) && /sev \d\/5/.test(list), "detections listed as predictions with severity", list.slice(0, 80));
    await page.shot("scan-01-sample.png");
    await page.click("#sample-next");
    await sleep(1500);
    await page.shot("scan-02-sample-next.png");

    // ══ upload: a photo, then a video ═════════════════════════════════════
    section("4b. Photo or video upload");
    const upload = async (file) => {
      const { root } = await page.send("DOM.getDocument", { depth: 1 });
      const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#upload" });
      await page.send("DOM.setFileInputFiles", { nodeId, files: [file] });
    };
    await upload(join(WEB, "assets", "scan", "India_006555.jpg"));
    await page.waitFor(`window.__scan.state.source === "upload" && window.__scan.state.frameW > 0`, 20000, "the uploaded photo to be scanned");
    const photoDets = await page.eval("return window.__scan.state.dets.map((d) => d.type)");
    check(photoDets.includes("pothole"), "an uploaded photo is scanned", photoDets.join(", "));
    // A class the report route does not take is listed with the reason, never filed.
    await upload(join(WEB, "assets", "scan", "India_006663.jpg"));
    await page.waitFor(`window.__scan.state.frameW > 0 && /India_006663/.test(document.getElementById("source-caption").textContent) && document.querySelectorAll("#det-list li:not(.empty)").length > 0`, 20000, "the second uploaded photo to be scanned");
    const unreportable = await page.eval("return window.__scan.state.dets.filter((d) => !d.ingestable).map((d) => d.type)");
    const listed = await page.text("#det-list");
    if (!unreportable.length) skip("a not-reportable class is explained", "the model found none on India_006663.jpg");
    else check(/not reportable: /.test(listed), "a class the report route does not take is listed as not reportable, with the reason", unreportable.join(", "));
    await page.eval(`document.getElementById("det-list").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-02b-not-reportable.png");
    await page.eval(`document.getElementById("model-about").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-02c-about.png");
    const webm = makeWebm(tmp);
    if (!webm) {
      skip("video upload", "ffmpeg not found, so no test video could be made");
    } else {
      await upload(webm);
      await page.waitFor(`window.__scan.state.source === "video" && window.__scan.state.running && window.__scan.state.dets.length > 0`, 30000, "the uploaded video to be scanned");
      ok("an uploaded video is scanned frame by frame", `${await page.eval("return window.__scan.state.dets.length")} detection(s) in ${await page.eval("return window.__scan.state.frameW + 'x' + window.__scan.state.frameH")}`);
    }

    // ══ fake camera, fps per engine ═══════════════════════════════════════
    section("5. Fake camera: live detections and frame rate per engine");
    if (!y4m) {
      skip("fake camera", "ffmpeg not found, so no .y4m could be made");
    } else {
      for (const ep of engines) {
        await page.eval(`window.__scan.useEngine(${JSON.stringify(ep)}); return true;`);
        await sleep(300);
        await page.waitFor(`window.__scan.ready() && window.__scan.state.ep === ${JSON.stringify(ep)} && !/Starting/.test(document.getElementById("placeholder-text").textContent)`, 90000);
        await page.click("#src-camera");
        await page.waitFor(`window.__scan.state.running && window.__scan.state.frameW > 0`, 20000, "camera frames");
        await sleep(7000);
        const live = await page.eval(`return { fps: window.__scan.fps(), ms: window.__scan.state.lastMs, n: window.__scan.state.dets.length, w: window.__scan.state.frameW, h: window.__scan.state.frameH, hud: document.getElementById("hud-fps").textContent };`);
        summary.fps[ep] = { fps: Number(live.fps.toFixed(2)), msPerInference: Math.round(live.ms), frame: `${live.w}x${live.h}` };
        check(live.n > 0, `${ep}: the fake camera feed produces detections`, `${live.n} in a ${live.w}x${live.h} frame`);
        check(live.fps > 0 && live.fps <= 8.6, `${ep}: throttled frame rate measured`, `${live.fps.toFixed(2)} fps, ${Math.round(live.ms)} ms/inference, HUD "${live.hud}"`);
        if (ep === engines[0]) await page.shot("scan-03-camera.png");
      }
    }

    // ══ the camera is let go ═══════════════════════════════════════════════
    // getUserMedia is slowed to stand in for a permission prompt, and every
    // stream it hands out is kept, so a stream nobody holds can be found.
    section("5b. The camera is released: double start, Stop while starting, page hidden");
    await page.eval(`
      window.__streams = [];
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        await new Promise((r) => setTimeout(r, 400));
        const s = await real(c); window.__streams.push(s); return s;
      };
      window.__liveStreams = () => window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === "live")).length;
      return true;`);
    await page.eval(`document.getElementById("src-camera").click(); document.getElementById("src-camera").click(); return true;`);
    await page.waitFor(`window.__scan.state.running && window.__scan.state.frameW > 0`, 20000, "camera frames");
    await sleep(1500);
    const dbl = await page.eval(`return { live: window.__liveStreams(), made: window.__streams.length };`);
    check(dbl.live === 1, "two taps on Camera leave one live camera stream, not an orphan nobody can stop", JSON.stringify(dbl));

    await page.click("#cam-toggle");   // off
    await page.eval(`window.__streams = []; document.getElementById("cam-toggle").click(); return true;`);   // on...
    await sleep(100);
    await page.click("#cam-toggle");   // ...and Stop, while getUserMedia is still pending
    await sleep(2500);
    const stopEarly = await page.eval(`return { live: window.__liveStreams(), running: window.__scan.state.running, label: document.getElementById("cam-toggle").textContent };`);
    check(stopEarly.live === 0 && !stopEarly.running, "Stop pressed while the camera is starting leaves it off, with no stream live", JSON.stringify(stopEarly));

    await page.click("#cam-toggle");   // on again
    await page.waitFor(`window.__scan.state.running && window.__scan.state.frameW > 0`, 20000, "camera frames");
    const setHidden = (h) => page.eval(`
      Object.defineProperty(document, "hidden", { configurable: true, get: () => ${h} });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => ${h ? '"hidden"' : '"visible"'} });
      document.dispatchEvent(new Event("visibilitychange")); return true;`);
    await setHidden(true);
    await sleep(800);
    const hid = await page.eval(`return { live: window.__liveStreams() };`);
    check(hid.live === 0, "with the page hidden the camera is stopped (its light goes off), not just the loop paused", JSON.stringify(hid));
    await setHidden(false);
    let back = false;
    try { await page.waitFor(`window.__scan.state.running && window.__scan.state.frameW > 0 && window.__liveStreams() === 1`, 20000, "camera back"); back = true; } catch { /* reported below */ }
    check(back, "shown again, the camera comes back on by itself");
    await page.eval(`delete document.hidden; delete document.visibilityState; return true;`);
    await page.click("#cam-toggle");   // off before the report sections

    // ══ report: online ════════════════════════════════════════════════════
    section("6. Report this hazard -> POST /v1/raksha/report (local API)");
    await page.eval(`window.__scan.useEngine("auto"); return true;`);
    await page.waitFor(`window.__scan.ready() && !/Starting/.test(document.getElementById("placeholder-text").textContent)`, 90000);
    await sleep(300);
    await page.click("#src-sample");
    await page.waitFor(`window.__scan.state.frameW > 0 && document.querySelectorAll("#det-list li:not(.empty)").length > 0 && !document.getElementById("r-open").disabled`, 30000);
    await page.click("#r-open");
    await page.waitFor(`!document.getElementById("r-panel").hidden && !document.getElementById("r-send").disabled`, 20000, "send enabled (location + reportable detection)");
    const loc = await page.text("#r-location");
    check(/28\.448/.test(loc) && /±12 m/.test(loc), "the device's position and its accuracy are shown", loc);
    const note = await page.text("#r-note");
    check(note.length <= 280 && /predictions, not verified/.test(note), "the note carries the model's predictions and fits 280 chars", `${note.length} chars`);
    await page.eval(`document.getElementById("r-summary").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-04-report-confirm.png");
    page.requests.length = 0;
    await page.click("#r-send");
    await page.waitFor(`window.__scan.lastReport`, 30000, "the server's answer");
    const rep = await page.eval("return window.__scan.lastReport");
    check(rep.status === 201 && rep.data?.status === "DETECTED", "the API answered 201, status DETECTED", JSON.stringify({ status: rep.status, s: rep.data?.status }));
    check(rep.data?.hasPhoto === true, "the frame went with it as the report's photo");
    // The version must be the model that drew this frame's boxes: the one its note names.
    check(typeof rep.data?.confidence === "number" && rep.data.confidence > 0 && rep.data.confidence < 1 &&
          [sidecars.gpu.modelVersion, sidecars.wasm.modelVersion].includes(rep.data?.modelVersion) &&
          note.includes(rep.data.modelVersion),
      "the report carries the model's own confidence and version, not a fixed 100%",
      JSON.stringify({ confidence: rep.data?.confidence, modelVersion: rep.data?.modelVersion }));
    const shown = await page.text("#r-result");
    check(/Queued for authority verification/.test(shown) && /No authority has verified it yet/.test(shown),
      "the page repeats the server's own words and claims no verification", shown.slice(0, 100) + "…");
    check(page.requests.some((u) => u === `${origin}/v1/raksha/report`), "the request went to the local API's report route");
    await page.eval(`document.getElementById("r-result").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-05-report-sent.png");
    const mine = await page.eval(`
      const s = JSON.parse(sessionStorage.getItem("ra.app.session") || "{}");
      const r = await fetch("/v1/me/reports", { headers: { authorization: "Bearer " + s.token } });
      return (await r.json()).data;
    `);
    const filed = (mine || []).find((m) => m.id === rep.data.id);
    check(Boolean(filed) && filed.has_photo === true && /Live road scan/.test(String(filed.notes)), "the report, its photo and its note are in the citizen's own report list", filed ? `${filed.detection_type} sev ${filed.severity} ${filed.status}` : "missing");

    // ══ report: a double tap ═══════════════════════════════════════════════
    // Send stayed enabled while the photo was being shrunk (an await before the
    // button was disabled), so a second tap built and posted a second report:
    // two RAKSHA rows, two pins, for one hazard.
    section("6b. A double tap on Send files one report, not two");
    const myCount = () => page.eval(`
      const s = JSON.parse(sessionStorage.getItem("ra.app.session") || "{}");
      const r = await fetch("/v1/me/reports", { headers: { authorization: "Bearer " + s.token } });
      return ((await r.json()).data || []).length;`);
    await page.click("#r-open");
    await page.waitFor(`!document.getElementById("r-panel").hidden && !document.getElementById("r-send").disabled`, 20000);
    const before2 = await myCount();
    await page.eval("window.__scan.lastReport = null; return true;");
    page.requests.length = 0;
    await page.eval(`const b = document.getElementById("r-send"); b.click(); b.click(); return true;`);
    await page.waitFor(`window.__scan.lastReport`, 30000, "the server's answer");
    await sleep(4000);   // a second post, if one went, lands well within this
    const posts = page.requests.filter((u) => u === `${origin}/v1/raksha/report`).length;
    const after2 = await myCount();
    check(posts === 1 && after2 - before2 === 1, "two taps on Send post the report once and file one RAKSHA row",
      `${posts} POST(s), ${after2 - before2} new report(s)`);

    // ══ report: offline ═══════════════════════════════════════════════════
    section("7. Offline: not sent, not queued, said so; sent when back online");
    await page.click("#r-open");
    await page.waitFor(`!document.getElementById("r-send").disabled`, 20000);
    await page.eval("window.__scan.lastReport = null; return true;");
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(300);
    await page.click("#r-send");
    await page.waitFor(`window.__scan.lastReport`, 20000);
    const off = await page.eval("return { r: window.__scan.lastReport, t: document.getElementById('r-result').textContent }");
    check(off.r.held === true && /Not sent/.test(off.t) && /Nothing was queued/.test(off.t), "offline: the page says not sent and nothing queued", off.t.slice(0, 90) + "…");
    // Detection itself keeps working with the network gone.
    const offDets = await page.eval(`return (await window.__scan.detectUrl("assets/scan/India_002049.jpg")).length;`);
    check(offDets > 0, "detection still runs offline", `${offDets} detection(s)`);
    await page.eval(`document.getElementById("r-result").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-06-offline.png");
    await page.eval("window.__scan.lastReport = null; return true;");
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.waitFor(`window.__scan.lastReport && window.__scan.lastReport.status === 201`, 30000, "the held report to go once online");
    ok("back online: the held report was sent", `status ${await page.eval("return window.__scan.lastReport.status")}`);

    // ══ report: location refused ══════════════════════════════════════════
    section("8. Location refused: nothing is sent, and the page says why");
    await page.send("Browser.setPermission", { origin, permission: { name: "geolocation" }, setting: "denied" });
    await page.send("Emulation.clearGeolocationOverride");
    await page.click("#r-open");
    await page.waitFor(`/not allowed|no GPS fix/.test(document.getElementById("r-location").textContent)`, 25000);
    const deny = await page.eval("return { t: document.getElementById('r-location').textContent, d: document.getElementById('r-send').disabled }");
    check(deny.d === true && /not allowed/.test(deny.t), "with location refused the Send button stays off", deny.t.slice(0, 90) + "…");
    await page.eval(`document.getElementById("r-location").scrollIntoView({ block: "center" }); return true;`);
    await sleep(300);
    await page.shot("scan-07-location-denied.png");

    // ══ residency ═════════════════════════════════════════════════════════
    section("9. Nothing left this origin");
    const foreign = page.all.filter((u) => !u.startsWith(origin) && !/^(data|blob|chrome|about):/.test(u));
    check(foreign.length === 0, "every request the page made was to the local API", foreign[0] ?? `${page.all.length} requests checked`);
    const errs = page.errors.filter((e) => !/favicon|Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/i.test(e));
    check(errs.length === 0, "no uncaught errors on the page", errs[0]?.slice(0, 120) ?? "clean");
  } catch (e) {
    bad("run aborted", e.message);
    try {
      console.log("  page status: " + await page.text("#status"));
      console.log("  placeholder: " + await page.text("#placeholder-text"));
      console.log("  report: " + await page.text("#r-summary") + " | " + await page.text("#r-location") + " | " + await page.text("#r-result"));
    } catch { /* page gone */ }
    if (page.errors.length) console.log("  page errors:\n    " + page.errors.slice(0, 5).map((x) => String(x).slice(0, 300)).join("\n    "));
  } finally {
    cleanup();
  }

  console.log("\nsummary " + JSON.stringify(summary, null, 2));
  console.log(`\n${pass} passed, ${fail} failed${notRun ? `, ${notRun} not run` : ""}`);
  process.exit(fail ? 1 : 0);
};

run();
