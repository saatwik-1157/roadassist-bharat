/**
 * How many days a vehicle document has left, counted in India's calendar.
 *
 * An expiry date is a calendar day ("valid till 7 October"), and the person
 * reading the countdown is in IST. The count used to be milliseconds-until-
 * UTC-midnight, rounded up, which is a different calendar for the first five
 * and a half hours of every Indian day: at 02:00 IST on 8 October a policy
 * that ran out on the 7th still read "0 days left" instead of expired, and at
 * 03:00 on the 7th itself it read "1 day left" on its last day.
 *
 * Both instants are mapped to their IST calendar day and subtracted, so the
 * answer changes exactly at IST midnight. A stored expiry of UTC midnight (how
 * a bare "2026-10-07" is parsed) and of IST midnight both land on the 7th.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Days since the epoch, on the IST calendar. */
const istDay = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);

/** 0 on the last valid day, negative once it has passed. */
export function daysToExpiry(expiresOn: Date, now: Date = new Date()): number {
  return istDay(expiresOn) - istDay(now);
}

export function expiryState(days: number | null): "unknown" | "expired" | "expiring" | "valid" {
  return days === null ? "unknown" : days < 0 ? "expired" : days <= 30 ? "expiring" : "valid";
}
