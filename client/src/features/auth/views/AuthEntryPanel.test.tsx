import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthEntryPanel from "./AuthEntryPanel";
import { resolvePostLoginDestination } from "../mobileReturnPath";

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

  it("欢迎页保留邮箱邀请码和测试站已有的 Google 入口", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel />);

    expect(html).toContain("登录拾光");
    expect(html).toContain('href="/api/auth/google"');
    expect(html).toContain("邮箱");
    expect(html).toContain('placeholder="邀请码"');
    expect(html).toContain("使用邀请码登录");
    expect(html).toContain("使用邮箱和专属邀请码直接登录。");
    expect(html).not.toContain("邮箱验证码");
    expect(html).not.toContain("6位验证码");
    expect(html).toContain("还没有邀请码，请联系邀请你来测试的人。");
    expect(html).not.toContain("认识合适的人？推荐给我们");
    expect(html).not.toContain("#refer");
    expect(html).not.toContain("用 Google 帐号继续");
  });

  it("邮箱登录视图使用验证码并保留 Google 和折叠配对入口", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel variant="email" />);
    expect(html).toContain('href="/api/auth/google"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain("获取验证码");
    expect(html).toContain("shiguang-auth-button-google");
    expect(html).toContain("shiguang-auth-entry");
    expect(html).not.toContain('placeholder="邀请码"');
    expect(html).not.toContain("使用邀请码登录");
    expect(html).toContain('<details class="group">');
  });

  it("手机入口把受控返回路径带到 Google 登录", () => {
    const html = renderToStaticMarkup(
      <AuthEntryPanel returnPath="/m" variant="email" />
    );
    expect(html).toContain('href="/api/auth/google?returnTo=%2Fm"');
  });

  it("微信登录视图接收拾光家忆为所选故事生成的一次性电脑登录码", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel variant="pairing" />);
    expect(html).toContain("打开微信里的故事");
    expect(html).toContain("微信里的拾光家忆 → 我的 → 在电脑上继续");
    expect(html).toContain("先在拾光家忆选择故事");
    expect(html).toContain('aria-label="电脑登录码"');
    expect(html).toContain("打开微信故事");
    expect(html).not.toContain("使用 Google 账号登录");
    expect(html).not.toContain('aria-label="邮箱"');
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

  it("登录成功目的地只接受规范手机入口", () => {
    expect(resolvePostLoginDestination("/m")).toBe("/m");
    expect(resolvePostLoginDestination("//evil.example")).toBe("/editing");
    expect(resolvePostLoginDestination("/admin/users")).toBe("/editing");
    expect(resolvePostLoginDestination("%2Fm")).toBe("/editing");
  });
});
