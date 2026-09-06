/**
 * Operation-level structured logging.
 *
 * Fastify already logs one line in and one line out per request, keyed on the
 * request id. That answers "was this request slow?" and nothing else. It cannot
 * answer the questions that actually come up:
 *
 *   · how long did the escalation ladder take for incident X?
 *   · which user's dispatch found no supply, and how wide did it search?
 *   · did that sync batch fail, and on how many operations?
 *
 * So business operations emit their own line, on the same `reqId`, carrying the
 * domain identifiers. Grepping one request id now returns the HTTP envelope and
 * every meaningful thing that happened inside it.
 *
 * ── what never goes in ────────────────────────────────────────────────────
 * No tokens, no OTP codes, no phone numbers, no payment credentials, no medical
 * fields, no free-text the user typed. Coordinates are logged only as a boolean
 * ("was a fix available"), because a log aggregator is not a place to build a
 * movement history of a person who called for help. `redact` enforces the
 * shape; the discipline is in what callers pass, and the tests pin it.
 */
import type { FastifyRequest } from "fastify";

/** Field names that must never be logged, however they arrive. */
const FORBIDDEN = new Set([
  "token", "accesstoken", "refreshtoken", "authorization", "password", "secret",
  "code", "otp", "codehash", "signature", "keysecret", "apikey", "authkey",
  "msisdn", "phone", "mobile", "email", "lat", "lng", "latitude", "longitude",
  "allergies", "conditions", "medications", "bloodgroup", "symptoms", "note",
]);

/**
 * Drop anything sensitive, at any depth.
 *
 * A denylist is the wrong default in general — the right one is an allowlist —
 * but here the callers are all in this repository and the fields are explicit,
 * so the denylist catches the accident (a whole row spread into a log call)
 * without forcing every site to enumerate what it wants.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key.toLowerCase())) { out[key] = "[redacted]"; continue; }
    out[key] = redact(v, depth + 1);
  }
  return out;
}

export interface OperationLog {
  /** Dotted and stable — the thing you grep for. "dispatch.wave", "sos.escalate". */
  op: string;
  /** Milliseconds. Pass `Date.now() - t0`. */
  durationMs?: number;
  result: "ok" | "rejected" | "error";
  bookingId?: string | null;
  incidentId?: string | null;
  mechanicId?: string | null;
  /** The error code, when there is one. Never the raw error. */
  errorCode?: string;
  /** Anything else worth having. Passed through `redact`. */
  [key: string]: unknown;
}

/**
 * Emit one operation line, correlated to the request that caused it.
 *
 * Level follows the result: a rejection is expected traffic (somebody lost a
 * race, a limit fired) and belongs at `info`; only a genuine failure warns. A
 * log that shouts about normal outcomes trains people to ignore it.
 */
export function logOp(req: FastifyRequest, entry: OperationLog): void {
  const { op, result, durationMs, ...rest } = entry;
  const line = {
    op,
    result,
    ...(durationMs != null ? { durationMs } : {}),
    reqId: req.id,
    userId: req.user?.sub ?? null,
    ...(redact(rest) as Record<string, unknown>),
  };
  if (result === "error") req.log.warn(line, `op ${op} failed`);
  else req.log.info(line, `op ${op}`);
}

/**
 * Time an operation and log it however it ends.
 *
 * The `finally` shape matters: an operation that throws must still produce a
 * line, or the only traces of the worst requests are the ones that succeeded.
 */
export async function timed<T>(
  req: FastifyRequest,
  op: string,
  fields: Omit<OperationLog, "op" | "result" | "durationMs">,
  run: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await run();
    logOp(req, { ...fields, op, result: "ok", durationMs: Date.now() - t0 });
    return out;
  } catch (err) {
    logOp(req, {
      ...fields, op, result: "error", durationMs: Date.now() - t0,
      errorCode: (err as { code?: string })?.code ?? "unknown",
    });
    throw err;
  }
}
