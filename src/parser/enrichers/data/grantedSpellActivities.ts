/**
 * Build the Cast-activity hints for spells a feature grants.
 *
 * Shared by the feat-side (Magic Initiate) and species-side (lineage spells)
 * enrichers: both encode "this feature grants these spells, one of which is free
 * once per rest", and both replace DDB's innate parse, where the same grant became
 * a standalone innate item plus a slot-castable twin.
 *
 * `castType` is passed in rather than imported so this stays free of the enricher
 * class graph and can be tested on its own.
 */
export function buildGrantedSpellCastActivities(
  spells: any[],
  { castType }: { castType: string },
): any[] {
  // DDB exports a limited-use grant as a pair — the free-use entry and its
  // slot-castable twin — and both name the same spell. One activity covers both,
  // and it has to be the entry carrying the pool.
  const byName = new Map<string, any>();
  for (const spell of spells) {
    const existing = byName.get(spell.definition.name);
    if (!existing || (!existing.limitedUse && spell.limitedUse)) {
      byName.set(spell.definition.name, spell);
    }
  }

  return [...byName.values()].map((spell) => {
    const isCantrip = spell.definition.level === 0;

    return {
      init: {
        name: spell.definition.name,
        type: castType,
      },
      build: {
        generateConsumption: !isCantrip,
        generateSpell: true,
        generateActivation: true,
      },
      overrides: {
        addSpellUuid: spell.definition.name,
        // A cantrip is at will; only a levelled spell draws on the feature's use.
        //
        // ⚠️ Do NOT add addSpellSlotConsume here. It pushes a spellSlots
        // consumption target, and dnd5e spends every target on the activity, so
        // the free cast would cost a use AND a slot. Slot casting is already
        // covered by the Cast activity's own consumption.spellSlot flag — the
        // shape the long-standing Favored Enemy activity uses.
        ...(isCantrip
          ? { noConsumeTargets: true }
          : { addItemConsume: true, itemConsumeValue: "1" }),
        data: {
          spell: {
            spellbook: true,
          },
        },
      },
    };
  });
}
