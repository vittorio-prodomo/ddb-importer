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

import { classifyFoundrySpells, preparesFromWholeList } from "../src/updater/spellSync.ts";

// T236 — the first sync of the four real heroes wanted to ADD sixteen spells nobody had
// learned. Every shape below is copied from those sheets (2026-10-09).
const RANGER = 221402904;
const RANGER_OPTS = { allowRemovals: true, removalCap: 5, knownCasterClassIds: new Set([RANGER]) };
const WIZARD_OPTS = { allowRemovals: true, removalCap: 5, knownCasterClassIds: new Set([WIZARD]) };

const row = (definitionId: number, over = {}) => ({
  definitionId, characterClassId: WIZARD as number | null, entityTypeId: 435869154, entryId: 9000 + definitionId,
  name: `R${definitionId}`, prepared: 0, sourceItem: "class:wizard" as string | null, lookup: "classSpell" as string | null,
  ...over,
});
// wholeList: `true` = the class has a full list on the sheet (a Cleric); "membership" = on
// D&D Beyond being on the list IS being prepared (a 2024 Ranger or Paladin).
const classify = (rows: ReturnType<typeof row>[], classId: number, wholeList: boolean | "membership" = false) =>
  classifyFoundrySpells(rows, {
    knownCasterClassIds: new Set([classId]),
    wholeListClassIds: new Set(wholeList ? [classId] : []),
    membershipClassIds: new Set(wholeList === "membership" ? [classId] : []),
  });

test("never adds a lineage or feat spell to the class, though it arrives without a class id", () => {
  // Druidcraft from Elven Lineage, Guidance from Magic Initiate: class id null, so the
  // single-class attribution used to hand them to the Ranger / the Wizard.
  const granted = [
    row(2619158, { characterClassId: null, prepared: 2, sourceItem: "feat:elven-lineage", lookup: "race" }),
    row(2618971, { characterClassId: null, prepared: 2, sourceItem: "feat:magic-initiate-cleric", lookup: "feat" }),
  ];

  const d = diffKnownSpells(classify(granted, WIZARD), [], WIZARD_OPTS);

  assert.deepEqual(d.toAdd, []);
});

test("recognises a granted spell by its source item alone", () => {
  // Hunter's Mark after the Chris's Premades swap: no lookup flag left, only the source.
  const huntersMark = row(2619166, { characterClassId: null, prepared: 2, sourceItem: "feat:favored-enemy", lookup: null });

  const d = diffKnownSpells(classify([huntersMark], RANGER, "membership"), [], RANGER_OPTS);

  assert.deepEqual(d.toAdd, []);
});

test("never adds an unprepared entry of a class that prepares from its whole list", () => {
  // A 2024 Ranger's sheet carries the whole Ranger list; on D&D Beyond only the picks exist.
  const alarm = row(2619222, { characterClassId: RANGER, sourceItem: "class:ranger", prepared: 0 });

  const d = diffKnownSpells(classify([alarm], RANGER, "membership"), [], RANGER_OPTS);

  assert.deepEqual(d.toAdd, []);
});

test("adds a whole-list entry once it is prepared", () => {
  const alarm = row(2619222, { characterClassId: RANGER, sourceItem: "class:ranger", prepared: 1 });

  const d = diffKnownSpells(classify([alarm], RANGER, "membership"), [], RANGER_OPTS);

  assert.deepEqual(d.toAdd.map((s) => s.definitionId), [2619222]);
});

test("never adds an always-prepared entry of a whole-list class", () => {
  // Divine Smite on a Paladin: the class-list row, promoted to always prepared by a feature.
  const smite = row(7, { characterClassId: RANGER, sourceItem: "class:ranger", prepared: 2 });

  const d = diffKnownSpells(classify([smite], RANGER, "membership"), [], RANGER_OPTS);

  assert.deepEqual(d.toAdd, []);
});

test("still adds an unprepared spell a spellbook caster has just learned", () => {
  // Dragged from the compendium: no class id, dnd5e stamps the class as its source,
  // and a Wizard's new spell starts unprepared. This must keep syncing.
  const learned = row(1991, { characterClassId: null, prepared: 0, sourceItem: "class:wizard", lookup: null });

  const d = diffKnownSpells(classify([learned], WIZARD), [], WIZARD_OPTS);

  assert.deepEqual(d.toAdd.map((s) => s.definitionId), [1991]);
  assert.equal(d.toAdd[0].characterClassId, WIZARD);
});

test("a row that is not a pick still keeps its D&D Beyond spell from being removed", () => {
  // The importer can drop an unprepared class row when a lineage grants the same spell
  // always prepared, leaving only the granted row. That is not the player forgetting it.
  const grantedCopy = row(5, { characterClassId: null, prepared: 2, sourceItem: "feat:elven-lineage", lookup: "race" });
  const unpickedEntry = row(6, { prepared: 0 });

  const d = diffKnownSpells(classify([grantedCopy, unpickedEntry], WIZARD, true), [dSpell(5), dSpell(6)], WIZARD_OPTS);

  assert.deepEqual(d.toRemove, []);
  assert.deepEqual(d.toAdd, []);
});

test("Warpey's real sheet against her real D&D Beyond list changes nothing", () => {
  const ranger = (definitionId: number, prepared: number) =>
    row(definitionId, { characterClassId: RANGER, sourceItem: "class:ranger", prepared });
  const sheet = [
    // the four she prepared
    ranger(2618847, 1), ranger(2619079, 1), ranger(2619172, 1), ranger(2619059, 1),
    // the rest of the Ranger list
    ranger(2619222, 0), ranger(2619097, 0), ranger(2619093, 0), ranger(2619186, 0),
    ranger(2618910, 0), ranger(2618952, 0), ranger(2618975, 0), ranger(2618991, 0),
    // Favored Enemy and Elven Lineage
    row(2619166, { characterClassId: null, prepared: 2, sourceItem: "feat:favored-enemy", lookup: null }),
    row(2619158, { characterClassId: null, prepared: 2, sourceItem: "feat:elven-lineage", lookup: "race" }),
    row(2619004, { characterClassId: null, prepared: 2, sourceItem: "feat:elven-lineage", lookup: "race" }),
  ];
  const onDDB = [2618847, 2619079, 2619172, 2619059].map((id) => dSpell(id, { characterClassId: RANGER }));

  const d = diffKnownSpells(classify(sheet, RANGER, "membership"), onDDB, RANGER_OPTS);

  assert.deepEqual(d.toAdd, []);
  assert.deepEqual(d.toRemove, []);
  assert.equal(d.aborted, false);
});

// T240 — for a 2024 Ranger or Paladin, D&D Beyond holds only the picks, so unpreparing a
// spell in Foundry has to take it off the list there. Proven on a real sheet 2026-10-09:
// the add lands as a pick and the removal takes it away.
const rangerRow = (definitionId: number, prepared: number) =>
  row(definitionId, { characterClassId: RANGER, sourceItem: "class:ranger", prepared });
const rangerPick = (definitionId: number) => dSpell(definitionId, { characterClassId: RANGER });

test("unpreparing a pick removes it for a class whose list membership is preparation", () => {
  const d = diffKnownSpells(classify([rangerRow(1, 0)], RANGER, "membership"), [rangerPick(1)], RANGER_OPTS);

  assert.deepEqual(d.toRemove.map((s) => s.definitionId), [1]);
  assert.deepEqual(d.toAdd, []);
});

test("swapping one prepared spell for another is one removal and one addition", () => {
  const sheet = [rangerRow(1, 0), rangerRow(2, 1), rangerRow(3, 1)];

  const d = diffKnownSpells(classify(sheet, RANGER, "membership"), [rangerPick(1), rangerPick(3)], RANGER_OPTS);

  assert.deepEqual(d.toRemove.map((s) => s.definitionId), [1]);
  assert.deepEqual(d.toAdd.map((s) => s.definitionId), [2]);
});

test("an always-prepared row never removes the pick behind it", () => {
  // The player also picked a spell a feature keeps prepared anyway. Foundry shows one row,
  // always prepared; that is not the player unpreparing it.
  const d = diffKnownSpells(classify([rangerRow(1, 2)], RANGER, "membership"), [rangerPick(1)], RANGER_OPTS);

  assert.deepEqual(d.toRemove, []);
});

test("a granted copy keeps the pick even where membership is preparation", () => {
  const granted = row(1, { characterClassId: null, prepared: 2, sourceItem: "feat:elven-lineage", lookup: "race" });

  const d = diffKnownSpells(classify([granted], RANGER, "membership"), [rangerPick(1)], RANGER_OPTS);

  assert.deepEqual(d.toRemove, []);
});

test("an unprepared row still keeps its spell for a whole-list class that has a real prepared flag", () => {
  // A Cleric's list is on the sheet too, but there D&D Beyond's own flag says what is
  // prepared, so an unprepared row proves nothing about the list.
  const d = diffKnownSpells(classify([rangerRow(1, 0)], RANGER, true), [rangerPick(1)], RANGER_OPTS);

  assert.deepEqual(d.toRemove, []);
});

test("an unprepared spellbook spell is never removed", () => {
  const d = diffKnownSpells(classify([row(1, { prepared: 0 })], WIZARD), [dSpell(1)], WIZARD_OPTS);

  assert.deepEqual(d.toRemove, []);
});

import { membershipIsPreparation } from "../src/updater/spellSync.ts";

test("list membership is preparation only for a 2024 Ranger or Paladin", () => {
  const cls = (name: string, sourceIds: number[]) => ({ definition: { name, sources: sourceIds.map((sourceId) => ({ sourceId })) } });

  assert.equal(membershipIsPreparation(cls("Ranger", [145])), true);
  assert.equal(membershipIsPreparation(cls("Paladin", [145])), true);
  assert.equal(membershipIsPreparation(cls("Ranger", [1])), false, "a 2014 Ranger learns its spells");
  assert.equal(membershipIsPreparation(cls("Cleric", [145])), false);
  assert.equal(membershipIsPreparation(cls("Wizard", [145])), false);
  assert.equal(membershipIsPreparation(undefined), false);
});

const ddbClass = (name: string, sourceIds: number[]) => ({ definition: { name, sources: sourceIds.map((sourceId) => ({ sourceId })) } });

test("a class whose payload carries a full spell list prepares from that list", () => {
  assert.equal(preparesFromWholeList(ddbClass("Cleric", [1]), { alwaysKnownSpells: [{}] }), true);
  assert.equal(preparesFromWholeList(ddbClass("Wizard", [145]), { alwaysKnownSpells: [] }), false);
  assert.equal(preparesFromWholeList(ddbClass("Wizard", [145]), {}), false);
});

test("a 2024 Ranger or Paladin prepares from its list even when the payload carries none", () => {
  // The same gate the importer uses to read list membership as preparation.
  assert.equal(preparesFromWholeList(ddbClass("Ranger", [145]), {}), true);
  assert.equal(preparesFromWholeList(ddbClass("Paladin", [145]), {}), true);
  assert.equal(preparesFromWholeList(ddbClass("Ranger", [1]), {}), false, "a 2014 Ranger learns its spells");
});

import { resolveAdditionIds } from "../src/updater/spellSync.ts";

// T241 — the id a spell addition carries must be the entry's id in the character's OWN
// class list. Those ids differ per list: 2024 Alarm is 21172912 on the 2024 Wizard's
// list and 21172914 on the 2014 Wizard's, which is the one a compendium copy carries.
const WIZARD_2024_LIST = [
  { id: 21172912, entityTypeId: 435869154, definitionId: 2619222, name: "Alarm" },
  { id: 21171404, entityTypeId: 435869154, definitionId: 2618957, name: "Grease" },
  { id: 138001, entityTypeId: 435869154, definitionId: 2400, name: "Snilloc's Snowball Swarm" },
];
const lists = (entries: typeof WIZARD_2024_LIST | null) => new Map([[WIZARD, entries]]);

test("sends the class list's own id, not the one the dragged copy carries", () => {
  const dragged = fSpell(2619222, { entryId: 21172914, name: "Alarm" });

  const r = resolveAdditionIds([dragged], lists(WIZARD_2024_LIST));

  assert.deepEqual(r.refused, []);
  assert.equal(r.resolved[0].entryId, 21172912);
  assert.equal(r.resolved[0].definitionId, 2619222);
});

test("gives an id to an addition that arrived without one", () => {
  const r = resolveAdditionIds([fSpell(2618957, { entryId: null, name: "Grease" })], lists(WIZARD_2024_LIST));

  assert.equal(r.resolved[0].entryId, 21171404);
});

test("keeps an older spell that the class list really offers", () => {
  // A 2024 Wizard's list still holds 2014 spells that have no newer version.
  const r = resolveAdditionIds([fSpell(2400, { entryId: 5, name: "Snilloc's Snowball Swarm" })], lists(WIZARD_2024_LIST));

  assert.equal(r.resolved[0].entryId, 138001);
});

test("refuses the wrong edition's copy and says the list has another version", () => {
  // The compendium holds a 2014 and a 2024 Grease under one name. The 2014 copy is not
  // on a 2024 Wizard's list; sending it would put a legacy spell on the sheet.
  const legacy = fSpell(2127, { entryId: 137998, name: "Grease" });

  const r = resolveAdditionIds([legacy], lists(WIZARD_2024_LIST));

  assert.deepEqual(r.resolved, []);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].reason, "other-version");
  assert.equal(r.refused[0].spell.definitionId, 2127);
});

test("refuses a spell that is not on the class list at all", () => {
  const r = resolveAdditionIds([fSpell(999, { entryId: 1, name: "Cure Wounds" })], lists(WIZARD_2024_LIST));

  assert.deepEqual(r.resolved, []);
  assert.equal(r.refused[0].reason, "not-on-list");
});

test("refuses every addition for a class whose list could not be read", () => {
  // Without the list the id would be a guess again.
  const r = resolveAdditionIds([fSpell(2619222, { entryId: 21172914 })], lists(null));

  assert.deepEqual(r.resolved, []);
  assert.equal(r.refused[0].reason, "no-list");
});

test("matches the other version's name whatever its capitals", () => {
  const r = resolveAdditionIds([fSpell(2127, { name: "GREASE" })], lists(WIZARD_2024_LIST));

  assert.equal(r.refused[0].reason, "other-version");
});

// ── T128: a spell from a non-DDB compendium (Player's Handbook, dnd5e's 2024 SRD, CPR) carries no
// D&D Beyond id, so the sync never sent it — no call, no warning (dry runs, 2026-10-19). It is now
// matched by NAME on the class's own spell list, which holds one edition only.
import { normalizeSpellName, resolveDefinitionsByName } from "../src/updater/spellSync.ts";

const WIZ_LIST = new Map([[WIZARD, [
  { id: 21171404, entityTypeId: 435869154, definitionId: 2618957, name: "Grease" },
  { id: 21171500, entityTypeId: 435869154, definitionId: 2619000, name: "Hunter's Mark" },
]]]);

test("a Player's Handbook copy of Grease is given the class list's definition", () => {
  const out = resolveDefinitionsByName([fSpell(null as any, { name: "Grease" })], WIZ_LIST);
  assert.strictEqual(out.spells[0].definitionId, 2618957);
  assert.strictEqual(out.spells[0].matchedByName, true);
  assert.deepStrictEqual(out.unmatched, []);
});

test("an apostrophe spelled either way still matches", () => {
  assert.strictEqual(normalizeSpellName("  Hunter’s Mark "), "hunter's mark");
  const out = resolveDefinitionsByName([fSpell(null as any, { name: "Hunter’s Mark" })], WIZ_LIST);
  assert.strictEqual(out.spells[0].definitionId, 2619000);
});

test("a name the class list does not hold stays unmatched", () => {
  const spell = fSpell(null as any, { name: "Zzz Test Spell" });
  const out = resolveDefinitionsByName([spell], WIZ_LIST);
  assert.strictEqual(out.spells[0].definitionId, null);
  assert.deepStrictEqual(out.unmatched, [spell]);
});

test("no readable list leaves the spell unmatched", () => {
  const spell = fSpell(null as any, { name: "Grease" });
  const out = resolveDefinitionsByName([spell], new Map([[WIZARD, null]]));
  assert.strictEqual(out.spells[0].definitionId, null);
  assert.deepStrictEqual(out.unmatched, [spell]);
});

test("a spell that already has a D&D Beyond id is left alone", () => {
  const spell = fSpell(42, { name: "Grease" });
  const out = resolveDefinitionsByName([spell], WIZ_LIST);
  assert.deepStrictEqual(out.spells, [spell]);
  assert.deepStrictEqual(out.unmatched, []);
});

test("a spell no class can be given is never matched", () => {
  const spell = fSpell(null as any, { name: "Grease", characterClassId: undefined });
  const out = resolveDefinitionsByName([spell], WIZ_LIST);
  assert.strictEqual(out.spells[0].definitionId, null);
  assert.deepStrictEqual(out.unmatched, [spell]);
});

test("a definition-less row of the same class keeps a same-named D&D Beyond spell from being removed", () => {
  const diff = diffKnownSpells([fSpell(null as any, { name: "Grease" })], [dSpell(2618957, { name: "Grease" })], OPTS);
  assert.deepStrictEqual(diff.toRemove, []);
});

test("…but only for its own class", () => {
  const diff = diffKnownSpells(
    [fSpell(null as any, { name: "Grease", characterClassId: SORCERER })],
    [dSpell(2618957, { name: "Grease" })],
    OPTS,
  );
  assert.deepStrictEqual(diff.toRemove.map((s) => s.definitionId), [2618957]);
});

test("classifyFoundrySpells carries the Foundry item id through", () => {
  const rows = [{ definitionId: null, characterClassId: WIZARD, entityTypeId: 1, entryId: null, name: "Grease", prepared: 0, sourceItem: "class:wizard", lookup: null, itemId: "abc123" }];
  const out = classifyFoundrySpells(rows, { knownCasterClassIds: new Set([WIZARD]), wholeListClassIds: new Set() });
  assert.strictEqual(out[0].itemId, "abc123");
});
