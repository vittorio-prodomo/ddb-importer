import test from "node:test";
import assert from "node:assert";

import { runInSequence } from "../src/updater/sequence.ts";

// D&D Beyond answered "success" to three simultaneous equipment writes on one character and
// applied only two of them (Warpey's Shortsword, Xender's Shield, 2026-10-19). The sync now
// sends a character's equipment writes one after another.

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("each task starts only after the previous one has finished", async () => {
  const log: string[] = [];
  const task = (n: number, ms: number) => async () => {
    log.push(`start:${n}`);
    await wait(ms);
    log.push(`end:${n}`);
    return n;
  };
  await runInSequence([task(0, 20), task(1, 5), task(2, 10)]);
  assert.deepStrictEqual(log, ["start:0", "end:0", "start:1", "end:1", "start:2", "end:2"]);
});

test("results come back in task order", async () => {
  const results = await runInSequence([async () => 1, async () => 2, async () => 3]);
  assert.deepStrictEqual(results, [1, 2, 3]);
});

test("a failing task does not stop the ones after it, and its error is thrown at the end", async () => {
  let thirdRan = false;
  await assert.rejects(
    runInSequence([
      async () => 1,
      async () => {
        throw new Error("boom");
      },
      async () => {
        thirdRan = true;
        return 3;
      },
    ]),
    /boom/,
  );
  assert.strictEqual(thirdRan, true);
});

test("no tasks gives an empty array", async () => {
  assert.deepStrictEqual(await runInSequence([]), []);
});
