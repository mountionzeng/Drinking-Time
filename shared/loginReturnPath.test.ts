import { describe, expect, it } from "vitest";
import { allowedLoginReturnPath } from "./loginReturnPath";
import { canAcceptStoryShare } from "./storyContextShare";

describe("share login return path", () => {
  const path = `/s/${"A".repeat(43)}` as const;
  it("round trips only a supported local path through login", () => {
    expect(allowedLoginReturnPath(path)).toBe(path);
    expect(allowedLoginReturnPath("/m")).toBe("/m");
  });
  it.each([
    `https://evil.example${path}`,
    `//evil.example${path}`,
    `${path}/..`,
    `${path}?to=https://evil.example`,
    `${path}\n`,
    `/s/${"A".repeat(42)}`,
    `/s/%41${"A".repeat(42)}`,
    "/editing",
  ])("rejects unsafe or unsupported path %s", value => {
    expect(allowedLoginReturnPath(value)).toBeNull();
  });
  it("requires a real account, including when development auto-creates guests", () => {
    expect(canAcceptStoryShare(null)).toBe(false);
    expect(
      canAcceptStoryShare({ loginMethod: "guest", openId: "guest:123" })
    ).toBe(false);
    expect(canAcceptStoryShare({ openId: "local-guest" })).toBe(false);
    expect(
      canAcceptStoryShare({ loginMethod: "email", openId: "email:123" })
    ).toBe(true);
  });
});
