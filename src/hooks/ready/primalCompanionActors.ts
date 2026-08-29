import { logger } from "../../lib/_module";
import {
  decideReconcileRoute,
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
 * GM-side, single-writer: actor creation and the item write must not race
 * across clients the way a per-client pass would. Two mechanisms make that
 * true (both added in fix round 1, review findings Critical + Important):
 *
 * 1. `ddb-importer.characterProcessDataComplete` is a LOCAL `Hooks.callAll` --
 *    it only fires on the importing user's own client. A player re-importing
 *    their own PC never reaches a GM client through the hook alone, so the
 *    reconcile must be ROUTED to whichever client actually is the active GM
 *    (`decideReconcileRoute`, `registerPrimalCompanionQuery`) rather than
 *    silently dropped when the importing client isn't itself the GM.
 * 2. On the GM client, every reconcile -- whether triggered locally or via
 *    the query -- is serialized through one global promise chain
 *    (`queueReconcile`/`inflight`). This is a world-singleton reconcile
 *    (three actors total, never per-actor), so two imports landing close
 *    together must not both read an empty `existingForms` and both create
 *    Land/Sea/Sky.
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

// Registered against CONFIG.Queries in src/types/foundry-globals.d.ts -- keep
// that literal key in sync with this constant by hand (interface keys can't
// reference a runtime const).
const RECONCILE_QUERY_NAME = "ddb-importer.primalCompanionReconcile";

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

interface ExistingCompanionActor {
  actor: Actor.Implementation;
  uuid: string;
}

/**
 * Scan the world for already-flagged companion actors. Returns the actor
 * document itself (not just its uuid) so the reconcile can both plan against
 * it (uuid, current actorLink) and apply a fix directly to it -- no second
 * lookup needed.
 */
function existingCompanionActors(): Partial<Record<TPrimalCompanionForm, ExistingCompanionActor>> {
  const result: Partial<Record<TPrimalCompanionForm, ExistingCompanionActor>> = {};
  for (const worldActor of game.actors.contents) {
    const form = foundry.utils.getProperty(worldActor, "flags.ddbimporter.primalCompanionForm") as
      TPrimalCompanionForm | undefined;
    if (form && PRIMAL_COMPANION_FORMS.includes(form) && !result[form]) {
      result[form] = { actor: worldActor, uuid: worldActor.uuid };
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
  // Fix round 2 (review finding): the PHB shell's own prototype token ships
  // actorLink: true (verified live 2026-08-29). With a linked token, dnd5e's
  // native Summon activity clones a brand-new PERMANENT world actor per
  // summon instead of placing an unlinked token+delta -- every summon would
  // litter the sidebar. Force false regardless of what the shell carries;
  // never trust the shell's own value for this field.
  foundry.utils.setProperty(data, "prototypeToken.actorLink", false);

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

/**
 * The actual business logic. Callers (`queueReconcile`'s chain, invoked from
 * either the local branch or the GM query handler below) are responsible for
 * having already established this is running GM-side -- this function no
 * longer gates on `activeGM.isSelf` itself (fix round 1: that gate used to
 * live here as a silent `return`, which is exactly the "drop instead of
 * route" bug the review flagged; the gate is now the routing decision at the
 * two entry points, not a drop buried in the business logic).
 */
async function reconcilePrimalCompanion(actor): Promise<void> {
  if (!actor?.items) return;

  const item = actor.items.find((i) => i.identifier === "primal-companion");
  if (!item) return;

  // ⚠️ item.system.activities is an ActivityCollection -- discover the
  // summon activity BY TYPE, never by a hardcoded id (Task 2 mints its own).
  const summonActivity = item.system?.activities?.getByType?.("summon")?.[0];
  if (!summonActivity) {
    // Task 2's contract is: this item always ships a summon-type activity.
    // Landing here means that contract broke somewhere upstream -- worth a
    // diagnosable console line, not a silent no-op.
    logger.warn(
      `Primal Companion reconciliation: "${item.name}" on "${actor.name}" has no summon-type activity -- the Task 2 item contract is not met`,
      { actorId: actor.id, itemId: item.id },
    );
    return;
  }

  const existingActors = existingCompanionActors();
  const existingForms: Partial<Record<TPrimalCompanionForm, string>> = {};
  const actorLinkStatus: Partial<Record<TPrimalCompanionForm, boolean>> = {};
  for (const form of PRIMAL_COMPANION_FORMS) {
    const entry = existingActors[form];
    if (!entry) continue;
    existingForms[form] = entry.uuid;
    actorLinkStatus[form] = foundry.utils.getProperty(entry.actor, "prototypeToken.actorLink") === true;
  }

  const profiles = summonActivity.profiles ?? [];
  const plan = planCompanionReconciliation({ existingForms, profiles, actorLinkStatus });

  for (const form of plan.createForms) {
    const uuid = await createCompanionActor(form);
    if (uuid) existingForms[form] = uuid;
  }

  // Re-plan against the now-complete map so a batch created THIS pass is
  // pointed at immediately, rather than deferred to the next import.
  const finalPlan = plan.createForms.length > 0
    ? planCompanionReconciliation({ existingForms, profiles, actorLinkStatus })
    : plan;

  if (finalPlan.profileUpdate) {
    await item.update({ [`system.activities.${summonActivity.id}.profiles`]: finalPlan.profileUpdate });
    logger.info("Primal Companion reconciliation: pointed profiles at the world actors", {
      profiles: finalPlan.profileUpdate,
    });
  }

  // Mechanical field fix, never identity -- name/img/ownership are untouched
  // by this or anything else in this pass. Sourced from `plan`, not
  // `finalPlan`: actorLinkFixes only ever concerns actors that already
  // existed BEFORE this pass (a form just created above is guaranteed
  // actorLink: false already, so it can never appear here either way).
  // The dotted-path key must be a genuinely widened `string`, not a string
  // LITERAL type -- fvtt-types' update() typing excess-property-checks a
  // literal computed key against the actor's schema shape and rejects it
  // (there is no top-level "prototypeToken.actorLink" property), the same
  // way the profiles update above only type-checks because its key is built
  // from a real interpolated variable.
  const actorLinkField = "prototypeToken.actorLink";
  for (const fix of plan.actorLinkFixes) {
    const entry = existingActors[fix.form];
    if (!entry) continue;
    await entry.actor.update({ [actorLinkField as string]: false });
    logger.info(`Primal Companion reconciliation: forced actorLink false on the "${fix.form}" world actor`, {
      uuid: fix.uuid,
    });
  }
}

/**
 * Serializes every reconcile through one global promise chain -- this is a
 * world-singleton reconcile (three actors total, never per-actor), so two
 * runs landing close together on the GM client (a bulk re-import, two Ranger
 * PCs back to back, or a local run racing a queried one) must not both read
 * an empty `existingForms` and both create Land/Sea/Sky. Each run starts
 * only after its predecessor has fully settled, and re-reads
 * `existingCompanionActors()` fresh at that point -- so a run that lands
 * after the singleton already exists just fixes profiles, never re-creates.
 *
 * Deliberately never rejects: errors are caught and logged here so the chain
 * itself is never left in a rejected state that would trip up the next run.
 */
let inflight: Promise<void> = Promise.resolve();

function queueReconcile(actor): Promise<void> {
  const run = inflight
    .then(() => reconcilePrimalCompanion(actor))
    .catch((error) => {
      logger.error("Primal Companion reconciliation failed", { error, actorId: actor?.id });
    });
  inflight = run;
  return run;
}

/**
 * GM-side query handler for player-initiated imports (fix round 1, review
 * finding Critical). Registered at `init` so it's available before this
 * client's own `ready` sequence finishes -- another client may query it as
 * soon as this one is the active GM. SELF-VALIDATING: the caller is
 * untrusted (any user can invoke a `CONFIG.queries` handler, with no
 * requester identity attached), so this re-derives everything from
 * `actorId` alone and re-checks `activeGM.isSelf` itself rather than trusting
 * that whoever called it already confirmed that.
 */
export function registerPrimalCompanionQuery(): void {
  // CONFIG.queries is populated by core before any module's `init` hook runs
  // (unlike the untyped-JS precedent this follows, `??= {}` here would fail
  // to type-check against the now-augmented CONFIG.Queries interface, which
  // requires core's own "dialog"/"confirmTeleportToken" keys too).
  CONFIG.queries[RECONCILE_QUERY_NAME] = async ({ actorId }) => {
    if (!game.users?.activeGM?.isSelf) return { ok: false, reason: "not-active-gm" };

    const actor = game.actors.get(actorId);
    if (!actor) {
      logger.warn(`Primal Companion reconciliation query: actor "${actorId}" not found`);
      return { ok: false, reason: "no-actor" };
    }

    await queueReconcile(actor);
    return { ok: true };
  };
}

export function setupPrimalCompanionActors(): void {
  Hooks.on("ddb-importer.characterProcessDataComplete", ({ actor }) => {
    if (!actor?.id) return;

    const gm = game.users?.activeGM;
    const route = decideReconcileRoute({ activeGMIsSelf: !!gm?.isSelf, hasActiveGM: !!gm });

    if (route === "local") {
      queueReconcile(actor);
      return;
    }
    if (route === "query" && gm) {
      gm.query(RECONCILE_QUERY_NAME, { actorId: actor.id }).catch((error) => {
        logger.error("Primal Companion reconciliation query failed", { error, actorId: actor.id });
      });
      return;
    }
    logger.warn("Primal Companion reconciliation skipped: no GM is connected", { actorId: actor.id });
  });
}
