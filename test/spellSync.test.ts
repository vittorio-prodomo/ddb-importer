import test from "node:test";
import assert from "node:assert";

import { diffKnownSpells } from "../src/updater/spellSync.ts";

const WIZARD = 237167328;
const SORCERER = 999111;

// Minimal shapes: character.ts does the extraction, this module only decides.
const fSpell = (definitionId: number, over = {}) => ({
  definitionId, characterClassId: WIZARD, entityTypeId: 435869154, entryId: null, name: `F${definitionId}`, ...over,
});
const dSpell = (definitionId: number, over = {}) => ({
  definitionId, characterClassId: WIZARD, entityTypeId: 435869154, entryId: 100 + definitionId,
  name: `D${definitionId}`, countsAsKnownSpell: true, ...over,
});

const OPTS = { allowRemovals: true, removalCap: 2, knownCasterClassIds: new Set([WIZARD, SORCERER]) };

test("adds a spell Foundry has and D&D Beyond does not", () => {
  const d = diffKnownSpells([fSpell(1), fSpell(2)], [dSpell(1)], OPTS);

  assert.deepEqual(d.toAdd.map((s) => s.definitionId), [2]);
  assert.deepEqual(d.toRemove, []);
});

test("ignores Foundry spells that carry no D&D Beyond definition id", () => {
  // Hand-made or CPR-added spells were never DDB spells and must be invisible.
  const d = diffKnownSpells([fSpell(1), fSpell(null as never)], [dSpell(1)], OPTS);

  assert.deepEqual(d.toAdd, []);
  assert.deepEqual(d.toRemove, []);
});

test("removes a spell D&D Beyond knows and Foundry no longer has", () => {
  const d = diffKnownSpells([dSpell(1)].map((s) => fSpell(s.definitionId)), [dSpell(1), dSpell(2)], OPTS);

  assert.deepEqual(d.toRemove.map((s) => s.definitionId), [2]);
  assert.equal(d.toRemove[0].entryId, 102, "removal must carry the DDB entry id");
});

test("omits removals entirely when they are switched off", () => {
  const d = diffKnownSpells([fSpell(1)], [dSpell(1), dSpell(2)], { ...OPTS, allowRemovals: false });

  assert.deepEqual(d.toRemove, []);
  assert.equal(d.aborted, false);
});

test("aborts the whole diff when a pass wants more removals than the cap", () => {
  // A mass removal is nearly always a broken diff, not a real one.
  const d = diffKnownSpells([], [dSpell(1), dSpell(2), dSpell(3)], OPTS);

  assert.equal(d.aborted, true);
  assert.match(d.abortReason!, /3 .*cap|cap.*3/i);
  assert.deepEqual(d.toRemove, [], "an aborted diff must remove nothing");
  assert.deepEqual(d.toAdd, [], "an aborted diff must add nothing either");
});

test("treats the same spell known through two classes as two different spells", () => {
  const d = diffKnownSpells(
    [fSpell(1), fSpell(1, { characterClassId: SORCERER })],
    [dSpell(1)],
    OPTS,
  );

  assert.deepEqual(d.toAdd.map((s) => s.characterClassId), [SORCERER]);
});

test("ignores classes that are not known or choice casters", () => {
  // A cleric knows the whole list; "learning" a spell is meaningless there.
  const CLERIC = 555;
  const d = diffKnownSpells([fSpell(9, { characterClassId: CLERIC })], [], OPTS);

  assert.deepEqual(d.toAdd, []);
});

test("ignores D&D Beyond spells that do not count as known", () => {
  // Granted / always-prepared spells are not part of the known list.
  const d = diffKnownSpells([], [dSpell(1, { countsAsKnownSpell: false })], OPTS);

  assert.deepEqual(d.toRemove, []);
});

test("reports no work when both sides already agree", () => {
  const d = diffKnownSpells([fSpell(1)], [dSpell(1)], OPTS);

  assert.deepEqual(d.toAdd, []);
  assert.deepEqual(d.toRemove, []);
  assert.equal(d.aborted, false);
});

import { buildSpellSyncCalls } from "../src/updater/spellSync.ts";

test("builds an add call from the Foundry spell's ddbimporter id", () => {
  // For an addition DDB wants `id` = the class-spell-list mapping id, which is
  // what flags.ddbimporter.id holds on a compendium-sourced spell. Verified live:
  // POST spell {characterClassId, spellId: 2110, id: 2307, entityTypeId} added a
  // spell the character had never known.
  const diff = { toAdd: [fSpell(2110, { entryId: 2307 })], toRemove: [], aborted: false };

  const calls = buildSpellSyncCalls(diff);

  assert.deepEqual(calls, [{
    characterClassId: WIZARD, spellId: 2110, id: 2307, entityTypeId: 435869154, remove: false,
  }]);
});

test("builds a remove call from the D&D Beyond entry id", () => {
  const diff = { toAdd: [], toRemove: [dSpell(1991, { entryId: 136027 })], aborted: false };

  const calls = buildSpellSyncCalls(diff);

  assert.equal(calls[0].id, 136027);
  assert.equal(calls[0].remove, true);
});

test("builds nothing at all from an aborted diff", () => {
  const calls = buildSpellSyncCalls({ toAdd: [fSpell(1)], toRemove: [dSpell(2)], aborted: true, abortReason: "x" });

  assert.deepEqual(calls, []);
});

test("skips an addition that has no ddbimporter id to send", () => {
  // Without a mapping id DDB answers 400 "Missing required field: id", so there
  // is nothing useful to send.
  const calls = buildSpellSyncCalls({ toAdd: [fSpell(5, { entryId: null })], toRemove: [], aborted: false });

  assert.deepEqual(calls, []);
});

import { attributeSpellsToClass } from "../src/updater/spellSync.ts";

// A spell dragged from the DDB spell compendium carries definitionId and the mapping
// id, but characterClassId is NULL — that field is per-character, not per-spell. Left
// unattributed the diff drops it, so "learned a new spell" silently never synced.
// Verified live 2026-08-24: adding Alarm from the compendium synced nothing.

test("attributes an unassigned spell to the only spellcasting class", () => {
  const loose = { ...fSpell(1991), characterClassId: null as never };

  const [out] = attributeSpellsToClass([loose], new Set([WIZARD]));

  assert.equal(out.characterClassId, WIZARD);
});

test("leaves an unassigned spell alone when the character multiclasses", () => {
  // Guessing which class learned it could write the spell to the wrong class list.
  const loose = { ...fSpell(1991), characterClassId: null as never };

  const [out] = attributeSpellsToClass([loose], new Set([WIZARD, SORCERER]));

  assert.equal(out.characterClassId, null);
});

test("leaves an unassigned spell alone when there is no spellcasting class at all", () => {
  const loose = { ...fSpell(1991), characterClassId: null as never };

  const [out] = attributeSpellsToClass([loose], new Set());

  assert.equal(out.characterClassId, null);
});

test("never overwrites a class the spell already names", () => {
  const assigned = fSpell(1991, { characterClassId: SORCERER });

  const [out] = attributeSpellsToClass([assigned], new Set([WIZARD]));

  assert.equal(out.characterClassId, SORCERER);
});

test("an attributed spell then reaches the diff as an addition", () => {
  const loose = { ...fSpell(2110, { entryId: 2307 }), characterClassId: null as never };

  const attributed = attributeSpellsToClass([loose], new Set([WIZARD]));
  const d = diffKnownSpells(attributed, [], OPTS);

  assert.deepEqual(d.toAdd.map((s) => s.definitionId), [2110]);
});

test("does not re-add a spell D&D Beyond already lists but does not count as known", () => {
  // Granted / always-prepared spells appear in classSpells with countsAsKnownSpell:false.
  // They must not be treated as absent: re-adding one rewrites its entry as a *known*
  // spell and changes its provenance. Caught live 2026-08-24 — Resilient Sphere was
  // silently re-added on a real sheet.
  const granted = dSpell(2230, { countsAsKnownSpell: false });

  const d = diffKnownSpells([fSpell(2230)], [granted], OPTS);

  assert.deepEqual(d.toAdd, [], "DDB already has it; presence is what matters for adds");
});

test("still never removes a spell that does not count as known", () => {
  // The other direction is unchanged: a granted spell absent from Foundry is not a
  // removal candidate, because the player never "knew" it in the first place.
  const d = diffKnownSpells([], [dSpell(2230, { countsAsKnownSpell: false })], OPTS);

  assert.deepEqual(d.toRemove, []);
});

import { pactSlotsUsed } from "../src/updater/spellSync.ts";

// D&D Beyond stores slots CONSUMED; Foundry stores slots REMAINING. The pact path
// sent `pact.value` straight through, i.e. remaining-as-used. Regular slots already
// computed max - value correctly.
//
// ⚠️ These cases are deliberately ASYMMETRIC. The live test that "verified" pact magic
// used max 2 / value 1, where remaining and used are both 1 — the single value where
// this bug is invisible. That false positive is why this test exists.

test("reports pact slots as consumed, not remaining", () => {
  assert.equal(pactSlotsUsed({ max: 2, value: 2 }), 0, "full pool = nothing used");
  assert.equal(pactSlotsUsed({ max: 2, value: 0 }), 2, "empty pool = all used");
});

test("the symmetric case that hid the bug still holds", () => {
  assert.equal(pactSlotsUsed({ max: 2, value: 1 }), 1);
});

test("handles a larger pool where remaining and used never coincide", () => {
  assert.equal(pactSlotsUsed({ max: 4, value: 3 }), 1);
  assert.equal(pactSlotsUsed({ max: 4, value: 1 }), 3);
});

test("never reports a negative consumption", () => {
  assert.equal(pactSlotsUsed({ max: 2, value: 5 }), 0);
});

test("treats missing numbers as nothing used rather than guessing", () => {
  assert.equal(pactSlotsUsed({ max: undefined as never, value: 1 }), 0);
});
