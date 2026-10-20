import test from "node:test";
import assert from "node:assert";

import { entriesInEdition, itemRulesEdition } from "../src/updater/itemEdition.ts";

// A Potion of Healing added from the Player's Handbook, CPR or the SRD reached D&D Beyond as the
// 2014 Potion (item 71): the sync took the first same-name item in the DDB Items pack, whatever
// its edition. The 2024 copy there is 8960641. Dry runs, 2026-10-19.

test("an item's own rules edition wins over the world's", () => {
  assert.strictEqual(itemRulesEdition({ system: { source: { rules: "2024" } } }, "legacy"), "2024");
  assert.strictEqual(itemRulesEdition({ system: { source: { rules: "2014" } } }, "modern"), "2014");
});

test("an item that does not say takes the world's edition", () => {
  assert.strictEqual(itemRulesEdition({}, "modern"), "2024");
  assert.strictEqual(itemRulesEdition({ system: {} }, "legacy"), "2014");
  assert.strictEqual(itemRulesEdition({ system: { source: { rules: "" } } }, "modern"), "2024");
});

const potion2014 = { name: "Potion of Healing", system: { source: { rules: "2014" } }, def: 71 };
const potion2024 = { name: "Potion of Healing", system: { source: { rules: "2024" } }, def: 8960641 };
const noRules = { name: "Rope", system: {}, def: 1 };

test("only the entries of the wanted edition are offered to the name match", () => {
  assert.deepStrictEqual(entriesInEdition([potion2014, potion2024, noRules], "2024"), [potion2024]);
  assert.deepStrictEqual(entriesInEdition([potion2014, potion2024, noRules], "2014"), [potion2014]);
});

test("an index holding nothing of the wanted edition is returned whole", () => {
  assert.deepStrictEqual(entriesInEdition([potion2014, noRules], "2024"), [potion2014, noRules]);
});

// Minor 5 (T128 review): exact matches everywhere before any loose match — a loose match inside the
// item's edition must not win over an exact match in the other edition.
import { matchAttempts } from "../src/updater/itemEdition.ts";

test("exact in the edition, exact anywhere, then loose in the edition, then loose anywhere", () => {
  const subset = [potion2024];
  const all = [potion2014, potion2024];
  assert.deepStrictEqual(matchAttempts(subset, all), [
    { index: subset, loose: false }, { index: all, loose: false }, { index: subset, loose: true }, { index: all, loose: true },
  ]);
});

test("when the edition subset IS the whole index, each pass runs once", () => {
  const all = [potion2014];
  assert.deepStrictEqual(matchAttempts(all, all), [{ index: all, loose: false }, { index: all, loose: true }]);
});
