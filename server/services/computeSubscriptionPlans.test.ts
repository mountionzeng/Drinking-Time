import { describe, expect, it } from "vitest";
import { formatComputeUnits } from "../../shared/computeMoney";
import {
  computeSubscriptionPlans,
  getPublicComputeSubscriptionPlans,
} from "./computeSubscriptionPlans";

describe("approved monthly subscription offers", () => {
  it("credits the approved compute amount, not twice the payment amount", () => {
    expect(
      computeSubscriptionPlans.map(plan => ({
        amountFen: plan.amountFen,
        credit: formatComputeUnits(plan.creditMinor),
        interval: plan.interval,
        rollover: plan.rollover,
      }))
    ).toEqual([
      {
        amountFen: 1990,
        credit: "40.00 算力",
        interval: "month",
        rollover: true,
      },
      {
        amountFen: 19900,
        credit: "400.00 算力",
        interval: "month",
        rollover: true,
      },
    ]);
  });

  it("keeps public catalog copies from modifying server settlement values", () => {
    const plans = getPublicComputeSubscriptionPlans();
    expect(plans.every(plan => !("creditMinor" in plan))).toBe(true);
    Reflect.set(plans[0], "amountFen", 1);
    expect(getPublicComputeSubscriptionPlans()[0].amountFen).toBe(1990);
  });
});
