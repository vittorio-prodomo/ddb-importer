import DDBCharacter from "../../DDBCharacter";
import { logger } from "../../../lib/_module";
import {
  choiceAddendumHtml,
  compendiumLookupNames,
  describesExactlyTheseChoices,
  isSpellChoice,
  linkifyOriginFeat,
  resolveChoicesByComponent,
  skillReference,
  stripDanglingFeatHeader,
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
  "dnd5e.feats24",
  "dnd5e.classes24",
];

/**
 * Searched first for a choice that hands out spells.
 *
 * ⚠️ Order matters beyond preference: several spell names collide with other
 * document types — "Shield" is a spell AND a piece of equipment — so a spell
 * choice has to meet the spell packs before anything else.
 */
const SPELL_LINK_PACKS = [
  "dnd-players-handbook.spells",
  "dnd5e.spells24",
];

/**
 * Ability scores never have a document to link, and appear as choice options
 * often enough (Magic Initiate's casting ability, ASI feats) to be worth
 * skipping rather than indexing packs for.
 */
const ABILITY_LABELS = new Set([
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
]);

/**
 * Compendium uuid for a chosen entity, or null.
 *
 * Name-based, because that is all the choice gives us: DDB's option id is its own
 * id space and has no bearing on a Foundry compendium's ids.
 */
async function findEntityUuid(label: string, groupLabel: string | null): Promise<string | null> {
  const packs = isSpellChoice(groupLabel)
    ? [...SPELL_LINK_PACKS, ...ENTITY_LINK_PACKS]
    : [...ENTITY_LINK_PACKS, ...SPELL_LINK_PACKS];
  for (const collection of packs) {
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

/**
 * T215, Foundry side — the background's "Feat: <name>" summary line becomes a
 * link to the origin feat's compendium entry (same pack order as the choice
 * addenda, official rulebooks first), and any dangling trailing header is
 * stripped for good measure (`generateBackground` no longer emits one, but the
 * transform is cheap and keeps this method correct on its own).
 *
 * Only the 2024 shape qualifies: `featureName` set, `featureDescription` empty.
 * A 2014 background's feature text and a homebrew's custom text stay untouched.
 */
DDBCharacter.prototype._linkBackgroundOriginFeat = async function _linkBackgroundOriginFeat(this: DDBCharacter) {
  const background = (this as any).source?.ddb?.character?.background;
  const definition = background?.hasCustomBackground === true
    ? background?.customBackground
    : background?.definition ?? background?.customBackground;
  const featName = (definition?.featureName ?? "").trim();
  const featureDescription = (definition?.featureDescription ?? "").trim();
  if (!featName || featureDescription !== "") return;

  const feature = (this.data.features as any[]).find((f) =>
    foundry.utils.getProperty(f, "flags.ddbimporter.type") === "background");
  if (!feature?.system?.description) return;

  let description = feature.system.description.value ?? "";
  description = stripDanglingFeatHeader(description, featName);
  const uuid = await findEntityUuid(featName, "Feat");
  if (uuid) {
    description = linkifyOriginFeat(description, featName, uuid);
  } else {
    logger.debug(`No compendium entry found while linking origin feat "${featName}" on ${feature.name}`);
  }
  feature.system.description.value = description;
};

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

    // Anything that names a document gets linked — a feat resolved through the
    // feats list, and equally a spell picked from a pool (Abjuration Savant's two
    // free spellbook entries, Magic Initiate's cantrips).
    //
    // ⚠️ Skills and ability scores are skipped deliberately: a skill renders as a
    // Reference enricher to its rule page instead, and an ability has no document
    // at all — attempting either only risks a false match on a same-named feat.
    for (const choice of choices) {
      if (choice.uuid !== undefined) continue;
      if (skillReference(choice.label)) continue;
      if (ABILITY_LABELS.has(choice.label.trim().toLowerCase())) continue;
      choice.uuid = await findEntityUuid(choice.label, choice.groupLabel);
    }

    const addendum = choiceAddendumHtml(choices);
    if (!addendum) continue;

    feature.system.description.value = `${description}${addendum}`;
    feature.flags.ddbimporter.choiceAddendumApplied = true;
    applied.push(`${feature.name}: ${labels.join(", ")}`);
  }

  logger.debug("DDB choice-addendum pass", { applied, skipped });
};
