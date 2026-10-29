/**
 * The bounded-collections gate (scripts/check-bounded-collections.mjs).
 *
 * The gate exists because a capped zod collection is refused at the cap and an
 * uncapped one validates every element of a hostile body (GHSA-mrhx-c7xc-m3w5).
 * Each shape below is stated twice, capped and uncapped, so a parser that
 * quietly stops seeing a form fails here rather than letting a route through.
 * The last test pins the library behaviour the whole gate rests on.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { z } from "zod";
import { checkSource, scan } from "../../../scripts/check-bounded-collections.mjs";

type Found = { line: number; kind: string; ok: boolean; why?: string; ignored?: string };
const judge = (src: string): Found[] => checkSource(src);
const verdicts = (src: string) => judge(src).map((f) => f.ok);

describe("check-bounded-collections", () => {
  it("a capped array passes and an uncapped one fails", () => {
    assert.deepEqual(verdicts("z.array(z.string()).max(10)"), [true]);
    assert.deepEqual(verdicts("z.array(z.string())"), [false]);
  });

  it("a cap on the element is not a cap on the array", () => {
    assert.deepEqual(verdicts("z.array(z.string().max(12))"), [false]);
    assert.deepEqual(verdicts("z.array(z.string().max(12)).max(10)"), [true]);
  });

  it("reads a chain across lines, comments included, and accepts .length()", () => {
    const multi = "z.array(z.object({\n  a: z.number(),\n}))\n  // why the bounds\n  .min(1)\n  .max(200)";
    assert.deepEqual(verdicts(multi), [true]);
    assert.deepEqual(verdicts("z.array(z.number()).length(3)"), [true]);
    assert.deepEqual(verdicts("z.array(z.number()).min(1).optional()"), [false]);
  });

  it("a parenthesis inside a string or comment does not end the call", () => {
    assert.deepEqual(verdicts('z.array(z.string().regex(/x/, "must look like (this)")).max(5)'), [true]);
    assert.deepEqual(verdicts("z.array(z.string() /* ) */).max(5)"), [true]);
    assert.deepEqual(verdicts('z.array(z.string().describe(")")) .optional()'), [false]);
  });

  it("covers z.set and the .array() method form, each counted once", () => {
    assert.deepEqual(verdicts("z.set(z.string())"), [false]);
    assert.deepEqual(verdicts("z.set(z.string()).max(4)"), [true]);
    assert.deepEqual(verdicts("z.string().array()"), [false]);
    assert.deepEqual(verdicts("z.string().array().max(4)"), [true]);
    assert.equal(judge("z.array(z.string()).max(1)").length, 1);
  });

  it("an opt-out needs a reason on its own line", () => {
    const withReason = "z.array(z.string()) // bounded-collections:ignore built from a constant, never a body";
    const [found] = judge(withReason);
    assert.equal(found.ok, true);
    assert.match(found.ignored ?? "", /never a body/);

    const bare = judge("z.array(z.string()) // bounded-collections:ignore");
    assert.equal(bare[0].ok, false);
    assert.match(bare[0].why ?? "", /needs a reason/);
  });

  it("names the line of each finding", () => {
    const src = "const a = 1;\nconst b = z.array(z.string());\n";
    assert.equal(judge(src)[0].line, 2);
  });

  it("the API and schema sources have no uncapped collection", () => {
    const { problems, collections } = scan();
    assert.ok(collections > 0, "the scan found no collections at all, so it is not looking");
    assert.deepEqual(problems, []);
  });

  it("zod refuses a hostile array at the cap rather than validating every element", () => {
    const hostile = Array.from({ length: 200_000 }, () => 0);
    const capped = z.array(z.string()).max(10).safeParse(hostile);
    assert.equal(capped.success, false);
    assert.equal(capped.error?.issues.length, 1, "the cap must short-circuit: one issue, not one per element");
  });
});
