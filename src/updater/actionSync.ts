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
  /**
   * Set for a free-cast pool that lives on a SPELL (the dual-pool shape): the D&D Beyond action must then
   * also carry this name, so a feature with several actions never has the wrong one written.
   */
  actionName?: string;
}

/** Loose name equality: D&D Beyond writes "Hunter’s Mark" with a curly apostrophe, Foundry "Hunter's Mark". */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => `${s ?? ""}`.replace(/[\u2018\u2019]/g, "'").trim().toLowerCase();
  return norm(a) === norm(b);
}

export interface FoundryFeature {
  ddbId: number | null;
  entityTypeId: number | null;
  name: string;
  identifier: string;
}

/**
 * The feature that grants a dual-pool spell its free casts. A dual-pool spell's sheet subtitle already
 * points at it through `system.sourceItem` ("feat:favored-enemy", T210); the dual-pool stamp's recorded
 * feature NAME is the fallback.
 */
export function grantingFeature(
  spell: { sourceItem: string | null | undefined; grantFeature: string | null | undefined },
  features: FoundryFeature[],
): FoundryFeature | null {
  const identifier = `${spell.sourceItem ?? ""}`.match(/^feat:(.+)$/)?.[1];
  return (identifier ? features.find((f) => f.identifier === identifier) : undefined)
    ?? (spell.grantFeature ? features.find((f) => sameName(f.name, spell.grantFeature)) : undefined)
    ?? null;
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
      && a.componentTypeId === item.entityTypeId
      && (item.actionName === undefined || sameName(a.name, item.actionName)));
    if (!action) continue;

    if (Number(item.used) === Number(action.numberUsed)) continue;

    calls.push({ actionId: action.id, entityTypeId: action.entityTypeId, uses: Number(item.used) });
  }

  return calls;
}

export interface DDBSpellEntry {
  /** The character's spell entry (mapping) id — what `action/limited-use` takes as `id` for a spell. */
  id: number;
  entityTypeId: number;
  name: string;
  numberUsed: number;
}

/**
 * A free-cast pool D&D Beyond keeps on the SPELL ENTRY itself (feat and species grants: Healing Word,
 * Longstrider, Faerie Fire, Shield). D&D Beyond's own sheet writes it through `action/limited-use`, the same
 * route as an action's uses, with the spell entry's id and entityTypeId — read from its app bundle
 * 2026-10-15, where spellUseSet and actionUseSet share one API function. The Foundry spell already carries
 * that entry identity in flags.ddbimporter.id / entityTypeId, so the match is direct.
 * `ddbEntries` must hold only entries that HAVE a limitedUse: a spell whose pool D&D Beyond keeps as an
 * action (Hunter's Mark) has none on its entry, and so is never written here as well.
 */
export function diffSpellUses(
  foundrySpells: FoundryUsesItem[],
  ddbEntries: DDBSpellEntry[],
): ActionUseCall[] {
  const calls: ActionUseCall[] = [];
  for (const spell of foundrySpells) {
    if (!Number.isFinite(Number(spell.used))) continue;
    const entry = ddbEntries.find((e) => e.id === spell.ddbId && e.entityTypeId === spell.entityTypeId);
    if (!entry || Number(spell.used) === Number(entry.numberUsed)) continue;
    calls.push({ actionId: entry.id, entityTypeId: entry.entityTypeId, uses: Number(spell.used) });
  }
  return calls;
}

/**
 * Arcane Ward. CPR's ward keeps NO uses on the feature (2026-07-15 redesign): its whole state is one Active
 * Effect on the actor — "Arcane Ward: N", `flags.chris-premades.arcaneWard = {hp, max}` — created by the
 * first abjuration spell of the day and deleted by a long rest. D&D Beyond keeps it as TWO actions under
 * the Arcane Ward feature: "Arcane Ward" (1/LR: created today) and "Arcane Ward: Hit Points" (used =
 * absorbed). ⚠️ Polarity: D&D Beyond stores USED, CPR stores what REMAINS. Both are matched by name, so
 * neither can be written to the other's action.
 * @param feature the Arcane Ward feature's D&D Beyond identity, or null when the actor has none
 * @param ward the ward effect's `{hp, max}`, or null when no ward exists
 */
export function arcaneWardUses(
  feature: { ddbId: number | null; entityTypeId: number | null } | null,
  ward: { hp: number; max: number } | null,
): FoundryUsesItem[] {
  if (!feature) return [];
  const hp = Number(ward?.hp);
  const max = Number(ward?.max);
  const absorbed = ward
    ? (Number.isFinite(hp) && Number.isFinite(max) ? Math.max(0, max - hp) : NaN)
    : 0;
  return [
    { ...feature, name: "Arcane Ward", actionName: "Arcane Ward", used: ward ? 1 : 0 },
    { ...feature, name: "Arcane Ward: Hit Points", actionName: "Arcane Ward: Hit Points", used: absorbed },
  ];
}
