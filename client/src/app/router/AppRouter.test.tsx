import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  mobileLoginHref,
  readMobileReturnPath,
  resolvePostLoginDestination,
} from "@/features/auth/mobileReturnPath";

describe("mobile route and login return", () => {
  it("builds one canonical protected mobile return", () => {
    expect(mobileLoginHref("/m")).toBe("/login?returnTo=%2Fm");
    expect(readMobileReturnPath("?returnTo=%2Fm")).toBe("/m");
    expect(resolvePostLoginDestination("/m")).toBe("/m");
    expect(resolvePostLoginDestination(null)).toBe("/editing");
  });

  it("rejects open redirects and encoded normalization bypasses", () => {
    const unsafeSearches = [
      "?returnTo=https%3A%2F%2Fevil.example",
      "?returnTo=%2F%2Fevil.example",
      "?returnTo=%5C%5Cevil.example",
      "?returnTo=%252Fm",
      "?returnTo=%2Fm%252f..%252fadmin",
      "?returnTo=%2Fm%2F..%2Fadmin",
      "?returnTo=%2Fadmin%2Fusers",
      "?returnTo=%2Fm%2F",
      "?returnTo=%2Fm&returnTo=%2Fadmin",
      "?returnTo=%00%2Fm",
    ];

    for (const search of unsafeSearches) {
      expect(readMobileReturnPath(search), search).toBeNull();
    }
  });

  it("registers /m before the legacy subpath redirect", () => {
    const source = readFileSync(
      new URL("./AppRouter.tsx", import.meta.url),
      "utf8"
    );
    const canonical = source.indexOf('<Route path="/m">');
    const legacy = source.indexOf('<Route path="/m/:rest*">');

    expect(canonical).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(canonical);
    expect(source).toContain("<MobileWorkspacePage />");
    expect(source).toContain('<Redirect to="/m" />');
  });
});
