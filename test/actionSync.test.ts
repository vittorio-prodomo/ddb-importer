import test from "node:test";
import assert from "node:assert";

import { diffActionUses, diffSpellUses, grantingFeature } from "../src/updater/actionSync.ts";

// Identity shapes verified live 2026-08-24 on two characters:
//   Foundry item : flags.ddbimporter.id = 10292282, entityTypeId = 12168134  (class FEATURE)
//   DDB action   : id = 9414047, entityTypeId = 222216831,
//                  componentId = 10292282, componentTypeId = 12168134
// The bridge is componentId/componentTypeId. The write must carry the ACTION's id.
const FEATURE = { ddbId: 10292282, entityTypeId: 12168134, name: "Lay On Hands", used: 3 };
const ACTION = {
  id: 9414047, entityTypeId: 222216831,
  componentId: 10292282, componentTypeId: 12168134,
  name: "Lay On Hands: Healing Pool", numberUsed: 0,
};

test("matches a Foundry feature to its DDB action through componentId", () => {
  const calls = diffActionUses([FEATURE], [ACTION]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionId, 9414047, "must send the ACTION id, not the feature id");
  assert.equal(calls[0].entityTypeId, 222216831, "must send the ACTION entityTypeId");
  assert.equal(calls[0].uses, 3);
});

test("sends nothing when Foundry and D&D Beyond already agree", () => {
  assert.deepEqual(diffActionUses([{ ...FEATURE, used: 0 }], [ACTION]), []);
});

test("ignores a feature that has no matching DDB action", () => {
  const orphan = { ...FEATURE, ddbId: 999999 };

  assert.deepEqual(diffActionUses([orphan], [ACTION]), []);
});

test("does not match on componentId alone when the component TYPE differs", () => {
  // A feature id could collide with an unrelated component of another type.
  const otherType = { ...ACTION, componentTypeId: 88888888 };

  assert.deepEqual(diffActionUses([FEATURE], [otherType]), []);
});

test("ignores a feature carrying no D&D Beyond identity", () => {
  const homebrew = { ddbId: null as never, entityTypeId: null as never, name: "Homebrew", used: 2 };

  assert.deepEqual(diffActionUses([homebrew], [ACTION]), []);
});

test("reports uses as CONSUMED, matching the field D&D Beyond stores", () => {
  const calls = diffActionUses([{ ...FEATURE, used: 7 }], [{ ...ACTION, numberUsed: 2 }]);

  assert.equal(calls[0].uses, 7);
});

test("refuses an item whose used count is not a real number", () => {
  // getFoundryItems() hands back SOURCE data, where uses.max is a formula
  // ("5 * @classes.paladin.levels") and uses.value does not exist at all — only
  // `spent` does. Subtracting those gives NaN. Posting that to D&D Beyond would
  // write garbage, so it must never leave here. Caught live 2026-08-24.
  const broken = { ...FEATURE, used: NaN };

  assert.deepEqual(diffActionUses([broken], [ACTION]), []);
});

test("refuses a used count that is not finite", () => {
  assert.deepEqual(diffActionUses([{ ...FEATURE, used: Infinity }], [ACTION]), []);
});

// A free cast granted by a class feature (2026-10-15, Warpey's Hunter's Mark). Since the 08-30 dual-pool
// shape the pool lives on the SPELL (uses + a "(free casting)" forward activity) and the granting feature
// — Favored Enemy — is inert, with no uses, so the feature-only sync never saw the casts being spent.
// On D&D Beyond the pool is an ACTION under that feature. Shapes are Warpey's, read live.
const HM_ACTION = {
  id: 9414054, entityTypeId: 222216831,
  componentId: 10292304, componentTypeId: 12168134,
  name: "Hunter’s Mark", numberUsed: 0,
};
const OTHER_ACTION_SAME_FEATURE = { ...HM_ACTION, id: 9999999, name: "Some Other Use", numberUsed: 0 };
const HM_SPELL = { ddbId: 10292304, entityTypeId: 12168134, name: "Hunter's Mark", used: 2, actionName: "Hunter's Mark" };

test("a free-cast pool on a spell reaches the action under its granting feature", () => {
  const calls = diffActionUses([HM_SPELL], [HM_ACTION]);
  assert.deepEqual(calls, [{ actionId: 9414054, entityTypeId: 222216831, uses: 2 }]);
});

test("…matched by NAME too, curly apostrophe or not, never to another action of the same feature", () => {
  const calls = diffActionUses([HM_SPELL], [OTHER_ACTION_SAME_FEATURE, HM_ACTION]);
  assert.deepEqual(calls.map((c) => c.actionId), [9414054]);
});

test("…and nothing is sent when the feature has no action of that name", () => {
  assert.deepEqual(diffActionUses([HM_SPELL], [OTHER_ACTION_SAME_FEATURE]), []);
});

const FEATS = [
  { ddbId: 10292304, entityTypeId: 12168134, name: "Favored Enemy", identifier: "favored-enemy" },
  { ddbId: 3727521, entityTypeId: 306912077, name: "Elven: Wood Elf Lineage", identifier: "elven-wood-elf-lineage" },
];

test("the granting feature is found through the spell's sourceItem identifier", () => {
  assert.equal(grantingFeature({ sourceItem: "feat:favored-enemy", grantFeature: "Favored Enemy" }, FEATS), FEATS[0]);
});

test("…or, without one, through the feature name the dual-pool stamp recorded", () => {
  assert.equal(grantingFeature({ sourceItem: "", grantFeature: "Favored Enemy" }, FEATS), FEATS[0]);
  assert.equal(grantingFeature({ sourceItem: "feat:nope", grantFeature: "Nope" }, FEATS), null);
});

// A free cast whose pool D&D Beyond keeps on the SPELL ENTRY itself (2026-10-15): Nigel's Healing Word
// (feat), Warpey's Longstrider and Nahuel's Faerie Fire (species), Victus's Shield (feat). D&D Beyond's own
// sheet writes these through the SAME route as actions — `action/limited-use` with the spell entry's id
// and entityTypeId (read from its app bundle: spellUseSet and actionUseSet share one API function).
// The Foundry spell already carries that entry identity in flags.ddbimporter.id / entityTypeId.
const SHIELD_ENTRY = { id: 5477280, entityTypeId: 420821570, name: "Shield", numberUsed: 0 };
const HM_ENTRY_NO_POOL_SEEN = { id: 5477224, entityTypeId: 420821570, name: "Hunter's Mark", numberUsed: 0 };

test("a spell's own pool is written to its D&D Beyond spell entry, by id", () => {
  const calls = diffSpellUses([{ ddbId: 5477280, entityTypeId: 420821570, name: "Shield", used: 1 }], [SHIELD_ENTRY]);
  assert.deepEqual(calls, [{ actionId: 5477280, entityTypeId: 420821570, uses: 1 }]);
});

test("…nothing when they agree, or when D&D Beyond keeps no pool on that entry", () => {
  assert.deepEqual(diffSpellUses([{ ddbId: 5477280, entityTypeId: 420821570, name: "Shield", used: 0 }], [SHIELD_ENTRY]), []);
  // Hunter's Mark's pool is an ACTION on D&D Beyond; its spell entry has no limitedUse, so it is not offered here.
  assert.deepEqual(diffSpellUses([{ ddbId: 5477224, entityTypeId: 420821570, name: "Hunter's Mark", used: 2 }], [SHIELD_ENTRY]), []);
});

test("…and never across entity types", () => {
  assert.deepEqual(diffSpellUses([{ ddbId: 5477280, entityTypeId: 1, name: "Shield", used: 1 }], [SHIELD_ENTRY]), []);
});

test("an uncountable Foundry pool is never sent", () => {
  assert.deepEqual(diffSpellUses([{ ddbId: 5477280, entityTypeId: 420821570, name: "Shield", used: NaN }], [SHIELD_ENTRY, HM_ENTRY_NO_POOL_SEEN]), []);
});
