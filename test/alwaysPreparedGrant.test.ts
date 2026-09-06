import test from "node:test";
import assert from "node:assert";

import { parseAlwaysPreparedGrant } from "../src/parser/advancements/alwaysPreparedGrant.ts";

test("names the spell a 2024 feature grants, despite the 'In addition' phrasing", () => {
  // Victus's real Paladin's Smite text. The old regex required the 2014 follow-on
  // sentence, missed, and fell through to capturing the pronoun "it".
  const desc = "You always have the Divine Smite spell prepared. In addition, you can cast it "
    + "without expending a spell slot, but you must finish a Long Rest before you can cast it in this way again.";

  assert.equal(parseAlwaysPreparedGrant(desc), "divine smite");
});

test("still handles the 2014 phrasing the old regex was written for", () => {
  const desc = "You always have the Otto’s Irresistible Dance spell prepared. You can cast it once "
    + "without a spell slot, and you regain the ability to do so when you finish a Long Rest.";

  assert.equal(parseAlwaysPreparedGrant(desc), "otto’s irresistible dance");
});

test("handles the 2024 Ranger wording too", () => {
  const desc = "You always have the Hunter's Mark spell prepared. In addition, you can cast it without "
    + "expending a spell slot a number of times equal to your Wisdom modifier.";

  assert.equal(parseAlwaysPreparedGrant(desc), "hunter's mark");
});

test("never returns a pronoun as a spell name", () => {
  // The failure this exists to prevent: a grant named "it" resolves to no
  // compendium spell, so no Cast activity is built and the raw spell is pushed
  // as a duplicate innate row instead.
  assert.equal(parseAlwaysPreparedGrant("You can cast it without expending a spell slot."), null);
  assert.equal(parseAlwaysPreparedGrant("you can cast that spell without using a spell slot."), null);
});

test("still reads a spell named only in the free-cast sentence", () => {
  const desc = "You gain the ability to cast the barkskin spell without expending a spell slot.";

  assert.equal(parseAlwaysPreparedGrant(desc), "barkskin");
});

test("returns null for a description that grants nothing", () => {
  assert.equal(parseAlwaysPreparedGrant("You gain proficiency with martial weapons."), null);
  assert.equal(parseAlwaysPreparedGrant(""), null);
  assert.equal(parseAlwaysPreparedGrant(undefined as unknown as string), null);
});

test("collapses whitespace so a line-wrapped description still matches", () => {
  const desc = "You always have the   Divine   Smite spell prepared.";

  assert.equal(parseAlwaysPreparedGrant(desc), "divine smite");
});

test("reads through an @UUID enricher link — the linker runs before the grant parser", () => {
  const desc = "You always have the @UUID[Compendium.world.ddb-spells.Item.HuntersMark14III]{Hunter’s Mark} spell prepared. "
    + "You can cast it twice without expending a spell slot.";

  assert.equal(parseAlwaysPreparedGrant(desc), "hunter’s mark");
});

// --- upstream 7.1.22 wording, folded into the helper for the T228 merge ---
import { parseAlwaysPreparedGrants } from "../src/parser/advancements/alwaysPreparedGrant.ts";

test("reads the level a grant arrives at from the 'When you reach Nth level' prefix", () => {
  const desc = "When you reach 3rd level, you always have the Misty Step spell prepared. "
    + "You can cast it once without a spell slot.";

  assert.deepEqual(parseAlwaysPreparedGrants(desc), { level: 3, spells: ["misty step"] });
});

test("splits a PLURAL grant into its spells", () => {
  const desc = "You always have the Bless and Cure Wounds spells prepared. You can cast each spell once without a spell slot.";

  assert.deepEqual(parseAlwaysPreparedGrants(desc), { level: 1, spells: ["bless", "cure wounds"] });
  assert.deepEqual(
    parseAlwaysPreparedGrants("You always have the Faerie Fire, Darkness, and Dancing Lights spells prepared."),
    { level: 1, spells: ["faerie fire", "darkness", "dancing lights"] },
  );
});

test("does NOT split a singular grant whose name contains 'and'", () => {
  const desc = "You always have the Protection from Evil and Good spell prepared.";

  assert.deepEqual(parseAlwaysPreparedGrants(desc), { level: 1, spells: ["protection from evil and good"] });
});

test("the single-spell wrapper still answers the first spell", () => {
  assert.equal(parseAlwaysPreparedGrant("You always have the Bless and Cure Wounds spells prepared."), "bless");
});
