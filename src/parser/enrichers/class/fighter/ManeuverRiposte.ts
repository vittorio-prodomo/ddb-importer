import DDBEnricherData from "../../data/DDBEnricherData";
import Maneuver from "./Maneuver";


export default class ManeuverRiposte extends Maneuver {
  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.UTILITY;
  }

  // Riposte IS a Reaction (2024 PHB), and its two reaction-shaped siblings say so — `ManeuverBrace`
  // and `ManeuverParry` both set `activationType: "reaction"`. Riposte simply never declared an
  // `activity`, so it inherited the base `Maneuver` blanket `"special"` that suits the *rider*
  // maneuvers. `midiManualReaction` below is orthogonal: it sets `useConditionText = "false"` so
  // midi never auto-fires the activity, which is why Brace can be reaction-typed and manual at once.
  // `targetType`/`addItemConsume` are restated because this getter OVERRIDES the base, never merges.
  get activity(): IDDBActivityData {
    return {
      activationType: "reaction",
      targetType: "creature",
      addItemConsume: true,
    };
  }

  get override(): IDDBOverrideData {
    return {
      midiManualReaction: true,
      ignoredConsumptionActivities: this.ignoredConsumptionActivities,
      data: {
        name: this.data.name.replace("Maneuver Options:", "Maneuver:").replace("Maneuvers:", "Maneuver: "),
      },
    };
  }

  get additionalActivities(): IDDBAdditionalActivity[] {
    return [
      this.extraDamageActivity(),
    ];
  }

  get effects(): IDDBEffectHint[] {
    return [
      {
        daeSpecialDurations: ["1Attack:mwak" as const],
        data: {
          duration: {
            turns: 2,
          },
        },
        midiChanges: [
          DDBEnricherData.ChangeHelper.unsignedAddChange(this.diceString, 20, "system.bonuses.mwak.damage"),
        ],
      },
    ];
  }

}
