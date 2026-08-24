import test from "node:test";
import assert from "node:assert";

import { diffHitDice } from "../src/updater/hitDiceSync.ts";

// dnd5e 5.x stores spent hit dice at system.hd.spent. The old code compared
// system.hitDiceUsed, which exists on NEITHER side — undefined !== undefined is
// false, so it never found a difference and never synced. Verified live
// 2026-08-24: Foundry hd.spent 1 vs DDB 0, and no call was made.
const F = (ddbId: number, spent: number) => ({ ddbId, spent });
const D = (ddbId: number, spent: number) => ({ ddbId, spent });

test("syncs a class whose spent hit dice differ", () => {
  assert.deepEqual(diffHitDice([F(217183666, 1)], [D(217183666, 0)]), { 217183666: 1 });
});

test("sends nothing when both sides agree", () => {
  assert.deepEqual(diffHitDice([F(217183666, 2)], [D(217183666, 2)]), {});
});

test("sends nothing when neither side records spent dice", () => {
  // The regression guard: two undefineds must not read as 'no change' by accident
  // AND must not read as a change either.
  assert.deepEqual(diffHitDice([F(217183666, undefined as never)], [D(217183666, undefined as never)]), {});
});

test("reports each multiclass level separately", () => {
  const out = diffHitDice([F(1, 3), F(2, 1)], [D(1, 0), D(2, 1)]);

  assert.deepEqual(out, { 1: 3 }, "only the class that changed");
});

test("ignores a class with no D&D Beyond id", () => {
  assert.deepEqual(diffHitDice([F(null as never, 2)], [D(217183666, 0)]), {});
});

test("ignores a Foundry class D&D Beyond does not know", () => {
  assert.deepEqual(diffHitDice([F(999, 2)], [D(217183666, 0)]), {});
});
