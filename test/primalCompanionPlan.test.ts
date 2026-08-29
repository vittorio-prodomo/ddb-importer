import test from "node:test";
import assert from "node:assert";
import { decideReconcileRoute, planCompanionReconciliation } from "../src/parser/spells/primalCompanionPlan.ts";

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

// Fix round 1 (review finding, Critical): the routing decision that replaced
// a bare "if (!activeGM.isSelf) return;" drop-gate.
test("routes locally when this client IS the active GM", () => {
  assert.equal(decideReconcileRoute({ activeGMIsSelf: true, hasActiveGM: true }), "local");
});

test("routes through the active GM's query when a DIFFERENT GM is active", () => {
  assert.equal(decideReconcileRoute({ activeGMIsSelf: false, hasActiveGM: true }), "query");
});

test("has nowhere to route when no GM is connected at all", () => {
  assert.equal(decideReconcileRoute({ activeGMIsSelf: false, hasActiveGM: false }), "no-gm");
});

// activeGMIsSelf implies hasActiveGM in practice, but the function must not
// depend on that -- "local" wins regardless of what hasActiveGM says.
test("activeGMIsSelf takes priority even if hasActiveGM is inconsistently false", () => {
  assert.equal(decideReconcileRoute({ activeGMIsSelf: true, hasActiveGM: false }), "local");
});

// Fix round 2 (review finding): a linked prototype token makes dnd5e's
// native summon clone a NEW permanent world actor per use instead of
// placing an unlinked token+delta. actorLinkFixes is the mechanical-field
// self-heal for a hand-edit or stale actor -- never touches identity.
test("a flagged actor with actorLink still true gets a fix op for exactly that field", () => {
  const conformantProfiles = [
    { name: "", uuid: "Actor.aaa" }, { name: "", uuid: "Actor.bbb" }, { name: "", uuid: "Actor.ccc" },
  ];
  const plan = planCompanionReconciliation({
    existingForms: FORMS,
    profiles: conformantProfiles,
    actorLinkStatus: { land: true, sea: false, sky: false },
  });
  assert.deepEqual(plan.actorLinkFixes, [{ form: "land", uuid: "Actor.aaa" }]);
});

test("actorLink already false on every existing actor is a no-op", () => {
  const conformantProfiles = [
    { name: "", uuid: "Actor.aaa" }, { name: "", uuid: "Actor.bbb" }, { name: "", uuid: "Actor.ccc" },
  ];
  const plan = planCompanionReconciliation({
    existingForms: FORMS,
    profiles: conformantProfiles,
    actorLinkStatus: { land: false, sea: false, sky: false },
  });
  assert.deepEqual(plan.actorLinkFixes, []);
});

test("actorLinkStatus omitted entirely defaults every existing actor to conformant", () => {
  const plan = planCompanionReconciliation({ existingForms: FORMS, profiles: [] });
  assert.deepEqual(plan.actorLinkFixes, []);
});

test("a form that doesn't exist yet is never proposed as an actorLink fix", () => {
  const plan = planCompanionReconciliation({
    existingForms: { land: "Actor.aaa" },
    profiles: [],
    actorLinkStatus: { land: true },
  });
  // land exists and is flagged true -> gets fixed; sea/sky don't exist -> never proposed
  assert.deepEqual(plan.actorLinkFixes, [{ form: "land", uuid: "Actor.aaa" }]);
});
