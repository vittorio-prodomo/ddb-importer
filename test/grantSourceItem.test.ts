import test from "node:test";
import assert from "node:assert";
import { featureNameCandidates, grantingFeatureName, sourceItemKey } from "../src/parser/spells/grantSourceItem.ts";

/* Which feature granted this row? */

test("the dual-pool stamp names the feature", () => {
  assert.equal(grantingFeatureName({ ddbimporter: { dualPoolGrant: { feature: "Favored Enemy" } } }), "Favored Enemy");
});

test("a cantrip grant falls back to the DDB lookup name", () => {
  assert.equal(
    grantingFeatureName({ ddbimporter: { dndbeyond: { lookupName: "Magic Initiate (Cleric)" } } }),
    "Magic Initiate (Cleric)");
});

test("the stamp wins over the lookup name", () => {
  assert.equal(grantingFeatureName({
    ddbimporter: { dualPoolGrant: { feature: "Elven Lineage" }, dndbeyond: { lookupName: "Something Else" } },
  }), "Elven Lineage");
});

test('"generic" is not a feature name', () => {
  assert.equal(grantingFeatureName({ ddbimporter: { dndbeyond: { lookupName: "generic" } } }), null);
  assert.equal(grantingFeatureName({ ddbimporter: { dndbeyond: { lookupName: "" } } }), null);
});

test("an ordinary class-list row names nothing", () => {
  assert.equal(grantingFeatureName({ ddbimporter: { dndbeyond: { lookup: "classSpell" } } }), null);
  assert.equal(grantingFeatureName({}), null);
  assert.equal(grantingFeatureName(null), null);
});

/* The sourceItem key the sheet resolves against */

test("builds <type>:<identifier>", () => {
  assert.equal(sourceItemKey({ type: "feat", identifier: "favored-enemy" }), "feat:favored-enemy");
});

test("⚠️ uses the item's real identifier, never a slug of its NAME", () => {
  // "Elven: Wood Elf Lineage" carries the identifier `elven-lineage`; slugifying
  // the display name would give `elven-wood-elf-lineage`, which resolves to nothing
  // and leaves the subtitle silently unchanged.
  assert.equal(
    sourceItemKey({ type: "feat", identifier: "elven-lineage", name: "Elven: Wood Elf Lineage" }),
    "feat:elven-lineage");
});

test("no identifier means no key — better unchanged than pointing nowhere", () => {
  assert.equal(sourceItemKey({ type: "feat", identifier: "" }), null);
  assert.equal(sourceItemKey({ type: "feat" }), null);
  assert.equal(sourceItemKey(null), null);
});

/* DDB's spell-list container naming */

test('a "<Feature> Spells" container also offers the bare feature name', () => {
  // Warpey's Druidcraft records lookupName "Elven Lineage Spells" — DDB's name for
  // the granted spell LIST, not the trait. The feat's originalName is "Elven Lineage".
  // ⚠️ lookupId is no help here: it points at the list entity (13856114), not the
  // trait (13856110), so the id match finds nothing.
  assert.deepEqual(featureNameCandidates("Elven Lineage Spells"), ["Elven Lineage Spells", "Elven Lineage"]);
});

test("a name that does not end in Spells yields just itself", () => {
  assert.deepEqual(featureNameCandidates("Magic Initiate (Cleric)"), ["Magic Initiate (Cleric)"]);
  assert.deepEqual(featureNameCandidates("Favored Enemy"), ["Favored Enemy"]);
});

test("only a TRAILING Spells is stripped, and never to nothing", () => {
  assert.deepEqual(featureNameCandidates("Spells of Power"), ["Spells of Power"]);
  assert.deepEqual(featureNameCandidates("Spells"), ["Spells"]);
});
