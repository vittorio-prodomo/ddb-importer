/**
 * Resolve the spell a 2024 "you always have X prepared" feature grants (T191).
 *
 * The old inline regex required the exact 2014-era follow-on sentence
 * ("… spell prepared. You can cast it once without a spell slot") and otherwise
 * fell through to a second alternative that captures whatever follows "cast".
 * 2024 features phrase it differently —
 *
 *   "You always have the Divine Smite spell prepared. In addition, you can cast
 *    it without expending a spell slot, but you must finish a Long Rest…"
 *
 * — so the first alternative missed and the second captured the PRONOUN "it".
 * A grant named "it" resolves to no compendium spell, so no Cast activity was
 * built and nothing was recorded as granted; the raw spell was then pushed as a
 * standalone innate copy, which is the duplicate row on Victus's sheet.
 *
 * Kept free of Foundry so it can be tested on its own.
 */

/** Words that are a back-reference to an already-named spell, never a spell name. */
const PRONOUNS = new Set(["it", "them", "that", "this", "that spell", "this spell", "the spell", "the spells"]);

/** The sentence that NAMES the spell — authoritative wherever it appears. */
const ALWAYS_PREPARED = /You always have the (.+?) spell(?:s)? prepared/i;

/** The sentence that describes the free cast; its subject may be a pronoun. */
const FREE_CAST = /(?:you can |gain the ability to )?cast (?:the )?(.+?) (?:once )?without (?:expending|using) a spell slot/i;

function clean(name: string | undefined | null): string | null {
  if (typeof name !== "string") return null;
  // "cast the barkskin spell without expending a spell slot" hands back the
  // trailing noun as part of the capture.
  const trimmed = name.toLowerCase().replace(/\s+/g, " ").replace(/\s+spells?$/, "").trim();
  if (trimmed === "" || PRONOUNS.has(trimmed)) return null;
  return trimmed;
}

/**
 * The granted spell's name in lowercase, or null when the description does not
 * grant one. Prefers the naming sentence; only falls back to the free-cast
 * sentence when that sentence actually names a spell rather than referring back
 * to one.
 */
export function parseAlwaysPreparedGrant(description: string): string | null {
  if (typeof description !== "string" || description === "") return null;
  // An @UUID[...]{Name} enricher link reads as its label.
  description = description.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1");

  const named = clean(description.match(ALWAYS_PREPARED)?.[1]);
  if (named) return named;

  return clean(description.match(FREE_CAST)?.[1]);
}
