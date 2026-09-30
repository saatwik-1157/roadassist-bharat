/**
 * Location services: what leaves the server, how often, and what comes back.
 * The providers are donated public services, so pacing and coarsening are
 * obligations, not tuning - these pin them without touching the network.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  aqiBand, coarsen, geoServicesEnabled, haversineKm, inIndia, overpassQuery, Pacer, PacerFull,
  parseAirQuality, parseNominatim, parseOsrm, parseOverpass, parseUsgs, TtlCache,
} from "../src/domain/geo.js";

describe("coarsen and region", () => {
  it("rounds to ~110 m by default and ~1 km at 2 dp", () => {
    assert.equal(coarsen(28.459512), 28.46);
    assert.equal(coarsen(77.026649), 77.027);
    assert.equal(coarsen(28.459512, 2), 28.46);
  });
  it("covers India and refuses elsewhere, the exact edges included", () => {
    assert.ok(inIndia(28.46, 77.03));
    assert.ok(inIndia(5, 67) && inIndia(38, 98), "the box edges are inside");
    assert.ok(!inIndia(51.5, -0.12));
    assert.ok(!inIndia(4.99, 77));
  });
  it("measures a known distance", () => {
    const km = haversineKm({ lat: 28.4595, lng: 77.0266 }, { lat: 28.6139, lng: 77.209 });
    assert.ok(km > 24 && km < 25, `Gurugram to New Delhi ~24.5 km, got ${km}`);
  });
});

describe("geoServicesEnabled", () => {
  it("is off in local environments and on elsewhere unless set", () => {
    assert.equal(geoServicesEnabled(undefined, true), false);
    assert.equal(geoServicesEnabled(undefined, false), true);
    assert.equal(geoServicesEnabled("on", true), true);
    assert.equal(geoServicesEnabled("off", false), false);
    assert.equal(geoServicesEnabled(" TRUE ", true), true);
  });
});

describe("TtlCache", () => {
  it("expires after its time-to-live and evicts the oldest past its size", () => {
    let t = 0;
    const c = new TtlCache<number>(1000, 2, () => t);
    c.set("a", 1); c.set("b", 2);
    assert.equal(c.get("a"), 1);
    c.set("c", 3);
    assert.equal(c.size, 2);
    t = 1000; assert.equal(c.get("b"), 2, "exactly at the TTL still counts as fresh");
    t = 1001; assert.equal(c.get("b"), undefined);
  });
  it("keeps a cached null, so a place with no address is not asked about again", () => {
    const c = new TtlCache<null | number>(1000, 5);
    c.set("x", null);
    assert.equal(c.get("x"), null);
  });
});

describe("Pacer", () => {
  it("spaces calls at least gapMs apart and runs them in order", async () => {
    let t = 0; const starts: number[] = [];
    const p = new Pacer(1000, 5, () => t, async (ms) => { t += ms; });
    await Promise.all([1, 2, 3].map((n) => p.run(async () => { starts.push(t); return n; })));
    assert.deepEqual(starts, [0, 1000, 2000]);
  });
  it("refuses once its queue is full instead of growing without end", async () => {
    const p = new Pacer(10_000, 2, () => 0, () => new Promise(() => {}));
    p.run(async () => 1).catch(() => {}); p.run(async () => 2).catch(() => {});
    await assert.rejects(p.run(async () => 3), PacerFull);
  });
  it("keeps going after a call fails", async () => {
    const p = new Pacer(0);
    await assert.rejects(p.run(async () => { throw new Error("boom"); }));
    assert.equal(await p.run(async () => 7), 7);
  });
});

describe("parseNominatim", () => {
  it("builds a readable line from an Indian address", () => {
    const a = parseNominatim({ address: {
      road: "Delhi-Jaipur Expressway", suburb: "Sector 34", city: "Gurugram",
      state_district: "Gurugram", state: "Haryana", postcode: "122004", country: "India",
    } });
    assert.equal(a?.label, "Delhi-Jaipur Expressway, Sector 34, Gurugram, Haryana 122004");
    assert.equal(a?.district, "Gurugram");
  });
  it("returns null rather than an empty place", () => {
    assert.equal(parseNominatim({ error: "Unable to geocode" }), null);
    assert.equal(parseNominatim({ address: {} }), null);
  });
});

describe("overpass", () => {
  it("asks for every help kind around the point", () => {
    const q = overpassQuery(28.46, 77.03, 5000);
    for (const tag of ["hospital", "police", "fuel", "charging_station", "car_repair", "tyres"]) assert.ok(q.includes(`"${tag}"`), tag);
    assert.ok(q.includes("(around:5000,28.46,77.03)"));
  });
  it("groups places by kind, nearest first, with only a plausible phone", () => {
    const g = parseOverpass({ elements: [
      { type: "node", lat: 28.47, lon: 77.03, tags: { amenity: "hospital", name: "Far Hospital", phone: "+91 124 000 0000" } },
      { type: "node", lat: 28.461, lon: 77.03, tags: { amenity: "hospital", name: "Near Hospital", phone: "call us" } },
      { type: "way", center: { lat: 28.462, lon: 77.031 }, tags: { amenity: "fuel" } },
      { type: "node", lat: 28.463, lon: 77.032, tags: { amenity: "charging_station", name: "EV Hub" } },
      { type: "node", lat: 28.464, lon: 77.033, tags: { shop: "tyres", name: "Tyre Point" } },
      { type: "node", lat: 28.465, lon: 77.034, tags: { amenity: "bench" } },
    ] }, { lat: 28.46, lng: 77.03 });
    assert.deepEqual(g.hospital.map((p) => p.name), ["Near Hospital", "Far Hospital"]);
    assert.equal(g.hospital[0].phone, null, "free text is not a phone number");
    assert.equal(g.hospital[1].phone, "+91 124 000 0000");
    assert.equal(g.fuel[0].name, "Fuel (unnamed)", "a way is placed by its centre");
    assert.equal(g.charging[0].name, "EV Hub");
    assert.equal(g.repair[0].name, "Tyre Point");
    assert.equal(g.police.length, 0);
  });
});

describe("parseOsrm", () => {
  it("reads distance and duration, and refuses anything but an Ok route", () => {
    assert.deepEqual(parseOsrm({ code: "Ok", routes: [{ distance: 12345, duration: 1500 }] }), { distanceKm: 12.3, durationMin: 25 });
    assert.equal(parseOsrm({ code: "NoRoute", routes: [] }), null);
    assert.deepEqual(parseOsrm({ code: "Ok", routes: [{ distance: 50, duration: 10 }] })?.durationMin, 1, "never a zero-minute ETA");
  });
});

describe("air quality", () => {
  it("bands the US AQI at its published edges", () => {
    assert.equal(aqiBand(50), "Good");
    assert.equal(aqiBand(51), "Moderate");
    assert.equal(aqiBand(150), "Unhealthy for sensitive groups");
    assert.equal(aqiBand(151), "Unhealthy");
    assert.equal(aqiBand(301), "Hazardous");
  });
  it("parses the current reading, or null without one", () => {
    assert.deepEqual(parseAirQuality({ current: { us_aqi: 172.4, pm2_5: 88.1, pm10: 140 } }),
      { usAqi: 172, pm25: 88.1, pm10: 140, band: "Unhealthy" });
    assert.equal(parseAirQuality({ current: {} }), null);
  });
});

describe("parseUsgs", () => {
  it("lists quakes newest first and keeps only USGS links", () => {
    const q = parseUsgs({ features: [
      { properties: { mag: 4.26, place: "10 km N of A", time: Date.UTC(2026, 8, 1), url: "https://earthquake.usgs.gov/x" }, geometry: { coordinates: [77, 30, 10.4] } },
      { properties: { mag: 5.1, place: "B", time: Date.UTC(2026, 8, 3), url: "https://evil.example/x" }, geometry: { coordinates: [80, 28, 33] } },
      { properties: { mag: null, place: "no magnitude" }, geometry: { coordinates: [80, 28, 1] } },
    ] });
    assert.equal(q.length, 2);
    assert.equal(q[0].magnitude, 5.1);
    assert.equal(q[0].url, null);
    assert.equal(q[1].magnitude, 4.3);
    assert.equal(q[1].depthKm, 10);
  });
});
