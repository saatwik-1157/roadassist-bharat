/**
 * Where a RAKSHA point came from, and what the map is allowed to say about it.
 *
 * The authority map now carries two kinds of point: a citizen report placed by
 * the reporting phone's own GPS, and a model detection whose position along
 * NH-48 is SIMULATED because RDD2022 photos carry no GPS. These tests pin the
 * rule that keeps them apart, and the rule that keeps a radius honest: a
 * measured accuracy is kept, a malformed one becomes "not reported", and
 * nothing is ever filled in with a guess.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ACCURACY_CEILING_M, describePosition, formatAccuracy, normaliseAccuracyM,
} from "../src/domain/report-position.js";

describe("normaliseAccuracyM", () => {
  it("keeps a real phone radius, to a tenth of a metre", () => {
    assert.equal(normaliseAccuracyM(8), 8);
    assert.equal(normaliseAccuracyM(12.345), 12.3);
    assert.equal(normaliseAccuracyM(0), 0);
  });

  it("drops what is not a distance rather than repairing it", () => {
    // A negative radius is a client bug; taking its absolute value would turn
    // that bug into a confident-looking measurement.
    assert.equal(normaliseAccuracyM(-5), null);
    assert.equal(normaliseAccuracyM(Number.NaN), null);
    assert.equal(normaliseAccuracyM(Number.POSITIVE_INFINITY), null);
    assert.equal(normaliseAccuracyM("12"), null);
    assert.equal(normaliseAccuracyM(null), null);
    assert.equal(normaliseAccuracyM(undefined), null);
  });

  it("caps a coarse network guess so it cannot paint a circle over a state", () => {
    assert.equal(normaliseAccuracyM(ACCURACY_CEILING_M + 1), ACCURACY_CEILING_M);
    assert.equal(normaliseAccuracyM(1e9), ACCURACY_CEILING_M);
    assert.equal(normaliseAccuracyM(ACCURACY_CEILING_M - 1), ACCURACY_CEILING_M - 1);
  });
});

describe("formatAccuracy", () => {
  it("prints metres, then kilometres", () => {
    assert.equal(formatAccuracy(8), "GPS ±8 m");
    assert.equal(formatAccuracy(8.4), "GPS ±8 m");
    assert.equal(formatAccuracy(999), "GPS ±999 m");
    assert.equal(formatAccuracy(1000), "GPS ±1 km");
    assert.equal(formatAccuracy(1250), "GPS ±1.3 km");
  });

  it("never rounds a sub-metre radius down to a perfect ±0", () => {
    assert.equal(formatAccuracy(0), "GPS ±<1 m");
    assert.equal(formatAccuracy(0.4), "GPS ±<1 m");
  });

  it("says a capped radius is a floor, not a measurement", () => {
    assert.equal(formatAccuracy(ACCURACY_CEILING_M), "GPS ±10 km or worse");
  });

  it("says 'accuracy not reported' when there is nothing to report", () => {
    assert.equal(formatAccuracy(null), "accuracy not reported");
    assert.equal(formatAccuracy(undefined), "accuracy not reported");
    assert.equal(formatAccuracy(Number.NaN), "accuracy not reported");
    assert.equal(formatAccuracy(-3), "accuracy not reported");
  });
});

describe("describePosition", () => {
  const citizen = { source: "citizen", simulated: true, modelVersion: "citizen-report" };

  it("labels a citizen report with the phone's own radius", () => {
    assert.deepEqual(describePosition({ ...citizen, accuracyM: 8 }), {
      provenance: "phone_gps", accuracyM: 8, label: "Reported from a phone · GPS ±8 m",
    });
  });

  it("does not let the crowdsource device's simulated flag mark a phone fix as simulated", () => {
    // Every citizen report is attributed to one bookkeeping device, and that
    // row is simulated:true. The position is still the phone's.
    assert.equal(describePosition({ ...citizen, accuracyM: 20 }).provenance, "phone_gps");
  });

  it("claims no precision for a report that sent no radius", () => {
    const p = describePosition({ ...citizen, accuracyM: null });
    assert.equal(p.accuracyM, null);
    assert.equal(p.label, "Citizen report · accuracy not reported");
  });

  it("marks a model detection SIMULATED and explains why", () => {
    const p = describePosition({ source: "device", simulated: true, modelVersion: "yolo11n-rdd2022-in", accuracyM: null });
    assert.equal(p.provenance, "simulated");
    assert.equal(p.accuracyM, null);
    assert.equal(p.label, "Location SIMULATED (RDD2022 images carry no GPS)");
  });

  it("does not blame RDD2022 for the rule-based patrol, which has no image at all", () => {
    const p = describePosition({ source: "device", simulated: true, modelVersion: "sim-rules-0.1.0", accuracyM: null });
    assert.equal(p.provenance, "simulated");
    assert.equal(p.label, "Location SIMULATED (simulated patrol, no real GPS)");
  });

  it("treats an unknown simulated flag as simulated, never as surveyed", () => {
    assert.equal(describePosition({ source: null, simulated: null, modelVersion: "x", accuracyM: null }).provenance, "simulated");
    assert.equal(describePosition({ source: undefined, simulated: undefined, modelVersion: undefined, accuracyM: 5 }).accuracyM, null);
  });

  it("gives a real device its own GPS, with no radius invented for it", () => {
    assert.deepEqual(describePosition({ source: "device", simulated: false, modelVersion: "yolo", accuracyM: null }), {
      provenance: "device_gps", accuracyM: null, label: "Edge device GPS · accuracy not reported",
    });
  });
});
