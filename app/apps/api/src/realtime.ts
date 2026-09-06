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
  reply: FastifyReply;
  openedAt: number;
  sent: number;
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
 * Attach a live stream to a reply. Returns the subscriber, or null if the user
 * already holds the maximum.
 */
export function subscribe(userId: string, reply: FastifyReply, id: string): Subscriber | null {
  let set = streams.get(userId);
  if (!set) { set = new Set(); streams.set(userId, set); }
  if (set.size >= MAX_STREAMS_PER_USER) return null;

  const sub: Subscriber = { id, userId, reply, openedAt: Date.now(), sent: 0 };
  set.add(sub);

  const drop = () => {
    const current = streams.get(userId);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) streams.delete(userId);
    if (streams.size === 0 && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };
  reply.raw.on("close", drop);
  reply.raw.on("error", drop);

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
    for (const s of set) { try { s.reply.raw.end(); } catch { /* already gone */ } }
  }
  streams.clear();
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}
