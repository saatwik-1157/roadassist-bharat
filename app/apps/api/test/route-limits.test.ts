/**
 * The tile proxies fetch from OpenStreetMap under this platform's name, so
 * they only ask for tiles that exist, over the region the platform maps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { tileAllowed, tileCentre } from "../src/route-limits.js";

// Web Mercator tile holding a lat/lng at zoom z - the inverse of tileCentre.
function tileOf(lat: number, lng: number, z: number) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
}

test("a tile over India is fetched at every zoom the maps use", () => {
  for (const z of [6, 11, 15, 18]) {
    const { x, y } = tileOf(28.4595, 77.0266, z);   // Gurugram
    assert.ok(tileAllowed(z, x, y), `zoom ${z}`);
  }
  const { x, y } = tileOf(8.08, 77.55, 12);          // Kanyakumari
  assert.ok(tileAllowed(12, x, y));
});

test("a tile that does not exist at its zoom is refused, the exact edge included", () => {
  assert.ok(!tileAllowed(3, 8, 0), "x = 2^z is past the last column");
  assert.ok(!tileAllowed(3, 0, 8), "y = 2^z is past the last row");
  assert.ok(tileAllowed(3, 7, 7), "x = y = 2^z - 1 is the last tile, and at zoom 3 anywhere goes");
  assert.ok(!tileAllowed(10, -1, 5));
});

test("from zoom 6 a tile far from the region is refused; below it the world is allowed", () => {
  const london = tileOf(51.5, -0.12, 12), newYork = tileOf(40.7, -74, 8);
  assert.ok(!tileAllowed(12, london.x, london.y));
  assert.ok(!tileAllowed(8, newYork.x, newYork.y));
  assert.ok(tileAllowed(5, 0, 0), "a zoom-5 tile spans a subcontinent");
});

test("tileCentre agrees with the tile it came from", () => {
  const { x, y } = tileOf(28.4595, 77.0266, 14);
  const c = tileCentre(14, x, y);
  assert.ok(Math.abs(c.lat - 28.4595) < 0.02 && Math.abs(c.lng - 77.0266) < 0.02);
});

test("the edge's client-address header is used only when it holds a real IP", async () => {
  const { clientIpFrom } = await import("../src/client-ip.js");
  assert.equal(clientIpFrom("203.0.113.7"), "203.0.113.7");
  assert.equal(clientIpFrom(" 2001:db8::1 "), "2001:db8::1");
  assert.equal(clientIpFrom("1.2.3.4, 5.6.7.8"), null, "a list is somebody's claim, not the edge's value");
  assert.equal(clientIpFrom(undefined), null);
  assert.equal(clientIpFrom("not-an-ip"), null);
});
