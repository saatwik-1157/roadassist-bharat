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
 * and they DO race: two mechanics declining at the same moment each ran it,
 * each found no live offer, and each sent a wave, so the same providers were
 * offered the same job twice. The booking's status alone was never a guard
 * (both callers read MATCHING). Every wave is now sent under the dispatch
 * route's advisory lock, (6, hashtext(booking id)), inside that lock's own
 * transaction: the second caller waits, then reads the first caller's
 * committed offers and does nothing.
 *
 * ── one connection per wave ───────────────────────────────────────────────
 * Every query of a wave runs on the transaction that holds the lock (`exec`
 * below), never on the shared pool. Holding a pooled connection for the lock
 * while queuing for a second one is a deadlock once the pool (10) is full of
 * lock holders: ten concurrent dispatches froze the whole API, /health too.
 * Pushes and audit entries go out after the commit (`announce`): the audit
 * chain must read a committed tip, and an event must describe committed state.
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
  /** The offer pushes and audit entries. Call it AFTER the wave's transaction commits. */
  announce: () => Promise<void>;
}

/** A transaction handle, or the pool itself — whatever the caller is writing through. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Bound a transaction that holds the dispatch lock.
 *
 * The backstop behind "one connection per wave": should a query ever again be
 * sent to the pool from inside such a transaction, its connection sits idle in
 * transaction while the pool is exhausted, and Postgres now ends that session
 * after 20 s instead of the API waiting forever. A runaway statement is cut at
 * 15 s. Both are LOCAL, so they end with the transaction and touch nothing else.
 */
export async function boundLockTx(tx: Executor): Promise<void> {
  await tx.execute(raw`SELECT set_config('statement_timeout', '15000', true),
                              set_config('idle_in_transaction_session_timeout', '20000', true)`);
}

/**
 * The radius and wave size the customer's last search used.
 *
 * Recorded on the booking's own history (the dispatch event's meta) when the
 * search starts, so the ladder keeps walking the search the customer asked for.
 * It used to fall back to the server defaults on every escalation: a customer
 * who widened to 50 km had their second wave searched at 25 km, and was told
 * "every provider in range has been asked" with a free mechanic at 40 km.
 */
export async function dispatchPlan(exec: Executor, bookingId: string): Promise<{ radiusKm: number; waveSize: number }> {
  const [row] = await exec.execute<{ radius_km: string | null; wave_size: string | null }>(raw`
    SELECT meta->>'radiusKm' AS radius_km, meta->>'waveSize' AS wave_size
      FROM booking_events
     WHERE booking_id = ${bookingId} AND command IN ('dispatch.start', 'retry.widen')
       AND meta ? 'radiusKm'
     ORDER BY created_at DESC LIMIT 1`);
  const radiusKm = Number(row?.radius_km);
  const waveSize = Number(row?.wave_size);
  return {
    radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : env.dispatchRadiusKm,
    waveSize: Number.isInteger(waveSize) && waveSize > 0 ? waveSize : env.dispatchWaveSize,
  };
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
  exec: Executor,
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
  const rows = await exec.execute<{
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
  const [counts] = await exec.execute<{ offline: number; busy: number }>(raw`
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
 * Send one wave of offers, through `exec` — the transaction that holds the
 * dispatch lock (see the header). Nothing here touches the pool.
 *
 * Returns `exhausted: true` when there is nobody left to ask — the caller
 * decides whether that means NO_SUPPLY (first wave) or the end of the ladder.
 * The pushes and audit entries are returned as `announce`, for the caller to
 * run once its transaction has committed.
 */
export async function sendWave(
  exec: Executor,
  bookingId: string,
  opts: { radiusKm: number; waveSize: number; wave: number; actorId?: string | null },
): Promise<WaveResult> {
  const [booking] = await exec.select().from(S.bookings).where(eq(S.bookings.id, bookingId)).limit(1);
  if (!booking) throw new Error(`booking ${bookingId} not found`);

  const { offerable, skipped } = await findCandidates(exec, bookingId, opts.radiusKm, opts.waveSize);

  if (offerable.length === 0) {
    return {
      status: booking.status as Status, offers: [], ranked: [], skipped,
      exhausted: true, radiusKm: opts.radiusKm, announce: async () => {},
    };
  }

  const offers = await exec.insert(S.dispatchOffers).values(
    offerable.map((m, i) => ({
      bookingId, mechanicId: m.id,
      // Rank is global across waves, so the audit trail shows the order the
      // ladder actually walked rather than restarting at 1 each time.
      rank: (opts.wave - 1) * opts.waveSize + i + 1,
      score: m.score, distanceKm: m.distanceKm, etaMinutes: m.etaMinutes,
      expiresAt: new Date(Date.now() + env.offerTtlSeconds * 1000), usedFallback: true,
    })),
  ).returning();

  const userIds = await exec.select({ id: S.mechanics.id, userId: S.mechanics.userId })
    .from(S.mechanics).where(inArray(S.mechanics.id, offerable.map((m) => m.id)));

  // Push each offer to its provider's console the moment it is committed. A
  // 90-second window spent waiting for the next poll is a tenth of the window
  // wasted - but an offer pushed before its commit is one Accept cannot find.
  const announce = async () => {
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
  };

  return {
    status: booking.status as Status,
    offers: offers.map((o) => ({ ...o, mechanic: offerable.find((m) => m.id === o.mechanicId) })),
    ranked: offerable, skipped, exhausted: false, radiusKm: opts.radiusKm, announce,
  };
}

/**
 * What an escalation did, named so a caller can tell the customer the truth:
 * a new wave went out, the ladder ran out, other offers are still live, or
 * the booking had already left MATCHING (accepted, cancelled, out of supply).
 */
export type EscalationOutcome = "escalated" | "exhausted" | "live_offers" | "not_matching";

/**
 * Move the ladder on after a refusal or a timeout.
 *
 * Only acts on a booking still in MATCHING with nothing live outstanding, and
 * only under the dispatch lock: two declines (or a decline and the sweeper)
 * arriving together used to both pass those checks and both send a wave. The
 * lock here WAITS rather than skipping, because a caller that skipped could be
 * the one whose decline closed the last live offer - the other caller may have
 * counted that offer as live and stood down, and the ladder would stall. A
 * waiting caller holds one connection and needs no other, so it cannot starve
 * the holder.
 *
 * The next wave searches the radius and wave size the customer's own search
 * used (dispatchPlan), not the server defaults.
 */
export async function escalate(
  bookingId: string,
  reason: "declined" | "expired" | "withdrawn",
): Promise<{ escalated: boolean; exhausted: boolean; offers: number; outcome: EscalationOutcome; radiusKm?: number }> {
  const after: Array<() => Promise<unknown>> = [];

  const result = await db.transaction(async (tx) => {
    await boundLockTx(tx);
    await tx.execute(raw`SELECT pg_advisory_xact_lock(6, hashtext(${bookingId}))`);

    const [booking] = await tx.select().from(S.bookings).where(eq(S.bookings.id, bookingId)).for("update");
    if (!booking || booking.status !== "MATCHING" || booking.mechanicId) {
      return { escalated: false, exhausted: false, offers: 0, outcome: "not_matching" as const };
    }

    const [{ live }] = await tx.select({ live: raw<number>`count(*)::int` })
      .from(S.dispatchOffers)
      .where(and(
        eq(S.dispatchOffers.bookingId, bookingId),
        eq(S.dispatchOffers.status, "SENT"),
        raw`${S.dispatchOffers.expiresAt} > now()`,
      ));
    if (live > 0) return { escalated: false, exhausted: false, offers: live, outcome: "live_offers" as const };

    // How many waves have already gone out, so ranking stays monotonic.
    const [{ sent }] = await tx.select({ sent: raw<number>`count(*)::int` })
      .from(S.dispatchOffers).where(eq(S.dispatchOffers.bookingId, bookingId));
    const { radiusKm, waveSize } = await dispatchPlan(tx, bookingId);
    const wave = Math.floor(sent / Math.max(1, waveSize)) + 1;

    const sentWave = await sendWave(tx, bookingId, { radiusKm, waveSize, wave, actorId: null });

    if (sentWave.exhausted) {
      // Genuinely nobody left within the customer's radius. Only now does the booking say so.
      const noSupply = apply("MATCHING", "offers.exhausted");
      await tx.update(S.bookings)
        .set({ status: noSupply.to, updatedAt: new Date() })
        .where(and(eq(S.bookings.id, bookingId), eq(S.bookings.status, "MATCHING")));
      await tx.insert(S.bookingEvents).values({
        bookingId, fromStatus: "MATCHING", toStatus: noSupply.to,
        command: "offers.exhausted", actorRole: "system",
        meta: { reason, ladderExhausted: true, radiusKm },
      });
      after.push(async () => {
        publish(booking.userId, {
          type: "booking.status", bookingId, status: noSupply.to,
          reason: `every provider within ${radiusKm} km has been asked`,
        });
        await audit({
          actorId: null, actorRole: "system", action: "dispatch.exhausted",
          entity: "booking", entityId: bookingId, after: { reason, offersSent: sent, radiusKm },
        });
      });
      return { escalated: false, exhausted: true, offers: 0, outcome: "exhausted" as const, radiusKm };
    }

    after.push(sentWave.announce, () => audit({
      actorId: null, actorRole: "system", action: "dispatch.escalated",
      entity: "booking", entityId: bookingId,
      after: { reason, wave, offers: sentWave.offers.length, radiusKm },
    }));
    return { escalated: true, exhausted: false, offers: sentWave.offers.length, outcome: "escalated" as const, radiusKm };
  });

  // Committed: now the mechanics, the customer and the audit chain hear of it.
  for (const step of after) await step();
  return result;
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

export interface WithdrawnOffer { id: string; mechanicId: string }

/**
 * Close every open offer for a booking that has just been cancelled.
 *
 * Cancelling a booking in MATCHING used to leave its SENT offers alone. The
 * mechanics who had been asked still saw the job in their inbox with a live
 * countdown, and Accept answered 409 — the state machine refuses to assign a
 * cancelled booking, correctly, but far too late to be useful: the offer was a
 * dead button, and the sweeper would later "expire" it as though nobody had
 * answered in time. WITHDRAWN is the status that says what happened, and the
 * accept path already uses it for the offers an acceptance makes redundant.
 *
 * Call it inside the same transaction as the cancel, so a cancel that rolls
 * back leaves its offers live and one that commits never leaves them open.
 * The `status = 'SENT'` guard makes it a compare-and-swap: an offer accepted,
 * declined or expired a moment earlier keeps the status it has.
 */
export async function withdrawOpenOffers(tx: Executor, bookingId: string): Promise<WithdrawnOffer[]> {
  return tx.update(S.dispatchOffers)
    .set({ status: "WITHDRAWN", respondedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(S.dispatchOffers.bookingId, bookingId), eq(S.dispatchOffers.status, "SENT")))
    .returning({ id: S.dispatchOffers.id, mechanicId: S.dispatchOffers.mechanicId });
}

/**
 * Tell each mechanic whose offer was withdrawn, AFTER the cancel has committed.
 *
 * The mechanic console refetches its inbox on `booking.status` (it ignores
 * other event types), so that is the event sent: the offer disappears from the
 * inbox the moment the customer cancels instead of at the next poll. The
 * payload names the withdrawn offer so a client that wants to can say why.
 */
export async function announceWithdrawnOffers(bookingId: string, withdrawn: readonly WithdrawnOffer[]): Promise<number> {
  if (withdrawn.length === 0) return 0;
  const mechs = await db.select({ id: S.mechanics.id, userId: S.mechanics.userId })
    .from(S.mechanics).where(inArray(S.mechanics.id, withdrawn.map((w) => w.mechanicId)));
  let delivered = 0;
  for (const w of withdrawn) {
    delivered += publish(mechs.find((m) => m.id === w.mechanicId)?.userId, {
      type: "booking.status", bookingId, status: "CANCELLED",
      offerId: w.id, offerStatus: "WITHDRAWN", reason: "the customer cancelled this booking",
    });
  }
  return delivered;
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
