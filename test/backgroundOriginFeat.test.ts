import test from "node:test";
import assert from "node:assert";
import {
  linkifyOriginFeat,
  stripDanglingFeatHeader,
} from "../src/parser/character/special/grantedChoices.ts";

/* ---------- the T215 shape ---------- */
// A 2024 background's DDB data names its origin feat in `featureName` but leaves
// `featureDescription` empty (the feat is its own item), so the imported
// description ended in a header-sized feat name with nothing under it. The fix is
// two pure transforms: drop that dangling trailer, and turn the "Feat: X" summary
// line into a link to the feat's compendium entry.

const HERMIT_TAIL = "<div class=\"ddb\">\n<h1>Background: Hermit</h1><p></p>"
  + "<p><strong>Ability Scores:</strong> Constitution, Wisdom, Charisma<br />"
  + "<strong>Feat:</strong> Healer<br />"
  + "<strong>Skill Proficiencies:</strong> Medicine and Religion</p>"
  + "<p>You spent your early years secluded.</p><p></p><h2>Healer</h2>\n</div>";

test("the dangling trailing header is removed, closing markup kept", () => {
  const result = stripDanglingFeatHeader(HERMIT_TAIL, "Healer");
  assert.ok(!result.includes("<h2>Healer</h2>"));
  assert.ok(result.trimEnd().endsWith("</div>"));
  assert.ok(result.includes("You spent your early years secluded.</p>"));
});

test("the empty <p></p> spacer DDB leaves before the trailer goes with it", () => {
  const result = stripDanglingFeatHeader(HERMIT_TAIL, "Healer");
  assert.ok(!result.includes("secluded.</p><p></p>"));
});

test("a 2014-style header WITH a body after it is not a trailer and stays", () => {
  const legacy = "<p>intro</p><h2>Discovery</h2><p>The quiet seclusion of your "
    + "extended hermitage gave you access to a unique and powerful discovery.</p>";
  assert.equal(stripDanglingFeatHeader(legacy, "Discovery"), legacy);
});

test("a feat name carrying regex metacharacters strips cleanly", () => {
  const sage = "<p>text</p><p></p><h2>Magic Initiate (Wizard)</h2>\n</div>";
  const result = stripDanglingFeatHeader(sage, "Magic Initiate (Wizard)");
  assert.ok(!result.includes("<h2>"));
});

test("no trailer, no change", () => {
  const clean = "<p>text</p>\n</div>";
  assert.equal(stripDanglingFeatHeader(clean, "Healer"), clean);
});

/* ---------- the summary-line link ---------- */

test("the 'Feat:' summary line gains a compendium link with the DDB label kept", () => {
  const result = linkifyOriginFeat(HERMIT_TAIL, "Healer", "Compendium.dnd-players-handbook.feats.Item.abc123");
  assert.ok(result.includes("<strong>Feat:</strong> @UUID[Compendium.dnd-players-handbook.feats.Item.abc123]{Healer}<br />"));
});

test("only the summary line is linked, not later mentions of the name", () => {
  const result = linkifyOriginFeat(HERMIT_TAIL, "Healer", "Compendium.x.y.Item.abc123");
  assert.equal(result.match(/@UUID\[/g)?.length, 1);
  assert.ok(result.includes("<h2>Healer</h2>"), "the trailer is stripDanglingFeatHeader's job, not this one's");
});

test("linkify is idempotent: a second pass changes nothing", () => {
  const once = linkifyOriginFeat(HERMIT_TAIL, "Healer", "Compendium.x.y.Item.abc123");
  assert.equal(linkifyOriginFeat(once, "Healer", "Compendium.x.y.Item.abc123"), once);
});

test("a parenthesised feat name links whole", () => {
  const sage = "<p><strong>Feat:</strong> Magic Initiate (Wizard)<br /></p>";
  const result = linkifyOriginFeat(sage, "Magic Initiate (Wizard)", "Compendium.x.y.Item.z");
  assert.ok(result.includes("@UUID[Compendium.x.y.Item.z]{Magic Initiate (Wizard)}"));
});

test("a description without the summary line is untouched", () => {
  const other = "<p>no feat line here</p>";
  assert.equal(linkifyOriginFeat(other, "Healer", "Compendium.x.y.Item.z"), other);
});
