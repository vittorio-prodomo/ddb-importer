import DDBEnricherData from "../data/DDBEnricherData";

export default class MagicMissile extends DDBEnricherData {

  // Magic Missile auto-hits (no attack roll) -> model as a damage activity.
  // The dart COUNT scales with slot level via target.affects.count; the per-dart
  // damage is a flat 1d4+1 force (no damage scaling).
  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.DAMAGE;
  }

  get activity(): IDDBActivityData {
    return {
      targetType: "creature",
      targetCount: "2 + @item.level", // 3 darts at L1, +1 per upcast level
      targetChoice: true, // distribute darts among targets
      data: {
        damage: {
          parts: [
            DDBEnricherData.basicDamagePart({
              number: 1,
              denomination: 4,
              type: "force",
              bonus: "1",
              scalingMode: "none",
            }),
          ],
        },
      },
    };
  }
}
