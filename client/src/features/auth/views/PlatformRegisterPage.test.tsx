import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PlatformRegisterView,
  platformRegistrationCompleteBody,
  platformRegistrationStatusUrl,
} from "./PlatformRegisterPage";

vi.stubGlobal("React", React);

const view = (phase: Parameters<typeof PlatformRegisterView>[0]["phase"], message = "") =>
  renderToStaticMarkup(
    <PlatformRegisterView
      phase={phase}
      channel="email"
      subject=""
      code=""
      message={message}
      onChannel={() => {}}
      onSubject={() => {}}
      onCode={() => {}}
      onSend={() => {}}
      onComplete={() => {}}
      onCancel={() => {}}
    />,
  );

describe("平台新用户验证", () => {
  it("explains that the account and the gift wait for email or phone verification", () => {
    const html = view("pending");
    expect(html).toContain("完成邮箱或手机验证");
    expect(html).toContain("现在不会建号");
    expect(html).toContain("发送验证码");
    expect(html).toContain("取消");
    expect(platformRegistrationStatusUrl()).toBe("/api/auth/platform-registration");
    expect(platformRegistrationStatusUrl()).not.toContain("?");
    const body = platformRegistrationCompleteBody({ channel: "email", subject: "a@example.com", code: "123456" });
    expect(Object.keys(body).sort()).toEqual(["channel", "code", "subject"]);
    expect(JSON.stringify(body)).not.toContain("emailVerified");
    expect(JSON.stringify(body)).not.toContain("openId");
  });

  it("shows expiry, cancellation, and a conflict that does not enter the old account", () => {
    expect(view("expired")).toContain("已过期");
    expect(view("expired")).toContain("账号还没创建");
    expect(view("cancelled")).toContain("已取消");
    expect(view("cancelled")).toContain("没有赠送算力");
    expect(view("conflict")).toContain("已经有账号");
    expect(view("conflict")).toContain("没有登录那个账号");
    expect(view("conflict")).toContain("没有合并余额或预占");
    expect(view("missing")).toContain("重新进入");
    expect(view("error", "验证码不正确或已用过。")).toContain("验证码不正确或已用过。");
  });
});
