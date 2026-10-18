import {
  COMPUTE_UNITS_PER_YUAN,
  MINOR_PER_YUAN,
} from "../../shared/computeMoney";

// Approved on 2026-10-09. Keep versions immutable: future prices need new IDs.
// A catalog entry is not permission to debit an Alipay account.
export const computeSubscriptionPlans = Object.freeze([
  Object.freeze({
    id: "monthly-40-v1",
    name: "40 算力月订阅",
    amountFen: 1990,
    computeUnits: 40,
    creditMinor: (40 * MINOR_PER_YUAN) / COMPUTE_UNITS_PER_YUAN,
    interval: "month" as const,
    rollover: true as const,
  }),
  Object.freeze({
    id: "monthly-400-v1",
    name: "400 算力月订阅",
    amountFen: 19900,
    computeUnits: 400,
    creditMinor: (400 * MINOR_PER_YUAN) / COMPUTE_UNITS_PER_YUAN,
    interval: "month" as const,
    rollover: true as const,
  }),
]);

export function getPublicComputeSubscriptionPlans() {
  return computeSubscriptionPlans.map(
    ({ creditMinor: _creditMinor, ...plan }) => plan
  );
}
