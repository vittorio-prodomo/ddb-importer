/**
 * Native dnd5e activity data for the 2024 Ranger's Primal Companion feature.
 *
 * The rebuild replaces the old CPR-premade beast (a manually-maintained NPC
 * actor swapped in at import) with dnd5e's own Summon activity, so the beast
 * is a first-class summoned creature the system itself understands — HP/AC/
 * attack scaling, the summon-marker effect on the token, midi's native
 * handling of a summon's actions. This file returns the two activities'
 * payload shape exactly as it will sit under `system.activities.<id>` on the
 * built item; it is Foundry-free (no `game`/`CONFIG`/`foundry.*` reference) so
 * node tests can assert on the shape directly. The enricher
 * (`class/ranger/PrimalCompanion.ts`) is the only consumer — it maps `type`/
 * `activation.type` to the enricher's flat `type`/`activationType` fields and
 * passes everything else through via `data:`.
 *
 * The duration unit "perm" (permanent) is dnd5e's actual key — verified
 * against the installed v13 `dnd5e.mjs` (`DND5E.timePeriods.perm ===
 * "DND5E.TimePerm"`) and matches the existing `trait/shifter/Shifting.ts`
 * precedent (`duration: { units: "perm" }`). This is NOT a placeholder: midi
 * copies this duration onto the Summon marker effect it drops on the
 * caster, so an empty/wrong unit here silently breaks that marker.
 */

export function buildPrimalCompanionActivities() {
  return {
    summon: {
      type: "summon",
      name: "Summon Companion",
      // "special" (not longRest): RAW the summon costs nothing — and Argon's
      // HUD maps special → the Special/free panel, where Vittorio wants it
      // (the T25 CPR-era retype, carried over 2026-08-30). The marker copies
      // the DURATION below, never the activation, so the perm trap is safe.
      activation: {
        type: "special",
      },
      duration: {
        units: "perm",
      },
      match: {
        attacks: true,
        proficiency: true,
        ability: "wis",
        saves: false,
      },
      bonuses: {
        ac: "@abilities.wis.mod",
        hd: "@classes.ranger.levels",
        hp: "@classes.ranger.levels * (@summon.attributes.hd.denomination * 0.5 + 1)",
        attackDamage: "@abilities.wis.mod",
      },
      // Reconciliation (world-actor lookup/creation) owns the profile pointers.
      profiles: [],
      summon: {
        prompt: true,
      },
    },
    restore: {
      // ⚠️ UTILITY, not "heal", deliberately (2026-08-31). The healing is not
      // dnd5e's to do: the module heals the beast to full and clears its death
      // statuses itself, from the marker's own fallen dependent. A heal
      // activity here only ever printed a flat "200" on the chat card — a
      // number that healed nobody (the activity declares no target), that lied
      // about the beast's real max HP, and that WOULD have been misapplied to
      // whatever the player happened to have targeted.
      // Knock-on, both checked: midi still fires `midi-qol.RollComplete` for a
      // utility activity (Workflow.ts — it is the end of the state machine, not
      // gated on damage), so the module's trigger survives; and Automated
      // Animations now reaches the caster-side effect through
      // `dnd5e.postUseActivity` instead of `rollDamageV2`, because that guard
      // early-returns on `type === "heal"` but not on utility.
      type: "utility",
      name: "Restore Companion",
      activation: {
        type: "action",
      },
      consumption: {
        targets: [
          {
            type: "spellSlots",
            value: "1",
            target: "1",
            scaling: {
              mode: "level",
            },
          },
        ],
        // No level slider: 2024 RAW makes the slot level pure cost (nothing
        // scales with it), so the module stamps the cheapest available slot at
        // `dnd5e.preUseActivity` instead of asking. ⚠️ This flag is what draws
        // the slider — a non-spell item never satisfies dnd5e's
        // `requiresSpellSlot`, so the usage dialog falls through to its GENERIC
        // scaling branch and renders a 1–max range input. The consumption
        // TARGET's own `scaling.mode: "level"` above is a different field and
        // must stay: it is what lets the module choose the level at all.
        scaling: {
          allowed: false,
          max: "9",
        },
        spellSlot: true,
      },
    },
  };
}
