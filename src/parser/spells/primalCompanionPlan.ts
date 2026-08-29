/**
 * World-actor reconciliation for the native-summon Primal Companion (Task 3,
 * `2026-08-29-primal-companion-native`).
 *
 * Task 2's enricher ships the `primal-companion` item's Summon activity with
 * `profiles: []` — reconciliation owns filling those pointers in. The
 * companion has exactly three forms (2024 Ranger's Land/Sea/Sky choice), each
 * backed by ONE persistent world actor shared by every character that ever
 * summons that form: clone the PHB shell once per form, stamp it, and never
 * touch it again. Re-imports (this character's or anyone else's) must be a
 * no-op once all three exist, the item's profiles already point at them, and
 * each actor's `prototypeToken.actorLink` is `false`.
 *
 * Pure: takes a plain snapshot of what already exists, returns a plan. The
 * caller (the ready hook) owns every side effect — actor creation, item
 * copies, the `item.update()` write, the `actor.update()` write.
 */

export type TPrimalCompanionForm = "land" | "sea" | "sky";

/** Fixed, in this order — it is also the order profiles are written in, so
 * an already-conformant `profiles` array can be checked positionally. */
export const PRIMAL_COMPANION_FORMS: TPrimalCompanionForm[] = ["land", "sea", "sky"];

export interface PrimalCompanionSummonProfile {
  name?: string;
  uuid?: string;
  [key: string]: unknown;
}

export interface PlanCompanionReconciliationArgs {
  /** form -> world actor uuid, for every form that already has one. */
  existingForms: Partial<Record<TPrimalCompanionForm, string>>;
  /** the summon activity's current `profiles` array. */
  profiles: PrimalCompanionSummonProfile[];
  /**
   * form -> the existing actor's current `prototypeToken.actorLink` value,
   * for every form present in `existingForms`. Optional and defaults to
   * "conformant" per-form when a form's entry is omitted, so callers that
   * don't care about this dimension (all the pre-fix-round-2 call sites and
   * tests) aren't forced to opt in. A form with no existing actor is never
   * proposed a fix regardless of this map -- there's nothing to update yet.
   */
  actorLinkStatus?: Partial<Record<TPrimalCompanionForm, boolean>>;
}

export interface PlanCompanionReconciliationResult {
  /** forms with no world actor yet, in canonical order. */
  createForms: TPrimalCompanionForm[];
  /** the full 3-entry profiles array to write, or `null` if either a form is
   * still missing (nothing to point at yet) or `profiles` already matches. */
  profileUpdate: { name: string; uuid: string }[] | null;
  /**
   * existing flagged actors whose `prototypeToken.actorLink` must be forced
   * to `false` -- a mechanical field fix, never identity (name/img/
   * ownership stay untouched, unaffected by this). Empty when every existing
   * actor is already conformant, or when a form doesn't exist yet (the
   * creation path already guarantees `actorLink: false` for a brand-new
   * actor, so there's nothing to fix on one this same pass just created).
   */
  actorLinkFixes: { form: TPrimalCompanionForm; uuid: string }[];
}

export function planCompanionReconciliation({
  existingForms,
  profiles,
  actorLinkStatus = {},
}: PlanCompanionReconciliationArgs): PlanCompanionReconciliationResult {
  const createForms = PRIMAL_COMPANION_FORMS.filter((form) => !existingForms[form]);

  const actorLinkFixes = PRIMAL_COMPANION_FORMS
    .filter((form) => existingForms[form] && actorLinkStatus[form] === true)
    .map((form) => ({ form, uuid: existingForms[form] as string }));

  // Can't point profiles at actors that don't exist yet -- the hook re-plans
  // after creating them, within the same pass.
  if (createForms.length > 0) {
    return { createForms, profileUpdate: null, actorLinkFixes };
  }

  const target = PRIMAL_COMPANION_FORMS.map((form) => ({ name: "", uuid: existingForms[form] as string }));
  const conformant = profiles.length === target.length
    && target.every((entry, index) => profiles[index]?.uuid === entry.uuid);

  return { createForms, profileUpdate: conformant ? null : target, actorLinkFixes };
}

/**
 * Where a player-initiated import (`ddb-importer.characterProcessDataComplete`
 * is a LOCAL `Hooks.callAll` -- it only fires on the importing user's own
 * client) must route the reconcile to reach a GM client at all. Fix round 1
 * (review finding, Critical): the previous shape was a bare `if (!activeGM
 * .isSelf) return;` gate, which silently DROPPED the reconcile for every
 * player-initiated import instead of routing it -- no GM client ever saw the
 * event, so nothing ran. This makes the three-way decision explicit and
 * testable without a Foundry mock: run locally, route through the active
 * GM's `CONFIG.queries` handler, or (no GM connected at all) skip and say so.
 */
export type TReconcileRoute = "local" | "query" | "no-gm";

export function decideReconcileRoute({
  activeGMIsSelf,
  hasActiveGM,
}: { activeGMIsSelf: boolean; hasActiveGM: boolean }): TReconcileRoute {
  if (activeGMIsSelf) return "local";
  if (hasActiveGM) return "query";
  return "no-gm";
}
