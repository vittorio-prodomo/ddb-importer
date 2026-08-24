import test from "node:test";
import assert from "node:assert";

import { changedCustomItems } from "../src/updater/customItemSync.ts";

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
