import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.stubGlobal("React", React);

vi.mock("@/features/nayin/NayinContext", () => ({
  useNayin: () => ({
    today: {
      cstDateStr: "2026-09-15",
      ganzhi: "壬辰",
      nayinName: "长流水",
      element: "water",
      theme: { element: "water", elementCn: "水" },
      lunar: { yearGanzhi: "丙午", monthCn: "八月", dayCn: "初五" },
    },
  }),
}));

vi.mock("@/features/auth/views/AuthEntryPanel", () => ({
  default: ({ variant }: { variant: string }) => (
    <div data-testid="auth-entry">{variant}</div>
  ),
}));

describe("LoginPage", () => {
  it("uses the Shiguang identity and keeps the two focused login paths", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain('aria-label="拾光家忆"');
    expect(html).toContain("/shiguang/mobile-avatar.png");
    expect(html).toContain("拾光");
    expect(html).toContain("让珍藏的故事，在这里继续生长");
    expect(html).toContain("邮箱登录");
    expect(html).toContain("微信登录");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="auth-entry">email');
    expect(html).not.toContain("Drinking Time");
  });
});
