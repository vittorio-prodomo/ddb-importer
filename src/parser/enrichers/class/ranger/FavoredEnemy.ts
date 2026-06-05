import DDBEnricherData from "../../data/DDBEnricherData";

export default class FavoredEnemy extends DDBEnricherData {

  // 2024 Ranger "Favored Enemy" grants Hunter's Mark always-prepared with free
  // casts/long-rest. DDB encodes a scale-value table that generic parsing turns
  // into a junk force-damage activity. Suppress that activity but KEEP system.uses
  // so the CONSUMPTION_SPELL_LINKS["Favored Enemy"] post-pass can link Hunter's
  // Mark's free casts to this feature's uses pool.
  get type() {
    return null; // no primary activity -> nothing auto-built
  }

  get override(): IDDBOverrideData | null {
    if (this.is2014) return null; // 2014 Favored Enemy = languages/proficiencies; no junk activity
    return { removeDamage: true };
  }
}
