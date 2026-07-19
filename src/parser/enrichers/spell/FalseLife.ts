import DDBEnricherData from "../data/DDBEnricherData";

export default class FalseLife extends DDBEnricherData {
  get activity(): IDDBActivityData {
    return {
      data: {
        healing: DDBEnricherData.basicDamagePart({
          number: this.is2014 ? 1 : 2,
          denomination: 4,
          bonus: "4",
          types: ["temphp"],
          scalingMode: "whole",
          scalingNumber: 0,     // scaling.number scales DICE; 0 = no extra dice
          scalingFormula: "5",  // flat +5 temp HP per slot level above base
        }),
      },
    };
  }
}
