/**
 * The rating that decides who gets dispatched.
 *
 * `rankMechanics` weights a mechanic's rating at 34% of their score, so this
 * number is not cosmetic — it decides who earns. These tests pin the property
 * that matters: a single review must not be able to make or break somebody.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  PRIOR_MEAN, PRIOR_WEIGHT, rankMechanics, shrunkRating,
} from "../src/domain/ai-rules.js";

test("a mechanic with no reviews sits at the platform mean, not at zero", () => {
  assert.equal(shrunkRating(0, 0), PRIOR_MEAN);
});

test("one bad review dents the rating instead of destroying it", () => {
  const after = shrunkRating(2, 1);
  assert.ok(after > 3.5, `one 2★ should not crater a mechanic, got ${after}`);
  assert.ok(after < PRIOR_MEAN, `it must still cost them something, got ${after}`);
  assert.equal(after, Number(((PRIOR_WEIGHT * PRIOR_MEAN + 2) / (PRIOR_WEIGHT + 1)).toFixed(2)));
});

test("one glowing review cannot manufacture a top-rated mechanic either", () => {
  assert.ok(shrunkRating(5, 1) < 4.4, "a single 5★ should barely move the number");
});

test("a real record eventually governs: the prior washes out with volume", () => {
  // Fifty consistent 5★ reviews.
  const seasoned = shrunkRating(5 * 50, 50);
  assert.ok(seasoned > 4.85, `fifty 5★ should read close to 5, got ${seasoned}`);
  // …and fifty consistent 2★ reviews are equally believed.
  assert.ok(shrunkRating(2 * 50, 50) < 2.3);
});

test("the rating is bounded by the scale at every volume", () => {
  for (const n of [1, 3, 10, 200]) {
    assert.ok(shrunkRating(1 * n, n) >= 1, "never below the floor of the scale");
    assert.ok(shrunkRating(5 * n, n) <= 5, "never above the top of the scale");
  }
});

test("shrinkage is monotone: a better review never lowers the rating", () => {
  let previous = -Infinity;
  for (let stars = 1; stars <= 5; stars++) {
    const value = shrunkRating(stars, 1);
    assert.ok(value > previous, `${stars}★ should rank above ${stars - 1}★`);
    previous = value;
  }
});

test("dispatch prefers the nearer mechanic when quality is equal", () => {
  const [first] = rankMechanics([
    { distanceKm: 12, rating: 4.5, jobsCompleted: 100 },
    { distanceKm: 3, rating: 4.5, jobsCompleted: 100 },
  ]);
  assert.equal(first.distanceKm, 3);
});

test("a newcomer's exploration bonus cannot outrank a much closer mechanic", () => {
  // 0.06 of exploration must not beat 0.6-weighted proximity across 20 km.
  const [first] = rankMechanics([
    { distanceKm: 1, rating: 4.2, jobsCompleted: 500 },
    { distanceKm: 21, rating: 4.2, jobsCompleted: 0 },
  ]);
  assert.equal(first.distanceKm, 1);
});
