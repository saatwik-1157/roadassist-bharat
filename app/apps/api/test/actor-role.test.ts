/**
 * The role an action is recorded under (domain/actor-role.ts).
 *
 * Audit entries and booking events took `roles[0]`, and the role list comes
 * back in no particular order, so an admin who also holds the citizen role was
 * written into the hash-chained log as "citizen".
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { actorRole } from "../src/domain/actor-role.js";

test("the most privileged role is recorded, whatever order the roles arrive in", () => {
  assert.equal(actorRole(["citizen", "admin"]), "admin");
  assert.equal(actorRole(["citizen", "gov_officer"]), "gov_officer");
  assert.equal(actorRole(["citizen", "mechanic"]), "mechanic");
  assert.equal(actorRole(["mechanic", "gov_officer", "citizen"]), "gov_officer");
  assert.equal(actorRole(["gov_officer", "admin"]), "admin");
});

test("a plain citizen, an empty list and an unknown role still record something", () => {
  assert.equal(actorRole(["citizen"]), "citizen");
  assert.equal(actorRole([]), "citizen");
  assert.equal(actorRole(undefined), "citizen");
  assert.equal(actorRole(["device"]), "device");
});
