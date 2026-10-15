// Every sync category is gated by a `sync-policy-*` checkbox. Three of those gates read
// `if (!setting) resolve({});` with no `return`: the promise settled empty and the function carried on
// and sent the category anyway, so unticking Currency or Conditions/Exhaustion changed nothing — and the
// answer of the call that did go out was dropped, so it could not even be seen in the results.
// The updater needs Foundry globals to run, so this pins the shape in the source instead.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/updater/character.ts", import.meta.url), "utf8");
const lines = source.split("\n").map((text, i) => ({ text, n: i + 1 }));
const guards = lines.filter(({ text }) => /^\s*if \(!game\.settings\.get\(SETTINGS\.MODULE_ID, "sync-policy-[a-z-]+"\)\)/.test(text));

test("there are sync-policy guards to check", () => {
  assert.ok(guards.length >= 14, `found ${guards.length}`);
});

test("a switched-off sync category leaves the function, it does not merely settle the promise", () => {
  const fallThrough = guards.filter(({ text }) => !/"\)\) return\b/.test(text));
  assert.deepEqual(fallThrough.map(({ n, text }) => `${n}: ${text.trim()}`), []);
});

// An inert granting feature has `uses.max: ""`; Number("") is 0, so without a `max > 0` test it counted
// as "0 used" and fought the spell that really holds the pool for the same D&D Beyond action (2026-10-15,
// Warpey's Hunter's Mark would have been reset to 0 used). The updater needs Foundry, so pin the shape.
test("the action-use pass only counts a pool whose max is above zero", () => {
  const body = source.slice(source.indexOf("async function actionUseStatus"), source.indexOf("\n}\n", source.indexOf("async function actionUseStatus")));
  assert.match(body, /Number\.isFinite\(max\) && max > 0 &&/);
});
