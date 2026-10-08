/**
 * RAKSHA's input rules (domain/raksha-input.ts). Each test is a payload that
 * the ingest route or a dashboard read used to get wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPTURED_AT_MAX_AGE_MS, CAPTURED_AT_MAX_FUTURE_MS, capturedAtSchema, capturedAtVerdict,
  detectionSourceKey, isOwnPhotoKey, queryBoolean,
} from "../src/domain/raksha-input.js";

test("capturedAt refuses null, true, numbers and a datetime without an offset", () => {
  for (const v of [null, true, false, 0, 1_700_000_000_000, "", "yesterday", "2026-10-07T09:30:00", "2026-10-07"]) {
    assert.equal(capturedAtSchema.safeParse(v).success, false, JSON.stringify(v));
  }
});

test("capturedAt refuses year 9999 and a reading older than a month", () => {
  assert.equal(capturedAtSchema.safeParse("9999-01-01T00:00:00Z").success, false);
  assert.equal(capturedAtSchema.safeParse("1970-01-01T00:00:00Z").success, false);
  const old = new Date(Date.now() - CAPTURED_AT_MAX_AGE_MS - 60_000).toISOString();
  assert.equal(capturedAtSchema.safeParse(old).success, false);
});

test("capturedAt accepts an instant in the window, in Z or with an offset", () => {
  const z = capturedAtSchema.safeParse(new Date(Date.now() - 3600_000).toISOString());
  assert.ok(z.success && z.data instanceof Date);
  const ist = new Date(Date.now() - 3600_000 + 5.5 * 3600_000).toISOString().replace("Z", "+05:30");
  const parsed = capturedAtSchema.safeParse(ist);
  assert.ok(parsed.success);
  assert.ok(Math.abs(parsed.data.getTime() - (Date.now() - 3600_000)) < 5_000, "the offset is applied, not dropped");
});

test("the capturedAt window: a few minutes fast is drift, more is not", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  assert.equal(capturedAtVerdict(new Date(now.getTime() + CAPTURED_AT_MAX_FUTURE_MS), now), "ok");
  assert.equal(capturedAtVerdict(new Date(now.getTime() + CAPTURED_AT_MAX_FUTURE_MS + 1), now), "in_future");
  assert.equal(capturedAtVerdict(new Date(now.getTime() - CAPTURED_AT_MAX_AGE_MS), now), "ok");
  assert.equal(capturedAtVerdict(new Date(now.getTime() - CAPTURED_AT_MAX_AGE_MS - 1), now), "too_old");
});

test("a boolean query parameter reads 'false' and '0' as false", () => {
  assert.equal(queryBoolean.parse("false"), false);
  assert.equal(queryBoolean.parse("0"), false);
  assert.equal(queryBoolean.parse("true"), true);
  assert.equal(queryBoolean.parse("1"), true);
  for (const v of ["yes", "", "FALSE ", "2"]) assert.equal(queryBoolean.safeParse(v).success, false, v);
});

const frame = {
  modelVersion: "yolo11s-multi-rich-best-1a2b3c4d", type: "pothole", confidence: 0.894, severity: 5,
  lat: 28.4557, lng: 77.0234, capturedAt: new Date("2026-10-07T09:00:00Z"), imageRef: "India_000053.jpg",
};

test("one frame's detection has one source key, whatever position and time an upload gives it", () => {
  const replay = { ...frame, lat: 28.39, lng: 76.96, capturedAt: new Date("2026-10-07T11:00:00Z") };
  assert.equal(detectionSourceKey(replay), detectionSourceKey(frame));
  assert.match(detectionSourceKey(frame), /^[0-9a-f]{64}$/);
});

test("a different model, frame, class, confidence or severity is a different detection", () => {
  const base = detectionSourceKey(frame);
  for (const change of [
    { modelVersion: "yolo11n-multi-edge-best-9f8e7d6c" }, { imageRef: "India_000054.jpg" },
    { type: "road_damage" }, { confidence: 0.893 }, { severity: 4 },
  ]) {
    assert.notEqual(detectionSourceKey({ ...frame, ...change }), base, JSON.stringify(change));
  }
});

test("without a frame the reading itself is the key, so only an exact replay matches", () => {
  const reading = { ...frame, imageRef: undefined };
  assert.equal(detectionSourceKey({ ...reading }), detectionSourceKey(reading));
  assert.notEqual(detectionSourceKey({ ...reading, capturedAt: new Date("2026-10-07T09:00:00.001Z") }),
    detectionSourceKey(reading));
  assert.notEqual(detectionSourceKey({ ...reading, lat: 28.4558 }), detectionSourceKey(reading));
  assert.notEqual(detectionSourceKey(reading), detectionSourceKey(frame));
});

const ID = "6f1c1f0e-6a51-4e43-9d2b-3a4c5d6e7f80";

test("a photo key is this detection's only when the server wrote it for this detection", () => {
  for (const ext of ["jpg", "png", "webp"]) {
    assert.equal(isOwnPhotoKey(`hazards/${ID}.${ext}`, ID), true, ext);
    assert.equal(isOwnPhotoKey(`db:hazards/${ID}.${ext}`, ID), true, `db ${ext}`);
  }
});

test("another report's photo, a device's frame name or a climb is never this detection's", () => {
  const other = "0a0b0c0d-0000-4000-8000-000000000001";
  for (const ref of [
    `hazards/${other}.jpg`, "hazards/victim-citizen.jpg", "India_000053.jpg", `../hazards/${ID}.jpg`,
    `hazards/${ID}.jpg.bak`, `hazards/${ID}.exe`, `x/hazards/${ID}.jpg`, "", null, undefined,
  ]) {
    assert.equal(isOwnPhotoKey(ref, ID), false, String(ref));
  }
});
