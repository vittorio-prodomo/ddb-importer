import test from "node:test";
import assert from "node:assert";

import { hasStrayRound, healItemEffectDurations } from "../src/parser/lib/effectDurations.ts";

test("the official Jump shape — 60 seconds beside 1 round — is a stray round", () => {
  assert.equal(hasStrayRound({ seconds: 60, rounds: 1, turns: null }), true);
});

test("Hex (3600 s) and Animal Friendship (86400 s) beside 1 round are stray too", () => {
  assert.equal(hasStrayRound({ seconds: 3600, rounds: 1 }), true);
  assert.equal(hasStrayRound({ seconds: 86400, rounds: 1 }), true);
});

test("a consistent pair is left alone (60 s = 10 rounds)", () => {
  assert.equal(hasStrayRound({ seconds: 60, rounds: 10 }), false);
});

test("a rounds-only or seconds-only duration is not touched", () => {
  assert.equal(hasStrayRound({ seconds: null, rounds: 1 }), false);
  assert.equal(hasStrayRound({ seconds: 60, rounds: null }), false);
  assert.equal(hasStrayRound({ seconds: 60 }), false);
  assert.equal(hasStrayRound(undefined), false);
});

test("healing nulls the round and keeps the seconds; unrelated effects untouched", () => {
  const item = {
    effects: [
      { name: "Jump", duration: { seconds: 60, rounds: 1, turns: null } },
      { name: "Bless", duration: { seconds: 60, rounds: 10, turns: null } },
      { name: "Marker", duration: { seconds: null, rounds: null, turns: null } },
    ],
  };
  assert.equal(healItemEffectDurations(item), 1);
  assert.deepEqual(item.effects[0].duration, { seconds: 60, rounds: null, turns: null });
  assert.deepEqual(item.effects[1].duration, { seconds: 60, rounds: 10, turns: null });
  assert.equal(healItemEffectDurations(item), 0, "idempotent");
});

test("an item without effects is a no-op", () => {
  assert.equal(healItemEffectDurations({}), 0);
  assert.equal(healItemEffectDurations(null), 0);
});

test("a spell whose own duration is in rounds (2014 Command) is left alone — the round IS the truth", () => {
  const item = { system: { duration: { units: "round", value: 1 } }, effects: [{ duration: { seconds: 60, rounds: 1 } }] };
  assert.equal(healItemEffectDurations(item), 0);
  assert.equal(item.effects[0].duration.rounds, 1);
});

test("a minute-duration spell is healed; an item with no duration data still is (the shape alone decides)", () => {
  const minute = { system: { duration: { units: "minute", value: 1 } }, effects: [{ duration: { seconds: 60, rounds: 1 } }] };
  assert.equal(healItemEffectDurations(minute), 1);
  const bare = { effects: [{ duration: { seconds: 60, rounds: 1 } }] };
  assert.equal(healItemEffectDurations(bare), 1);
});
