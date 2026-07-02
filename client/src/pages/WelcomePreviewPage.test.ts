import { describe, expect, it } from "vitest";

import { resolveWelcomeEntryPath } from "./WelcomePreviewPage";

describe("resolveWelcomeEntryPath", () => {
  it("未登录时把欢迎页入口导向登录页", () => {
    expect(resolveWelcomeEntryPath(false)).toBe("/login");
  });

  it("已登录时把欢迎页入口导向工作台", () => {
    expect(resolveWelcomeEntryPath(true)).toBe("/analysis");
  });
});
