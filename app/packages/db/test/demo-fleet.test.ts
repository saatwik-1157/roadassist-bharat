/**
 * The demo fleet generator.
 *
 * Written when the hosted demo had no mechanics and every dispatch ended in
 * NO_SUPPLY. The seed runs unattended on every container boot, so the things
 * that matter are pinned here without a database: the numbers are the ones the
 * docs cite, every mechanic is somewhere dispatch near Gurugram can reach, a
 * rerun produces the same fleet (which is what makes the msisdn skip mean
 * "already done"), and it will not run against production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDemoFleet, seedDemoFleet, DEMO_BOUNDS, DEMO_FLEET_SIZE,
} from "../src/seed-demo-fleet.js";

test("24 mechanics, each with a unique msisdn in the documented range", () => {
  const fleet = buildDemoFleet();
  assert.equal(fleet.length, 24);
  assert.equal(DEMO_FLEET_SIZE, 24);

  const numbers = fleet.map((m) => m.msisdn);
  assert.equal(new Set(numbers).size, 24, "duplicate msisdn in the fleet");
  const expected = Array.from({ length: 24 }, (_, i) => `+91${9600000000 + i}`);
  assert.deepEqual([...numbers].sort(), expected);
});

test("every mechanic is inside the Gurugram / NH-48 bounding box", () => {
  const outside = buildDemoFleet().filter((m) =>
    !(m.lng >= DEMO_BOUNDS.minLng && m.lng <= DEMO_BOUNDS.maxLng &&
      m.lat >= DEMO_BOUNDS.minLat && m.lat <= DEMO_BOUNDS.maxLat));
  assert.deepEqual(outside.map((m) => `${m.msisdn} @ ${m.lng},${m.lat}`), []);
});

test("every mechanic is dispatchable: on duty, rated, and able to do something", () => {
  for (const m of buildDemoFleet()) {
    assert.equal(m.isAvailable, true, `${m.msisdn} is off duty`);
    assert.ok(m.rating >= 1 && m.rating <= 5, `${m.msisdn} rating ${m.rating}`);
    assert.ok(m.skills.length >= 2, `${m.msisdn} has no skills`);
    assert.ok(m.displayName.trim().length > 0);
  }
  const names = buildDemoFleet().map((m) => m.displayName);
  assert.equal(new Set(names).size, names.length, "two mechanics share a display name");
});

test("the fleet is deterministic: two calls give equal output", () => {
  assert.deepEqual(buildDemoFleet(), buildDemoFleet());
});

test("it refuses to run with NODE_ENV=production, before touching a database", async () => {
  await assert.rejects(
    () => seedDemoFleet({ NODE_ENV: "production" }),
    /refuses to run with NODE_ENV=production/,
  );
});
