import DDBEnricherData from "../data/DDBEnricherData";

export default class DancingLights extends DDBEnricherData {

  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.SUMMON;
  }

  get summonsFunction() {
    return DDBImporter.lib.DDBSummonsInterface.getDancingLights;
  }

  get generateSummons() {
    return true;
  }

  get activity(): IDDBActivityData {
    return {
      noTemplate: true,
      profileKeys: [
        { count: 4, name: "DancingLightsYellow" },
        { count: 4, name: "DancingLightsBlueTeal" },
        { count: 4, name: "DancingLightsGreen" },
        { count: 4, name: "DancingLightsBlueYellow" },
        { count: 4, name: "DancingLightsPink" },
        { count: 4, name: "DancingLightsPurpleGreen" },
        { count: 4, name: "DancingLightsRed" },
        // FORK (T235): "...Alternatively, you combine the four lights into one glowing Medium
        // form that is vaguely humanlike."
        { count: 1, name: "DancingLightsMediumYellow" },
        { count: 1, name: "DancingLightsMediumBlueTeal" },
        { count: 1, name: "DancingLightsMediumGreen" },
        { count: 1, name: "DancingLightsMediumBlueYellow" },
        { count: 1, name: "DancingLightsMediumPink" },
        { count: 1, name: "DancingLightsMediumPurpleGreen" },
        { count: 1, name: "DancingLightsMediumRed" },
      ],
      summons: {
      },
    };
  }

  /**
   * FORK (T235): keep THIS version. CPR has no Dancing Lights of its own — its "premade" is the
   * official `dnd5e.spells24` copy, so the swap replaced the coloured, animated orbs (and now
   * the Medium form) with the plain compendium spell on every import. The movement rules —
   * the 120 ft range, lights within 20 ft of each other, the Bonus Action — are not here but
   * in the owned module `dnd5e-summon-tethers`, keyed on the spell's name.
   */
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

}
