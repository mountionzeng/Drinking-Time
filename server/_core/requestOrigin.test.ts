import { describe, expect, it } from "vitest";

import { decideRequestOrigin } from "./requestOrigin";

describe("production request Origin validation", () => {
  const base = {
    isProduction: true,
    appOrigin: "https://www.drinkingtime.top",
  };

  it("allows same-origin unsafe requests", () => {
    expect(
      decideRequestOrigin({
        ...base,
        method: "POST",
        origin: "https://www.drinkingtime.top",
      })
    ).toEqual({ allowed: true, reason: "trusted_origin" });
  });

  it.each([undefined, "https://evil.example", "http://www.drinkingtime.top"])(
    "rejects missing or mismatched unsafe origin %s",
    origin => {
      expect(
        decideRequestOrigin({ ...base, method: "PATCH", origin })
      ).toMatchObject({ allowed: false });
    }
  );

  it("allows safe methods and leaves development unchanged", () => {
    expect(
      decideRequestOrigin({ ...base, method: "GET", origin: undefined })
    ).toMatchObject({ allowed: true, reason: "safe_method" });
    expect(
      decideRequestOrigin({
        ...base,
        isProduction: false,
        method: "POST",
        origin: undefined,
      })
    ).toMatchObject({ allowed: true, reason: "development" });
  });
});
