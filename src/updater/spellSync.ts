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
  /**
   * False for a row that sits on the sheet without being one of this class's own picks:
   * a spell granted by a feat, lineage or feature, or an entry of the class's full spell
   * list that was never prepared. Such a row is never sent as an addition, but it still
   * counts as "the sheet has this spell", so it keeps a D&D Beyond spell from being
   * removed. Absent means true. Set by classifyFoundrySpells.
   */
  learned?: boolean;
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

  // Removal candidates: only spells the player actually KNOWS. A granted or
  // always-prepared spell was never learned, so its absence from Foundry is not a
  // decision to forget it.
  const removableDDB = ddbSpells.filter((s) =>
    s.countsAsKnownSpell
    && knownCasterClassIds.has(s.characterClassId));

  // ⚠️ Additions are judged against EVERY spell D&D Beyond lists, counted-as-known or
  // not. Judging them against the removable set re-adds a granted spell as a *known*
  // one and rewrites its provenance — observed doing exactly that on a live sheet.
  const presentOnDDB = new Set(
    ddbSpells.filter((s) => knownCasterClassIds.has(s.characterClassId)).map(key),
  );
  const foundryKeys = new Set(relevantFoundry.map(key));

  // Only a pick is ever added. Removals below still read every row: a spell that is on
  // the sheet for any reason has not been forgotten.
  const toAdd = relevantFoundry.filter((s) => s.learned !== false && !presentOnDDB.has(key(s)));
  const wanted = allowRemovals ? removableDDB.filter((s) => !foundryKeys.has(key(s))) : [];

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

/**
 * Give a class to spells that arrived without one.
 *
 * ⚠️ A spell dragged from the DDB spell compendium carries `definitionId` and the mapping
 * id, but `characterClassId` is NULL — that field is per-character, not per-spell. The diff
 * needs it, so without this an added spell is silently dropped and "learned a new spell"
 * never reaches D&D Beyond. Verified live 2026-08-24.
 *
 * Only attributes when there is exactly ONE spellcasting class: on a multiclass character
 * guessing could write the spell to the wrong class list, which is a worse failure than
 * not syncing it.
 */
export function attributeSpellsToClass(
  spells: FoundryKnownSpell[],
  knownCasterClassIds: Set<number>,
): FoundryKnownSpell[] {
  if (knownCasterClassIds.size !== 1) return spells;
  const [only] = [...knownCasterClassIds];

  return spells.map((s) =>
    (s.characterClassId === null || s.characterClassId === undefined)
      ? { ...s, characterClassId: only }
      : s);
}

/** The parts of a Foundry spell item that decide whether it is one of a class's own picks. */
export interface FoundrySpellRow {
  definitionId: number | null;
  /** flags.ddbimporter.dndbeyond.characterClassId. Null on granted spells and on spells dragged in from a compendium. */
  characterClassId: number | null;
  entityTypeId: number;
  entryId: number | null;
  name: string;
  /** dnd5e `system.prepared`: 0 unprepared, 1 prepared, 2 always prepared. */
  prepared: number;
  /** dnd5e `system.sourceItem`, "<item type>:<identifier>" — "class:ranger", "feat:elven-lineage". */
  sourceItem: string | null;
  /** flags.ddbimporter.dndbeyond.lookup — "classSpell" on a class's own row, otherwise the kind of grant. */
  lookup: string | null;
}

export interface SpellClassification {
  knownCasterClassIds: Set<number>;
  /** Classes that prepare from their whole spell list — see preparesFromWholeList. */
  wholeListClassIds: Set<number>;
}

const GRANT_LOOKUPS = new Set(["race", "feat", "classFeature", "background", "item"]);

/**
 * A spell the character has through a feat, lineage, feature, background or item rather
 * than by picking it for a class.
 *
 * ⚠️ Both tests are needed. Chris's Premades can swap a granted spell and leave it with
 * no `lookup` at all (Hunter's Mark from Favored Enemy), and a row imported before
 * granted spells were given a source has a `lookup` and no `sourceItem`.
 */
export function isGrantedSpellRow(row: Pick<FoundrySpellRow, "sourceItem" | "lookup">): boolean {
  if (row.lookup && GRANT_LOOKUPS.has(row.lookup)) return true;
  return Boolean(row.sourceItem) && !String(row.sourceItem).startsWith("class:");
}

/**
 * Does this class prepare from its whole spell list, so that D&D Beyond lists only the
 * spells the player picked?
 *
 * For such a class the sheet can carry the entire list as unprepared rows ("Import full
 * spell list"), and a row is a pick only while it is prepared. Two signals, either is
 * enough: the payload carries the list itself (`alwaysKnownSpells`, attached by the
 * proxy), or the class is a 2024 Ranger or Paladin — the same gate
 * CharacterSpellFactory.generateClassSpells uses to read list membership as preparation.
 */
export function preparesFromWholeList(
  classInfo: { definition?: { name?: string; sources?: { sourceId?: number }[] } } | undefined,
  classSpells: { alwaysKnownSpells?: unknown[] | null } | undefined,
): boolean {
  if ((classSpells?.alwaysKnownSpells?.length ?? 0) > 0) return true;
  const is2014Class = (classInfo?.definition?.sources ?? [])
    .some((s) => Number.isInteger(s.sourceId) && (s.sourceId as number) < 145);
  return !is2014Class && ["Ranger", "Paladin"].includes(classInfo?.definition?.name ?? "");
}

/**
 * Turn the sheet's spell rows into the diff's input, marking which are the class's own picks.
 *
 * ⚠️ The diff used to treat every row as a pick. On the first real party that meant
 * sixteen additions nobody had learned: granted spells arrive with no class id, exactly
 * like a spell dragged in from the compendium, so the single-class attribution handed
 * them to the class; and a 2024 Ranger's unprepared list rows would all have become
 * prepared spells on D&D Beyond, where being on the list IS being prepared.
 */
export function classifyFoundrySpells(rows: FoundrySpellRow[], options: SpellClassification): FoundryKnownSpell[] {
  const { knownCasterClassIds, wholeListClassIds } = options;

  const granted = new Set(rows.filter(isGrantedSpellRow));
  const attributed = attributeSpellsToClass(
    rows.map((r) => ({
      definitionId: r.definitionId,
      characterClassId: r.characterClassId as number,
      entityTypeId: r.entityTypeId,
      entryId: r.entryId,
      name: r.name,
    })),
    knownCasterClassIds,
  );

  return attributed
    .map((spell, i) => {
      const row = rows[i];
      // 1 exactly: an always-prepared row (2) was promoted by a feature, not picked.
      const unpicked = wholeListClassIds.has(spell.characterClassId) && row.prepared !== 1;
      return { ...spell, learned: !granted.has(row) && !unpicked };
    })
    .filter((s) => s.characterClassId);
}

/**
 * Pact slots CONSUMED, which is what D&D Beyond stores.
 *
 * ⚠️ Foundry tracks slots REMAINING (`pact.value`). The pact sync used to send that
 * value straight through as the used count, so a full pool synced as fully spent and
 * an empty pool as untouched. Regular spell slots already did `max - value`.
 *
 * ⚠️ The live test that "confirmed" pact magic used max 2 / value 1 — the one case
 * where remaining and used are equal, so the bug could not show. Pick asymmetric
 * numbers when checking a polarity.
 */
export function pactSlotsUsed(pact: { max: number; value: number }): number {
  const max = Number(pact?.max);
  const value = Number(pact?.value);
  if (!Number.isFinite(max) || !Number.isFinite(value)) return 0;
  return Math.max(0, max - value);
}
