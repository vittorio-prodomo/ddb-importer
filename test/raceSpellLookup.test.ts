import test from "node:test";
import assert from "node:assert";

import { resolveRaceGrantingTrait, isCastActivityRacialTrait } from "../src/parser/spells/raceSpellLookup.ts";

// Shapes mirror a real 2024 Elf export (Nahuel/Warpey, dev-sandbox-v13). The
// racial trait ids are the large 13856xxx values; a lineage OPTION id is a much
// smaller number and never appears in racialTraits — that mismatch is the bug.
const LINEAGE_SPELLS_TRAIT = 13856114;
const DROW_OPTION = 3727515;

const ddb = ({ choices = [] as any[] } = {}) => ({
  character: {
    race: {
      racialTraits: [
        { definition: { id: 13856110, name: "Elven Lineage" } },
        { definition: { id: LINEAGE_SPELLS_TRAIT, name: "Elven Lineage Spells" } },
        { definition: { id: 13856111, name: "Fey Ancestry" } },
      ],
    },
    choices: { race: choices },
  },
});

const lineageChoice = {
  componentId: LINEAGE_SPELLS_TRAIT,
  componentTypeId: 1960452172,
  optionValue: DROW_OPTION,
  label: "Choose a Level 1 Option",
};

test("resolves a trait whose definition id is the componentId directly", () => {
  const trait = resolveRaceGrantingTrait(ddb(), 13856111);

  assert.equal(trait?.name, "Fey Ancestry");
  assert.equal(trait?.id, 13856111);
});

test("resolves a 2024 lineage spell through the choice that owns the option", () => {
  // The spell points at the chosen lineage OPTION; only choices.race knows which
  // racial trait that option belongs to. Without this hop the parser fell back to
  // the literal "Racial spell" and the granting trait was lost.
  const trait = resolveRaceGrantingTrait(ddb({ choices: [lineageChoice] }), DROW_OPTION);

  assert.equal(trait?.name, "Elven Lineage Spells");
  assert.equal(trait?.id, LINEAGE_SPELLS_TRAIT);
});

test("returns null when no choice claims the option", () => {
  assert.equal(resolveRaceGrantingTrait(ddb(), DROW_OPTION), null);
});

test("returns null when the owning choice points at a trait the character lacks", () => {
  const orphan = { ...lineageChoice, componentId: 999999 };

  assert.equal(resolveRaceGrantingTrait(ddb({ choices: [orphan] }), DROW_OPTION), null);
});

test("ignores choice entries with no optionValue", () => {
  // Real exports carry choices whose optionValue is null; matching those against
  // an undefined componentId would hand back an arbitrary trait.
  const blank = { componentId: LINEAGE_SPELLS_TRAIT, optionValue: null };

  assert.equal(resolveRaceGrantingTrait(ddb({ choices: [blank] }), undefined as never), null);
});

test("survives a character with no race choices at all", () => {
  const bare = { character: { race: { racialTraits: [] } } };

  assert.equal(resolveRaceGrantingTrait(bare as never, DROW_OPTION), null);
});

test("claims the lineage and legacy spell traits the Lineage enricher handles", () => {
  for (const name of ["Elven Lineage Spells", "Gnomish Lineage Spells", "Elemental Legacy Spells"]) {
    assert.equal(isCastActivityRacialTrait(name), true, name);
  }
});

test("leaves other racial traits to the normal innate parse", () => {
  // "Elven Lineage" itself grants nothing; only its " Spells" companion does.
  for (const name of ["Elven Lineage", "Fey Ancestry", "Racial spell", "Trance", ""]) {
    assert.equal(isCastActivityRacialTrait(name), false, name || "(empty)");
  }
});
