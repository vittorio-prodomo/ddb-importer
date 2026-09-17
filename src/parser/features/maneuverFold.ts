/**
 * T232 (Vittorio's design, 2026-09-17): the 2024 Battle Master's chosen maneuvers become
 * ACTIVITIES of the one "Maneuver Options" feature, instead of one "Maneuver: X" item each.
 *
 * DDB models a chosen maneuver as a choice under a parent feature literally named "Maneuver
 * Options", so the importer emits the parent (an inert copy of the PHB's alphabetical sidebar,
 * ~7,000 characters) AND one prefixed item per choice. Folded:
 *
 *  - the parent keeps its name, takes each child's activities (renamed to the bare maneuver name)
 *    and effects, and describes ONLY what was chosen — one `<h3>` per maneuver, the "options
 *    chosen" addendum once;
 *  - `flags.ddbimporter.chosenManeuvers` lists the bare names. That flag survives a Chris's
 *    Premades swap, whose "Maneuver Options" premade arrives with every maneuver and prunes itself
 *    to this list;
 *  - the children are removed.
 *
 * Carrying the activities (rather than only stamping) keeps the feature working WITHOUT a premade:
 * a world with the swap off still gets a parent whose activities are the importer's own.
 *
 * Pure: plain item data in, plain item data out.
 */

export const MANEUVER_PARENT_NAME = "Maneuver Options";
const CHILD_PREFIXES = ["Maneuver Options: ", "Maneuver: ", "Maneuvers: "];
const ADDENDUM = /<p><em>[^<]*chosen: <strong>[\s\S]*?<\/strong><\/em><\/p>/gi;
const ABILITY_SUFFIX = /\s*\((?:Str|Dex)\.?\)\s*$/i;

type AnyItem = Record<string, any>;

function originalName(item: AnyItem): string {
  return String(item?.flags?.ddbimporter?.originalName ?? item?.name ?? "");
}

function isParent(item: AnyItem): boolean {
  if (item?.type !== "feat") return false;
  if (item?.flags?.ddbimporter?.is2014 === true) return false;
  return originalName(item) === MANEUVER_PARENT_NAME || item?.name === MANEUVER_PARENT_NAME;
}

/** The bare maneuver name of a child item, or null when the item is not one. */
export function bareManeuverName(item: AnyItem): string | null {
  if (item?.type !== "feat") return null;
  const choice = item?.flags?.ddbimporter?.dndbeyond?.choice;
  if (choice?.parentName === MANEUVER_PARENT_NAME && typeof choice?.label === "string" && choice.label.trim()) {
    return choice.label.replace(ABILITY_SUFFIX, "").trim();
  }
  if (item?.system?.type?.subtype !== "maneuver") return null;
  for (const name of [item?.name, originalName(item)]) {
    const prefix = CHILD_PREFIXES.find((p) => String(name ?? "").startsWith(p));
    if (prefix) return String(name).slice(prefix.length).replace(ABILITY_SUFFIX, "").trim() || null;
  }
  return null;
}

function stripWrapper(html: string): string {
  const match = (/^\s*<div class="ddb">\s*([\s\S]*?)\s*<\/div>\s*$/i).exec(html);
  return (match ? match[1] : html).trim();
}

/** A child's rules text: the pre-addendum text when the parser kept it, else the description minus the addendum. */
function childText(item: AnyItem): string {
  const initial = item?.flags?.ddbimporter?.initialFeature?.value;
  if (typeof initial === "string" && initial.trim()) return stripWrapper(initial);
  return stripWrapper(String(item?.system?.description?.value ?? "")).replace(ADDENDUM, "").trim();
}

function firstAddendum(items: AnyItem[]): string {
  for (const item of items) {
    const found = String(item?.system?.description?.value ?? "").match(ADDENDUM);
    if (found?.length) return found[0];
  }
  return "";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A deterministic 16-character id, so a re-import produces the same activity ids. */
export function foldedId(prefix: string, name: string, taken: Set<string>): string {
  const slug = name.replace(/[^A-Za-z0-9]/g, "");
  let id = (prefix + slug).padEnd(16, "0").slice(0, 16);
  for (let n = 1; taken.has(id); n++) id = (prefix + slug).slice(0, 16 - String(n).length).padEnd(16 - String(n).length, "0") + String(n);
  taken.add(id);
  return id;
}

/**
 * Fold the chosen maneuvers into the parent. Returns the SAME array when there is nothing to fold
 * (no 2024 parent, or no children), a new one otherwise. Never mutates its input.
 */
export function foldManeuversIntoParent<T extends AnyItem>(items: T[]): T[] {
  const parentIndex = (items ?? []).findIndex(isParent);
  if (parentIndex === -1) return items;
  const children = items
    .map((item, index) => ({ item, index, bare: index === parentIndex ? null : bareManeuverName(item) }))
    .filter((c): c is { item: T; index: number; bare: string } => typeof c.bare === "string")
    .sort((a, b) => a.bare.localeCompare(b.bare, "en", { sensitivity: "base" }));
  if (!children.length) return items;

  const parent = structuredClone(items[parentIndex]) as AnyItem;
  parent.system ??= {};
  parent.system.activities = { ...(parent.system.activities ?? {}) };
  parent.effects = [...(parent.effects ?? [])];
  const activityIds = new Set<string>(Object.keys(parent.system.activities));
  const effectIds = new Set<string>(parent.effects.map((e: AnyItem) => String(e._id)));

  const sections: string[] = [];
  for (const { item, bare } of children) {
    const child = structuredClone(item) as AnyItem;
    const effectIdMap = new Map<string, string>();
    for (const effect of child.effects ?? []) {
      let id = String(effect._id ?? "");
      if (!id || effectIds.has(id)) {
        const renamed = foldedId("fx", `${bare}${effect.name ?? ""}`, effectIds);
        effectIdMap.set(id, renamed);
        id = renamed;
      } else effectIds.add(id);
      parent.effects.push({ ...effect, _id: id });
    }
    const activities = Object.values(child.system?.activities ?? {}) as AnyItem[];
    activities.forEach((activity, n) => {
      const id = foldedId("mf", n === 0 ? bare : `${bare}${activity.name ?? n}`, activityIds);
      const name = n === 0 ? bare : (activity.name ? `${bare}: ${activity.name}` : `${bare} ${n + 1}`);
      parent.system.activities[id] = {
        ...activity,
        _id: id,
        name,
        img: activity.img || child.img,
        effects: (activity.effects ?? []).map((ref: AnyItem) => ({ ...ref, _id: effectIdMap.get(String(ref._id)) ?? ref._id })),
      };
    });
    sections.push(`<h3>${escapeHtml(bare)}</h3>${childText(child)}`);
  }

  // No `<div class="ddb">` wrapper here: the character importer wraps every item's description
  // AFTER this runs (DDBCharacterImporter, the item map), and a second one nests.
  const addendum = firstAddendum([items[parentIndex], ...children.map((c) => c.item)]);
  parent.system.description = { ...(parent.system.description ?? {}), value: `${sections.join("")}${addendum}` };
  parent.flags ??= {};
  // Each maneuver's own icon, for the premade to dress its activities with (its pack gives most of
  // them the same crossed swords). A placeholder is no icon.
  const maneuverIcons: Record<string, string> = {};
  for (const { item, bare } of children) {
    const img = String(item?.img ?? "");
    if (img && !(/\/svg\/|mystery-man|item-bag|feature\.svg/i).test(img)) maneuverIcons[bare] = img;
  }
  parent.flags.ddbimporter = {
    ...(parent.flags.ddbimporter ?? {}),
    chosenManeuvers: children.map((c) => c.bare),
    maneuverIcons,
    maneuversFolded: true,
  };

  const removed = new Set(children.map((c) => c.index));
  return items.map((item, index) => (index === parentIndex ? (parent as T) : item)).filter((_, index) => !removed.has(index));
}
