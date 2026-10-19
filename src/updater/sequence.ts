/**
 * Run async tasks one after another, in order.
 *
 * ⚠️ D&D Beyond can LOSE simultaneous writes to one character: it answered "success" to three
 * equipment writes sent together and applied only two (Warpey's Shortsword, Xender's Shield,
 * 2026-10-19). A character's equipment writes therefore go out one at a time.
 *
 * Every task runs even when an earlier one fails — as with the `Promise.all` this replaces,
 * whose calls had all gone out — and the first error is thrown once they have all run.
 */
export async function runInSequence<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  let firstError: unknown = null;
  let failed = false;
  for (const task of tasks) {
    try {
      results.push(await task());
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) throw firstError;
  return results;
}
