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
