import DDBEnricherData from "../data/DDBEnricherData";

export default class Lucky extends DDBEnricherData {

  get type() {
    if (this.featureType !== "feat") return null;
    return DDBEnricherData.ACTIVITY_TYPES.UTILITY;
  }

  get activity(): IDDBActivityData {
    if (this.featureType !== "feat") return null;
    return {
      name: "Spend Luck Point",
      activationType: "special",
      addItemConsume: true,
    };
  }

  get override(): IDDBOverrideData {
    if (this.featureType !== "feat") return null;
    const uses = this._getUsesWithSpent({
      type: "feat",
      name: "Luck Points",
      max: this.is2014 ? "3" : "@prof",
      period: "lr",
    });
    const override: IDDBOverrideData = {
      uses,
    };
    if (!this.is2014) {
      // The 2024 build below (optional-bonus + ItemMacro effects) supersedes
      // CPR's non-automated Lucky shell — keep premade-at-import off this item.
      override.data = {
        flags: {
          ddbimporter: {
            ignoreItemForChrisPremades: true,
          },
        },
      };
    }
    return override;
  }

  get itemMacro(): IDDBItemMacro | null {
    // 2024 feat only — the disadvantage half fires as an isPreAttacked TARGET
    // onUse macro; 2014 Lucky is semantically different and stays manual.
    if (this.featureType !== "feat" || this.is2014) return null;
    return {
      type: "feat",
      name: "lucky2024Disadvantage.js",
    };
  }

  get effects(): IDDBEffectHint[] {
    if (this.featureType === "race") {
      return [
        {
          options: {
            transfer: true,
          },
          changes: [
            DDBEnricherData.ChangeHelper.overrideChange("true", 20, "flags.dnd5e.halflingLucky"),
          ],
        },
      ];
    }

    if (this.featureType !== "feat" || this.is2014) return [];

    return [
      {
        name: "Lucky: Advantage",
        midiOnly: true,
        options: {
          transfer: true,
        },
        midiOptionalChanges: [
          {
            name: "Lucky",
            data: {
              label: "Lucky",
              count: "ItemUses.Lucky",
              "attack.all": "reroll-kh",
              "check.all": "reroll-kh",
              "save.all": "reroll-kh",
            },
          },
        ],
      },
      {
        // Bare "ItemMacro" (no document passed): midi rewrites it to this feat's
        // uuid for transfer effects (utils.ts:1057) — uuid-robust across renames.
        name: "Lucky: Disadvantage (when attacked)",
        midiOnly: true,
        options: {
          transfer: true,
        },
        onUseMacroChanges: [
          { macroPass: "isPreAttacked", macroType: "feat", macroName: "lucky2024Disadvantage.js" },
        ],
      },
    ];
  }

}
