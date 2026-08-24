/**
 * Deciding which limited-use features have been spent since D&D Beyond last saw them.
 *
 * Pure: no Foundry or D&D Beyond APIs.
 *
 * ⚠️ The reason this needs a module of its own is an identity mismatch that made the
 * upstream feature inert ("disabled until feature/action parser sync"). A Foundry item
 * imported from DDB carries the CLASS FEATURE identity:
 *
 *     flags.ddbimporter.id = 10292282, entityTypeId = 12168134
 *
 * while the thing D&D Beyond's write API wants is the ACTION:
 *
 *     id = 9414047, entityTypeId = 222216831
 *
 * The two are bridged by the action's own componentId/componentTypeId, which point back
 * at the feature. Verified live on two characters 2026-08-24. Matching on the feature id
 * alone finds nothing, which is why the old code ran clean and did nothing at all.
 */

export interface FoundryUsesItem {
  /** flags.ddbimporter.id — the class-feature id. */
  ddbId: number | null;
  /** flags.ddbimporter.entityTypeId — the class-feature entity type. */
  entityTypeId: number | null;
  name: string;
  /** Uses CONSUMED (max - value), which is what DDB stores. */
  used: number;
}

export interface DDBRawAction {
  id: number;
  entityTypeId: number;
  componentId: number;
  componentTypeId: number;
  name: string;
  numberUsed: number;
}

export interface ActionUseCall {
  actionId: number;
  entityTypeId: number;
  uses: number;
}

export function diffActionUses(
  foundryItems: FoundryUsesItem[],
  ddbActions: DDBRawAction[],
): ActionUseCall[] {
  const calls: ActionUseCall[] = [];

  for (const item of foundryItems) {
    if (item.ddbId === null || item.ddbId === undefined) continue;
    if (item.entityTypeId === null || item.entityTypeId === undefined) continue;
    // getFoundryItems() returns SOURCE data, where uses.max is a formula and uses.value
    // is absent — subtracting those yields NaN. Never let that reach D&D Beyond.
    if (!Number.isFinite(Number(item.used))) continue;

    const action = ddbActions.find((a) =>
      a.componentId === item.ddbId
      && a.componentTypeId === item.entityTypeId);
    if (!action) continue;

    if (Number(item.used) === Number(action.numberUsed)) continue;

    calls.push({ actionId: action.id, entityTypeId: action.entityTypeId, uses: Number(item.used) });
  }

  return calls;
}
