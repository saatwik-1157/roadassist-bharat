/**
 * Where the per-IP limits get the caller's address from (src/client-ip.ts).
 *
 * The live service runs with TRUST_PROXY=true, under which Fastify's req.ip
 * is the leftmost X-Forwarded-For entry: whatever the client wrote. These
 * pin that CLIENT_IP_HEADER, once set, is the only source - a forged
 * X-Forwarded-For moves nothing, and a request without the header lands on
 * the socket peer, not on the forgeable value - and that with the header
 * unset nothing changes until an operator sets it.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { ipHeaderPresence, registerClientIp } from "../src/client-ip.js";

const EDGE_SEEN = "198.51.100.9", FORGED = "203.0.113.1", PEER = "10.0.0.7";

async function server(header: string | undefined) {
  const app = Fastify({ trustProxy: true });
  registerClientIp(app, header);
  app.get("/ip", async (req) => ({ ip: req.ip }));
  await app.ready();
  return app;
}

async function ipOf(app: Awaited<ReturnType<typeof server>>, headers: Record<string, string>) {
  const res = await app.inject({ method: "GET", url: "/ip", headers, remoteAddress: PEER });
  return (res.json() as { ip: string }).ip;
}

describe("CLIENT_IP_HEADER behind a proxy that is trusted for every hop", () => {
  it("with cf-connecting-ip set, a forged X-Forwarded-For does not change the address", async () => {
    const app = await server("cf-connecting-ip");
    assert.equal(await ipOf(app, { "cf-connecting-ip": EDGE_SEEN }), EDGE_SEEN);
    for (const xff of [FORGED, `${FORGED}, 192.0.2.50`, "192.0.2.77"]) {
      assert.equal(await ipOf(app, { "cf-connecting-ip": EDGE_SEEN, "x-forwarded-for": xff }), EDGE_SEEN, xff);
    }
    await app.close();
  });

  it("a request without the header, or with no valid IP in it, falls back to the socket peer, not X-Forwarded-For", async () => {
    const app = await server("CF-Connecting-IP ");
    assert.equal(await ipOf(app, { "x-forwarded-for": FORGED }), PEER);
    assert.equal(await ipOf(app, { "x-forwarded-for": FORGED, "cf-connecting-ip": "" }), PEER);
    assert.equal(await ipOf(app, { "x-forwarded-for": FORGED, "cf-connecting-ip": `${FORGED}, 192.0.2.50` }), PEER);
    assert.equal(await ipOf(app, { "x-forwarded-for": FORGED, "cf-connecting-ip": "not-an-ip" }), PEER);
    await app.close();
  });

  it("with the header unset, nothing changes: req.ip is still Fastify's", async () => {
    for (const header of [undefined, "", "  "]) {
      const app = await server(header);
      assert.equal(await ipOf(app, { "x-forwarded-for": FORGED }), FORGED, `CLIENT_IP_HEADER=${JSON.stringify(header)}`);
      await app.close();
    }
  });
});

describe("ipHeaderPresence", () => {
  it("reports presence and an entry count, never a value", () => {
    const out = ipHeaderPresence({
      "cf-connecting-ip": EDGE_SEEN, "x-real-ip": " ", "x-forwarded-for": `${FORGED}, 192.0.2.50,`,
    });
    assert.deepEqual(out, { cfConnectingIp: true, trueClientIp: false, xRealIp: false, xffEntries: 2 });
    assert.deepEqual(ipHeaderPresence({ "true-client-ip": EDGE_SEEN, "x-forwarded-for": [FORGED, "192.0.2.50, 192.0.2.51"] }),
      { cfConnectingIp: false, trueClientIp: true, xRealIp: false, xffEntries: 3 });
    assert.deepEqual(ipHeaderPresence(undefined), { cfConnectingIp: false, trueClientIp: false, xRealIp: false, xffEntries: 0 });
    for (const v of Object.values(out)) assert.ok(typeof v === "boolean" || typeof v === "number");
  });
});
