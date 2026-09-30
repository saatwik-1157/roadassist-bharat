/**
 * The citizen app's photo shrinking (apps/web/photo-shrink.js). The literal
 * file the browser loads is imported, not a copy. The canvas drawing itself
 * needs a browser; what is pinned here is the geometry, the order of the
 * fallbacks, and that the client aims at the same cap the server enforces.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import "../../web/photo-shrink.js";
import { DB_PHOTO_MAX_BYTES } from "../src/domain/photo-store.js";

type Fit = { blob: { size: number }; side: number; quality: number };
const S = (globalThis as unknown as {
  RAPhotoShrink: {
    MAX_BYTES: number; LADDER: Array<[number, number]>;
    fitWithin(w: number, h: number, max: number): { width: number; height: number };
    firstFit(encode: (side: number, q: number) => Promise<{ size: number }>, ladder: Array<[number, number]>, max: number): Promise<Fit>;
  };
}).RAPhotoShrink;

describe("photo-shrink.js", () => {
  it("aims at the server's own cap", () => {
    assert.equal(S.MAX_BYTES, DB_PHOTO_MAX_BYTES);
  });

  it("brings a camera photo's longest side to 1280 px, either orientation", () => {
    assert.deepEqual(S.fitWithin(4000, 3000, 1280), { width: 1280, height: 960 });
    assert.deepEqual(S.fitWithin(3000, 4000, 1280), { width: 960, height: 1280 });
    assert.deepEqual(S.fitWithin(8000, 1000, 1280), { width: 1280, height: 160 });
  });

  it("never enlarges a small photo and never makes a zero-pixel side", () => {
    assert.deepEqual(S.fitWithin(640, 480, 1280), { width: 640, height: 480 });
    assert.deepEqual(S.fitWithin(1280, 1280, 1280), { width: 1280, height: 1280 });
    assert.deepEqual(S.fitWithin(10000, 1, 1280), { width: 1280, height: 1 });
  });

  it("starts at 1280 px and quality 0.8", () => {
    assert.deepEqual(S.LADDER[0], [1280, 0.8]);
  });

  it("stops at the first rung that fits, exactly the cap included", async () => {
    const tried: string[] = [];
    const sizes = [700_000, 614_400];
    const fit = await S.firstFit(async (side, q) => {
      tried.push(`${side}@${q}`);
      return { size: sizes[tried.length - 1] ?? 1 };
    }, S.LADDER, S.MAX_BYTES);
    assert.deepEqual(tried, ["1280@0.8", "1280@0.7"]);
    assert.equal(fit.blob.size, 614_400);
  });

  it("says so plainly when nothing on the ladder fits", async () => {
    let calls = 0;
    await assert.rejects(
      S.firstFit(async () => { calls++; return { size: S.MAX_BYTES + 1 }; }, S.LADDER, S.MAX_BYTES),
      /too detailed to send/,
    );
    assert.equal(calls, S.LADDER.length, "every rung is tried before giving up");
  });

  it("treats a failed encode (toBlob gives null) as not fitting", async () => {
    let calls = 0;
    const fit = await S.firstFit(async () => (++calls === 1 ? null as unknown as { size: number } : { size: 10 }),
      S.LADDER, S.MAX_BYTES);
    assert.equal(calls, 2);
    assert.equal(fit.blob.size, 10);
  });
});
