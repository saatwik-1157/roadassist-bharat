/**
 * What a tile proxy says when the tile server lets it down.
 *
 * The hosted demo once answered GET /basemap/5/20/13.png with a 500 and then a
 * 200 on retry: the upstream connection failed, `fetch` threw, and the throw
 * became "something went wrong on our side". These tests pin the rule that
 * replaced it - an upstream that answers badly or not at all is a 502, one
 * that does not answer in time is a 504, both are cached for seconds rather
 * than the week a good tile gets, and nothing is ever thrown.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  fetchTile, sendTileFailure, TILE_FAILURE_CACHE_CONTROL, type TileFetch,
} from "../src/tile-upstream.js";

const URL_ = "https://tile.example/5/20/13.png";
const UA = "RoadAssistTest/1";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const answer = (status: number, body: Uint8Array = png): TileFetch => async () => ({
  ok: status >= 200 && status < 300,
  status,
  arrayBuffer: async () => body.slice().buffer,
});

describe("fetchTile", () => {
  it("returns the bytes of a good tile and sends the polite User-Agent", async () => {
    let sentUa = "";
    const r = await fetchTile(URL_, {
      userAgent: UA,
      fetchImpl: async (_u, init) => { sentUa = init.headers["user-agent"]; return answer(200)(_u, init); },
    });
    assert.equal(r.ok, true);
    assert.ok(r.ok && r.body.equals(Buffer.from(png)));
    assert.equal(sentUa, UA);
  });

  it("turns an upstream error status into a retryable 502", async () => {
    for (const status of [404, 429, 500, 503]) {
      const r = await fetchTile(URL_, { userAgent: UA, fetchImpl: answer(status) });
      assert.equal(r.ok, false);
      if (r.ok) continue;
      assert.equal(r.status, 502, `upstream ${status}`);
      assert.equal(r.error.code, "tile_unavailable");
      assert.equal(r.error.retryable, true);
      assert.match(r.cause, new RegExp(String(status)));
    }
  });

  it("turns a connection that fails outright into a 502, not a throw", async () => {
    // This is the case that used to reach the 500 handler.
    const r = await fetchTile(URL_, {
      userAgent: UA,
      fetchImpl: async () => { throw new TypeError("fetch failed"); },
    });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 502);
    assert.match(!r.ok ? r.cause : "", /fetch failed/);
  });

  it("turns a body cut off halfway into a 502", async () => {
    const r = await fetchTile(URL_, {
      userAgent: UA,
      fetchImpl: async () => ({
        ok: true, status: 200,
        arrayBuffer: async () => { throw new Error("terminated"); },
      }),
    });
    assert.equal(!r.ok && r.status, 502);
  });

  it("does not pass off an empty 200 as a tile", async () => {
    const r = await fetchTile(URL_, { userAgent: UA, fetchImpl: answer(200, new Uint8Array(0)) });
    assert.equal(!r.ok && r.status, 502);
  });

  it("gives up on an upstream that never answers, with a 504", async () => {
    // A fetch that only ever settles by being aborted, as a hung socket does.
    const hang: TileFetch = (_u, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
    const started = Date.now();
    const r = await fetchTile(URL_, { userAgent: UA, fetchImpl: hang, timeoutMs: 30 });
    assert.equal(!r.ok && r.status, 504);
    assert.equal(!r.ok && r.error.code, "tile_timeout");
    assert.ok(Date.now() - started < 2000, "the deadline, not the socket, ends it");
  });

  it("caches every failure for seconds, never for the week a tile gets", async () => {
    const r = await fetchTile(URL_, { userAgent: UA, fetchImpl: answer(503) });
    assert.equal(!r.ok && r.cacheControl, TILE_FAILURE_CACHE_CONTROL);
    const maxAge = Number(/max-age=(\d+)/.exec(TILE_FAILURE_CACHE_CONTROL)?.[1]);
    assert.ok(maxAge > 0 && maxAge <= 60, `max-age=${maxAge}`);
  });
});

describe("sendTileFailure", () => {
  it("answers with the failure's status, its short cache and a retryable body", async () => {
    const r = await fetchTile(URL_, { userAgent: UA, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    const sent: Record<string, unknown> = {};
    const warned: object[] = [];
    const reply = {
      code(n: number) { sent.status = n; return this; },
      header(k: string, v: string) { sent[k] = v; return this; },
      send(body: unknown) { sent.body = body; return "sent"; },
    };
    const out = sendTileFailure({ id: "req-1", log: { warn: (o) => { warned.push(o); } } }, reply, "5/20/13", r);
    assert.equal(out, "sent");
    assert.equal(sent.status, 502);
    assert.equal(sent["cache-control"], TILE_FAILURE_CACHE_CONTROL);
    assert.deepEqual(sent.body, { error: { ...r.error, requestId: "req-1" } });
    // The upstream's own words go to the log, never to the client.
    assert.ok(!JSON.stringify(sent.body).includes("fetch failed"));
    assert.deepEqual(warned, [{ tile: "5/20/13", status: 502, cause: r.cause }]);
  });
});
