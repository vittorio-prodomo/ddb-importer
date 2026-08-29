/**
 * The vanilla dual-pool grant shape (official Hunter's Mark), enforced
 * post-swap (T191 follow-on, Vittorio's approved-Warpey state, 2026-08-29).
 *
 * A feature that grants an always-prepared spell the character ALSO has on
 * their class list collapses to ONE spell item carrying:
 *   - its own uses pool (the free casts, long-rest recovery, scale-driven
 *     where the class provides the value);
 *   - a `forward` activity spending that pool and delegating to the
 *     slot-casting activity (hidden from midi's item-level picker via
 *     automationOnly — the routing module owns the click);
 *   - while the granting feature stays INERT: no pool, no cast activities.
 *
 * ⚠️ Why this is a POST-SWAP pass and not parse output: CPR replaces both the
 * spell and the granting feature wholesale (quirk #23), so anything the parse
 * writes to either document is discarded. The parse instead stamps
 * `flags.ddbimporter.dualPoolGrant` on the class spell — ddbimporter flags are
 * the one thing a CPR swap preserves (its matching depends on them) — and this
 * planner turns the stamp into idempotent update ops against whatever
 * actually landed on the actor.
 *
 * Pure: takes plain snapshots, returns a plan. The caller owns documents.
 */

/** Spells whose EXTRA activities must also hide from midi's picker, keyed by
 * item identifier → activity identifiers (resolved via CPR's
 * `activityIdentifiers` flag on the item). One-click casting needs the picker
 * to see exactly one activity. */
export const PICKER_EXTRA_HIDES: Record<string, string[]> = {
  "hunters-mark": ["huntersMarkMove"],
};

/** Deterministic 16-char activity id for the forward, stable across imports. */
export function forwardActivityId(itemIdentifier: string): string {
  const base = `fwd${(itemIdentifier ?? "").replace(/[^a-zA-Z0-9]/g, "")}`;
  return (base + "0000000000000000").slice(0, 16);
}

export interface DualPoolStamp {
  /** free uses per rest, as a string ("2") — DDB's number for the grant */
  uses: string;
  /** the granting feature's (original) name, e.g. "Favored Enemy" */
  feature: string;
}

export interface SpellSnapshot {
  identifier: string;
  name: string;
  usesMax: string;
  usesSpent: number;
  usesRecoveryPeriods: string[];
  activities: {
    id: string;
    type: string;
    name: string;
    spellSlot: boolean;
    automationOnly: boolean;
    activationType?: string;
  }[];
  /** activity ids for PICKER_EXTRA_HIDES, from CPR's activityIdentifiers flag */
  extraActivityIds: string[];
  /** e.g. "@scale.ranger.favored-enemy" when the class scale resolves to the
   * same number as the stamp, else null → literal max */
  scaleFormula: string | null;
}

export interface FeatureSnapshot {
  usesMax: string;
  /** ids of cast activities on the feature that target this grant's spell */
  grantCastActivityIds: string[];
}

export interface DualPoolPlan {
  spellUpdate: Record<string, unknown> | null;
  featureUpdate: Record<string, unknown> | null;
}

/**
 * Compute the (possibly empty) updates that bring one granted spell and its
 * granting feature to the approved shape. Empty plan = already conformant —
 * the pass re-runs on every import and every activity-touching update, so
 * a no-op MUST stay a no-op.
 */
export function planDualPoolShape(
  stamp: DualPoolStamp,
  spell: SpellSnapshot,
  feature: FeatureSnapshot | null,
): DualPoolPlan {
  const spellUpdate: Record<string, unknown> = {};

  // --- the pool -----------------------------------------------------------
  const wantMax = spell.scaleFormula ?? stamp.uses;
  if (`${spell.usesMax}` !== `${wantMax}` || !spell.usesRecoveryPeriods.includes("lr")) {
    spellUpdate["system.uses"] = {
      spent: spell.usesSpent ?? 0,
      max: wantMax,
      recovery: [{ period: "lr", type: "recoverAll" }],
    };
  }

  // --- the forward --------------------------------------------------------
  const slot = spell.activities.find((a) => a.type !== "forward" && a.spellSlot);
  const fwdId = forwardActivityId(spell.identifier);
  const existingForward = spell.activities.find((a) => a.type === "forward");
  if (slot && !existingForward) {
    spellUpdate[`system.activities.${fwdId}`] = {
      _id: fwdId,
      type: "forward",
      name: `${spell.name} (free casting)`,
      activity: { id: slot.id },
      consumption: {
        targets: [{ type: "itemUses", target: "", value: "1", scaling: {} }],
        scaling: { allowed: false },
        spellSlot: true,
      },
      activation: { type: slot.activationType ?? "action", override: false },
      midiProperties: { automationOnly: true },
      sort: 100001,
    };
  } else if (existingForward && !existingForward.automationOnly) {
    spellUpdate[`system.activities.${existingForward.id}.midiProperties.automationOnly`] = true;
  }

  // --- extra picker hides (e.g. Hunter's Mark: Move) ----------------------
  for (const extraId of spell.extraActivityIds) {
    const act = spell.activities.find((a) => a.id === extraId);
    if (act && !act.automationOnly) {
      spellUpdate[`system.activities.${extraId}.midiProperties.automationOnly`] = true;
    }
  }

  // --- the inert feature --------------------------------------------------
  let featureUpdate: Record<string, unknown> | null = null;
  if (feature) {
    const ops: Record<string, unknown> = {};
    for (const id of feature.grantCastActivityIds) ops[`system.activities.-=${id}`] = null;
    if (feature.usesMax !== "" && `${feature.usesMax}` !== "0") {
      ops["system.uses"] = { spent: 0, max: "", recovery: [] };
    }
    if (Object.keys(ops).length) featureUpdate = ops;
  }

  return {
    spellUpdate: Object.keys(spellUpdate).length ? spellUpdate : null,
    featureUpdate,
  };
}
