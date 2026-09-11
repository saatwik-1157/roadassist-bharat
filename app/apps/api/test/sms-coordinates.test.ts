/**
 * The server half of the SMS SOS contract.
 *
 * The Android client sends `SOS <lat> <lng> RoadAssist` when there is no data
 * coverage. This endpoint used to ignore the two numbers entirely, so the one
 * SOS raised *because* somebody is beyond data coverage was the only SOS that
 * arrived without a location. These tests pin the fix, and pin the refusals
 * just as hard: on an emergency path a confidently wrong coordinate is worse
 * than an honest absence, because it sends a responder somewhere.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseSmsCoordinates } from "../src/domain/sms-coordinates.js";

/** Mirror of the endpoint's own tokenisation, so the tests exercise real input. */
const words = (text: string) => text.trim().toLowerCase().split(/\s+/).filter(Boolean);

describe("parseSmsCoordinates", () => {
  it("reads the fix out of the body the Android client actually sends", () => {
    // Emergency.smsBody(12.971599, 77.594566) — Bengaluru.
    assert.deepEqual(parseSmsCoordinates(words("SOS 12.971599 77.594566 RoadAssist")), {
      lat: 12.971599,
      lng: 77.594566,
    });
  });

  it("accepts the other verbs the endpoint routes to the SOS branch", () => {
    for (const verb of ["sos", "emergency", "112"]) {
      assert.deepEqual(
        parseSmsCoordinates(words(`${verb} 26.9124 75.7873 RoadAssist`)),
        { lat: 26.9124, lng: 75.7873 },
        verb,
      );
    }
  });

  it("keeps full precision — a rounded fix moves a responder", () => {
    // Six decimal places is ~0.1 m. Truncating to four is ~11 m, which on a
    // divided highway is the difference between carriageways.
    const fix = parseSmsCoordinates(words("sos 19.075984 72.877656 roadassist"));
    assert.equal(fix?.lat, 19.075984);
    assert.equal(fix?.lng, 72.877656);
  });

  it("handles negative coordinates", () => {
    assert.deepEqual(parseSmsCoordinates(words("sos -33.8688 -151.2093")), {
      lat: -33.8688,
      lng: -151.2093,
    });
  });

  it("ignores whatever trails the pair", () => {
    assert.deepEqual(
      parseSmsCoordinates(words("SOS 12.5 77.5 RoadAssist sent via Airtel  extra  words")),
      { lat: 12.5, lng: 77.5 },
    );
  });

  describe("refuses rather than guesses", () => {
    it("a bare SOS from a feature phone has no fix, and that is valid", () => {
      // This is the other half of the traffic on this endpoint. It must return
      // null, not throw — the caller asks for a landmark instead.
      assert.equal(parseSmsCoordinates(words("SOS")), null);
      assert.equal(parseSmsCoordinates(words("emergency")), null);
    });

    it("one coordinate is not half a location", () => {
      assert.equal(parseSmsCoordinates(words("SOS 12.971599")), null);
      assert.equal(parseSmsCoordinates(words("SOS 12.971599 RoadAssist")), null);
    });

    it("out-of-range degrees are refused, because PostGIS would not refuse them", () => {
      // ST_MakePoint stores 91 as happily as 89. The check has to be here.
      assert.equal(parseSmsCoordinates(words("sos 91 77")), null);
      assert.equal(parseSmsCoordinates(words("sos -90.1 77")), null);
      assert.equal(parseSmsCoordinates(words("sos 12 181")), null);
      assert.equal(parseSmsCoordinates(words("sos 12 -180.5")), null);
    });

    it("the exact edges of the range are still valid", () => {
      assert.deepEqual(parseSmsCoordinates(words("sos 90 180")), { lat: 90, lng: 180 });
      assert.deepEqual(parseSmsCoordinates(words("sos -90 -180")), { lat: -90, lng: -180 });
    });

    it("Null Island is a broken sensor, not a location", () => {
      // 0,0 is what an uninitialised variable and a cold GPS chip both produce.
      assert.equal(parseSmsCoordinates(words("sos 0 0")), null);
      // But a real zero on one axis only is a real place.
      assert.deepEqual(parseSmsCoordinates(words("sos 0 77.5")), { lat: 0, lng: 77.5 });
    });

    it("rejects anything that is not a plain decimal number", () => {
      // Number() accepts every one of these. An accidental hex parse on an
      // emergency path is a silent 30-degree error.
      for (const bad of ["0x1f", "1e5", "Infinity", "NaN", "12,97", "12.", ".5", "", "--12"]) {
        assert.equal(
          parseSmsCoordinates(["sos", bad, "77.5"]),
          null,
          `lat "${bad}" should be refused`,
        );
        assert.equal(
          parseSmsCoordinates(["sos", "12.5", bad]),
          null,
          `lng "${bad}" should be refused`,
        );
      }
    });

    it("a landmark typed by a human is not coordinates", () => {
      assert.equal(parseSmsCoordinates(words("SOS near NH48 marker 42")), null);
      assert.equal(parseSmsCoordinates(words("sos help me")), null);
    });
  });

  describe("the contract with the Android client", () => {
    /** Kept identical to SosLadder.smsBody in mobile/. */
    const smsBody = (lat: number, lng: number) => `SOS ${lat} ${lng} RoadAssist`;

    it("every body the app can produce round-trips", () => {
      const places: Array<[number, number]> = [
        [12.971599, 77.594566],   // Bengaluru
        [28.613939, 77.209023],   // Delhi
        [9.9312, 76.2673],        // Kochi
        [34.083656, 74.797371],   // Srinagar
        [-11.5, 43.25],           // southern/negative
        [0, 77.5],                // equator
      ];
      for (const [lat, lng] of places) {
        assert.deepEqual(
          parseSmsCoordinates(words(smsBody(lat, lng))),
          { lat, lng },
          `${lat},${lng}`,
        );
      }
    });

    it("stays inside the 160-character limit the endpoint enforces", () => {
      // `text: z.string().max(160)`. Full double precision is the worst case.
      // Computed rather than written out: a literal long enough to be the worst
      // case is also a literal that loses precision, which lint rightly refuses.
      // 1/3 gives the longest representation a double ever prints.
      const body = smsBody(12 + 1 / 3, 77 + 2 / 3);
      assert.ok(body.length <= 160, `body was ${body.length} chars: ${body}`);
      assert.ok(parseSmsCoordinates(words(body)) !== null, "and it must still parse");
    });
  });
});
