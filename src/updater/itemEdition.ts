/**
 * Which D&D Beyond item a non-DDB Foundry item stands for: same name, same rules edition.
 *
 * ⚠️ The sync used to take the first item of the same name in the DDB Items pack. That pack holds
 * a 2014 and a 2024 copy of many items, so a Potion of Healing added from the Player's Handbook,
 * CPR or the SRD reached D&D Beyond as the 2014 Potion (item 71, not the 2024 8960641). Dry runs,
 * 2026-10-19. Same family as the spell-list fix (T241).
 */

type Edition = "2014" | "2024";
interface HasRules { system?: { source?: { rules?: string } } }

/** The item's own rules edition, or the world's (`dnd5e.rulesVersion`) when the item does not say. */
export function itemRulesEdition(item: HasRules, worldRulesVersion: string): Edition {
  const own = item?.system?.source?.rules;
  if (own === "2014" || own === "2024") return own;
  return worldRulesVersion === "legacy" ? "2014" : "2024";
}

/** The index entries of `edition`; the whole index when it holds none of that edition. */
export function entriesInEdition<T extends HasRules>(index: T[], edition: Edition): T[] {
  const same = index.filter((entry) => entry?.system?.source?.rules === edition);
  // The same array when nothing matches, so matchAttempts can tell there is no subset.
  return same.length ? same : index;
}

/**
 * The order the name matcher is tried in: an exact match anywhere beats a loose one, and within each
 * kind the item's own edition comes first. A loose match inside the edition used to win over an exact
 * match in the other edition (T128 review, minor 5).
 */
export function matchAttempts<T>(subset: T[], all: T[]): { index: T[]; loose: boolean }[] {
  const same = subset === all;
  return [
    { index: subset, loose: false },
    ...(same ? [] : [{ index: all, loose: false }]),
    { index: subset, loose: true },
    ...(same ? [] : [{ index: all, loose: true }]),
  ];
}
