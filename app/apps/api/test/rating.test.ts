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
  PRIOR_MEAN, PRIOR_WEIGHT, rankMechanics, ratingBaseline, ratingPrior, shrunkRating,
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

/* ── a mechanic who arrives with a record ──────────────────────────────────
 * The demo found this: a seeded 4.9 with 436 jobs took one 5★ and read 4.33,
 * because the review was averaged against the platform prior and the stored
 * rating was thrown away. These pin the fold into the rating they already had.
 */

/** What the review route computes for a mechanic's reviews, given their state before the first. */
function afterReviews(stored: number, stars: number[], existingBaseline: number | null = null): number {
  const baseline = ratingBaseline(existingBaseline, stored, 0);
  const sum = stars.reduce((a, b) => a + b, 0);
  return shrunkRating(sum, stars.length, ratingPrior(baseline));
}

test("a 4.9 mechanic's first 5★ nudges them up, never down to 4.33", () => {
  const after = afterReviews(4.9, [5]);
  assert.notEqual(after, 4.33, "the old rule: one glowing review demoted them");
  assert.ok(after > 4.9, `a 5★ is above their 4.9, so it must lift them, got ${after}`);
  assert.ok(after < 4.95, `one review is one review — it should barely move them, got ${after}`);
  assert.equal(after, Number(((PRIOR_WEIGHT * 4.9 + 5) / (PRIOR_WEIGHT + 1)).toFixed(2)));
});

test("a 4.9 mechanic's first harsh review dents them from 4.9, not from the platform mean", () => {
  const after = afterReviews(4.9, [2]);
  assert.ok(after < 4.9, `a 2★ must cost them something, got ${after}`);
  assert.ok(after > 4.3, `and it must not be judged as if they were a 4.2 newcomer, got ${after}`);
});

test("a review always moves a rating toward the stars given, whatever the baseline", () => {
  for (const stored of [1, 2.5, 3.5, 4.2, 4.9, 5]) {
    for (let stars = 1; stars <= 5; stars++) {
      const after = afterReviews(stored, [stars]);
      if (stars > stored) assert.ok(after >= stored, `${stored} + ${stars}★ fell to ${after}`);
      if (stars < stored) assert.ok(after <= stored, `${stored} + ${stars}★ rose to ${after}`);
    }
  }
});

test("a baseline is kept once captured, so later reviews are not double-counted", () => {
  // Second review: stored rating is now the shrunk 4.92, but the baseline stays 4.9.
  assert.equal(ratingBaseline(4.9, 4.92, 1), 4.9);
  // Two reviews folded one at a time equal the same two computed from the rows.
  assert.equal(afterReviews(4.9, [5, 3]), shrunkRating(8, 2, 4.9));
});

test("a real record still washes a baseline out", () => {
  // Fifty 2★ reviews on a mechanic who arrived at 4.9 are believed.
  assert.ok(afterReviews(4.9, Array(50).fill(2)) < 2.3);
});

test("no rating to keep means the platform mean, exactly as before", () => {
  // The column defaults to 0, which means "never rated", not "rated zero".
  assert.equal(ratingBaseline(null, 0, 0), null);
  assert.equal(ratingPrior(null), PRIOR_MEAN);
  assert.equal(afterReviews(0, [2]), shrunkRating(2, 1));
});

test("a mechanic already rated against the platform mean stays on it", () => {
  // Their stored rating is already shrunk toward 4.2; adopting it as a baseline
  // would count their earlier reviews twice.
  assert.equal(ratingBaseline(null, 4.33, 1), null);
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
