/**
 * T222 — heal an effect duration that carries a stray round beside its real seconds.
 *
 * dnd5e's sheet button "create temporary effect" stamps `duration.rounds: 1` as a
 * default; content authored through it then sets the real duration in seconds
 * ("1 minute") and the default round is never cleared. 17 official 2024 spells ship
 * like that (Jump, Hex, Bane, Longstrider, …). In combat the round wins on the way
 * in — the applied effect arrives with `rounds: 1` and NO seconds — so a one-minute
 * buff dies at the next round. dnd5e's own activity→effect conversion never emits
 * both fields, so the pair carries no intent: nulling the round restores the author's
 * duration and lets times-up convert seconds into rounds by itself.
 */

export interface EffectDurationLike {
  seconds?: number | null;
  rounds?: number | null;
  turns?: number | null;
  [k: string]: unknown;
}

export const ROUND_SECONDS = 6;

/** True when both are set and disagree — the shape we heal. */
export function hasStrayRound(duration: EffectDurationLike | null | undefined, roundSeconds = ROUND_SECONDS): boolean {
  if (!duration) return false;
  const { seconds, rounds } = duration;
  if (typeof seconds !== "number" || !(seconds > 0)) return false;
  if (typeof rounds !== "number" || !(rounds > 0)) return false;
  return rounds * roundSeconds !== seconds;
}

/**
 * Heal every effect on a plain item data object (the shape the importer writes).
 * @returns the number of effects changed
 */
export function healItemEffectDurations(item: { effects?: Array<{ duration?: EffectDurationLike | null; [k: string]: unknown }>; system?: { duration?: { units?: string | null } } } | null | undefined, roundSeconds = ROUND_SECONDS): number {
  let changed = 0;
  // A spell whose OWN duration is in rounds/turns (2014 Command: "1 round") carries the
  // truth in `rounds` — there the seconds are the stray, not our business here.
  const units = item?.system?.duration?.units;
  if (units === "round" || units === "turn") return 0;
  for (const effect of item?.effects ?? []) {
    if (!hasStrayRound(effect?.duration, roundSeconds)) continue;
    effect.duration!.rounds = null;
    changed++;
  }
  return changed;
}
