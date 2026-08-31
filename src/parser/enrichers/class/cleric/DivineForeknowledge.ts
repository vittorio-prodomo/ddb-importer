import { DICTIONARY } from "../../../../config/_module";
import DDBEnricherData from "../../data/DDBEnricherData";

export default class DivineForeknowledge extends DDBEnricherData {

  get activity(): IDDBActivityData {
    return {
      name: "Divine Foreknowledge",
    };
  }

  get additionalActivities(): IDDBAdditionalActivity[] {
    return [
      {
        init: {
          name: "Spend Spell Slot to Restore Use",
          type: DDBEnricherData.ACTIVITY_TYPES.UTILITY,
        },
        build: {
          generateConsumption: true,
          generateTarget: true,
          generateActivation: true,
          generateUtility: true,
          activationOverride: {
            type: "none",
            value: null,
            condition: "",
          },
          consumptionOverride: {
            // Slot level is pure cost here: the paired `itemUses: -1` restores
            // exactly ONE use whatever slot is spent, so there is nothing to
            // choose. `allowed: false` removes the level input; the cheapest
            // usable slot at or above the target level below is then stamped
            // generically by `dnd5e-lowest-slot-cast` at `dnd5e.preUseActivity`.
            scaling: { allowed: false, max: "4" },
            targets: [
              {
                type: "itemUses",
                target: "",
                value: -1,
                scaling: { mode: "", formula: "" },
              },
              {
                type: "spellSlots",
                value: "1",
                target: "6",
                scaling: { mode: "level", formula: "" },
              },
            ],
          },
        },
      },
    ];
  }

  get effects(): IDDBEffectHint[] {
    const changes = [
      DDBEnricherData.ChangeHelper.addChange(`${CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE}`, 20, "system.attributes.death.roll.mode"),
    ];

    DICTIONARY.actor.abilities.forEach((ability) => {
      changes.push(
        DDBEnricherData.ChangeHelper.addChange(`${CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE}`, 20, `system.abilities.${ability.value}.check.roll.mode`),
        DDBEnricherData.ChangeHelper.addChange(`${CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE}`, 20, `system.abilities.${ability.value}.save.roll.mode`),
      );
    });
    return [
      {
        changes,
        options: {
          durationSeconds: 3600,
        },
      },
    ];
  }

}
