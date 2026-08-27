import test from "node:test";
import assert from "node:assert";

import { buildGrantedSpellCastActivities } from "../src/parser/enrichers/data/grantedSpellActivities.ts";

const CAST = "cast";

const cantrip = (name: string) => ({ definition: { name, level: 0 }, limitedUse: null });
const levelled = (name: string) => ({ definition: { name, level: 1 }, limitedUse: { maxUses: 1 } });

test("gives every granted spell its own Cast activity, named for the spell", () => {
  const acts = buildGrantedSpellCastActivities([cantrip("Guidance"), levelled("Healing Word")], { castType: CAST });

  assert.deepEqual(acts.map((a) => a.init.name), ["Guidance", "Healing Word"]);
  assert.ok(acts.every((a) => a.init.type === CAST));
  assert.deepEqual(acts.map((a) => a.overrides.addSpellUuid), ["Guidance", "Healing Word"]);
});

test("puts every granted spell in the spellbook", () => {
  // Without this the cached copy never appears on the sheet and the grant is invisible.
  const acts = buildGrantedSpellCastActivities([cantrip("Guidance")], { castType: CAST });

  assert.equal(acts[0].overrides.data.spell.spellbook, true);
});

test("leaves a cantrip free to cast at will", () => {
  const [act] = buildGrantedSpellCastActivities([cantrip("Guidance")], { castType: CAST });

  assert.equal(act.build.generateConsumption, false);
  assert.equal(act.overrides.noConsumeTargets, true);
  assert.equal(act.overrides.addItemConsume, undefined);
});

test("spends only the granting feature's use for a levelled spell", () => {
  const [act] = buildGrantedSpellCastActivities([levelled("Healing Word")], { castType: CAST });

  assert.equal(act.overrides.addItemConsume, true);
  assert.equal(act.overrides.itemConsumeValue, "1");
  assert.equal(act.overrides.noConsumeTargets, undefined);
});

test("never adds a spell-slot consumption target to a free cast", () => {
  // addSpellSlotConsume PUSHES a spellSlots target, and dnd5e spends every target
  // on the activity, so the free cast would cost a use AND a slot. The Cast
  // activity's own consumption.spellSlot flag already covers slot casting, which
  // is how the long-standing Favored Enemy activity is shaped.
  const [act] = buildGrantedSpellCastActivities([levelled("Healing Word")], { castType: CAST });

  assert.equal(act.overrides.addSpellSlotConsume, undefined);
});

test("returns nothing for a feature that granted no spells", () => {
  assert.deepEqual(buildGrantedSpellCastActivities([], { castType: CAST }), []);
});

test("builds one activity per spell even when DDB exports the grant twice", () => {
  // 2024 lineage spells arrive as a pair: the free-use entry and the slot-castable
  // twin. Both describe one spell, so two activities would put it on the sheet twice.
  const acts = buildGrantedSpellCastActivities(
    [cantrip("Dancing Lights"), levelled("Faerie Fire"), { definition: { name: "Faerie Fire", level: 1 }, limitedUse: null }],
    { castType: CAST },
  );

  assert.deepEqual(acts.map((a) => a.init.name), ["Dancing Lights", "Faerie Fire"]);
});

test("keeps the limited-use entry of a duplicated pair, whichever order it arrives in", () => {
  // The free-use entry is the one carrying the pool; dropping it for the twin
  // would leave the spell castable only with a slot.
  const twin = { definition: { name: "Faerie Fire", level: 1 }, limitedUse: null };
  const acts = buildGrantedSpellCastActivities([twin, levelled("Faerie Fire")], { castType: CAST });

  assert.equal(acts.length, 1);
  assert.equal(acts[0].overrides.addItemConsume, true);
});
