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
      // FORK PATCH (queue T212, 2026-09-01): self-targeted — the imported "1 creature"
      // target made Argon open its target picker on click; the owned module
      // dnd5e-declared-advantage asks WHICH benefit in its own dialog instead.
      targetType: "self",
      rangeSelf: true,
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
        // FORK PATCH (queue T212, 2026-09-01): the Advantage half is IMPLEMENTED by the
        // owned module `dnd5e-declared-advantage` (a pre-roll prompt on dnd5e's own
        // roll-configuration seam, keyed on `system.identifier === "lucky"` + a 2024
        // signal). The old midi optional-flag `reroll-kh` changes were an informed
        // reroll — the 2014 feat's timing, anti-RAW for 2024 ("When you roll a d20 for
        // a D20 Test, you can spend 1 Luck Point to give yourself Advantage on the
        // roll"). This effect now carries no changes: it exists for the hover text.
        name: "Lucky: Advantage",
        options: {
          transfer: true,
          // FORK PATCH (queue T156): each half carries its own concise hover text —
          // without a description VAE falls back to the feat's full text on BOTH buffs.
          description: "<p>When you roll a d20 for a D20 Test, you can spend 1 Luck Point to give yourself Advantage on the roll.</p>",
        },
      },
      {
        // Bare "ItemMacro" (no document passed): midi rewrites it to this feat's
        // uuid for transfer effects (utils.ts:1057) — uuid-robust across renames.
        name: "Lucky: Disadvantage (when attacked)",
        midiOnly: true,
        options: {
          transfer: true,
          // FORK PATCH (queue T156): see the Advantage half above.
          description: "<p>Spend a Luck Point when a creature makes an attack roll against you to impose Disadvantage on that roll.</p>",
        },
        onUseMacroChanges: [
          { macroPass: "isPreAttacked", macroType: "feat", macroName: "lucky2024Disadvantage.js" },
        ],
      },
    ];
  }

}
