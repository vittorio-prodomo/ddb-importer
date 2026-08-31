/**
 * Make a granted spell's sheet subtitle name the FEATURE that granted it.
 *
 * The dnd5e character sheet builds the subtitle as
 * `[sourceLabel, components].filterJoin(" • ")`, where `sourceLabel` is the NAME of
 * the item `system.sourceItem` points at. Left alone, `SpellData._preCreate` fills
 * that in with the actor's only spellcasting class, so every granted row reads
 * "Wizard" or "Ranger" regardless of where it actually came from.
 *
 * Vittorio's call (2026-09-01): name the granting feature instead — Hunter's Mark
 * says "Favored Enemy", Longstrider and Druidcraft say "Elven: Wood Elf Lineage",
 * Magic Initiate's three say "Magic Initiate (Cleric)". dnd5e does the same thing
 * itself for species/background grants, so this is the intended shape.
 *
 * ⚠️ **Accepted trade-off, decided with the numbers in front of him:** `classIdentifier`
 * returns "" for a non-class `sourceItem`, and the spellbook's CLASS FILTER matches on
 * it — so these spells vanish from a class-filtered spell list. Two other consumers
 * were checked and are safe: `availableAbilities` falls back to the actor's default
 * spellcasting ability (identical for a single-classed character — ⚠️ NOT necessarily
 * for a multiclass), and `countsPrepared` already excludes always-prepared rows.
 *
 * Pure string work so it is node-testable without Foundry.
 */

/** DDB's placeholder lookup name; it names nothing on the sheet. */
const PLACEHOLDER_LOOKUP_NAMES = new Set(["generic", ""]);

/**
 * The feature that granted this spell row, from whichever flag records it.
 *
 * Two signals, because the grant shapes differ: a dual-pool row carries the
 * `dualPoolGrant` stamp (Hunter's Mark has no DDB lookup name at all), while a
 * cantrip grant has no stamp and only `dndbeyond.lookupName`.
 */
export function grantingFeatureName(flags: any): string | null {
  const stamped = flags?.ddbimporter?.dualPoolGrant?.feature;
  if (stamped) return `${stamped}`;
  const lookupName = `${flags?.ddbimporter?.dndbeyond?.lookupName ?? ""}`.trim();
  if (!lookupName || PLACEHOLDER_LOOKUP_NAMES.has(lookupName.toLowerCase())) return null;
  return lookupName;
}

/**
 * The `system.sourceItem` key for a granting item, as `actor.identifiedItems` is keyed.
 *
 * ⚠️ Built from the item's own `identifier`, NEVER from a slug of its name: "Elven:
 * Wood Elf Lineage" carries the identifier `elven-lineage`, so slugifying the display
 * name yields `elven-wood-elf-lineage`, which resolves to nothing — and a sourceItem
 * pointing nowhere fails SILENTLY, leaving the old subtitle in place.
 *
 * Returns null when the item has no identifier: leaving the subtitle as it was beats
 * pointing it at a document that does not exist.
 */
export function sourceItemKey(item: { type?: string; identifier?: string } | null | undefined): string | null {
  const identifier = `${item?.identifier ?? ""}`.trim();
  if (!item?.type || !identifier) return null;
  return `${item.type}:${identifier}`;
}

/**
 * The feature names to try when matching a grant back to its item, best first.
 *
 * ⚠️ DDB records a race-granted spell's `lookupName` as the name of the granted spell
 * LIST — "Elven Lineage Spells" — while the trait itself is "Elven Lineage". The id is
 * no help: `lookupId` points at the list entity, not the trait. So a trailing " Spells"
 * is stripped as a second candidate, which is what connects Warpey's Druidcraft to the
 * lineage feat.
 *
 * Never strips to nothing, and only ever a TRAILING occurrence.
 */
export function featureNameCandidates(name: string): string[] {
  const names = [name];
  const stripped = name.replace(/\s+Spells$/i, "").trim();
  if (stripped && stripped !== name) names.push(stripped);
  return names;
}
