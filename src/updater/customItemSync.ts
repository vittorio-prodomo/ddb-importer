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
