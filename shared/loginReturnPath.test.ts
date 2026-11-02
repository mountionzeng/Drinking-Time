import { describe, expect, it } from "vitest";
import { allowedLoginReturnPath } from "./loginReturnPath";
import { canAcceptStoryShare } from "./storyContextShare";

describe("share login return path", () => {
  const path = `/s/${"A".repeat(43)}` as const;
  it("round trips only a supported local path through login", () => {
    expect(allowedLoginReturnPath(path)).toBe(path);
    expect(allowedLoginReturnPath("/m")).toBe("/m");
    expect(allowedLoginReturnPath("/wechat-import")).toBe("/wechat-import");
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
    "/wechat-import?returnTo=//evil.test",
    "/wechat-import/..",
    "//evil.test/wechat-import",
  ])("rejects unsafe or unsupported path %s", value => {
    expect(allowedLoginReturnPath(value)).toBeNull();
  });
  it("accepts only exact artwork paths, including after login", () => {
    const artwork = "/p/12345678-1234-4234-8234-123456789abc";
    expect(allowedLoginReturnPath(artwork)).toBe(artwork);
    for (const value of [
      artwork + "\n",
      artwork + "?next=//evil",
      artwork + "/..",
      "https://evil.test" + artwork,
    ])
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
  it("preserves a capture through login without accepting extra destinations or query fields", () => {
    for (const key of ["captureShare", "captureId"]) {
      const capture = `/m?${key}=12345678-1234-4234-8234-123456789abc`;
      expect(allowedLoginReturnPath(capture)).toBe(capture);
      for (const invalid of [capture + "&next=//evil", capture + "\n", capture + "/..", "https://evil.test" + capture, `/m?${key}=invalid`])
        expect(allowedLoginReturnPath(invalid)).toBeNull();
    }
  });
});
