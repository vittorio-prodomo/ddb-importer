/**
 * Collapsing the duplicate spell rows a granted spell leaves behind (T191).
 *
 * A spell that a feature grants AND that sits on the character's own class list
 * can reach the sheet three times:
 *
 *  1. the class-list copy — correct, and the row we keep;
 *  2. an innate copy, pushed because the grant failed to match its granting
 *     feature by name (see `matchesGrantingFeature`);
 *  3. dnd5e's cached copy of the feature's Cast activity, created by
 *     `ActivitiesTemplate#onCreateActivities` AFTER the import writes the feature
 *     — nothing in this parser builds it (see `hideFromSpellbook`).
 *
 * Both helpers are pure so they can be tested without Foundry.
 */

/**
 * DDB serves names with a typographic apostrophe (U+2019); the importer
 * normalises item names to a straight one. A grant records its granting feature
 * in `lookupName` from the RAW definition, while the feature carries the
 * NORMALISED `originalName` — so "Paladin’s Smite" and "Paladin's Smite" are
 * compared across that boundary and never match, and the dedup that should have
 * dropped the innate copy silently does nothing. Favored Enemy has no
 * apostrophe, which is why the same code path works there and hid the bug.
 */
export function normaliseGrantName(name: string | null | undefined): string {
  if (typeof name !== "string") return "";
  return name.replaceAll("’", "'").replaceAll("&rsquo;", "'").trim().toLowerCase();
}

/** Does this grant's `lookupName` name the feature that granted it? */
export function matchesGrantingFeature(
  lookupName: string | null | undefined,
  featureName: string | null | undefined,
): boolean {
  const grant = normaliseGrantName(lookupName);
  return grant !== "" && grant === normaliseGrantName(featureName);
}

/**
 * Compendium uuids of a set of spell rows — the coverage a cached row can defer to.
 *
 * Read from `_stats.compendiumSource`, which `_setCompendiumSource` stamps on
 * every parsed spell and which survives onto the created item — the same uuid a
 * Cast activity points at, so the two sides compare exactly.
 *
 * ⚠️ The CALLER decides what goes in. Never hand it cached rows: a cached row
 * must not count as the coverage that justifies hiding itself.
 */
export function spellSourceUuids(spells: any[]): Set<string> {
  const uuids = new Set<string>();
  for (const spell of spells ?? []) {
    const uuid = spell?._stats?.compendiumSource;
    if (uuid) uuids.add(uuid);
  }
  return uuids;
}

/**
 * Should this Cast activity's cached spell stay out of the spellbook?
 *
 * dnd5e's `CastActivity#displayInSpellbook` consults `spell.spellbook`, so
 * clearing it drops the cached row from the sheet while leaving the free cast on
 * the granting feature — and leaves the cached item itself in place, which is
 * what the activity spends. Only ever clear it when the class-list copy is there
 * to take over the row: for a grant the character does NOT otherwise know (a
 * Magic Initiate spell off-list), the cached copy is the only spellbook presence
 * and must stay.
 */
export function hideFromSpellbook(spellUuid: string | null | undefined, onClassList: Set<string>): boolean {
  return Boolean(spellUuid) && onClassList.has(spellUuid as string);
}

/**
 * Plan the spellbook-visibility changes for one feature's Cast activities.
 *
 * Used by the post-import pass, which re-applies the rule after Chris's Premades
 * has swapped in its own document — for an adopted feature (Paladin's Smite,
 * Favored Enemy) the parse-time write is discarded, so this is the only place the
 * change survives.
 *
 * Two properties matter as much as the rule itself:
 *
 *  - **Idempotent.** The pass runs on every import; re-issuing an update that
 *    changes nothing churns the document and re-triggers dnd5e's activity hooks.
 *  - **Reversible, but only for our own edits.** If the spell later stops being
 *    covered, a row we hid must come back — otherwise the spell disappears from
 *    the sheet entirely. A row someone else set to `false` (a premade shipping it
 *    that way) is never ours to restore, so restoration is gated on
 *    `previouslyHidden`, the record this pass keeps of what it hid.
 */
export function planSpellbookRowChanges({ activities, covered, previouslyHidden }: {
  activities: { id: string; uuid?: string | null; spellbook?: boolean }[];
  covered: Set<string>;
  previouslyHidden: string[];
}): { hide: string[]; restore: string[] } {
  const ours = new Set(previouslyHidden ?? []);
  const hide: string[] = [];
  const restore: string[] = [];

  for (const activity of activities ?? []) {
    if (!activity?.id || !activity.uuid) continue;
    const shouldHide = hideFromSpellbook(activity.uuid, covered);
    const isHidden = activity.spellbook === false;

    if (shouldHide && !isHidden) hide.push(activity.id);
    else if (!shouldHide && isHidden && ours.has(activity.id)) restore.push(activity.id);
  }

  return { hide, restore };
}


/**
 * Compendium uuids of the class-list rows that can actually TAKE OVER a
 * spellbook row — prepared, always-prepared, or cast by a method that needs no
 * preparation. An UNPREPARED full-list import row is a catalogue entry: hiding
 * a granted spell's cached row behind one leaves the sheet with no castable
 * presence at all (the Wood-Elf Longstrider bug, 2026-08-30).
 */
export function usableSpellSourceUuids(spells: any[]): Set<string> {
  const uuids = new Set<string>();
  for (const spell of spells ?? []) {
    const uuid = spell?._stats?.compendiumSource;
    if (!uuid) continue;
    const method = spell?.system?.method;
    const prepared = Number(spell?.system?.prepared ?? 0);
    if ((method && method !== "spell") || prepared >= 1) uuids.add(uuid);
  }
  return uuids;
}

/**
 * Reconcile one feature's Cast activities against the class list (the
 * dual-pool extension of T191, 2026-08-30).
 *
 * A free-cast grant (the activity consumes itemUses) whose spell the character
 * also has as a class row gets the full vanilla dual-pool treatment: the class
 * row becomes THE row (always-prepared, own pool, forward activity — the
 * approved Hunter's Mark shape) and the feature's Cast activity is removed, so
 * no cached row ever exists. Anything else on the class list is only HIDDEN,
 * and only when the covering row is usable — a catalogue row covers nothing.
 */
export function planClassListGrantReconciliation({ activities, onClassList, usable }: {
  activities: { id: string; uuid?: string | null; consumesItemUses?: boolean }[];
  onClassList: Set<string>;
  usable: Set<string>;
}): { dualPool: { id: string; uuid: string }[]; hide: string[] } {
  const dualPool: { id: string; uuid: string }[] = [];
  const hide: string[] = [];
  for (const activity of activities ?? []) {
    if (!activity?.id || !activity.uuid) continue;
    if (!onClassList.has(activity.uuid)) continue;
    if (activity.consumesItemUses) dualPool.push({ id: activity.id, uuid: activity.uuid });
    else if (usable.has(activity.uuid)) hide.push(activity.id);
  }
  return { dualPool, hide };
}

/**
 * The dual-pool stamp for an OFF-class-list free-cast grant, or null.
 *
 * Nigel's Healing Word (Magic Initiate (Cleric)), Victus's Shield (Magic Initiate
 * (Wizard)), Nahuel's Faerie Fire (Drow Lineage): a spell the character does not
 * otherwise know, granted with a limited free cast. These kept the Cast-activity /
 * cached-row shape and so sat in "Additional Spells" forever — `_prepareSpellbook`
 * pins anything carrying `flags.dnd5e.cachedFor` into that section without ever
 * consulting the spell's level, so the row has to become REAL to reach its own
 * level, and must then carry the pool itself.
 *
 * ⚠️ This is the levelled sibling of the T205 cantrip change. A cantrip needed no
 * pool (at will, spends nothing), which is why that fix could simply drop the Cast
 * activity; a levelled grant's free cast lives in that activity, so dropping it
 * without moving the pool would silently cost the character the free cast.
 *
 * Stamping is all that is required: the ready-hook pass (`hooks/ready/spellbookRows`)
 * already picks up ANY stamped spell, builds pool + forward activity + always-prepared
 * via `planDualPoolShape`, and clears the granting feature's now-unspent pool through
 * its own `hasOtherPoolConsumers` guard.
 *
 * @param spell        The DDB spell entry.
 * @param featureName  The granting feature — the runtime pass matches the feature by
 *                     this name, so an empty one yields no stamp.
 */
export function freeCastGrantStamp(
  spell: { definition?: { level?: number }; limitedUse?: { maxUses?: number } | null } | null | undefined,
  featureName: string | null | undefined,
): { uses: string; feature: string } | null {
  if (!featureName) return null;
  const level = spell?.definition?.level ?? 0;
  // Cantrips are already real rows (T205) and want no pool.
  if (level === 0) return null;
  // No free cast means no pool to move — Divine Smite is always-prepared but
  // spends slots, and must keep its existing shape.
  if (!spell?.limitedUse) return null;
  const maxUses = Number(spell.limitedUse.maxUses) || 1;
  return { uses: `${maxUses}`, feature: featureName };
}

/**
 * The off-class-list counterpart of `planClassListGrantReconciliation`.
 *
 * A free-cast grant the character does not otherwise know now parses into a REAL
 * spell row (see `freeCastGrantStamp` and the two gates in `CharacterSpellFactory`),
 * so the Cast activity that used to represent it is redundant: the row carries the
 * pool itself. Removing the activity is also what stops dnd5e from building the
 * cached copy, which is the only way the spell can leave "Additional Spells".
 *
 * ⚠️ **`grantedRowUuids` is a safety interlock, not a filter.** Nothing may be
 * removed unless a real row demonstrably exists for that spell: deleting a Cast
 * activity cascade-deletes its cached row, so acting without the replacement would
 * take the spell off the sheet entirely. That is the case memory flags as the one
 * which must never collapse — a grant with no other row is its own only presence.
 *
 * Spells the class list already covers are left to the class-list planner.
 */
export function planOffListGrantReconciliation({ activities, onClassList, grantedRowUuids }: {
  activities: { id: string; uuid?: string | null; consumesItemUses?: boolean }[];
  onClassList: Set<string>;
  grantedRowUuids: Set<string>;
}): { dualPool: { id: string; uuid: string }[] } {
  const dualPool: { id: string; uuid: string }[] = [];
  for (const activity of activities ?? []) {
    if (!activity?.id || !activity.uuid) continue;
    if (onClassList.has(activity.uuid)) continue;      // the other planner owns this
    if (!activity.consumesItemUses) continue;          // no pool to move
    if (!grantedRowUuids.has(activity.uuid)) continue; // ⚠️ no replacement row — leave it
    dualPool.push({ id: activity.id, uuid: activity.uuid });
  }
  return { dualPool };
}

/**
 * The DDB spell entry re-shaped as the single dual-pool row.
 *
 * ⚠️ Parsing a limited-use grant as-is yields an INNATE row, which lands in the
 * innate-spellcasting section rather than at its own level — and `handleGrantedSpells`
 * would separately build a slot-castable twin, giving two rows for one spell. The
 * dual-pool shape wants exactly one row that does both jobs, so the grant is parsed
 * as the unlimited (slot-castable, always-prepared) variant and the free cast comes
 * back as a pool + forward activity from the `dualPoolGrant` stamp.
 *
 * The original entry is left untouched — `canCast` still has to see the real
 * `limitedUse`, since a grant is castable even when no slots remain.
 */
export function asDualPoolRowSpell<T extends Record<string, any>>(spell: T): T {
  return { ...spell, limitedUse: null, usesSpellSlot: true, alwaysPrepared: true };
}
