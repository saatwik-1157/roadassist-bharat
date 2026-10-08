/* RoadAssist — live road scan (scan.html).
 *
 * The camera (or a sample image, or a file) goes through a RAKSHA road-damage
 * detector that runs IN THIS BROWSER on ONNX Runtime Web: no frame is uploaded
 * to be analysed, and once the page has loaded, detection keeps working with
 * the network gone. The arithmetic - letterbox, decode, NMS, severity - lives
 * in scan-core.js, a port of the Python serving path that is tested against it.
 *
 * Reporting uses the citizen app's own endpoint, POST /v1/raksha/report, with
 * the citizen app's own session (session.js, slot "app"). It is never queued
 * offline: the off-grid journal (offline-store.js) is replayed by app.html to
 * /v1/sync/operations, which would record the report as a sync operation and
 * mark it synced without it ever reaching RAKSHA - a success that did nothing.
 * So an unsent report is said to be unsent, held on this page, and retried
 * only while the page is open.
 *
 * A classic script, like the others on cached pages (check-boundaries.mjs
 * rule 4): ONNX Runtime is an ES module and is reached by dynamic import().
 */
(function () {
  "use strict";

  /* ══ the model settings ═════════════════════════════════════════════════
     Each sidecar JSON names the .onnx beside it and carries its class list
     (in output-index order), input size, thresholds and measured metrics,
     all written from the model's own metadata by ai/road_damage/web_model.py.
     Swapping a detector is: run web_model.py export, change its line.

     Two exports of the same weights. WebGPU runs the 640 px one. WebAssembly,
     the engine a phone with no WebGPU is left with, runs the 416 px one: it
     does about 2.4x less arithmetic and measured roughly half the time per
     frame there (2026-10-08: 205-315 -> 107-187 ms a test frame; 767-908 ->
     357-462 ms at 4x CPU throttle). Time to READY barely moved (2.7-3.2 s ->
     2.4-3.9 s; ~11.9 -> 10.3-12.0 s throttled): start-up is spent compiling
     ONNX Runtime's 28 MB wasm and building the session, not on input size.
     The page says which model is active, with its own measured accuracy -
     the 416 px model scores lower. */
  var MODEL_SIDECAR_GPU = "assets/models/raksha-yolo11n-india-ft-gpu.json";
  var MODEL_SIDECAR_WASM = "assets/models/raksha-yolo11n-india-ft-gpu-416.json";
  function sidecarFor(ep) { return ep === "wasm" ? MODEL_SIDECAR_WASM : MODEL_SIDECAR_GPU; }

  var ORT_DIR = "vendor/ort/";               // onnxruntime-web 1.30.0, self-hosted (VERSION.txt)
  var MAX_FPS = 8;                           // the loop never runs faster than this
  var SAMPLE_DIR = "assets/scan/";
  var SAMPLES = [
    { file: "India_008826.jpg", caption: "RDD2022 India · India_008826 · patched potholes on a dual carriageway" },
    { file: "India_002049.jpg", caption: "RDD2022 India · India_002049 · a pothole mid-lane" },
    { file: "India_006555.jpg", caption: "RDD2022 India · India_006555 · a pothole ahead" },
    { file: "India_006663.jpg", caption: "RDD2022 India · India_006663 · cracked surface" },
    { file: "India_008826-wide.jpg", caption: "RDD2022 India · India_008826, cropped to a 16:9 camera frame" },
  ];
  var EP_LABEL = { webgpu: "WebGPU", webgl: "WebGL", wasm: "WASM" };

  var Core = window.RAScanCore;
  var $ = function (id) { return document.getElementById(id); };

  // Same expression as app.html (test/web-api-origin.test.ts explains why).
  var API = (function () {
    var http = location.protocol === "http:" || location.protocol === "https:";
    if (!http) return "http://localhost:4000";
    return location.origin;
  })();
  var sess = window.RASession ? window.RASession("ra.app.session", "app", API) : null;

  var S = {
    cfg: null, ort: null, models: {}, session: null, ep: null, epTried: [],
    inputName: null, outputName: null,
    source: null, running: false, timer: 0, busy: false, gen: 0,
    stream: null, sampleIndex: 0, objectUrl: null,
    dets: [], frameW: 0, frameH: 0, lastMs: 0,
    fps: new Core.FpsMeter(3000), fpsByEp: {},
    lastAnnounce: 0, lastCountSig: "",
    pending: null,   // a report that has not reached the server
    locked: false, engineGen: 0, warmMs: {}, sessions: {}, starting: false,
  };

  // The frame is read at its own resolution (drawImage 1:1 does not resample)
  // and letterboxed in scan-core.js with the same INTER_LINEAR arithmetic the
  // model was trained on. willReadFrequently keeps getImageData on the CPU.
  var srcCanvas = document.createElement("canvas");
  var srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

  /* ── status ─────────────────────────────────────────────────────────── */
  function say(text, bad) {
    var el = $("status");
    el.textContent = text;
    el.classList.toggle("bad", Boolean(bad));
  }
  function placeholder(text, showBar) {
    $("placeholder").hidden = !text;
    $("placeholder-text").textContent = text || "";
    $("load-progress").hidden = !showBar;
  }
  function setNet() {
    var on = navigator.onLine, n = $("net");
    n.textContent = on ? "Online" : "Offline";
    n.classList.toggle("is-offline", !on);
  }
  window.addEventListener("online", function () { setNet(); if (S.pending) sendReport(true); });
  window.addEventListener("offline", setNet);
  setNet();

  /* ── model + engine ─────────────────────────────────────────────────── */
  async function fetchBytes(url, expected, onProgress) {
    var res = await fetch(url);
    if (!res.ok) throw new Error("could not download " + url + " (HTTP " + res.status + ")");
    if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
    var total = Number(res.headers.get("content-length")) || expected || 0;
    var reader = res.body.getReader(), chunks = [], got = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value); got += step.value.length;
      if (total) onProgress(Math.min(1, got / total));
    }
    var out = new Uint8Array(got), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  async function sha256Hex(bytes) {
    if (!(window.crypto && crypto.subtle)) return null;   // plain-http LAN address: no SubtleCrypto
    var d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.prototype.map.call(d, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  /**
   * A model's sidecar and bytes, fetched once per page. `quiet` is the
   * background WebGPU try: it must not cover a scan that is already running
   * with a progress bar.
   */
  async function loadModel(sidecar, quiet) {
    if (S.models[sidecar]) return S.models[sidecar];
    if (!quiet) placeholder("Loading the detector…", true);
    var res = await fetch(sidecar);
    if (!res.ok) throw new Error("the model description is missing (" + sidecar + ")");
    var cfg = await res.json();
    if (!Array.isArray(cfg.classes) || !cfg.classes.length || !cfg.inputSize) {
      throw new Error("the model description has no class list or input size");
    }
    var base = sidecar.slice(0, sidecar.lastIndexOf("/") + 1);
    var bytes = await fetchBytes(base + cfg.model, cfg.bytes, function (f) {
      if (quiet) return;
      var pct = Math.round(f * 100);
      $("load-bar").style.width = pct + "%";
      $("load-progress").setAttribute("aria-valuenow", String(pct));
      $("placeholder-text").textContent = "Loading the detector… " + pct + "%";
    });
    // A cached or half-deployed .onnx that is not the one its sidecar
    // describes would draw the wrong class names on real boxes: refuse it.
    var hash = await sha256Hex(bytes);
    if (hash && cfg.sha256 && hash !== cfg.sha256) {
      throw new Error("the model file does not match its description (sha256) - reload the page");
    }
    return (S.models[sidecar] = { cfg: cfg, bytes: bytes });
  }

  function describeModel() {
    var c = S.cfg, m = c.metrics || {};
    var mb = c.bytes ? (c.bytes / 1e6).toFixed(1) + " MB" : "";
    var px = c.inputSize[0] + " px";
    $("model-active").textContent = "Active: the " + px + " model on " + EP_LABEL[S.ep] +
      ", mAP50 " + (m.mAP50 != null ? m.mAP50.toFixed(3) : "n/a") + " on held-out validation images" +
      (S.ep === "wasm"
        ? ". This is the smaller, faster-starting model WebAssembly runs; with WebGPU the page runs the 640 px model, which scores higher."
        : ". Without WebGPU the page runs a smaller 416 px model that starts faster and scores lower.");
    $("model-about").textContent =
      "Model: " + (c.architecture || "YOLO") + " (" + c.modelVersion + ", " + px + ", " + mb + "), classes " +
      c.classes.join(", ") + ". Measured mAP50 " + (m.mAP50 != null ? m.mAP50.toFixed(3) : "n/a") +
      (m.mAP50_95 != null ? " (mAP50-95 " + m.mAP50_95.toFixed(3) + ")" : "") +
      " on held-out validation images" + (m.source ? " (" + m.source + ")" : "") + ". " +
      perClassText(m.perClassMAP50) +
      "That is a modest score: it misses many hazards and marks some things that are not. " +
      "Every box is the model's prediction with its confidence, not a confirmed defect; " +
      "boxes below " + Math.round((c.minConfidence || 0.3) * 100) + "% are not shown.";
  }

  /**
   * "Per class: pothole 0.324, ... Manhole is its easiest class and lifts the
   * average; pothole is its weakest." - from the sidecar's measured figures,
   * so a mean propped up by an easy class is never the only number shown.
   */
  function perClassText(per) {
    var names = per ? Object.keys(per).filter(function (k) { return typeof per[k] === "number"; }) : [];
    if (names.length < 2) return "";
    var label = function (k) { return k.replace("_", " "); };
    var sorted = names.slice().sort(function (a, b) { return per[a] - per[b]; });
    var hi = sorted[sorted.length - 1], lo = sorted[0];
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    return "Per class: " + names.map(function (k) { return label(k) + " " + per[k].toFixed(3); }).join(", ") + ". " +
      cap(label(hi)) + " is its easiest class and lifts the average; " + label(lo) + " is its weakest. ";
  }

  async function loadOrt() {
    if (S.ort) return S.ort;
    var dir = new URL(ORT_DIR, location.href).href;
    var ort = await import(dir + "ort.all.min.mjs");
    // Every engine file comes from this origin: no CDN default is ever used.
    ort.env.wasm.wasmPaths = dir;
    // Threads need cross-origin isolation (scan.html is served with COOP/COEP
    // for exactly this); without it ONNX Runtime runs single-threaded.
    var cores = navigator.hardwareConcurrency || 2;
    ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil(cores / 2))) : 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = "error";
    S.ort = ort;
    return ort;
  }

  // 45 s: the 640 model takes 12-19 s to start on WASM on a busy laptop, and a
  // slow phone without WebGPU needs more; giving up early would hide a working engine.
  var ENGINE_TIMEOUT_MS = 45000;
  function withTimeout(promise, ms, message) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error(message)); }, ms); }),
    ]).finally(function () { clearTimeout(timer); });
  }

  async function epAvailable(ep) {
    if (ep === "webgpu") {
      if (!navigator.gpu) return false;
      try { return Boolean(await navigator.gpu.requestAdapter()); } catch { return false; }
    }
    if (ep === "webgl") {
      try { return Boolean(document.createElement("canvas").getContext("webgl2")); } catch { return false; }
    }
    return typeof WebAssembly === "object";
  }

  var UPGRADE_TIMEOUT_MS = 45000;
  function msg(e) { return String(e && e.message || e).slice(0, 140); }

  /**
   * A session on `ep` that has loaded the model AND run frames. A backend can
   * accept the graph and still fail on an operator at run time (ORT's WebGL
   * backend cannot run YOLO11's Split), so a test run is part of "works". The
   * first run also compiles GPU shaders; the second is the one that is timed.
   */
  async function makeSession(ep, timeoutMs, quiet) {
    var ort = await loadOrt();
    if (!(await epAvailable(ep))) throw new Error("not available in this browser");
    var model = await loadModel(sidecarFor(ep), quiet);
    // A GPU driver can hang instead of failing; a stuck engine must not leave
    // the page on "Starting…" forever, so every step is bounded.
    var session = await withTimeout(ort.InferenceSession.create(model.bytes, {
      executionProviders: [ep], graphOptimizationLevel: "all",
      // Errors only: ORT's node-placement notice is a warning written with
      // console.error, which would read as a fault on a demo screen.
      logSeverityLevel: 3,
    }), timeoutMs, "did not start within " + timeoutMs / 1000 + " s");
    try {
      var cfg = model.cfg, w = cfg.inputSize[0], h = cfg.inputSize[1], feeds = {};
      feeds[session.inputNames[0]] = new ort.Tensor("float32", new Float32Array(3 * w * h).fill(114 / 255), [1, 3, h, w]);
      var out = await withTimeout(session.run(feeds), timeoutMs, "did not finish a test frame within " + timeoutMs / 1000 + " s");
      var o = out[session.outputNames[0]];
      if (!o || o.dims.length !== 3 || o.dims[1] !== 4 + cfg.classes.length) {
        throw new Error("output shape " + (o && o.dims.join("x")) + " does not match " + cfg.classes.length + " classes");
      }
      var t0 = performance.now();
      await withTimeout(session.run(feeds), timeoutMs, "did not finish a second test frame");
      return { session: session, cfg: cfg, ms: performance.now() - t0 };
    } catch (e) {
      try { await session.release(); } catch { /* nothing to release */ }
      throw e;
    }
  }

  /**
   * One session per engine for the life of the page, reused on every switch.
   * Releasing a WebGPU session corrupts the next one in ONNX Runtime 1.30
   * ("no GPU data for input"), so a working session is never released.
   */
  async function sessionFor(ep, timeoutMs, quiet) {
    if (S.sessions[ep]) return { session: S.sessions[ep].session, cfg: S.sessions[ep].cfg, ms: S.warmMs[ep] };
    var made = await makeSession(ep, timeoutMs, quiet);
    S.sessions[ep] = { session: made.session, cfg: made.cfg };
    return made;
  }

  /** The engine and its model change together, under the engine lock. */
  function adopt(ep, made) {
    S.session = made.session; S.ep = ep; S.cfg = made.cfg;
    S.inputName = made.session.inputNames[0]; S.outputName = made.session.outputNames[0];
    S.warmMs[ep] = made.ms;
    S.fps.reset();
    $("hud-ep").textContent = hudLabel();
    describeModel();
    describeEngine();
  }
  function hudLabel() { return EP_LABEL[S.ep] + " · " + S.cfg.inputSize[0] + " px"; }

  function describeEngine() {
    var threads = S.ep === "wasm"
      ? (window.crossOriginIsolated ? ", " + S.ort.env.wasm.numThreads + " threads" : ", 1 thread") : "";
    $("engine-about").textContent = "Engine: ONNX Runtime Web 1.30.0 on " + EP_LABEL[S.ep] + threads +
      (S.warmMs[S.ep] ? " (test frame " + Math.round(S.warmMs[S.ep]) + " ms)" : "") +
      (S.epTried.length ? ". Not used: " + S.epTried.join("; ") : "") + ".";
  }

  /** Engine changes take turns, and never overlap an inference. */
  var engineQueue = Promise.resolve();
  function lockEngine(fn) {
    var run = engineQueue.then(async function () {
      await new Promise(function (resolve) { (function poll() { if (!S.busy) resolve(); else setTimeout(poll, 20); })(); });
      S.locked = true;
      try { return await fn(); } finally { S.locked = false; }
    });
    engineQueue = run.catch(function () { /* the caller sees it */ });
    return run;
  }

  /**
   * "auto" starts on WebAssembly with the 416 px model, which works everywhere
   * and is ready soonest, then tries WebGPU with the 640 px model and keeps it
   * if it keeps up with the frame cap or beats WebAssembly. (The two run
   * different models, so "faster" alone would trade accuracy for nothing.)
   * A named engine is used if it works, with WebAssembly as the fallback.
   */
  async function startEngine(pref) {
    var gen = ++S.engineGen;
    S.epTried = [];
    var first = pref === "auto" ? "wasm" : pref;
    // Not ready while a switch is in flight: the old engine's session is still
    // in S.session while the new engine's model downloads.
    S.starting = true;
    var ep = await lockEngine(async function () {
      placeholder("Starting " + EP_LABEL[first] + "…", false);
      try {
        adopt(first, await sessionFor(first, ENGINE_TIMEOUT_MS));
      } catch (e) {
        S.epTried.push(EP_LABEL[first] + ": " + msg(e));
        if (first === "wasm") throw new Error("no engine could run the model (" + S.epTried.join("; ") + ")");
        adopt("wasm", await sessionFor("wasm", ENGINE_TIMEOUT_MS));
      }
      placeholder(S.source ? null : "Choose Camera, Sample images, or a photo or video", false);
      return S.ep;
    }).finally(function () { if (gen === S.engineGen) S.starting = false; });
    if (pref === "auto") upgrade(gen);
    return ep;
  }

  async function upgrade(gen) {
    if (!(await epAvailable("webgpu"))) { S.epTried.push("WebGPU: not available in this browser"); describeEngine(); return; }
    try {
      await lockEngine(async function () {
        if (gen !== S.engineGen) return;
        $("hud-ep").textContent = "WASM, trying WebGPU";
        var made = await sessionFor("webgpu", UPGRADE_TIMEOUT_MS, true);
        if (gen !== S.engineGen) return;   // the person picked an engine meanwhile
        if (made.ms < Math.max(1000 / MAX_FPS, S.warmMs.wasm || 0)) {
          adopt("webgpu", made);
          say("Switched to WebGPU and the " + made.cfg.inputSize[0] + " px model: " + Math.round(made.ms) +
            " ms a frame (WebAssembly ran the " + S.sessions.wasm.cfg.inputSize[0] + " px model at " +
            Math.round(S.warmMs.wasm) + " ms).");
        } else {
          S.epTried.push("WebGPU: works, but slower here (" + Math.round(made.ms) + " ms a frame)");
        }
      });
    } catch (e) {
      S.epTried.push("WebGPU: " + msg(e));
    }
    $("hud-ep").textContent = hudLabel();
    describeEngine();
  }

  /* ── inference ──────────────────────────────────────────────────────── */
  async function infer(media, srcW, srcH) {
    var ort = S.ort, w = S.cfg.inputSize[0], h = S.cfg.inputSize[1];
    // Timed from the frame grab to the decoded boxes: the whole cost of a frame.
    var t0 = performance.now();
    if (srcCanvas.width !== srcW || srcCanvas.height !== srcH) { srcCanvas.width = srcW; srcCanvas.height = srcH; }
    srcCtx.drawImage(media, 0, 0, srcW, srcH);
    var px = srcCtx.getImageData(0, 0, srcW, srcH).data;
    var input = new ort.Tensor("float32", Core.letterboxTensor(px, srcW, srcH, w, h), [1, 3, h, w]);
    var feeds = {}; feeds[S.inputName] = input;
    var out = await S.session.run(feeds);
    var o = out[S.outputName];
    var dets = Core.decode(o.data, o.dims[1], o.dims[2], S.cfg.classes, srcW, srcH, w, h,
      S.cfg.minConfidence, S.cfg.iouThreshold);
    var ms = performance.now() - t0;
    if (o.dispose) o.dispose();
    return { dets: dets, ms: ms };
  }

  function mediaSize(media) {
    return media.tagName === "VIDEO"
      ? { w: media.videoWidth, h: media.videoHeight }
      : { w: media.naturalWidth, h: media.naturalHeight };
  }

  /** Size the stage to the source's aspect ratio, inside the viewer's width and 62% of the screen height. */
  function layoutStage(w, h) {
    if (!w || !h) return;
    var stage = $("stage"), availW = $("viewer").clientWidth || 358;
    var maxH = Math.max(220, Math.round(window.innerHeight * 0.62));
    var scale = Math.min(availW / w, maxH / h);
    stage.style.aspectRatio = "auto";
    stage.style.width = Math.round(w * scale) + "px";
    stage.style.height = Math.round(h * scale) + "px";
  }

  var SEV_COLOR = { 1: "#c8f031", 2: "#c8f031", 3: "#ffb454", 4: "#ff5a66", 5: "#ff5a66" };

  /** Boxes, labels and confidences, drawn at the source's resolution scale onto `ctx`. */
  /**
   * Boxes first, then labels, so no box is drawn over a label. Labels are
   * placed above their box, else below it, else inside it - whichever spot
   * does not cover a label already placed - so two close predictions stay
   * readable.
   */
  function drawBoxes(ctx, dets, sx, sy, unit) {
    var W = ctx.canvas.width, H = ctx.canvas.height, placed = [];
    ctx.lineWidth = Math.max(2, 2.5 * unit);
    ctx.font = "600 " + Math.round(12.5 * unit) + "px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    var boxes = dets.map(function (d) {
      return {
        d: d, x: d.box[0] * sx, y: d.box[1] * sy, w: (d.box[2] - d.box[0]) * sx, h: (d.box[3] - d.box[1]) * sy,
        color: d.ingestable ? SEV_COLOR[d.severity] : "#b6bbad",
      };
    });
    boxes.forEach(function (b) {
      ctx.strokeStyle = b.color;
      ctx.setLineDash(b.d.ingestable ? [] : [6 * unit, 4 * unit]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    });
    ctx.setLineDash([]);
    function hits(r) {
      return placed.some(function (p) { return r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h; });
    }
    boxes.forEach(function (b) {
      var d = b.d;
      var label = d.type.replace("_", " ") + " " + Math.round(d.confidence * 100) + "% · sev " + d.severity;
      var tw = ctx.measureText(label).width + 10 * unit, th = 18 * unit;
      var lx = Math.min(Math.max(0, b.x), W - tw);
      var spots = [b.y - th, b.y + b.h, b.y].filter(function (y) { return y >= 0 && y + th <= H; });
      var ly = spots[0] != null ? spots[0] : Math.max(0, Math.min(b.y, H - th));
      for (var i = 0; i < spots.length; i++) {
        if (!hits({ x: lx, y: spots[i], w: tw, h: th })) { ly = spots[i]; break; }
      }
      placed.push({ x: lx, y: ly, w: tw, h: th });
      ctx.fillStyle = b.color;
      ctx.fillRect(lx, ly, tw, th);
      ctx.fillStyle = "#10130a";
      ctx.fillText(label, lx + 5 * unit, ly + 3 * unit);
    });
  }

  function drawOverlay() {
    var c = $("overlay"), stage = $("stage");
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.round(stage.clientWidth * dpr), ch = Math.round(stage.clientHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    if (!S.frameW) return;
    drawBoxes(ctx, S.dets, cw / S.frameW, ch / S.frameH, dpr);
  }

  function renderList() {
    var ul = $("det-list");
    var sig = S.frameW + ":" + S.dets.map(function (d) { return d.type + d.severity + Math.round(d.confidence * 20); }).join("|");
    if (sig === S.lastCountSig && ul.children.length) return;   // no DOM churn on an unchanged frame
    S.lastCountSig = sig;
    if (!S.dets.length) {
      ul.innerHTML = "";
      var li = document.createElement("li"); li.className = "empty";
      li.textContent = !S.source ? "Choose something to scan." : !S.frameW ? "Scanning…"
        : "Nothing detected above the confidence threshold.";
      ul.appendChild(li);
    } else {
      ul.innerHTML = "";
      S.dets.forEach(function (d) {
        var li = document.createElement("li");
        var grow = document.createElement("span"); grow.className = "grow";
        var b = document.createElement("b"); b.textContent = d.type.replace("_", " ");
        var small = document.createElement("small");
        small.textContent = "Model prediction · " + Math.round(d.confidence * 100) + "% confidence · covers " +
          (d.boxFraction * 100).toFixed(1) + "% of the frame" +
          (d.ingestable ? "" : " · not reportable: " + Core.notReportableReason(d.type));
        grow.appendChild(b); grow.appendChild(small);
        var sev = document.createElement("span");
        sev.className = "sev sev-" + d.severity;
        sev.textContent = "sev " + d.severity + "/5";
        li.appendChild(grow); li.appendChild(sev);
        ul.appendChild(li);
      });
    }
    $("r-open").disabled = !S.frameW;
  }

  /** Spoken summary: at once for a still, at most every 5 s for a live feed. */
  function announce(live) {
    var now = Date.now();
    if (live && now - S.lastAnnounce < 5000) return;
    S.lastAnnounce = now;
    if (!S.dets.length) { if (!live) say("No hazards detected in this image."); return; }
    var counts = {};
    S.dets.forEach(function (d) { counts[d.type] = (counts[d.type] || 0) + 1; });
    say("Model sees " + Object.keys(counts).map(function (k) {
      return counts[k] + " " + k.replace("_", " ");
    }).join(", ") + (live ? " in the live view." : " in this image."));
  }

  function updateHud() {
    var now = performance.now(), fps = S.fps.fps(now);
    $("hud-fps").textContent = (S.source === "camera" || S.source === "video")
      ? (fps ? fps.toFixed(1) : "—") + " fps" : Math.round(S.lastMs) + " ms";
    $("engine-stats").textContent = EP_LABEL[S.ep] + " · " + Math.round(S.lastMs) + " ms/frame" +
      (fps ? " · " + fps.toFixed(1) + " fps" : "");
    if (fps) S.fpsByEp[S.ep] = Number(fps.toFixed(2));
  }

  /** One detection pass over a still (sample or photo). */
  async function detectStill(img) {
    var gen = ++S.gen;
    await waitIdle();
    if (gen !== S.gen) return;
    var size = mediaSize(img);
    S.busy = true;
    try {
      var r = await infer(img, size.w, size.h);
      if (gen !== S.gen) return;
      S.dets = r.dets; S.frameW = size.w; S.frameH = size.h; S.lastMs = r.ms;
      drawOverlay(); renderList(); updateHud(); announce(false);
    } finally { S.busy = false; }
  }

  function waitIdle() {
    return new Promise(function (resolve) {
      (function poll() { if (!S.busy && !S.locked) resolve(); else setTimeout(poll, 20); })();
    });
  }

  /** The live loop: one inference at a time, never faster than MAX_FPS, paused while hidden. */
  function scheduleLoop(delay) {
    clearTimeout(S.timer);
    S.timer = setTimeout(loop, delay);
  }
  async function loop() {
    if (!S.running || !S.session) return;
    var v = $("video");
    if (S.locked || document.hidden || v.readyState < 2 || !v.videoWidth) { scheduleLoop(200); return; }
    var gen = S.gen, t0 = performance.now();
    S.busy = true;
    try {
      var r = await infer(v, v.videoWidth, v.videoHeight);
      if (gen !== S.gen || !S.running) return;
      S.dets = r.dets; S.frameW = v.videoWidth; S.frameH = v.videoHeight; S.lastMs = r.ms;
      S.fps.tick(performance.now());
      drawOverlay(); renderList(); updateHud(); announce(true);
    } catch (e) {
      S.running = false;
      say("Detection stopped: " + (e && e.message || e), true);
      return;
    } finally { S.busy = false; }
    scheduleLoop(Core.nextDelay(performance.now() - t0, MAX_FPS));
  }

  /* ── sources ────────────────────────────────────────────────────────── */
  function pressSource(which) {
    ["camera", "sample", "upload"].forEach(function (k) {
      $("src-" + k).setAttribute("aria-pressed", String(k === which));
    });
    $("camera-row").hidden = which !== "camera";
    $("sample-row").hidden = which !== "sample";
  }

  function stopAll() {
    S.gen++;
    S.running = false;
    clearTimeout(S.timer);
    if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; }
    var v = $("video");
    v.pause(); v.removeAttribute("src"); v.srcObject = null; v.hidden = true;
    if (S.objectUrl) { URL.revokeObjectURL(S.objectUrl); S.objectUrl = null; }
    $("still").hidden = true;
    S.dets = []; S.frameW = 0; S.frameH = 0;
    S.fps.reset();
    drawOverlay();
    renderList();   // a list (and a Report button) from the last source must not outlive it
  }

  function cameraError(e) {
    var name = e && e.name;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "This browser offers no camera here. The camera needs https (or localhost). Use Sample images or Photo or video instead.";
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera permission was refused. Allow it in the browser's site settings, or use Sample images or Photo or video.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No camera was found on this device. Use Sample images or Photo or video instead.";
    }
    if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
    return "The camera could not start (" + (e && e.message || name || "unknown error") + ").";
  }

  async function startCamera() {
    stopAll();
    S.source = "camera"; pressSource("camera");
    $("cam-toggle").textContent = "Stop camera";
    $("source-caption").textContent = "Rear camera, if this device has one.";
    placeholder("Starting the camera…", false);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no getUserMedia");
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (S.source !== "camera") { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      S.stream = stream;
      var v = $("video");
      v.srcObject = stream; v.hidden = false;
      await v.play();
      await new Promise(function (r) { if (v.videoWidth) r(); else v.addEventListener("loadedmetadata", r, { once: true }); });
      layoutStage(v.videoWidth, v.videoHeight);
      placeholder(null);
      S.running = true;
      say("Camera on. Scanning with " + EP_LABEL[S.ep] + ".");
      loop();
    } catch (e) {
      placeholder("Camera unavailable", false);
      say(cameraError(e), true);
      $("cam-toggle").textContent = "Try camera again";
    }
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = $("still");
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("could not read that image")); };
      img.src = src;
    });
  }

  async function showSample(i) {
    stopAll();
    S.source = "sample"; pressSource("sample");
    S.sampleIndex = (i + SAMPLES.length) % SAMPLES.length;
    var s = SAMPLES[S.sampleIndex];
    $("source-caption").textContent = (S.sampleIndex + 1) + " of " + SAMPLES.length + " · " + s.caption;
    try {
      var img = await loadImage(SAMPLE_DIR + s.file);
      img.alt = "Sample road photo: " + s.caption;
      img.hidden = false;
      layoutStage(img.naturalWidth, img.naturalHeight);
      placeholder(null);
      await detectStill(img);
    } catch (e) { say("The sample image could not be scanned: " + (e && e.message || e), true); }
  }

  async function openFile(file) {
    stopAll();
    S.source = file.type.indexOf("video/") === 0 ? "video" : "upload";
    pressSource("upload");
    $("source-caption").textContent = file.name;
    S.objectUrl = URL.createObjectURL(file);
    try {
      if (S.source === "video") {
        var v = $("video");
        v.srcObject = null; v.src = S.objectUrl; v.loop = true; v.hidden = false;
        await new Promise(function (resolve, reject) {
          v.addEventListener("loadedmetadata", resolve, { once: true });
          v.addEventListener("error", function () { reject(new Error("this browser cannot play that video")); }, { once: true });
        });
        await v.play();
        layoutStage(v.videoWidth, v.videoHeight);
        placeholder(null);
        S.running = true;
        loop();
      } else {
        var img = await loadImage(S.objectUrl);
        img.alt = "Your photo: " + file.name;
        img.hidden = false;
        layoutStage(img.naturalWidth, img.naturalHeight);
        placeholder(null);
        await detectStill(img);
      }
    } catch (e) {
      placeholder("That file could not be opened", false);
      say("That file could not be scanned: " + (e && e.message || e), true);
    }
  }

  /* ── reporting ──────────────────────────────────────────────────────── */
  var R = { snap: null, pos: null, posError: null };

  function signedIn() {
    var s = sess && sess.load();
    return s && (s.token || s.refresh) ? s : null;
  }
  function renderSignin() {
    var s = signedIn(), el = $("r-signin");
    el.textContent = "";
    if (s) { el.textContent = "Reports go to RAKSHA from your RoadAssist account."; return; }
    el.appendChild(document.createTextNode("Sending a report needs your RoadAssist sign-in. "));
    var a = document.createElement("a");
    a.href = "app.html"; a.textContent = "Sign in on the app"; a.style.textDecoration = "underline";
    el.appendChild(a);
    el.appendChild(document.createTextNode(", then come back. Scanning works without it."));
  }

  /** The current frame at up to 1280 px with the model's boxes burned in, as a JPEG blob. */
  function snapshot() {
    var media = S.source === "camera" || S.source === "video" ? $("video") : $("still");
    var w = S.frameW, h = S.frameH, scale = Math.min(1, 1280 / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    var ctx = c.getContext("2d");
    ctx.drawImage(media, 0, 0, c.width, c.height);
    drawBoxes(ctx, S.dets, scale, scale, Math.max(1, c.width / 480));
    return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", 0.85); });
  }

  function locate() {
    R.pos = null; R.posError = null;
    $("r-locate").hidden = true;
    $("r-location").textContent = "Location: asking this device…";
    if (!navigator.geolocation) {
      R.posError = "unsupported";
      $("r-location").textContent = "Location: this browser cannot share a position, so the report cannot be sent - " +
        "the report service places every hazard at the phone's position and requires one.";
      return refreshSend();
    }
    navigator.geolocation.getCurrentPosition(function (p) {
      R.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      $("r-location").textContent = "Location: " + R.pos.lat.toFixed(5) + ", " + R.pos.lng.toFixed(5) +
        (isFinite(R.pos.accuracy) ? " (±" + Math.round(R.pos.accuracy) + " m, from this device)" : "");
      refreshSend();
    }, function (e) {
      R.posError = e && e.code === 1 ? "denied" : "unavailable";
      $("r-location").textContent = R.posError === "denied"
        ? "Location: not allowed. The report service places a hazard where your phone is and requires that position, so this report cannot be sent until you allow location for this site."
        : "Location: no GPS fix yet. Step outside or wait a moment, then try again.";
      $("r-locate").hidden = false;
      refreshSend();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  function refreshSend() {
    var snap = R.snap;
    // Once the server has it, the same frame cannot be filed twice.
    $("r-send").disabled = !(snap && snap.pick && R.pos && !snap.sent);
    $("r-send").textContent = snap && snap.sent ? "Sent" : "Send report";
  }

  async function openReport() {
    if (!S.frameW) return;
    var dets = S.dets.map(function (d) { return Object.assign({}, d); });
    var pick = Core.pickReport(dets);
    var blob = await snapshot();
    // The model that produced these boxes, held with them: the engine (and so
    // the model) may change before the report is sent.
    R.snap = { blob: blob, dets: dets, pick: pick, modelVersion: S.cfg.modelVersion,
               note: Core.reportNote(dets, S.cfg.modelVersion) };
    S.pending = null;   // a new report replaces one that was never sent
    var thumb = $("r-thumb");
    if (thumb.dataset.url) URL.revokeObjectURL(thumb.dataset.url);
    thumb.dataset.url = URL.createObjectURL(blob);
    thumb.src = thumb.dataset.url;
    $("r-summary").textContent = pick
      ? "Will be filed as " + pick.type.replace("_", " ") + ", severity " + pick.severity +
        " (the most severe reportable prediction, " + Math.round(pick.confidence * 100) + "% confidence). " +
        "The photo and every prediction in this frame go with it."
      : "Nothing reportable in this frame: the model found no pothole or road damage above its threshold" +
        (dets.length ? " (what it did find is not a type RAKSHA takes; see the reason beside each)" : "") + ". " +
        "To report a hazard it missed, use Report hazard in the app.";
    $("r-note").textContent = R.snap.note;
    $("r-result").textContent = ""; $("r-result").className = "r-result";
    $("r-panel").hidden = false;
    $("r-panel").focus();
    refreshSend();
    if (pick) locate(); else $("r-location").textContent = "";
  }

  function closeReport() {
    $("r-panel").hidden = true;
    R.snap = null;
    $("r-open").focus();
  }

  function result(text, kind) {
    var el = $("r-result");
    el.textContent = text;
    el.className = "r-result" + (kind ? " " + kind : "");
    say(text, kind === "bad");
  }

  async function authedPost(path, body) {
    var s = signedIn();
    if (!s) { var e0 = new Error("signin"); e0.signin = true; throw e0; }
    var token = s.token;
    async function send() {
      return fetch(API + path, {
        method: "POST", credentials: "include",
        headers: Object.assign({ "content-type": "application/json" }, sess.headers,
          token ? { authorization: "Bearer " + token } : {}),
        body: JSON.stringify(body),
      });
    }
    var res;
    try {
      // A ten-minute access token is routinely stale on arrival; refresh first.
      if (!token) token = await sess.refresh(s.refresh);
      res = await send();
      if (res.status === 401) {
        token = await sess.refresh(s.refresh);
        if (!token) { var e1 = new Error("signin"); e1.signin = true; throw e1; }
        res = await send();
      }
    } catch (e) {
      if (e.signin) throw e;
      var t = new Error("transport"); t.transport = true; throw t;
    }
    if (token && token !== s.token) {
      sess.save(token, { msisdn: s.msisdn, vehicleId: s.vehicleId, bookingId: s.bookingId }, true);
    }
    var json = await res.json().catch(function () { return {}; });
    return { status: res.status, ok: res.ok, json: json };
  }

  async function buildPayload() {
    var snap = R.snap, pick = snap.pick;
    var body = {
      type: pick.type, severity: pick.severity,
      lat: R.pos.lat, lng: R.pos.lng,
      accuracyM: isFinite(R.pos.accuracy) ? R.pos.accuracy : null,
      note: snap.note,
      // The reported detection's own confidence and the model that gave it,
      // stored on the RAKSHA row instead of a fixed 100% "citizen-report".
      confidence: pick.confidence, modelVersion: snap.modelVersion,
    };
    // Shrunk to the server's photo cap exactly as the app's own report is.
    var photo = await window.RAPhotoShrink.shrink(snap.blob);
    body.photoBase64 = photo.base64; body.photoMime = photo.mime;
    return body;
  }

  async function sendReport(auto) {
    var btn = $("r-send");
    if (!S.pending) {
      if (!R.snap || !R.snap.pick || !R.pos) return;
      S.pending = { body: await buildPayload() };
    }
    btn.classList.add("is-busy"); btn.disabled = true;
    try {
      if (!navigator.onLine) { var off = new Error("transport"); off.transport = true; throw off; }
      var r = await authedPost("/v1/raksha/report", S.pending.body);
      if (r.ok && r.json && r.json.data) {
        var d = r.json.data, meta = r.json.meta || {};
        S.pending = null;
        if (R.snap) R.snap.sent = true;
        result("Sent. The server answered: " + (meta.note || "accepted") + " Report " + String(d.id).slice(0, 8) +
          ", status " + d.status + (d.hasPhoto ? ", photo attached" : "") +
          ". No authority has verified it yet.", "ok");
        window.__scan.lastReport = { status: r.status, data: d, meta: meta };
        return;
      }
      var err = (r.json && r.json.error) || {};
      S.pending = null;
      result("Not sent: the server refused it (" + (err.title || "HTTP " + r.status) + ").", "bad");
      window.__scan.lastReport = { status: r.status, error: err };
    } catch (e) {
      if (e.signin) {
        S.pending = null;
        result("Not sent: you are not signed in, or your sign-in has ended. Sign in on the app, then try again.", "bad");
        renderSignin();
      } else {
        result("Not sent: no connection reached the server. Nothing was queued: it is not in the app's offline " +
          "queue. This page holds it and sends it when the connection returns, but only while the page stays open." +
          (auto ? " (Retried automatically and still offline.)" : ""), "bad");
        window.__scan.lastReport = { status: 0, held: true };
      }
    } finally {
      btn.classList.remove("is-busy");
      refreshSend();
    }
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  $("src-camera").addEventListener("click", function () { if (S.session) startCamera(); });
  $("src-sample").addEventListener("click", function () { if (S.session) showSample(S.sampleIndex); });
  $("src-upload").addEventListener("click", function () { $("upload").click(); });
  $("upload").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (f && S.session) openFile(f);
    this.value = "";
  });
  $("sample-prev").addEventListener("click", function () { showSample(S.sampleIndex - 1); });
  $("sample-next").addEventListener("click", function () { showSample(S.sampleIndex + 1); });
  $("cam-toggle").addEventListener("click", function () {
    if (S.running && S.source === "camera") {
      stopAll(); S.source = null;
      $("cam-toggle").textContent = "Start camera";
      placeholder("Camera off", false);
      say("Camera off.");
      renderList();
    } else { startCamera(); }
  });
  $("ep").addEventListener("change", async function () {
    var wasLive = S.running, src = S.source;
    stopAll();
    try {
      var ep = await startEngine(this.value);
      say("Engine: " + EP_LABEL[ep] + (this.value !== "auto" && this.value !== ep ? " (" + EP_LABEL[this.value] + " could not run the model)" : "") + ".");
    } catch (e) { say(String(e.message || e), true); return; }
    if (src === "camera" && wasLive) startCamera();
    else if (src === "sample") showSample(S.sampleIndex);
    else placeholder("Choose something to scan", false);
  });
  $("r-open").addEventListener("click", openReport);
  $("r-cancel").addEventListener("click", closeReport);
  $("r-send").addEventListener("click", function () { sendReport(false); });
  $("r-locate").addEventListener("click", locate);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && S.running) scheduleLoop(0);
  });
  window.addEventListener("resize", function () {
    if (S.frameW) { layoutStage(S.frameW, S.frameH); drawOverlay(); }
  });

  /* ── hooks for scripts/scan-check.mjs (and a curious developer) ──────── */
  window.__scan = {
    state: S,
    ready: function () { return Boolean(S.session) && !S.starting; },
    /** Run the model on an image URL; returns detections in source pixels. */
    detectUrl: async function (url) {
      var img = new Image();
      await new Promise(function (r, j) { img.onload = r; img.onerror = j; img.src = url; });
      await waitIdle();
      S.busy = true;
      try { return (await infer(img, img.naturalWidth, img.naturalHeight)).dets; } finally { S.busy = false; }
    },
    useEngine: function (ep) { var sel = $("ep"); sel.value = ep; sel.dispatchEvent(new Event("change")); },
    fps: function () { return S.fps.fps(performance.now()); },
    lastReport: null,
  };

  /* ── boot ───────────────────────────────────────────────────────────── */
  renderSignin();
  renderList();
  (async function boot() {
    var params = new URLSearchParams(location.search);
    var pref = params.get("ep");
    if (!EP_LABEL[pref]) pref = "auto";
    $("ep").value = pref;
    try {
      await startEngine(pref);
      say("Detector ready on " + EP_LABEL[S.ep] + ". Choose Camera, Sample images, or a photo or video.");
      var want = params.get("source");
      if (want === "sample") showSample(0);
      else if (want === "camera") startCamera();
      else placeholder("Choose Camera, Sample images, or a photo or video", false);
    } catch (e) {
      placeholder("The detector could not start", false);
      say("The detector could not start: " + (e && e.message || e) + ". Scanning is unavailable on this device.", true);
    }
  })();
})();
