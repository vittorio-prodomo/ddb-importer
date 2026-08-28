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

