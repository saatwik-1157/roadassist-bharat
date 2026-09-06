/**
 * Per-principal rate limiting.
 *
 * ── the shape ─────────────────────────────────────────────────────────────
 * A fixed window per (route, principal). Not a token bucket: a bucket lets a
 * client save up an hour of allowance and spend it in one second, which is the
 * exact traffic shape we are defending against. A window's edge effect (up to
 * 2× the limit across a boundary) is the cheaper problem.
 *
 * ── the honest limitation ─────────────────────────────────────────────────
 * State is in-process. Behind N API instances each instance enforces its own
 * window, so the effective ceiling is N × the number below. That is written
 * here rather than discovered later; the fix is Redis (already in
 * docker-compose for exactly this), and the counters are deliberately shaped so
 * swapping the store is a change to `hit()` alone. The OTP ceilings are NOT
 * built on this — they count rows in Postgres and are correct across instances,
 * because credential stuffing is the one attack where a per-instance ceiling
 * would be worth nothing.
 *
 * ── the emergency rule ────────────────────────────────────────────────────
 * A limit that stops a real person raising a real SOS has done more damage than
 * the abuse it prevented. So:
 *   · the SOS ceiling is set far above any plausible human rate;
 *   · double taps are handled by IDEMPOTENCY, not by throttling — a repeated
 *     SOS with the same client reference converges on one incident instead of
 *     being refused;
 *   · and `POST /v1/sos/:id/confirm`, the call that actually summons help, is
 *     never limited at all.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

interface Window { count: number; resetAt: number }

const windows = new Map<string, Window>();

/** Sweep expired windows so a long-lived process does not accumulate keys. */
let sweeper: NodeJS.Timeout | null = null;
function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  }, 60_000);
  sweeper.unref?.();
}

export interface Verdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

/** Record one hit against a key and say whether it is allowed. */
export function hit(key: string, max: number, windowMs: number, now = Date.now()): Verdict {
  ensureSweeper();
  const existing = windows.get(key);
  const w = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + windowMs };
  w.count++;
  windows.set(key, w);
  return {
    allowed: w.count <= max,
    limit: max,
    remaining: Math.max(0, max - w.count),
    resetInSeconds: Math.max(0, Math.ceil((w.resetAt - now) / 1000)),
  };
}

/** Test seam — the suites need a known starting state. */
export function resetAllLimits() { windows.clear(); }

/**
 * The ceilings, in one place so they can be read as a policy rather than hunted
 * for across the routes. Each is set from what a *person* plausibly does, with
 * headroom, not from what feels tidy.
 */
export const LIMITS = {
  /** A booking is a considered act. Ten in five minutes is already a lot. */
  booking: { max: 10, windowMs: 5 * 60_000 },
  /**
   * Far above any human rate. This exists to stop a compromised client
   * hammering us, not to police somebody in trouble — a real double tap is
   * absorbed by the idempotency key long before it reaches this.
   */
  sos: { max: 30, windowMs: 5 * 60_000 },
  /** Checkout attempts. Enough for a failed card and three retries. */
  payment: { max: 20, windowMs: 5 * 60_000 },
  /** A journal flush is one call carrying many operations; it needs no volume. */
  sync: { max: 60, windowMs: 60_000 },
  /** A mechanic tapping accept on offers as they arrive. */
  accept: { max: 60, windowMs: 60_000 },
  /** Opening a live stream. Reconnect storms are the thing being bounded. */
  stream: { max: 30, windowMs: 60_000 },
} as const;

/**
 * A Fastify preHandler.
 *
 * Keyed by the authenticated user where there is one, and by IP otherwise —
 * so a limit follows the account rather than the coffee shop, and a signed-out
 * caller still cannot spray the endpoint from one address.
 */
export function limit(name: keyof typeof LIMITS) {
  const { max, windowMs } = LIMITS[name];
  return async function rateLimiter(req: FastifyRequest, reply: FastifyReply) {
    const principal = req.user?.sub ?? `ip:${req.ip}`;
    const verdict = hit(`${name}:${principal}`, max, windowMs);

    reply.header("x-ratelimit-limit", String(verdict.limit));
    reply.header("x-ratelimit-remaining", String(verdict.remaining));
    reply.header("x-ratelimit-reset", String(verdict.resetInSeconds));

    if (!verdict.allowed) {
      reply.header("retry-after", String(verdict.resetInSeconds));
      req.log.warn({ principal, route: name, resetInSeconds: verdict.resetInSeconds },
        "rate limit exceeded");
      return reply.code(429).send({
        error: {
          code: "rate_limited",
          title: `Too many requests. Try again in ${verdict.resetInSeconds} seconds.`,
          // Retryable, and the client is told exactly when — an emergency client
          // that backs off correctly is better than one that gives up.
          retryable: true,
          retryAfterSeconds: verdict.resetInSeconds,
          requestId: req.id,
        },
      });
    }
  };
}
