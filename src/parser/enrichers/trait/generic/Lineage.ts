import DDBEnricherData from "../../data/DDBEnricherData";
import { buildGrantedSpellCastActivities } from "../../data/grantedSpellActivities";

export default class Lineage extends DDBEnricherData {

  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.NONE;
  }

  /**
   * DDB grants lineage spells from a companion trait named for this one plus
   * " Spells" ("Elven Lineage" → "Elven Lineage Spells"), and that companion trait
   * is not imported as an item — so the spells have no feature to hang off unless
   * they hang off this one.
   */
  get _spellTraitName(): string {
    return `${this.ddbParser.ddbDefinition.name} Spells`;
  }

  get _grantedSpells(): any[] {
    // Cantrips carry no limitedUse, so the default onlyLimitedUse would hide them.
    return this._getSpellsForFeature({
      type: "race",
      name: this._spellTraitName,
      onlyLimitedUse: false,
    });
  }

  get additionalActivities(): IDDBAdditionalActivity[] {
    if (this.ddbParser.isMuncher) return [];

    // Lineages that grant no spells (and every species reaching this shared
    // enricher for the rename alone) are left exactly as they were.
    return buildGrantedSpellCastActivities(this._grantedSpells, {
      castType: DDBEnricherData.ACTIVITY_TYPES.CAST,
    });
  }

  get override(): IDDBOverrideData {
    if (this.data.name.startsWith("Gnomish ")) return null;

    const renamed = {
      data: {
        name: `${this.data.name}`.replace(/ Lineage| Legacy$/i, ""),
      },
    };

    const limited = this._grantedSpells.filter((spell) => spell.limitedUse);
    if (limited.length === 0) return renamed;

    return {
      ...renamed,
      uses: this._getSpellUsesWithSpent({
        type: "race",
        name: this._spellTraitName,
      }),
      // Survive a re-import with the free cast still spent.
      retainUseSpent: true,
    };
  }

}
