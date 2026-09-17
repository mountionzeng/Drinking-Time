import { describe, expect, it, vi } from "vitest";

import {
  assertRealIdentityAllowed,
  assertRuntimeTransportCompatibility,
  canEnterWorkspaceInRuntime,
  describeRuntimeMode,
  isPlaceholderAppId,
  isRealAppId,
  LIVE_BACKEND_CONFIGURED,
  LIVE_API_ORIGIN,
  PLACEHOLDER_APP_ID,
  REQUESTED_RUNTIME_MODE,
  readMiniProgramAppId,
  resolveRuntimeMode,
} from "../src/core/runtimeMode";
import { selectWorkspaceTransport } from "../src/services/runtimeTransport";

const FIXTURE_APP_ID = "wx1234567890abcdef"; // fixture：构造的假 AppID，不属于任何真实小程序
const FIXTURE_APP_ID_2 = "wxabcdef0123456789"; // fixture：第二个构造的假 AppID

describe("运行模式闸门", () => {
  it("默认构建必须显式选择 mock，且 live 配置保持关闭", () => {
    expect(REQUESTED_RUNTIME_MODE).toBe("mock");
    expect(LIVE_BACKEND_CONFIGURED).toBe(false);
    expect(LIVE_API_ORIGIN).toBe("");
  });

  it("占位 AppID 一律进入 mock 模式", () => {
    expect(isPlaceholderAppId(PLACEHOLDER_APP_ID)).toBe(true);
    expect(isPlaceholderAppId("")).toBe(true);
    expect(isPlaceholderAppId(null)).toBe(true);
    expect(
      resolveRuntimeMode({
        appId: PLACEHOLDER_APP_ID,
        requestedMode: "test-live",
        liveBackendConfigured: true,
        apiOrigin: "https://api.example.test",
      }),
    ).toBe("configuration-error");
  });

  it("显式 live 缺任一配置时进入配置错误，不回退 mock", () => {
    expect(isRealAppId(FIXTURE_APP_ID)).toBe(true);
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        requestedMode: "test-live",
        liveBackendConfigured: false,
        apiOrigin: "https://api.example.test",
      }),
    ).toBe("configuration-error");
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        requestedMode: "test-live",
        liveBackendConfigured: true,
        apiOrigin: "",
      }),
    ).toBe("configuration-error");
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        requestedMode: "production-live",
        liveBackendConfigured: true,
        apiOrigin: "http://api.example.test",
      }),
    ).toBe("configuration-error");
  });

  it("mock、测试 live、正式 live 都是显式且互不冒充的模式", () => {
    expect(
      resolveRuntimeMode({
        appId: PLACEHOLDER_APP_ID,
        requestedMode: "mock",
        liveBackendConfigured: false,
        apiOrigin: "",
      }),
    ).toBe("mock");
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        requestedMode: "test-live",
        liveBackendConfigured: true,
        apiOrigin: "https://api.example.test",
      }),
    ).toBe("test-live");
    expect(
      resolveRuntimeMode({
        appId: FIXTURE_APP_ID,
        requestedMode: "production-live",
        liveBackendConfigured: true,
        apiOrigin: "https://api.example.test",
      }),
    ).toBe("production-live");
  });

  it("mock 模式必须给出可见标识，并禁止真实身份流程", () => {
    const description = describeRuntimeMode("mock");
    expect(description.badge).toContain("测试模式");
    expect(description.badge).toContain("未绑定真实账号");
    expect(description.canStartRealIdentity).toBe(false);
    expect(() => assertRealIdentityAllowed("mock")).toThrow(/mock 模式/);
  });

  it("配置错误给出独立提示并禁止真实身份流程", () => {
    const description = describeRuntimeMode("configuration-error");
    expect(description.badge).toContain("配置错误");
    expect(description.detail).toContain("不会回退");
    expect(description.canStartRealIdentity).toBe(false);
    expect(() => assertRealIdentityAllowed("configuration-error")).toThrow(
      /配置错误/,
    );
  });

  it("测试 live 与正式 live 有不同可见标识，且都允许身份流程", () => {
    const testing = describeRuntimeMode("test-live");
    const production = describeRuntimeMode("production-live");
    expect(testing.badge).toContain("测试账号");
    expect(production.badge).not.toContain("测试账号");
    expect(testing.canStartRealIdentity).toBe(true);
    expect(production.canStartRealIdentity).toBe(true);
    expect(() => assertRealIdentityAllowed("test-live")).not.toThrow();
    expect(() => assertRealIdentityAllowed("production-live")).not.toThrow();
  });

  it("live 或配置错误绝不允许挂着 mock transport 继续运行", () => {
    expect(() => assertRuntimeTransportCompatibility("mock", "mock")).not.toThrow();
    expect(() =>
      assertRuntimeTransportCompatibility("test-live", "mock"),
    ).toThrow(/mock transport/);
    expect(() =>
      assertRuntimeTransportCompatibility("configuration-error", "mock"),
    ).toThrow(/配置错误/);
  });

  it("配置错误使用无数据的 blocked transport，启动页也不能进入工作区", async () => {
    const transport = selectWorkspaceTransport("configuration-error");

    expect(transport.kind).toBe("blocked");
    expect(() =>
      assertRuntimeTransportCompatibility("configuration-error", transport.kind),
    ).not.toThrow();
    expect((await transport.listStories()).ok).toBe(false);
    expect(canEnterWorkspaceInRuntime("configuration-error", true)).toBe(false);
    expect(canEnterWorkspaceInRuntime("mock", true)).toBe(true);
    expect(() => selectWorkspaceTransport("test-live")).toThrow(
      /live transport 尚未实现/,
    );
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
