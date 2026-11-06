import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PhoneLoginPanel, { PhoneLoginPanelView } from "./PhoneLoginPanel";

vi.stubGlobal("React", React);

const noop = () => {};

function view(
  configured: boolean | null,
  overrides: Partial<Parameters<typeof PhoneLoginPanelView>[0]> = {}
) {
  return renderToStaticMarkup(
    <PhoneLoginPanelView
      configured={configured}
      phone=""
      code=""
      busy={null}
      error=""
      notice=""
      seconds={0}
      onPhoneChange={noop}
      onCodeChange={noop}
      onSend={noop}
      onLogin={noop}
      {...overrides}
    />
  );
}

describe("PhoneLoginPanelView", () => {
  it("checking state shows status without phone inputs", () => {
    const html = view(null);
    expect(html).toContain('data-testid="phone-login-panel"');
    expect(html).toContain('data-configured="pending"');
    expect(html).toContain("正在检查登录服务…");
    expect(html).not.toContain('id="login-phone"');
    expect(html).not.toContain("获取验证码");
  });

  it("unconfigured state shows unavailable notice without a fake form", () => {
    const html = view(false);
    expect(html).toContain('data-configured="false"');
    expect(html).toContain("手机号登录暂未开放，请使用邮箱或 Google 登录");
    expect(html).not.toContain('id="login-phone"');
    expect(html).not.toContain('id="login-phone-code"');
    expect(html).not.toContain("获取验证码");
  });

  it("configured state shows phone form and new-account isolation copy", () => {
    const html = view(true, { phone: "13800138000", code: "123456" });
    expect(html).toContain('data-configured="true"');
    expect(html).toContain('aria-label="手机号"');
    expect(html).toContain('id="login-phone"');
    expect(html).toContain("获取验证码");
    expect(html).toContain("未注册的手机号验证后将创建新账号。已有邮箱或微信账号，请使用原登录方式。");
  });

  it("shows send countdown and login busy labels", () => {
    expect(view(true, { seconds: 42 })).toContain("42 秒后重发");
    expect(view(true, { busy: "send" })).toContain("发送中…");
    expect(view(true, { busy: "login", phone: "13800138000", code: "123456" })).toContain(
      "正在登录…"
    );
  });
});

describe("PhoneLoginPanel", () => {
  it("初始静态渲染处于检查中，不暴露可点的发码按钮", () => {
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      AbortController,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    const html = renderToStaticMarkup(<PhoneLoginPanel />);
    expect(html).toContain("正在检查登录服务…");
    expect(html).not.toContain('id="login-phone"');
  });
});
