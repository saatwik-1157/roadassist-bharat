/**
 * Timestamps on the wire.
 *
 * Raw `db.execute` rows carry Postgres's own timestamp text, and the mechanic
 * console's History showed "Invalid Date" for every job because it tried to
 * parse "2026-09-25 08:26:43.59901+00" itself. The API now serialises those to
 * ISO 8601 where they leave the database; these tests pin the formats Postgres
 * actually prints, and that the result is something every browser parses.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isoTimestamp, withIsoTimestamps } from "../src/http.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("the exact value from the demo becomes ISO, at the same instant", () => {
  const out = isoTimestamp("2026-09-25 08:26:43.59901+00");
  assert.equal(out, "2026-09-25T08:26:43.599Z");
});

test("the console's old parse of the raw value is what failed", () => {
  // Documents the bug rather than the fix: replacing the space leaves an
  // hour-only offset that no Date parser accepts.
  assert.ok(Number.isNaN(new Date("2026-09-25 08:26:43.59901+00".replace(" ", "T")).getTime()));
  // …and the same parse of the ISO value the API now sends is harmless.
  assert.ok(!Number.isNaN(new Date(isoTimestamp("2026-09-25 08:26:43.59901+00")!.replace(" ", "T")).getTime()));
});

test("every offset shape Postgres prints lands on the right instant", () => {
  assert.equal(isoTimestamp("2026-09-25 13:56:43.599+05:30"), "2026-09-25T08:26:43.599Z");
  assert.equal(isoTimestamp("2026-09-25 13:56:43+0530"), "2026-09-25T08:26:43.000Z");
  assert.equal(isoTimestamp("2026-09-25 03:26:43-05"), "2026-09-25T08:26:43.000Z");
});

test("a whole-second value and a zoneless value (read as UTC, as drizzle does)", () => {
  assert.equal(isoTimestamp("2026-09-25 08:26:43+00"), "2026-09-25T08:26:43.000Z");
  assert.equal(isoTimestamp("2026-09-25 08:26:43.5"), "2026-09-25T08:26:43.500Z");
});

test("values that are already right pass through as ISO", () => {
  assert.equal(isoTimestamp("2026-09-25T08:26:43.599Z"), "2026-09-25T08:26:43.599Z");
  assert.equal(isoTimestamp(new Date("2026-09-25T08:26:43.599Z")), "2026-09-25T08:26:43.599Z");
});

test("absent is null, and nonsense is returned as-is rather than invented", () => {
  assert.equal(isoTimestamp(null), null);
  assert.equal(isoTimestamp(undefined), null);
  assert.equal(isoTimestamp("infinity"), "infinity");
});

test("every output is strict ISO that any browser parses", () => {
  for (const raw of ["2026-01-01 00:00:00+00", "2026-12-31 23:59:59.999999+00", "2026-09-25 08:26:43.59901+05:30"]) {
    const out = isoTimestamp(raw)!;
    assert.match(out, ISO, raw);
    assert.equal(new Date(out).toISOString(), out);
  }
});

test("a raw row has only the named columns rewritten", () => {
  const row = { id: "x", created_at: "2026-09-25 08:26:43.59901+00", notes: "2026-09-25 08:26:43+00" };
  const out = withIsoTimestamps(row, ["created_at", "missing_at"]);
  assert.equal(out.created_at, "2026-09-25T08:26:43.599Z");
  assert.equal(out.notes, row.notes, "a column not named is data, not a timestamp");
  assert.equal("missing_at" in out, false, "a column not in the row is not invented");
  assert.equal(row.created_at, "2026-09-25 08:26:43.59901+00", "the input row is not mutated");
});
