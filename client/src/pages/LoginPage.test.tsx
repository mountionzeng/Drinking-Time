import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.stubGlobal("React", React);

const themeState = vi.hoisted(() => ({
  visualTheme: "shiguang" as "shiguang" | "nayin",
}));

vi.mock("@/features/nayin/NayinContext", () => ({
  useNayin: () => ({
    visualTheme: themeState.visualTheme,
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

vi.mock("@/features/nayin/views/DailyDrinkHero", () => ({
  default: () => <div data-testid="nayin-login-hero">今日饮品</div>,
}));

vi.mock("@/features/nayin/views/BeverageAmbience", () => ({
  default: () => <div data-testid="nayin-ambience" />,
}));

vi.mock("@/features/nayin/views/WuxingParticles", () => ({
  default: () => <div data-testid="nayin-particles" />,
}));

vi.mock("@/features/nayin/views/WuxingPourReveal", () => ({
  WuxingPourContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/features/auth/views/AuthEntryPanel", () => ({
  default: ({ variant }: { variant: string }) => (
    <div data-testid="auth-entry">{variant}</div>
  ),
}));

describe("LoginPage", () => {
  it("uses the Shiguang identity and keeps the two focused login paths", () => {
    themeState.visualTheme = "shiguang";
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain('aria-label="拾光家忆"');
    expect(html).toContain("拾光");
    expect(html).toContain("邮箱登录");
    expect(html).toContain("微信登录");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="auth-entry">email');
    expect(html).not.toContain("/shiguang/mobile-avatar.png");
    expect(html).not.toContain("SHIGUANG JIAYI");
    expect(html).not.toContain("让珍藏的故事，在这里继续生长");
    expect(html).not.toContain("长流水");
    expect(html).not.toContain("Drinking Time");
  });

  it("restores the original daily-drink login composition for Nayin", () => {
    themeState.visualTheme = "nayin";
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain('data-testid="nayin-login-hero"');
    expect(html).toContain('data-testid="nayin-ambience"');
    expect(html).toContain('data-testid="nayin-particles"');
    expect(html).toContain("长流水");
    expect(html).toContain("邮箱登录");
    expect(html).toContain("微信登录");
    expect(html).not.toContain("shiguang-login-card");
  });
});
