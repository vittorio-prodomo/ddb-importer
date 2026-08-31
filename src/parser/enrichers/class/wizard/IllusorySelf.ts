import DDBEnricherData from "../../data/DDBEnricherData";

export default class IllusorySelf extends DDBEnricherData {

  get activity(): IDDBActivityData {
    return {
      name: "Illusory Self",
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
            scaling: { allowed: false, max: "" },
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
                target: "2",
                scaling: { mode: "level", formula: "" },
              },
            ],
          },
        },
      },
    ];
  }

}
