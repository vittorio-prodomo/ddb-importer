import DDBCharacter from "../../DDBCharacter";
import { logger } from "../../../lib/_module";
import {
  choiceAddendumHtml,
  describesExactlyTheseChoices,
  resolveChoicesByComponent,
} from "./grantedChoices";

/**
 * Append "what you chose" to the features that offer a choice but never say what
 * was taken. Rationale, the DDB data shape and the suppression rule all live in
 * `grantedChoices.ts`; this is the Foundry-side glue.
 *
 * ⚠️ Runs over `data.features` AND `data.actions`, and covers every feature type —
 * backgrounds and species traits land in `data.features` too, which is what makes
 * this general rather than a class-feature special case.
 *
 * ⚠️ Safe against the CPR swap (unlike a pushed EFFECT — see quirk #29):
 * `CP_FIELDS_TO_COPY` does not include `system.description`, and the swap's own
 * `copyDescription` copies the DDB text ONTO the premade, so an addendum written
 * here survives. Verified live on Scholar, which CPR does adopt.
 */
DDBCharacter.prototype._addChoiceAddenda = function _addChoiceAddenda(this: DDBCharacter) {
  const ddb = (this as any).source?.ddb;
  if (!ddb) return;

  const byComponent = resolveChoicesByComponent(ddb);
  if (!byComponent.size) return;

  // The selectable labels of each definition, kept SEPARATE by definition id.
  // ⚠️ Never flatten these into one pool: a long description that happens to name
  // labels from an unrelated pool then reads as "offering rivals" and defeats
  // suppression. That is exactly how Merchant restated its own proficiencies on
  // the first live run — its "Ability Scores: Constitution, Intelligence,
  // Charisma" line collided with the ability pool.
  const poolsById = new Map<string, string[]>();
  for (const definition of (ddb.character?.choices?.choiceDefinitions ?? [])) {
    if (definition?.id == null) continue;
    poolsById.set(
      String(definition.id),
      (definition.options ?? []).map((option: any) => String(option?.label ?? "")).filter(Boolean),
    );
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const feature of this.data.features.concat(this.data.actions) as any[]) {
    const ddbId = feature?.flags?.ddbimporter?.id;
    if (ddbId == null) continue;
    const choices = byComponent.get(Number(ddbId));
    if (!choices?.length) continue;

    // Idempotent across re-imports: never stack a second addendum.
    if (feature.flags.ddbimporter.choiceAddendumApplied) continue;

    const description = feature.system?.description?.value ?? "";
    const labels = choices.map((choice) => choice.label);
    const pool = Array.from(new Set(
      choices.flatMap((choice) => (choice.poolId ? poolsById.get(choice.poolId) ?? [] : [])),
    ));
    if (describesExactlyTheseChoices(description, labels, pool)) {
      skipped.push(`${feature.name} (already stated)`);
      continue;
    }

    const addendum = choiceAddendumHtml(choices);
    if (!addendum) continue;

    feature.system.description.value = `${description}${addendum}`;
    feature.flags.ddbimporter.choiceAddendumApplied = true;
    applied.push(`${feature.name}: ${labels.join(", ")}`);
  }

  logger.debug("DDB choice-addendum pass", { applied, skipped });
};
