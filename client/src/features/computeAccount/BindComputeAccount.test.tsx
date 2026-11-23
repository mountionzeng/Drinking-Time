import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BindComputeAccount,
  BindComputeAccountView,
  bindComputeAccountCreateBody,
  canBindComputeAccount,
} from "./BindComputeAccount";

vi.stubGlobal("React", React);

const created = {
  l: "L",
  v: "V",
  qrDataUrl: "data:image/png;base64,aW1hZ2U=",
  clientHint: "Mac · Chrome",
  expiresAt: 0,
};

const view = (phase: Parameters<typeof BindComputeAccountView>[0]["phase"], secondsLeft = 0, scanned = false) =>
  renderToStaticMarkup(
    <BindComputeAccountView phase={phase} created={created} secondsLeft={secondsLeft} scanned={scanned} onStart={() => {}} />,
  );

describe("绑定算力账户", () => {
  it("shows the bind action and the two-sided confirmation", () => {
    const html = view("idle");
    expect(html).toContain("绑定算力账户");
    expect(html).toContain("两边都要同意");
    expect(html).toContain("故事信箱");
    expect(html).toContain("不会合并");
    expect(bindComputeAccountCreateBody()).toEqual({ mode: "bind", presentation: "qr" });
    expect(JSON.stringify(bindComputeAccountCreateBody())).not.toContain("userId");
    expect(JSON.stringify(bindComputeAccountCreateBody())).not.toContain("subject");
    expect(JSON.stringify(bindComputeAccountCreateBody())).not.toContain("mailbox");
  });

  it("says a scan alone is not a bind, and states success without another gift", () => {
    const waiting = view("waiting", 40, true);
    expect(waiting).toContain("只扫到二维码还没有绑定");
    expect(waiting).toContain("40 秒内有效，只能使用一次");
    expect(waiting).toContain(created.qrDataUrl);
    expect(view("confirmed")).toContain("已绑定");
    expect(view("confirmed")).toContain("不会再送首次算力");
    expect(view("confirmed")).not.toContain("<img");
  });

  it("states a conflict without implying the ledgers were merged", () => {
    const html = view("merge_required");
    expect(html).toContain("已经有独立的算力账");
    expect(html).toContain("没有绑定");
    expect(html).toContain("没有合并或划转");
    expect(view("denied")).toContain("拒绝了这次绑定");
    expect(view("expired")).toContain("绑定确认已过期");
  });

  it("区分访客、未登录、功能关闭和过期", () => {
    expect(view("guest" as Parameters<typeof BindComputeAccountView>[0]["phase"])).toContain("正式账号");
    expect(view("unauthenticated" as Parameters<typeof BindComputeAccountView>[0]["phase"])).toContain("请先登录");
    expect(view("disabled")).toContain("还没开启");
    expect(view("expired")).toContain("已过期");
    expect(view("disabled")).not.toContain("正式账号");
  });

  it("hides the action for guests and signed-out visitors", () => {
    expect(canBindComputeAccount(null)).toBe(false);
    expect(canBindComputeAccount({ id: 1, loginMethod: "guest", openId: "guest:1" })).toBe(false);
    expect(canBindComputeAccount({ id: 2, loginMethod: "email", openId: "local-guest" })).toBe(false);
    expect(canBindComputeAccount({ id: 3, loginMethod: "email", openId: "email:owner@example.com" })).toBe(true);
    expect(renderToStaticMarkup(<BindComputeAccount enabled={false} />)).toBe("");
  });
});
