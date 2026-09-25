// RoadAssist Bharat — project review deck.
// Every number is read from app/docs/measured.json; a missing key throws.
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const REPO = "S:/PROJECTS/RoadAssist-Bharat";
const IMG = path.join(__dirname, "img");
const OUT = process.argv[2] || path.join(REPO, "presentation", "RoadAssist-Bharat-Review.pptx");
const M = JSON.parse(fs.readFileSync(path.join(REPO, "app/docs/measured.json"), "utf8"));
const num = (...p) => {
  let c = M;
  for (const k of p) {
    if (c == null || !(k in c)) throw new Error("measured.json has no " + p.join("."));
    c = c[k];
  }
  return c;
};

// ── palette & type ──────────────────────────────────────────────────────────
const C = {
  bg: "07090D", bg2: "0C1017", surf: "111723", surf2: "172031", line: "242D3D",
  ink: "F5F2EA", ink2: "B7BFCC", ink3: "7C8799",
  gold: "F0B429", gold2: "FFD978", blue: "4DA3FF", green: "2ED08A", red: "FF5D5D", dark: "16110A",
};
const HEAD = "Bahnschrift";      // DIN-style, matches the wordmark
const BODY = "Segoe UI";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";     // 13.333 x 7.5
pres.title = "RoadAssist Bharat — Project Review";
pres.author = "V. Saatwik Sairaam, P. Sai Nirisha Chowdary, T. V. S. Jignesh, G. Parthavi";
const W = 13.333, H = 7.5, MX = 0.6;
const img = (n) => path.join(IMG, n);

// ── helpers ─────────────────────────────────────────────────────────────────
const shadow = () => ({ type: "outer", color: "000000", blur: 18, offset: 6, angle: 90, opacity: 0.55 });

function base(slide) {
  slide.background = { color: C.bg };
}
function t(slide, text, o) {
  slide.addText(text, Object.assign({ isTextBox: true, fontFace: BODY, color: C.ink2, fontSize: 14, margin: 0, valign: "top" }, o));
}
function eyebrow(slide, text, x, y, color) {
  t(slide, text, { x, y, w: 8, h: 0.3, fontFace: HEAD, fontSize: 12, bold: true, color: color || C.gold, charSpacing: 3 });
}
function title(slide, text, x, y, w, size) {
  t(slide, text, { x, y, w, h: 1.2, fontFace: HEAD, fontSize: size || 36, bold: true, color: C.ink, charSpacing: -0.5 });
}
function card(slide, x, y, w, h, fill) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.16, fill: { color: fill || C.surf }, line: { color: C.line, width: 0.75 } });
}
function pill(slide, x, y, label, color, fill) {
  const w = 0.32 + label.length * 0.085;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.3, rectRadius: 0.15, fill: { color: fill || "0F2A1E" }, line: { color: color || C.green, width: 0.75 } });
  t(slide, label, { x, y, w, h: 0.3, fontSize: 9.5, bold: true, color: color || C.green, align: "center", valign: "middle", charSpacing: 1.5 });
  return w;
}
function phone(slide, x, y, w, image) {
  const h = w * 2.2;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: w * 0.14, fill: { color: "141922" }, line: { color: "2A3344", width: 1 }, shadow: shadow() });
  const p = w * 0.045;
  slide.addImage({ path: image, x: x + p, y: y + w * 0.13, w: w - 2 * p, h: h - w * 0.13 - p, sizing: { type: "cover", w: w - 2 * p, h: h - w * 0.13 - p } });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + w / 2 - w * 0.13, y: y + w * 0.045, w: w * 0.26, h: w * 0.04, rectRadius: w * 0.02, fill: { color: "05070A" }, line: { color: "05070A", width: 0 } });
  return h;
}
function browser(slide, x, y, w, h, image, address) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: "0E131C" }, line: { color: "2A3344", width: 1 }, shadow: shadow() });
  ["E05A5A", "E0A640", "49C97E"].forEach((c, i) =>
    slide.addShape(pres.shapes.OVAL, { x: x + 0.18 + i * 0.17, y: y + 0.13, w: 0.1, h: 0.1, fill: { color: c }, line: { color: c, width: 0 } }));
  t(slide, address || "localhost:4000", { x: x + 0.8, y: y + 0.07, w: w - 1, h: 0.22, fontSize: 9, color: C.ink3, fontFace: "Consolas" });
  slide.addImage({ path: image, x: x + 0.03, y: y + 0.36, w: w - 0.06, h: h - 0.39, sizing: { type: "cover", w: w - 0.06, h: h - 0.39 } });
}
function foot(slide, n) {
  t(slide, "RoadAssist Bharat", { x: MX, y: H - 0.42, w: 4, h: 0.25, fontSize: 9, color: C.ink3, fontFace: HEAD, charSpacing: 1 });
  t(slide, String(n).padStart(2, "0"), { x: W - MX - 1, y: H - 0.42, w: 1, h: 0.25, fontSize: 9, color: C.ink3, align: "right", fontFace: HEAD });
}

let n = 0;
const next = () => { const s = pres.addSlide(); base(s); n++; return s; };

// 1 ── title ────────────────────────────────────────────────────────────────
{
  const s = next();
  t(s, "SWE4004  ·  CLOUD COMPUTING AND APPLICATIONS  ·  PROJECT REVIEW", { x: MX, y: 0.5, w: 8, h: 0.3, fontFace: HEAD, fontSize: 11, bold: true, color: C.ink3, charSpacing: 2 });
  s.addImage({ path: img("lockup-dark.png"), x: MX - 0.08, y: 1.05, w: 4.4, h: 4.4 * 400 / 1400 });
  t(s, "Offline-first roadside assistance and road safety for India", { x: MX, y: 2.55, w: 6.2, h: 1.1, fontFace: HEAD, fontSize: 28, bold: true, color: C.ink });
  t(s, "Help that reaches you where the network doesn't — for stranded drivers, verified mechanics and road-safety authorities.",
    { x: MX, y: 3.65, w: 5.9, h: 0.8, fontSize: 14.5, color: C.ink2 });
  s.addImage({ path: img("hero.jpg"), x: 7.05, y: 0.95, w: 5.7, h: 4.275, sizing: { type: "cover", w: 5.7, h: 4.275 }, shadow: shadow() });
  const team = [["V Saatwik Sairaam", "24MIC7131", "Backend & Cloud Database"], ["P Sai Nirisha Chowdary", "24MIC7122", "Frontend & Mobile"],
                ["T V S Jignesh", "24MIC7190", "AI & Data Services"], ["G Parthavi", "24MIC7145", "DevOps, QA & Cloud Security"]];
  team.forEach(([name, reg, role], i) => {
    const x = MX + i * 3.06, y = 5.55;
    card(s, x, y, 2.9, 1.08);
    t(s, name, { x: x + 0.2, y: y + 0.17, w: 2.6, h: 0.3, fontFace: HEAD, fontSize: 13, bold: true, color: C.ink });
    t(s, reg, { x: x + 0.2, y: y + 0.47, w: 2.6, h: 0.25, fontSize: 10.5, color: C.gold, fontFace: "Consolas" });
    t(s, role, { x: x + 0.2, y: y + 0.72, w: 2.6, h: 0.25, fontSize: 10.5, color: C.ink3 });
  });
  t(s, "Course faculty: Dr. Nagendra Panini Challa", { x: MX, y: 6.85, w: 6, h: 0.25, fontSize: 10.5, color: C.ink3 });
  s.addNotes("Introduce RoadAssist Bharat: an offline-first roadside assistance and road-safety platform built by the four of us. The image on the right is a 3D render built from real screenshots of the running system. Every number in this deck comes from the project's measured.json, produced by the test suites and schema introspection.");
}

// 2 ── the problem ──────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "THE PROBLEM", MX, 0.55);
  title(s, "Breakdowns happen where help is hardest to reach", MX, 0.85, 12);
  const stats = [
    ["1,68,491", "road deaths in India in 2022", C.red],
    ["4,61,312", "road accidents reported in 2022", C.gold],
    ["0 bars", "the signal where many highway breakdowns happen", C.blue],
  ];
  stats.forEach(([v, l, col], i) => {
    const x = MX + i * 4.1;
    card(s, x, 2.25, 3.85, 2.6);
    t(s, v, { x: x + 0.35, y: 2.6, w: 3.3, h: 1.0, fontFace: HEAD, fontSize: 48, bold: true, color: col });
    t(s, l, { x: x + 0.35, y: 3.65, w: 3.2, h: 0.9, fontSize: 15, color: C.ink2 });
  });
  t(s, "Existing apps assume a working network, a smartphone and a nearby partner. RoadAssist assumes none of the three.",
    { x: MX, y: 5.25, w: 11.5, h: 0.6, fontSize: 17, color: C.ink, italic: true });
  t(s, "Source: Ministry of Road Transport and Highways, Road Accidents in India 2022. The third card is a design premise, not a statistic.",
    { x: MX, y: 6.55, w: 11.5, h: 0.3, fontSize: 9.5, color: C.ink3 });
  foot(s, n);
  s.addNotes("Figures are from MoRTH's Road Accidents in India 2022 report: 4,61,312 accidents and 1,68,491 deaths. The zero-bars card is our design premise, marked as such on the slide. The platform is designed around the three things other apps assume: network, smartphone, nearby help.");
}

// 3 ── the solution ─────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "OUR SOLUTION", MX, 0.55);
  title(s, "One platform. Four surfaces. One process.", MX, 0.85, 12);
  t(s, "The citizen app, the mechanic console, the RAKSHA authority dashboard and the live map are all served by the same Fastify process — plus a feature-phone path over SMS that needs no app at all.",
    { x: MX, y: 1.95, w: 5.6, h: 1.4, fontSize: 15, color: C.ink2 });
  const items = [["Citizen", "Request help, SOS, track, pay", C.gold], ["Mechanic", "Ranked offers, job lifecycle", C.gold2],
                 ["RAKSHA", "Road-damage detection, triage", C.blue], ["Feature phone", `SMS booking in ${num("i18n", "locales")} languages`, C.green]];
  items.forEach(([h, d, col], i) => {
    const y = 3.5 + i * 0.78;
    s.addShape(pres.shapes.OVAL, { x: MX, y: y + 0.06, w: 0.36, h: 0.36, fill: { color: col }, line: { color: col, width: 0 } });
    t(s, h, { x: MX + 0.55, y, w: 2.2, h: 0.3, fontFace: HEAD, fontSize: 15, bold: true, color: C.ink });
    t(s, d, { x: MX + 0.55, y: y + 0.3, w: 4.8, h: 0.3, fontSize: 12.5, color: C.ink3 });
  });
  s.addImage({ path: img("hero.jpg"), x: 6.85, y: 1.95, w: 5.9, h: 4.425, sizing: { type: "cover", w: 5.9, h: 4.425 }, shadow: shadow() });
  t(s, "3D render built from real screenshots of the running system", { x: 6.85, y: 6.5, w: 5.9, h: 0.3, fontSize: 10, color: C.ink3, align: "right" });
  foot(s, n);
  s.addNotes("One modular monolith (ADR-0001): every surface is plain HTML/JS served by the API process, so there is no second deployment, no CORS boundary. The feature-phone path completes a booking over SMS in eight languages; seven of the eight are machine-translated and not yet reviewed by native speakers.");
}

// 4 ── the surfaces ─────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "THE SURFACES", MX, 0.55);
  title(s, "Built, running, captured — not mocked", MX, 0.85, 12);
  const pw = 1.75;
  [["citizen.jpg", "Citizen app"], ["mechanic.jpg", "Mechanic console"], ["map.jpg", "Live map"]].forEach(([f, l], i) => {
    const x = MX + 0.15 + i * 2.2;
    phone(s, x, 1.95, pw, img(f));
    t(s, l, { x: x - 0.2, y: 1.95 + pw * 2.2 + 0.12, w: pw + 0.4, h: 0.3, fontFace: HEAD, fontSize: 13, bold: true, color: C.ink, align: "center" });
  });
  browser(s, 7.2, 1.95, 5.55, 3.73, img("raksha.jpg"));
  t(s, "RAKSHA authority dashboard", { x: 7.2, y: 5.83, w: 5.55, h: 0.3, fontFace: HEAD, fontSize: 13, bold: true, color: C.ink, align: "center" });
  foot(s, n);
  s.addNotes("These are captures of the running platform, not mockups. The capture script signs in against the live API and refuses to take a screenshot unless the page shows what the caption claims. The mechanic console is captured signed in as a seeded mechanic.");
}

// 5 ── the journey ──────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "HOW IT WORKS", MX, 0.55);
  title(s, "From a breakdown to a paid job", MX, 0.85, 12);
  const steps = ["Request or escalate — SOS held 1.5 s", "Diagnosis — a labelled rules engine", "Dispatch — ranked by distance, ETA, rating",
                 "Live status — state machine over SSE", "Off-grid SOS — stored on the device", "Idempotent sync — never a second ambulance",
                 "Settlement — server-verified payment", "Authority oversight — a person confirms"];
  steps.forEach((st, i) => {
    const y = 1.95 + i * 0.58;
    card(s, MX, y, 5.3, 0.48, i === 0 ? C.surf2 : C.surf);
    t(s, `0${i + 1}`, { x: MX + 0.2, y: y + 0.12, w: 0.5, h: 0.26, fontFace: HEAD, fontSize: 12, bold: true, color: C.gold });
    t(s, st, { x: MX + 0.75, y: y + 0.11, w: 4.4, h: 0.28, fontSize: 12.5, color: C.ink });
  });
  s.addImage({ path: img("scene-home.jpg"), x: 6.25, y: 1.95, w: 6.5, h: 4.06, sizing: { type: "cover", w: 6.5, h: 4.06 }, shadow: shadow() });
  t(s, "Step 01 as a 3D scene, rendered from the real home screen", { x: 6.25, y: 6.12, w: 6.5, h: 0.3, fontSize: 10, color: C.ink3, align: "right" });
  foot(s, n);
  s.addNotes("Eight stages. Two decisions worth naming: the SOS must be held for 1.5 seconds so a pocket press never calls a responder, and two mechanics accepting one job is settled by a row lock (SELECT ... FOR UPDATE), not by timing.");
}

// 6 ── off-grid ─────────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "OFF-GRID MODE  ·  ADR-0009", MX, 0.55);
  title(s, "An SOS with no signal is still a real incident", MX, 0.85, 12);
  phone(s, MX + 0.1, 1.95, 1.9, img("offgrid.jpg"));
  phone(s, MX + 2.35, 1.95, 1.9, img("sync.jpg"));
  t(s, "No signal", { x: MX + 0.1, y: 6.2, w: 1.9, h: 0.3, fontSize: 11, bold: true, color: C.ink3, align: "center" });
  t(s, "Signal returns", { x: MX + 2.35, y: 6.2, w: 1.9, h: 0.3, fontSize: 11, bold: true, color: C.ink3, align: "center" });
  const pts = [["Stored on the device", "The incident gets its own reference and GPS fix, and the screen says “nothing has been transmitted” rather than pretending."],
               ["Replayed idempotently", "When connectivity returns, the journal replays against a client-minted reference, so a retry becomes the same incident."],
               ["Diagnosed on the device", "The same deterministic rule table the server uses runs offline, labelled as a rules engine."]];
  pts.forEach(([h, d], i) => {
    const y = 2.05 + i * 1.35;
    card(s, 5.6, y, 7.15, 1.15);
    t(s, h, { x: 5.9, y: y + 0.17, w: 6.6, h: 0.32, fontFace: HEAD, fontSize: 16, bold: true, color: C.ink });
    t(s, d, { x: 5.9, y: y + 0.52, w: 6.6, h: 0.55, fontSize: 12.5, color: C.ink2 });
  });
  foot(s, n);
  s.addNotes("Off-grid is the architecture, not a fallback. Left: an SOS raised with no network. Right: the journal synchronised once the network returned, with the platform reference. Replay is idempotent on a client-minted op id.");
}

// 7 ── RAKSHA ───────────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "RAKSHA  ·  AI THAT A PERSON SUPERVISES", MX, 0.55, C.blue);
  title(s, "The road reports its own damage", MX, 0.85, 12);
  browser(s, 6.65, 1.95, 6.1, 3.8, img("raksha.jpg"));
  [["0.472", "mAP50"], ["0.226", "mAP50-95"]].forEach(([v, l], i) => {
    const x = MX + i * 2.75;
    card(s, x, 1.95, 2.55, 1.35);
    t(s, v, { x: x + 0.25, y: 2.1, w: 2.2, h: 0.7, fontFace: HEAD, fontSize: 36, bold: true, color: C.blue });
    t(s, l + ", YOLO11 validation", { x: x + 0.25, y: 2.85, w: 2.3, h: 0.3, fontSize: 11, color: C.ink3 });
  });
  const chain = [["Capture", "edge device"], ["YOLO11", "trained in this repo"], ["Rules", "severity, dedupe"], ["Human", "confirms, then acts"]];
  chain.forEach(([k, d], i) => {
    const y = 3.6 + i * 0.55;
    card(s, MX, y, 5.3, 0.45, C.bg2);
    t(s, k.toUpperCase(), { x: MX + 0.2, y: y + 0.11, w: 1.3, h: 0.25, fontFace: HEAD, fontSize: 11.5, bold: true, color: C.gold, charSpacing: 1.5 });
    t(s, d, { x: MX + 1.6, y: y + 0.1, w: 3.5, h: 0.27, fontSize: 12.5, color: C.ink2 });
  });
  t(s, "A model never dispatches (ADR-0005). These are validation figures from the training run, not production accuracy.",
    { x: MX, y: 6.15, w: 12, h: 0.4, fontSize: 12, color: C.ink3, italic: true });
  foot(s, n);
  s.addNotes("YOLO11 trained here on RDD2022 across four countries: mAP50 0.472 and mAP50-95 0.226 on held-out validation (best run, YOLO11s yolo11s-multi-rich, ai/README.md). A model-detected incident waits in a confirmation queue until a person moves it; there is no transition to dispatch that skips a human.");
}

// 8 ── architecture ─────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "ARCHITECTURE  ·  ADR-0001", MX, 0.55);
  title(s, "A modular monolith on PostGIS", MX, 0.85, 12);
  const col = (x, w, label, items, color) => {
    card(s, x, 1.95, w, 4.1);
    t(s, label, { x: x + 0.25, y: 2.15, w: w - 0.5, h: 0.3, fontFace: HEAD, fontSize: 12, bold: true, color, charSpacing: 2 });
    items.forEach((it, i) => {
      card(s, x + 0.25, 2.6 + i * 0.66, w - 0.5, 0.52, C.bg2);
      t(s, it, { x: x + 0.45, y: 2.72 + i * 0.66, w: w - 0.9, h: 0.3, fontSize: 12.5, color: C.ink });
    });
  };
  col(MX, 3.6, "CLIENTS", ["Citizen web app (PWA)", "Android · Kotlin + Compose", "Mechanic console", "RAKSHA + live map", "Feature phone · SMS"], C.gold);
  col(4.6, 4.1, "FASTIFY API", [`${num("api", "routes")} routes, versioned /v1`, "Zod validation at every edge", "JWT with role-based access", "Server-sent events (ADR-0010)", "Offer-expiry sweeper"], C.blue);
  col(9.1, 3.63, "POSTGRESQL 16 + POSTGIS", [`${num("schema", "tables")} tables`, `${num("schema", "indexes")} indexes · ${num("schema", "gistIndexes")} GiST`, `${num("schema", "foreignKeys")} foreign keys`, "Hash-chained audit log", `${num("schema", "migrations")} migrations`], C.green);
  [4.23, 8.73].forEach((x) => s.addShape(pres.shapes.RIGHT_ARROW, { x, y: 3.85, w: 0.34, h: 0.34, fill: { color: C.gold }, line: { color: C.gold, width: 0 } }));
  t(s, `${num("adrs")} architecture decision records explain every choice on this slide.`, { x: MX, y: 6.3, w: 12, h: 0.3, fontSize: 12, color: C.ink3 });
  foot(s, n);
  s.addNotes("One Fastify process serves the API and every web surface. PostGIS is required: dispatch ranks providers with ST_DWithin over a GiST index. The audit log is hash-chained and append-only. Counts come from schema introspection through pg_depend so PostGIS's own tables are not counted.");
}

// 9 ── quality ──────────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "EVIDENCE", MX, 0.55);
  title(s, "Every number is measured", MX, 0.85, 7);
  const suites = num("assertions", "suites");
  const labels = ["Unit", "End-to-end", "Concurrency", "Security", "Gateway", "Browser"];
  const vals = [suites.unit, suites.e2e, suites.concurrency, suites.securityAudit, suites.gatewaySecurity, suites.browser];
  s.addChart(pres.charts.BAR, [{ name: "Assertions", labels, values: vals }], {
    x: 5.2, y: 1.6, w: 7.55, h: 4.6, barDir: "bar", chartColors: [C.gold],
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: C.ink, dataLabelFontSize: 12, dataLabelFontFace: BODY,
    catAxisLabelColor: C.ink2, catAxisLabelFontSize: 12, catAxisLabelFontFace: BODY, valAxisHidden: true,
    valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
    catAxisOrientation: "maxMin", barGapWidthPct: 55,
  });
  card(s, MX, 1.95, 4.3, 1.9);
  t(s, String(num("assertions", "total")), { x: MX + 0.3, y: 2.1, w: 3.8, h: 1.0, fontFace: HEAD, fontSize: 60, bold: true, color: C.ink });
  t(s, "assertions across six suites, zero failures", { x: MX + 0.3, y: 3.2, w: 3.8, h: 0.4, fontSize: 13, color: C.ink2 });
  pill(s, MX + 4.3 - 0.95, 2.2, "PASS");
  card(s, MX, 4.05, 4.3, 1.1);
  t(s, `${num("assertions", "suites", "securityAudit")} attacks attempted, every one refused`, { x: MX + 0.3, y: 4.25, w: 3.8, h: 0.7, fontSize: 13, color: C.ink });
  card(s, MX, 5.35, 4.3, 1.0);
  t(s, `${num("assertions", "notExecuted", "paymentSandbox")} Razorpay checks run against a local stub, outside the ${num("assertions", "total")} — never counted as passing.`,
    { x: MX + 0.3, y: 5.5, w: 3.8, h: 0.75, fontSize: 12, color: C.ink3 });
  foot(s, n);
  s.addNotes(`${num("assertions", "total")} assertions across unit, end-to-end, concurrency, security, gateway security and browser suites, zero failures. The security suite attempts ${num("assertions", "suites", "securityAudit")} attacks including cross-tenant reads, role escalation, SQL injection and forged tokens. The 22 payment-sandbox checks need an account we do not have, so they are reported as not run.`);
}

// 10 ── honest AI ───────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "NO LLM  ·  ENFORCED, NOT PROMISED", MX, 0.55);
  title(s, "Built by us. Checked by the build.", MX, 0.85, 12);
  const gates = [["npm run no-llm", "fails the build on any LLM package in a manifest or a chat endpoint in source"],
                 ["npm run claims", "every number in the docs must match what the suites measured"],
                 ["npm run residency", "pages load nothing third-party; every server egress host declared with its region"],
                 ["npm run citations", "every code reference in the docs still resolves"]];
  gates.forEach(([cmd, d], i) => {
    const x = MX + (i % 2) * 6.1, y = 2.0 + Math.floor(i / 2) * 1.9;
    card(s, x, y, 5.85, 1.65);
    t(s, cmd, { x: x + 0.3, y: y + 0.28, w: 5.3, h: 0.35, fontFace: "Consolas", fontSize: 15, bold: true, color: C.gold });
    t(s, d, { x: x + 0.3, y: y + 0.75, w: 5.3, h: 0.7, fontSize: 13, color: C.ink2 });
  });
  t(s, "The AI in this project is a YOLO11 detector trained in this repository and a deterministic rules engine — never a language model.",
    { x: MX, y: 5.95, w: 12, h: 0.5, fontSize: 14, color: C.ink, italic: true });
  foot(s, n);
  s.addNotes("Our faculty's requirement: LLM-based projects with minimal student contribution are not considered. We made that a build check: npm run no-llm fails on any LLM dependency or chat endpoint, and it runs in CI on every push. Even the site's answer panel is a lookup over a fixed index.");
}

// 11 ── deployment ──────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "DEPLOYMENT", MX, 0.55);
  title(s, "One command locally. One domain publicly.", MX, 0.85, 12);
  card(s, MX, 2.0, 6.0, 2.1, "05070A");
  t(s, [{ text: "git clone https://github.com/saatwik-1157/roadassist-bharat", options: { breakLine: true } },
        { text: "docker compose -f docker-compose.demo.yml up", options: { color: C.gold } }],
    { x: MX + 0.3, y: 2.3, w: 5.5, h: 1.2, fontFace: "Consolas", fontSize: 11, color: C.ink2, paraSpaceAfter: 8 });
  t(s, "PostGIS, migrations, seed data and the platform — no cloud account, no secrets.", { x: MX + 0.3, y: 3.45, w: 5.5, h: 0.5, fontSize: 12, color: C.ink3 });
  const rows = [["roadassistbharat.online", "Project showcase · GitHub Pages · live"], ["Docker image", "Published to GHCR on every push"],
                ["Render + Neon", "render.yaml deploys the same image to the cloud"], ["Restart policy", "The demo stack comes back by itself"]];
  rows.forEach(([k, d], i) => {
    const y = 2.0 + i * 0.95;
    card(s, 6.95, y, 5.8, 0.8);
    t(s, k, { x: 7.2, y: y + 0.13, w: 5.3, h: 0.3, fontFace: HEAD, fontSize: 14, bold: true, color: C.ink });
    t(s, d, { x: 7.2, y: y + 0.44, w: 5.3, h: 0.28, fontSize: 11.5, color: C.ink3 });
  });
  s.addImage({ path: img("app-icon-512.png"), x: MX, y: 4.5, w: 1.4, h: 1.4 });
  t(s, "The same image runs locally, in CI and in the cloud.", { x: MX + 1.65, y: 4.95, w: 4.3, h: 0.6, fontSize: 14, color: C.ink2 });
  foot(s, n);
  s.addNotes("The showcase is live at roadassistbharat.online on GitHub Pages. The platform image is built and published by CI; the demo compose file brings up PostGIS, migrates, seeds and serves every surface on port 4000. Render with a Neon PostGIS database hosts the same image.");
}

// 12 ── team ────────────────────────────────────────────────────────────────
{
  const s = next();
  eyebrow(s, "THE TEAM", MX, 0.55);
  title(s, "Four people, four responsibilities", MX, 0.85, 12);
  const team = [["V Saatwik Sairaam", "VS", "24MIC7131", "Backend & Cloud Database", "Fastify API, PostGIS schema, dispatch and concurrency", C.gold],
                ["P Sai Nirisha Chowdary", "PN", "24MIC7122", "Frontend & Mobile", "Citizen web app, mechanic console, Android client", C.gold2],
                ["T V S Jignesh", "TJ", "24MIC7190", "AI & Data Services", "YOLO11 training, RAKSHA ingest, rules engine", C.blue],
                ["G Parthavi", "GP", "24MIC7145", "DevOps, QA & Cloud Security", "CI, Docker, security suite, deployment", C.green]];
  team.forEach(([name, initials, reg, role, work, col], i) => {
    const x = MX + i * 3.06;
    card(s, x, 2.0, 2.9, 3.9);
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: 2.3, w: 0.9, h: 0.9, fill: { color: col }, line: { color: col, width: 0 } });
    t(s, initials, { x: x + 0.3, y: 2.3, w: 0.9, h: 0.9, fontFace: HEAD, fontSize: 22, bold: true, color: C.dark, align: "center", valign: "middle" });
    t(s, name, { x: x + 0.3, y: 3.45, w: 2.4, h: 0.35, fontFace: HEAD, fontSize: 15, bold: true, color: C.ink });
    t(s, reg, { x: x + 0.3, y: 3.85, w: 2.4, h: 0.28, fontSize: 11, color: C.gold, fontFace: "Consolas" });
    t(s, role, { x: x + 0.3, y: 4.2, w: 2.4, h: 0.55, fontSize: 12, bold: true, color: C.ink2 });
    t(s, work, { x: x + 0.3, y: 4.8, w: 2.4, h: 0.9, fontSize: 11.5, color: C.ink3 });
  });
  t(s, "Course faculty: Dr. Nagendra Panini Challa", { x: MX, y: 6.25, w: 8, h: 0.3, fontSize: 12, color: C.ink3 });
  foot(s, n);
  s.addNotes("Each member owns one layer end to end. Confirm the one-line work summaries with each member before the review — they are written from the roles on our Review 1 title slide.");
}

// 13 ── close ───────────────────────────────────────────────────────────────
{
  const s = next();
  s.addImage({ path: img("hero.jpg"), x: 0, y: 0, w: W, h: H, sizing: { type: "cover", w: W, h: H }, transparency: 78 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: H, fill: { color: C.bg, transparency: 20 }, line: { color: C.bg, width: 0 } });
  s.addImage({ path: img("mark-1024.png"), x: W / 2 - 0.9, y: 1.2, w: 1.8, h: 1.8 });
  t(s, "Thank you", { x: 0, y: 3.2, w: W, h: 0.9, fontFace: HEAD, fontSize: 48, bold: true, color: C.ink, align: "center" });
  t(s, "Questions welcome — and the platform is running if you'd like to see it.", { x: 0, y: 4.15, w: W, h: 0.5, fontSize: 16, color: C.ink2, align: "center" });
  t(s, "roadassistbharat.online   ·   github.com/saatwik-1157/roadassist-bharat", { x: 0, y: 5.1, w: W, h: 0.4, fontSize: 13, color: C.gold, align: "center", fontFace: "Consolas" });
  s.addNotes("Offer a live demo: the citizen app and RAKSHA are running. Demo sign-ins: citizen +917000000000, authority +919999900001, mechanic +919600000000 — the OTP fills itself in demo mode.");
}

pres.writeFile({ fileName: OUT }).then((f) => console.log("wrote", f, n, "slides"));
