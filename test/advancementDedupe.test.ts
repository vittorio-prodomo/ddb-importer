import test from "node:test";
import assert from "node:assert";

import { advancementGrantKey, isDuplicateAdvancement } from "../src/parser/advancements/advancementDedupe.ts";

// Shapes are the real S2 objects from Warpey's "Elven: Wood Elf Lineage" after the 7.1.x merge:
// the trait generator's grant and the per-feature pass's grant for the same spell.
const LONGSTRIDER = "Compendium.world.ddb-dev-sandbox-v13-ddb-spells.Item.Longstrider24III";
const PASS = "Compendium.world.ddb-dev-sandbox-v13-ddb-spells.Item.PassWithouTrac24";

const traitGrant = {
  _id: "kOy7UmnZ0geuvqt8", type: "ItemGrant", level: 3, title: "Elven Lineage",
  configuration: { items: [{ uuid: LONGSTRIDER, optional: false }], spell: { method: "innate" } },
};
const featureGrant = {
  _id: "ZXJ2FYJDiGjHZlf8", type: "ItemGrant", level: 3, title: "Elven: Wood Elf Lineage (Spells)",
  configuration: { items: [{ uuid: LONGSTRIDER, optional: false }], spell: { method: "spell", uses: { requireSlot: true } } },
};

test("the same spell at the same level is a duplicate whatever the title or spell config says", () => {
  assert.equal(isDuplicateAdvancement({ [traitGrant._id]: traitGrant }, featureGrant), true);
  assert.equal(isDuplicateAdvancement([traitGrant], featureGrant), true);
});

test("a different level is a different grant", () => {
  assert.equal(isDuplicateAdvancement([traitGrant], { ...featureGrant, level: 5 }), false);
});

test("a different spell is a different grant", () => {
  const pass = { ...featureGrant, configuration: { items: [{ uuid: PASS }] } };
  assert.equal(isDuplicateAdvancement([traitGrant], pass), false);
});

test("a different advancement type is never a duplicate, even for the same uuid", () => {
  assert.equal(isDuplicateAdvancement([traitGrant], { ...featureGrant, type: "ItemChoice", configuration: { pool: [{ uuid: LONGSTRIDER }] } }), false);
});

test("item order does not matter; string entries count too", () => {
  const a = { type: "ItemGrant", level: 1, configuration: { items: [{ uuid: PASS }, { uuid: LONGSTRIDER }] } };
  const b = { type: "ItemGrant", level: 1, configuration: { items: [LONGSTRIDER, PASS] } };
  assert.equal(advancementGrantKey(a), advancementGrantKey(b));
  assert.equal(isDuplicateAdvancement([a], b), true);
});

test("an advancement that grants nothing is never a duplicate (and has no key)", () => {
  assert.equal(advancementGrantKey({ type: "ItemGrant", level: 1, configuration: { items: [] } }), null);
  assert.equal(isDuplicateAdvancement([traitGrant], { type: "ItemGrant", level: 3, configuration: { items: [] } }), false);
  assert.equal(isDuplicateAdvancement(null, featureGrant), false);
});
