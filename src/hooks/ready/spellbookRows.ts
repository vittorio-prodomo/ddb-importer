import { logger } from "../../lib/_module";
import { normaliseGrantName, planSpellbookRowChanges, usableSpellSourceUuids } from "../../parser/spells/grantedSpellRows";
import { PICKER_EXTRA_HIDES, planDualPoolShape } from "../../parser/spells/dualPoolShape";
import { featureNameCandidates, grantingFeatureName, sourceItemKey } from "../../parser/spells/grantSourceItem";

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

  // Coverage = the rows that are NOT cached copies — and only the USABLE ones:
  // an unprepared full-list catalogue row cannot take over a spellbook row
  // (the Wood-Elf Longstrider bug, 2026-08-30). A cached row must never be
  // the justification for hiding itself.
  const covered = usableSpellSourceUuids(
    actor.items
      .filter((i) => i.type === "spell" && !i.getFlag("dnd5e", "cachedFor"))
      .map((i) => ({ _stats: { compendiumSource: i._stats?.compendiumSource }, system: i.system })),
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

function slugify(name: string): string {
  return `${name}`.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Enforce the vanilla dual-pool shape on every spell the parse stamped with
 * `flags.ddbimporter.dualPoolGrant` (see AdvancementHelper's merge case). Runs
 * post-swap and idempotently: a conformant actor produces zero updates.
 */
/**
 * Point every granted spell's `system.sourceItem` at the FEATURE that granted it, so
 * the sheet subtitle names it instead of the actor's spellcasting class. Rationale and
 * the accepted class-filter trade-off live in `grantSourceItem.ts`.
 *
 * Idempotent: a row already pointing at the right feature produces no update.
 */
async function enforceGrantSourceItems(actor): Promise<void> {
  if (!actor?.items) return;
  for (const item of actor.items) {
    if (item.type !== "spell") continue;
    const featureName = grantingFeatureName(item.flags);
    if (!featureName) continue;

    let featureItem = null;
    for (const candidate of featureNameCandidates(featureName)) {
      featureItem = actor.items.find((f) =>
        ["feat", "feature", "race", "background", "subclass"].includes(f.type)
        && [f.name, foundry.utils.getProperty(f, "flags.ddbimporter.originalName")]
          .filter(Boolean)
          .some((n) => normaliseGrantName(n) === normaliseGrantName(candidate)));
      if (featureItem) break;
    }
    if (!featureItem) continue;

    const key = sourceItemKey({ type: featureItem.type, identifier: featureItem.identifier });
    // ⚠️ Verify it actually resolves before writing. A sourceItem pointing at nothing
    // fails silently and leaves the old subtitle in place, which reads as "the change
    // did not ship" rather than "the identifier was wrong".
    if (!key || !actor.identifiedItems?.get(key)?.first()) continue;
    if (item.system.sourceItem === key) continue;

    await item.update({ "system.sourceItem": key });
    logger.info(`Spell subtitle: ${item.name} now credits ${featureItem.name}`, { sourceItem: key });
  }
}

async function enforceDualPoolShapes(actor): Promise<void> {
  if (!actor?.items) return;
  for (const item of actor.items) {
    const stamp = foundry.utils.getProperty(item, "flags.ddbimporter.dualPoolGrant") as
      import("../../parser/spells/dualPoolShape").DualPoolStamp | undefined;
    if (!stamp?.feature || item.type !== "spell") continue;
    const src = item.toObject();

    // Scale formula: prefer the class scale value when it resolves to the
    // stamped number (the official Hunter's Mark uses @scale.ranger.favored-enemy).
    let scaleFormula = null;
    const sourceItem = `${src.system.sourceItem ?? ""}`;
    if (sourceItem.startsWith("class:")) {
      const classId = sourceItem.slice(6);
      const slug = slugify(stamp.feature);
      const raw = foundry.utils.getProperty(actor.getRollData(), `scale.${classId}.${slug}`) as any;
      const value = Number(raw?.value ?? raw);
      if (Number.isFinite(value) && value === Number(stamp.uses)) scaleFormula = `@scale.${classId}.${slug}`;
    }

    const extraCprIds = PICKER_EXTRA_HIDES[item.identifier] ?? [];
    const cprActivityIds = foundry.utils.getProperty(item, "flags.chris-premades.activityIdentifiers") ?? {};
    const spellSnapshot = {
      identifier: item.identifier,
      name: item.name,
      usesMax: `${src.system.uses?.max ?? ""}`,
      usesSpent: src.system.uses?.spent ?? 0,
      usesRecoveryPeriods: (src.system.uses?.recovery ?? []).map((r) => r.period),
      prepared: src.system.prepared,
      activities: Object.values(src.system.activities ?? {}).map((a: any) => ({
        id: a._id,
        type: a.type,
        name: a.name ?? "",
        spellSlot: a.consumption?.spellSlot === true,
        automationOnly: a.midiProperties?.automationOnly === true,
        activationType: a.activation?.type,
      })),
      extraActivityIds: extraCprIds.map((k) => cprActivityIds[k]).filter(Boolean),
      scaleFormula,
    };

    const featureItem = actor.items.find((f) =>
      ["feat", "feature"].includes(f.type)
      && normaliseGrantName(foundry.utils.getProperty(f, "flags.ddbimporter.originalName") ?? f.name)
        === normaliseGrantName(stamp.feature));
    const featureSnapshot = featureItem ? (() => {
      const fSrc = featureItem.toObject();
      const spellUuid = src._stats?.compendiumSource;
      const grantCastActivityIds = Object.values(fSrc.system.activities ?? {})
        .filter((a: any) => a.type === "cast"
          && (a.spell?.uuid === spellUuid
            || normaliseGrantName(a.name ?? "") === normaliseGrantName(item.name)))
        .map((a: any) => a._id);
      const hasOtherPoolConsumers = Object.values(fSrc.system.activities ?? {})
        .some((a: any) => !grantCastActivityIds.includes(a._id)
          && (a.consumption?.targets ?? []).some((t: any) => t.type === "itemUses"));
      return { usesMax: `${fSrc.system.uses?.max ?? ""}`, grantCastActivityIds, hasOtherPoolConsumers };
    })() : null;

    const plan = planDualPoolShape(stamp, spellSnapshot, featureSnapshot);
    if (plan.spellUpdate) {
      await item.update(plan.spellUpdate);
      logger.info(`Dual-pool shape enforced on ${item.name}`, { update: plan.spellUpdate });
    }
    if (plan.featureUpdate && featureItem) {
      await featureItem.update(plan.featureUpdate);
      logger.info(`Granting feature ${featureItem.name} made inert`, { update: plan.featureUpdate });
    }
  }
}

async function safeCollapse(actor): Promise<void> {
  try {
    // Shape first: stripping a feature's cast activity lets dnd5e remove its
    // cached row itself, leaving less for the collapse half to hide.
    await enforceDualPoolShapes(actor);
    await enforceGrantSourceItems(actor);
    await collapseCachedSpellRows(actor);
  } catch (error) {
    // Never let a cosmetic pass fail an import that otherwise succeeded.
    logger.error("Post-swap spell reconciliation failed", { error, actor });
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
