/**
 * Real-time fan-out (Server-Sent Events).
 *
 * ── why SSE and not WebSockets ────────────────────────────────────────────
 * Every flow this platform has is server→client: a mechanic accepted, the
 * booking moved, the responder was found. The client's writes already have a
 * REST surface that carries authentication, validation, idempotency and audit,
 * and duplicating those over a socket would be a second, weaker way in.
 *
 * SSE is one long-lived HTTP GET. It survives corporate proxies and mobile
 * middleboxes that break WebSocket upgrades, costs nothing to add (no new
 * dependency, no new port, no new protocol), and reconnects by itself. On a
 * platform whose whole thesis is working on bad networks, "it is just HTTP" is
 * the feature.
 *
 * ── the ordering rule ─────────────────────────────────────────────────────
 * Persist first, publish second. Always. An event is a NOTIFICATION that
 * something already happened, never the thing itself: a client that acts on an
 * event we failed to commit is acting on a state the platform does not have.
 * Every `publish` call in this codebase sits after the write it describes.
 *
 * ── delivery guarantees, stated honestly ──────────────────────────────────
 * At-most-once, in-process. There is no replay buffer and no cross-instance
 * bus, so a client that is disconnected at the moment of an event does not
 * receive it. That is acceptable *because* it is never the only path: the
 * client refetches on reconnect, and booking state is server-authoritative
 * (ADR-0004), so the stream is an accelerator for polling rather than a
 * replacement for the truth. Behind more than one API instance this needs the
 * event bus that is already in the architecture (`outbox_events` → Redpanda);
 * until then the limitation is written down rather than assumed away.
 */
import type { FastifyReply } from "fastify";

export interface RealtimeEvent {
  /** Dotted, past tense where it describes a fact: "booking.status", "sos.status". */
  type: string;
  [key: string]: unknown;
}

interface Subscriber {
  id: string;
  userId: string;
  /** The sign-in session the stream was opened under; "" for none. */
  sid: string;
  reply: FastifyReply;
  openedAt: number;
  sent: number;
  /** Ends the stream when its access token expires. */
  expiry: NodeJS.Timeout | null;
}

/** userId → that user's open streams (a phone and a laptop are two). */
const streams = new Map<string, Set<Subscriber>>();

/** Proxies close an idle connection; a comment line is the cheapest keepalive. */
const HEARTBEAT_MS = 25_000;
/** A hard ceiling on concurrent streams per user, so one client cannot exhaust us. */
export const MAX_STREAMS_PER_USER = 4;

let heartbeat: NodeJS.Timeout | null = null;

function frame(event: RealtimeEvent, id: number): string {
  // `id` lets a reconnecting EventSource tell us where it was. We do not replay
  // (see the header), but emitting it keeps the door open and costs one line.
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

let sequence = 0;

/**
 * Send an event to every stream a user has open.
 *
 * Never throws. A publish failing must not roll back or fail the request that
 * already committed the change — the client would then have the state and be
 * told the operation failed.
 */
export function publish(userId: string | null | undefined, event: RealtimeEvent): number {
  if (!userId) return 0;
  const set = streams.get(userId);
  if (!set || set.size === 0) return 0;

  const payload = frame({ ...event, at: new Date().toISOString() }, ++sequence);
  let delivered = 0;
  for (const sub of [...set]) {
    try {
      sub.reply.raw.write(payload);
      sub.sent++;
      delivered++;
    } catch {
      // A dead socket that has not fired 'close' yet. Drop it rather than
      // retrying into a void.
      set.delete(sub);
    }
  }
  if (set.size === 0) streams.delete(userId);
  return delivered;
}

/** Publish the same event to several users at once (a dispatch fan-out). */
export function publishMany(userIds: Array<string | null | undefined>, event: RealtimeEvent): number {
  let n = 0;
  for (const id of new Set(userIds.filter(Boolean) as string[])) n += publish(id, event);
  return n;
}

/**
 * Close one stream, telling the client why first so it reconnects (with a
 * fresh token) instead of treating the end as a network failure.
 */
function endStream(sub: Subscriber, reason: "signed_out" | "token_expired"): void {
  try {
    sub.reply.raw.write(`event: stream.closed\ndata: ${JSON.stringify({ type: "stream.closed", reason })}\n\n`);
  } catch { /* already gone */ }
  try { sub.reply.raw.end(); } catch { /* already gone */ }
}

/**
 * Attach a live stream to a reply. Returns the subscriber, or null if the user
 * already holds the maximum.
 *
 * A stream is authenticated once, when it opens, and then lives for hours. It
 * used to outlive both things that end a sign-in: POST /v1/auth/logout revoked
 * the session while the stream kept delivering that account's SOS and booking
 * events, and an access token that expired ten minutes in still had a stream
 * an hour later. So the stream carries its session id (ended by
 * endSessionStreams on sign-out) and its token's expiry (ended by a timer).
 */
export function subscribe(
  userId: string, reply: FastifyReply, id: string,
  auth: { sid?: string; expiresAt?: number } = {},
): Subscriber | null {
  let set = streams.get(userId);
  if (!set) { set = new Set(); streams.set(userId, set); }
  if (set.size >= MAX_STREAMS_PER_USER) return null;

  const sub: Subscriber = { id, userId, sid: auth.sid ?? "", reply, openedAt: Date.now(), sent: 0, expiry: null };
  set.add(sub);
  if (auth.expiresAt !== undefined) {
    sub.expiry = setTimeout(() => endStream(sub, "token_expired"), Math.max(0, auth.expiresAt - Date.now()));
    sub.expiry.unref?.();
  }

  const drop = () => {
    if (sub.expiry) { clearTimeout(sub.expiry); sub.expiry = null; }
    const current = streams.get(userId);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) streams.delete(userId);
    if (streams.size === 0 && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };
  reply.raw.on("close", drop);
  reply.raw.on("error", drop);
  // A client that hung up while the request was still being authenticated has
  // already fired 'close', and never will again - nor does writing to it throw.
  // Kept, it would hold one of the account's MAX_STREAMS_PER_USER slots until
  // the process restarts; four such reconnects and the account's live stream
  // is refused for good.
  if (reply.raw.destroyed) drop();

  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const [, subs] of streams) {
        for (const s of [...subs]) {
          try { s.reply.raw.write(": keepalive\n\n"); } catch { subs.delete(s); }
        }
      }
    }, HEARTBEAT_MS);
    // A keepalive timer must never be the reason the process refuses to exit.
    heartbeat.unref?.();
  }

  return sub;
}

/**
 * End every live stream opened under one of these sign-in sessions. Called by
 * sign-out (auth.ts revokeSessionFamily) with the sessions it just revoked.
 */
export function endSessionStreams(sids: readonly string[]): number {
  const ending = new Set(sids.filter(Boolean));
  if (ending.size === 0) return 0;
  let ended = 0;
  for (const [, set] of streams) {
    for (const s of [...set]) {
      if (ending.has(s.sid)) { endStream(s, "signed_out"); set.delete(s); ended++; }
    }
  }
  for (const [userId, set] of streams) if (set.size === 0) streams.delete(userId);
  return ended;
}

/** Write the SSE preamble. Kept here so the headers live next to the framing. */
export function openStream(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    // Nothing about a live stream may be cached, buffered or transformed.
    "cache-control": "no-cache, no-store, no-transform",
    connection: "keep-alive",
    // nginx buffers proxied responses by default, which turns a live stream
    // into a stream that arrives all at once when it closes.
    "x-accel-buffering": "no",
  });
  reply.raw.write("retry: 3000\n\n");
}

export function realtimeStats() {
  let connections = 0;
  for (const [, set] of streams) connections += set.size;
  return { users: streams.size, connections, published: sequence };
}

/** Test and shutdown hook: close every stream and stop the heartbeat. */
export function closeAllStreams(): void {
  for (const [, set] of streams) {
    for (const s of set) {
      if (s.expiry) clearTimeout(s.expiry);
      try { s.reply.raw.end(); } catch { /* already gone */ }
    }
  }
  streams.clear();
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}
