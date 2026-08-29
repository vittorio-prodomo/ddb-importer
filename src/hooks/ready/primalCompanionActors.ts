import { logger } from "../../lib/_module";
import {
  planCompanionReconciliation,
  PRIMAL_COMPANION_FORMS,
  type TPrimalCompanionForm,
} from "../../parser/spells/primalCompanionPlan";

/**
 * World-actor reconciliation for the native-summon Primal Companion (Task 3,
 * `2026-08-29-primal-companion-native`). Task 2's enricher stamps the
 * `primal-companion` feature's identifier and ships its Summon activity with
 * `profiles: []`; this hook is what fills those pointers in, backing the
 * three 2024 Ranger forms (Land/Sea/Sky) with ONE persistent world actor each
 * -- shared by every character that ever summons that form, cloned from the
 * PHB shell once and never touched again.
 *
 * GM-side, single-writer (`activeGM.isSelf`): actor creation and the item
 * write must not race across clients the way a per-client pass would.
 */

const PHB_ACTOR_PACK = "dnd-players-handbook.actors";
const PHB_SHELL_NAMES: Record<TPrimalCompanionForm, string> = {
  land: "Beast of the Land",
  sea: "Beast of the Sea",
  sky: "Beast of the Sky",
};

// Verified live 2026-08-29: "Dodge" lives in CPRActions2024, but "Generic
// Actions (2024)" actually lives in CPRMiscellaneous, not CPRActions2024 as
// first assumed. Resolving by identifier across every chris-premades Item
// pack (rather than trusting one pack name for both) survives that kind of
// reshuffle -- the same reasoning the PHB-shell lookup already uses.
const CPR_LOADOUT_IDENTIFIERS = ["dodge", "genericActions"];

async function resolvePhbShell(form: TPrimalCompanionForm): Promise<Actor.Implementation | null> {
  const pack = game.packs.get(PHB_ACTOR_PACK);
  if (!pack) {
    logger.error(`Primal Companion reconciliation: pack "${PHB_ACTOR_PACK}" not found`);
    return null;
  }
  const name = PHB_SHELL_NAMES[form];
  const index = await pack.getIndex({ fields: ["name"] });
  const hit = index.find((entry) => entry.name === name);
  if (!hit) {
    logger.error(`Primal Companion reconciliation: shell "${name}" not found in ${PHB_ACTOR_PACK}`);
    return null;
  }
  return fromUuid(hit.uuid) as Promise<Actor.Implementation | null>;
}

async function resolveCprLoadout(identifiers: string[]): Promise<Item.Implementation[]> {
  const hits = new Map<string, { uuid: string }>();
  const packs = game.packs.filter((pack) => pack.metadata.id.startsWith("chris-premades.") && pack.documentName === "Item");

  for (const pack of packs) {
    if (hits.size === identifiers.length) break;
    const index = await pack.getIndex({ fields: ["flags.chris-premades.info.identifier"] });
    for (const identifier of identifiers) {
      if (hits.has(identifier)) continue;
      const entry = index.find((candidate) =>
        foundry.utils.getProperty(candidate, "flags.chris-premades.info.identifier") === identifier);
      if (entry) hits.set(identifier, entry as { uuid: string });
    }
  }

  const docs: Item.Implementation[] = [];
  for (const identifier of identifiers) {
    const hit = hits.get(identifier);
    if (!hit) {
      logger.error(`Primal Companion reconciliation: CPR item with identifier "${identifier}" not found`);
      continue;
    }
    const doc = await fromUuid(hit.uuid) as Item.Implementation | null;
    if (doc) docs.push(doc);
  }
  return docs;
}

function existingCompanionForms(): Partial<Record<TPrimalCompanionForm, string>> {
  const result: Partial<Record<TPrimalCompanionForm, string>> = {};
  for (const worldActor of game.actors.contents) {
    const form = foundry.utils.getProperty(worldActor, "flags.ddbimporter.primalCompanionForm") as
      TPrimalCompanionForm | undefined;
    if (form && PRIMAL_COMPANION_FORMS.includes(form) && !result[form]) {
      result[form] = worldActor.uuid;
    }
  }
  return result;
}

/**
 * Clone the PHB shell for `form` into a brand-new world actor, add the CPR
 * loadout (Dodge + Generic Actions -- the shell itself already carries
 * Primal Bond and Beast's Strike), and stamp the form flag. Returns the new
 * actor's uuid, or null on any resolution failure (logged, not thrown --
 * this must never take down an otherwise-successful import).
 */
async function createCompanionActor(form: TPrimalCompanionForm): Promise<string | null> {
  const shell = await resolvePhbShell(form);
  if (!shell) return null;

  const data = shell.toObject();
  delete data._id;
  // The shell's folder id is a COMPENDIUM-local folder -- meaningless (and
  // potentially confusing) once cloned into the world Actors directory.
  delete data.folder;
  foundry.utils.setProperty(data, "flags.ddbimporter.primalCompanionForm", form);

  const created = await Actor.create(data) as Actor.Implementation | undefined;
  if (!created) {
    logger.error(`Primal Companion reconciliation: failed to create the "${form}" world actor`);
    return null;
  }

  const loadout = await resolveCprLoadout(CPR_LOADOUT_IDENTIFIERS);
  if (loadout.length > 0) {
    const toCreate = loadout.map((doc) => {
      const itemData = doc.toObject();
      delete itemData._id;
      return itemData;
    });
    await created.createEmbeddedDocuments("Item", toCreate);
  }

  logger.info(`Primal Companion reconciliation: created the "${form}" world actor`, { uuid: created.uuid });
  return created.uuid;
}

async function reconcilePrimalCompanion(actor): Promise<void> {
  if (!game.users?.activeGM?.isSelf) return;
  if (!actor?.items) return;

  const item = actor.items.find((i) => i.identifier === "primal-companion");
  if (!item) return;

  // ⚠️ item.system.activities is an ActivityCollection -- discover the
  // summon activity BY TYPE, never by a hardcoded id (Task 2 mints its own).
  const summonActivity = item.system?.activities?.getByType?.("summon")?.[0];
  if (!summonActivity) return;

  const existingForms = existingCompanionForms();
  const profiles = summonActivity.profiles ?? [];
  const plan = planCompanionReconciliation({ existingForms, profiles });

  for (const form of plan.createForms) {
    const uuid = await createCompanionActor(form);
    if (uuid) existingForms[form] = uuid;
  }

  // Re-plan against the now-complete map so a batch created THIS pass is
  // pointed at immediately, rather than deferred to the next import.
  const finalPlan = plan.createForms.length > 0
    ? planCompanionReconciliation({ existingForms, profiles })
    : plan;

  if (finalPlan.profileUpdate) {
    await item.update({ [`system.activities.${summonActivity.id}.profiles`]: finalPlan.profileUpdate });
    logger.info("Primal Companion reconciliation: pointed profiles at the world actors", {
      profiles: finalPlan.profileUpdate,
    });
  }
}

export function setupPrimalCompanionActors(): void {
  Hooks.on("ddb-importer.characterProcessDataComplete", ({ actor }) => {
    reconcilePrimalCompanion(actor).catch((error) => {
      logger.error("Primal Companion reconciliation failed", { error, actor });
    });
  });
}
