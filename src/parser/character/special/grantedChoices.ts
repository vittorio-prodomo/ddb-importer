/**
 * Say what the player actually CHOSE, on the feature that offered the choice.
 *
 * Vittorio's ask (2026-08-31): Nigel's Scholar reads "Choose one of the following
 * skills… You have Expertise in the chosen skill" and never says which — the
 * sheet knows he took Arcana (`skills.arc.value === 2`) but nothing connects that
 * back to the feature. Same for Versatile ("You gain an Origin feat of your
 * choice"), Abjuration Savant, Magic Initiate. Generalises to every feature type:
 * feats, backgrounds, species traits, class and subclass features.
 *
 * 🔑 The link is explicit in DDB's data and needs no inference: every choice in
 * `ddb.character.choices.*` carries the `componentId` of the granting feature,
 * which is that feature's `flags.ddbimporter.id` on our side. The option's human
 * label lives in `choices.choiceDefinitions`, keyed `<componentTypeId>-<type>`.
 *
 * ⚠️ **"Does the description already mention it" is the WRONG test**, and it is
 * the obvious one to reach for. Scholar's description LISTS Arcana — as one of
 * six options — so that test suppresses exactly the case this exists for. The
 * rule that works is `describesExactlyTheseChoices`: skip only when the text
 * states the outcome and offers no rivals (Merchant, whose grants are printed in
 * full and are not really a choice at all). See its own note.
 *
 * Pure string/array work over plain objects, so it is node-testable without Foundry.
 */

export interface ResolvedChoice {
  /** The choice's own label, imperative stripped ("Choose a Skill" → "Skill"). */
  groupLabel: string | null;
  /** The selected option, human readable ("Arcana"). */
  label: string;
  /**
   * The `choiceDefinition` this option came from.
   *
   * ⚠️ Load-bearing for the suppression rule: the rival check must use THIS
   * choice's own pool, never the union of every pool on the character. Merchant's
   * description prints "Ability Scores: Constitution, Intelligence, Charisma",
   * which are labels in the ABILITY pool — with a flattened pool they read as
   * rivals to a SKILL choice and defeated suppression, so Merchant restated
   * itself on the first live run.
   */
  poolId: string | null;
  /**
   * Compendium uuid of the chosen ENTITY, when one was found. Only entity picks
   * (a feat, a spell) have a compendium document to point at; a skill or an
   * ability score does not, and stays plain text.
   */
  uuid?: string | null;
}

/** "Choose a Skill Expertise" / "Select a Standard Language" → "Skill Expertise". */
function tidyGroupLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.replace(/^(choose|select|pick)\s+(an?|the)?\s*/i, "").trim() || null;
}

/**
 * Every resolved choice on the character, keyed by the granting feature's DDB id.
 *
 * An option we cannot resolve to a label is DROPPED rather than rendered as a bare
 * numeric id — a sheet reading "Chosen: 1789163" is worse than saying nothing.
 * (That case is real: an "Origin feat" choice stores the feat's own id, which is
 * not in any `choiceDefinition` pool.)
 */
export function resolveChoicesByComponent(ddb: any): Map<number, ResolvedChoice[]> {
  const choices = ddb?.character?.choices ?? {};
  const definitions: any[] = Array.isArray(choices.choiceDefinitions) ? choices.choiceDefinitions : [];

  /**
   * Some options are not pool members at all — they name an ENTITY the character
   * took. Versatile's "Choose an Origin feat" stores the chosen feat's own id,
   * which appears in no `choiceDefinition`, so pool lookup alone dropped it and
   * the trait kept reading "You gain an Origin feat of your choice." with no
   * answer. That is the T169 link, and it lives in `character.feats`.
   *
   * ⚠️ Consulted only AFTER the pools: option ids and feat ids are separate number
   * spaces and can collide, and the pool is the authoritative answer when it has
   * one.
   */
  const featNames = new Map<number, string>();
  for (const feat of (ddb?.character?.feats ?? []) as any[]) {
    const id = feat?.definition?.id ?? feat?.definitionId;
    const name = feat?.definition?.name;
    if (id != null && name) featNames.set(Number(id), String(name));
  }

  const labelFor = (optionValue: unknown): { label: string; poolId: string | null } | null => {
    for (const definition of definitions) {
      const hit = (definition?.options ?? []).find((option: any) => option?.id === optionValue);
      if (hit?.label) return { label: String(hit.label), poolId: definition?.id != null ? String(definition.id) : null };
    }
    const featName = featNames.get(Number(optionValue));
    // No pool, so nothing can count as this choice's rival — suppression then
    // depends purely on whether the description already names the entity.
    if (featName) return { label: featName, poolId: null };
    return null;
  };

  const byComponent = new Map<number, ResolvedChoice[]>();
  for (const [bucket, entries] of Object.entries(choices)) {
    if (bucket === "choiceDefinitions" || !Array.isArray(entries)) continue;
    for (const entry of entries as any[]) {
      if (entry?.componentId == null || entry?.optionValue == null) continue;
      const resolved = labelFor(entry.optionValue);
      if (!resolved) continue;
      const componentId = Number(entry.componentId);
      const list = byComponent.get(componentId) ?? [];
      list.push({ groupLabel: tidyGroupLabel(entry.label), label: resolved.label, poolId: resolved.poolId });
      byComponent.set(componentId, list);
    }
  }
  return byComponent;
}


/**
 * dnd5e's skill keys, against the ENGLISH names DDB uses.
 *
 * ⚠️ Deliberately a constant rather than `CONFIG.DND5E.skills`: that config is
 * LOCALIZED, so on a non-English world its labels would never match the English
 * label DDB hands us. It also keeps this module Foundry-free and testable.
 */
const SKILL_KEYS: Record<string, string> = {
  "acrobatics": "acr", "animal handling": "ani", "arcana": "arc", "athletics": "ath",
  "deception": "dec", "history": "his", "insight": "ins", "intimidation": "itm",
  "investigation": "inv", "medicine": "med", "nature": "nat", "perception": "prc",
  "performance": "prf", "persuasion": "per", "religion": "rel",
  "sleight of hand": "slt", "stealth": "ste", "survival": "sur",
};

/**
 * A skill label as a dnd5e Reference enricher, linking to its rule page — or null
 * when the label is not a skill (a tool, an ability score, a spell).
 *
 * ⚠️ The ampersand is HTML-ESCAPED to match what DDB already writes in the
 * surrounding description text. Both forms enrich correctly (verified live
 * against `TextEditor.enrichHTML`), so this is purely for consistency with the
 * text it is appended to.
 */
export function skillReference(label: string): string | null {
  const key = SKILL_KEYS[label.trim().toLowerCase()];
  return key ? `&amp;Reference[${key}]{${label}}` : null;
}

/**
 * The names to try when looking a chosen entity up in a compendium, best first.
 *
 * ⚠️ DDB suffixes an entity with the sub-choice it carries — "Magic Initiate
 * (Cleric)" — while the PHB pack holds one "Magic Initiate", because that suffix
 * records the chosen spell list rather than naming a different feat. So an exact
 * match is tried first, then the same name with a TRAILING parenthetical removed.
 * Only trailing: a parenthetical in the middle of a name is part of the name.
 */
export function compendiumLookupNames(label: string): string[] {
  const names = [label];
  const stripped = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  if (stripped && stripped !== label) names.push(stripped);
  return names;
}

/** Markup, enricher syntax and entities out; a single spaced line back. */
function plainText(html: string): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-label match, so "Arcana" does not match inside "Arcanaphobia". */
function mentions(text: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(text);
}

/**
 * Does this description already STATE these choices — as opposed to offering them?
 *
 * ⚠️ The distinction that matters, and the reason the naive test fails:
 *  - **Scholar** enumerates its six candidate skills, so the chosen one (Arcana)
 *    appears alongside five rivals. Mentioning it proves nothing. → not stated.
 *  - **Merchant** prints "Skill Proficiencies: Animal Handling and Persuasion.
 *    Tool Proficiency: Navigator's Tools" — every grant present, no rival from the
 *    same pool. → stated, leave it alone.
 *  - **Versatile** ("You gain an Origin feat of your choice") names nothing at all.
 *    → not stated.
 *
 * So: stated iff every chosen label appears AND no OTHER option from the same pool
 * does.
 *
 * @param descriptionHtml The feature's description, markup and all.
 * @param chosenLabels    What the player actually took.
 * @param optionPool      Every label that was selectable for this kind of choice.
 */
export function describesExactlyTheseChoices(
  descriptionHtml: string,
  chosenLabels: string[],
  optionPool: string[],
): boolean {
  if (!chosenLabels.length) return true; // nothing to say
  const text = plainText(descriptionHtml);
  if (!chosenLabels.every((label) => mentions(text, label))) return false;

  const chosen = new Set(chosenLabels.map((label) => label.toLowerCase()));
  const rivalMentioned = optionPool
    .filter((option) => !chosen.has(option.toLowerCase()))
    .some((option) => mentions(text, option));
  return !rivalMentioned;
}

/**
 * The addendum, or null when there is nothing worth appending.
 *
 * One line per choice GROUP rather than per pick, so a feature granting two spells
 * reads "Spell: Shield, Protection from Evil and Good" instead of two near-identical
 * lines. Rulebook-flavoured and short, per the standing player-facing-text rule —
 * it states what the character has, never what the automation does.
 */

/**
 * Labels that read wrong in the plural, so they are left alone.
 *
 * ⚠️ "Skill Expertise" is the motivating case: a naive rule yields "Skill
 * Expertises". Uncountables are cheaper to list than to detect.
 */
const UNCOUNTABLE = new Set(["expertise", "damage", "armor", "armour", "training"]);

/**
 * Plural of a DDB choice label, applied only when a group holds more than one pick.
 *
 * ⚠️ Inherently approximate: these are arbitrary DDB-authored noun phrases, not a
 * controlled vocabulary. It pluralizes the LAST word — the head noun in every
 * label observed ("Standard Language", "Wizard Skill Proficiency") — and leaves
 * anything already plural or uncountable untouched. Prefer adding to
 * `UNCOUNTABLE` over making the rule cleverer.
 */
export function pluralizeLabel(label: string): string {
  const words = label.trim().split(/\s+/);
  const head = words.pop();
  if (!head) return label;
  const lower = head.toLowerCase();

  if (UNCOUNTABLE.has(lower)) return label;
  if (/(?:[^s]s|s)$/i.test(head) && /s$/i.test(head) && !/(?:ss|us|is)$/i.test(head)) return label; // already plural

  let plural: string;
  if (/[^aeiou]y$/i.test(head)) plural = `${head.slice(0, -1)}ies`;
  else if (/(?:s|x|z|ch|sh)$/i.test(head)) plural = `${head}es`;
  else plural = `${head}s`;

  return [...words, plural].join(" ");
}

/** Does this choice hand out spells? Drives which compendium packs are searched first. */
export function isSpellChoice(groupLabel: string | null | undefined): boolean {
  return /\b(spell|cantrip)/i.test(groupLabel ?? "");
}

const UNLABELLED = "Chosen";

/**
 * The six ability scores, as DDB names them, against dnd5e's 3-letter keys.
 *
 * ⚠️ A constant rather than `CONFIG.DND5E.abilities` for the same reason as the
 * skills above: that config is localized, and DDB's label is always English.
 */
const ABILITY_KEYS: Record<string, string> = {
  "strength": "str", "dexterity": "dex", "constitution": "con",
  "intelligence": "int", "wisdom": "wis", "charisma": "cha",
};
const ABILITY_NAMES = new Set(Object.keys(ABILITY_KEYS));

/**
 * An ability label as a dnd5e Reference enricher, linking to its rule page — or
 * null when the label is not a bare ability ("Intelligence Score" is an ASI
 * option, not an ability).
 *
 * Verified live: all three accepted forms (`int`, `intelligence`, `ability=int`)
 * resolve to the SAME Intelligence rule page, so the 3-letter key is used for
 * consistency with the skill references.
 */
export function abilityReference(label: string): string | null {
  const key = ABILITY_KEYS[`${label}`.trim().toLowerCase()];
  return key ? `&amp;Reference[${key}]{${label}}` : null;
}

/** Is this label a bare ability score? Note "Intelligence Score" (an ASI option) is not. */
export function isAbilityName(label: string): boolean {
  return ABILITY_NAMES.has(`${label}`.trim().toLowerCase());
}

/**
 * Heading for a choice DDB gave no label to.
 *
 * ⚠️ Magic Initiate's spellcasting-ability pick arrives label-less, so it read as
 * a bare "Chosen: Intelligence". RAW names it — "Intelligence, Wisdom, or Charisma
 * is your spellcasting ability for this feat's spells" — so a bare ability value
 * is titled accordingly.
 *
 * ⚠️ This IS an inference, drawn from the value because DDB supplies no label. It
 * is deliberately narrow: only an unlabelled choice whose value is one of the six
 * bare ability names. An ASI feat's pick resolves to "Intelligence Score" or
 * "Increase two scores (+2 / +1)" and so keeps the neutral fallback, and any
 * choice DDB *does* label keeps its own wording.
 */
function fallbackGroupLabel(label: string): string {
  return isAbilityName(label) ? "Spellcasting Ability" : UNLABELLED;
}


const escapeRegExp = (raw: string): string => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * T215 — a 2024 background's DDB data names its origin feat in `featureName` but
 * leaves `featureDescription` empty (the feat is a separate item), so the
 * imported description used to END in a header-sized feat name with nothing
 * under it. Remove that trailer: the `<h2>` (and DDB's empty `<p></p>` spacer
 * before it) when nothing but whitespace / closing wrappers follows. A 2014
 * background's feature header has a real body after it and is left alone.
 */
export function stripDanglingFeatHeader(descriptionHtml: string, featName: string): string {
  if (!descriptionHtml || !featName) return descriptionHtml;
  const trailer = new RegExp(
    `(?:<p>\\s*</p>\\s*)?<h2>\\s*${escapeRegExp(featName)}\\s*</h2>(\\s*(?:</div>\\s*)*)$`,
  );
  return descriptionHtml.replace(trailer, "$1");
}

/**
 * T215, the useful half — the background's "Feat: <name>" summary line becomes a
 * link to the feat's compendium entry, DDB's label kept as the link text.
 * First occurrence only, and idempotent by construction: once linked, the name
 * no longer follows the label directly (an `@UUID[…]` does), so the pattern
 * cannot match again.
 */
export function linkifyOriginFeat(descriptionHtml: string, featName: string, uuid: string): string {
  if (!descriptionHtml || !featName || !uuid) return descriptionHtml;
  const summaryLine = new RegExp(`(<strong>\\s*Feat:\\s*</strong>\\s*)(${escapeRegExp(featName)})`);
  return descriptionHtml.replace(summaryLine, `$1@UUID[${uuid}]{$2}`);
}

export function choiceAddendumHtml(choices: ResolvedChoice[]): string | null {
  if (!choices?.length) return null;

  const groups = new Map<string, string[]>();
  for (const choice of choices) {
    const key = choice.groupLabel ?? fallbackGroupLabel(choice.label);
    const list = groups.get(key) ?? [];
    // A resolved entity links to its compendium entry, keeping the DDB label as
    // the link text so the sheet still reads "Magic Initiate (Cleric)". Failing
    // that, a skill links to its rule page. Anything else stays plain.
    const rendered = choice.uuid
      ? `@UUID[${choice.uuid}]{${choice.label}}`
      : skillReference(choice.label) ?? abilityReference(choice.label) ?? choice.label;
    if (!list.includes(rendered)) list.push(rendered);
    groups.set(key, list);
  }

  // "Skill Expertise chosen: Arcana" — the choice's own label, then what was taken.
  // ⚠️ The unlabelled fallback is already the word "Chosen", so it must NOT gain a
  // second one ("Chosen chosen:").
  const lines = [...groups.entries()].map(([group, labels]) => {
    const noun = labels.length > 1 ? pluralizeLabel(group) : group;
    const heading = group === UNLABELLED ? UNLABELLED : `${noun} chosen`;
    return `<p><em>${heading}: <strong>${labels.join(", ")}</strong></em></p>`;
  });
  return lines.join("");
}
