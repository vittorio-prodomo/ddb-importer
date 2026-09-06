/**
 * Is `candidate` already represented on a feature's advancement list? (T228, 7.1.x merge)
 *
 * Upstream 7.1.22 added a species-trait spell-advancement generator that runs at feature
 * build (`DDBFeature._generateSpellAdvancements`), while the older per-feature pass
 * (`AdvancementHelper.addSpellAdvancement`, via `_addSpellAdvancementTypeWithFilter("race")`)
 * still runs afterwards. On a 2024 lineage trait both parse the same table, so the feature
 * ended up with SIX ItemGrant advancements for three spells: "Elven Lineage (Spells)" ×3 and
 * "Elven: Wood Elf Lineage (Cantrips|Spells)" ×3, each pair granting one uuid at one level.
 *
 * Two advancements are the same grant when they share a type, a level and the set of item
 * uuids they grant (or offer, for a choice). Titles and the spell-configuration details are
 * deliberately NOT compared — those are exactly what differs between the two generators.
 * Kept free of Foundry so it can be unit-tested.
 */

interface AdvancementLike {
  type?: string;
  level?: number;
  configuration?: {
    items?: ({ uuid?: string } | string)[];
    pool?: ({ uuid?: string } | string)[];
  };
}

function grantedUuids(a: AdvancementLike): string[] {
  const entries = [...(a.configuration?.items ?? []), ...(a.configuration?.pool ?? [])];
  return entries
    .map((e) => (typeof e === "string" ? e : e?.uuid ?? ""))
    .filter((u) => u !== "")
    .sort();
}

/** A stable identity for "what this advancement grants", or null when it grants nothing. */
export function advancementGrantKey(a: AdvancementLike | null | undefined): string | null {
  if (!a?.type) return null;
  const uuids = grantedUuids(a);
  if (uuids.length === 0) return null;
  return `${a.type}|${a.level ?? 0}|${uuids.join(",")}`;
}

/**
 * `existing` is a feature's `system.advancement` — a MappingField object keyed by id at
 * parse time, but an array is accepted too.
 */
export function isDuplicateAdvancement(
  existing: Record<string, AdvancementLike> | AdvancementLike[] | null | undefined,
  candidate: AdvancementLike,
): boolean {
  const key = advancementGrantKey(candidate);
  if (!key) return false;
  const list = Array.isArray(existing) ? existing : Object.values(existing ?? {});
  return list.some((a) => advancementGrantKey(a) === key);
}
