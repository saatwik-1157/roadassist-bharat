/**
 * One fetch of a map tile from the upstream tile server, turned into either
 * the bytes or an answer the client can act on.
 *
 * The basemap and Trip Guardian proxies already turned an upstream 4xx/5xx
 * into a 502. What they did not handle was the upstream never answering
 * properly at all: a reset connection, a DNS blip or a body cut off halfway
 * makes `fetch` (or `arrayBuffer`) throw, the throw reached the global error
 * handler, and the tile came back as a 500 "something went wrong on our side".
 * That was seen on the hosted demo - GET /basemap/5/20/13.png 500, then 200 on
 * retry. A 500 is the wrong claim (nothing in this process broke) and it has
 * no timeout behind it, so a hung upstream held the request open for as long
 * as the socket allowed.
 *
 * Now every failure is 502 (the upstream answered badly or not at all) or 504
 * (it did not answer in time), with a cache lifetime of seconds, so neither a
 * browser nor the CDN in front of the platform pins a transient failure onto
 * the map, and the next pan or reload asks again.
 *
 * Kept free of Fastify and of the global `fetch` so the rules can be tested
 * without a network.
 */

/** Long enough for a slow tile server, short of a user giving up on the map. */
export const TILE_TIMEOUT_MS = 8000;

/**
 * A failed tile is cached for seconds, not the week a good one gets: long
 * enough to absorb the burst of identical requests one redraw makes, short
 * enough that the next pan fetches it again.
 */
export const TILE_FAILURE_CACHE_CONTROL = "public, max-age=5";

export type TileFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type TileResult =
  | { ok: true; body: Buffer }
  | {
      ok: false;
      status: 502 | 504;
      cacheControl: string;
      /** What went wrong upstream, for the log - never sent to the client. */
      cause: string;
      error: { code: string; title: string; retryable: true };
    };

function failure(status: 502 | 504, cause: string): TileResult {
  return {
    ok: false,
    status,
    cacheControl: TILE_FAILURE_CACHE_CONTROL,
    cause,
    error: status === 504
      ? { code: "tile_timeout", title: "The map tile server did not answer in time", retryable: true }
      : { code: "tile_unavailable", title: "Map tile could not be fetched", retryable: true },
  };
}

/** `AbortSignal.timeout` rejects with a TimeoutError; a plain abort is an AbortError. */
function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Send a failed tile as what it is. Logged at warn, not error: it is somebody
 * else's server having a moment, not a fault in this one. Typed structurally
 * rather than against Fastify so this module stays testable on its own.
 */
export function sendTileFailure<R>(
  req: { id: string; log: { warn(obj: object, msg: string): void } },
  reply: { code(n: number): { header(k: string, v: string): { send(body: unknown): R } } },
  key: string,
  got: Extract<TileResult, { ok: false }>,
): R {
  req.log.warn({ tile: key, status: got.status, cause: got.cause }, "tile upstream failed");
  return reply.code(got.status).header("cache-control", got.cacheControl)
    .send({ error: { ...got.error, requestId: req.id } });
}

/**
 * A failure worth one more try: the connection broke, or the upstream said
 * 5xx. Seen on the hosted map as a single 502 tile that loaded on the next
 * request. Not a 4xx (asking again gets the same answer, and 429 means slow
 * down), not an empty body, and not a timeout - that one has already used the
 * time a user will wait for a tile.
 */
function transient(r: TileResult): boolean {
  return !r.ok && r.status === 502 && (/^upstream HTTP 5\d\d$/.test(r.cause) || !r.cause.startsWith("upstream "));
}

export async function fetchTile(
  url: string,
  opts: { userAgent: string; fetchImpl?: TileFetch; timeoutMs?: number; retryDelayMs?: number },
): Promise<TileResult> {
  const first = await fetchTileOnce(url, opts);
  if (!transient(first)) return first;
  await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 250));
  return fetchTileOnce(url, opts);
}

async function fetchTileOnce(
  url: string,
  opts: { userAgent: string; fetchImpl?: TileFetch; timeoutMs?: number },
): Promise<TileResult> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as TileFetch);
  // One deadline for the whole exchange, body included: a server that sends
  // headers and then stalls is as dead to the map as one that never answers.
  //
  // A plain timer rather than AbortSignal.timeout(): that one is unref'd, so it
  // never holds the process open. Inside the server something else always does,
  // but on its own - a test, a script - Node 22 can exit with the fetch still
  // pending and the deadline never firing. This one fires everywhere and is
  // cleared the moment the exchange settles, so it never outlives the request.
  const ctl = new AbortController();
  const deadline = setTimeout(
    () => ctl.abort(new DOMException("tile upstream timed out", "TimeoutError")),
    opts.timeoutMs ?? TILE_TIMEOUT_MS,
  );
  const signal = ctl.signal;
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": opts.userAgent }, signal });
    if (!res.ok) return failure(502, `upstream HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    // An empty 200 is not a tile, and caching it would paint a hole for a week.
    if (body.length === 0) return failure(502, "upstream sent an empty body");
    return { ok: true, body };
  } catch (e) {
    const cause = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return failure(isTimeout(e) ? 504 : 502, cause);
  } finally {
    clearTimeout(deadline);
  }
}
