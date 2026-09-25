/**
 * Where each web surface sends its API calls.
 *
 * Five pages carry the same classic-script expression (they share no module
 * system), so this reads it out of every one of them and runs it against a fake
 * `location`. A page the API served must talk to THAT API, whatever port it is
 * on: a second stack, `PORT=4100 npm start`, or the gateway suite's hardened
 * instance on :4101 all serve these pages from a port that is not 4000.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const PAGES = ["app.html", "mechanic.html", "raksha.html", "index.html", "map.html"];
const WEB = new URL("../../web/", import.meta.url);

function apiFor(page: string, href: string): string {
  const html = readFileSync(fileURLToPath(new URL(page, WEB)), "utf8");
  // `var API = (function…` in four pages, `var BASE = hash.get("base") || (function…`
  // in map.html; the function itself is the same shape in all five.
  const m = html.match(/(\(function \(\) \{\s*(?:\/\/[^\n]*\n\s*)*(?:var|const) http = location\.protocol[\s\S]*?\}\)\(\))/);
  assert.ok(m, `${page}: the API origin expression was not found`);
  const u = new URL(href);
  const location = {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    origin: u.protocol === "file:" ? "null" : u.origin,
  };
  return runInNewContext(m[1], { location }) as string;
}

for (const page of PAGES) {
  test(`${page}: a page served by the API on another local port talks to that API`, () => {
    assert.equal(apiFor(page, "http://localhost:4400/" + page), "http://localhost:4400",
      "a page on :4400 must not reach across to whatever happens to be on :4000");
    assert.equal(apiFor(page, "http://127.0.0.1:4101/" + page), "http://127.0.0.1:4101");
  });

  test(`${page}: the default port and a real origin are their own API`, () => {
    assert.equal(apiFor(page, "http://localhost:4000/" + page), "http://localhost:4000");
    assert.equal(apiFor(page, "https://roadassist.example.in/" + page), "https://roadassist.example.in");
  });

  test(`${page}: a page opened as a file still falls back to the local API`, () => {
    assert.equal(apiFor(page, "file:///C:/repo/app/apps/web/" + page), "http://localhost:4000");
  });
}
