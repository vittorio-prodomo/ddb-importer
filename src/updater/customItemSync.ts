/**
 * Deciding which custom (homebrew) items have changed since D&D Beyond last saw them.
 *
 * Pure: no Foundry or D&D Beyond APIs.
 *
 * ⚠️ The id trap this exists for: D&D Beyond's `customItems[].id` is the DEFINITION id,
 * which ddb-importer stores as `flags.ddbimporter.definitionId`. `flags.ddbimporter.id`
 * is the INVENTORY ENTRY id — a different number entirely. The old comparison matched
 * DDB's id against the entry id, so it never matched and a changed custom item never
 * synced. Verified live 2026-08-24.
 */

export interface FoundryCustomItem {
  /** flags.ddbimporter.definitionId — what DDB calls the custom item's id. */
  definitionId: number | null;
  /** flags.ddbimporter.id — the inventory entry id. Kept for the caller, NOT for matching. */
  entryId: number | null;
  name: string;
  description: string | null;
  quantity: number;
  weight: number;
}

export interface DDBCustomItem {
  id: number;
  name: string;
  description: string | null;
  quantity: number;
  weight: number;
}

export function changedCustomItems(
  foundryItems: FoundryCustomItem[],
  ddbItems: DDBCustomItem[],
): FoundryCustomItem[] {
  return foundryItems.filter((item) => {
    if (item.definitionId === null || item.definitionId === undefined) return false;

    const match = ddbItems.find((d) => d.id === item.definitionId);
    if (!match) return false;

    // Loose comparison on the numbers: Foundry and DDB disagree on int-vs-float.
    return item.name !== match.name
      || (item.description ?? null) !== (match.description ?? null)
       
      || item.quantity != match.quantity
       
      || item.weight != match.weight;
  });
}

/**
 * Adding a NEW custom item.
 *
 * ⚠️ D&D Beyond answers `custom/item` NEW with the custom item ITSELF (`{id, name, …}`, the id being
 * the definition id), not with `{addItems: [...]}` as `equipment/add` does. The module read
 * `addItems[0].id`, threw AFTER the write had landed, and so every re-sync added another copy
 * (Nigel's "Spell Scroll of Misty Step", 2026-10-15). The `addItems` shape is still accepted.
 *
 * The inventory ENTRY D&D Beyond files the new item under is not in the answer at all; it appears
 * in a fresh character read (seconds later — reads lag writes). An import stamps both ids, and the
 * entry id is what the next sync's remove pass matches on, so the add must find it too.
 */
export interface DDBInventoryEntry {
  id: number;
  entityTypeId: number;
  containerEntityId: number;
  containerEntityTypeId: number;
  definition: { id: number; entityTypeId: number; isCustomItem?: boolean };
}

export function addedCustomItemDefinitionId(answer: any): number | null {
  const id = answer?.addItems?.[0]?.definition?.id ?? answer?.id;
  return Number.isInteger(id) ? id : null;
}

export function findCustomItemEntry(inventory: DDBInventoryEntry[] | undefined, definitionId: number): DDBInventoryEntry | null {
  return (inventory ?? []).find((entry) =>
    entry.definition?.isCustomItem === true && entry.definition.id === definitionId) ?? null;
}

export function customItemEntryFlags(entry: DDBInventoryEntry) {
  return {
    id: entry.id,
    entityTypeId: entry.entityTypeId,
    definitionId: entry.definition.id,
    definitionEntityTypeId: entry.definition.entityTypeId,
    containerEntityId: entry.containerEntityId,
    containerEntityTypeId: entry.containerEntityTypeId,
  };
}
