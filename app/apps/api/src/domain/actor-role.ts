/**
 * The role an action is recorded under, when the caller holds several.
 *
 * Audit entries and booking events used to take `roles[0]`, and the role list
 * comes back from the database in no particular order — an admin who also
 * holds the citizen role (every account does) was written down as "citizen",
 * so the hash-chained log said a member of the public did what an operator
 * did. The record names the most privileged role the caller acted with:
 * admin, then gov_officer, then mechanic, then citizen.
 */
const BY_PRIVILEGE = ["admin", "gov_officer", "mechanic", "citizen"] as const;

export function actorRole(roles: readonly string[] | null | undefined): string {
  const held = roles ?? [];
  return BY_PRIVILEGE.find((r) => held.includes(r)) ?? held[0] ?? "citizen";
}
