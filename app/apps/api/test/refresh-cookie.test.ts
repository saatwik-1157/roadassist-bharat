/**
 * The web refresh cookie: who opts in, what the cookie says, and that it is
 * only ever read for the slot that asked. Pure functions, no server; the
 * live behaviour is security-audit.mjs §13.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  carriesRefreshCookie, refreshCookie, refreshCookieName, refreshTokenFromCookies, webClientSlot,
} from "../src/domain/refresh-cookie.js";

const TOKEN = "Zx8_yq-3".repeat(5) + "abc";   // base64url, like newRefreshToken's

test("only the X-RA-Client header opts a caller into the cookie; native clients never do", () => {
  assert.equal(webClientSlot(undefined), null, "no header: the JSON body flow, unchanged");
  assert.equal(webClientSlot("android"), null);
  assert.equal(webClientSlot("web"), "web");
  assert.equal(webClientSlot("web-app"), "app");
  assert.equal(webClientSlot(" Web-Mechanic "), "mechanic");
  for (const bad of ["web-", "web-a b", "web-../x", "web-" + "a".repeat(17), "webapp", ["web"] as unknown as string]) {
    assert.equal(webClientSlot(bad), null, `"${bad}" is not a slot`);
  }
});

test("on HTTPS the cookie is HttpOnly, Secure, SameSite=None and Partitioned, scoped to /v1/auth", () => {
  const c = refreshCookie({ https: true, slot: "app", token: TOKEN, maxAgeSeconds: 30 * 86400 });
  const parts = c.split("; ");
  assert.equal(parts[0], `ra_rt_app=${TOKEN}`);
  for (const p of ["Path=/v1/auth", "HttpOnly", "Secure", "SameSite=None", "Partitioned", "Max-Age=2592000"]) {
    assert.ok(parts.includes(p), `missing ${p}: ${c}`);
  }
});

test("on plain http it is SameSite=Lax and not Secure (None would be refused without Secure)", () => {
  const parts = refreshCookie({ https: false, slot: "app", token: TOKEN, maxAgeSeconds: 60 }).split("; ");
  assert.ok(parts.includes("SameSite=Lax") && parts.includes("HttpOnly") && parts.includes("Path=/v1/auth"));
  assert.ok(!parts.includes("Secure") && !parts.includes("Partitioned") && !parts.includes("SameSite=None"));
});

test("clearing sends an empty value that expires at once, on the same path", () => {
  const parts = refreshCookie({ https: true, slot: "raksha", token: null, maxAgeSeconds: 99 }).split("; ");
  assert.equal(parts[0], "ra_rt_raksha=");
  assert.ok(parts.includes("Max-Age=0") && parts.includes("Path=/v1/auth"));
});

test("each page's slot reads only its own cookie, and only a token-shaped value", () => {
  const header = `theme=dark; ${refreshCookieName("app")}=${TOKEN}; ra_rt_mechanic=${TOKEN.toUpperCase()}`;
  assert.equal(refreshTokenFromCookies(header, "app"), TOKEN);
  assert.equal(refreshTokenFromCookies(header, "mechanic"), TOKEN.toUpperCase());
  assert.equal(refreshTokenFromCookies(header, "raksha"), undefined);
  assert.equal(refreshTokenFromCookies("ra_rt_app=short", "app"), undefined);
  assert.equal(refreshTokenFromCookies(`ra_rt_app=${TOKEN}%3Bx`, "app"), undefined);
  assert.equal(refreshTokenFromCookies(undefined, "app"), undefined);
  assert.ok(carriesRefreshCookie(header));
  assert.ok(!carriesRefreshCookie("theme=dark"));
});
