/**
 * The server's logger configuration, in one place so the test that pins it
 * (test/logging.test.ts) runs exactly what server.ts runs.
 *
 * Three layers, each catching what the one before cannot:
 *
 *   1. The request serializer: the access line carries the method, the path
 *      with only allow-listed query keys (log-redaction.ts urlForLog) and the
 *      host. No client address, no port, no header values - only which of
 *      the client-address headers arrived (ipHeaders: booleans and an
 *      X-Forwarded-For entry count, client-ip.ts), so an operator can tell
 *      which one to name in CLIENT_IP_HEADER.
 *   2. The error serializer: type, scrubbed message and stack, and a code -
 *      never a driver's `query`/`parameters`, which hold bound values.
 *   3. Every other line, from any call site (ours or Fastify's): field names
 *      in NEVER_LOGGED_KEYS are replaced, and every string, the message
 *      included, is scrubbed of phone numbers, emails, coordinates, IPv4
 *      addresses, tokens and SQL parameters (scrubLogText).
 *
 * Call sites are still expected not to pass these things; this is the net
 * under them, not a licence.
 */
import type { FastifyServerOptions } from "fastify";
import { ipHeaderPresence } from "./client-ip.js";
import { errForLog, scrubLogObject, scrubLogText, urlForLog } from "./domain/log-redaction.js";

type LoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

interface LoggableRequest { method?: string; url?: string; host?: string; headers?: Record<string, unknown> }

export function loggerOptions(o: { level: string; stream?: { write(line: string): void } }): LoggerOptions {
  return {
    level: o.level,
    ...(o.stream ? { stream: o.stream } : {}),
    serializers: {
      req: (req: LoggableRequest) => ({
        method: req.method, url: urlForLog(String(req.url ?? "")), host: req.host,
        ipHeaders: ipHeaderPresence(req.headers),
      }),
      err: errForLog,
    },
    formatters: {
      log: (obj: Record<string, unknown>) => scrubLogObject(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args: unknown[], method: (...a: unknown[]) => void) {
        return method.apply(this, args.map((a) => (typeof a === "string" ? scrubLogText(a) : a)));
      },
    },
  } as unknown as LoggerOptions;
}
