import { describe, expect, it } from "vitest";
import { formatComputeUnits } from "../../shared/computeMoney";
import {
  computeSubscriptionPlans,
  getPublicComputeSubscriptionPlans,
} from "./computeSubscriptionPlans";

describe("published compute subscription offers", () => {
  it("keeps the approved retail price and credited compute separate", () => {
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
        credit: "20.00 算力",
        interval: "month",
        rollover: true,
      },
      {
        amountFen: 19900,
        credit: "200.00 算力",
        interval: "month",
        rollover: true,
      },
    ]);
  });

  it("does not expose or mutate settlement values through the public catalogue", () => {
    const plans = getPublicComputeSubscriptionPlans();
    expect(plans.every(plan => !("creditMinor" in plan))).toBe(true);
    Reflect.set(plans[0], "amountFen", 1);
    expect(getPublicComputeSubscriptionPlans()[0].amountFen).toBe(1990);
  });
});
