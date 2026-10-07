import { describe, expect, it } from "vitest";
import { mobileLoginHref, readMobileReturnPath } from "./mobileReturnPath";

describe("shared story login return", () => {
  const path = `/s/${"A".repeat(43)}`;
  it("returns to the same shared story after login", () => {
    expect(readMobileReturnPath(mobileLoginHref(path).split("?")[1])).toBe(
      path
    );
  });
  it.each([
    `https://evil.example${path}`,
    `//evil.example${path}`,
    `${path}/..`,
    `${path}?extra=yes`,
    `${path}\n`,
    `/s/%41${"A".repeat(42)}`,
  ])("rejects unsafe paths %s", value => {
    expect(
      readMobileReturnPath(`?returnTo=${encodeURIComponent(value)}`)
    ).toBeNull();
  });
});
