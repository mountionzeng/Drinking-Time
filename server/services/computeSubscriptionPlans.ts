import {
  COMPUTE_UNITS_PER_YUAN,
  MINOR_PER_YUAN,
} from "../../shared/computeMoney";

/**
 * The published catalogue is server-owned.  Payment requests identify an offer
 * by id; they never carry an amount or a credit value supplied by the browser.
 *
 * These are deliberately immutable versions: changing a price creates a new
 * id so an already-created payment order always remains auditable.
 */
export const computeSubscriptionPlans = Object.freeze([
  Object.freeze({
    id: "monthly-20-v1",
    name: "20 算力月订阅",
    amountFen: 1990,
    computeUnits: 20,
    creditMinor: (20 * MINOR_PER_YUAN) / COMPUTE_UNITS_PER_YUAN,
    interval: "month" as const,
    rollover: true as const,
  }),
  Object.freeze({
    id: "monthly-200-v1",
    name: "200 算力月订阅",
    amountFen: 19900,
    computeUnits: 200,
    creditMinor: (200 * MINOR_PER_YUAN) / COMPUTE_UNITS_PER_YUAN,
    interval: "month" as const,
    rollover: true as const,
  }),
]);

/** Client-safe offer data. Settlement values remain private to the server. */
export function getPublicComputeSubscriptionPlans() {
  return computeSubscriptionPlans.map(
    ({ creditMinor: _creditMinor, ...plan }) => ({ ...plan })
  );
}
