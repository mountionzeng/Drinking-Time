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
    expect(html).toContain("发送邮箱验证码");
    expect(html).toContain(
      "每次登录都需要邮箱、专属邀请码和邮件验证码。"
    );
    expect(html).toContain("还没有邀请码，请联系邀请你来测试的人。");
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
