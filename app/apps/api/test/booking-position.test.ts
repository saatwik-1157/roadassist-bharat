/**
 * Which position a web booking is sent with (apps/web/booking-position.js).
 * The literal file the browser loads is imported, not a copy.
 *
 * The failure this pins is a quiet one: locate() hands back the NH-48 demo
 * point when there is no GPS fix, and the booking used to post it as if it were
 * the user's, so a real mechanic would have been sent to Gurugram. With no fix
 * a booking is now not sent at all unless the user chose the demo point.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import "../../web/booking-position.js";

type Pos = { lat?: number | null; lng?: number | null; demo?: boolean; denied?: boolean; reason?: string; accuracy?: number };
type Decision =
  | { send: true; lat: number; lng: number; demo: boolean; highwayMarker?: string }
  | { send: false; reason: string };
const B = (globalThis as unknown as {
  RABookingPosition: {
    DEMO_POINT: { lat: number; lng: number }; DEMO_MARKER: string; DEMO_NOTE: string;
    hasFix(pos: Pos | null): boolean;
    decide(pos: Pos | null, demoChosen: unknown): Decision;
    advice(reason: string): string;
    choiceHtml(): string;
    notSentHtml(reason: string): string;
  };
}).RABookingPosition;

const APP_HTML = fileURLToPath(new URL("../../web/app.html", import.meta.url));

/** What app.html's locate() resolves with when there is no fix. */
const noFix = (extra: Pos = {}): Pos => ({ lat: B.DEMO_POINT.lat, lng: B.DEMO_POINT.lng, demo: true, ...extra });

describe("booking-position.js", () => {
  it("sends a real fix as measured, whatever the demo choice", () => {
    const fix = { lat: 12.9716, lng: 77.5946, accuracy: 9 };
    assert.deepEqual(B.decide(fix, false), { send: true, lat: 12.9716, lng: 77.5946, demo: false });
    assert.deepEqual(B.decide(fix, true), { send: true, lat: 12.9716, lng: 77.5946, demo: false });
  });

  it("does not send the demo point when there is no fix and the user did not choose it", () => {
    for (const reason of ["denied", "timeout", "unavailable", "unsupported"]) {
      const d = B.decide(noFix({ reason, denied: reason === "denied" }), false);
      assert.equal(d.send, false, reason);
      assert.ok(!("lat" in d) && !("lng" in d), `no coordinate for ${reason}`);
    }
    assert.deepEqual(B.decide(null, false), { send: false, reason: "unchecked" });
  });

  it("only an explicit true counts as choosing the demo point", () => {
    for (const v of [undefined, null, 1, "true", {}]) {
      assert.equal(B.decide(noFix({ reason: "timeout" }), v).send, false, String(v));
    }
  });

  it("sends the demo point, labelled as the demo point, only when chosen", () => {
    assert.deepEqual(B.decide(noFix({ reason: "denied", denied: true }), true), {
      send: true, lat: 28.4595, lng: 77.0266, demo: true, highwayMarker: "NH-48, KM 212 (demo point)",
    });
    // Within the API's 40-character highwayMarker limit.
    assert.ok(B.DEMO_MARKER.length <= 40);
  });

  it("names the reason, so the advice can match it", () => {
    assert.deepEqual(B.decide(noFix({ reason: "denied", denied: true }), false), { send: false, reason: "denied" });
    assert.deepEqual(B.decide(noFix({ reason: "timeout" }), false), { send: false, reason: "timeout" });
    assert.deepEqual(B.decide(noFix(), false), { send: false, reason: "unavailable" });
    assert.match(B.advice("denied"), /Allow location in your browser and try again/);
    assert.match(B.advice("timeout"), /open sky and try again/);
    assert.match(B.advice("unavailable"), /open sky and try again/);
  });

  it("never treats a demo-flagged or half-empty position as a fix", () => {
    assert.equal(B.hasFix(noFix()), false);
    assert.equal(B.hasFix({ lat: null, lng: 77 }), false);
    assert.equal(B.hasFix({ lat: Number.NaN, lng: 77 }), false);
    assert.equal(B.hasFix({ lat: 0, lng: 0 }), true);   // a measured 0,0 is still measured
  });

  it("offers Try again and a demo-only button that says where a mechanic would go", () => {
    const html = B.notSentHtml("denied");
    assert.match(html, /Not sent: no location/);
    assert.match(html, /data-loc='retry'[^>]*>Try again</);
    assert.match(html, /data-loc='demo'[^>]*>Use the NH-48 demo point \(demo only\)</);
    assert.match(html, /A mechanic would be sent to NH-48, Gurugram — for the classroom demo only\./);
  });

  it("uses the same demo point as app.html's locate()", () => {
    const m = /var DEMO_POS = \{ lat: ([\d.]+), lng: ([\d.]+) \}/.exec(readFileSync(APP_HTML, "utf8"));
    assert.ok(m, "DEMO_POS not found in app.html");
    assert.deepEqual({ lat: Number(m[1]), lng: Number(m[2]) }, B.DEMO_POINT);
  });
});
