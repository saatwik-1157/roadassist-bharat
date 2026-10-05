/**
 * The claims gate (scripts/check-claims.mjs) against the shapes it used to miss.
 *
 * Every figure below went stale in a real document while the gate was green,
 * because its label was not the next word after the number: a stat tile's
 * label is the next ELEMENT, a table's is the first CELL, a JS array's is a
 * string the gate used to blank. Each test states one shape twice — with
 * today's figure, which must pass, and with a stale one, which must fail — so
 * a check that quietly stops matching fails here rather than in a document.
 *
 * Figures come from measured.json, never literals, so these tests do not go
 * stale when the counts move.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkFile,
  countRoutes,
  countV1Routes,
  isExempt,
  measured,
  measuredVsCode,
  UNDER_V1,
} from "../../../scripts/check-claims.mjs";

type Problem = { rel: string; line: number; label: string; found: string; want: string };

const TOTAL = String(measured.assertions.total);
const SUITE = measured.assertions.suites;
const ANDROID = String(measured.assertions.otherRunners.android);
const ROUTES = String(measured.api.routes);
const TABLES = String(measured.schema.tables);
const ADRS = Number(measured.adrs);
/** A figure that is wrong by one — the usual shape of a stale count. */
const stale = (n: string | number) => String(Number(n) + 1);
/** ADR counts are written in words too: WORDS[12] === "Twelve". */
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];

const problems = (rel: string, raw: string): Problem[] => checkFile(rel, raw);
const passes = (rel: string, raw: string) =>
  assert.deepEqual(problems(rel, raw), [], `expected no problems in:\n${raw}`);
/** Fails, on `line`, finding `found` where `want` belongs. */
function fails(rel: string, raw: string, found: string, want: string, line = 1) {
  const got = problems(rel, raw);
  assert.equal(got.length, 1, `expected exactly one problem, got ${JSON.stringify(got)}\nin:\n${raw}`);
  assert.equal(got[0].found, found);
  assert.equal(got[0].want, want);
  assert.equal(got[0].line, line);
}

describe("stat tiles — the label is the next element", () => {
  const tile = (count: string, text: string, label: string) =>
    `<div class="metric"><div class="v" data-count="${count}">${text}</div><div class="l">${label}</div></div>`;

  it("Pages tile: today's figure passes", () => {
    passes("pages/index.html", tile(TOTAL, TOTAL, "Assertions"));
    passes("pages/index.html", tile(TABLES, TABLES, "Tables"));
    passes("pages/index.html", tile(ROUTES, ROUTES, "API routes"));
  });

  it("Pages tile: a stale number in the element fails", () => {
    fails("pages/index.html", tile(TOTAL, stale(TOTAL), "Assertions"), stale(TOTAL), TOTAL);
    fails("pages/index.html", tile(TABLES, stale(TABLES), "Tables"), stale(TABLES), TABLES);
  });

  it("Pages tile: a stale data-count fails even when the text is right", () => {
    fails("pages/index.html", tile(stale(TOTAL), TOTAL, "Assertions"), stale(TOTAL), TOTAL);
  });

  it("a counter that starts from 0 is judged by its data-count alone", () => {
    passes("pages/index.html", tile(TOTAL, "0", "Assertions"));
  });

  it("landing tile ('automated checks …' in a hint): today passes, stale fails", () => {
    const landing = (n: string) =>
      `<div class="card stat"><div class="v num">${n}</div><div class="k hint">automated checks across six suites</div></div>`;
    passes("app/apps/web/landing.html", landing(TOTAL));
    fails("app/apps/web/landing.html", landing(stale(TOTAL)), stale(TOTAL), TOTAL);
  });

  it("a tile whose label names nothing measured is not read", () => {
    passes("pages/index.html", tile("13", "13", "Epochs"));
  });
});

describe("HTML table rows — the label is the first cell", () => {
  const table = (rows: string) =>
    `<table>\n<tr><th>Suite</th><th>What it covers</th><th class="num">Assertions</th><th>Status</th></tr>\n${rows}\n</table>`;
  const tr = (label: string, n: string, covers = "covers") =>
    `<tr><td>${label}</td><td>${covers}</td><td class="num">${n}</td><td><span class="badge">PASS</span></td></tr>`;
  const rows: [string, string][] = [
    ["Unit", String(SUITE.unit)],
    ["End-to-end", String(SUITE.e2e)],
    ["E2E", String(SUITE.e2e)],
    ["Concurrency", String(SUITE.concurrency)],
    ["Security", String(SUITE.securityAudit)],
    ["Gateway security", String(SUITE.gatewaySecurity)],
    ["Browser", String(SUITE.browser)],
    ["<strong>Total</strong>", TOTAL],
    ["Android", ANDROID],
  ];

  for (const [label, n] of rows) {
    it(`${label}: today passes, stale fails`, () => {
      passes("pages/index.html", table(tr(label, n)));
      fails("pages/index.html", table(tr(label, stale(n))), stale(n), n, 3);
    });
  }

  it("the Total row's number may be wrapped in <strong>", () => {
    const total = (n: string) =>
      `<tr class="total"><td><strong>Total</strong></td><td>Six suites</td><td class="num"><strong>${n}</strong></td><td>PASS</td></tr>`;
    passes("pages/index.html", table(total(TOTAL)));
    fails("pages/index.html", table(total(stale(TOTAL))), stale(TOTAL), TOTAL, 3);
  });

  it("a number in the description cell is not the row's count", () => {
    // "Kotlin unit tests; 21 cover the SOS ladder alone" sits beside the Android total.
    passes("pages/index.html", table(tr("Android", ANDROID, "Kotlin unit tests; 21 cover the SOS ladder alone")));
  });

  it("'not part of the N' names the total", () => {
    const sub = (n: string) => `<tr class="sub"><th colspan="4">Run separately &mdash; not part of the ${n}</th></tr>`;
    passes("pages/index.html", table(sub(TOTAL)));
    fails("pages/index.html", table(sub(stale(TOTAL))), stale(TOTAL), TOTAL, 3);
  });

  it("a table whose header names no count column is not read", () => {
    const rubric = `<table><tr><th>Criterion</th><th>Marks</th></tr><tr><td>Security</td><td>10</td></tr></table>`;
    passes("pages/index.html", rubric);
  });
});

describe("Markdown table rows", () => {
  const md = (rows: string) => `| Suite | Assertions |\n|---|---|\n${rows}\n`;

  it("| Unit | N |: today passes, stale fails", () => {
    passes("app/docs/PROJECT_OVERVIEW.md", md(`| Unit | ${SUITE.unit} |`));
    fails("app/docs/PROJECT_OVERVIEW.md", md(`| Unit | ${stale(SUITE.unit)} |`), stale(SUITE.unit), String(SUITE.unit), 3);
  });

  it("a CRLF file is read the same way", () => {
    const crlf = (n: number | string) => md(`| Unit | ${n} |`).replaceAll("\n", "\r\n");
    passes("app/docs/PROJECT_OVERVIEW.md", crlf(SUITE.unit));
    fails("app/docs/PROJECT_OVERVIEW.md", crlf(stale(SUITE.unit)), stale(SUITE.unit), String(SUITE.unit), 3);
  });

  it("| **Total** | **N** |: today passes, stale fails", () => {
    passes("app/docs/PROJECT_OVERVIEW.md", md(`| **Total** | **${TOTAL}** |`));
    fails("app/docs/PROJECT_OVERVIEW.md", md(`| **Total** | **${stale(TOTAL)}** |`), stale(TOTAL), TOTAL, 3);
  });

  it("a qualified label is still the suite: 'Security (attacks that must fail)', 'Browser / offline'", () => {
    const q: [string, number][] = [
      ["Security (attacks that must fail)", SUITE.securityAudit],
      ["Browser / offline", SUITE.browser],
      ["Concurrency + real-time", SUITE.concurrency],
    ];
    for (const [label, n] of q) {
      passes("app/docs/PROJECT_OVERVIEW.md", md(`| ${label} | ${n} |`));
      fails("app/docs/PROJECT_OVERVIEW.md", md(`| ${label} | ${stale(n)} |`), stale(n), String(n), 3);
    }
  });

  it("a suite SCRIPT in the first cell names its suite", () => {
    const scripts: [string, number][] = [
      ["`scripts/e2e-journey.mjs`", SUITE.e2e],
      ["`scripts/concurrency-test.mjs`", SUITE.concurrency],
      ["`scripts/gateway-security-test.mjs`", SUITE.gatewaySecurity],
      ["`scripts/security-audit.mjs`", SUITE.securityAudit],
      ["`scripts/ui-journey.mjs`", SUITE.browser],
      ["`npm test` (node:test)", SUITE.unit],
    ];
    for (const [label, n] of scripts) {
      const row = (v: string) => md(`| ${label} | **${v}** | What it exists for. |`);
      passes("app/docs/TESTING.md", row(String(n)));
      fails("app/docs/TESTING.md", row(stale(n)), stale(n), String(n), 3);
    }
  });

  it("a bold count followed by commentary is still read", () => {
    const n = String(measured.assertions.notExecuted.paymentSandbox);
    const row = (v: string) => md(`| \`scripts/razorpay-test.mjs\` | **${v}** — not in the ${TOTAL} | Payment negative space |`);
    passes("app/docs/TESTING.md", row(n));
    fails("app/docs/TESTING.md", row(stale(n)), stale(n), n, 3);
  });

  it("'Security headers', a rubric column, and a script cited in a LATER cell are not suites", () => {
    passes("app/docs/SECURITY.md", md("| Security headers | 7 |"));
    passes("x.md", "| Criterion | Marks | Expected |\n|---|---|---|\n| Security | 10 | 8 |\n| **Total** | **100** | 82 |\n");
    passes("x.md", "| # | Failure | Test |\n|---|---|---|\n| 5 | No provider | `e2e-journey.mjs` §6 |\n");
  });
});

describe("routes under /v1 — api.underV1, itself checked against the code", () => {
  it("UNDER_V1 is measured.json's api.underV1, and below the total", () => {
    assert.equal(UNDER_V1, String(measured.api.underV1));
    assert.ok(Number(UNDER_V1) > 0 && Number(UNDER_V1) <= Number(ROUTES));
  });

  /** A fake apps/api/src: 6 route call sites, 4 of them under /v1. */
  function withFakeSrc(fn: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "claims-v1-"));
    try {
      mkdirSync(join(dir, "routes"));
      writeFileSync(join(dir, "server.ts"),
        'app.get("/health", h);\napp.get("/v1/ping", h);\napp.post( "/v1/bookings", h);\n');
      writeFileSync(join(dir, "routes", "auth.ts"), "app.patch('/v1/me', h);\napp.delete(`/v1/x/:id`, h);\n");
      writeFileSync(join(dir, "routes", "notes.md"), 'app.get("/v1/not-code")\n');
      writeFileSync(join(dir, "routes", "v1ish.ts"), 'app.get("/v1beta", h);\n');
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("the counters read every .ts file below the directory, and /v1 means the /v1 path", () => {
    withFakeSrc((dir) => {
      assert.equal(countRoutes(dir), 6);
      assert.equal(countV1Routes(dir), 4);
    });
  });

  it("measured.json agreeing with the code passes; a stale split or total fails", () => {
    withFakeSrc((dir) => {
      assert.deepEqual(measuredVsCode({ routes: 6, underV1: 4 }, dir), []);
      const split = measuredVsCode({ routes: 6, underV1: 3 }, dir);
      assert.equal(split.length, 1);
      assert.equal(split[0].label, "api.underV1 vs the code");
      assert.equal(split[0].found, "3");
      assert.equal(split[0].want, "4");
      const total = measuredVsCode({ routes: 5, underV1: 4 }, dir);
      assert.equal(total.length, 1);
      assert.equal(total[0].label, "api.routes vs the code");
    });
  });

  const shapes = [
    (n: string) => `${ROUTES} routes, ${n} under /v1.`,
    (n: string) => `${ROUTES} routes (${n} under \`/v1\`)`,
    (n: string) => `**${ROUTES} routes**, ${n} of them under \`/v1\`, uniform envelope`,
    (n: string) => `${ROUTES} endpoints, ${n} under /v1`,
    (n: string) => `${n} endpoints under /v1`,
  ];
  for (const shape of shapes) {
    it(`"${shape("N")}": today passes, stale fails`, () => {
      passes("README.md", shape(UNDER_V1));
      fails("README.md", shape(stale(UNDER_V1)), stale(UNDER_V1), UNDER_V1);
    });
  }

  it("in a page, across a <code> tag: '65 of them under a versioned <code>/v1</code>'", () => {
    const p = (n: string) => `<p>Fastify, ${ROUTES} routes, ${n} of them under a versioned <code>/v1</code> contract</p>`;
    passes("pages/index.html", p(UNDER_V1));
    fails("pages/index.html", p(stale(UNDER_V1)), stale(UNDER_V1), UNDER_V1);
  });
});

describe("ADR count — digits and words", () => {
  const now = String(ADRS);
  const old = String(ADRS - 1);

  it("'N ADRs' and 'N architecture decision records'", () => {
    passes("app/docs/PROJECT_OVERVIEW.md", `- **${now} ADRs**, an enforced module-boundary check`);
    fails("app/docs/PROJECT_OVERVIEW.md", `- **${old} ADRs**, an enforced module-boundary check`, old, now);
    passes("app/README.md", `adr/   ${now} architecture decision records`);
    fails("app/README.md", `adr/   ${old} architecture decision records`, old, now);
  });

  it("'Twelve ADRs' / 'Twelve decision records', in words", () => {
    passes("README.md", `| [ADRs](adr/) | ${WORDS[ADRS]} decision records, including the five above |`);
    fails("README.md", `| [ADRs](adr/) | ${WORDS[ADRS - 1]} decision records, including the five above |`, old, now);
    passes("app/docs/README.md", `${WORDS[ADRS]} ADRs in adr/.`);
    fails("app/docs/README.md", `${WORDS[ADRS - 1].toLowerCase()} ADRs in adr/.`, old, now);
  });
});

describe("JS string arrays in a page's script", () => {
  const page = (body: string) => `<html><body>\n<script type="module">\nconst LAYERS = [\n${body}\n];\n</script>\n</body></html>`;

  it("the layers.html component list: routes and the /v1 split", () => {
    const comp = (r: string, v: string) => `  ["Fastify API", "${r} routes, ${v} under /v1. One process, one entry point."],`;
    passes("app/apps/web/layers.html", page(comp(ROUTES, UNDER_V1)));
    fails("app/apps/web/layers.html", page(comp(ROUTES, stale(UNDER_V1))), stale(UNDER_V1), UNDER_V1, 4);
    fails("app/apps/web/layers.html", page(comp(stale(ROUTES), UNDER_V1)), stale(ROUTES), ROUTES, 4);
  });

  it("the total in a string", () => {
    const ci = (n: string) => `  ["CI", "GitHub Actions runs the gates on every push; ${n} assertions pass across six suites."],`;
    passes("app/apps/web/layers.html", page(ci(TOTAL)));
    fails("app/apps/web/layers.html", page(ci(stale(TOTAL))), stale(TOTAL), TOTAL, 4);
  });

  it("the Android client's test count, anchored to Kotlin", () => {
    const android = (n: string) =>
      `  ["Android app", "Native Kotlin + Jetpack Compose client with ${n} unit tests, pointed at the live API."],`;
    passes("app/apps/web/layers.html", page(android(ANDROID)));
    fails("app/apps/web/layers.html", page(android("87")), "87", ANDROID, 4);
  });

  it("an FAQ answer string with markup inside it", () => {
    const faq = (w: string) => `  {id:"adr", a:"<p>${w} architecture decision records in <code>app/docs/adr/</code>.</p>"},`;
    passes("pages/index.html", page(faq(WORDS[ADRS])));
    fails("pages/index.html", page(faq(WORDS[ADRS - 1])), String(ADRS - 1), String(ADRS), 4);
  });

  it("code and comments are not read — only what the page can print", () => {
    passes("app/apps/web/layers.html", page(`  // 5 tables used to live here\n  [tables.length, 3 /* routes */],\n  x < 7 ? "a" : "b",`));
  });

  it("an escape in a string does not become a number", () => {
    // Read naively, the em-dash escape followed by " tables" is "2014 tables".
    passes("app/apps/web/layers.html", page(`  ["x", "see \\u2014 tables below"],`));
  });
});

describe("where a problem is reported", () => {
  it("on the number's line, not the anchor's", () => {
    // The Android runner's anchor, testDebugUnitTest, can sit a line above its count.
    fails("app/docs/TESTING.md", "`./gradlew testDebugUnitTest`\n(87 tests)", "87", ANDROID, 2);
  });

  it("on the right line of a page after entities have shortened the text", () => {
    fails("pages/index.html", `<p>${"&mdash;".repeat(30)}</p>\n<p>${stale(TABLES)} tables</p>`, stale(TABLES), TABLES, 2);
  });
});

describe("exemptions", () => {
  const shot = (caption: string) =>
    `<button class="shot" data-src="shots/21-test-security.png" data-cap="${caption}"><img src="t.webp" alt="Security suite output"></button>`;
  const oldCaption = `The security suite — ${stale(SUITE.securityAudit)} attacks, every one refused`;

  // A screenshot's caption used to be exempt, and the showcase gallery kept
  // "56 tables" and "87 attacks" under captures of a build long gone. The
  // caption and the capture are now re-taken together, so a stale figure in
  // either place fails.
  it("a screenshot's data-cap is a claim: today's figure passes, a stale one fails", () => {
    passes("pages/index.html", shot(`The security suite — ${SUITE.securityAudit} attacks, every one refused`));
    fails("pages/index.html", shot(oldCaption), stale(SUITE.securityAudit), String(SUITE.securityAudit));
    const schema = (n: string) =>
      `<button class="shot" data-src="shots/20-database-schema.png" data-cap="The schema — ${n} tables, counted through pg_depend"><img alt="Database schema"></button>`;
    passes("pages/index.html", schema(TABLES));
    fails("pages/index.html", schema(stale(TABLES)), stale(TABLES), TABLES);
  });

  it("…and so is figcaption text, and the alt, title or aria-label of any element", () => {
    const n = stale(SUITE.securityAudit);
    const want = String(SUITE.securityAudit);
    fails("pages/index.html", `<figure><img src="x.webp"><figcaption>${oldCaption}</figcaption></figure>`, n, want);
    fails("pages/index.html", `<img src="x.webp" title="${oldCaption}">`, n, want);
    fails("pages/index.html", `<a href="#s" aria-label="${oldCaption}">x</a>`, n, want);
    fails("pages/index.html", `<button class="demo" data-cap="${oldCaption}">x</button>`, n, want);
    fails("pages/index.html",
      `<button class="shot" data-src="shots/21.png" data-cap="ok"><img alt="${oldCaption}"></button>`, n, want);
    fails("pages/index.html", `<meta name="description" content="${n} refused attacks">`, n, want);
    fails("pages/index.html", `<p>${oldCaption}</p>`, n, want);
  });

  it("claims-check:ignore on the line, including as an HTML comment", () => {
    passes("docs/x.md", `Footer "${stale(TOTAL)} assertions" <!-- claims-check:ignore: quoted on purpose -->`);
    passes("pages/index.html", `<p>${stale(TOTAL)} assertions</p> <!-- claims-check:ignore: quoted on purpose -->`);
    // A caption that must name a past figure on purpose says so the same way.
    passes("pages/index.html", `${shot(oldCaption)} <!-- claims-check:ignore: a capture of a past run -->`);
    passes("pages/index.html",
      `<table><tr><th>Suite</th><th>Assertions</th></tr>\n` +
      `<tr><td>Unit</td><td>${stale(SUITE.unit)}</td></tr><!-- claims-check:ignore: a past run --></table>`);
  });

  it("the audit and the superseded first landing page are exempt; living documents are not", () => {
    assert.ok(isExempt("app/docs/CLAIMS-AUDIT.md"));
    assert.ok(isExempt("site/index.html"));
    assert.ok(!isExempt("docs/README.md"));
    assert.ok(!isExempt("docs/TOOLS-AND-SOFTWARE.md"));
    assert.ok(!isExempt("pages/index.html"));
    assert.ok(!isExempt("app/apps/web/layers.html"));
    assert.ok(!isExempt("app/docs/TESTING.md"));
  });
});
