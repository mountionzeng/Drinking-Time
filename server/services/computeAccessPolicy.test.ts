import { describe, expect, it } from "vitest";

import { isLocalUnlimitedCompute } from "./computeAccessPolicy";

describe("local compute access policy", () => {
  it("only enables unlimited compute for the local development server", () => {
    expect(isLocalUnlimitedCompute({ NODE_ENV: "development" })).toBe(false);
    expect(
      isLocalUnlimitedCompute({
        NODE_ENV: "development",
        LOCAL_COMPUTE_UNLIMITED: "true",
      })
    ).toBe(true);
    expect(isLocalUnlimitedCompute({ NODE_ENV: "production" })).toBe(false);
    expect(isLocalUnlimitedCompute({ NODE_ENV: "test" })).toBe(false);
    expect(isLocalUnlimitedCompute({ NODE_ENV: "development", LOCAL_COMPUTE_UNLIMITED: "false" })).toBe(false);
  });
});
