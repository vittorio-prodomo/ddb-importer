import test from "node:test";
import assert from "node:assert";

import { diffActionUses } from "../src/updater/actionSync.ts";

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
