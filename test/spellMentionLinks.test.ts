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

// Elven lineage table (Warpey/Nahuel, 2026-09-05): "<em>Dancing Lights</em> cantrip"
// and bare "<td><em>Faerie Fire</em></td>" cells never linked — only " spell" did.
const LINEAGE_INDEX = [
  { name: "Dancing Lights", uuid: "Compendium.world.ddb-spells.Item.DancingLights24I" },
  { name: "Faerie Fire", uuid: "Compendium.world.ddb-spells.Item.FaerieFire24IIII" },
  { name: "Pass without Trace", uuid: "Compendium.world.ddb-spells.Item.PassWithoutTr24" },
];
const resolveLineage = (name: string) => findByNormalisedName(LINEAGE_INDEX, name)?.uuid ?? null;

test("links an <em> name followed by 'cantrip'", () => {
  const text = "You also know the <em>Dancing Lights</em> cantrip.";
  assert.equal(
    linkCompendiumMentions(text, "spell", resolveLineage),
    "You also know the @UUID[Compendium.world.ddb-spells.Item.DancingLights24I]{Dancing Lights} cantrip.",
  );
});

test("links a bare <em> spell name in a table cell, including a multi-word one", () => {
  const text = "<td><em>Faerie Fire</em></td><td><em>Pass without Trace</em></td>";
  assert.equal(
    linkCompendiumMentions(text, "spell", resolveLineage),
    "<td>@UUID[Compendium.world.ddb-spells.Item.FaerieFire24IIII]{Faerie Fire}</td><td>@UUID[Compendium.world.ddb-spells.Item.PassWithoutTr24]{Pass without Trace}</td>",
  );
});

test("a bare <em> that is not a spell (a book title, a creature) is left exactly as it was", () => {
  const text = "See the <em>Player’s Handbook</em>. A <em>Darkmantle</em> attacks.";
  assert.equal(linkCompendiumMentions(text, "spell", resolveLineage), text);
});

test("a bare <strong> is NOT treated as a spell mention — only <em> carries DDB's convention", () => {
  const text = "<strong>Faerie Fire</strong>";
  assert.equal(linkCompendiumMentions(text, "spell", resolveLineage), text);
});

test("the postfix form is not linked twice when the bare pattern runs after it", () => {
  const text = "the <em>Faerie Fire</em> spell";
  const out = linkCompendiumMentions(text, "spell", resolveLineage);
  assert.equal((out.match(/@UUID/g) ?? []).length, 1);
  assert.match(out, /\{Faerie Fire\} spell$/);
});
