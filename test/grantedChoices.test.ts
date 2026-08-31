import test from "node:test";
import assert from "node:assert";
import {
  describesExactlyTheseChoices,
  choiceAddendumHtml,
  resolveChoicesByComponent,
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
