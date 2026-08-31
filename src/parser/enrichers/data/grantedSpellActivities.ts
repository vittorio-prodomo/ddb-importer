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

  // ⚠️ CANTRIPS GET NO ACTIVITY AT ALL (2026-08-31). A Cast activity makes dnd5e
  // build a cached spell row, and `_prepareSpellbook` pins EVERY row carrying
  // `flags.dnd5e.cachedFor` into the "item" section — labelled "Additional
  // Spells" — without ever consulting the spell's level. So a granted cantrip
  // could never appear under "Cantrips" while it was modelled this way.
  //
  // A cantrip grant needs no activity: it is at will, spends nothing, and the
  // official 2024 content models these lineage/feat items as inert prose. Left
  // to the normal spell parser (which no longer skips them — see
  // `CharacterSpellFactory`) it becomes an ordinary always-prepared cantrip row
  // and lands in its natural section.
  return [...byName.values()].filter((spell) => spell.definition.level !== 0).map((spell) => {
    return {
      init: {
        name: spell.definition.name,
        type: castType,
      },
      build: {
        generateConsumption: true,
        generateSpell: true,
        generateActivation: true,
      },
      overrides: {
        addSpellUuid: spell.definition.name,
        //
        // ⚠️ Do NOT add addSpellSlotConsume here. It pushes a spellSlots
        // consumption target, and dnd5e spends every target on the activity, so
        // the free cast would cost a use AND a slot. Slot casting is already
        // covered by the Cast activity's own consumption.spellSlot flag — the
        // shape the long-standing Favored Enemy activity uses.
        addItemConsume: true,
        itemConsumeValue: "1",
        data: {
          spell: {
            spellbook: true,
          },
        },
      },
    };
  });
}
