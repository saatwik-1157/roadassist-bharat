/**
 * The limiter's custom key, as the SMS webhook uses it.
 *
 * Every signed webhook request comes from the telecom vendor's few addresses,
 * so an IP key would put the whole country in one bucket. The webhook keys by
 * the sending number instead, and skips the per-IP bucket for signed traffic.
 */
import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LIMITS, limit, resetAllLimits } from "../src/ratelimit.js";

function fakeReply() {
  const r = {
    statusCode: 200, sent: undefined as unknown, headers: {} as Record<string, string>,
    header(k: string, v: string) { r.headers[k] = v; return r; },
    code(c: number) { r.statusCode = c; return r; },
    send(b: unknown) { r.sent = b; return r; },
  };
  return r;
}
const req = (from: string) =>
  ({ ip: "10.0.0.1", body: { from }, id: "t", log: { warn() {} } }) as unknown as FastifyRequest;

describe("limit(name, keyOf)", () => {
  beforeEach(() => resetAllLimits());

  it("counts per key, so one noisy number does not throttle another from the same IP", async () => {
    const byFrom = limit("telecom", (r) => `msisdn:${(r.body as { from: string }).from}`);
    for (let i = 0; i < LIMITS.telecom.max; i++) {
      const rep = fakeReply();
      await byFrom(req("+917000000001"), rep as unknown as FastifyReply);
      assert.equal(rep.statusCode, 200);
    }
    const over = fakeReply();
    await byFrom(req("+917000000001"), over as unknown as FastifyReply);
    assert.equal(over.statusCode, 429);

    const other = fakeReply();
    await byFrom(req("+917000000002"), other as unknown as FastifyReply);
    assert.equal(other.statusCode, 200);
  });

  it("a null key skips the bucket entirely", async () => {
    const skipped = limit("telecomUnsigned", () => null);
    for (let i = 0; i < LIMITS.telecomUnsigned.max + 5; i++) {
      const rep = fakeReply();
      await skipped(req("+917000000001"), rep as unknown as FastifyReply);
      assert.equal(rep.statusCode, 200);
      assert.equal(rep.headers["x-ratelimit-limit"], undefined);
    }
  });
});
