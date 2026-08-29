import test from "node:test";
import assert from "node:assert";

import { findByNormalisedName, linkCompendiumMentions } from "../src/parser/lib/spellMentionLinks.ts";

const HM = "Compendium.world.ddb-spells.Item.HuntersMark24III";
const INDEX = [
  { name: "Hunter's Mark", uuid: HM }, // normalised straight apostrophe, as the munched pack stores it
  { name: "Fireball", uuid: "Compendium.world.ddb-spells.Item.Fireball24IIIII" },
  { name: "Cone of Cold", uuid: "Compendium.world.ddb-spells.Item.ConeOfCold24III" },
];
const resolve = (name: string) => findByNormalisedName(INDEX, name)?.uuid ?? null;

test("links a possessive spell name wrapped in <em> across the apostrophe boundary", () => {
  // Warpey's real Favored Enemy text: <em>, typographic apostrophe. All three
  // old failure modes at once.
  const text = "<p>You always have the <em>Hunter’s Mark</em> spell prepared.</p>";

  assert.equal(
    linkCompendiumMentions(text, "spell", resolve),
    `<p>You always have the @UUID[${HM}]{Hunter’s Mark} spell prepared.</p>`,
  );
});

test("still links the plain <strong> case the old regex handled", () => {
  const text = "casts the <strong>Fireball</strong> spell at 3rd level";

  assert.match(linkCompendiumMentions(text, "spell", resolve), /@UUID\[.*Fireball.*\]\{Fireball\} spell/);
});

test("links the charge form", () => {
  const text = "<strong>cone of cold</strong> (5 charges)";

  assert.match(linkCompendiumMentions(text, "spell", resolve), /@UUID\[.*ConeOfCold.*\]\{cone of cold\} \(5 charge/);
});

test("a straight-apostrophe mention resolves against a typographic index too", () => {
  // The official compendiums store the TYPOGRAPHIC form — the boundary runs both ways.
  const officialIndex = [{ name: "Hunter’s Mark", uuid: "Compendium.phb.spells.Item.abc" }];

  assert.equal(findByNormalisedName(officialIndex, "Hunter's Mark")?.uuid, "Compendium.phb.spells.Item.abc");
});

test("an unresolvable mention is left exactly as it was", () => {
  const text = "<p>the <em>Made-Up Spell</em> spell</p>";

  assert.equal(linkCompendiumMentions(text, "spell", resolve), text);
});

test("mismatched wrapper tags do not pair up", () => {
  // <em>...</strong> must not be treated as one mention.
  const text = "<em>Hunter’s Mark</strong> spell";

  assert.equal(linkCompendiumMentions(text, "spell", resolve), text);
});

test("item mentions keep their own postfix word", () => {
  const itemIndex = [{ name: "Daern's Instant Fortress", uuid: "Compendium.world.ddb-items.Item.Fortress0000000" }];
  const text = "the <strong>Daern’s Instant Fortress</strong> item";

  assert.match(
    linkCompendiumMentions(text, "item", (n) => findByNormalisedName(itemIndex, n)?.uuid ?? null),
    /@UUID\[.*Fortress.*\]\{Daern’s Instant Fortress\} item/,
  );
});

test("prefers the wanted edition among same-named entries", () => {
  const both = [
    { name: "Hunter's Mark", uuid: "…14III", system: { source: { rules: "2014" } } },
    { name: "Hunter's Mark", uuid: "…24III", system: { source: { rules: "2024" } } },
  ];

  assert.equal(findByNormalisedName(both, "Hunter’s Mark", { preferRules: "2024" })?.uuid, "…24III");
  assert.equal(findByNormalisedName(both, "Hunter’s Mark", { preferRules: "2014" })?.uuid, "…14III");
});

test("falls back to the first match when no entry declares the wanted edition", () => {
  const only2014 = [{ name: "Hunter's Mark", uuid: "…14III", system: { source: { rules: "2014" } } }];

  assert.equal(findByNormalisedName(only2014, "Hunter's Mark", { preferRules: "2024" })?.uuid, "…14III");
});

test("no preference keeps the old first-match behaviour", () => {
  const both = [
    { name: "Hunter's Mark", uuid: "…14III", system: { source: { rules: "2014" } } },
    { name: "Hunter's Mark", uuid: "…24III", system: { source: { rules: "2024" } } },
  ];

  assert.equal(findByNormalisedName(both, "Hunter's Mark")?.uuid, "…14III");
});
