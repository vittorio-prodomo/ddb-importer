import DDBEnricherData from "../data/DDBEnricherData";
import { buildGrantedSpellCastActivities } from "../data/grantedSpellActivities";

/**
 * Magic Initiate grants two cantrips plus one level-1 spell, the latter castable
 * free once per long rest and also with a spell slot.
 *
 * Parsed as innate spells the level-1 grant becomes two sheet entries — the innate
 * copy and the slot-castable twin DDB exports alongside it — with no link back to
 * the feat. Shaping the grants as Cast activities gives one entry per spell, puts
 * the free use on the feat's own pool, and lets the sheet and Argon name the
 * granting feat natively. The feat is listed in IGNORE_SPELLS_GRANTED_BY_FEATS so
 * the spell parser leaves those copies to us.
 */
export default class MagicInitiate extends DDBEnricherData {

  // The feat is a container for the granted spells; it has no action of its own.
  get type() {
    return null;
  }

  get _featName(): string {
    return this.ddbParser.ddbDefinition.name;
  }

  // Cantrips carry no limitedUse, so the default onlyLimitedUse would hide them.
  get _grantedSpells(): any[] {
    return this._getSpellsForFeature({
      type: "feat",
      name: this._featName,
      onlyLimitedUse: false,
    });
  }

  get additionalActivities(): IDDBAdditionalActivity[] {
    // The muncher parses the feat without a character, so nothing was chosen.
    if (this.ddbParser.isMuncher) return [];

    return buildGrantedSpellCastActivities(this._grantedSpells, {
      castType: DDBEnricherData.ACTIVITY_TYPES.CAST,
    });
  }

  get override(): IDDBOverrideData {
    // Only the levelled spell has a limited use; a cantrip-only variant must not
    // put an empty pool on the feat.
    if (!this._grantedSpells.some((spell) => spell.limitedUse)) return null;

    return {
      uses: this._getSpellUsesWithSpent({
        type: "feat",
        name: this._featName,
      }),
      // Survive a re-import with the free cast still spent.
      retainUseSpent: true,
    };
  }

}
