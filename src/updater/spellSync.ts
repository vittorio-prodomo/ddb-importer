/**
 * Deciding which spells a character has learned or forgotten.
 *
 * Pure: no Foundry or D&D Beyond APIs. character.ts extracts both lists and
 * performs the calls; everything that decides what changes lives here so it can
 * be tested without a world.
 */

export interface FoundryKnownSpell {
  /** DDB spell definition id, from flags.ddbimporter.definitionId. Null for spells that never came from DDB. */
  definitionId: number | null;
  characterClassId: number;
  entityTypeId: number;
  /** DDB entry id (flags.ddbimporter.id); absent for a spell Foundry has just gained. */
  entryId: number | null;
  name: string;
}

export interface DDBKnownSpell {
  definitionId: number;
  characterClassId: number;
  entityTypeId: number;
  entryId: number;
  name: string;
  /** DDB's own marker. Granted and always-prepared spells are not part of the known list. */
  countsAsKnownSpell: boolean;
}

export interface SpellDiffOptions {
  allowRemovals: boolean;
  /** A pass wanting more removals than this is treated as a broken diff and abandoned whole. */
  removalCap: number;
  /** Classes that actually learn spells. A prepared caster knows its whole list already. */
  knownCasterClassIds: Set<number>;
}

export interface SpellDiff {
  toAdd: FoundryKnownSpell[];
  toRemove: DDBKnownSpell[];
  aborted: boolean;
  abortReason?: string;
}

// A spell known through two classes is two different known spells.
const key = (s: { definitionId: number | null; characterClassId: number }) => `${s.characterClassId}:${s.definitionId}`;

export function diffKnownSpells(
  foundrySpells: FoundryKnownSpell[],
  ddbSpells: DDBKnownSpell[],
  options: SpellDiffOptions,
): SpellDiff {
  const { allowRemovals, removalCap, knownCasterClassIds } = options;

  const relevantFoundry = foundrySpells.filter((s) =>
    s.definitionId !== null
    && s.definitionId !== undefined
    && knownCasterClassIds.has(s.characterClassId));

  const relevantDDB = ddbSpells.filter((s) =>
    s.countsAsKnownSpell
    && knownCasterClassIds.has(s.characterClassId));

  const ddbKeys = new Set(relevantDDB.map(key));
  const foundryKeys = new Set(relevantFoundry.map(key));

  const toAdd = relevantFoundry.filter((s) => !ddbKeys.has(key(s)));
  const wanted = allowRemovals ? relevantDDB.filter((s) => !foundryKeys.has(key(s))) : [];

  if (wanted.length > removalCap) {
    return {
      toAdd: [],
      toRemove: [],
      aborted: true,
      abortReason: `Spell sync wanted to remove ${wanted.length} spells, above the cap of ${removalCap}. `
        + `A removal that large is far more likely to be a broken diff than a real one, so nothing was synced.`,
    };
  }

  return { toAdd, toRemove: wanted, aborted: false };
}

export interface SpellSyncCall {
  characterClassId: number;
  spellId: number;
  id: number;
  entityTypeId: number;
  remove: boolean;
}

/**
 * Turn a diff into the bodies ddb-importer posts to the proxy.
 *
 * ⚠️ `id` means two different things by direction, both verified live 2026-08-24:
 *  - adding:   the class-spell-list MAPPING id (`game-data/spells` entry id), which is
 *              what flags.ddbimporter.id holds on a compendium-sourced spell.
 *  - removing: the character's own spell ENTRY id, from classSpells[].spells[].
 * D&D Beyond rejects the call with 400 "Missing required field: id" without one.
 */
export function buildSpellSyncCalls(diff: SpellDiff): SpellSyncCall[] {
  if (diff.aborted) return [];

  const adds = diff.toAdd
    .filter((s) => s.entryId !== null && s.entryId !== undefined && s.definitionId !== null)
    .map((s) => ({
      characterClassId: s.characterClassId,
      spellId: s.definitionId as number,
      id: s.entryId as number,
      entityTypeId: s.entityTypeId,
      remove: false,
    }));

  const removes = diff.toRemove.map((s) => ({
    characterClassId: s.characterClassId,
    spellId: s.definitionId,
    id: s.entryId,
    entityTypeId: s.entityTypeId,
    remove: true,
  }));

  return [...adds, ...removes];
}
