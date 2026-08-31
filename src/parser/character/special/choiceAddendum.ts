import DDBCharacter from "../../DDBCharacter";
import { logger } from "../../../lib/_module";
import {
  choiceAddendumHtml,
  compendiumLookupNames,
  describesExactlyTheseChoices,
  resolveChoicesByComponent,
} from "./grantedChoices";

/**
 * Packs consulted when linking a chosen ENTITY, best first.
 *
 * ⚠️ The official rulebook modules come before the system's SRD packs on purpose
 * — Vittorio owns them and they are the fuller text (standing preference, see
 * [[official-2024-compendiums]]). A pack that is not installed is simply absent
 * from `game.packs` and skipped.
 */
const ENTITY_LINK_PACKS = [
  "dnd-players-handbook.feats",
  "dnd-players-handbook.classes",
  "dnd-players-handbook.origins",
  "dnd-players-handbook.spells",
  "dnd5e.feats24",
  "dnd5e.classes24",
];

/**
 * Compendium uuid for a chosen entity, or null.
 *
 * Name-based, because that is all the choice gives us: DDB's option id is its own
 * id space and has no bearing on a Foundry compendium's ids.
 */
async function findEntityUuid(label: string): Promise<string | null> {
  for (const collection of ENTITY_LINK_PACKS) {
    const pack = game.packs.get(collection);
    if (!pack) continue;
    let index;
    try {
      index = await pack.getIndex();
    } catch (error: unknown) {
      logger.debug(`Could not index ${collection} while linking a chosen entity`, error);
      continue;
    }
    for (const candidate of compendiumLookupNames(label)) {
      const hit = index.find((entry: any) => entry.name === candidate);
      if (hit) return hit.uuid ?? `Compendium.${collection}.Item.${hit._id}`;
    }
  }
  return null;
}

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
DDBCharacter.prototype._addChoiceAddenda = async function _addChoiceAddenda(this: DDBCharacter) {
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

    // Only an ENTITY pick (poolId null — a feat, a spell) can have a compendium
    // document behind it; a skill or an ability score cannot, and stays plain text.
    for (const choice of choices) {
      if (choice.poolId === null && choice.uuid === undefined) {
        choice.uuid = await findEntityUuid(choice.label);
      }
    }

    const addendum = choiceAddendumHtml(choices);
    if (!addendum) continue;

    feature.system.description.value = `${description}${addendum}`;
    feature.flags.ddbimporter.choiceAddendumApplied = true;
    applied.push(`${feature.name}: ${labels.join(", ")}`);
  }

  logger.debug("DDB choice-addendum pass", { applied, skipped });
};
