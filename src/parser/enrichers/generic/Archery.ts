import DDBEnricherData from "../data/DDBEnricherData";

/**
 * Archery fighting style — modelled the way the official 2024 PHB item models
 * it (`dnd-players-handbook.feats.phbfstArchery000`): a transfer effect adding
 * to `system.bonuses.rwak.attack`, so the bonus lives in the actor's derived
 * data, shows in the sheet's to-hit, and applies with no target selected.
 *
 * This deliberately replaces CPR's automation, which injects the bonus from a
 * midi `postAttackRoll` macro — that leaves the sheet showing the UNBUFFED
 * number and, because the macro opens `if (!workflow.targets.size) return`,
 * silently grants nothing when the player shoots without a target. Hence the
 * premade opt-out below; without it a re-import hands the item back to CPR.
 *
 * ⚠️ The vanilla shape over-applies on its own: dnd5e maps a melee weapon
 * thrown (`mwak` + `attackMode: "thrown"`) to `rwak`, so a thrown dagger would
 * collect the bonus, which 2024 RAW does not allow (Archery covers *Ranged*
 * weapons; a Dagger is a Melee weapon with Thrown). The owned module
 * `dnd5e-content-fixups` cancels it for exactly that case — there is no native
 * or DAE way to express the condition, because the bonus key is actor-level
 * derived data while melee-vs-thrown exists only at roll time.
 */
export default class Archery extends DDBEnricherData {

  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.NONE;
  }

  get override(): IDDBOverrideData {
    return {
      data: {
        flags: {
          ddbimporter: {
            ignoreItemForChrisPremades: true,
          },
        },
      },
    };
  }

  get effects(): IDDBEffectHint[] {
    return [
      {
        name: "Archery Style",
        options: {
          transfer: true,
        },
        changes: [
          DDBEnricherData.ChangeHelper.unsignedAddChange("2", 20, "system.bonuses.rwak.attack"),
        ],
      },
    ];
  }

}
