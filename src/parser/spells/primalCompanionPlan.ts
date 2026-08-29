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
 * no-op once all three exist and the item's profiles already point at them.
 *
 * Pure: takes a plain snapshot of what already exists, returns a plan. The
 * caller (the ready hook) owns every side effect — actor creation, item
 * copies, the `item.update()` write.
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
}

export interface PlanCompanionReconciliationResult {
  /** forms with no world actor yet, in canonical order. */
  createForms: TPrimalCompanionForm[];
  /** the full 3-entry profiles array to write, or `null` if either a form is
   * still missing (nothing to point at yet) or `profiles` already matches. */
  profileUpdate: { name: string; uuid: string }[] | null;
}

export function planCompanionReconciliation({
  existingForms,
  profiles,
}: PlanCompanionReconciliationArgs): PlanCompanionReconciliationResult {
  const createForms = PRIMAL_COMPANION_FORMS.filter((form) => !existingForms[form]);

  // Can't point profiles at actors that don't exist yet -- the hook re-plans
  // after creating them, within the same pass.
  if (createForms.length > 0) {
    return { createForms, profileUpdate: null };
  }

  const target = PRIMAL_COMPANION_FORMS.map((form) => ({ name: "", uuid: existingForms[form] as string }));
  const conformant = profiles.length === target.length
    && target.every((entry, index) => profiles[index]?.uuid === entry.uuid);

  return { createForms, profileUpdate: conformant ? null : target };
}
