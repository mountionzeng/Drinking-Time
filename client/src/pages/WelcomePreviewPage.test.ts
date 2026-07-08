import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { resolveWelcomeEntryPath } from "./WelcomePreviewPage";
import WelcomePreviewPage from "./WelcomePreviewPage";

vi.stubGlobal("React", React);

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/features/analysis/views/GuidedLanding", () => ({
  default: ({
    authPanel,
  }: {
    authPanel?: React.ReactNode;
  }) =>
    React.createElement(
      "main",
      null,
      authPanel ??
        React.createElement("span", { "data-testid": "no-auth-panel" })
    ),
}));

vi.mock("@/features/auth/views/AuthEntryPanel", () => ({
  default: () => React.createElement("section", null, "登录面板"),
}));

vi.mock("@/features/nayin/views/BeverageAmbience", () => ({
  default: () => null,
}));

vi.mock("@/features/nayin/views/WuxingParticles", () => ({
  default: () => null,
}));

describe("resolveWelcomeEntryPath", () => {
  it("未登录时把欢迎页入口导向登录页", () => {
    expect(resolveWelcomeEntryPath(false)).toBe("/login");
  });

  it("已登录时把欢迎页入口导向工作台", () => {
    expect(resolveWelcomeEntryPath(true)).toBe("/analysis");
  });
});

describe("WelcomePreviewPage", () => {
  it("未登录时在欢迎页里挂出登录面板", () => {
    authState.isAuthenticated = false;
    const html = renderToStaticMarkup(React.createElement(WelcomePreviewPage));

    expect(html).toContain("登录面板");
    expect(html).not.toContain("进入工作台");
  });

  it("已登录时不再渲染登录面板", () => {
    authState.isAuthenticated = true;
    const html = renderToStaticMarkup(React.createElement(WelcomePreviewPage));

    expect(html).not.toContain("进入工作台");
    expect(html).not.toContain("登录面板");
  });

  it("/login 入口即使已有本地访客态也显示登录面板", () => {
    authState.isAuthenticated = true;
    const html = renderToStaticMarkup(
      React.createElement(WelcomePreviewPage, { autoFocusAuth: true })
    );

    expect(html).not.toContain("进入工作台");
    expect(html).toContain("登录面板");
  });
});
