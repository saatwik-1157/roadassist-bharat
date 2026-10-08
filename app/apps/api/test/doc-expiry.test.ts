/**
 * Vehicle-document countdowns on the IST calendar (domain/doc-expiry.ts).
 *
 * The count ran to UTC midnight, which is a different day for the first five
 * and a half hours of every Indian day.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { daysToExpiry, expiryState } from "../src/domain/doc-expiry.js";

// A PUC "valid till 7 October 2026", entered as a bare date (parsed as UTC midnight).
const expiresOn = new Date("2026-10-07");
const ist = (s: string) => new Date(s + "+05:30");

test("the last valid day reads 0 all day in India, including before 05:30", () => {
  assert.equal(daysToExpiry(expiresOn, ist("2026-10-07T00:30:00")), 0);
  assert.equal(daysToExpiry(expiresOn, ist("2026-10-07T03:00:00")), 0);
  assert.equal(daysToExpiry(expiresOn, ist("2026-10-07T23:59:00")), 0);
  assert.equal(expiryState(0), "expiring");
});

test("it is expired from IST midnight, not from 05:30 the next morning", () => {
  const days = daysToExpiry(expiresOn, ist("2026-10-08T02:00:00"));
  assert.equal(days, -1);
  assert.equal(expiryState(days), "expired");
});

test("the day before reads 1, whatever the hour", () => {
  assert.equal(daysToExpiry(expiresOn, ist("2026-10-06T01:00:00")), 1);
  assert.equal(daysToExpiry(expiresOn, ist("2026-10-06T22:00:00")), 1);
});

test("an expiry stored at IST midnight lands on the same day", () => {
  assert.equal(daysToExpiry(ist("2026-10-07T00:00:00"), ist("2026-10-07T12:00:00")), 0);
});

test("states", () => {
  assert.equal(expiryState(null), "unknown");
  assert.equal(expiryState(31), "valid");
  assert.equal(expiryState(30), "expiring");
});
