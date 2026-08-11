import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthEntryPanel from "./AuthEntryPanel";

vi.stubGlobal("React", React);
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ refresh: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
}));

describe("AuthEntryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  it("内测入口要求邮箱与邀请码，不展示 Google 绕行入口", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel />);

    expect(html).toContain("登录聊会儿");
    expect(html).toContain("邮箱");
    expect(html).toContain('placeholder="邀请码"');
    expect(html).toContain("使用邀请码登录");
    expect(html).toContain("使用邮箱和专属邀请码直接登录。");
    expect(html).not.toContain("邮箱验证码");
    expect(html).not.toContain("6位验证码");
    expect(html).toContain("还没有邀请码，请联系邀请你来测试的人。");
    expect(html).toContain("认识合适的人？推荐给我们");
    expect(html).toContain(
      'href="https://www.drinkingtime.top/drinking-time-vision/#refer"'
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("用 Google 帐号继续");
  });

  it("已记住邮箱时仍然要求填写专属邀请码", () => {
    vi.stubGlobal("window", {
      location: { search: "" },
      localStorage: {
        getItem: vi.fn(() => "friend@example.com"),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });

    const html = renderToStaticMarkup(<AuthEntryPanel />);

    expect(html).toContain('value="friend@example.com"');
    expect(html).toContain("换一个邮箱");
    expect(html).toContain('placeholder="邀请码"');
    expect(html).toContain('required=""');
  });
});
