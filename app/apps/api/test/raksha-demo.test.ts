/**
 * The demo RAKSHA detections the demo deployment seeds at boot: real model
 * output, placed on the corridor exactly as the simulator places them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RAKSHA_DEMO_DETECTIONS, RAKSHA_DEMO_MODEL } from "../src/demo/raksha-demo-detections.js";

test("the boot seed carries the 34 real detections, each with its own op id", () => {
  assert.equal(RAKSHA_DEMO_DETECTIONS.length, 34);
  assert.equal(new Set(RAKSHA_DEMO_DETECTIONS.map((d) => d.opId)).size, 34, "op ids must be unique or replays collapse");
  for (const d of RAKSHA_DEMO_DETECTIONS) {
    assert.match(d.opId, /^cv-[a-zA-Z0-9]{1,24}-\d+$/, "the simulator's op id shape, so a manual upload is a replay");
    assert.equal(d.modelVersion, RAKSHA_DEMO_MODEL, "real model output, not the rule-based simulator");
    assert.ok(d.severity >= 1 && d.severity <= 5 && d.confidence > 0 && d.confidence <= 1);
  }
});

test("every position lies on the NH-48 demo corridor, and says nothing it cannot know", () => {
  for (const d of RAKSHA_DEMO_DETECTIONS) {
    assert.ok(d.lat >= 28.354 && d.lat <= 28.4595 && d.lng >= 76.902 && d.lng <= 77.0266,
      `${d.opId} at ${d.lat},${d.lng} is off the corridor`);
    assert.ok(!("accuracyM" in d), "RDD2022 images carry no GPS; a simulated position must not claim an accuracy");
  }
});
