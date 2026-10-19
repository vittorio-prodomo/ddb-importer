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
  /**
   * True for an unprepared row of a class whose list membership IS preparation on D&D
   * Beyond (2024 Ranger, Paladin). The player has unpicked it, so this row does not keep
   * the spell there: if D&D Beyond still lists it, it is removed. Absent means false.
   */
  unpicked?: boolean;
  /** The Foundry item's id, so a spell matched by name can be given its D&D Beyond ids after the sync. */
  itemId?: string;
  /** True when `definitionId` came from the class's spell list by NAME, not from the item — see resolveDefinitionsByName. */
  matchedByName?: boolean;
  /** The item's `system.source.rules` ("2014" / "2024"), when it says. */
  rules?: string | null;
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
  // An unpicked row is on the sheet only as part of the class's full list; it does not
  // hold the spell, so a pick D&D Beyond still lists is removed below.
  const foundryKeys = new Set(relevantFoundry.filter((s) => !s.unpicked).map(key));
  // ⚠️ A row with no D&D Beyond id (a copy from another compendium the class list could not
  // name) still holds the spell: a same-named D&D Beyond spell of that class is not removed.
  const namelessKeys = new Set(
    foundrySpells
      .filter((s) => (s.definitionId === null || s.definitionId === undefined) && knownCasterClassIds.has(s.characterClassId))
      .map((s) => `${s.characterClassId}:${normalizeSpellName(s.name)}`),
  );

  // Only a pick is ever added. Removals below read every row except the unpicked ones: a
  // spell that is on the sheet for any other reason has not been forgotten.
  const toAdd = relevantFoundry.filter((s) => s.learned !== false && !presentOnDDB.has(key(s)));
  const wanted = allowRemovals
    ? removableDDB.filter((s) => !foundryKeys.has(key(s)) && !namelessKeys.has(`${s.characterClassId}:${normalizeSpellName(s.name)}`))
    : [];

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

/** One entry of a class's spell list on D&D Beyond. `id` is the list-mapping id an addition must carry. */
export interface ClassListEntry {
  id: number;
  entityTypeId: number;
  definitionId: number;
  name: string;
}

/**
 * Why an addition was not sent:
 *  - "no-list":       the class's spell list could not be read, so any id would be a guess.
 *  - "other-version": the list has a spell of this name, but a different one — the sheet
 *                     holds the other edition's copy (2014 and 2024 spells share names).
 *  - "not-on-list":   the class cannot have this spell at all.
 */
export type AdditionRefusal = "no-list" | "other-version" | "not-on-list";

export interface ResolvedAdditions {
  resolved: FoundryKnownSpell[];
  refused: { spell: FoundryKnownSpell; reason: AdditionRefusal }[];
}

/**
 * Give every addition the id it has on the character's OWN class list.
 *
 * ⚠️ That id is per LIST, not per spell: 2024 Alarm is 21172912 on the 2024 Wizard's
 * list, 21172911 on the 2024 Ranger's and 21172914 on the 2014 Wizard's. The id on a
 * Foundry item is whatever list the item came from — for a spell dragged out of the
 * munched compendium, a 2014 class's list, which is the wrong one for every 2024
 * character. So the item's id is never trusted for an addition; the list is asked.
 *
 * A spell the list does not hold is refused rather than sent on a guess. That also
 * stops the commonest slip: the compendium has a 2014 and a 2024 copy of some 300
 * spells under one name, and the wrong copy would put a legacy spell on the sheet.
 */
export function resolveAdditionIds(
  toAdd: FoundryKnownSpell[],
  listsByClassId: Map<number, ClassListEntry[] | null | undefined>,
): ResolvedAdditions {
  const out: ResolvedAdditions = { resolved: [], refused: [] };

  for (const spell of toAdd) {
    const list = listsByClassId.get(spell.characterClassId);
    if (!list) {
      out.refused.push({ spell, reason: "no-list" });
      continue;
    }
    const entry = list.find((e) => e.definitionId === spell.definitionId);
    if (entry) {
      out.resolved.push({ ...spell, entryId: entry.id, entityTypeId: entry.entityTypeId ?? spell.entityTypeId });
      continue;
    }
    const name = String(spell.name ?? "").trim().toLowerCase();
    const sameName = name !== "" && list.some((e) => String(e.name ?? "").trim().toLowerCase() === name);
    out.refused.push({ spell, reason: sameName ? "other-version" : "not-on-list" });
  }

  return out;
}

/** A spell name as D&D Beyond and Foundry can both spell it: trimmed, lower case, one kind of apostrophe. */
export function normalizeSpellName(name: string | null | undefined): string {
  return String(name ?? "").trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

/**
 * Give a spell with no D&D Beyond id the definition its class's own list has under the same name.
 *
 * ⚠️ A spell from the Player's Handbook, dnd5e's 2024 SRD or CPR carries no ddbimporter flags, so
 * the sync dropped it without a word: no call, no warning (dry runs on Nahuel, 2026-10-19). The
 * class's list holds one edition only, so a name match there cannot pick the other edition's spell.
 * A spell the list does not name — or with no list, or no class — comes back in `unmatched`.
 */
export function resolveDefinitionsByName(
  spells: FoundryKnownSpell[],
  listsByClassId: Map<number, ClassListEntry[] | null | undefined>,
  editionByClassId = new Map<number, "2014" | "2024">(),
): { spells: FoundryKnownSpell[]; unmatched: FoundryKnownSpell[]; wrongEdition: FoundryKnownSpell[] } {
  const unmatched: FoundryKnownSpell[] = [];
  const wrongEdition: FoundryKnownSpell[] = [];
  const out = spells.map((spell) => {
    if (spell.definitionId !== null && spell.definitionId !== undefined) return spell;
    // ⚠️ Name alone is not enough: the 2014 copy of a spell has the same name. A row that says
    // its edition must be the class's; one that does not say is taken as the class's.
    const edition = spell.characterClassId ? editionByClassId.get(spell.characterClassId) : undefined;
    if (edition && (spell.rules === "2014" || spell.rules === "2024") && spell.rules !== edition) {
      wrongEdition.push(spell);
      return spell;
    }
    const list = spell.characterClassId ? listsByClassId.get(spell.characterClassId) : null;
    const name = normalizeSpellName(spell.name);
    const entry = list && name ? list.find((e) => normalizeSpellName(e.name) === name) : undefined;
    if (!entry) {
      unmatched.push(spell);
      return spell;
    }
    return { ...spell, definitionId: entry.definitionId, entityTypeId: entry.entityTypeId ?? spell.entityTypeId, matchedByName: true };
  });
  return { spells: out, unmatched, wrongEdition };
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
  /** The Foundry item's id. */
  itemId?: string;
  /** The item's `system.source.rules`. */
  rules?: string | null;
}

export interface SpellClassification {
  knownCasterClassIds: Set<number>;
  /** Classes that prepare from their whole spell list — see preparesFromWholeList. */
  wholeListClassIds: Set<number>;
  /** The whole-list classes where being on the list IS being prepared — see membershipIsPreparation. */
  membershipClassIds?: Set<number>;
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
 * Is being on this class's D&D Beyond spell list the same thing as having the spell prepared?
 *
 * True for a 2024 Ranger or Paladin: D&D Beyond lists only their picks and its `prepared`
 * flag is junk for them (a Paladin with three prepared spells reports none). This is the
 * gate CharacterSpellFactory.generateClassSpells uses to import every listed spell as
 * prepared, so for these classes the sync runs that mapping backwards: prepared in Foundry
 * means on the list, unprepared means off it. Proven on a real sheet 2026-10-09.
 *
 * ⚠️ Deliberately NOT true for every class with a full list. A Cleric's imported rows
 * follow D&D Beyond's own flag, so an unprepared row there says nothing about the list,
 * and reading it as "unpicked" would delete spells.
 */
export function membershipIsPreparation(
  classInfo: { definition?: { name?: string; sources?: { sourceId?: number }[] } } | undefined,
): boolean {
  return classRulesEdition(classInfo) === "2024" && ["Ranger", "Paladin"].includes(classInfo?.definition?.name ?? "");
}

/** A class's rules edition on D&D Beyond: a source id below 145 is a 2014 book. */
export function classRulesEdition(
  classInfo: { definition?: { sources?: { sourceId?: number }[] } } | undefined,
): "2014" | "2024" {
  const is2014 = (classInfo?.definition?.sources ?? [])
    .some((s) => Number.isInteger(s.sourceId) && (s.sourceId as number) < 145);
  return is2014 ? "2014" : "2024";
}

/**
 * Does this class prepare from its whole spell list, so that D&D Beyond lists only the
 * spells the player picked?
 *
 * For such a class the sheet can carry the entire list as unprepared rows ("Import full
 * spell list"), and a row is a pick only while it is prepared. Two signals, either is
 * enough: the payload carries the list itself (`alwaysKnownSpells`, attached by the
 * proxy), or list membership is preparation for the class.
 */
export function preparesFromWholeList(
  classInfo: { definition?: { name?: string; sources?: { sourceId?: number }[] } } | undefined,
  classSpells: { alwaysKnownSpells?: unknown[] | null } | undefined,
): boolean {
  if ((classSpells?.alwaysKnownSpells?.length ?? 0) > 0) return true;
  return membershipIsPreparation(classInfo);
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
  const membershipClassIds = options.membershipClassIds ?? new Set<number>();

  const granted = new Set(rows.filter(isGrantedSpellRow));
  const attributed = attributeSpellsToClass(
    rows.map((r) => ({
      definitionId: r.definitionId,
      characterClassId: r.characterClassId as number,
      entityTypeId: r.entityTypeId,
      entryId: r.entryId,
      name: r.name,
      itemId: r.itemId,
      rules: r.rules,
    })),
    knownCasterClassIds,
  );

  return attributed
    .map((spell, i) => {
      const row = rows[i];
      const isGranted = granted.has(row);
      const membership = membershipClassIds.has(spell.characterClassId);
      const wholeList = membership || wholeListClassIds.has(spell.characterClassId);
      // 1 exactly: an always-prepared row (2) was promoted by a feature, not picked.
      const learned = !isGranted && !(wholeList && row.prepared !== 1);
      // 0 exactly, and never a granted row: only the player unpreparing the class's own
      // row takes the spell off the list.
      const unpicked = membership && !isGranted && row.prepared === 0;
      return { ...spell, learned, unpicked };
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

/**
 * The `spell/prepare` payload for a spell, or null when no D&D Beyond ENTRY id is known.
 *
 * ⚠️ A spell matched by name (resolveDefinitionsByName) is stamped with its definition, not its entry
 * id — D&D Beyond's answer to the addition does not carry it. The entry id then comes from D&D Beyond's
 * own row for the spell (`ddbEntryId`); with neither, nothing is sent rather than `id: undefined`.
 */
export function spellPrepareInfo(
  spell: { system?: { prepared?: number }; flags?: { ddbimporter?: { definitionId?: number; entityTypeId?: number; id?: number; dndbeyond?: { characterClassId?: number } } } },
  ddbEntryId: number | null | undefined,
  preparedValue: number,
): { spellId: number; characterClassId: number; entityTypeId: number; id: number; prepared: boolean } | null {
  const flags = spell.flags?.ddbimporter;
  const id = flags?.id ?? ddbEntryId;
  if (id === null || id === undefined) return null;
  return {
    spellId: flags?.definitionId as number,
    characterClassId: flags?.dndbeyond?.characterClassId as number,
    entityTypeId: flags?.entityTypeId as number,
    id,
    prepared: spell.system?.prepared === preparedValue,
  };
}
