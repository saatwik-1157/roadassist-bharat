/**
 * The server's log lines carry no position, no phone number and no client
 * address (src/logging.ts, src/domain/log-redaction.ts).
 *
 * The access log recorded every request URL in full - /v1/map/live?lat=..
 * &lng=.. on every map refresh - and the caller's IP beside it. These run a
 * Fastify instance with the exact logger configuration server.ts uses, send
 * it requests carrying coordinates and a phone number, and read every line
 * it wrote.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { loggerOptions } from "../src/logging.js";
import {
  ipForLog, principalForLog, scrubLogObject, scrubLogText, urlForLog,
} from "../src/domain/log-redaction.js";

const LAT = "28.61394", LNG = "77.20902", PHONE = "+917000004321", DIGITS = "7000004321";
const CLIENT_IP = "203.0.113.77", EMAIL = "priya.sharma@example.com", CHAT = "5123456789";

async function serverWithCapturedLog() {
  const lines: string[] = [];
  const app = Fastify({
    logger: loggerOptions({ level: "info", stream: { write: (l: string) => { lines.push(l); } } }),
  });
  app.get("/v1/map/live", async (req) => {
    const q = req.query as { lat?: string; lng?: string };
    // A careless call site: every forbidden thing, as fields and in the message.
    req.log.info({ lat: Number(q.lat), lng: Number(q.lng), msisdn: PHONE, telegramChatId: CHAT, ip: req.ip },
      `looked up ${PHONE} at ${q.lat},${q.lng} for ${EMAIL} from ${req.ip}`);
    return { ok: true };
  });
  app.post("/v1/sos", async () => {
    // What drizzle throws: the SQL and every bound value in the message.
    throw new Error(`Failed query: insert into incidents values ($1, $2, $3)\nparams: ${PHONE},${LAT},${LNG}`);
  });
  app.get("/tiles/:z/:x/:file", async () => ({ ok: true }));
  await app.ready();
  return { app, text: () => lines.join("") };
}

describe("the access log and every other line", () => {
  it("a request carrying coordinates and a phone number logs neither, nor the client's address", async () => {
    const { app, text } = await serverWithCapturedLog();
    const res = await app.inject({
      method: "GET", url: `/v1/map/live?lat=${LAT}&lng=${LNG}&msisdn=${encodeURIComponent(PHONE)}&limit=5`,
      remoteAddress: CLIENT_IP,
    });
    assert.equal(res.statusCode, 200);
    const log = text();
    assert.ok(log.includes("/v1/map/live?limit=5&[redacted]"), "the path and the allow-listed key are kept");
    for (const leak of [LAT, LNG, DIGITS, CLIENT_IP, EMAIL, CHAT, "remoteAddress", "remotePort"]) {
      assert.ok(!log.includes(leak), `log contains ${leak}:\n${log}`);
    }
    await app.close();
  });

  it("an error's message and stack lose the query's bound values", async () => {
    const { app, text } = await serverWithCapturedLog();
    const res = await app.inject({ method: "POST", url: "/v1/sos", payload: {}, remoteAddress: CLIENT_IP });
    assert.equal(res.statusCode, 500);
    const log = text();
    assert.ok(log.includes("params: [redacted]"), log);
    for (const leak of [LAT, LNG, DIGITS, CLIENT_IP]) assert.ok(!log.includes(leak), `log contains ${leak}:\n${log}`);
    await app.close();
  });

  it("a map tile is logged by its zoom only", async () => {
    const { app, text } = await serverWithCapturedLog();
    await app.inject({ method: "GET", url: "/tiles/16/46782/27512.png" });
    assert.ok(text().includes("/tiles/16/[redacted]") && !text().includes("46782"), text());
    await app.close();
  });
});

describe("urlForLog", () => {
  it("keeps only allow-listed query keys", () => {
    assert.equal(urlForLog("/v1/bookings?limit=10"), "/v1/bookings?limit=10");
    assert.equal(urlForLog(`/v1/geo/route?fromLat=${LAT}&fromLng=${LNG}&toLat=1.2345&toLng=2.3456`), "/v1/geo/route?[redacted]");
    assert.equal(urlForLog("/v1/incidents/x/medical?reason=Priya%20collapsed%20at%20home"), "/v1/incidents/x/medical?[redacted]");
    assert.equal(urlForLog("/v1/me"), "/v1/me");
    assert.equal(urlForLog("/v1/me?"), "/v1/me");
  });
  it("drops the Google callback's code and state", () => {
    assert.equal(urlForLog("/v1/auth/google/callback?state=abc&code=4/0AQ"), "/v1/auth/google/callback?[redacted]");
  });
});

describe("ipForLog / principalForLog", () => {
  it("coarsens IPv4 to /24 and IPv6 to /48, and leaves loopback alone", () => {
    assert.equal(ipForLog(CLIENT_IP), "203.0.113.0/24");
    assert.equal(ipForLog("::ffff:203.0.113.77"), "203.0.113.0/24");
    assert.equal(ipForLog("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd::/48");
    assert.equal(ipForLog("2001:db8::1"), "2001:db8:0::/48");
    assert.equal(ipForLog("127.0.0.1"), "127.0.0.1");
    assert.equal(ipForLog("::1"), "::1");
    assert.equal(ipForLog(undefined), "unknown");
  });
  it("masks a sending number and coarsens an address, keeps an account id", () => {
    assert.equal(principalForLog(`ip:${CLIENT_IP}`), "ip:203.0.113.0/24");
    assert.equal(principalForLog(`msisdn:${PHONE}`), "msisdn:+91******4321");
    assert.equal(principalForLog("7d0c1e9a-0000-4000-8000-000000000000"), "7d0c1e9a-0000-4000-8000-000000000000");
  });
});

describe("scrubLogText / scrubLogObject", () => {
  it("removes phones, emails, coordinates, addresses and tokens from free text", () => {
    const out = scrubLogText(`call ${PHONE} or 9876543210 at ${LAT}, ${LNG} - ${EMAIL} from ${CLIENT_IP} ` +
      "Bearer abc.def.ghi 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ");
    for (const leak of [DIGITS, "9876543210", LAT, LNG, "priya.sharma@", CLIENT_IP, "abc.def", "AAHdqTcv"]) {
      assert.ok(!out.includes(leak), `${leak} survived: ${out}`);
    }
  });
  it("leaves ordinary text, UUIDs, versions and loopback alone", () => {
    const keep = "incident 7d0c1e9a-1234-4567-8901-123456789012 v1.2.3 on 127.0.0.1:4693 took 12.5 ms";
    assert.equal(scrubLogText(keep), keep);
  });
  it("replaces personal field names at any depth and keeps the rest", () => {
    assert.deepEqual(scrubLogObject({ op: "sos.escalate", from: "CONFIRMED", nested: { lat: 1, lng: 2, chatId: "9" } }),
      { op: "sos.escalate", from: "CONFIRMED", nested: { lat: "[redacted]", lng: "[redacted]", chatId: "[redacted]" } });
  });
});
