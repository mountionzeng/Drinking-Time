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
  it("内测入口只展示邮箱与邀请码直接登录", () => {
    const html = renderToStaticMarkup(<AuthEntryPanel />);

    expect(html).toContain("登录聊会儿");
    expect(html).toContain("邮箱");
    expect(html).toContain("邀请码");
    expect(html).toContain("进入聊会儿");
    expect(html).toContain("邮箱用来区分账号，不会发送邮件。");
    expect(html).toContain("邀请码会绑定这个邮箱，以后登录仍使用同一枚。");
    expect(html).not.toContain("验证码");
    expect(html).not.toContain("用 Google 帐号继续");
  });
});
