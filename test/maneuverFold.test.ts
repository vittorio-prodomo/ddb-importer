import test from "node:test";
import assert from "node:assert";
import { bareManeuverName, foldManeuversIntoParent, foldedId } from "../src/parser/features/maneuverFold.ts";

const ADD = "<p><em>Level 3 Options chosen: <strong>@UUID[Compendium.x.Item.a]{Riposte}, @UUID[Compendium.x.Item.b]{Goading Attack}</strong></em></p>";
const parent = () => ({
  name: "Maneuver Options", type: "feat", img: "feature.svg",
  system: { type: { value: "class", subtype: "maneuver" }, description: { value: `<div class="ddb">\n<p>The maneuvers are presented here in alphabetical order.</p>${ADD}\n</div>`, chat: "" }, activities: {} },
  effects: [],
  flags: { ddbimporter: { id: 10292571, is2014: false, originalName: "Maneuver Options" } },
});
const child = (label: string, over: Record<string, any> = {}) => ({
  name: `Maneuver: ${label}`, type: "feat", img: `${label}.webp`,
  system: {
    type: { value: "class", subtype: "maneuver" },
    description: { value: `<div class="ddb">\n<p>${label} text.</p>${ADD}\n</div>`, chat: "" },
    activities: { dnd5eactivity000: { _id: "dnd5eactivity000", type: "utility", name: "Use", effects: [] } },
  },
  effects: [],
  flags: { ddbimporter: { id: 10292571, is2014: false, originalName: `Maneuver Options: ${label}`, initialFeature: { value: `<p>${label} text.</p>` }, dndbeyond: { choice: { parentName: "Maneuver Options", label } } } },
  ...over,
});
const other = { name: "Second Wind", type: "feat", system: { type: { value: "class", subtype: "" }, activities: {} }, effects: [], flags: { ddbimporter: {} } };

test("bareManeuverName: the DDB choice label first, then the name prefixes, suffix stripped", () => {
  assert.equal(bareManeuverName(child("Riposte")), "Riposte");
  assert.equal(bareManeuverName(child("Parry (Str.)")), "Parry");
  assert.equal(bareManeuverName({ name: "Maneuver: Trip Attack", type: "feat", system: { type: { subtype: "maneuver" } } }), "Trip Attack");
  assert.equal(bareManeuverName(other), null);
  assert.equal(bareManeuverName(parent()), null, "the parent is not a child of itself");
});

test("fold: the children become activities of the parent, bare-named, and are removed", () => {
  const items = [other, child("Riposte"), parent(), child("Goading Attack")];
  const out = foldManeuversIntoParent(items);
  assert.deepEqual(out.map((i) => i.name), ["Second Wind", "Maneuver Options"]);
  const folded = out[1] as any;
  const activities = Object.values(folded.system.activities) as any[];
  assert.deepEqual(activities.map((a) => a.name), ["Goading Attack", "Riposte"], "alphabetical");
  assert.equal(new Set(activities.map((a) => a._id)).size, 2, "the shared dnd5eactivity000 id was re-issued per maneuver");
  assert.ok(activities.every((a) => a._id.length === 16 && Object.keys(folded.system.activities).includes(a._id)));
  assert.equal(activities[1].img, "Riposte.webp", "each activity carries its maneuver's icon");
  assert.deepEqual(folded.flags.ddbimporter.chosenManeuvers, ["Goading Attack", "Riposte"]);
});

test("fold: the description lists only the chosen maneuvers, the addendum ONCE", () => {
  const folded = foldManeuversIntoParent([parent(), child("Riposte"), child("Goading Attack")])[0] as any;
  const html = folded.system.description.value as string;
  assert.ok(html.includes("<h3>Goading Attack</h3><p>Goading Attack text.</p><h3>Riposte</h3><p>Riposte text.</p>"));
  assert.ok(!html.includes("alphabetical order"), "the PHB sidebar is gone");
  assert.equal(html.split("Options chosen").length - 1, 1, "one addendum");
  assert.ok(!html.includes('class="ddb"'), "unwrapped — the importer wraps every description after the fold");
});

test("fold: effects move with their maneuver; a colliding effect id is re-issued and the activity follows it", () => {
  const a = child("Menacing Attack", { effects: [{ _id: "sameEffectId0000", name: "Frightened" }] });
  (a.system.activities.dnd5eactivity000 as any).effects = [{ _id: "sameEffectId0000" }];
  const b = child("Trip Attack", { effects: [{ _id: "sameEffectId0000", name: "Tripped" }] });
  (b.system.activities.dnd5eactivity000 as any).effects = [{ _id: "sameEffectId0000" }];
  const folded = foldManeuversIntoParent([parent(), a, b])[0] as any;
  assert.equal(folded.effects.length, 2);
  assert.equal(new Set(folded.effects.map((e: any) => e._id)).size, 2);
  for (const activity of Object.values(folded.system.activities) as any[]) {
    const effect = folded.effects.find((e: any) => e._id === activity.effects[0]._id);
    assert.ok(effect, `${activity.name} still points at an effect`);
    assert.equal(effect.name, activity.name === "Menacing Attack" ? "Frightened" : "Tripped");
  }
});

test("fold: nothing to do returns the SAME array — no parent, no children, or a 2014 parent", () => {
  const noParent = [other, child("Riposte")];
  assert.equal(foldManeuversIntoParent(noParent), noParent);
  const noChildren = [other, parent()];
  assert.equal(foldManeuversIntoParent(noChildren), noChildren);
  const legacy = parent(); legacy.flags.ddbimporter.is2014 = true;
  const legacyItems = [legacy, child("Riposte")];
  assert.equal(foldManeuversIntoParent(legacyItems), legacyItems);
});

test("fold: never mutates its input, and is deterministic across runs (stable activity ids on re-import)", () => {
  const items = [parent(), child("Riposte"), child("Goading Attack")];
  const snapshot = JSON.stringify(items);
  const first = foldManeuversIntoParent(items);
  assert.equal(JSON.stringify(items), snapshot);
  assert.deepEqual(foldManeuversIntoParent(items), first);
});

test("foldedId: 16 characters, unique against what is taken", () => {
  const taken = new Set<string>();
  const a = foldedId("mf", "Riposte", taken);
  const b = foldedId("mf", "Riposte", taken);
  assert.equal(a.length, 16);
  assert.equal(b.length, 16);
  assert.notEqual(a, b);
});

test("fold: each maneuver's icon is stamped for the premade; a placeholder is not an icon", () => {
  const plain = child("Riposte");
  const placeholder = child("Goading Attack", { img: "systems/dnd5e/icons/svg/items/feature.svg" });
  const folded = foldManeuversIntoParent([parent(), plain, placeholder])[0] as any;
  assert.deepEqual(folded.flags.ddbimporter.maneuverIcons, { Riposte: "Riposte.webp" });
});
