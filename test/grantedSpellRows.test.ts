import test from "node:test";
import assert from "node:assert";

import {
  hideFromSpellbook,
  matchesGrantingFeature,
  normaliseGrantName,
  planSpellbookRowChanges,
  spellSourceUuids,
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
  const uuids = spellSourceUuids([
    { name: "Divine Smite", _stats: { compendiumSource: DIVINE_SMITE } },
    { name: "Searing Smite", _stats: {} },
    { name: "Wrathful Smite" },
  ]);

  assert.deepEqual([...uuids], [DIVINE_SMITE]);
});

test("hides the cached copy of a granted spell that is also a class spell", () => {
  // Victus: Divine Smite is granted by Paladin's Smite AND on the Paladin list.
  // The class-list row takes over, so dnd5e's cached row is redundant.
  const onList = spellSourceUuids([{ _stats: { compendiumSource: DIVINE_SMITE } }]);

  assert.equal(hideFromSpellbook(DIVINE_SMITE, onList), true);
});

test("keeps the cached copy when the spell is NOT on the class list", () => {
  // Nigel: Magic Initiate (Cleric) grants Healing Word, which no Wizard list
  // carries. Hiding it here would remove the spell from his sheet entirely.
  const onList = spellSourceUuids([{ _stats: { compendiumSource: DIVINE_SMITE } }]);

  assert.equal(hideFromSpellbook(HEALING_WORD, onList), false);
});

test("keeps the cached copy when the activity names no spell", () => {
  assert.equal(hideFromSpellbook(undefined, spellSourceUuids([])), false);
});

// --- the post-import fixup (T191 option B) -----------------------------------
// CPR replaces the whole document for the features it adopts, so a spellbook
// flag written during the parse is discarded. These cases drive the pass that
// re-applies the same rule once the swap is done.

test("hides a cached row whose spell another row already covers", () => {
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: DIVINE_SMITE, spellbook: true }],
    covered: new Set([DIVINE_SMITE]),
    previouslyHidden: [],
  });

  assert.deepEqual(plan, { hide: ["a1"], restore: [] });
});

test("leaves an uncovered cached row alone", () => {
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: HEALING_WORD, spellbook: true }],
    covered: new Set([DIVINE_SMITE]),
    previouslyHidden: [],
  });

  assert.deepEqual(plan, { hide: [], restore: [] });
});

test("is idempotent — an already-hidden row is not hidden again", () => {
  // The pass runs on every import; re-issuing the same update would churn the
  // document and re-trigger dnd5e's activity hooks for no reason.
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: DIVINE_SMITE, spellbook: false }],
    covered: new Set([DIVINE_SMITE]),
    previouslyHidden: ["a1"],
  });

  assert.deepEqual(plan, { hide: [], restore: [] });
});

test("restores a row WE hid once its spell stops being covered", () => {
  // Otherwise dropping the spell from the class list would leave the cached row
  // hidden and the spell would vanish from the sheet entirely.
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: DIVINE_SMITE, spellbook: false }],
    covered: new Set(),
    previouslyHidden: ["a1"],
  });

  assert.deepEqual(plan, { hide: [], restore: ["a1"] });
});

test("never restores a row we did not hide ourselves", () => {
  // A premade (or upstream) may ship spellbook:false deliberately. Only rows we
  // recorded are ours to put back.
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: DIVINE_SMITE, spellbook: false }],
    covered: new Set(),
    previouslyHidden: [],
  });

  assert.deepEqual(plan, { hide: [], restore: [] });
});

test("ignores a cast activity that names no spell", () => {
  const plan = planSpellbookRowChanges({
    activities: [{ id: "a1", uuid: null, spellbook: true }],
    covered: new Set([DIVINE_SMITE]),
    previouslyHidden: [],
  });

  assert.deepEqual(plan, { hide: [], restore: [] });
});

test("plans across several activities on one feature", () => {
  // Warpey's Elven Lineage: Longstrider is on his Ranger list, Druidcraft is not.
  const DRUIDCRAFT = "Compendium.world.ddb-spells.Item.Druidcraft24III";
  const plan = planSpellbookRowChanges({
    activities: [
      { id: "long", uuid: DIVINE_SMITE, spellbook: true },
      { id: "druid", uuid: DRUIDCRAFT, spellbook: true },
    ],
    covered: new Set([DIVINE_SMITE]),
    previouslyHidden: [],
  });

  assert.deepEqual(plan, { hide: ["long"], restore: [] });
});

test("collects source uuids only from the rows handed to it", () => {
  // The caller filters out cached rows; a cached row must never count as the
  // coverage that justifies hiding itself.
  const uuids = spellSourceUuids([
    { _stats: { compendiumSource: DIVINE_SMITE } },
    { _stats: { compendiumSource: HEALING_WORD } },
  ]);

  assert.deepEqual([...uuids].sort(), [DIVINE_SMITE, HEALING_WORD].sort());
});

// --- the dual-pool extension (2026-08-30) -----------------------------------

import { planClassListGrantReconciliation, usableSpellSourceUuids } from "../src/parser/spells/grantedSpellRows.ts";

const LONGSTRIDER = "Compendium.world.sp.Item.Longstrider24III";
const DRUIDCRAFT = "Compendium.world.sp.Item.Druidcraft24IIII";

const classRow = (uuid, system) => ({ _stats: { compendiumSource: uuid }, system });

test("an unprepared full-list catalogue row is NOT usable coverage", () => {
  const usable = usableSpellSourceUuids([classRow(LONGSTRIDER, { method: "spell", prepared: 0 })]);
  assert.equal(usable.has(LONGSTRIDER), false);
});

test("prepared, always-prepared and non-preparation methods ARE usable coverage", () => {
  const usable = usableSpellSourceUuids([
    classRow("uuid.prepared", { method: "spell", prepared: 1 }),
    classRow("uuid.always", { method: "spell", prepared: 2 }),
    classRow("uuid.innate", { method: "innate", prepared: 0 }),
  ]);
  assert.deepEqual([...usable].sort(), ["uuid.always", "uuid.innate", "uuid.prepared"]);
});

test("a free-cast grant on a class-list spell dual-pools instead of hiding", () => {
  // The Wood-Elf Longstrider case: unprepared catalogue row, free-cast grant.
  const plan = planClassListGrantReconciliation({
    activities: [
      { id: "addLongstrider1I", uuid: LONGSTRIDER, consumesItemUses: true },
      { id: "addDruidcraft0II", uuid: DRUIDCRAFT, consumesItemUses: false },
    ],
    onClassList: new Set([LONGSTRIDER]),
    usable: new Set(),
  });
  assert.deepEqual(plan.dualPool, [{ id: "addLongstrider1I", uuid: LONGSTRIDER }]);
  assert.deepEqual(plan.hide, []);
});

test("a no-pool grant covered by a USABLE class row is hidden, as before", () => {
  const plan = planClassListGrantReconciliation({
    activities: [{ id: "a1", uuid: "uuid.smite", consumesItemUses: false }],
    onClassList: new Set(["uuid.smite"]),
    usable: new Set(["uuid.smite"]),
  });
  assert.deepEqual(plan, { dualPool: [], hide: ["a1"] });
});

test("a no-pool grant covered only by a catalogue row keeps its cached row", () => {
  const plan = planClassListGrantReconciliation({
    activities: [{ id: "a1", uuid: "uuid.x", consumesItemUses: false }],
    onClassList: new Set(["uuid.x"]),
    usable: new Set(),
  });
  assert.deepEqual(plan, { dualPool: [], hide: [] });
});

test("an off-list grant is untouched either way", () => {
  const plan = planClassListGrantReconciliation({
    activities: [{ id: "a1", uuid: DRUIDCRAFT, consumesItemUses: true }],
    onClassList: new Set([LONGSTRIDER]),
    usable: new Set([LONGSTRIDER]),
  });
  assert.deepEqual(plan, { dualPool: [], hide: [] });
});
