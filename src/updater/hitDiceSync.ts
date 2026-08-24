/**
 * Deciding which classes have spent hit dice since D&D Beyond last saw them.
 *
 * Pure: no Foundry or D&D Beyond APIs.
 *
 * ⚠️ Exists because the old inline comparison read `system.hitDiceUsed`, a property
 * that exists on NEITHER side under dnd5e 5.x — spent dice live at `system.hd.spent`.
 * `undefined !== undefined` is false, so the diff never found a change and hit dice
 * never synced, silently. Verified live 2026-08-24 (Foundry spent 1, DDB 0, no call).
 */

export interface ClassHitDice {
  /** flags.ddbimporter.id — DDB's class id, the key the write route expects. */
  ddbId: number | null;
  /** system.hd.spent */
  spent: number | undefined;
}

export function diffHitDice(
  foundryClasses: ClassHitDice[],
  ddbClasses: ClassHitDice[],
): Record<number, number> {
  const out: Record<number, number> = {};

  for (const klass of foundryClasses) {
    if (klass.ddbId === null || klass.ddbId === undefined) continue;

    const match = ddbClasses.find((c) => c.ddbId === klass.ddbId);
    if (!match) continue;

    const mine = Number(klass.spent);
    const theirs = Number(match.spent);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs)) continue;
    if (mine === theirs) continue;

    out[klass.ddbId] = mine;
  }

  return out;
}
