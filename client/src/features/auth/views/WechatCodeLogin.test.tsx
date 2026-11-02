import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import WechatCodeLogin, { isPhoneBrowser, WechatCodeLoginView } from "./WechatCodeLogin";

vi.stubGlobal("React", React);

const created = { l: "L", v: "V", qrDataUrl: "data:image/png;base64,aW1hZ2U=", clientHint: "Mac · Chrome", expiresAt: 0 };
const view = (phase: Parameters<typeof WechatCodeLoginView>[0]["phase"], secondsLeft = 0) =>
  renderToStaticMarkup(<WechatCodeLoginView phase={phase} created={created} secondsLeft={secondsLeft} onStart={() => {}} />);

describe("WechatCodeLogin", () => {
  it("尚未请求 create 时初始静态渲染显示入口按钮", () => {
    // 这里只验证初始静态 HTML；404 后隐藏与轮询需要交互环境验证。
    vi.stubGlobal("window", { navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/120" } });
    expect(renderToStaticMarkup(<WechatCodeLogin onLoggedIn={() => {}} />)).toContain("使用微信登录");
    expect(renderToStaticMarkup(<WechatCodeLoginView phase="idle" created={null} secondsLeft={0} onStart={() => {}} />)).toContain("使用微信登录");
  });

  it("手机浏览器复用同一微信登录入口", () => {
    expect(isPhoneBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    vi.stubGlobal("window", { navigator: { userAgent: "Mozilla/5.0 (iPhone)" } });
    const html = renderToStaticMarkup(<WechatCodeLogin onLoggedIn={() => {}} />);
    expect(html).toContain("使用微信登录");
    expect(html).not.toContain("请在电脑上使用");
  });

  it("等待确认时显示本次二维码、倒计时，没有六位码操作", () => {
    const html = view("waiting", 87);
    expect(html).toContain('alt="本次网页登录二维码"');
    expect(html).toContain(created.qrDataUrl);
    expect(html).not.toContain("输入下面的码");
    expect(html).toContain("Mac · Chrome");
    expect(html).toContain("87 秒内有效");
    expect(html).toContain("只能使用一次");
  });

  it("过期后显示已过期并提供重新生成，码不再显示", () => {
    const html = view("expired");
    expect(html).toContain("登录二维码已过期");
    expect(html).toContain("重新生成");
    expect(html).not.toContain("ABC234");
  });

  it("确认后进入正常网页，过期不再展示可扫描图片", () => {
    expect(view("confirmed")).toContain('href="/"');
    expect(view("confirmed")).not.toContain("/wechat-import");
    expect(view("waiting",0)).not.toContain("<img");
  });

  it("merge_required 如实提示，不暗示已绑定", () => {
    expect(view("merge_required")).toContain("已经有一个拾光账号");
  });
});
