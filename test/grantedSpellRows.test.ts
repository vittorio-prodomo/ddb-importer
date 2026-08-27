import test from "node:test";
import assert from "node:assert";

import {
  classSpellUuids,
  hideFromSpellbook,
  matchesGrantingFeature,
  normaliseGrantName,
} from "../src/parser/spells/grantedSpellRows.ts";

const DIVINE_SMITE = "Compendium.world.ddb-spells.Item.DivineSmite24III";
const HEALING_WORD = "Compendium.world.ddb-spells.Item.HealingWord24III";

test("matches a grant to its feature across DDB's typographic apostrophe", () => {
  // The live failure: the grant records the RAW "Paladin’s Smite" (U+2019) while
  // the feature carries the normalised "Paladin's Smite" (U+0027). Comparing them
  // raw left Victus with a duplicate innate Divine Smite row.
  assert.equal(matchesGrantingFeature("Paladin’s Smite", "Paladin's Smite"), true);
  assert.equal(matchesGrantingFeature("Paladin's Smite", "Paladin’s Smite"), true);
});

test("still matches a feature with no apostrophe at all", () => {
  // Favored Enemy already worked; the fix must not change it.
  assert.equal(matchesGrantingFeature("Favored Enemy", "Favored Enemy"), true);
});

test("does not match two different features", () => {
  assert.equal(matchesGrantingFeature("Paladin’s Smite", "Favored Enemy"), false);
});

test("treats a missing name as no match, never as a wildcard", () => {
  assert.equal(matchesGrantingFeature(undefined, "Paladin's Smite"), false);
  assert.equal(matchesGrantingFeature(null, null), false);
  assert.equal(matchesGrantingFeature("", ""), false);
});

test("normalises the HTML entity form of the apostrophe too", () => {
  assert.equal(normaliseGrantName("Paladin&rsquo;s Smite"), "paladin's smite");
});

test("collects the compendium uuids of the class list", () => {
  const uuids = classSpellUuids([
    { name: "Divine Smite", _stats: { compendiumSource: DIVINE_SMITE } },
    { name: "Searing Smite", _stats: {} },
    { name: "Wrathful Smite" },
  ]);

  assert.deepEqual([...uuids], [DIVINE_SMITE]);
});

test("hides the cached copy of a granted spell that is also a class spell", () => {
  // Victus: Divine Smite is granted by Paladin's Smite AND on the Paladin list.
  // The class-list row takes over, so dnd5e's cached row is redundant.
  const onList = classSpellUuids([{ _stats: { compendiumSource: DIVINE_SMITE } }]);

  assert.equal(hideFromSpellbook(DIVINE_SMITE, onList), true);
});

test("keeps the cached copy when the spell is NOT on the class list", () => {
  // Nigel: Magic Initiate (Cleric) grants Healing Word, which no Wizard list
  // carries. Hiding it here would remove the spell from his sheet entirely.
  const onList = classSpellUuids([{ _stats: { compendiumSource: DIVINE_SMITE } }]);

  assert.equal(hideFromSpellbook(HEALING_WORD, onList), false);
});

test("keeps the cached copy when the activity names no spell", () => {
  assert.equal(hideFromSpellbook(undefined, classSpellUuids([])), false);
});
