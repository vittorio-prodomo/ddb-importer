import { normaliseGrantName } from "../spells/grantedSpellRows.ts";

/**
 * Rewrite spell/item mentions in an imported description into `@UUID` links —
 * the testable core of `parseHardCompendiumReferenceTag` (T128-adjacent,
 * 2026-08-29).
 *
 * The old inline regexes had three stacked failures, each alone enough to keep
 * "Hunter's Mark" in Favored Enemy unlinked:
 *  - the char class `[\w\s]` cannot match an apostrophe — straight OR
 *    typographic — so every possessive spell name fell out (quirk #21 family);
 *  - only `<strong>` wrappers matched, while DDB wraps feature-granted spell
 *    mentions in `<em>`;
 *  - the index lookup compared the description's raw U+2019 against the munched
 *    pack's normalised U+0027, so even a matched name resolved to nothing.
 *
 * `resolve` maps a mention to a uuid (or null); the caller owns the compendium
 * index. Comparison-side normalisation lives HERE via [[normaliseGrantName]] so
 * both sides of the apostrophe boundary meet in the middle.
 */

const NAME = "([\\w\\s'’/-]+?)";

const SPELL_PATTERNS = [
  // <strong>fireball</strong> spell · <em>Hunter's Mark</em> spell
  new RegExp(`(?:<(strong|em|i)>)${NAME}(?:</\\1>)(\\s*spell)`, "gi"),
  // <strong>cone of cold</strong> (5 charges)
  new RegExp(`(?:<(strong|em|i)>)${NAME}(?:</\\1>)(\\s*\\(\\d* charge)`, "gi"),
];

const ITEM_PATTERNS = [
  new RegExp(`(?:<(strong|em|i)>)${NAME}(?:</\\1>)(\\s*item)`, "gi"),
];

/**
 * @param text        the description HTML
 * @param kind        "spell" | "item"
 * @param resolve     mention name -> uuid | null/undefined
 */
export function linkCompendiumMentions(
  text: string,
  kind: "spell" | "item",
  resolve: (name: string) => string | null | undefined,
): string {
  const patterns = kind === "spell" ? SPELL_PATTERNS : ITEM_PATTERNS;
  let out = `${text}`;
  for (const pattern of patterns) {
    out = out.replaceAll(pattern, (_match, _tag, name, postfix) => {
      const uuid = resolve(name);
      return uuid ? `@UUID[${uuid}]{${name}}${postfix}` : `${_match}`;
    });
  }
  return out;
}

/**
 * An index lookup that survives the apostrophe boundary: the mention side may
 * carry U+2019 (raw DDB), the index side U+0027 (normalised import) — or, for
 * an official compendium, the reverse.
 */
export function findByNormalisedName<T extends { name: string; uuid?: string; system?: { source?: { rules?: string } } }>(
  entries: Iterable<T>,
  name: string,
  { preferRules }: { preferRules?: string } = {},
): T | undefined {
  const wanted = normaliseGrantName(name);
  if (!wanted) return undefined;
  let first: T | undefined;
  for (const entry of entries) {
    if (normaliseGrantName(entry.name) !== wanted) continue;
    // Same-name entries exist per edition (the munched pack holds a 2014 and a
    // 2024 Hunter's Mark). A 2024 feature linking the 2014 text is a
    // correctness bug, not a preference — prefer the wanted edition, fall back
    // to the first match when none declares it.
    if (preferRules && entry.system?.source?.rules === preferRules) return entry;
    first ??= entry;
  }
  return first;
}
