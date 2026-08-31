/**
 * Where the "magic can't put you to sleep" immunity lives.
 *
 * It used to be written straight onto the actor as `system.traits.ci.custom`,
 * which worked but was invisible: nothing on the sheet said WHICH feature
 * granted it, and Visual Active Effects — which lists Active Effects, not
 * features — had nothing to show. Vittorio's call (2026-08-31): make the
 * granting feature the source, so the immunity travels with Trance and appears
 * among the VAE icons.
 *
 * ⚠️ This does NOT replace GPS's `doesNotSleep` predicate. That has four limbs
 * and three of them (exhaustion immunity, Undead/Constructs, elf lineages by
 * species label) reach creatures with no such feature to carry an effect —
 * every NPC elf, for one. This only changes where a PC's declared immunity
 * comes from.
 */

/** Features whose text can carry the clause. */
export const SLEEP_IMMUNITY_FEATURES = ["Fey Ancestry", "Trance", "Constructed Resilience"];

/**
 * ⚠️ The clause uses a CURLY apostrophe (U+2019). DDB's own text does too, so
 * matching a straight one silently matches nothing — the same family as
 * quirk #21, where `originalName` is normalised to a straight apostrophe while
 * raw DDB uses U+2019. Both forms are accepted here rather than guessed at.
 */
const SLEEP_CLAUSE = /magic can[’']t put you to sleep/i;

export interface FeatureLike {
  name?: string;
  type?: string;
  system?: { description?: { value?: string } };
}

/** Does this feature declare the sleep immunity? */
export function declaresSleepImmunity(feature: FeatureLike | null | undefined): boolean {
  if (!feature || feature.type !== "feat") return false;
  if (!SLEEP_IMMUNITY_FEATURES.includes(feature.name ?? "")) return false;
  return SLEEP_CLAUSE.test(feature.system?.description?.value ?? "");
}

/**
 * The transfer effect that grants it.
 *
 * ⚠️ The value is `";Sleep"`, leading separator included, and that is
 * deliberate: Foundry's ADD mode concatenates onto a string, so the separator
 * has to come from us or a second immunity would collide ("BlindedSleep").
 * It also reproduces byte-for-byte the string the actor-level write produced,
 * which is what GPS's predicate already matches loosely on.
 */
export function sleepImmunityEffect(featureName: string, img?: string): Record<string, unknown> {
  return {
    // ⚠️ Named for the FEATURE, nothing more. Every other effect on these sheets
    // does the same ("Fey Ancestry", "Elven: Drow Lineage"), and VAE renders the
    // name as its label — a sentence-long name is a sentence-long icon caption.
    // What it does belongs in the description, which VAE shows on hover.
    name: featureName,
    img: img ?? "icons/magic/control/sleep-bubble-blue.webp",
    transfer: true,
    // Rulebook language only, per the standing rule — what the trait says, not
    // what the automation does.
    description: "<p>Magic can't put you to sleep.</p>",
    changes: [
      {
        key: "system.traits.ci.custom",
        mode: 2, // ADD — concatenates onto the existing string
        value: ";Sleep",
        priority: 20,
      },
    ],
    flags: { ddbimporter: { sleepImmunity: true } },
  };
}

/** Has this feature already been given the effect (idempotence across re-imports)? */
export function hasSleepImmunityEffect(feature: { effects?: any[] } | null | undefined): boolean {
  return (feature?.effects ?? []).some((e) => e?.flags?.ddbimporter?.sleepImmunity === true);
}
