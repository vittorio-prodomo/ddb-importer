import DDBCharacter from "../../DDBCharacter";
import { logger } from "../../../lib/_module";
import { declaresSleepImmunity, hasSleepImmunityEffect, sleepImmunityEffect, SLEEP_IMMUNITY_FEATURES } from "./sleepImmunity";

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

  // ⚠️ T207 diagnostic, kept deliberately. This hook reported nothing while an
  // effect it had provably attached was being discarded LATER, by the CPR swap
  // in `effects/external/ChrisPremadesHelper.ts` (which re-attaches it now). The
  // outcome per candidate is logged so "no effect appeared" can be told apart
  // from "the feature was never in this list" without another instrumented run.
  const seen: Record<string, string> = {};

  for (const feature of checkList) {
    const named = SLEEP_IMMUNITY_FEATURES.includes(feature.name ?? "");
    if (named) {
      const f = feature as any;
      seen[feature.name] = !declaresSleepImmunity(f)
        ? `skipped: type=${f.type} clause=${/magic can[\u2019']t put you to sleep/i.test(f.system?.description?.value ?? "")} descLen=${(f.system?.description?.value ?? "").length}`
        : hasSleepImmunityEffect(f)
          ? "skipped: already has the effect"
          : "applied";
    }
    if (!declaresSleepImmunity(feature as any)) continue;
    if (hasSleepImmunityEffect(feature as any)) continue;
    if (!Array.isArray((feature as any).effects)) (feature as any).effects = [];
    (feature as any).effects.push(sleepImmunityEffect(feature.name, (feature as any).img));
  }

  logger.debug("DDB sleep-immunity pass", {
    candidatesInList: SLEEP_IMMUNITY_FEATURES,
    featureCount: this.data.features.length,
    actionCount: this.data.actions.length,
    outcomes: seen,
    sampleFeatureNames: this.data.features.slice(0, 15).map((f: any) => f.name),
  });
};
