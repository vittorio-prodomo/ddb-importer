import test from "node:test";
import assert from "node:assert";
import {
  describesExactlyTheseChoices,
  choiceAddendumHtml,
  resolveChoicesByComponent,
  compendiumLookupNames,
  skillReference,
} from "../src/parser/character/special/grantedChoices.ts";

/* ---------- the suppression rule ---------- */
// Skip the addendum only when the description already STATES the outcome:
// every chosen label present, and no rival option from the same pool present.
// A description that ENUMERATES options (Scholar) mentions the chosen one too,
// which is exactly why "does it mention it" is the wrong test.

const SCHOLAR = "Choose one of the following skills in which you have proficiency: Arcana, History, "
  + "Investigation, Medicine, Nature, or Religion. You have Expertise in the chosen skill.";
const MERCHANT = "Skill Proficiencies: Animal Handling and Persuasion Tool Proficiency: Navigator's Tools";
const VERSATILE = "You gain an Origin feat of your choice.";
const SKILL_POOL = ["Arcana", "History", "Investigation", "Medicine", "Nature", "Religion", "Animal Handling",
  "Persuasion", "Navigator's Tools", "Stealth"];

test("a description that ENUMERATES options does not count as stating the outcome", () => {
  assert.equal(describesExactlyTheseChoices(SCHOLAR, ["Arcana"], SKILL_POOL), false);
});

test("a description that STATES its grants counts, and is left alone", () => {
  assert.equal(
    describesExactlyTheseChoices(MERCHANT, ["Animal Handling", "Persuasion", "Navigator's Tools"], SKILL_POOL),
    true);
});

test("a description naming no options at all never counts as stating them", () => {
  assert.equal(describesExactlyTheseChoices(VERSATILE, ["Magic Initiate (Cleric)"], []), false);
});

test("a partial statement does not count — every chosen label must appear", () => {
  assert.equal(describesExactlyTheseChoices(MERCHANT, ["Animal Handling", "Arcana"], SKILL_POOL), false);
});

test("matching ignores markup and enricher syntax around the label", () => {
  const html = "<p>Skill Proficiencies: &Reference[ani]{Animal Handling} and &Reference[per]{Persuasion}</p>";
  assert.equal(describesExactlyTheseChoices(html, ["Animal Handling", "Persuasion"], SKILL_POOL), true);
});

test("matching is not fooled by a label embedded in a longer word", () => {
  assert.equal(describesExactlyTheseChoices("You gain Arcanaphobia.", ["Arcana"], []), false);
});

/* ---------- the addendum itself ---------- */

test("groups the addendum under the choice's own label", () => {
  const html = choiceAddendumHtml([{ groupLabel: "Skill Expertise", label: "Arcana" }]);
  assert.match(html!, /Skill Expertise/);
  assert.match(html!, /Arcana/);
});

test("several picks in one group are listed together", () => {
  const html = choiceAddendumHtml([
    { groupLabel: "Spell", label: "Shield" },
    { groupLabel: "Spell", label: "Protection from Evil and Good" },
  ]);
  assert.equal((html!.match(/<p>/g) ?? []).length, 1, "one line per group, not per pick");
  assert.match(html!, /Shield.*Protection from Evil and Good/);
});

test("nothing to say produces nothing — never an empty stub", () => {
  assert.equal(choiceAddendumHtml([]), null);
});

/* ---------- resolving raw DDB choices ---------- */

const DDB = {
  character: {
    choices: {
      class: [
        { componentId: 10292386, type: 2, label: "Choose a Skill Expertise", optionValue: 6091 },
        { componentId: 10292382, type: 2, label: "Choose a Wizard Skill Proficiency ", optionValue: 6187 },
      ],
      choiceDefinitions: [
        { id: "12168134-2", options: [{ id: 6091, label: "Arcana" }, { id: 6187, label: "Arcana" }, { id: 6188, label: "History" }] },
      ],
    },
  },
};

test("resolves an optionValue to its label, keyed by componentId", () => {
  const byComponent = resolveChoicesByComponent(DDB);
  assert.deepEqual(byComponent.get(10292386), [{ groupLabel: "Skill Expertise", label: "Arcana", poolId: "12168134-2" }]);
});

test("strips the imperative from the choice label so it reads as a heading", () => {
  const byComponent = resolveChoicesByComponent(DDB);
  assert.equal(byComponent.get(10292382)![0]!.groupLabel, "Wizard Skill Proficiency");
});

test("an unresolvable optionValue is dropped, not rendered as a bare id", () => {
  const ddb = { character: { choices: {
    feat: [{ componentId: 999, type: 6, label: "Choose an Origin feat", optionValue: 1789163 }],
    choiceDefinitions: [],
  } } };
  assert.equal(resolveChoicesByComponent(ddb).has(999), false);
});

/* ---------- regression: pools must stay separate ---------- */
// Caught on the first live run. Merchant's description prints "Ability Scores:
// Constitution, Intelligence, Charisma"; those are ABILITY-pool labels. Flattening
// every pool made them count as rivals to a SKILL choice, so suppression failed and
// Merchant restated proficiencies it had already listed.
test("labels from an UNRELATED pool are not rivals", () => {
  const merchant = "Ability Scores: Constitution, Intelligence, Charisma Feat: Lucky "
    + "Skill Proficiencies: Animal Handling and Persuasion Tool Proficiency: Navigator's Tools";
  const skillPool = ["Animal Handling", "Persuasion", "Navigator's Tools", "Arcana", "Stealth"];
  assert.equal(
    describesExactlyTheseChoices(merchant, ["Animal Handling", "Persuasion", "Navigator's Tools"], skillPool),
    true, "the ability-score line must not defeat suppression");
});

test("a rival from the SAME pool still defeats suppression", () => {
  const skillPool = ["Animal Handling", "Persuasion", "Arcana"];
  assert.equal(describesExactlyTheseChoices("Gain Animal Handling or Arcana.", ["Animal Handling"], skillPool), false);
});

/* ---------- fallback: options that are ENTITIES, not pool members ---------- */
// Versatile's "Choose an Origin feat" stores the chosen FEAT's own id, which is in
// no choiceDefinition pool — so pool resolution alone dropped it and the trait kept
// reading "You gain an Origin feat of your choice." with no answer. This is the
// T169 link, and it lives in ddb.character.feats.

const DDB_FEAT_CHOICE = {
  character: {
    feats: [
      { definitionId: 1789163, definition: { id: 1789163, name: "Magic Initiate (Cleric)" } },
      { definitionId: 1789160, definition: { id: 1789160, name: "Lucky" } },
    ],
    choices: {
      race: [{ componentId: 13856145, type: 6, label: "Choose an Origin feat", optionValue: 1789163 }],
      choiceDefinitions: [],
    },
  },
};

test("an option that names a FEAT resolves through the feats list", () => {
  const byComponent = resolveChoicesByComponent(DDB_FEAT_CHOICE);
  assert.deepEqual(byComponent.get(13856145), [
    { groupLabel: "Origin feat", label: "Magic Initiate (Cleric)", poolId: null },
  ]);
});

test("a feat-resolved choice carries no pool, so nothing counts as its rival", () => {
  const byComponent = resolveChoicesByComponent(DDB_FEAT_CHOICE);
  assert.equal(byComponent.get(13856145)![0]!.poolId, null);
  // "You gain an Origin feat of your choice." names nothing -> addendum wanted
  assert.equal(
    describesExactlyTheseChoices("You gain an Origin feat of your choice.", ["Magic Initiate (Cleric)"], []),
    false);
});

test("a pool match still wins over the feats list", () => {
  const ddb = {
    character: {
      feats: [{ definitionId: 6091, definition: { id: 6091, name: "NOT THIS" } }],
      choices: {
        class: [{ componentId: 1, type: 2, label: "Choose a Skill", optionValue: 6091 }],
        choiceDefinitions: [{ id: "x-2", options: [{ id: 6091, label: "Arcana" }] }],
      },
    },
  };
  assert.equal(resolveChoicesByComponent(ddb).get(1)![0]!.label, "Arcana");
});

test("an id in neither pools nor feats is still dropped", () => {
  const ddb = { character: { feats: [], choices: {
    race: [{ componentId: 5, type: 6, label: "Choose something", optionValue: 424242 }],
    choiceDefinitions: [],
  } } };
  assert.equal(resolveChoicesByComponent(ddb).has(5), false);
});

/* ---------- linking a chosen entity to its compendium entry ---------- */

test("a choice carrying a uuid renders as a UUID enricher, keeping the DDB label", () => {
  const html = choiceAddendumHtml([{
    groupLabel: "Origin feat", label: "Magic Initiate (Cleric)", poolId: null,
    uuid: "Compendium.dnd-players-handbook.feats.Item.phbftMagicInitia",
  }]);
  assert.match(html!, /@UUID\[Compendium\.dnd-players-handbook\.feats\.Item\.phbftMagicInitia\]\{Magic Initiate \(Cleric\)\}/);
});

test("a choice with no uuid stays plain text", () => {
  const html = choiceAddendumHtml([{ groupLabel: "Skill Expertise", label: "Arcana", poolId: "x" }]);
  assert.doesNotMatch(html!, /@UUID/);
  assert.match(html!, /Arcana/);
});

test("mixed picks in one group link only the ones that resolved", () => {
  const html = choiceAddendumHtml([
    { groupLabel: "Spell", label: "Shield", poolId: null, uuid: "Compendium.p.Item.a" },
    { groupLabel: "Spell", label: "Mystery Spell", poolId: null },
  ]);
  assert.match(html!, /@UUID\[Compendium\.p\.Item\.a\]\{Shield\}/);
  assert.match(html!, /Mystery Spell/);
  assert.equal((html!.match(/@UUID/g) ?? []).length, 1);
});

/* the name candidates a compendium lookup should try, in order */

test("tries the exact DDB name first, then the parenthetical stripped", () => {
  // DDB says "Magic Initiate (Cleric)"; the PHB pack only has "Magic Initiate",
  // because the suffix is DDB's record of the chosen spell list, not a separate feat.
  assert.deepEqual(compendiumLookupNames("Magic Initiate (Cleric)"), ["Magic Initiate (Cleric)", "Magic Initiate"]);
});

test("a name with no parenthetical yields just itself", () => {
  assert.deepEqual(compendiumLookupNames("Lucky"), ["Lucky"]);
});

test("only a TRAILING parenthetical is stripped", () => {
  assert.deepEqual(compendiumLookupNames("Weapon (Melee) Master"), ["Weapon (Melee) Master"]);
});

/* ---------- skills link to their rule page ---------- */

test("a skill label becomes a dnd5e Reference enricher", () => {
  assert.equal(skillReference("Arcana"), "&amp;Reference[arc]{Arcana}");
  assert.equal(skillReference("Sleight of Hand"), "&amp;Reference[slt]{Sleight of Hand}");
});

test("matching a skill name is case-insensitive but exact otherwise", () => {
  assert.equal(skillReference("arcana"), "&amp;Reference[arc]{arcana}");
  assert.equal(skillReference("Arcana Lore"), null);
  assert.equal(skillReference("Navigator's Tools"), null, "a tool is not a skill");
  assert.equal(skillReference("Intelligence"), null, "an ability is not a skill");
});

test("the addendum renders a skill as a reference, not plain text", () => {
  const html = choiceAddendumHtml([{ groupLabel: "Skill Expertise", label: "Arcana", poolId: "p" }]);
  assert.match(html!, /&amp;Reference\[arc\]\{Arcana\}/);
});

test("a compendium uuid still wins over a skill reference", () => {
  const html = choiceAddendumHtml([{
    groupLabel: "Spell", label: "Arcana", poolId: null, uuid: "Compendium.p.Item.a",
  }]);
  assert.match(html!, /@UUID/);
  assert.doesNotMatch(html!, /Reference\[/);
});

/* ---------- the group label reads "<label> chosen:" ---------- */

test("the group label says what was chosen", () => {
  const html = choiceAddendumHtml([{ groupLabel: "Skill Expertise", label: "Arcana", poolId: "p" }]);
  assert.match(html!, /Skill Expertise chosen:/);
});

test("an unlabelled choice stays a bare Chosen, never 'Chosen chosen'", () => {
  const html = choiceAddendumHtml([{ groupLabel: null, label: "Intelligence", poolId: "p" }]);
  assert.match(html!, /<em>Chosen:/);
  assert.doesNotMatch(html!, /Chosen chosen/i);
});
