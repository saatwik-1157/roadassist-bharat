/**
 * The security headers: what the policy allows is exactly what the pages
 * use, and nothing that only a configured gateway needs leaks into the
 * default build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { contentSecurityPolicy, staticHeaders } from "../src/security-headers.js";

const SITE = ["https://roadassistbharat.online", "https://www.roadassistbharat.online"];
const dir = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(name + " "))?.slice(name.length + 1).split(" ") ?? [];

test("the policy closes plugins, <base> hijacking and cross-origin form posts", () => {
  const csp = contentSecurityPolicy({ frameAncestors: SITE, razorpay: false });
  assert.deepEqual(dir(csp, "object-src"), ["'none'"]);
  assert.deepEqual(dir(csp, "base-uri"), ["'self'"]);
  assert.deepEqual(dir(csp, "form-action"), ["'self'"]);
  assert.deepEqual(dir(csp, "default-src"), ["'self'"]);
});

test("only this origin and the project site may frame the pages, with or without a CORS list", () => {
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: SITE, razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE]);
  // A local or docker server has no CORS list; the site's live mode still frames it.
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: [], razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE]);
  assert.deepEqual(dir(contentSecurityPolicy({ frameAncestors: ["https://app.example.in"], razorpay: false }), "frame-ancestors"),
    ["'self'", ...SITE, "https://app.example.in"]);
});

test("Razorpay is allowed only when the real gateway is configured", () => {
  const mock = contentSecurityPolicy({ frameAncestors: [], razorpay: false });
  const real = contentSecurityPolicy({ frameAncestors: [], razorpay: true });
  assert.ok(!mock.includes("razorpay"), "the mock build must not allow a third-party script");
  assert.ok(dir(real, "script-src").includes("https://checkout.razorpay.com"));
  assert.ok(dir(real, "frame-src").includes("https://api.razorpay.com"));
});

test("scripts come from this origin only; the Draco decoder's wasm and worker are allowed", () => {
  const csp = contentSecurityPolicy({ frameAncestors: [], razorpay: false });
  assert.deepEqual(dir(csp, "script-src"), ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(dir(csp, "worker-src"), ["'self'", "blob:"]);
  assert.deepEqual(dir(csp, "connect-src"), ["'self'"]);
});

test("HSTS is sent over HTTPS only; nosniff and a referrer policy always", () => {
  assert.equal(staticHeaders(true)["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(staticHeaders(false)["strict-transport-security"], undefined);
  for (const h of [staticHeaders(true), staticHeaders(false)]) {
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
    assert.match(h["permissions-policy"], /geolocation=\(self\)/);
  }
});
