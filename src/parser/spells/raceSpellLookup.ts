interface IRacialTraitLookup {
  id: number;
  name: string;
  data: any;
}

/**
 * Resolve the racial trait that granted a race spell.
 *
 * `spells.race[].componentId` usually IS a racial trait definition id, but for the
 * 2024 lineage species it is the id of the chosen lineage OPTION instead (e.g. Drow
 * Lineage, Wood Elf), which never appears in `race.racialTraits`. `choices.race` is
 * the only structure that links the two: the entry whose `optionValue` is that
 * option carries the owning trait in its own `componentId`.
 *
 * Without the second hop the caller fell back to the literal "Racial spell", so
 * every lineage-granted spell lost its granting trait.
 */
export function resolveRaceGrantingTrait(ddb: any, componentId: number): IRacialTraitLookup | null {
  const traits = ddb?.character?.race?.racialTraits ?? [];

  const asLookup = (trait: any): IRacialTraitLookup | null =>
    trait ? { id: trait.definition.id, name: trait.definition.name, data: trait } : null;

  const direct = traits.find((t: any) => t.definition?.id === componentId);
  if (direct) return asLookup(direct);

  // A choice with no optionValue matches nothing — guard, or an undefined
  // componentId would pair with it and hand back an unrelated trait.
  const choice = (ddb?.character?.choices?.race ?? []).find(
    (c: any) => c.optionValue !== null && c.optionValue !== undefined && c.optionValue === componentId,
  );
  if (choice) return asLookup(traits.find((t: any) => t.definition?.id === choice.componentId));

  // Upstream 7.1.22's case (merged for T228): the id is a race OPTION (e.g. an ASI
  // choice) listed under `options.race`, whose `componentId` names the owning trait.
  const option = (ddb?.character?.options?.race ?? []).find((o: any) => o?.definition?.id === componentId);
  if (!option) return null;

  return asLookup(traits.find((t: any) => t.definition?.id === option.componentId));
}

/**
 * Racial traits whose spells the Lineage enricher emits as Cast activities.
 *
 * DDB names the granting trait for a lineage's spells after the lineage itself
 * ("Elven Lineage" → "Elven Lineage Spells"), so a suffix rule covers every
 * species rather than needing one entry each. Spells from these traits must not
 * also be parsed as innate items, or the grant lands on the sheet twice.
 */
const CAST_ACTIVITY_TRAIT_SUFFIXES = [
  " Lineage Spells",
  " Legacy Spells",
];

export function isCastActivityRacialTrait(traitName: string): boolean {
  if (!traitName) return false;
  return CAST_ACTIVITY_TRAIT_SUFFIXES.some((suffix) => traitName.endsWith(suffix));
}
