import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AuthEntryPanel from "./AuthEntryPanel";

vi.stubGlobal("React", React);
vi.stubGlobal("window", {
  location: { search: "" },
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ refresh: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
}));

describe("AuthEntryPanel", () => {
  it("内测入口只展示邮箱与首次邀请码，不展示 Google 绕行入口", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel />);

    expect(html).toContain("登录聊会儿");
    expect(html).toContain("邮箱");
    expect(html).toContain("邀请码（第一次登录需要）");
    expect(html).toContain("发送邮箱验证码");
    expect(html).toContain("第一次来需要邀请码，回来时只填邮箱。");
    expect(html).toContain("还没有邀请码，请联系邀请你来测试的人。");
    expect(html).not.toContain("用 Google 帐号继续");
  });
});
