import DDBEnricherData from "../../data/DDBEnricherData";
import Maneuver from "./Maneuver";

export default class ManeuverManeuveringAttack extends Maneuver {
  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.DAMAGE;
  }

  get activity(): IDDBActivityData {
    return {
      // ⚠️ `activity` OVERRIDES the base getter, it does not merge with it — so every key the
      // base `Maneuver` sets has to be restated here or it is silently lost. Omitting
      // `activationType` is what made this maneuver the only one on the sheet reading "Action":
      // with no override, `DDBEnricherFactoryMixin` leaves the activation D&D Beyond's own parse
      // produced. RAW it is a rider on a hit and costs no action, exactly like Goading Attack.
      activationType: "special",
      data: {
        damage: {
          onSave: "none",
          parts: [
            DDBEnricherData.basicDamagePart({
              customFormula: this.diceString,
              types: DDBEnricherData.allDamageTypes(),
            }),
          ],
        },
      },
    };
  }

}
