/**
 * A photo reference only ever names a file inside UPLOAD_DIR. Device ingestion
 * stores whatever image_ref the device sent, and the photo read and the
 * reject-and-delete both used it as a path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { uploadPath } from "../src/domain/upload-path.js";

const ROOT = resolve("uploads-root-for-test");

test("a key the report path wrote resolves inside the upload directory", () => {
  assert.equal(uploadPath(ROOT, "hazards/abc.jpg"), join(ROOT, "hazards", "abc.jpg"));
});

test("a reference that climbs out of the upload directory names nothing", () => {
  for (const ref of ["../.env", "hazards/../../server.ts", "..", "../uploads-root-for-test-evil/x.jpg"]) {
    assert.equal(uploadPath(ROOT, ref), null, ref);
  }
});

test("an absolute path or a drive letter names nothing", () => {
  assert.equal(uploadPath(ROOT, resolve("/etc/passwd")), null);
  const drive = String.raw`C:\Windows\win.ini`;
  assert.equal(uploadPath(ROOT, drive), process.platform === "win32" ? null : join(ROOT, drive));
});

test("the directory itself, an empty reference, a NUL byte or no reference name nothing", () => {
  for (const ref of ["", ".", "hazards/a\0.jpg", null, undefined]) {
    assert.equal(uploadPath(ROOT, ref), null, String(ref));
  }
});
