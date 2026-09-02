import { describe, expect, it, vi } from "vitest";

import {
  assertRealIdentityAllowed,
  describeRuntimeMode,
  isPlaceholderAppId,
  isRealAppId,
  LIVE_BACKEND_CONFIGURED,
  PLACEHOLDER_APP_ID,
  readMiniProgramAppId,
  resolveRuntimeMode,
} from "../src/core/runtimeMode";

const FIXTURE_APP_ID = "wx1234567890abcdef"; // fixture：构造的假 AppID，不属于任何真实小程序
const FIXTURE_APP_ID_2 = "wxabcdef0123456789"; // fixture：第二个构造的假 AppID

describe("运行模式闸门", () => {
  it("U1–U3 的后端开关必须是关闭的", () => {
    expect(LIVE_BACKEND_CONFIGURED).toBe(false);
  });

  it("占位 AppID 一律进入 mock 模式", () => {
    expect(isPlaceholderAppId(PLACEHOLDER_APP_ID)).toBe(true);
    expect(isPlaceholderAppId("")).toBe(true);
    expect(isPlaceholderAppId(null)).toBe(true);
    expect(
      resolveRuntimeMode({
        appId: PLACEHOLDER_APP_ID,
        liveBackendConfigured: true,
      }),
    ).toBe("mock");
  });

  it("即使拿到真实 AppID，后端未就绪也留在 mock", () => {
    expect(isRealAppId(FIXTURE_APP_ID)).toBe(true);
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        liveBackendConfigured: false,
      }),
    ).toBe("mock");
  });

  it("只有真实 AppID 且后端就绪才是 live", () => {
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        liveBackendConfigured: true,
      }),
    ).toBe("live");
  });

  it("mock 模式必须给出可见标识，并禁止真实身份流程", () => {
    const description = describeRuntimeMode("mock");
    expect(description.badge).toContain("测试模式");
    expect(description.badge).toContain("未绑定真实账号");
    expect(description.canStartRealIdentity).toBe(false);
    expect(() => assertRealIdentityAllowed("mock")).toThrow(/mock 模式/);
  });

  it("读取 AppID 失败按占位处理，不让启动崩溃", () => {
    const thrower = vi.fn(() => {
      throw new Error("getAccountInfoSync unavailable");
    });
    expect(readMiniProgramAppId(thrower)).toBe("");
    expect(
      readMiniProgramAppId(() => ({ miniProgram: { appId: FIXTURE_APP_ID_2 } })),
    ).toBe(FIXTURE_APP_ID_2);
  });
});
