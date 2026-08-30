import DDBEnricherData from "../../data/DDBEnricherData";
import { buildPrimalCompanionActivities } from "../../data/primalCompanionActivities";

// Stable 16-char activity ids (Foundry's embedded-document id convention —
// matches the length of the pre-existing "summonPriCSclNe1"). Kept as
// hardcoded constants rather than generated so a re-import doesn't churn them.
const SUMMON_ACTIVITY_ID = "summonPriCSclNe1";
const RESTORE_ACTIVITY_ID = "restorePriCSclN1";

export default class PrimalCompanion extends DDBEnricherData {

  get activity(): IDDBActivityData {
    if (this.is2014) {
      return {
        name: "Command",
        type: DDBEnricherData.ACTIVITY_TYPES.UTILITY,
        activationType: "bonus",
      };
    }

    // 2024: the summon IS the item's primary activity — dnd5e's own Summon
    // activity replaces the old CPR-premade beast swap. Restore is added
    // below via additionalActivities. Task 3 fills `profiles` once the three
    // world-actor beast forms exist; this item ships with none.
    const { summon } = buildPrimalCompanionActivities();
    return {
      id: SUMMON_ACTIVITY_ID,
      name: summon.name,
      type: DDBEnricherData.ACTIVITY_TYPES.SUMMON,
      // The pure builder returns a plain (Foundry-free) object, so its string
      // fields come back widened to `string` — cast at this Foundry-API seam.
      activationType: summon.activation.type as TActivationCost,
      data: {
        duration: summon.duration,
        match: summon.match,
        bonuses: summon.bonuses,
        profiles: summon.profiles,
        summon: summon.summon,
      },
    };
  }

  get additionalActivities(): IDDBAdditionalActivity[] {
    if (this.is2014) {
      return [
        {
          init: {
            name: "Summon",
            type: DDBEnricherData.ACTIVITY_TYPES.SUMMON,
          },
          build: {
            generateRange: true,
            generateSummon: true,
            generateConsumption: true,
          },
          overrides: {
            id: "summonPriCSclNe1",
            summons: {
              "bonuses": {
                "attackDamage": "@prof",
              },
              match: {
                proficiency: true,
                attacks: true,
                saves: true,
              },
            },
          },
        },
        {
          init: {
            name: "Summon With Spell Slot",
            type: DDBEnricherData.ACTIVITY_TYPES.FORWARD,
          },
          build: {
          },
          overrides: {
            activationType: "action",
            activationCondition: "Takes 1 minute to be restored to life",
            data: {
              activity: {
                id: "summonPriCSclNe1",
              },
              consumption: {
                targets: [
                  {
                    type: "spellSlots",
                    value: "1",
                    target: "1",
                    scaling: {},
                  },
                ],
                scaling: {
                  allowed: true,
                  max: "",
                },
                spellSlot: true,
              },
              uses: { spent: null, max: "" },
              midiProperties: {
                confirmTargets: "default",
              },
            },
          },
        },
      ];
    }

    // 2024: exactly one additional activity — Restore, a plain slot-consuming
    // Heal. No FORWARD, no per-form utility activities; the summon above is
    // the only other activity on the item.
    const { restore } = buildPrimalCompanionActivities();
    return [
      {
        init: {
          name: restore.name,
          type: DDBEnricherData.ACTIVITY_TYPES.HEAL,
        },
        build: {
        },
        overrides: {
          id: RESTORE_ACTIVITY_ID,
          activationType: restore.activation.type as TActivationCost,
          data: {
            consumption: restore.consumption,
            healing: restore.healing,
            uses: { spent: null, max: "" },
            midiProperties: {
              confirmTargets: "default",
            },
          },
        },
      },
    ];
  }

  get override(): IDDBOverrideData {
    if (this.is2014) return null;

    // Keep CPR's non-automated premade swap off this item — the native
    // Summon activity above supersedes it — and stamp the identifier
    // reconciliation (Task 3) and any downstream lookup key off of.
    return {
      data: {
        system: {
          identifier: "primal-companion",
        },
        flags: {
          ddbimporter: {
            ignoreItemForChrisPremades: true,
          },
          // Concise per-activity HUD tooltips, read by our Argon dnd5e fork
          // (flags["enhancedcombathud-dnd5e"].activityTooltips[<activity type>])
          // in place of the whole feature's rules dump.
          "enhancedcombathud-dnd5e": {
            activityTooltips: {
              // Rulebook concepts ONLY in player-facing text (Vittorio's standing
              // rule, 2026-08-30) — no Foundry-mechanics explainers.
              summon: "<p>Magically summon a primal beast, choosing its stat block — Beast of the Land, Sea, or Sky — and the kind of animal it is. The beast is Friendly to you and your allies and obeys your commands. It vanishes if you die.</p>",
              heal: "<p>If the beast has died within the last hour, you can take a Magic action to touch it and expend a spell slot. The beast returns to life after 1 minute with all its Hit Points.</p>",
            },
          },
        },
      },
    };
  }

  get parseAllChoiceFeatures() {
    return true;
  }

}
