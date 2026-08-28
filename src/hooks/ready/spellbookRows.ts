import { logger } from "../../lib/_module";
import { planSpellbookRowChanges, spellSourceUuids } from "../../parser/spells/grantedSpellRows";

const HIDDEN_ROWS_FLAG = "hiddenCachedSpellRows";

/**
 * Collapse the duplicate spellbook row a granted spell leaves behind (T191).
 *
 * A feature's Cast activity gets a cached copy of its spell on the actor —
 * created by dnd5e in `ActivitiesTemplate#onCreateActivities`, AFTER the import
 * has written the feature. When the character already has that spell on their own
 * list, the cached copy is a second row for one spell.
 *
 * The parser sets `spell.spellbook: false` for the features it owns. It cannot do
 * so for a feature Chris's Premades adopts: CPR replaces the whole document, so
 * the parse-time write is discarded. This pass re-applies the same rule to
 * whatever actually landed on the actor.
 *
 * ⚠️ Hiding is not deleting. The cached item stays — the activity spends it — and
 * only its spellbook row goes away.
 */
async function collapseCachedSpellRows(actor): Promise<void> {
  if (!actor?.items) return;

  // Coverage = the rows that are NOT cached copies. A cached row must never be
  // the justification for hiding itself.
  const covered = spellSourceUuids(
    actor.items.filter((i) => i.type === "spell" && !i.getFlag("dnd5e", "cachedFor")),
  );
  if (covered.size === 0) return;

  for (const item of actor.items) {
    // ⚠️ system.activities is an ActivityCollection here, not a plain object —
    // Object.keys() returns [] on it. This is the created-document side.
    const castActivities = item.system?.activities?.getByType?.("cast") ?? [];
    if (castActivities.length === 0) continue;

    const previouslyHidden = item.getFlag("ddb-importer", HIDDEN_ROWS_FLAG) ?? [];
    const { hide, restore } = planSpellbookRowChanges({
      activities: castActivities.map((a) => ({
        id: a.id,
        uuid: a.spell?.uuid,
        spellbook: a.spell?.spellbook,
      })),
      covered,
      previouslyHidden,
    });

    if (hide.length === 0 && restore.length === 0) continue;

    const update = {};
    for (const id of hide) update[`system.activities.${id}.spell.spellbook`] = false;
    for (const id of restore) update[`system.activities.${id}.spell.spellbook`] = true;

    const stillHidden = previouslyHidden.filter((id) => !restore.includes(id)).concat(hide);
    update[`flags.ddb-importer.${HIDDEN_ROWS_FLAG}`] = [...new Set(stillHidden)];

    await item.update(update);
    logger.info(
      `Spellbook rows on ${item.name}: hid ${hide.length}, restored ${restore.length} cached spell row(s).`,
      { hide, restore },
    );
  }
}

async function safeCollapse(actor): Promise<void> {
  try {
    await collapseCachedSpellRows(actor);
  } catch (error) {
    // Never let a cosmetic pass fail an import that otherwise succeeded.
    logger.error("Failed to collapse cached spell rows", { error, actor });
  }
}

/**
 * Per-actor trailing debounce. CPR re-points a swapped feature's Cast activity in a
 * BURST — measured on Victus: two `system.activities` updates after the import hook,
 * interleaved with dnd5e deleting and rebuilding the cached spell row. Running the
 * pass inside that burst is a last-writer race, and it was observed losing: one import
 * settled hidden, the next identical import settled visible.
 *
 * Waiting for the burst to stop removes the race entirely, and re-arming on every
 * trigger means a late write simply schedules another pass.
 */
const pending = new Map<string, () => void>();

function scheduleCollapse(actor): void {
  if (!actor?.id) return;
  let run = pending.get(actor.id);
  if (!run) {
    run = foundry.utils.debounce(() => {
      pending.delete(actor.id);
      safeCollapse(actor);
    }, 750);
    pending.set(actor.id, run);
  }
  run();
}

/**
 * ⚠️ TWO triggers, because neither alone is sufficient — this cost three live cycles.
 *
 * `characterProcessDataComplete` fires while CPR's handler on the SAME hook is still
 * running: `Hooks.callAll` does not await async handlers, so the two run concurrently.
 * A CPR premade points its Cast activity at CPR's own spell compendium
 * (`Compendium.chris-premades.CPRSpells2024…`) and its `fixCastActivities` re-points it
 * at the real spell afterwards — so at import-complete time the activity's `spell.uuid`
 * is still the placeholder and matches nothing on the character's list. Measured on
 * Victus: the hook saw the CPR uuid, the settled document had the ddb one.
 *
 * The re-point itself is the second trigger. Watching `updateItem` for a change that
 * touches `system.activities` catches it whoever makes it, and needs no assumption
 * about how CPR issues the write.
 *
 * ⚠️ Do NOT swap this for `createItem` on the cached row. dnd5e only rebuilds that row
 * on some re-point paths — verified: forcing a uuid change by hand fires it, a real
 * import does not — so it silently misses the case this exists for.
 *
 * The rule is idempotent, so running it from both triggers is free.
 */
export function setupSpellbookRowCollapse(): void {
  Hooks.on("ddb-importer.characterProcessDataComplete", ({ actor }) => {
    scheduleCollapse(actor);
  });

  Hooks.on("updateItem", (item, changed, _options, userId) => {
    if (game.user?.id !== userId) return;
    if (!foundry.utils.hasProperty(changed, "system.activities")) return;
    if (!item?.parent?.items) return;
    scheduleCollapse(item.parent);
  });
}
