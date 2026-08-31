import test from "node:test";
import assert from "node:assert";
import { buildPrimalCompanionActivities } from "../src/parser/enrichers/data/primalCompanionActivities.ts";

test("summon activity is special-activated (free, Argon Special panel) with a permanent duration", () => {
  const { summon } = buildPrimalCompanionActivities();
  assert.equal(summon.type, "summon");
  assert.equal(summon.activation.type, "special");
  // the marker trap: midi copies this duration onto its Summon marker
  assert.notEqual(summon.duration?.units ?? "", "");
  assert.equal(summon.profiles.length, 0); // reconciliation owns the pointers
  assert.equal(summon.match.attacks, true);
  assert.equal(summon.bonuses.hp.includes("@classes.ranger.levels"), true);
});

test("restore spends a spell slot but does NO healing of its own", () => {
  const { restore } = buildPrimalCompanionActivities();
  // ⚠️ UTILITY, not "heal" (T204). A heal activity printed a flat 200 on the
  // chat card that healed nobody — the activity declares no target — and would
  // have been misapplied to whatever the player had targeted. The module heals
  // the beast to full itself, from the marker's own fallen dependent.
  assert.equal(restore.type, "utility");
  assert.equal(restore.healing, undefined, "no healing block may come back");
  assert.equal(restore.consumption.targets[0].type, "spellSlots");
});

test("restore offers NO slot-level choice — the level is pure cost", () => {
  const { restore } = buildPrimalCompanionActivities();
  // 2024 RAW: "expend a spell slot" of any level, nothing scales with it, so
  // dnd5e-lowest-slot-cast stamps the cheapest usable slot instead of asking.
  // ⚠️ `scaling.allowed: false` removes the slider; the TARGET's own
  // scaling.mode must stay "level" or no level can be chosen at all (T200).
  assert.equal(restore.consumption.scaling.allowed, false);
  assert.equal(restore.consumption.targets[0].scaling.mode, "level");
  assert.equal(restore.consumption.spellSlot, true);
});

test("exactly two activities — no command, no dismiss, no per-type utilities", () => {
  assert.deepEqual(Object.keys(buildPrimalCompanionActivities()), ["summon", "restore"]);
});
