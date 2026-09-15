import { describe, expect, it } from "vitest";
import { faviconForTheme } from "./favicon";

describe("faviconForTheme", () => {
  it("keeps the Shiguang brand icon independent of the daily element", () => {
    expect(faviconForTheme("water", "shiguang")).toEqual({
      type: "image/png",
      href: "/shiguang/xiaoyi-avatar-max.png",
    });
    expect(faviconForTheme("fire", "shiguang")).toEqual({
      type: "image/png",
      href: "/shiguang/xiaoyi-avatar-max.png",
    });
  });

  it("keeps the daily drink icon for the Nayin theme", () => {
    const favicon = faviconForTheme("water", "nayin");

    expect(favicon.type).toBe("image/svg+xml");
    expect(favicon.href).toContain("data:image/svg+xml");
    expect(decodeURIComponent(favicon.href)).toContain("#4A7A8A");
  });
});
