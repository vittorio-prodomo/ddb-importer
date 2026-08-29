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
