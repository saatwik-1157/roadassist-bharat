import { randomUUID } from "node:crypto";

/**
 * A booking reference a person can read out over a bad phone line.
 *
 * Eight characters of a UUID, uppercased. It lives here rather than in
 * server.ts because two routes mint one — POST /v1/bookings and the SMS BOOK
 * command — and a second copy of this is a second reference format.
 */
export const reference = () =>
  "RA" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
