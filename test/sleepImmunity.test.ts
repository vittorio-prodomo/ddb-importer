import test from "node:test";
import assert from "node:assert";
import {
  declaresSleepImmunity, sleepImmunityEffect, hasSleepImmunityEffect, SLEEP_IMMUNITY_FEATURES,
} from "../src/parser/character/special/sleepImmunity.ts";

const feat = (name: string, text: string) => ({ name, type: "feat", system: { description: { value: text } } });
const CLAUSE = "You don't need to sleep, and magic can’t put you to sleep.";

test("recognises the clause on each feature that can carry it", () => {
  for (const name of SLEEP_IMMUNITY_FEATURES) {
    assert.equal(declaresSleepImmunity(feat(name, CLAUSE)), true, name);
  }
});

test("⚠️ accepts a STRAIGHT apostrophe too — DDB writes U+2019, our data is not always normalised", () => {
  assert.equal(declaresSleepImmunity(feat("Trance", "magic can't put you to sleep")), true);
});

test("a feature without the clause does not declare immunity", () => {
  // 2024 Fey Ancestry is about being Charmed, not sleep — it must not match on its name alone.
  assert.equal(declaresSleepImmunity(feat("Fey Ancestry", "You have advantage on saves to avoid the Charmed condition.")), false);
});

test("an unrelated feature carrying the words does not match", () => {
  assert.equal(declaresSleepImmunity(feat("Some Homebrew", CLAUSE)), false);
});

test("only feat-typed documents match", () => {
  assert.equal(declaresSleepImmunity({ ...feat("Trance", CLAUSE), type: "race" }), false);
});

test("handles missing and malformed input", () => {
  assert.equal(declaresSleepImmunity(null), false);
  assert.equal(declaresSleepImmunity(undefined), false);
  assert.equal(declaresSleepImmunity({}), false);
  assert.equal(declaresSleepImmunity(feat("Trance", "")), false);
});

test("the effect transfers and appends with its own separator", () => {
  const e = sleepImmunityEffect("Trance") as any;
  assert.equal(e.transfer, true);
  assert.equal(e.changes.length, 1);
  assert.equal(e.changes[0].key, "system.traits.ci.custom");
  assert.equal(e.changes[0].mode, 2);
  // ⚠️ Leading ";" is load-bearing: ADD concatenates, so without it a second
  // immunity would fuse into the previous word.
  assert.equal(e.changes[0].value, ";Sleep");
});

test("the effect is named for its feature and nothing else", () => {
  // VAE renders the name as the icon's label, and every sibling effect on these
  // sheets is named for its item ("Fey Ancestry", "Elven: Drow Lineage").
  assert.equal((sleepImmunityEffect("Trance") as any).name, "Trance");
  assert.equal((sleepImmunityEffect("Fey Ancestry") as any).name, "Fey Ancestry");
});

test("what it does lives in the description, in rulebook language", () => {
  const e = sleepImmunityEffect("Trance") as any;
  assert.match(e.description, /magic can't put you to sleep/i);
  // No Foundry-mechanics explainer in player-facing text.
  assert.doesNotMatch(e.description, /immunit|traits|effect|active/i);
});

test("idempotence: an already-stamped feature is recognised", () => {
  const e = sleepImmunityEffect("Trance");
  assert.equal(hasSleepImmunityEffect({ effects: [e] }), true);
  assert.equal(hasSleepImmunityEffect({ effects: [] }), false);
  assert.equal(hasSleepImmunityEffect({}), false);
  assert.equal(hasSleepImmunityEffect(null), false);
});

test("an unrelated effect on the feature does not count as stamped", () => {
  assert.equal(hasSleepImmunityEffect({ effects: [{ name: "Fey Ancestry", changes: [] }] }), false);
});
