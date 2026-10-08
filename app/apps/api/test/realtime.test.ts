/**
 * Live streams are counted per account and capped (MAX_STREAMS_PER_USER), so a
 * stream that is never released is a slot lost. A client that disconnects
 * while its request is still being authenticated has already fired 'close'
 * by the time the stream subscribes, and a response that has closed neither
 * fires it again nor throws on write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FastifyReply } from "fastify";

import { closeAllStreams, endSessionStreams, MAX_STREAMS_PER_USER, publish, realtimeStats, subscribe } from "../src/realtime.js";

/** Just enough of a reply: a raw response that records writes and can close. */
function fakeReply(opts: { destroyed?: boolean } = {}) {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: opts.destroyed ?? false,
    writes: [] as string[],
    write(chunk: string) { raw.writes.push(chunk); return true; },
    end() { raw.destroyed = true; raw.emit("close"); },
  });
  return { reply: { raw } as unknown as FastifyReply, raw };
}

test("a stream whose client already hung up does not keep a slot", () => {
  closeAllStreams();
  const user = "user-gone";
  for (let i = 0; i < MAX_STREAMS_PER_USER; i++) subscribe(user, fakeReply({ destroyed: true }).reply, `r${i}`);
  assert.equal(realtimeStats().connections, 0, "no dead stream is counted");

  const live = fakeReply();
  assert.ok(subscribe(user, live.reply, "live"), "a real reconnect is still accepted");
  assert.equal(publish(user, { type: "booking.status" }), 1, "and it is the only one fed");
  closeAllStreams();
});

test("a live stream is released when its client closes", () => {
  closeAllStreams();
  const s = fakeReply();
  subscribe("user-live", s.reply, "a");
  assert.equal(realtimeStats().connections, 1);
  s.raw.emit("close");
  assert.equal(realtimeStats().connections, 0);
  closeAllStreams();
});

test("the per-account ceiling still refuses a fifth live stream", () => {
  closeAllStreams();
  for (let i = 0; i < MAX_STREAMS_PER_USER; i++) assert.ok(subscribe("user-max", fakeReply().reply, `m${i}`));
  assert.equal(subscribe("user-max", fakeReply().reply, "one-too-many"), null);
  closeAllStreams();
});

/**
 * A stream authenticates once, when it opens. It used to outlive the sign-in
 * that opened it: after POST /v1/auth/logout (and after its access token had
 * expired) it went on delivering the account's SOS and booking events.
 */
test("signing out ends the streams opened under that session, and only those", () => {
  closeAllStreams();
  const signedOut = fakeReply(), other = fakeReply();
  subscribe("user-out", signedOut.reply, "a", { sid: "session-1" });
  subscribe("user-out", other.reply, "b", { sid: "session-2" });
  assert.equal(endSessionStreams(["session-1"]), 1);
  assert.equal(signedOut.raw.destroyed, true, "the signed-out session's stream is closed");
  assert.match(signedOut.raw.writes.join(""), /event: stream\.closed[\s\S]*signed_out/, "and told why");
  assert.equal(other.raw.destroyed, false, "another session's stream stays open");
  assert.equal(publish("user-out", { type: "sos.status" }), 1, "only the live session is still fed");
  closeAllStreams();
});

test("a stream ends when its access token expires", async () => {
  closeAllStreams();
  const s = fakeReply();
  subscribe("user-exp", s.reply, "x", { sid: "session-x", expiresAt: Date.now() + 30 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.raw.destroyed, true);
  assert.match(s.raw.writes.join(""), /token_expired/);
  assert.equal(realtimeStats().connections, 0);
  closeAllStreams();
});
