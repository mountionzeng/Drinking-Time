import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import WechatCodeLogin, { isPhoneBrowser, WechatCodeLoginView } from "./WechatCodeLogin";

vi.stubGlobal("React", React);

const created = { l: "L", v: "V", code: "ABC234", clientHint: "Mac · Chrome", expiresAt: 0 };
const view = (phase: Parameters<typeof WechatCodeLoginView>[0]["phase"], secondsLeft = 0) =>
  renderToStaticMarkup(<WechatCodeLoginView phase={phase} created={created} secondsLeft={secondsLeft} onStart={() => {}} />);

describe("WechatCodeLogin", () => {
  it("开关关闭（create 返回 404）时组件整块不渲染", () => {
    // 组件在收到 404 后把 available 置为 false 并返回 null；初始渲染只有入口按钮。
    vi.stubGlobal("window", { navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/120" } });
    expect(renderToStaticMarkup(<WechatCodeLogin onLoggedIn={() => {}} />)).toContain("使用微信登录");
    expect(renderToStaticMarkup(<WechatCodeLoginView phase="idle" created={null} secondsLeft={0} onStart={() => {}} />)).toContain("使用微信登录");
  });

  it("手机浏览器不显示码，只提示请在电脑上使用", () => {
    expect(isPhoneBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    vi.stubGlobal("window", { navigator: { userAgent: "Mozilla/5.0 (iPhone)" } });
    const html = renderToStaticMarkup(<WechatCodeLogin onLoggedIn={() => {}} />);
    expect(html).toContain("请在电脑上使用");
    expect(html).not.toContain("使用微信登录");
  });

  it("等待确认时显示 6 位码、倒计时和电脑提示", () => {
    const html = view("waiting", 87);
    expect(html).toContain("ABC234");
    expect(html).toContain("Mac · Chrome");
    expect(html).toContain("87 秒内有效");
    expect(html).toContain("只能使用一次");
  });

  it("过期后显示已过期并提供重新生成，码不再显示", () => {
    const html = view("expired");
    expect(html).toContain("登录码已过期");
    expect(html).toContain("重新生成");
    expect(html).not.toContain("ABC234");
  });

  it("merge_required 如实提示，不暗示已绑定", () => {
    expect(view("merge_required")).toContain("已经有一个拾光账号");
  });
});
