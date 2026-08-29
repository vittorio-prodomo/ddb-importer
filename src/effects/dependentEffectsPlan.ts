/**
 * Generic "don't delete a still-depended-on document" invariant for the
 * importer's active-effect wipe step (Task 10, `2026-08-29-primal-companion-native`
 * §3.9 fix).
 *
 * dnd5e's own dependents cascade (`ActiveEffect5e#_onDelete` ->
 * `getDependents().forEach(e => e.delete())`, GM-side, see the installed
 * `dnd5e.mjs` around line 25150) deletes every document tracked against a
 * deleted effect's uuid via `flags.dnd5e.dependentOn` -- including a live
 * summoned TOKEN. `DDBCharacterImporter#preActiveEffects` used to wipe every
 * ActiveEffect on the actor unconditionally
 * (`deleteEmbeddedDocuments("ActiveEffect", [], { deleteAll: true })`) before
 * `ddb-importer.characterProcessDataComplete` ever fires, so a re-import with
 * a living summon killed its marker effect, which cascaded to delete the
 * summon's token, before any module-side reconcile hook got a chance to see
 * it. A deleted token cannot be recovered by later recreating the effect it
 * depended on -- a new document, even sharing the old effect's `_id`, cannot
 * un-delete an already-deleted token. The fix has to keep the referenced
 * effect from ever entering the delete set in the first place.
 *
 * Deliberately generic: keys on the `dependentOn` REFERENCE, not on any
 * "Summon:" name or Primal-Companion specifics -- this protects every
 * live-dependent effect an actor might carry, from any source, not just
 * this one feature.
 *
 * Pure: takes plain snapshots, returns a plan. The caller
 * (`DDBCharacterImporter#preActiveEffects`) owns every side effect --
 * scanning `game.scenes` for `dependentOn` references, and issuing the
 * actual `deleteEmbeddedDocuments` call with the surviving ids.
 */

export interface DependentEffectSnapshot {
  _id: string;
  uuid: string;
}

export interface PlanEffectWipeArgs {
  /** every ActiveEffect currently on the actor about to be wiped. */
  existingEffects: DependentEffectSnapshot[];
  /** uuids referenced by SOME token's `flags.dnd5e.dependentOn`, world-wide. */
  dependentOnUuids: Set<string> | string[];
}

export interface PlanEffectWipeResult {
  /** _ids safe to actually delete -- unreferenced effects, same set the old
   * unconditional `deleteAll: true` wipe would have removed when nothing
   * depends on anything. */
  deleteIds: string[];
  /** _ids preserved because a live token still depends on them. */
  keptIds: string[];
}

export function planEffectWipe({
  existingEffects,
  dependentOnUuids,
}: PlanEffectWipeArgs): PlanEffectWipeResult {
  const referenced = dependentOnUuids instanceof Set ? dependentOnUuids : new Set(dependentOnUuids);

  const deleteIds: string[] = [];
  const keptIds: string[] = [];
  for (const effect of existingEffects) {
    if (referenced.has(effect.uuid)) keptIds.push(effect._id);
    else deleteIds.push(effect._id);
  }

  return { deleteIds, keptIds };
}
