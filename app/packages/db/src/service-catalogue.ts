/**
 * The service catalogue: what a customer can ask for, and what it costs.
 *
 * Lives in its own file because two seeders write it. `seed.ts` inserts it into
 * an empty database; `seed-demo-fleet.ts` inserts it only where it is missing,
 * inside a container that cannot import faker. Two copies of these fares would
 * drift the first time somebody changed one of them, and a booking's quote is
 * read straight from `base_fare_paise`.
 *
 *   [code, label, baseFarePaise, perKmPaise, etaMinutes]
 */
export const SERVICE_TYPES = [
  ["flat_tyre", "Flat tyre / puncture", 39900, 1200, 25],
  ["battery_jumpstart", "Battery jump start", 34900, 1200, 20],
  ["fuel_delivery", "Emergency fuel delivery", 29900, 1500, 30],
  ["key_lockout", "Key lockout assistance", 49900, 1200, 35],
  ["minor_repair", "On-spot minor repair", 59900, 1500, 40],
  ["towing", "Towing to nearest garage", 99900, 4500, 45],
  ["ev_charge", "EV mobile charging", 79900, 2000, 40],
  ["accident_support", "Accident support", 0, 0, 15],
] as const;
