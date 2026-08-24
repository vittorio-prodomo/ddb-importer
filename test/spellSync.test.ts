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
