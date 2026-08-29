import test from "node:test";
import assert from "node:assert";
import { planEffectWipe } from "../src/effects/dependentEffectsPlan.ts";

test("an effect with a live dependent is kept, not deleted", () => {
  const plan = planEffectWipe({
    existingEffects: [
      { _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" },
      { _id: "eff2", uuid: "Actor.aaa.ActiveEffect.eff2" },
    ],
    dependentOnUuids: new Set(["Actor.aaa.ActiveEffect.eff1"]),
  });
  assert.deepEqual(plan.keptIds, ["eff1"]);
  assert.deepEqual(plan.deleteIds, ["eff2"]);
});

test("no dependents at all: every effect is wiped, same as before this fix", () => {
  const plan = planEffectWipe({
    existingEffects: [
      { _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" },
      { _id: "eff2", uuid: "Actor.aaa.ActiveEffect.eff2" },
    ],
    dependentOnUuids: new Set(),
  });
  assert.deepEqual(plan.keptIds, []);
  assert.deepEqual(plan.deleteIds, ["eff1", "eff2"]);
});

test("no existing effects at all is a no-op either way", () => {
  const plan = planEffectWipe({ existingEffects: [], dependentOnUuids: new Set(["Actor.aaa.ActiveEffect.eff1"]) });
  assert.deepEqual(plan.keptIds, []);
  assert.deepEqual(plan.deleteIds, []);
});

test("accepts a plain array of uuids, not just a Set", () => {
  const plan = planEffectWipe({
    existingEffects: [{ _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" }],
    dependentOnUuids: ["Actor.aaa.ActiveEffect.eff1"],
  });
  assert.deepEqual(plan.keptIds, ["eff1"]);
  assert.deepEqual(plan.deleteIds, []);
});

test("idempotent: re-running against the post-wipe actor state changes nothing further", () => {
  const dependentOnUuids = new Set(["Actor.aaa.ActiveEffect.eff1"]);

  const firstPass = planEffectWipe({
    existingEffects: [
      { _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" },
      { _id: "eff2", uuid: "Actor.aaa.ActiveEffect.eff2" },
    ],
    dependentOnUuids,
  });
  assert.deepEqual(firstPass.keptIds, ["eff1"]);
  assert.deepEqual(firstPass.deleteIds, ["eff2"]);

  // Simulate the actor after the caller actually deletes firstPass.deleteIds:
  // only the kept effect survives, with the SAME _id/uuid (never touched).
  const secondPass = planEffectWipe({
    existingEffects: [{ _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" }],
    dependentOnUuids,
  });
  assert.deepEqual(secondPass.keptIds, ["eff1"]);
  assert.deepEqual(secondPass.deleteIds, []);
});

test("a dependentOn value that matches no existing effect is simply irrelevant", () => {
  const plan = planEffectWipe({
    existingEffects: [{ _id: "eff1", uuid: "Actor.aaa.ActiveEffect.eff1" }],
    dependentOnUuids: new Set(["Actor.bbb.ActiveEffect.someOtherActorsEffect"]),
  });
  assert.deepEqual(plan.keptIds, []);
  assert.deepEqual(plan.deleteIds, ["eff1"]);
});

// DDBCharacterImporter#resetActor (the error-rollback path) reuses this exact
// planner too (Task 10 §3.9 fold-in, review re-round): a mid-import failure
// while a beast is alive must not cascade-kill it via resetActor()'s own
// wipe any more than a normal re-import may. Nothing about the decision
// differs between the two call sites -- same shape in, same shape out -- so
// this is the same scenario as the very first test above, named for the
// second caller to make that shared coverage explicit rather than implicit.
test("the rollback path's own effect list gets the identical keep/delete split", () => {
  const rollbackEffects = [
    { _id: "marker1", uuid: "Actor.warpey.ActiveEffect.marker1" },
    { _id: "someOtherEffect", uuid: "Actor.warpey.ActiveEffect.someOtherEffect" },
  ];
  const plan = planEffectWipe({
    existingEffects: rollbackEffects,
    dependentOnUuids: new Set(["Actor.warpey.ActiveEffect.marker1"]),
  });
  assert.deepEqual(plan.keptIds, ["marker1"]);
  assert.deepEqual(plan.deleteIds, ["someOtherEffect"]);
});
