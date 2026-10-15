import test from "node:test";
import assert from "node:assert";

import { addedCustomItemDefinitionId, changedCustomItems, customItemEntryFlags, findCustomItemEntry } from "../src/updater/customItemSync.ts";

// ⚠️ D&D Beyond's customItems[].id is the DEFINITION id, which ddb-importer stores as
// flags.ddbimporter.definitionId. flags.ddbimporter.id is the INVENTORY ENTRY id and is
// a completely different number. The old comparison matched DDB's id against the entry
// id, so it never matched and a changed custom item never synced. Verified live
// 2026-08-24: notebook quantity 1 -> 3 in Foundry produced no call at all.
const F = (over = {}) => ({
  definitionId: 36459048, entryId: 1076896759,
  name: "Weslocke's Notebook", description: null as string | null, quantity: 1, weight: 1,
  ...over,
});
const D = (over = {}) => ({
  id: 36459048, name: "Weslocke's Notebook", description: null as string | null, quantity: 1, weight: 1,
  ...over,
});

test("detects a quantity change on a custom item", () => {
  const out = changedCustomItems([F({ quantity: 3 })], [D()]);

  assert.equal(out.length, 1);
  assert.equal(out[0].definitionId, 36459048);
});

test("matches on the definition id, never the inventory entry id", () => {
  // The regression: if it matched on entryId it would find nothing here.
  const out = changedCustomItems([F({ quantity: 3, entryId: 999999 })], [D()]);

  assert.equal(out.length, 1, "entry id is irrelevant to the match");
});

test("detects a rename", () => {
  assert.equal(changedCustomItems([F({ name: "Renamed" })], [D()]).length, 1);
});

test("detects a weight change", () => {
  assert.equal(changedCustomItems([F({ weight: 4 })], [D()]).length, 1);
});

test("stays quiet when nothing changed", () => {
  assert.deepEqual(changedCustomItems([F()], [D()]), []);
});

test("ignores a custom item D&D Beyond has never seen", () => {
  assert.deepEqual(changedCustomItems([F({ definitionId: 111, quantity: 9 })], [D()]), []);
});

test("ignores an item with no definition id at all", () => {
  assert.deepEqual(changedCustomItems([F({ definitionId: null as never, quantity: 9 })], [D()]), []);
});

// Adding a NEW custom item (2026-10-15, Nigel's "Spell Scroll of Misty Step"). The module read
// `data.addItems[0].id`, but D&D Beyond answers `custom/item` NEW with the custom item ITSELF, and
// the inventory ENTRY it files the item under is not in the answer at all — only in a fresh read.
// The crash came after the write had landed, so every re-sync added another copy. Shapes are real.
const NEW_ANSWER = { id: 37133367, name: "Spell Scroll of Misty Step", description: "2nd Level", weight: 0, cost: null, quantity: 1, notes: null };
const ENTRY = {
  id: 1105259846, entityTypeId: 1439493548, containerEntityId: 162942865, containerEntityTypeId: 1581111423, quantity: 1,
  definition: { id: 37133367, entityTypeId: 988229960, name: "Spell Scroll of Misty Step", isCustomItem: true },
};
const OTHER = {
  id: 1000000001, entityTypeId: 1439493548, containerEntityId: 162942865, containerEntityTypeId: 1581111423, quantity: 1,
  definition: { id: 37133367, entityTypeId: 1782728300, name: "Not custom, same number", isCustomItem: false },
};

test("the definition id of a new custom item comes from D&D Beyond's own answer", () => {
  assert.equal(addedCustomItemDefinitionId(NEW_ANSWER), 37133367);
});

test("an addItems-shaped answer still works", () => {
  assert.equal(addedCustomItemDefinitionId({ addItems: [ENTRY] }), 37133367);
});

test("an answer with no id gives none, never a throw", () => {
  assert.equal(addedCustomItemDefinitionId(undefined), null);
  assert.equal(addedCustomItemDefinitionId({}), null);
  assert.equal(addedCustomItemDefinitionId({ addItems: [] }), null);
});

test("the inventory entry is found by definition id, custom items only", () => {
  assert.equal(findCustomItemEntry([OTHER, ENTRY], 37133367), ENTRY);
});

test("no entry yet (D&D Beyond's read lags its write) gives null", () => {
  assert.equal(findCustomItemEntry([OTHER], 37133367), null);
  assert.equal(findCustomItemEntry(undefined, 37133367), null);
});

test("the flags written onto the Foundry item are the ones an import would give it", () => {
  assert.deepEqual(customItemEntryFlags(ENTRY), {
    id: 1105259846,
    entityTypeId: 1439493548,
    definitionId: 37133367,
    definitionEntityTypeId: 988229960,
    containerEntityId: 162942865,
    containerEntityTypeId: 1581111423,
  });
});
