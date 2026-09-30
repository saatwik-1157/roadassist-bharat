/**
 * Where a hazard photo is kept and how big it may be (ADR-0013,
 * domain/photo-store.ts). The hosted demo's disk is wiped on every redeploy, so
 * picking disk there by default loses every photo, silently; and a cap the
 * database does not share is a cap that some other write path gets around.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DB_PHOTO_MAX_BYTES, describeCap, isDbPhotoRef, photoByteCap, photoSizeVerdict, photoStoreFor,
} from "../src/domain/photo-store.js";

describe("photoStoreFor", () => {
  it("defaults to the database on the hosted demo and in production", () => {
    assert.equal(photoStoreFor(undefined, "demo"), "db");
    assert.equal(photoStoreFor(undefined, "production"), "db");
    assert.equal(photoStoreFor("", "demo"), "db", "an empty value is unset, as in a blank .env line");
  });
  it("defaults to disk on a developer's machine and in test runs", () => {
    for (const e of ["development", "test", "ci", undefined]) assert.equal(photoStoreFor(undefined, e), "disk", String(e));
  });
  it("lands an unexpected NODE_ENV on the durable side", () => {
    assert.equal(photoStoreFor(undefined, "staging"), "db");
    assert.equal(photoStoreFor(undefined, "prodution"), "db");
  });
  it("lets PHOTO_STORE override either way, whatever its case and spacing", () => {
    assert.equal(photoStoreFor("db", "development"), "db");
    assert.equal(photoStoreFor(" DB ", "test"), "db");
    assert.equal(photoStoreFor("disk", "demo"), "disk");
  });
  it("refuses a value that is neither rather than guessing", () => {
    for (const v of ["database", "s3", "true", "0"]) {
      assert.throws(() => photoStoreFor(v, "demo"), /PHOTO_STORE="[^"]*" is not a photo store/, v);
    }
  });
});

describe("the size cap", () => {
  it("is 600 KiB on the database store", () => {
    assert.equal(DB_PHOTO_MAX_BYTES, 614_400);
    assert.equal(photoByteCap("db", 4_000_000), 614_400);
    assert.equal(photoByteCap("db", 100_000), 100_000, "a lower UPLOAD_MAX_BYTES still wins");
    assert.equal(photoByteCap("disk", 4_000_000), 4_000_000, "disk keeps UPLOAD_MAX_BYTES");
  });
  it("allows exactly the cap and refuses one byte more", () => {
    assert.equal(photoSizeVerdict(614_400, 614_400), "ok");
    assert.equal(photoSizeVerdict(614_401, 614_400), "photo_too_large");
    assert.equal(photoSizeVerdict(1, 614_400), "ok");
  });
  it("calls an empty photo empty, not too large", () => {
    assert.equal(photoSizeVerdict(0, 614_400), "photo_empty");
    assert.equal(photoSizeVerdict(Number.NaN, 614_400), "photo_empty");
  });
  it("reads as a size a person understands", () => {
    assert.equal(describeCap(614_400), "600 KB");
    assert.equal(describeCap(4_000_000), "4 MB");
  });
  it("is the same number as the database CHECK in migrate.ts", () => {
    const migrate = readFileSync(
      fileURLToPath(new URL("../../../packages/db/src/migrate.ts", import.meta.url)), "utf8");
    const m = migrate.match(/raksha_photos_size_cap", "CHECK \(octet_length\(bytes\) BETWEEN 1 AND (\d+)\)"/);
    assert.ok(m, "migrate.ts has no raksha_photos_size_cap CHECK");
    assert.equal(Number(m[1]), DB_PHOTO_MAX_BYTES);
  });
});

describe("isDbPhotoRef", () => {
  it("tells a database photo from a file key or a device's frame name", () => {
    assert.equal(isDbPhotoRef("db:hazards/abc.jpg"), true);
    assert.equal(isDbPhotoRef("hazards/abc.jpg"), false);
    assert.equal(isDbPhotoRef("India_000053.jpg"), false);
    assert.equal(isDbPhotoRef(null), false);
    assert.equal(isDbPhotoRef(undefined), false);
  });
});
