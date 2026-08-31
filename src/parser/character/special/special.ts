import DDBCharacter from "../../DDBCharacter";
import { declaresSleepImmunity, hasSleepImmunityEffect, sleepImmunityEffect } from "./sleepImmunity";

/**
 * Attach the "magic can't put you to sleep" immunity to the FEATURE that grants
 * it, rather than writing it onto the actor's traits.
 *
 * ⚠️ Changed 2026-08-31 (Vittorio's call). This used to do
 * `system.traits.ci.custom = [...customs].join(";")`, which produced the
 * infamous `";Sleep"` (an upstream `split(":")` / `join(";")` mismatch) and left
 * the immunity with no visible source: the sheet never said which feature
 * granted it, and Visual Active Effects — which lists Active Effects, not
 * features — had nothing to show. As a transfer effect on Trance it is visible,
 * traceable, and travels with the feature.
 *
 * The resulting `ci.custom` string is unchanged, so GPS's `doesNotSleep`
 * predicate keeps matching exactly as before.
 */
DDBCharacter.prototype._addSpecialAdditions = function _addSpecialAdditions(this: DDBCharacter) {
  const checkList = this.data.features.concat(this.data.actions);

  for (const feature of checkList) {
    if (!declaresSleepImmunity(feature as any)) continue;
    if (hasSleepImmunityEffect(feature as any)) continue;
    if (!Array.isArray((feature as any).effects)) (feature as any).effects = [];
    (feature as any).effects.push(sleepImmunityEffect(feature.name, (feature as any).img));
  }
};
