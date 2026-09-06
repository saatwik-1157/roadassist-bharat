/**
 * The dispatch ladder.
 *
 * ── what was wrong ────────────────────────────────────────────────────────
 * Two things, both found by reading the SQL rather than by guessing.
 *
 * 1. **Busy providers were offered work.** The candidate query filtered on
 *    `m.is_available` and nothing else, so a mechanic already driving to one
 *    breakdown kept receiving offers for the next. `is_available` is a duty
 *    toggle — it says "I am working today", not "I am free right now".
 *
 * 2. **There was no ladder.** Every offer went out in one burst and then
 *    nothing happened. If nobody answered, the offers quietly expired, the
 *    booking sat in MATCHING forever, and the customer watched a spinner. The
 *    "offer expires → try the next provider" behaviour the product describes
 *    did not exist.
 *
 * ── what this does ────────────────────────────────────────────────────────
 * Dispatch runs in WAVES. Each wave offers the job to the next N best providers
 * who are genuinely offerable and have not already seen or refused it. A wave
 * ends when somebody accepts, when every offer in it expires or is declined, or
 * when there is nobody left — and only that last case is NO_SUPPLY.
 *
 * Wave size is the caller's `limit`, defaulting to 5, so existing behaviour is
 * unchanged for anything already calling this. A wave of 1 is the strict
 * one-at-a-time ladder; a wave of 5 is a broadcast that still escalates. Both
 * are correct, and the choice belongs to whoever is dispatching: a customer on
 * a hard shoulder at 2am wants breadth, a busy city depot wants order.
 *
 * `escalate` is called from two places — a decline, and the expiry sweeper —
 * and is safe to call concurrently from both, because the booking's status is
 * the guard and the accept path holds a row lock over it (ADR-0010).
 */
import { and, eq, inArray, isNull, sql as raw } from "drizzle-orm";

import { db } from "./db.js";
import * as S from "@roadassist/db";
import { env } from "./env.js";
import { apply, type Status } from "./domain/booking-machine.js";
import { rankMechanics } from "./domain/ai-rules.js";
import { deriveProviderState, isOfferable, type ProviderState } from "./domain/provider-state.js";
import { publish } from "./realtime.js";
import { audit } from "./audit.js";

export interface RankedProvider {
  id: string;
  displayName: string;
  rating: number;
  jobsCompleted: number;
  distanceKm: number;
  score: number;
  etaMinutes: number;
  state: ProviderState;
}

export interface WaveResult {
  status: Status;
  offers: Array<typeof S.dispatchOffers.$inferSelect & { mechanic?: RankedProvider }>;
  ranked: RankedProvider[];
  /** Providers found in range but skipped, with the reason. Never hidden. */
  skipped: Array<{ id: string; state: ProviderState }>;
  exhausted: boolean;
  radiusKm: number;
}

/**
 * Providers within range, with their real state attached.
 *
 * The exclusions are expressed in SQL rather than filtered afterwards because
 * `LIMIT` has to apply to *offerable* providers — filtering after the limit
 * would silently shrink a wave to nothing whenever the nearest few were busy,
 * which is exactly when dispatch matters most.
 *
 * Providers already offered this job (or who declined it) are excluded too: an
 * escalation that re-offers to the same person is not an escalation.
 */
export async function findCandidates(
  bookingId: string,
  radiusKm: number,
  waveSize: number,
): Promise<{ offerable: RankedProvider[]; skipped: Array<{ id: string; state: ProviderState }> }> {
  /**
   * The exclusions live in SQL, and that placement is load-bearing.
   *
   * The first version of this query fetched the N nearest providers and then
   * filtered them in JavaScript. In a dense area where most providers are off
   * duty — which is every real city outside peak hours — the row limit was
   * exhausted by off-duty mechanics before it reached the free ones, and
   * dispatch reported "nobody available" with five people idle two kilometres
   * away. Filter first, limit second.
   *
   * The row cap is a multiple of the wave so that ranking still has a choice
   * (the nearest provider is not always the best one) without pulling an
   * unbounded set on a busy corridor.
   */
  const rows = await db.execute<{
    id: string; display_name: string; rating: number; jobs_completed: number;
    distance_km: number; is_available: boolean; live_offers: number;
  }>(raw`
    SELECT m.id, m.display_name, m.rating, m.jobs_completed, m.is_available,
           ST_Distance(m.last_location::geography, b.location::geography) / 1000 AS distance_km,
           (SELECT count(*)::int FROM dispatch_offers o
             WHERE o.mechanic_id = m.id AND o.status = 'SENT' AND o.expires_at > now()) AS live_offers
      FROM mechanics m, bookings b
     WHERE b.id = ${bookingId}
       AND m.deleted_at IS NULL AND m.verified AND m.last_location IS NOT NULL
       AND m.is_available
       AND ST_DWithin(m.last_location::geography, b.location::geography, ${radiusKm * 1000})
       -- Committed to another customer. ASSIGNED onward means somebody is
       -- already waiting for them; this is the exclusion that was missing.
       AND NOT EXISTS (
         SELECT 1 FROM bookings ab
          WHERE ab.mechanic_id = m.id AND ab.deleted_at IS NULL
            AND ab.status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS','ESCALATED'))
       -- Anyone who has already seen this job in a previous wave is done with it.
       AND NOT EXISTS (
         SELECT 1 FROM dispatch_offers prev
          WHERE prev.booking_id = b.id AND prev.mechanic_id = m.id)
     ORDER BY m.last_location <-> b.location
     LIMIT ${Math.max(10, waveSize * 4)}`);

  const usable = rows.map((r) => ({
    id: r.id, displayName: r.display_name, rating: Number(r.rating),
    jobsCompleted: Number(r.jobs_completed),
    distanceKm: Number(Number(r.distance_km).toFixed(2)),
    state: deriveProviderState({ isAvailable: true, liveOffers: Number(r.live_offers ?? 0) }),
  })).filter((m) => isOfferable(m.state));

  // Who was in range and passed over, and why. Reported to the customer as
  // named states rather than a bare count, because "everyone nearby is on
  // another job" and "nobody is here" are different problems with different
  // answers — wait, or widen the search.
  const [counts] = await db.execute<{ offline: number; busy: number }>(raw`
    SELECT count(*) FILTER (WHERE NOT m.is_available)::int AS offline,
           count(*) FILTER (WHERE m.is_available AND EXISTS (
             SELECT 1 FROM bookings ab
              WHERE ab.mechanic_id = m.id AND ab.deleted_at IS NULL
                AND ab.status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS','ESCALATED')))::int AS busy
      FROM mechanics m, bookings b
     WHERE b.id = ${bookingId}
       AND m.deleted_at IS NULL AND m.verified AND m.last_location IS NOT NULL
       AND ST_DWithin(m.last_location::geography, b.location::geography, ${radiusKm * 1000})`);

  const skipped: Array<{ id: string; state: ProviderState }> = [
    ...Array.from({ length: Number(counts?.offline ?? 0) }, () => ({ id: "", state: "OFFLINE" as ProviderState })),
    ...Array.from({ length: Number(counts?.busy ?? 0) }, () => ({ id: "", state: "BUSY" as ProviderState })),
  ];

  // Rank first, then take the wave — so a wave of 1 gets the BEST provider, not
  // merely the nearest one the database happened to return first.
  const ranked = rankMechanics(usable).slice(0, waveSize) as RankedProvider[];
  return { offerable: ranked, skipped };
}

/**
 * Send one wave of offers.
 *
 * Returns `exhausted: true` when there is nobody left to ask — the caller
 * decides whether that means NO_SUPPLY (first wave) or the end of the ladder.
 */
export async function sendWave(
  bookingId: string,
  opts: { radiusKm: number; waveSize: number; wave: number; actorId?: string | null },
): Promise<WaveResult> {
  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, bookingId)).limit(1);
  if (!booking) throw new Error(`booking ${bookingId} not found`);

  const { offerable, skipped } = await findCandidates(bookingId, opts.radiusKm, opts.waveSize);

  if (offerable.length === 0) {
    return {
      status: booking.status as Status, offers: [], ranked: [], skipped,
      exhausted: true, radiusKm: opts.radiusKm,
    };
  }

  const offers = await db.insert(S.dispatchOffers).values(
    offerable.map((m, i) => ({
      bookingId, mechanicId: m.id,
      // Rank is global across waves, so the audit trail shows the order the
      // ladder actually walked rather than restarting at 1 each time.
      rank: (opts.wave - 1) * opts.waveSize + i + 1,
      score: m.score, distanceKm: m.distanceKm, etaMinutes: m.etaMinutes,
      expiresAt: new Date(Date.now() + env.offerTtlSeconds * 1000), usedFallback: true,
    })),
  ).returning();

  // Push each offer to its provider's console the instant it exists. A 90-second
  // window spent waiting for the next poll is a tenth of the window wasted.
  const userIds = await db.select({ id: S.mechanics.id, userId: S.mechanics.userId })
    .from(S.mechanics).where(inArray(S.mechanics.id, offerable.map((m) => m.id)));

  for (const offer of offers) {
    const mech = userIds.find((m) => m.id === offer.mechanicId);
    const ranked = offerable.find((m) => m.id === offer.mechanicId);
    publish(mech?.userId, {
      type: "dispatch.offered", offerId: offer.id, bookingId,
      wave: opts.wave, rank: offer.rank,
      distanceKm: offer.distanceKm, etaMinutes: offer.etaMinutes,
      expiresAt: offer.expiresAt.toISOString(),
      expiresInSeconds: Math.max(0, Math.round((offer.expiresAt.getTime() - Date.now()) / 1000)),
      displayName: ranked?.displayName,
    });
    await audit({
      actorId: opts.actorId ?? null, actorRole: "system", action: "dispatch.provider_offered",
      entity: "dispatch_offer", entityId: offer.id,
      after: { bookingId, mechanicId: offer.mechanicId, wave: opts.wave, rank: offer.rank },
    });
  }

  publish(booking.userId, {
    type: "dispatch.wave", bookingId, wave: opts.wave, offers: offers.length,
  });

  return {
    status: booking.status as Status,
    offers: offers.map((o) => ({ ...o, mechanic: offerable.find((m) => m.id === o.mechanicId) })),
    ranked: offerable, skipped, exhausted: false, radiusKm: opts.radiusKm,
  };
}

/**
 * Move the ladder on after a refusal or a timeout.
 *
 * Only acts on a booking still in MATCHING with nothing live outstanding, which
 * makes it safe to call from the sweeper and from a decline at the same moment:
 * whichever arrives second finds either an assignment or a live offer and does
 * nothing.
 */
export async function escalate(
  bookingId: string,
  reason: "declined" | "expired",
): Promise<{ escalated: boolean; exhausted: boolean; offers: number }> {
  const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, bookingId)).limit(1);
  if (!booking || booking.status !== "MATCHING" || booking.mechanicId) {
    return { escalated: false, exhausted: false, offers: 0 };
  }

  const [{ live }] = await db.select({ live: raw<number>`count(*)::int` })
    .from(S.dispatchOffers)
    .where(and(
      eq(S.dispatchOffers.bookingId, bookingId),
      eq(S.dispatchOffers.status, "SENT"),
      raw`${S.dispatchOffers.expiresAt} > now()`,
    ));
  if (live > 0) return { escalated: false, exhausted: false, offers: live };

  // How many waves have already gone out, so ranking stays monotonic.
  const [{ sent }] = await db.select({ sent: raw<number>`count(*)::int` })
    .from(S.dispatchOffers).where(eq(S.dispatchOffers.bookingId, bookingId));
  const waveSize = env.dispatchWaveSize;
  const wave = Math.floor(sent / Math.max(1, waveSize)) + 1;

  const result = await sendWave(bookingId, {
    radiusKm: env.dispatchRadiusKm, waveSize, wave, actorId: null,
  });

  if (result.exhausted) {
    // Genuinely nobody left. Only now does the booking say so.
    const noSupply = apply("MATCHING", "offers.exhausted");
    const updated = await db.update(S.bookings)
      .set({ status: noSupply.to, updatedAt: new Date() })
      .where(and(eq(S.bookings.id, bookingId), eq(S.bookings.status, "MATCHING")))
      .returning({ id: S.bookings.id });
    if (updated.length) {
      await db.insert(S.bookingEvents).values({
        bookingId, fromStatus: "MATCHING", toStatus: noSupply.to,
        command: "offers.exhausted", actorRole: "system",
        meta: { reason, ladderExhausted: true },
      });
      publish(booking.userId, {
        type: "booking.status", bookingId, status: noSupply.to,
        reason: "every provider in range has been asked",
      });
      await audit({
        actorId: null, actorRole: "system", action: "dispatch.exhausted",
        entity: "booking", entityId: bookingId, after: { reason, offersSent: sent },
      });
    }
    return { escalated: false, exhausted: true, offers: 0 };
  }

  await audit({
    actorId: null, actorRole: "system", action: "dispatch.escalated",
    entity: "booking", entityId: bookingId,
    after: { reason, wave, offers: result.offers.length },
  });
  return { escalated: true, exhausted: false, offers: result.offers.length };
}

/**
 * The timeout mechanism.
 *
 * A `SENT` offer past `expires_at` is dead, but nothing had ever *said* so — it
 * simply stopped being listed. That left the row misrepresenting reality, the
 * mechanic's console counting down past zero, and the booking with no path
 * forward. This sweeper closes the offer, tells the mechanic, and moves the
 * ladder on.
 *
 * The `UPDATE … RETURNING` is the concurrency guard: whichever caller flips a
 * row from SENT gets it back, so two sweepers (or a sweeper racing an accept)
 * cannot both escalate for the same expiry.
 */
export async function sweepExpiredOffers(): Promise<{ expired: number; escalated: number }> {
  const expired = await db.update(S.dispatchOffers)
    .set({ status: "EXPIRED", updatedAt: new Date() })
    .where(and(
      eq(S.dispatchOffers.status, "SENT"),
      raw`${S.dispatchOffers.expiresAt} <= now()`,
    ))
    .returning({ id: S.dispatchOffers.id, bookingId: S.dispatchOffers.bookingId, mechanicId: S.dispatchOffers.mechanicId });

  if (expired.length === 0) return { expired: 0, escalated: 0 };

  const mechs = await db.select({ id: S.mechanics.id, userId: S.mechanics.userId })
    .from(S.mechanics).where(inArray(S.mechanics.id, expired.map((e) => e.mechanicId)));
  for (const e of expired) {
    publish(mechs.find((m) => m.id === e.mechanicId)?.userId, {
      type: "dispatch.expired", offerId: e.id, bookingId: e.bookingId,
    });
  }

  let escalated = 0;
  for (const bookingId of new Set(expired.map((e) => e.bookingId))) {
    const out = await escalate(bookingId, "expired");
    if (out.escalated) escalated++;
  }
  return { expired: expired.length, escalated };
}

/** Every provider's current state, for the operations view. */
export async function providerRoster(limitRows = 200) {
  const rows = await db.execute<{
    id: string; display_name: string; is_available: boolean;
    active_booking_status: string | null; live_offers: number;
  }>(raw`
    SELECT m.id, m.display_name, m.is_available,
           (SELECT ab.status::text FROM bookings ab
             WHERE ab.mechanic_id = m.id AND ab.deleted_at IS NULL
               AND ab.status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS','ESCALATED')
             ORDER BY ab.updated_at DESC LIMIT 1) AS active_booking_status,
           (SELECT count(*)::int FROM dispatch_offers o
             WHERE o.mechanic_id = m.id AND o.status = 'SENT' AND o.expires_at > now()) AS live_offers
      FROM mechanics m
     WHERE m.deleted_at IS NULL AND m.verified
     LIMIT ${limitRows}`);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const state = deriveProviderState({
      isAvailable: r.is_available,
      activeBookingStatus: r.active_booking_status,
      liveOffers: Number(r.live_offers ?? 0),
    });
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return { sampled: rows.length, byState: counts };
}

/** The provider state for one mechanic, for the customer's tracking screen. */
export async function providerStateFor(mechanicId: string): Promise<ProviderState | null> {
  const [row] = await db.execute<{
    is_available: boolean; active_booking_status: string | null; live_offers: number;
  }>(raw`
    SELECT m.is_available,
           (SELECT ab.status::text FROM bookings ab
             WHERE ab.mechanic_id = m.id AND ab.deleted_at IS NULL
               AND ab.status IN ('ASSIGNED','EN_ROUTE','ON_SITE','IN_PROGRESS','AWAITING_PARTS','ESCALATED')
             ORDER BY ab.updated_at DESC LIMIT 1) AS active_booking_status,
           (SELECT count(*)::int FROM dispatch_offers o
             WHERE o.mechanic_id = m.id AND o.status = 'SENT' AND o.expires_at > now()) AS live_offers
      FROM mechanics m
     WHERE m.id = ${mechanicId} AND m.deleted_at IS NULL`);
  if (!row) return null;
  return deriveProviderState({
    isAvailable: row.is_available,
    activeBookingStatus: row.active_booking_status,
    liveOffers: Number(row.live_offers ?? 0),
  });
}

/** Started at boot; stopped on shutdown. */
let sweeper: NodeJS.Timeout | null = null;

export function startOfferSweeper(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    sweepExpiredOffers()
      .then((r) => { if (r.expired) log.info({ ...r, op: "dispatch.sweep" }, "expired dispatch offers swept"); })
      .catch((err) => log.warn({ err: String(err), op: "dispatch.sweep" }, "offer sweep failed"));
  }, env.offerSweepSeconds * 1000);
  sweeper.unref?.();
}

export function stopOfferSweeper() {
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
}

/** Unused-import guard for a value only referenced inside SQL strings. */
export const _aliveGuard = isNull;
