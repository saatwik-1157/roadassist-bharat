/**
 * Money. Charging, settling, and the gateway's word for it.
 *
 * Lifted out of server.ts unchanged, and the group most worth reading on its
 * own: every rule that keeps a customer from being charged twice, or a booking
 * from being marked paid without money, is in this file.
 *
 * Three of them are worth finding before changing anything:
 *
 *   · The AMOUNT is the invoice total, read server-side. The client never
 *     sends it.
 *   · Settlement is RECORDED, never asserted — a unique index
 *     (payments_invoice_settled_uq) is what makes 'once' true under a race, not
 *     a check-then-write.
 *   · The webhook recomputes the signature server-side. A forged one settles
 *     nothing.
 *
 * `invoiceIsSettled` and `settleBooking` are exported because the booking
 * transition route still asks this module whether the money arrived.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql as raw } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";

import * as S from "@roadassist/db";
import { db } from "../db.js";
import { env } from "../env.js";
import { ok } from "../http.js";
import { audit } from "../audit.js";
import { limit } from "../ratelimit.js";
import { payments, PAYMENT_METHODS } from "../providers.js";
import { authenticate, constantTimeEquals } from "../auth.js";
import { bookingAudience, notYours } from "../booking-access.js";
import {
  allowedFrom, apply, type Status,
} from "../domain/booking-machine.js";

// ══ payments ═══════════════════════════════════════════════════════════════

/** Is every paise of this booking's invoice covered by settled payments? */
export async function invoiceIsSettled(bookingId: string): Promise<boolean> {
  const [invoice] = await db.select({ id: S.invoices.id, total: S.invoices.totalPaise })
    .from(S.invoices)
    .where(and(eq(S.invoices.bookingId, bookingId), isNull(S.invoices.deletedAt)))
    .limit(1);
  if (!invoice) return false;

  const [tally] = await db.select({ paid: raw<string>`coalesce(sum(${S.payments.amountPaise}), 0)` })
    .from(S.payments)
    .where(and(
      eq(S.payments.invoiceId, invoice.id),
      eq(S.payments.status, "SETTLED"),
      isNull(S.payments.deletedAt),
    ));
  return Number(tally?.paid ?? 0) >= invoice.total;
}

/** The index in migrate.ts that makes “one settlement per invoice” a database fact. */
const UQ_INVOICE_SETTLED = "payments_invoice_settled_uq";

/**
 * Did Postgres refuse this write because an invoice is already settled?
 *
 * payments_invoice_settled_uq (migrate.ts) is the last word on “once only”: the
 * handlers guard their own paths, the index guards every path. A caller that
 * trips it has not hit a bug, so it must not read as one — 23505 escaping as a
 * 500 would tell an operator the server broke when it actually did its job.
 */
function isInvoiceAlreadySettled(err: unknown): boolean {
  // Walk the cause chain. Drizzle wraps the driver's error in a
  // DrizzleQueryError whose own `code` is undefined — the 23505 sits on the
  // cause — so a check of the top-level object alone silently never matches,
  // and the refusal goes out as a 500 that looks like a server fault.
  type PgLike = { code?: string; constraint_name?: string; message?: string; cause?: unknown };
  for (let e = err as PgLike | undefined, depth = 0; e && depth < 5; depth++) {
    const named = e.constraint_name === UQ_INVOICE_SETTLED ||
      (e.message ?? "").includes(UQ_INVOICE_SETTLED);
    if (named && (e.code === "23505" || (e.message ?? "").includes("duplicate key value"))) {
      return true;
    }
    e = e.cause as PgLike | undefined;
  }
  return false;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The compare-and-set half of a settlement, inside a caller's transaction.
 *
 * Separated from [settleBooking] so a caller that must write something ELSE in
 * the same transaction — a payment row, above all — can claim the booking
 * first and have its own write rolled back when it loses. Duplicating these
 * ten lines at the call site is how the guard and the money drift apart.
 */
async function claimForSettlement(
  tx: Tx,
  booking: typeof S.bookings.$inferSelect,
  actor: { sub: string; roles: string[] },
): Promise<boolean> {
  const { to } = apply(booking.status as Status, "payment.settled");
  const updated = await tx.update(S.bookings)
    .set({ status: to, updatedAt: new Date(), version: booking.version + 1 })
    .where(and(eq(S.bookings.id, booking.id), eq(S.bookings.status, booking.status)))
    .returning({ id: S.bookings.id });
  if (!updated.length) return false;

  await tx.insert(S.bookingEvents).values({
    bookingId: booking.id, fromStatus: booking.status, toStatus: to,
    command: "payment.settled", actorId: actor.sub, actorRole: actor.roles[0] ?? "citizen",
  });
  return true;
}

/**
 * COMPLETED → PAID, once a payment row actually covers the invoice. Guarded on
 * the status the transition was computed from, exactly like the generic
 * transition, so two confirmations racing cannot both win.
 */
export async function settleBooking(
  booking: typeof S.bookings.$inferSelect,
  actor: { sub: string; roles: string[] },
): Promise<boolean> {
  return db.transaction((tx) => claimForSettlement(tx, booking, actor));
}

/**
 * Settle a completed booking's invoice.
 *
 * The amount is never read from the request — it is the invoice total, so a
 * client cannot choose what it owes. Cash is recorded rather than charged, and
 * only by whoever is actually holding the money (the assigned mechanic, or an
 * admin): "the customer paid cash" is not the customer's claim to make.
 *
 * A provider that settles synchronously (the local mock, and cash) advances the
 * booking to PAID in the same call, so a client needs nothing further. A real
 * gateway returns a checkout handle instead and the booking stays COMPLETED
 * until POST /v1/payments/:id/confirm verifies what the gateway hands back.
 */

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/v1/bookings/:id/pay", { preHandler: [authenticate, limit("payment")] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { method = "upi" } = z.object({
      method: z.enum(PAYMENT_METHODS).optional(),
    }).parse(req.body ?? {});

    const [booking] = await db.select().from(S.bookings).where(eq(S.bookings.id, id)).limit(1);
    if (!booking) return reply.code(404).send({ error: { code: "not_found", title: "Booking not found", retryable: false } });

    const caller = req.user!;
    const audience = await bookingAudience(booking, caller);
    if (!audience.allowed) return reply.code(403).send({ error: notYours });

    if (method === "cash" && !audience.isAssignedMechanic && !caller.roles.includes("admin")) {
      return reply.code(403).send({
        error: {
          code: "forbidden",
          title: "Only the assigned mechanic can record a cash payment",
          retryable: false,
        },
      });
    }

    // Already settled: say so rather than charging a second time.
    if (booking.status === "PAID") {
      return ok({ id, status: "PAID", alreadySettled: true }, { nextCommands: allowedFrom("PAID") });
    }
    if (booking.status !== "COMPLETED") {
      return reply.code(409).send({
        error: {
          code: "not_payable",
          title: `A booking in ${booking.status} has nothing to pay yet — a job is invoiced when it completes.`,
          retryable: false,
        },
      });
    }

    const [invoice] = await db.select().from(S.invoices)
      .where(and(eq(S.invoices.bookingId, id), isNull(S.invoices.deletedAt))).limit(1);
    if (!invoice) {
      return reply.code(409).send({
        error: { code: "no_invoice", title: "This booking has no invoice to settle", retryable: false },
      });
    }

    // Cash never reaches a gateway — the money changed hands at the roadside and
    // only the record of it reaches us.
    const order = method === "cash"
      ? { providerRef: `cash_${invoice.number}`, settled: true, checkout: undefined }
      : await payments.createOrder({ amountPaise: invoice.totalPaise, receipt: invoice.number, method });

    // Nothing has settled yet: record the intent and let
    // POST /v1/payments/:id/confirm finish it against the gateway's own word.
    if (!order.settled) {
      const [pending] = await db.insert(S.payments).values({
        invoiceId: invoice.id,
        method,
        amountPaise: invoice.totalPaise,
        status: "PENDING",
        providerRef: order.providerRef,
        settledAt: null,
      }).returning();

      return reply.code(202).send(ok(
        { id, status: booking.status, payment: pending, checkout: order.checkout },
        { nextCommands: [], confirmWith: `POST /v1/payments/${pending.id}/confirm` },
      ));
    }

    /**
     * Settled synchronously. Claim the booking BEFORE writing the money, in one
     * transaction, so that losing the race writes nothing at all.
     *
     * The claim was already correct; its POSITION was not. The payment row used
     * to be inserted first and the booking claimed after, so two concurrent
     * settlements of one COMPLETED booking both inserted a SETTLED payment and
     * only then did one of them lose. That left two settled rows against a
     * single invoice — a ledger reading twice the invoice total — and handed the
     * loser a 409 saying "reload and retry", which would have added a third.
     * Nothing downstream noticed, because invoiceIsSettled asks whether the
     * settled sum COVERS the total, and twice the money covers it fine.
     */
    let settled;
    try {
      settled = await db.transaction(async (tx) => {
        if (!(await claimForSettlement(tx, booking, caller))) return null;

        const [row] = await tx.insert(S.payments).values({
          invoiceId: invoice.id,
          method,
          amountPaise: invoice.totalPaise,
          status: "SETTLED",
          providerRef: order.providerRef,
          settledAt: new Date(),
        }).returning();
        return row;
      });
    } catch (err) {
      if (!isInvoiceAlreadySettled(err)) throw err;
      // The claim above and the index disagree, which means the invoice was
      // settled through the OTHER door while this request was in flight: a
      // gateway confirmation landing between this booking's read and its write.
      // The transaction has already rolled the claim back, so the booking is
      // untouched and this is a plain refusal.
      return reply.code(409).send({
        error: {
          code: "invoice_already_settled",
          title: "Another payment already settled this invoice, so this one was not recorded. If the gateway captured it, it needs refunding.",
          retryable: false,
        },
      });
    }

    if (!settled) {
      return reply.code(409).send({
        error: {
          code: "conflict",
          title: "The booking changed while this request was in flight. Reload and retry.",
          retryable: true,
        },
      });
    }
    return ok({ id, status: "PAID", payment: settled, invoice }, { nextCommands: allowedFrom("PAID") });
  });

  /**
   * Verify a gateway's completion payload, then settle.
   *
   * The signature is what proves the *gateway* said the money arrived. Without
   * it a client could confirm its own payment, which is the same hole the raw
   * "payment.settled" command used to leave open.
   */
  app.post("/v1/payments/:id/confirm", { preHandler: [authenticate, limit("payment")] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      paymentRef: z.string().min(1).max(80).optional(),
      signature: z.string().min(1).max(256).optional(),
    }).parse(req.body ?? {});

    const [payment] = await db.select().from(S.payments).where(eq(S.payments.id, id)).limit(1);
    if (!payment) return reply.code(404).send({ error: { code: "not_found", title: "Payment not found", retryable: false } });

    const [invoice] = await db.select().from(S.invoices).where(eq(S.invoices.id, payment.invoiceId)).limit(1);
    const [booking] = invoice
      ? await db.select().from(S.bookings).where(eq(S.bookings.id, invoice.bookingId)).limit(1)
      : [];
    if (!invoice || !booking) {
      return reply.code(409).send({
        error: { code: "orphaned_payment", title: "This payment has no booking", retryable: false },
      });
    }

    const caller = req.user!;
    if (!(await bookingAudience(booking, caller)).allowed) return reply.code(403).send({ error: notYours });

    if (payment.status === "SETTLED") {
      return ok({ id, bookingId: booking.id, status: booking.status, alreadySettled: true },
                { nextCommands: allowedFrom(booking.status as Status) });
    }

    const genuine = await payments.verify({
      providerRef: payment.providerRef ?? "",
      paymentRef: body.paymentRef,
      signature: body.signature,
    });
    if (!genuine) {
      // The row stays PENDING on purpose: an unverified attempt is not a failed
      // payment, and the customer may still finish checkout.
      return reply.code(402).send({
        error: {
          code: "payment_unverified",
          title: "That confirmation could not be verified against the gateway, so nothing was settled.",
          retryable: false,
        },
      });
    }

    // provider_ref keeps the *order* reference: it is what the signature is
    // computed over, so overwriting it with the payment reference would make the
    // settlement impossible to re-verify during reconciliation.
    try {
      await db.update(S.payments)
        .set({ status: "SETTLED", settledAt: new Date(), updatedAt: new Date(), version: payment.version + 1 })
        .where(and(eq(S.payments.id, id), eq(S.payments.status, "PENDING")));
    } catch (err) {
      if (!isInvoiceAlreadySettled(err)) throw err;
      // Another payment settled this invoice first. This row stays PENDING on
      // purpose: it is the record that a second settlement was attempted, which
      // is exactly what reconciliation needs to find. Saying “already settled”
      // and nothing else would be the dangerous answer — the gateway may really
      // have taken this caller's money, and that is a refund, not a no-op.
      return reply.code(409).send({
        error: {
          code: "invoice_already_settled",
          title: "Another payment already settled this invoice, so this one was not recorded. If the gateway captured it, it needs refunding.",
          retryable: false,
        },
      });
    }

    if (booking.status === "COMPLETED" && !(await settleBooking(booking, caller))) {
      return reply.code(409).send({
        error: {
          code: "conflict",
          title: "The booking changed while this request was in flight. Reload and retry.",
          retryable: true,
        },
      });
    }
    const status = booking.status === "COMPLETED" ? "PAID" : booking.status;
    return ok({ id, bookingId: booking.id, status, invoice }, { nextCommands: allowedFrom(status as Status) });
  });

  /**
   * Razorpay webhook — the settlement path that does not depend on the payer.
   *
   * `POST /v1/payments/:id/confirm` is driven by the browser after checkout, and
   * a browser is not a reliable narrator: the customer can pay and immediately
   * close the tab, drop off the network, or have the page killed. The money has
   * still moved. Razorpay retries this webhook until it gets a 2xx, so this is
   * what actually guarantees the invoice closes.
   *
   * The signature IS the authentication — there is no bearer token, because
   * Razorpay has none to send. It is HMAC-SHA256 of the *raw* body keyed with the
   * webhook secret (a different secret from the API key), which is why the JSON
   * parser keeps rawBody around. Without a configured secret the endpoint refuses
   * outright rather than accepting unsigned settlements: an open money endpoint is
   * worse than no endpoint.
   *
   * Delivery is at-least-once, so every path here is idempotent.
   */
  app.post("/v1/webhooks/razorpay", async (req, reply) => {
    if (!env.payments.webhookSecret) {
      return reply.code(503).send({
        error: {
          code: "webhook_not_configured",
          title: "PAYMENTS_WEBHOOK_SECRET is not set, so webhook settlements are refused.",
          retryable: false,
        },
      });
    }

    const presented = String(req.headers["x-razorpay-signature"] ?? "");
    const expected = createHmac("sha256", env.payments.webhookSecret)
      .update((req as { rawBody?: string }).rawBody ?? "")
      .digest("hex");
    if (!presented || !constantTimeEquals(presented, expected)) {
      return reply.code(401).send({
        error: { code: "webhook_unsigned", title: "Missing or invalid webhook signature", retryable: false },
      });
    }

    const body = z.object({
      event: z.string().max(60),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: z.string().max(80),
            order_id: z.string().max(80).nullish(),
            amount: z.number().int().nonnegative().optional(),
          }).passthrough(),
        }).optional(),
      }).passthrough(),
    }).parse(req.body);

    // Only a captured payment settles anything. Authorized-but-uncaptured money
    // is not ours yet, and failures must never close an invoice.
    if (body.event !== "payment.captured") {
      return ok({ ignored: true, event: body.event },
        { note: "Only payment.captured settles an invoice." });
    }

    const entity = body.payload.payment?.entity;
    const orderId = entity?.order_id ?? "";
    if (!entity || !orderId) {
      return ok({ ignored: true }, { note: "No order id on the payment entity." });
    }

    // provider_ref holds the *order* id — the same value createOrder stored.
    const [payment] = await db.select().from(S.payments)
      .where(eq(S.payments.providerRef, orderId)).limit(1);
    if (!payment) {
      // A 200 stops Razorpay retrying forever for an order this system never made.
      return ok({ ignored: true, orderId }, { note: "No local payment for that order." });
    }

    // The gateway's amount must match what we invoiced. A mismatch means the
    // order was tampered with or is not ours, and it must not settle.
    if (entity.amount != null && entity.amount !== payment.amountPaise) {
      req.log.error({ orderId, expected: payment.amountPaise, got: entity.amount },
        "razorpay webhook amount mismatch");
      return reply.code(409).send({
        error: { code: "amount_mismatch", title: "Captured amount does not match the invoice", retryable: false },
      });
    }

    if (payment.status !== "SETTLED") {
      await db.update(S.payments)
        .set({ status: "SETTLED", settledAt: new Date(), updatedAt: new Date(),
               version: payment.version + 1 })
        .where(and(eq(S.payments.id, payment.id), eq(S.payments.status, "PENDING")));
    }

    const [invoice] = await db.select().from(S.invoices)
      .where(eq(S.invoices.id, payment.invoiceId)).limit(1);
    const [booking] = invoice
      ? await db.select().from(S.bookings).where(eq(S.bookings.id, invoice.bookingId)).limit(1)
      : [];

    let settled = false;
    if (booking && booking.status === "COMPLETED") {
      // The webhook has no signed-in user, so the actor is the system.
      settled = await settleBooking(booking, { sub: booking.userId, roles: ["system"] });
    }

    await audit({
      actorId: null, actorRole: "system", action: "payment.webhook.captured",
      entity: "payment", entityId: payment.id,
      after: { orderId, paymentRef: entity.id, bookingSettled: settled },
      ip: req.ip,
    });

    return ok({ orderId, paymentId: payment.id, bookingSettled: settled },
      { note: settled ? "Booking moved to PAID." : "Payment recorded; booking was not awaiting payment." });
  });
}
