import test from "node:test";
import assert from "node:assert";
import { planCompanionReconciliation } from "../src/parser/spells/primalCompanionPlan.ts";

const FORMS = { land: "Actor.aaa", sea: "Actor.bbb", sky: "Actor.ccc" };

test("creates every missing form", () => {
  const plan = planCompanionReconciliation({ existingForms: { land: "Actor.aaa" }, profiles: [] });
  assert.deepEqual(plan.createForms, ["sea", "sky"]);
});

test("points profiles at the three world actors once they all exist", () => {
  const plan = planCompanionReconciliation({ existingForms: FORMS, profiles: [] });
  assert.deepEqual(plan.profileUpdate?.map((p) => p.uuid), ["Actor.aaa", "Actor.bbb", "Actor.ccc"]);
});

test("conformant profiles are a no-op (idempotency)", () => {
  const profiles = [
    { name: "", uuid: "Actor.aaa" }, { name: "", uuid: "Actor.bbb" }, { name: "", uuid: "Actor.ccc" },
  ];
  const plan = planCompanionReconciliation({ existingForms: FORMS, profiles });
  assert.equal(plan.profileUpdate, null);
  assert.deepEqual(plan.createForms, []);
});

test("no actors yet: nothing to point profiles at", () => {
  const plan = planCompanionReconciliation({ existingForms: {}, profiles: [] });
  assert.deepEqual(plan.createForms, ["land", "sea", "sky"]);
  assert.equal(plan.profileUpdate, null);
});

test("a stale profile (wrong uuid) is corrected, not left alone", () => {
  const profiles = [
    { name: "", uuid: "Actor.stale" }, { name: "", uuid: "Actor.bbb" }, { name: "", uuid: "Actor.ccc" },
  ];
  const plan = planCompanionReconciliation({ existingForms: FORMS, profiles });
  assert.deepEqual(plan.profileUpdate?.map((p) => p.uuid), ["Actor.aaa", "Actor.bbb", "Actor.ccc"]);
});
