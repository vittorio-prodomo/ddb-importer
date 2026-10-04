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
      // FORK (T235 follow-up): TWO choices, as the spell reads — "up to four torch-size lights"
      // or "one glowing Medium form that is vaguely humanlike". The COLOUR is no longer a
      // profile (2 x 7 entries in the system's prompt): the owned module `dnd5e-summon-tethers`
      // asks for it before this prompt and paints it onto the tokens as they are created, so
      // the yellow actors below are only the base it recolours.
      profileKeys: [
        { count: 4, name: "DancingLightsYellow", label: "Dancing Lights" },
        { count: 1, name: "DancingLightsMediumYellow", label: "Medium humanlike form" },
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
