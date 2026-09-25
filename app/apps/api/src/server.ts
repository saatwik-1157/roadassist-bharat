import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { env, assertProductionSafe, validateEnv } from "./env.js";
import { db, sql } from "./db.js";
import * as S from "@roadassist/db";
import {
  authenticate, requireRole, sha256, verifyAccessToken,
} from "./auth.js";
import { apply, allowedFrom, finishesJob, IllegalTransition, type Command, type Status } from "./domain/booking-machine.js";
import { ratingBaseline, ratingPrior, shrunkRating } from "./domain/ai-rules.js";
import {
  diagnoseWithFallback, email, maps, providerSummary, sms,
} from "./providers.js";
import { isoTimestamp, ok, msisdnSchema } from "./http.js";
import { rakshaRoutes, describePosition } from "./raksha.js";
import { authRoutes } from "./routes/auth.js";
import { emailAuthRoutes, emailSignin } from "./routes/email-auth.js";
import { emergencyRoutes } from "./routes/emergency.js";
import { telecomRoutes } from "./routes/telecom.js";
import { mechanicRoutes } from "./routes/mechanic.js";
import { paymentRoutes, invoiceIsSettled } from "./routes/payments.js";
import { bookingAudience, notYours } from "./booking-access.js";
import { audit, verifyAuditChain } from "./audit.js";
import { limit } from "./ratelimit.js";
import { ApiError, fail } from "./errors.js";
import { logOp } from "./observability.js";
import { fetchTile, sendTileFailure } from "./tile-upstream.js";
import {
  escalate, providerRoster, providerStateFor, sendWave, startOfferSweeper, stopOfferSweeper,
} from "./dispatch.js";
import {
  IllegalIncidentTransition, allowedIncidentCommands,
} from "./domain/incident-machine.js";
import { describeProviderState } from "./domain/provider-state.js";
import { reference } from "./domain/reference.js";
import { alertsStatus } from "./alerts.js";
import {
  closeAllStreams, MAX_STREAMS_PER_USER, openStream, publish, publishMany,
  realtimeStats, subscribe, type RealtimeEvent,
} from "./realtime.js";

// Configuration is checked before anything else runs, in every environment.
// A NaN TTL or a malformed DATABASE_URL should stop the process here with a
// message naming the variable — not surface hours later as "auth is broken".
validateEnv();
assertProductionSafe();

const app = Fastify({
  logger: { level: env.nodeEnv === "test" ? "silent" : "info" },
  genReqId: () => randomUUID(),
  // Off unless TRUST_PROXY says otherwise — see env.ts. Without it every
  // request behind a tunnel or load balancer reports the proxy's address, and
  // the per-IP OTP ceiling becomes a single bucket shared by all users.
  trustProxy: env.trustProxy,
});
/**
 * CORS.
 *
 * Development reflects the caller's origin, which is what makes a demo work
 * from localhost, a LAN address and a Cloudflare tunnel in the same afternoon.
 * Production must send an explicit allowlist — reflecting the Origin header is
 * functionally "any website may call this API with the user's credentials" —
 * and `assertProductionSafe` refuses to boot without one.
 */
await app.register(cors, {
  origin: env.cors.mode === "list" ? env.cors.origins : true,
  credentials: true,
  // The client reads these to show the user when to retry.
  exposedHeaders: ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"],
});

/**
 * Treat an empty JSON body as `{}`.
 *
 * Several endpoints take no body at all (accepting an offer) or an entirely
 * optional one (dispatch, which has defaults). Clients routinely send
 * `content-type: application/json` with nothing after it, and Fastify's default
 * parser rejects that with a 400 the caller cannot act on.
 */
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  const text = typeof body === "string" ? body.trim() : "";
  // Webhook signatures are computed over the exact bytes the vendor sent, so
  // the raw text is kept alongside the parsed object.
  (req as { rawBody?: string }).rawBody = typeof body === "string" ? body : "";
  if (!text) return done(null, {});
  try {
    done(null, JSON.parse(text));
  } catch {
    done(Object.assign(new Error("Request body is not valid JSON"), { statusCode: 400 }), undefined);
  }
});

/** Uniform error envelope (API style guide §6). */
app.setErrorHandler((err, req, reply) => {
  // Codes from the shared vocabulary (errors.ts) carry their own status and
  // retryability, so a client can branch on them instead of guessing.
  if (err instanceof ApiError) {
    return reply.code(err.statusCode).send(err.envelope(String(req.id)));
  }
  if (err instanceof IllegalIncidentTransition) {
    return reply.code(409).send({
      error: {
        code: err.code, title: err.message, retryable: false, requestId: req.id,
        allowed: allowedIncidentCommands(err.from),
      },
    });
  }
  if (err instanceof IllegalTransition) {
    return reply.code(409).send({
      error: { code: err.code, title: err.message, retryable: false, requestId: req.id },
    });
  }
  if (err instanceof z.ZodError) {
    return reply.code(400).send({
      error: {
        code: "invalid_request", title: "Some fields need fixing", retryable: false,
        fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.id,
      },
    });
  }
  /**
   * Anything that already knows its own status code.
   *
   * Fastify's own errors carry `statusCode` — a malformed JSON body, a payload
   * over the limit, an unsupported media type. They were all falling through to
   * the 500 branch below, so a client that sent bad JSON was told the server had
   * broken, and a monitoring dashboard counted it as an outage. The body is
   * still ours, and the vendor's message is only surfaced for 4xx (which
   * describes the caller's request) and never for 5xx (which could describe our
   * internals).
   */
  const declared = (err as { statusCode?: number }).statusCode;
  if (typeof declared === "number" && declared >= 400 && declared < 500) {
    // `err` has been narrowed past every handled case above and is `unknown`
    // here, so the message is read defensively — the same treatment the 500
    // branch below already gives it.
    req.log.info({
      err: err instanceof Error ? err.message : String(err),
      statusCode: declared,
    }, "client error");
    return reply.code(declared).send({
      error: {
        code: (err as { code?: string }).code ?? "invalid_request",
        title: err instanceof Error ? err.message : "That request could not be processed",
        retryable: false,
        requestId: req.id,
      },
    });
  }

  req.log.error({ err }, "unhandled");
  console.error("[error]", req.method, req.url, "\n", err);
  return reply.code(500).send({
    error: {
      code: "internal", title: "Something went wrong on our side", retryable: true, requestId: req.id,
      // Detail is for developers, so it is withheld in production. `err` has been
      // narrowed past the handled cases above, so read the message defensively.
      ...(env.nodeEnv === "production"
        ? {}
        : { detail: err instanceof Error ? err.message : String(err) }),
    },
  });
});

// "/" is the landing page; index.html keeps the request console at its URL.
await app.register(fastifyStatic, {
  root: findUp("apps/web"),
  prefix: "/",
  index: ["landing.html", "index.html"],
});
// Demo media (videos, photos) live in the repo's site/ folder — served here so
// the showcase page can embed them without duplicating megabytes into app/.
//
// MEDIA ONLY, and the filter is the point. site/ also holds half a dozen old
// prototype pages, and mounting the directory whole published them: they were
// reachable at /media/app.html and each one pulled webfonts from Google, so
// every visitor's IP address left India to render a page nothing links to.
// That breaks non-negotiable #4, and it broke it silently, which is why
// check-data-residency.mjs now fails the build on it rather than trusting
// this comment.
const MEDIA_TYPES = /\.(mp4|webm|mov|m4v|jpe?g|png|webp|avif|gif|svg|vtt)$/i;
await app.register(fastifyStatic, {
  root: findUp("../site"),
  prefix: "/media/",
  decorateReply: false,
  allowedPath: (pathname) => MEDIA_TYPES.test(pathname),
});



/**
 * Find a sibling directory by walking up from this module.
 *
 * The static roots below used to be plain `../../web` and `../../../../site`
 * relative to `src/`. That works under `tsx`, which is how the app is run — and
 * silently breaks the compiled output, where the same module sits at
 * `dist/src/` and those paths resolve to directories that do not exist. `npm
 * run build` therefore succeeded while producing a server that served nothing,
 * which is the worst shape a build failure can take.
 *
 * Walking up for a known directory is correct from either location, and from a
 * third if the layout moves again.
 */
function findUp(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the source-tree path so the failure is a clear 404 from a
  // named directory rather than a confusing one from an empty string.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../web");
}

// ── offline-map tile proxy ──────────────────────────────────────────────────
// OSM tiles carry no CORS headers, so a browser cannot cache-and-reuse them
// offline. This same-origin proxy (small zoom window, in-memory cache, polite
// User-Agent, attribution required in every client) makes Trip Guardian's
// pre-downloaded maps actually usable. © OpenStreetMap contributors.
const tileCache = new Map<string, Buffer>();
app.get("/tiles/:z/:x/:file", async (req, reply) => {
  const p = z.object({
    z: z.coerce.number().int().min(11).max(15),
    x: z.coerce.number().int().min(0),
    file: z.string().regex(/^\d+\.png$/),
  }).parse(req.params);
  const y = Number(p.file.replace(".png", ""));
  const key = `${p.z}/${p.x}/${y}`;

  let buf = tileCache.get(key);
  if (!buf) {
    // An upstream that fails or stalls is a 502/504 with seconds of cache,
    // never a thrown 500 - see tile-upstream.ts.
    const got = await fetchTile(`https://tile.openstreetmap.org/${key}.png`, {
      userAgent: "RoadAssistDemo/0.1 (student project; trip-guardian prefetch)",
    });
    if (!got.ok) return sendTileFailure(req, reply, key, got);
    buf = got.body;
    if (tileCache.size > 600) tileCache.clear();   // tiny corridor cache, never grows unbounded
    tileCache.set(key, buf);
  }
  return reply.header("cache-control", "public, max-age=86400").type("image/png").send(buf);
});

// ── clean basemap proxy — whole-country to street, same same-origin/cache/
//    attribution rules as the Trip Guardian tile proxy above. ───────────────
// © OpenStreetMap contributors.
const baseCache = new Map<string, Buffer>();
/**
 * Keyless basemap tiles.
 *
 * This used to proxy CARTO's raster basemaps. CARTO now requires an API key for
 * them and stamps "API KEY REQUIRED" across every unauthenticated tile — which
 * had been happening silently on every map in the project. OpenStreetMap's
 * standard tiles need no key, so the whole platform still runs with zero
 * third-party accounts (a stated goal in env.ts).
 *
 * There is deliberately no `style` parameter: one keyless source serves both
 * themes and the dark treatment is a CSS filter on the client. A server-side
 * style would double the cache for identical bytes.
 *
 * OSM's tile policy asks for a real User-Agent and sane caching; both are here,
 * and every response is cached so a pan does not re-fetch.
 */
app.get("/basemap/:z/:x/:file", async (req, reply) => {
  const p = z.object({
    z: z.coerce.number().int().min(3).max(18),
    x: z.coerce.number().int().min(0),
    file: z.string().regex(/^\d+\.png$/),
  }).parse(req.params);
  const y = Number(p.file.replace(".png", ""));
  const key = `${p.z}/${p.x}/${y}`;

  let buf = baseCache.get(key);
  if (!buf) {
    // The same rule as the corridor proxy: an upstream failure is answered as one.
    const got = await fetchTile(`https://tile.openstreetmap.org/${key}.png`, {
      userAgent: "RoadAssistDemo/0.1 (student project; map basemap)",
    });
    if (!got.ok) return sendTileFailure(req, reply, key, got);
    buf = got.body;
    if (baseCache.size > 2000) baseCache.clear();
    baseCache.set(key, buf);
  }
  return reply.header("cache-control", "public, max-age=604800").type("image/png").send(buf);
});

// ══ connectivity probe (ADR-0009) ══════════════════════════════════════════
/**
 * The cheapest possible "are you there?".
 *
 * The client's connectivity manager calls this on a timer to decide between
 * ONLINE, LIMITED and OFFLINE, so it must touch nothing — no database, no
 * provider, no auth. `/health` deliberately DOES hit the database, and that is
 * the point of having both: a fast ping with a failing health check is a live
 * network to a sick platform (LIMITED), while a failing ping is no network at
 * all (OFFLINE). Collapsing them into one endpoint would make those two
 * indistinguishable to a phone at the roadside.
 *
 * `t` lets the client measure clock skew without a second round trip.
 */
app.get("/v1/ping", async (_req, reply) =>
  reply.header("cache-control", "no-store").send(ok({ t: Date.now() })));

// ══ live event stream (SSE) ════════════════════════════════════════════════
/**
 * One long-lived GET per client, carrying every change that concerns them.
 *
 * **Authenticated by the Authorization header, deliberately.** The obvious
 * implementation uses `EventSource`, which cannot set headers and so forces the
 * access token into the query string — where it lands in every access log,
 * proxy log and `Referer`. The client uses `fetch()` with a streaming body
 * reader instead, which costs a few lines there and keeps the token out of the
 * URL entirely. The same reasoning already governs how map.html receives its
 * token (in the fragment, never the path).
 *
 * The stream is an ACCELERATOR, not the source of truth. Booking state is
 * server-authoritative (ADR-0004); a client that misses an event because it was
 * in a tunnel refetches on reconnect and is correct again. Nothing here is the
 * only path to any state.
 */
app.get("/v1/events", { preHandler: [authenticate, limit("stream")] }, async (req, reply) => {
  const userId = req.user!.sub;
  openStream(reply);
  const sub = subscribe(userId, reply, String(req.id));

  if (!sub) {
    // Refusing loudly beats silently accepting a stream we will not feed.
    reply.raw.write(`event: error\ndata: ${JSON.stringify({
      code: "too_many_streams",
      title: `This account already has ${MAX_STREAMS_PER_USER} open streams. Close one and reconnect.`,
    })}\n\n`);
    reply.raw.end();
    return reply.hijack();
  }

  // A first frame the client can act on: it proves the stream is live rather
  // than merely connected, and carries the server clock for skew correction.
  reply.raw.write(`event: stream.open\ndata: ${JSON.stringify({
    type: "stream.open", requestId: req.id, serverTime: new Date().toISOString(),
  })}\n\n`);

  return reply.hijack();
});

// ══ health ═════════════════════════════════════════════════════════════════
/**
 * Liveness and readiness, told apart.
 *
 * The old handler let a database failure throw, which surfaced as a 500 with a
 * generic envelope — indistinguishable from any other bug, and useless to a
 * load balancer that has to decide whether to keep sending traffic here.
 *
 * Now the database check is caught and reported. The rule the brief asks for is
 * explicit: **an instance whose database is unreachable is NOT healthy**, so it
 * answers 503 and an orchestrator takes it out of rotation. `/v1/ping` stays
 * separate and touches nothing, so "the network is dead" and "the platform is
 * sick" remain distinguishable from a phone at the roadside.
 */
app.get("/health", async (req, reply) => {
  const t0 = Date.now();
  let database: { status: "ok" | "down"; latencyMs: number; error?: string };
  try {
    const [{ n }] = await db.execute<{ n: number }>(raw`SELECT 1::int AS n`);
    database = { status: n === 1 ? "ok" : "down", latencyMs: Date.now() - t0 };
  } catch (err) {
    database = {
      status: "down", latencyMs: Date.now() - t0,
      // The class of failure, never the connection string.
      error: err instanceof Error ? err.name : "unknown",
    };
  }

  const healthy = database.status === "ok";

  /**
   * Two audiences, two answers.
   *
   * A load balancer, an orchestrator and a Docker HEALTHCHECK need one thing:
   * the status code. They must never be made to authenticate, so the public
   * body stays minimal — enough to diagnose from a terminal, and nothing that
   * helps somebody map the deployment.
   *
   * The detail — which SMS and payment vendors are wired up, which environment
   * this is, how long it has been up, how many live streams are open — is
   * reconnaissance. It is genuinely useful to an operator and genuinely useful
   * to an attacker, so it needs a role. Passing `?detail=1` with an operator
   * token returns it; without one the parameter is ignored rather than refused,
   * because a health endpoint that can fail authentication is a health endpoint
   * that can report a false outage.
   */
  let operator = false;
  if ((req.query as { detail?: string })?.detail) {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        const claims = await verifyAccessToken(header.slice(7));
        operator = claims.roles.some((r) => r === "admin" || r === "gov_officer");
      } catch { /* an unreadable token simply gets the public view */ }
    }
  }

  const body = ok({
    status: healthy ? "ok" : "degraded",
    application: "ok",              // this process is answering, by definition
    database: database.status,
    dbLatencyMs: database.latencyMs,
    ...(database.error ? { databaseError: database.error } : {}),
    ...(operator ? {
      providers: providerSummary(),
      realtime: realtimeStats(),
      uptimeSeconds: Math.round(process.uptime()),
      environment: env.nodeEnv,
      version: "0.1.0",
    } : {}),
  }, operator ? {} : { note: "Add ?detail=1 with an operator token for provider, runtime and stream detail." });

  // 503 rather than 200-with-a-flag: a load balancer reads the status code.
  return healthy ? body : reply.code(503).send(body);
});

/**
 * The operations view. Real numbers, read live, or nothing.
 *
 * Every figure here is a count from the database at the moment of the request.
 * There is no sampling, no cache and no synthetic metric — if a number cannot
 * be computed it is absent rather than estimated, because a dashboard that
 * invents a plausible value is worse than one that admits it does not know.
 */
app.get("/v1/ops/overview", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req) => {
  const t0 = Date.now();
  const [incidents] = await db.execute<{
    active: number; critical: number; awaiting: number; offgrid_today: number;
  }>(raw`
    SELECT count(*) FILTER (WHERE status IN ('DETECTED','AWAITING_CONFIRMATION','CONFIRMED','RESPONDING'))::int AS active,
           count(*) FILTER (WHERE severity = 'CRITICAL'
                              AND status IN ('CONFIRMED','RESPONDING'))::int AS critical,
           count(*) FILTER (WHERE status = 'AWAITING_CONFIRMATION')::int AS awaiting,
           count(*) FILTER (WHERE degraded_path AND created_at > now() - interval '24 hours')::int AS offgrid_today
      FROM incidents WHERE deleted_at IS NULL`);

  const [bookings] = await db.execute<{ matching: number; active: number; no_supply: number }>(raw`
    SELECT count(*) FILTER (WHERE status = 'MATCHING')::int AS matching,
           count(*) FILTER (WHERE status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS'))::int AS active,
           count(*) FILTER (WHERE status = 'NO_SUPPLY' AND updated_at > now() - interval '24 hours')::int AS no_supply
      FROM bookings WHERE deleted_at IS NULL`);

  const [sync] = await db.execute<{ rejected: number; conflicts: number }>(raw`
    SELECT count(*) FILTER (WHERE rejected_reason IS NOT NULL
                              AND created_at > now() - interval '24 hours')::int AS rejected,
           (SELECT count(*)::int FROM conflict_log
             WHERE created_at > now() - interval '24 hours') AS conflicts
      FROM sync_operations`);

  const [payments] = await db.execute<{ pending: number; failed: number }>(raw`
    SELECT count(*) FILTER (WHERE status = 'PENDING'
                              AND created_at < now() - interval '30 minutes')::int AS pending,
           count(*) FILTER (WHERE status = 'FAILED'
                              AND created_at > now() - interval '24 hours')::int AS failed
      FROM payments WHERE deleted_at IS NULL`);

  const providers = await providerRoster();
  const chain = await verifyAuditChain(2000);

  logOp(req, { op: "ops.overview", result: "ok", durationMs: Date.now() - t0 });

  return ok({
    incidents, bookings, sync, payments, providers,
    auditChain: { intact: chain.ok, entriesChecked: chain.checked,
                  ...(chain.ok ? {} : { brokenAt: chain.brokenAt, reason: chain.reason }) },
    realtime: realtimeStats(),
  }, {
    generatedAt: new Date().toISOString(),
    note: "Every figure is a live count. Nothing here is sampled, cached or estimated.",
  });
});

app.get("/v1/service-types", async () => {
  const rows = await db.select().from(S.serviceTypes).where(isNull(S.serviceTypes.deletedAt));
  return ok(rows);
});


app.get("/v1/me", { preHandler: authenticate }, async (req) => {
  const [user] = await db.select().from(S.users).where(eq(S.users.id, req.user!.sub)).limit(1);
  const vehicles = await db.select({
    id: S.vehicles.id, registrationNo: S.vehicles.registrationNo,
    vehicleClass: S.vehicles.vehicleClass, nickname: S.vehicles.nickname,
    odometerKm: S.vehicles.odometerKm,
  }).from(S.userVehicles)
    .innerJoin(S.vehicles, eq(S.vehicles.id, S.userVehicles.vehicleId))
    .where(and(eq(S.userVehicles.userId, req.user!.sub), isNull(S.userVehicles.deletedAt)));
  return ok({ user: { id: user.id, msisdn: user.msisdn, fullName: user.fullName }, roles: req.user!.roles, vehicles });
});

/**
 * Set your own name.
 *
 * `full_name` was readable everywhere and writable nowhere: the seed invented
 * names for its fake users, while every account created by actually signing in
 * had none — so a real customer reached the mechanic's screen as the literal
 * word "Customer". A mechanic pulling onto a hard shoulder is looking for a
 * person, and this is the only place that person can say who they are.
 */
app.patch("/v1/me", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    // Trimmed, and empty means "clear it" rather than storing a blank string.
    fullName: z.string().max(120).transform((s) => s.trim()).optional(),
  }).parse(req.body ?? {});

  if (body.fullName === undefined) {
    return reply.code(400).send({
      error: { code: "nothing_to_update", title: "Send a name to change", retryable: false },
    });
  }

  const [updated] = await db.update(S.users)
    .set({ fullName: body.fullName || null, updatedAt: new Date() })
    .where(eq(S.users.id, req.user!.sub))
    .returning({ id: S.users.id, msisdn: S.users.msisdn, fullName: S.users.fullName });

  return ok(updated);
});

// ══ vehicles ═══════════════════════════════════════════════════════════════
app.post("/v1/vehicles", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    registrationNo: z.string().min(4).max(16).transform((s) => s.toUpperCase().replace(/\s+/g, "")),
    vehicleClass: z.enum(["car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev"]),
    nickname: z.string().max(60).optional(),
    odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  }).parse(req.body);

  const [existing] = await db.select().from(S.vehicles)
    .where(eq(S.vehicles.registrationNo, body.registrationNo)).limit(1);
  if (existing) {
    return reply.code(409).send({
      error: { code: "vehicle_exists", title: "That registration number is already on the platform", retryable: false },
    });
  }

  const [vehicle] = await db.insert(S.vehicles).values({
    registrationNo: body.registrationNo, vehicleClass: body.vehicleClass,
    nickname: body.nickname, odometerKm: body.odometerKm ?? 0,
  }).returning();
  await db.insert(S.userVehicles).values({ userId: req.user!.sub, vehicleId: vehicle.id, isPrimary: true });

  return reply.code(201).send(ok(vehicle));
});

/**
 * Correct a vehicle's details.
 *
 * A registration typed at the roadside with one hand is often wrong, and until
 * now the only remedy was adding a second vehicle and living with the first —
 * the unique index then made the *correct* plate unaddable. Ownership is
 * checked through user_vehicles, so a vehicle id alone is not authority.
 */
app.patch("/v1/vehicles/:id", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({
    registrationNo: z.string().min(4).max(16)
      .transform((s) => s.toUpperCase().replace(/\s+/g, "")).optional(),
    vehicleClass: z.enum(["car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev"]).optional(),
    fuel: z.enum(["petrol", "diesel", "cng", "lpg", "electric", "hybrid"]).optional(),
    nickname: z.string().max(60).optional(),
    odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  }).parse(req.body ?? {});

  const [owned] = await db.select().from(S.userVehicles)
    .where(and(eq(S.userVehicles.userId, req.user!.sub), eq(S.userVehicles.vehicleId, id),
               isNull(S.userVehicles.deletedAt))).limit(1);
  if (!owned) {
    return reply.code(403).send({
      error: { code: "not_your_vehicle", title: "That vehicle is not on your account", retryable: false },
    });
  }

  // Renaming onto a plate somebody else already registered is the same clash
  // POST reports, and deserves the same answer rather than a 500 from the index.
  if (body.registrationNo) {
    const [clash] = await db.select({ id: S.vehicles.id }).from(S.vehicles)
      .where(eq(S.vehicles.registrationNo, body.registrationNo)).limit(1);
    if (clash && clash.id !== id) {
      return reply.code(409).send({
        error: { code: "vehicle_exists", title: "That registration number is already on the platform", retryable: false },
      });
    }
  }

  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) {
    return reply.code(400).send({
      error: { code: "nothing_to_update", title: "Send at least one field to change", retryable: false },
    });
  }

  const [updated] = await db.update(S.vehicles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(S.vehicles.id, id)).returning();
  return ok(updated);
});

// ══ diagnosis ══════════════════════════════════════════════════════════════
app.post("/v1/diagnose", { preHandler: authenticate }, async (req) => {
  const body = z.object({
    vehicleId: z.string().uuid().optional(),
    symptoms: z.string().max(500).optional(),
    dtcCodes: z.array(z.string().max(12)).max(10).optional(),
    ranOffline: z.boolean().optional(),
  }).parse(req.body);

  const result = await diagnoseWithFallback(body);

  if (body.vehicleId) {
    const [session] = await db.insert(S.diagnosticSessions).values({
      vehicleId: body.vehicleId, userId: req.user!.sub,
      source: body.dtcCodes?.length ? "obd" : "symptom",
      symptomsText: body.symptoms, ranOffline: body.ranOffline ?? false,
    }).returning({ id: S.diagnosticSessions.id });
    await db.insert(S.diagnosticFindings).values({
      sessionId: session.id, cause: result.cause, confidence: result.confidence,
      severity: result.severity, driveable: result.driveable,
      predictedParts: result.parts, modelVersion: result.modelVersion,
      usedFallback: result.usedFallback,
    });
  }

  // Auditable without retaining the input (threat #10).
  await db.insert(S.modelPredictions).values({
    capability: "diagnose", modelVersion: result.modelVersion,
    inputHash: sha256(JSON.stringify(body)), confidence: result.confidence,
    latencyMs: result.latencyMs, usedFallback: result.usedFallback, subjectId: req.user!.sub,
  });

  return ok(result, { modelVersion: result.modelVersion, usedFallback: result.usedFallback });
});

// ══ bookings ═══════════════════════════════════════════════════════════════

app.post("/v1/bookings", { preHandler: [authenticate, limit("booking")] }, async (req, reply) => {
  const body = z.object({
    vehicleId: z.string().uuid(),
    serviceTypeCode: z.string().min(2),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    symptoms: z.string().max(500).optional(),
    addressText: z.string().max(200).optional(),
    highwayMarker: z.string().max(40).optional(),
    createdOffline: z.boolean().optional(),
    idempotencyKey: z.string().max(80).optional(),
  }).parse(req.body);

  const idemKey = body.idempotencyKey ?? (req.headers["idempotency-key"] as string | undefined);
  if (idemKey) {
    const [seen] = await db.select().from(S.idempotencyKeys)
      .where(and(eq(S.idempotencyKeys.key, idemKey), eq(S.idempotencyKeys.endpoint, "POST /v1/bookings"))).limit(1);
    if (seen) return reply.code(seen.responseStatus ?? 200).send(seen.responseBody);
  }

  // Ownership check at the resource, not just the route (threat #5).
  const [owned] = await db.select().from(S.userVehicles)
    .where(and(eq(S.userVehicles.userId, req.user!.sub), eq(S.userVehicles.vehicleId, body.vehicleId),
               isNull(S.userVehicles.deletedAt))).limit(1);
  if (!owned) {
    return reply.code(403).send({
      error: { code: "not_your_vehicle", title: "That vehicle is not on your account", retryable: false },
    });
  }

  const [svc] = await db.select().from(S.serviceTypes).where(eq(S.serviceTypes.code, body.serviceTypeCode)).limit(1);
  if (!svc) {
    return reply.code(400).send({ error: { code: "unknown_service", title: "That service type does not exist", retryable: false } });
  }

  // A stranded user often cannot type an address, so derive one when it is
  // missing. The local provider returns coordinates and flags itself estimated.
  const address = body.addressText
    ?? (await maps.reverseGeocode({ lat: body.lat, lng: body.lng }).catch(() => null))?.label
    ?? undefined;

  /**
   * A request is born in four writes, and it is only a request once all four
   * land: the row, its position, the DRAFT → REQUESTED transition, and the event
   * that records it. Separately they can stop half-way, and each half-way state
   * is its own silent failure — a REQUESTED booking with no location is the
   * worst, because dispatch filters on ST_DWithin against that column and NULL
   * matches nothing, so it is not "hard to dispatch" but impossible, while
   * looking perfectly normal in every listing.
   *
   * The same reasoning as the SOS path in routes/emergency.ts. `raw` is still
   * needed for the position: PostGIS geometry has no Drizzle column builder
   * here, and ST_MakePoint has to be evaluated by the database.
   */
  const { to } = apply("DRAFT", "submit");
  const booking = await db.transaction(async (tx) => {
    const [row] = await tx.insert(S.bookings).values({
      reference: reference(), userId: req.user!.sub, vehicleId: body.vehicleId,
      serviceTypeId: svc.id, status: "DRAFT", symptoms: body.symptoms,
      addressText: address, highwayMarker: body.highwayMarker,
      quotedPaise: svc.baseFarePaise, createdOffline: body.createdOffline ?? false,
      clientUpdatedAt: new Date(),
    }).returning();

    await tx.execute(raw`
      UPDATE bookings SET location = ST_SetSRID(ST_MakePoint(${body.lng}, ${body.lat}), 4326)
      WHERE id = ${row.id}`);

    await tx.update(S.bookings)
      .set({ status: to, requestedAt: new Date(), updatedAt: new Date(), version: row.version + 1 })
      .where(eq(S.bookings.id, row.id));
    await tx.insert(S.bookingEvents).values({
      bookingId: row.id, fromStatus: "DRAFT", toStatus: to,
      command: "submit", actorId: req.user!.sub, actorRole: "citizen",
    });
    return row;
  });

  const payload = ok({ ...booking, status: to, lat: body.lat, lng: body.lng },
                     { nextCommands: allowedFrom(to) });
  if (idemKey) {
    await db.insert(S.idempotencyKeys).values({
      key: idemKey, userId: req.user!.sub, endpoint: "POST /v1/bookings",
      responseStatus: 201, responseBody: payload,
    }).onConflictDoNothing();
  }
  return reply.code(201).send(payload);
});

/**
 * Who may see and drive a booking: its customer, the mechanic currently
 * assigned to it, or an admin. Checked at the resource rather than the route
 * (threat #5), and in one place so the read, write and payment paths cannot
 * drift apart — they have before, and the write path ended up strictly more
 * permissive than the read path.
 */

/**
 * Push a booking change to everybody it concerns — the customer and, once one
 * is assigned, the mechanic driving to them.
 *
 * Both sides need it. Before this, the customer polled every six seconds and
 * the mechanic's console only redrew when they touched it, so "the customer
 * cancelled while I was driving" reached the mechanic whenever they next
 * happened to look.
 *
 * Called AFTER the write commits, never before (see realtime.ts).
 */
async function notifyBooking(
  booking: { id: string; userId: string | null; mechanicId: string | null },
  event: RealtimeEvent,
): Promise<number> {
  const audience: Array<string | null> = [booking.userId];
  if (booking.mechanicId) {
    const [mech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
      .where(eq(S.mechanics.id, booking.mechanicId)).limit(1);
    if (mech?.userId) audience.push(mech.userId);
  }
  return publishMany(audience, { ...event, bookingId: booking.id });
}

/** Dispatch: PostGIS nearest-neighbour, then the deterministic ranker. */
app.post("/v1/bookings/:id/dispatch", { preHandler: [authenticate, limit("booking")] }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { radiusKm = 25, limit = 5 } = z.object({
    radiusKm: z.number().min(1).max(100).optional(), limit: z.number().min(1).max(20).optional(),
  }).parse(req.body ?? {});

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });
  if (booking.userId !== req.user!.sub) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That booking is not yours", retryable: false } });
  }

  const t0 = Date.now();
  const { to } = apply(booking.status as Status, "dispatch.start");

  // Wave 1 of the ladder. `sendWave` excludes providers who are off duty or
  // already committed to another customer — the old query filtered on the duty
  // toggle alone, so a mechanic mid-job kept receiving offers.
  const wave = await sendWave(id, {
    radiusKm, waveSize: limit, wave: 1, actorId: req.user!.sub,
  });

  if (wave.exhausted) {
    const noSupply = apply(to, "offers.exhausted");
    await db.update(S.bookings).set({ status: noSupply.to, updatedAt: new Date() }).where(eq(S.bookings.id, id));
    await db.insert(S.bookingEvents).values({
      bookingId: id, fromStatus: to, toStatus: noSupply.to, command: "offers.exhausted", actorRole: "system",
      meta: { radiusKm, skipped: wave.skipped.length },
    });
    publish(req.user!.sub, { type: "booking.status", bookingId: id, status: noSupply.to });
    logOp(req, {
      op: "dispatch.start", result: "rejected", durationMs: Date.now() - t0,
      bookingId: id, radiusKm, offers: 0, skippedProviders: wave.skipped.length,
      errorCode: "PROVIDER_UNAVAILABLE",
    });
    return ok({ offers: [], status: noSupply.to }, {
      message: wave.skipped.length
        ? `No free mechanic within ${radiusKm} km — ${wave.skipped.length} nearby are off duty or on another job. Widen the radius to try again.`
        : `No available mechanic within ${radiusKm} km. Widen the radius to try again.`,
      // Named states, not a bare count: "everyone is busy" and "nobody is here"
      // are different problems and the customer deserves to know which it is.
      skippedByState: wave.skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.state] = (acc[s.state] ?? 0) + 1; return acc;
      }, {}),
    });
  }

  await db.update(S.bookings).set({ status: to, updatedAt: new Date() }).where(eq(S.bookings.id, id));
  await db.insert(S.bookingEvents).values({
    bookingId: id, fromStatus: booking.status, toStatus: to, command: "dispatch.start", actorRole: "system",
  });

  await audit({
    actorId: req.user!.sub, actorRole: "citizen", action: "dispatch.started",
    entity: "booking", entityId: id,
    after: { offers: wave.offers.length, radiusKm, wave: 1,
             topMechanicId: wave.ranked[0]?.id ?? null, skipped: wave.skipped.length },
    ip: req.ip,
  });
  publish(req.user!.sub, { type: "booking.status", bookingId: id, status: to, offers: wave.offers.length });

  logOp(req, {
    op: "dispatch.start", result: "ok", durationMs: Date.now() - t0,
    bookingId: id, radiusKm, waveSize: limit, offers: wave.offers.length,
    skippedProviders: wave.skipped.length,
  });

  return ok({ status: to, offers: wave.offers }, {
    rankedBy: "rules-1.0.0", radiusKm, wave: 1, waveSize: limit,
    skippedByState: wave.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.state] = (acc[s.state] ?? 0) + 1; return acc;
    }, {}),
    offerTtlSeconds: env.offerTtlSeconds,
  });
});

/**
 * Decline an offer.
 *
 * This endpoint did not exist. `DECLINED` was in the enum and nothing ever
 * wrote it, so a mechanic's only way to refuse a job was to ignore it and burn
 * the whole offer window — which the customer experiences as ninety seconds of
 * nothing happening for a job that was never going to be taken.
 *
 * Declining closes the offer and advances the ladder immediately, so a refusal
 * costs the customer the round trip rather than the timeout.
 */
app.post("/v1/offers/:offerId/decline", { preHandler: [authenticate, limit("accept")] }, async (req) => {
  const { offerId } = z.object({ offerId: z.string().uuid() }).parse(req.params);
  const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});

  const [offer] = await db.select().from(S.dispatchOffers)
    .where(eq(S.dispatchOffers.id, offerId)).limit(1);
  if (!offer) throw fail("NOT_FOUND", "Offer not found");

  // Only the provider it was sent to may refuse it. A customer declining on a
  // mechanic's behalf would be indistinguishable from the mechanic refusing,
  // and the mechanic's acceptance rate is part of their record.
  const [offerMech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
    .where(eq(S.mechanics.id, offer.mechanicId)).limit(1);
  if (offerMech?.userId !== req.user!.sub && !req.user!.roles.includes("admin")) {
    throw fail("FORBIDDEN", "That offer was not sent to you");
  }

  // Compare-and-swap: a decline racing an accept, an expiry or a second tap
  // must not reopen a closed offer.
  const closed = await db.update(S.dispatchOffers)
    .set({ status: "DECLINED", respondedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(S.dispatchOffers.id, offerId), eq(S.dispatchOffers.status, "SENT")))
    .returning({ id: S.dispatchOffers.id });

  if (!closed.length) {
    throw fail("OFFER_CLOSED", `This offer is already ${offer.status.toLowerCase()}`);
  }

  await audit({
    actorId: req.user!.sub, actorRole: "mechanic", action: "dispatch.provider_rejected",
    entity: "dispatch_offer", entityId: offerId,
    after: { bookingId: offer.bookingId, mechanicId: offer.mechanicId, reason: reason ?? null },
    ip: req.ip,
  });

  // Persisted first; the ladder moves second.
  const next = await escalate(offer.bookingId, "declined");
  logOp(req, {
    op: "dispatch.decline", result: "ok", bookingId: offer.bookingId,
    mechanicId: offer.mechanicId, escalated: next.escalated, exhausted: next.exhausted,
  });

  return ok({ offerId, status: "DECLINED", bookingId: offer.bookingId }, {
    escalated: next.escalated,
    note: next.exhausted
      ? "Declined. Every provider in range has now been asked."
      : next.escalated
        ? `Declined. The job was offered to ${next.offers} more provider(s).`
        : "Declined. Other providers still hold live offers for this job.",
  });
});

app.post("/v1/offers/:offerId/accept", { preHandler: [authenticate, limit("accept")] }, async (req, reply) => {
  const { offerId } = z.object({ offerId: z.string().uuid() }).parse(req.params);
  const [offer] = await db.select().from(S.dispatchOffers).where(eq(S.dispatchOffers.id, offerId)).limit(1);
  if (!offer) return reply.code(404).send({ error: { code: "not_found", title: "Offer not found", retryable: false } });

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, offer.bookingId)).limit(1);

  // Only the offer's mechanic, the customer who owns the booking, or an admin
  // may act on an offer — checked before the status so strangers learn nothing.
  const caller = req.user!;
  const [offerMech] = await db.select({ userId: S.mechanics.userId }).from(S.mechanics)
    .where(eq(S.mechanics.id, offer.mechanicId)).limit(1);
  if (booking.userId !== caller.sub && offerMech?.userId !== caller.sub && !caller.roles.includes("admin")) {
    return reply.code(403).send({ error: { code: "forbidden", title: "That offer is not yours to accept", retryable: false } });
  }

  /**
   * Two mechanics must never both succeed here.
   *
   * The status read above is a courtesy — it produces a fast, friendly 409 for
   * the ordinary case. It cannot be the guard: two requests arriving in the same
   * millisecond both read `SENT`, both pass, and both write `bookings.mechanic_id`
   * — last writer wins, both mechanics are told they got the job, and one of
   * them drives to a customer who is expecting somebody else.
   *
   * So the decision is made inside the transaction, behind `SELECT … FOR UPDATE`
   * on the BOOKING row. Every accept for a booking — whichever offer it names —
   * queues on that one row, so the second request reads the first request's
   * committed result rather than the state it started from. Locking the booking
   * rather than the offer is what makes that true across *different* offers for
   * the same job, which is exactly the case that was broken.
   *
   * Expiry is enforced here too. The mechanic's inbox already hides expired
   * offers, but hiding a button is not a rule: a replayed request, a stale tab
   * or a direct API call could accept an offer whose window closed twenty
   * minutes ago and steal a job from whoever accepted legitimately (§4).
   */
  type AcceptOutcome =
    | { ok: true; to: Status }
    | { ok: false; code: string; title: string };

  const outcome = await db.transaction(async (tx): Promise<AcceptOutcome> => {
    const [locked] = await tx.execute<{ id: string; status: string; mechanic_id: string | null }>(
      raw`SELECT id, status, mechanic_id FROM bookings WHERE id = ${offer.bookingId} FOR UPDATE`);
    if (!locked) return { ok: false, code: "not_found", title: "Booking not found" };

    // Re-read under the lock. This is the value the decision is made on.
    const [fresh] = await tx.select().from(S.dispatchOffers)
      .where(eq(S.dispatchOffers.id, offerId)).limit(1);

    if (fresh.status !== "SENT") {
      return { ok: false, code: "offer_closed", title: `This offer is already ${fresh.status.toLowerCase()}` };
    }
    if (fresh.expiresAt.getTime() <= Date.now()) {
      // Record the expiry rather than just refusing, so the offer stops being
      // offered and the dispatch ladder can move on.
      await tx.update(S.dispatchOffers).set({ status: "EXPIRED", updatedAt: new Date() })
        .where(and(eq(S.dispatchOffers.id, offerId), eq(S.dispatchOffers.status, "SENT")));
      return { ok: false, code: "offer_expired", title: "This offer expired before it was accepted" };
    }
    if (locked.mechanic_id) {
      return { ok: false, code: "already_assigned", title: "Another mechanic has already accepted this job" };
    }

    // The state machine gets the locked status, not the one read before the
    // lock — a booking cancelled a moment ago must not be assignable.
    const next = apply(locked.status as Status, "mechanic.accept");

    await tx.update(S.dispatchOffers).set({ status: "ACCEPTED", respondedAt: new Date(), updatedAt: new Date() })
      .where(eq(S.dispatchOffers.id, offerId));
    await tx.update(S.dispatchOffers).set({ status: "WITHDRAWN", updatedAt: new Date() })
      .where(and(eq(S.dispatchOffers.bookingId, offer.bookingId), eq(S.dispatchOffers.status, "SENT")));
    await tx.update(S.bookings)
      .set({ status: next.to, mechanicId: offer.mechanicId, assignedAt: new Date(), updatedAt: new Date() })
      .where(eq(S.bookings.id, offer.bookingId));
    await tx.insert(S.bookingEvents).values({
      bookingId: offer.bookingId, fromStatus: locked.status as Status, toStatus: next.to,
      command: "mechanic.accept", actorId: offer.mechanicId, actorRole: "mechanic",
    });
    return { ok: true, to: next.to };
  });

  if (!outcome.ok) {
    await audit({
      actorId: caller.sub, actorRole: "mechanic", action: "dispatch.provider_rejected_race",
      entity: "dispatch_offer", entityId: offerId,
      after: { reason: outcome.code, bookingId: offer.bookingId }, ip: req.ip,
    });
    return reply.code(outcome.code === "not_found" ? 404 : 409)
      .send({ error: { code: outcome.code, title: outcome.title, retryable: false, requestId: req.id } });
  }

  await audit({
    actorId: caller.sub, actorRole: "mechanic", action: "dispatch.provider_accepted",
    entity: "booking", entityId: offer.bookingId,
    after: { offerId, mechanicId: offer.mechanicId, status: outcome.to, etaMinutes: offer.etaMinutes },
    ip: req.ip,
  });
  publish(booking.userId!, {
    type: "booking.status", bookingId: offer.bookingId, status: outcome.to,
    mechanicId: offer.mechanicId, etaMinutes: offer.etaMinutes,
  });

  return ok({ bookingId: offer.bookingId, status: outcome.to, mechanicId: offer.mechanicId, etaMinutes: offer.etaMinutes },
             { nextCommands: allowedFrom(outcome.to) });
});

/** Generic guarded transition — every other state change goes through here. */
app.post("/v1/bookings/:id/transition", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { command } = z.object({ command: z.string() }).parse(req.body);

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });

  const caller = req.user!;
  if (!(await bookingAudience(booking, caller)).allowed) {
    return reply.code(403).send({ error: notYours });
  }

  // The state machine says PAID follows COMPLETED; it cannot say whether the
  // money arrived. Until this check existed any client could post
  // "payment.settled" and close its own invoice for free — the command is now
  // only the *record* of a settlement that POST /v1/bookings/:id/pay made.
  if (command === "payment.settled" && !(await invoiceIsSettled(id))) {
    return reply.code(409).send({
      error: {
        code: "payment_required",
        title: "This invoice has not been paid yet. Settle it via POST /v1/bookings/:id/pay.",
        retryable: false,
      },
    });
  }

  const { to, cancellationFee } = apply(booking.status as Status, command as Command);

  const patch: Record<string, unknown> = { status: to, updatedAt: new Date(), version: booking.version + 1 };
  if (to === "COMPLETED") patch.completedAt = new Date();
  if (to === "CANCELLED") { patch.cancelledAt = new Date(); patch.cancelReason = "user_cancelled"; }

  let invoice = null;
  const applied = await db.transaction(async (tx) => {
    // Guarded update: the row must still be in the state the transition was
    // computed from, so two concurrent commands cannot both win.
    const updated = await tx.update(S.bookings).set(patch)
      .where(and(eq(S.bookings.id, id), eq(S.bookings.status, booking.status)))
      .returning({ id: S.bookings.id, mechanicId: S.bookings.mechanicId });
    if (!updated.length) return false;

    // The mechanic's record moves in the same transaction as the job, so the
    // two cannot disagree: if the status write rolls back, so does the count.
    // Once per booking by construction, not by a check — the guarded update
    // above lets exactly one request move a booking out of IN_PROGRESS, and a
    // replayed work.complete is refused by the state machine before it gets
    // here (see finishesJob). The mechanic comes from the row as updated, not
    // from the read before it.
    const mechanicId = updated[0]?.mechanicId;
    if (finishesJob(to) && mechanicId) {
      await tx.update(S.mechanics)
        .set({ jobsCompleted: raw`${S.mechanics.jobsCompleted} + 1`, updatedAt: new Date() })
        .where(eq(S.mechanics.id, mechanicId));
    }

    await tx.insert(S.bookingEvents).values({
      bookingId: id, fromStatus: booking.status, toStatus: to,
      command, actorId: caller.sub, actorRole: caller.roles[0] ?? "citizen",
    });

    if (to === "COMPLETED") {
      const [svc] = booking.serviceTypeId
        ? await tx.select().from(S.serviceTypes).where(eq(S.serviceTypes.id, booking.serviceTypeId)).limit(1)
        : [];
      const labour = svc?.baseFarePaise ?? 39900;
      const tax = Math.round(labour * 0.18);
      [invoice] = await tx.insert(S.invoices).values({
        bookingId: id, number: "INV" + randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase(),
        labourPaise: labour, partsPaise: 0, taxPaise: tax, totalPaise: labour + tax,
        breakdown: { labour, parts: 0, tax, note: "GST at 18% on labour" },
      }).returning();
    }
    return true;
  });

  if (!applied) {
    return reply.code(409).send({
      error: { code: "conflict", title: "The booking changed while this request was in flight. Reload and retry.", retryable: true },
    });
  }

  await audit({
    actorId: caller.sub, actorRole: caller.roles[0] ?? "citizen",
    action: "booking.status_changed", entity: "booking", entityId: id,
    before: { status: booking.status }, after: { status: to, command },
    ip: req.ip,
  });
  // Persisted first, published second — both sides of the job learn at once.
  await notifyBooking({ id, userId: booking.userId, mechanicId: booking.mechanicId }, {
    type: "booking.status", status: to, previous: booking.status, command,
    invoiceTotalPaise: invoice ? (invoice as { totalPaise: number }).totalPaise : undefined,
  });

  return ok({ id, status: to, cancellationFee, invoice }, { nextCommands: allowedFrom(to) });
});


// ══ reviews ════════════════════════════════════════════════════════════════
/**
 * Rate a finished job.
 *
 * This closes a loop that was open: the dispatch ranker weights a mechanic's
 * `rating` at 34% of their score (`rankMechanics`), but nothing in the platform
 * ever wrote that column — every mechanic carried whatever the seed invented.
 * A review now recomputes it from real ratings, so ranking is answerable to the
 * customers who were actually served.
 *
 * Only the customer, only on a booking they paid for, and only once — the
 * unique index on booking_id is what makes "once" true even under a double tap.
 */
app.post("/v1/bookings/:id/review", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(500).optional(),
  }).parse(req.body);

  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });

  // Deliberately narrower than bookingAudience: a mechanic reviewing the job
  // they were paid for would be rating themselves.
  if (booking.userId !== req.user!.sub) {
    return reply.code(403).send({
      error: { code: "forbidden", title: "Only the customer on a booking can review it", retryable: false },
    });
  }
  if (booking.status !== "PAID") {
    return reply.code(409).send({
      error: {
        code: "not_reviewable",
        title: `A booking in ${booking.status} cannot be reviewed yet — rate the job once it is done and paid.`,
        retryable: false,
      },
    });
  }
  if (!booking.mechanicId) {
    return reply.code(409).send({
      error: { code: "no_mechanic", title: "No mechanic was assigned to this booking", retryable: false },
    });
  }

  // Recompute from the reviews themselves rather than nudging a running
  // average: the stored value is then always reproducible from the source rows
  // and the mechanic's baseline, with no rounding drift across reviews. Shrunk
  // toward that baseline — the rating the mechanic arrived with, or the
  // platform mean if there was none — so one rating cannot decide a livelihood
  // in either direction. See shrunkRating and ratingBaseline.
  //
  // One transaction, behind a lock on the mechanic's row: the baseline is
  // decided by whether this is their FIRST review, and two customers rating
  // the same mechanic at once must not both believe they are first, nor each
  // compute an average that misses the other's review.
  const mechanicId = booking.mechanicId;
  const outcome = await db.transaction(async (tx) => {
    const [mechanic] = await tx.select({ rating: S.mechanics.rating, ratingBaseline: S.mechanics.ratingBaseline })
      .from(S.mechanics).where(eq(S.mechanics.id, mechanicId)).for("update");

    const [review] = await tx.insert(S.reviews).values({
      bookingId: id, userId: req.user!.sub, mechanicId,
      rating: body.rating, comment: body.comment,
    }).onConflictDoNothing().returning();
    if (!review) return null;

    const [agg] = await tx.select({
      total: raw<string>`coalesce(sum(${S.reviews.rating}), 0)`,
      count: raw<string>`count(*)`,
    }).from(S.reviews).where(and(eq(S.reviews.mechanicId, mechanicId), isNull(S.reviews.deletedAt)));

    const count = Number(agg?.count ?? 1);
    const baseline = ratingBaseline(mechanic?.ratingBaseline, mechanic?.rating, count - 1);
    const average = shrunkRating(Number(agg?.total ?? body.rating), count, ratingPrior(baseline));
    await tx.update(S.mechanics)
      .set({ rating: average, ratingBaseline: baseline, updatedAt: new Date() })
      .where(eq(S.mechanics.id, mechanicId));
    return { review, average, count, before: mechanic?.rating ?? null };
  });

  if (!outcome) {
    return reply.code(409).send({
      error: { code: "already_reviewed", title: "You have already rated this job", retryable: false },
    });
  }
  const { review, average, count } = outcome;

  await audit({
    actorId: req.user!.sub, actorRole: req.user!.roles[0] ?? "citizen",
    action: "review.created", entity: "booking", entityId: id,
    // The rating before as well as after: an overwritten rating is otherwise
    // unrecoverable, which is exactly what made the old rule's damage permanent.
    before: { mechanicRating: outcome.before == null ? null : String(outcome.before) },
    after: { rating: body.rating, mechanicId, mechanicRatingNow: String(average) },
    ip: req.ip,
  });

  return reply.code(201).send(ok(
    { ...review, mechanicRating: average, mechanicReviewCount: count },
    { message: "Thanks — this mechanic's ranking now reflects your rating." },
  ));
});

/** A mechanic's public record: the aggregate, and the reviews behind it. */
app.get("/v1/mechanics/:id/reviews", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { limit = 20 } = z.object({ limit: z.coerce.number().min(1).max(100).optional() }).parse(req.query);

  const [mechanic] = await db.select({
    id: S.mechanics.id, displayName: S.mechanics.displayName,
    rating: S.mechanics.rating, jobsCompleted: S.mechanics.jobsCompleted,
  }).from(S.mechanics).where(eq(S.mechanics.id, id)).limit(1);
  if (!mechanic) return reply.code(404).send({ error: { code: "not_found", title: "Mechanic not found", retryable: false } });

  // The comment and the score are public; who wrote them is not.
  const rows = await db.select({
    id: S.reviews.id, rating: S.reviews.rating,
    comment: S.reviews.comment, createdAt: S.reviews.createdAt,
  }).from(S.reviews)
    .where(and(eq(S.reviews.mechanicId, id), isNull(S.reviews.deletedAt)))
    .orderBy(desc(S.reviews.createdAt)).limit(limit);

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star, count: rows.filter((r) => r.rating === star).length,
  }));
  return ok({ mechanic, reviews: rows, distribution }, { count: rows.length });
});

app.get("/v1/bookings/:id", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
  if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });
  // Same audience as the transition endpoint: customer, assigned mechanic, or
  // admin. Without the mechanic clause the write path was strictly more
  // permissive than the read path — the assigned mechanic could drive a job
  // they were not allowed to look at.
  if (!(await bookingAudience(booking, req.user!)).allowed) {
    return reply.code(403).send({ error: notYours });
  }
  const events = await db.select().from(S.bookingEvents)
    .where(eq(S.bookingEvents.bookingId, id)).orderBy(S.bookingEvents.createdAt);

  // ── everything a tracking screen needs, in the one call it already makes ──
  // This used to return `mechanicId` and nothing else about the mechanic, so a
  // client could name who was assigned but never show where they were, how far
  // off, or how to reach them — it had to be invented client-side or omitted.
  const audience = await bookingAudience(booking, req.user!);
  const [vehicle] = await db.select({
    registrationNo: S.vehicles.registrationNo, nickname: S.vehicles.nickname,
    vehicleClass: S.vehicles.vehicleClass, fuel: S.vehicles.fuel,
  }).from(S.vehicles).where(eq(S.vehicles.id, booking.vehicleId)).limit(1);

  const [serviceType] = booking.serviceTypeId
    ? await db.select({ code: S.serviceTypes.code, label: S.serviceTypes.label,
                        etaMinutes: S.serviceTypes.etaMinutes })
        .from(S.serviceTypes).where(eq(S.serviceTypes.id, booking.serviceTypeId)).limit(1)
    : [];

  // Distance is computed in PostGIS against the booking's own point rather than
  // trusted from the offer row: an offer's distance is a snapshot from dispatch
  // time, and the mechanic has been driving since.
  const [mechanic] = booking.mechanicId
    ? await db.execute<{
        id: string; display_name: string; rating: number; jobs_completed: number;
        msisdn: string | null; lat: number | null; lng: number | null; km: number | null;
        last_location_at: string | null;
      }>(raw`
        SELECT m.id, m.display_name, m.rating, m.jobs_completed, u.msisdn,
               ST_Y(m.last_location) AS lat, ST_X(m.last_location) AS lng,
               m.last_location_at,
               round((ST_Distance(m.last_location::geography, b.location::geography)
                      / 1000)::numeric, 1) AS km
          FROM mechanics m
          JOIN users u ON u.id = m.user_id
          JOIN bookings b ON b.id = ${id}
         WHERE m.id = ${booking.mechanicId}`)
    : [];

  // Derived, never stored — a status column would drift from the booking state
  // machine and the offer table, and be wrong at exactly the wrong moment.
  const providerState = booking.mechanicId ? await providerStateFor(booking.mechanicId) : null;

  // The customer's own number, for the mechanic who has to find them. Each side
  // sees exactly one number — the other party's — and only once a mechanic is
  // actually assigned. An admin reading the booking gets neither.
  const [customer] = audience.isAssignedMechanic
    ? await db.select({ msisdn: S.users.msisdn, fullName: S.users.fullName })
        .from(S.users).where(eq(S.users.id, booking.userId)).limit(1)
    : [];

  const [invoice] = await db.select().from(S.invoices)
    .where(and(eq(S.invoices.bookingId, id), isNull(S.invoices.deletedAt))).limit(1);
  const [review] = await db.select({ rating: S.reviews.rating })
    .from(S.reviews).where(eq(S.reviews.bookingId, id)).limit(1);

  // A geometry column comes back as {x, y}; every client then has to remember
  // which one is the latitude. Name them.
  const point = booking.location as { x: number; y: number } | null;

  // ETA: minutes of driving left, from live distance at a roadside-realistic
  // 24 km/h, floored at the service type's own promise. Only meaningful while
  // someone is actually travelling, so it is null everywhere else.
  const travelling = booking.status === "ASSIGNED" || booking.status === "EN_ROUTE";
  const etaMinutes = travelling && mechanic?.km != null
    ? Math.max(2, Math.round((Number(mechanic.km) / 24) * 60))
    : null;

  return ok({
    ...booking,
    lat: point?.y ?? null,
    lng: point?.x ?? null,
    events,
    vehicle: vehicle ?? null,
    serviceType: serviceType ?? null,
    invoice: invoice ?? null,
    hasReview: Boolean(review),
    etaMinutes,
    // The moment the server last changed anything here. A tracking screen shows
    // it so "nothing has happened for eleven minutes" is a visible fact rather
    // than something the user has to infer from a screen that looks alive.
    lastUpdatedAt: booking.updatedAt,
    mechanic: mechanic
      ? {
          id: mechanic.id,
          displayName: mechanic.display_name,
          rating: Number(mechanic.rating),
          jobsCompleted: Number(mechanic.jobs_completed),
          // Real coordinates or null — never a fabricated position. `lat`/`lng`
          // come straight from `mechanics.last_location`, which is written only
          // when a provider's device actually reports one.
          lat: mechanic.lat, lng: mechanic.lng,
          locationKnown: mechanic.lat != null && mechanic.lng != null,
          lastLocationAt: isoTimestamp(mechanic.last_location_at),
          distanceKm: mechanic.km == null ? null : Number(mechanic.km),
          // What the provider is actually doing, derived from live state rather
          // than from a column that could be stale (see domain/provider-state.ts).
          state: providerState,
          stateLabel: providerState ? describeProviderState(providerState) : null,
          // Only the customer on this booking may call the mechanic.
          msisdn: booking.userId === req.user!.sub ? mechanic.msisdn : null,
        }
      : null,
    customer: customer ? { fullName: customer.fullName, msisdn: customer.msisdn } : null,
  }, { nextCommands: allowedFrom(booking.status as Status) });
});

app.get("/v1/bookings", { preHandler: authenticate }, async (req) => {
  const { limit = 20 } = z.object({ limit: z.coerce.number().min(1).max(100).optional() }).parse(req.query);
  const rows = await db.select().from(S.bookings)
    .where(and(eq(S.bookings.userId, req.user!.sub), isNull(S.bookings.deletedAt)))
    .orderBy(desc(S.bookings.createdAt)).limit(limit);
  return ok(rows, { count: rows.length });
});

// ══ offline sync ═══════════════════════════════════════════════════════════
app.post("/v1/sync/operations", { preHandler: [authenticate, limit("sync")] }, async (req) => {
  const { operations } = z.object({
    operations: z.array(z.object({
      opId: z.string().min(8).max(64),
      entity: z.string().max(40),
      /** Which row the operation is about, when it is about an existing one. */
      entityId: z.string().uuid().optional(),
      operation: z.enum(["create", "update", "delete"]),
      payload: z.record(z.unknown()),
      clientUpdatedAt: z.coerce.date(),
    })).max(200),
  }).parse(req.body);

  const results: Array<Record<string, unknown>> = [];
  for (const op of operations) {
    /**
     * ── conflict resolution (ADR-0004 §8) ───────────────────────────────────
     *
     * A device that was offline can hold a stale belief about a booking: it
     * left the network at EN_ROUTE, and by the time it reconnects the mechanic
     * has already marked ARRIVED. If the client's assertion were replayed
     * blindly, the newer, correct state would be overwritten by an older one —
     * and the customer would watch their mechanic un-arrive.
     *
     * ADR-0004 settled the rule before any sync code existed: **booking status
     * is server-authoritative.** So a status assertion is never applied. It is
     * refused, written to `conflict_log` with the rule that fired, and the
     * device is handed the authoritative value so it can correct itself in the
     * same round trip rather than needing a second call to discover it was
     * wrong.
     */
    const asserted = (op.payload as { status?: unknown }).status;
    let conflict: { field: string; serverValue: unknown; clientValue: unknown } | null = null;
    let authoritative: Record<string, unknown> | null = null;

    if (op.entity === "booking" && op.entityId && typeof asserted === "string") {
      const [server] = await db.select().from(S.bookings)
        .where(eq(S.bookings.id, op.entityId)).limit(1);
      if (!server) {
        results.push({ opId: op.opId, status: "rejected", reason: "no such booking" });
        continue;
      }
      // Ownership is re-checked here too: an operation replayed from a device
      // is unauthenticated data inside an authenticated request.
      if (server.userId !== req.user!.sub && !req.user!.roles.includes("admin")) {
        results.push({ opId: op.opId, status: "rejected", reason: "that booking is not yours" });
        continue;
      }
      authoritative = { id: server.id, status: server.status, updatedAt: server.updatedAt };
      if (server.status !== asserted) {
        conflict = { field: "status", serverValue: server.status, clientValue: asserted };
      }
    }

    // op_id is unique, so a replay is a no-op rather than a duplicate booking.
    const [inserted] = await db.insert(S.syncOperations).values({
      userId: req.user!.sub, opId: op.opId, entity: op.entity, entityId: op.entityId,
      operation: op.operation, payload: op.payload, clientUpdatedAt: op.clientUpdatedAt,
      appliedAt: conflict ? null : new Date(),
      rejectedReason: conflict
        ? `status is server-authoritative (ADR-0004): server=${conflict.serverValue}, client=${conflict.clientValue}`
        : null,
    }).onConflictDoNothing().returning({ id: S.syncOperations.id });

    if (!inserted) {
      results.push({ opId: op.opId, status: "duplicate",
        reason: "already applied — replay is safe", authoritative });
      continue;
    }

    if (conflict) {
      // A wrong rule has to be findable after the fact rather than invisible,
      // which is what this table is for.
      await db.insert(S.conflictLog).values({
        syncOperationId: inserted.id, entity: op.entity, field: conflict.field,
        rule: "server_wins",
        serverValue: conflict.serverValue, clientValue: conflict.clientValue,
        resolvedValue: conflict.serverValue,
      });
      results.push({
        opId: op.opId, status: "conflict", rule: "server_wins",
        reason: "booking status is server-authoritative — the server's value stands",
        serverValue: conflict.serverValue, clientValue: conflict.clientValue,
        authoritative,
      });
      continue;
    }

    results.push({ opId: op.opId, status: "applied", authoritative });
  }

  const applied = results.filter((r) => r.status === "applied").length;
  const conflicts = results.filter((r) => r.status === "conflict").length;
  await audit({
    actorId: req.user!.sub, actorRole: req.user!.roles[0] ?? "citizen",
    action: "sync.completed", entity: "sync_batch", entityId: null,
    after: { kind: "operations", submitted: operations.length, applied, conflicts,
             duplicates: results.filter((r) => r.status === "duplicate").length,
             rejected: results.filter((r) => r.status === "rejected").length },
    ip: req.ip,
  });

  return ok({ results }, {
    applied, conflicts,
    note: conflicts
      ? "Some operations conflicted. The server's value is authoritative — apply `authoritative` locally."
      : undefined,
  });
});

// ══ emergency contacts ═════════════════════════════════════════════════════
app.get("/v1/me/emergency-contacts", { preHandler: authenticate }, async (req) => {
  const rows = await db.select().from(S.emergencyContacts)
    .where(and(eq(S.emergencyContacts.userId, req.user!.sub), isNull(S.emergencyContacts.deletedAt)))
    .orderBy(S.emergencyContacts.priority);
  return ok(rows);
});

app.post("/v1/me/emergency-contacts", { preHandler: authenticate }, async (req, reply) => {
  const body = z.object({
    name: z.string().min(1).max(120),
    msisdn: msisdnSchema,
    relation: z.string().max(40).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  }).parse(req.body);

  const [row] = await db.insert(S.emergencyContacts).values({
    userId: req.user!.sub, name: body.name, msisdn: body.msisdn,
    relation: body.relation, priority: body.priority ?? 1,
  }).returning();
  return reply.code(201).send(ok(row));
});

app.delete("/v1/me/emergency-contacts/:id", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  // Soft delete, scoped to the owner — a contact id alone is not authority.
  const rows = await db.update(S.emergencyContacts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(S.emergencyContacts.id, id), eq(S.emergencyContacts.userId, req.user!.sub)))
    .returning({ id: S.emergencyContacts.id });
  if (!rows.length) {
    return reply.code(404).send({ error: { code: "not_found", title: "Contact not found", retryable: false } });
  }
  return ok({ id, removed: true });
});

// ══ medical profile ════════════════════════════════════════════════════════
/**
 * The information a paramedic needs about an unconscious person: blood group,
 * allergies, conditions, current medications.
 *
 * It is the most sensitive data the platform holds, so it is readable by
 * exactly two parties — the person it describes, and a responder standing at
 * the scene of *their* live incident, who has to give a reason that is written
 * down (see break-glass below). There is no third path, including for admins.
 */
const medicalSchema = z.object({
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  allergies: z.string().max(500).optional(),
  conditions: z.string().max(500).optional(),
  medications: z.string().max(500).optional(),
});

app.get("/v1/me/medical", { preHandler: authenticate }, async (req) => {
  const [row] = await db.select().from(S.medicalProfiles)
    .where(and(eq(S.medicalProfiles.userId, req.user!.sub), isNull(S.medicalProfiles.deletedAt)))
    .limit(1);
  return ok(row ?? null, { configured: Boolean(row) });
});

app.put("/v1/me/medical", { preHandler: authenticate }, async (req) => {
  const body = medicalSchema.parse(req.body ?? {});
  const userId = req.user!.sub;

  const [existing] = await db.select({ id: S.medicalProfiles.id, version: S.medicalProfiles.version })
    .from(S.medicalProfiles).where(eq(S.medicalProfiles.userId, userId)).limit(1);

  let row;
  if (existing) {
    [row] = await db.update(S.medicalProfiles)
      .set({ ...body, deletedAt: null, updatedAt: new Date(), version: existing.version + 1 })
      .where(eq(S.medicalProfiles.id, existing.id)).returning();
  } else {
    [row] = await db.insert(S.medicalProfiles).values({ userId, ...body }).returning();
  }

  // The values are never audited, only the fact of a change: an audit log that
  // copies the record defeats the point of restricting the record.
  await audit({
    actorId: userId, actorRole: req.user!.roles[0] ?? "citizen",
    action: "medical.updated", entity: "medical_profile", entityId: row.id,
    after: { fieldsSet: Object.keys(body).sort().join(",") || "none" }, ip: req.ip,
  });
  return ok(row);
});

/**
 * Break-glass: a responder reads the medical record of the person in a live
 * incident.
 *
 * Emergencies are exactly when a consent dialogue is impossible, so the answer
 * is not to refuse — it is to let the read happen and make it impossible to
 * hide. Every condition below is a deliberate narrowing:
 *
 *   · authority role only (gov_officer or admin);
 *   · the incident must be live — a resolved or cancelled one is history, and
 *     history is not an emergency;
 *   · a written reason is mandatory and is stored verbatim;
 *   · the access is recorded in break_glass_access AND in the hash-chained
 *     audit log, so it cannot be quietly deleted afterwards;
 *   · the subject is notified that it happened.
 */
const LIVE_INCIDENT = ["DETECTED", "AWAITING_CONFIRMATION", "CONFIRMED", "RESPONDING"] as const;

app.get("/v1/incidents/:id/medical", {
  // gov_officer is this platform's emergency-authority persona — the same role
  // that drives the RAKSHA dashboard. There is no separate "responder" role.
  preHandler: [authenticate, requireRole("admin", "gov_officer")],
}, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { reason } = z.object({
    reason: z.string().min(10).max(300),
  }).parse(req.query);

  const [incident] = await db.select().from(S.incidents).where(eq(S.incidents.id, id)).limit(1);
  if (!incident) return reply.code(404).send({ error: { code: "not_found", title: "Incident not found", retryable: false } });

  if (!LIVE_INCIDENT.includes(incident.status as (typeof LIVE_INCIDENT)[number])) {
    return reply.code(403).send({
      error: {
        code: "incident_not_live",
        title: `This incident is ${incident.status}. Break-glass access is only for an emergency in progress.`,
        retryable: false,
      },
    });
  }
  if (!incident.userId) {
    return reply.code(409).send({
      error: { code: "no_subject", title: "This incident is not attached to a person", retryable: false },
    });
  }

  const subjectUserId = incident.userId;
  const [profile] = await db.select().from(S.medicalProfiles)
    .where(and(eq(S.medicalProfiles.userId, subjectUserId), isNull(S.medicalProfiles.deletedAt)))
    .limit(1);

  // Recorded whether or not a profile exists: an attempted read is as much a
  // fact about the responder's behaviour as a successful one.
  const [access] = await db.insert(S.breakGlassAccess).values({
    incidentId: id, actorId: req.user!.sub,
    actorRole: req.user!.roles.includes("admin") ? "admin" : "gov_officer",
    reason, subjectUserId,
  }).returning();

  await audit({
    actorId: req.user!.sub, actorRole: req.user!.roles[0] ?? "gov_officer",
    action: "medical.break_glass_read", entity: "incident", entityId: id,
    after: {
      subjectUserId, reason, found: Boolean(profile),
      breakGlassId: access.id,
    },
    ip: req.ip,
  });

  // The subject learns their record was opened. Best-effort: a failed SMS must
  // not withhold data from a paramedic, but the unsent notice stays visible as
  // user_notified_at being null.
  const [subject] = await db.select({ msisdn: S.users.msisdn })
    .from(S.users).where(eq(S.users.id, subjectUserId)).limit(1);
  if (subject?.msisdn) {
    try {
      await sms.send(subject.msisdn,
        "RoadAssist: your emergency medical details were opened by a responder during your active incident. " +
        `Reason recorded: ${reason}`);
      await db.update(S.breakGlassAccess)
        .set({ userNotifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(S.breakGlassAccess.id, access.id));
    } catch (err) {
      req.log.warn({ err }, "break-glass notice could not be delivered");
    }
  }

  return ok(profile ?? null, {
    breakGlassId: access.id,
    notice: "This read was logged against your account and the subject has been notified.",
  });
});

/** What was opened about me, and by whom. The subject's own view of §above. */
app.get("/v1/me/medical/access-log", { preHandler: authenticate }, async (req) => {
  const rows = await db.select({
    id: S.breakGlassAccess.id, incidentId: S.breakGlassAccess.incidentId,
    actorRole: S.breakGlassAccess.actorRole, reason: S.breakGlassAccess.reason,
    at: S.breakGlassAccess.createdAt, notifiedAt: S.breakGlassAccess.userNotifiedAt,
  }).from(S.breakGlassAccess)
    .where(eq(S.breakGlassAccess.subjectUserId, req.user!.sub))
    .orderBy(desc(S.breakGlassAccess.createdAt)).limit(50);
  return ok(rows, { count: rows.length });
});

// ══ vehicle documents ══════════════════════════════════════════════════════
/**
 * Insurance, PUC, RC, permit — and when they run out.
 *
 * An expired PUC or insurance is a stop-and-fine in India, and the renewal
 * dates are the sort of thing nobody remembers until a checkpoint. The photo
 * itself follows ADR-0006: the file lives on disk, only the reference is in the
 * database. A document may also be recorded with no scan at all, because the
 * date is the useful part and demanding an upload would stop people entering it.
 */
const DOC_TYPES = ["rc", "insurance", "puc", "permit"] as const;

app.post("/v1/vehicles/:id/documents", { preHandler: authenticate }, async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({
    docType: z.enum(DOC_TYPES),
    expiresOn: z.coerce.date(),
    objectKey: z.string().max(200).optional(),
  }).parse(req.body);

  const [vehicle] = await db.select({ id: S.vehicles.id }).from(S.vehicles)
    .innerJoin(S.userVehicles, eq(S.userVehicles.vehicleId, S.vehicles.id))
    .where(and(
      eq(S.vehicles.id, id),
      eq(S.userVehicles.userId, req.user!.sub),
      isNull(S.vehicles.deletedAt),
    )).limit(1);
  if (!vehicle) {
    return reply.code(403).send({
      error: { code: "forbidden", title: "That vehicle is not yours", retryable: false },
    });
  }

  // Replace rather than accumulate: a renewed policy supersedes the old one,
  // and two live "insurance" rows would make "when does it expire" ambiguous.
  await db.update(S.vehicleDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(S.vehicleDocuments.vehicleId, id),
      eq(S.vehicleDocuments.docType, body.docType),
      isNull(S.vehicleDocuments.deletedAt),
    ));

  const [row] = await db.insert(S.vehicleDocuments).values({
    vehicleId: id, docType: body.docType, expiresOn: body.expiresOn,
    objectKey: body.objectKey ?? `manual:${randomUUID()}`,
  }).returning();
  return reply.code(201).send(ok(row));
});

/**
 * Every document across the caller's vehicles, soonest expiry first, with the
 * countdown already computed — the client should not have to do date maths to
 * decide what to colour red.
 */
app.get("/v1/me/documents", { preHandler: authenticate }, async (req) => {
  const rows = await db.select({
    id: S.vehicleDocuments.id, vehicleId: S.vehicleDocuments.vehicleId,
    registrationNo: S.vehicles.registrationNo, docType: S.vehicleDocuments.docType,
    expiresOn: S.vehicleDocuments.expiresOn, objectKey: S.vehicleDocuments.objectKey,
  }).from(S.vehicleDocuments)
    .innerJoin(S.vehicles, eq(S.vehicles.id, S.vehicleDocuments.vehicleId))
    .innerJoin(S.userVehicles, eq(S.userVehicles.vehicleId, S.vehicles.id))
    .where(and(
      eq(S.userVehicles.userId, req.user!.sub),
      isNull(S.vehicleDocuments.deletedAt),
      isNull(S.vehicles.deletedAt),
    ))
    .orderBy(asc(S.vehicleDocuments.expiresOn));

  const today = Date.now();
  const documents = rows.map((d) => {
    const days = d.expiresOn
      ? Math.ceil((d.expiresOn.getTime() - today) / 86_400_000)
      : null;
    return {
      ...d,
      hasScan: !d.objectKey.startsWith("manual:"),
      daysToExpiry: days,
      state: days === null ? "unknown" : days < 0 ? "expired" : days <= 30 ? "expiring" : "valid",
    };
  });
  return ok(documents, {
    count: documents.length,
    expired: documents.filter((d) => d.state === "expired").length,
    expiringWithin30Days: documents.filter((d) => d.state === "expiring").length,
  });
});

// ══ audit trail ════════════════════════════════════════════════════════════
/**
 * The audit log, and proof it has not been edited.
 *
 * `verified` re-hashes the chain on every read, so this endpoint does not just
 * show the trail — it answers whether the trail can still be believed.
 */
app.get("/v1/admin/audit", { preHandler: [authenticate, requireRole("admin")] }, async (req) => {
  const { limit = 50 } = z.object({
    limit: z.coerce.number().min(1).max(200).optional(),
  }).parse(req.query);

  const rows = await db.select().from(S.auditLog)
    .orderBy(desc(S.auditLog.createdAt), desc(S.auditLog.id)).limit(limit);
  const integrity = await verifyAuditChain();
  return ok(rows, { count: rows.length, integrity });
});




// ══ email notifications ════════════════════════════════════════════════════
// The platform's email channel (console by default; real delivery when
// EMAIL_PROVIDER=http + vendor creds are set — exactly like the SMS channel).
app.post("/v1/notify/email", { preHandler: [authenticate, requireRole("admin", "gov_officer")] }, async (req, reply) => {
  const body = z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10000),
    html: z.string().max(50000).optional(),
  }).parse(req.body);
  try {
    const result = await email.send(body.to, body.subject, body.body, { html: body.html });
    return ok({ sent: result.delivered, id: result.id, provider: providerSummary().email },
      { note: providerSummary().email === "console" ? "console mode — logged, not transmitted; set EMAIL_PROVIDER=http for real delivery" : undefined });
  } catch (e) {
    return reply.code(502).send({
      error: { code: "email_failed", title: e instanceof Error ? e.message : "Email send failed", retryable: true },
    });
  }
});

// ══ live map — real geolocated data around a point (operational, no PII) ═══
// Powers the in-app map: nearby verified mechanics, active responder units, and
// recent RAKSHA road detections, all from PostGIS over the seeded datasets.
//
// The caps keep one response small enough for a phone on a weak network. They
// only stay harmless if what survives the cap is what the caller is looking
// at, which is why the map sends the centre of its current view and the rows
// are ordered nearest-first. `meta.truncated` says when a cap was hit, so a
// client can tell "these are all of them" from "these are the nearest N".
const MAP_LIMIT = { mechanics: 150, responders: 50, detections: 300 } as const;
app.get("/v1/map/live", { preHandler: authenticate }, async (req) => {
  const q = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().min(1).max(3000).optional(),
  }).parse(req.query);
  const r = (q.radiusKm ?? 40) * 1000;
  const pt = raw`ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)`;

  // Nearest-first by the real distance on the ground. `last_location <-> pt`
  // looked like it, but on geometry it is a distance in raw degrees, and a
  // degree of longitude shrinks with latitude - it is 12% shorter at Gurugram
  // than a degree of latitude - so the rows came back visibly out of order and
  // the cap could drop a mechanic 20 km east in favour of one 22 km north. The
  // ST_DWithin filter above already makes Postgres compute this distance for
  // every row in the radius, so ordering by it costs nothing extra.
  // One row past each cap is read so truncation is known rather than guessed.
  const mechanicRows = await db.execute<Record<string, unknown>>(raw`
    SELECT id, display_name, rating,
           ST_Y(last_location) AS lat, ST_X(last_location) AS lng,
           round((ST_Distance(last_location::geography, ${pt}::geography) / 1000)::numeric, 1) AS km
      FROM mechanics
     WHERE deleted_at IS NULL AND verified AND is_available AND last_location IS NOT NULL
       AND ST_DWithin(last_location::geography, ${pt}::geography, ${r})
     ORDER BY ST_Distance(last_location::geography, ${pt}::geography), id
     LIMIT ${MAP_LIMIT.mechanics + 1}`);
  const mechanics = mechanicRows.slice(0, MAP_LIMIT.mechanics);

  const responderRows = await db.execute<Record<string, unknown>>(raw`
    SELECT name, kind, ST_Y(last_location) AS lat, ST_X(last_location) AS lng
      FROM responder_units
     WHERE deleted_at IS NULL AND active AND last_location IS NOT NULL
       AND ST_DWithin(last_location::geography, ${pt}::geography, ${r})
     ORDER BY ST_Distance(last_location::geography, ${pt}::geography), id
     LIMIT ${MAP_LIMIT.responders + 1}`);
  const responders = responderRows.slice(0, MAP_LIMIT.responders);

  // The radius and the device's simulated flag travel with each point so the
  // map can say which positions a phone measured and which were placed.
  const detectionRows = await db.execute<{
    detection_type: string; severity: number; status: string; source: string;
    lat: number; lng: number; location_accuracy_m: number | null;
    simulated: boolean | null; model_version: string; created_at: string;
  }>(raw`
    SELECT rd.detection_type, rd.severity, rd.status,
           COALESCE(rd.raw->>'source', 'device') AS source,
           ST_Y(rd.location) AS lat, ST_X(rd.location) AS lng, rd.location_accuracy_m,
           ed.simulated, rd.model_version, rd.created_at
      FROM raksha_detections rd
      JOIN edge_devices ed ON ed.id = rd.device_id
     WHERE rd.deleted_at IS NULL AND rd.location IS NOT NULL
       AND rd.status NOT IN ('REJECTED', 'CLOSED')
       AND ST_DWithin(rd.location::geography, ${pt}::geography, ${r})
     ORDER BY rd.created_at DESC LIMIT ${MAP_LIMIT.detections + 1}`);
  const detections = detectionRows.slice(0, MAP_LIMIT.detections).map(({ simulated, model_version, ...d }) => {
    const position = describePosition({
      source: d.source, simulated, modelVersion: model_version, accuracyM: d.location_accuracy_m,
    });
    return { ...d, created_at: isoTimestamp(d.created_at), position_label: position.label };
  });

  return ok({ center: { lat: q.lat, lng: q.lng }, mechanics, responders, detections },
    {
      counts: { mechanics: mechanics.length, responders: responders.length, detections: detections.length },
      limits: MAP_LIMIT,
      truncated: {
        mechanics: mechanicRows.length > MAP_LIMIT.mechanics,
        responders: responderRows.length > MAP_LIMIT.responders,
        detections: detectionRows.length > MAP_LIMIT.detections,
      },
    });
});

// ══ RAKSHA — autonomous road monitoring (ADR-0007) ═════════════════════════
await app.register(authRoutes);
await app.register(emailAuthRoutes);
await app.register(emergencyRoutes);
await app.register(telecomRoutes);
await app.register(mechanicRoutes);
await app.register(paymentRoutes);
await app.register(rakshaRoutes);

// ══ boot ═══════════════════════════════════════════════════════════════════
// The dispatch timeout. Without this an unanswered offer simply stopped being
// listed while the booking sat in MATCHING forever (see dispatch.ts).
startOfferSweeper(app.log);

const close = async () => {
  stopOfferSweeper();
  // Live SSE streams are held open by design, so `app.close()` waits for them
  // until its grace period runs out. Ending them first turns a 30-second
  // shutdown into an immediate one — and each client reconnects on its own
  // `retry` interval once the next instance is up.
  closeAllStreams();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ port: env.port, host: env.host });
app.log.info({ providers: providerSummary() }, "RoadAssist API ready");
app.log.info(alertsStatus());
app.log.info(emailSignin.accounts.size
  ? `email sign-in: ${emailSignin.accounts.size} account(s), via ${providerSummary().email}`
  : "email sign-in: off (EMAIL_SIGNIN unset)");
for (const r of emailSignin.rejected) app.log.warn(`EMAIL_SIGNIN entry ignored: ${r}`);

// Trusting *every* hop means any client that can reach this port may set
// X-Forwarded-For itself, mint a fresh address per request, and walk straight
// through the per-IP OTP ceiling. It is a legitimate setting behind an ingress
// that is genuinely the only way in — and a hole everywhere else — so it is
// never applied silently.
if (env.trustProxy === true) {
  app.log.warn(
    "TRUST_PROXY=true trusts X-Forwarded-For from every peer, so the per-IP OTP " +
    "ceiling can be bypassed by anyone who can reach this port. Set it to your " +
    "proxy's address instead (127.0.0.1,::1 for a local tunnel).",
  );
}
