import test from "node:test";
import assert from "node:assert";
import { buildPrimalCompanionActivities } from "../src/parser/enrichers/data/primalCompanionActivities.ts";

test("summon activity is longRest-activated with a permanent duration", () => {
  const { summon } = buildPrimalCompanionActivities();
  assert.equal(summon.type, "summon");
  assert.equal(summon.activation.type, "longRest");
  // the marker trap: midi copies this duration onto its Summon marker
  assert.notEqual(summon.duration?.units ?? "", "");
  assert.equal(summon.profiles.length, 0); // reconciliation owns the pointers
  assert.equal(summon.match.attacks, true);
  assert.equal(summon.bonuses.hp.includes("@classes.ranger.levels"), true);
});

test("restore is a slot-consuming heal with upcast room", () => {
  const { restore } = buildPrimalCompanionActivities();
  assert.equal(restore.type, "heal");
  assert.equal(restore.consumption.targets[0].type, "spellSlots");
  assert.equal(restore.consumption.scaling.allowed, true);
});

test("exactly two activities — no command, no dismiss, no per-type utilities", () => {
  assert.deepEqual(Object.keys(buildPrimalCompanionActivities()), ["summon", "restore"]);
});
