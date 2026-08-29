import test from "node:test";
import assert from "node:assert";

import { forwardActivityId, planDualPoolShape } from "../src/parser/spells/dualPoolShape.ts";

const STAMP = { uses: "2", feature: "Favored Enemy" };

const slotAct = { id: "dnd5eactivity000", type: "utility", name: "Hunter's Mark", spellSlot: true, automationOnly: false, activationType: "bonus" };
const moveAct = { id: "CtwTg5RbWUSlWeM2", type: "utility", name: "Hunter's Mark: Move", spellSlot: false, automationOnly: false };
const FWD_ID = forwardActivityId("hunters-mark");

const bareSpell = (over = {}) => ({
  identifier: "hunters-mark",
  name: "Hunter's Mark",
  usesMax: "",
  usesSpent: 0,
  usesRecoveryPeriods: [],
  activities: [slotAct, moveAct],
  extraActivityIds: ["CtwTg5RbWUSlWeM2"],
  scaleFormula: "@scale.ranger.favored-enemy",
  ...over,
});

test("a freshly swapped spell gets pool, forward and picker hides in one plan", () => {
  const plan = planDualPoolShape(STAMP, bareSpell(), null);

  assert.ok(plan.spellUpdate, "expected a spell update");
  assert.deepEqual(plan.spellUpdate["system.uses"], {
    spent: 0, max: "@scale.ranger.favored-enemy",
    recovery: [{ period: "lr", type: "recoverAll" }],
  });
  const fwd = plan.spellUpdate[`system.activities.${FWD_ID}`];
  assert.equal(fwd.type, "forward");
  assert.equal(fwd.activity.id, "dnd5eactivity000");
  assert.equal(fwd.midiProperties.automationOnly, true);
  assert.equal(fwd.activation.type, "bonus"); // mirrors the slot activity
  assert.deepEqual(fwd.consumption.targets, [{ type: "itemUses", target: "", value: "1", scaling: {} }]);
  assert.equal(plan.spellUpdate["system.activities.CtwTg5RbWUSlWeM2.midiProperties.automationOnly"], true);
});

test("falls back to the literal DDB number when no class scale resolves", () => {
  const plan = planDualPoolShape(STAMP, bareSpell({ scaleFormula: null }), null);

  assert.equal(plan.spellUpdate["system.uses"].max, "2");
});

test("the approved live shape is a complete no-op", () => {
  // Idempotency is the whole point: the pass re-runs on every import and every
  // activity update; a conformant actor must never churn.
  const conformant = bareSpell({
    usesMax: "@scale.ranger.favored-enemy",
    usesRecoveryPeriods: ["lr"],
    activities: [
      slotAct,
      { ...moveAct, automationOnly: true },
      { id: FWD_ID, type: "forward", name: "Hunter's Mark (free casting)", spellSlot: true, automationOnly: true },
    ],
  });
  const feature = { usesMax: "", grantCastActivityIds: [] };

  assert.deepEqual(planDualPoolShape(STAMP, conformant, feature), { spellUpdate: null, featureUpdate: null });
});

test("preserves spent uses when re-shaping the pool", () => {
  // A re-import mid-adventuring-day must not silently refill the free casts.
  const plan = planDualPoolShape(STAMP, bareSpell({ usesSpent: 1 }), null);

  assert.equal(plan.spellUpdate["system.uses"].spent, 1);
});

test("a hand-built forward is adopted, not duplicated — only its picker flag is fixed", () => {
  const hand = bareSpell({
    usesMax: "@scale.ranger.favored-enemy",
    usesRecoveryPeriods: ["lr"],
    activities: [slotAct, { ...moveAct, automationOnly: true },
      { id: "HMfreecastStep00", type: "forward", name: "x", spellSlot: true, automationOnly: false }],
  });
  const plan = planDualPoolShape(STAMP, hand, null);

  assert.deepEqual(Object.keys(plan.spellUpdate), ["system.activities.HMfreecastStep00.midiProperties.automationOnly"]);
});

test("strips the granting feature: cast activities gone, pool cleared", () => {
  const feature = { usesMax: "2", grantCastActivityIds: ["ylNjbzBDWxqOgjJG"] };
  const plan = planDualPoolShape(STAMP, bareSpell(), feature);

  assert.deepEqual(plan.featureUpdate, {
    "system.activities.-=ylNjbzBDWxqOgjJG": null,
    "system.uses": { spent: 0, max: "", recovery: [] },
  });
});

test("an already-inert feature is left alone", () => {
  const plan = planDualPoolShape(STAMP, bareSpell(), { usesMax: "", grantCastActivityIds: [] });

  assert.equal(plan.featureUpdate, null);
});

test("no slot activity means no forward is invented", () => {
  const plan = planDualPoolShape(STAMP, bareSpell({ activities: [{ ...moveAct }] , extraActivityIds: []}), null);

  assert.ok(!Object.keys(plan.spellUpdate ?? {}).some((k) => k.includes("activities.fwd")));
});

test("forward ids are deterministic and well-formed", () => {
  assert.equal(forwardActivityId("hunters-mark"), forwardActivityId("hunters-mark"));
  assert.match(forwardActivityId("hunters-mark"), /^[a-zA-Z0-9]{16}$/);
  assert.match(forwardActivityId("x"), /^[a-zA-Z0-9]{16}$/);
  assert.notEqual(forwardActivityId("hunters-mark"), forwardActivityId("longstrider"));
});
