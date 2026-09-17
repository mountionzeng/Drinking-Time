/**
 * 运行模式闸门。
 *
 * mock 是「显眼的开发状态」，不是隐藏的生产回退。只有构建明确选择 mock
 * 才能展示演示数据；测试／正式 live 缺配置时进入独立的 configuration-error，
 * 并且任何真实身份交换都要失败关闭。
 */

export type RequestedRuntimeMode = "mock" | "test-live" | "production-live";
export type RuntimeMode = RequestedRuntimeMode | "configuration-error";
export type RuntimeTransportKind = "mock" | "live" | "blocked";

export type RuntimeModeInput = {
  appId: string | null | undefined;
  requestedMode: RequestedRuntimeMode;
  /** 自家 HTTPS 后端（U4 的 code2Session + 应用会话）是否已经就绪。 */
  liveBackendConfigured: boolean;
  /** 只允许 HTTPS origin，不接受路径、query 或 fragment。 */
  apiOrigin: string | null | undefined;
};

/**
 * U1–U3 恒为 false：仓库里还没有 liveTransport，也没有服务端会话。
 * U4 落地后才由那条线翻转，并且必须同时具备经确认的 AppID。
 */
export const LIVE_BACKEND_CONFIGURED = false;
export const LIVE_API_ORIGIN = "";
export const REQUESTED_RUNTIME_MODE: RequestedRuntimeMode = "mock";

/** 微信开发者工具的公开占位（游客）AppID。 */
export const PLACEHOLDER_APP_ID = "touristappid";

const REAL_APP_ID_PATTERN = /^wx[0-9a-f]{16}$/;
const HTTPS_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/i;

export const MOCK_MODE_BADGE = "测试模式 · 未绑定真实账号";

export const MOCK_MODE_DETAIL =
  "这里的 Story、聊天、正文和余额都是本机演示数据，没有连接微信登录、服务器或数据库，也不会产生任何费用。";

export function isRealAppId(appId: string | null | undefined): boolean {
  return typeof appId === "string" && REAL_APP_ID_PATTERN.test(appId.trim());
}

export function isPlaceholderAppId(appId: string | null | undefined): boolean {
  return !isRealAppId(appId);
}

export function resolveRuntimeMode(input: RuntimeModeInput): RuntimeMode {
  if (input.requestedMode === "mock") return "mock";
  const apiOrigin = input.apiOrigin?.trim() ?? "";
  if (
    !input.liveBackendConfigured ||
    !isRealAppId(input.appId) ||
    !HTTPS_ORIGIN_PATTERN.test(apiOrigin)
  ) {
    return "configuration-error";
  }
  return input.requestedMode;
}

export type RuntimeModeDescription = {
  mode: RuntimeMode;
  badge: string;
  detail: string;
  /** 是否允许调用 wx.login / 邮箱验证码 / 任何远端身份接口。 */
  canStartRealIdentity: boolean;
};

export function describeRuntimeMode(mode: RuntimeMode): RuntimeModeDescription {
  if (mode === "mock") {
    return {
      mode,
      badge: MOCK_MODE_BADGE,
      detail: MOCK_MODE_DETAIL,
      canStartRealIdentity: false,
    };
  }
  if (mode === "configuration-error") {
    return {
      mode,
      badge: "配置错误 · 未连接账号",
      detail:
        "当前构建要求连接真实账号，但 AppID、HTTPS 服务地址或后端能力尚未完整配置。不会回退或展示演示数据。",
      canStartRealIdentity: false,
    };
  }
  if (mode === "test-live") {
    return {
      mode,
      badge: "测试账号 · 已连接测试环境",
      detail: "正在使用测试 AppID 和测试后端；这里的身份不会迁移为企业正式号身份。",
      canStartRealIdentity: true,
    };
  }
  return {
    mode,
    badge: "已连接账号",
    detail: "正在使用服务端会话读取你自己的 Story、正文和余额。",
    canStartRealIdentity: true,
  };
}

/**
 * 真实身份流程的失败关闭闸门。mock 模式下调用即抛错——
 * 这样「不小心接上真实登录」会是一个响亮的错误，而不是一次静默的成功。
 */
export function assertRealIdentityAllowed(mode: RuntimeMode): void {
  if (mode === "configuration-error") {
    throw new Error(
      "小程序 live 配置错误：不允许调用 wx.login、邮箱验证码或任何远端身份接口。",
    );
  }
  if (mode === "mock") {
    throw new Error(
      "测试壳层处于 mock 模式：不允许调用 wx.login、邮箱验证码或任何远端身份接口。",
    );
  }
}

export function assertRuntimeTransportCompatibility(
  mode: RuntimeMode,
  transportKind: RuntimeTransportKind,
): void {
  if (mode === "configuration-error") {
    if (transportKind !== "blocked") {
      throw new Error("小程序 live 配置错误：禁止回退到 mock transport。");
    }
    return;
  }
  if (mode === "mock" && transportKind !== "mock") {
    throw new Error("mock 构建禁止使用 live transport。");
  }
  if (mode !== "mock" && transportKind !== "live") {
    throw new Error("live 构建禁止使用 mock transport。");
  }
}

/** 配置错误必须停在可解释页面，隐私同意不能越过运行时闸门。 */
export function canEnterWorkspaceInRuntime(
  mode: RuntimeMode,
  privacyAllowed: boolean,
): boolean {
  return privacyAllowed && mode !== "configuration-error";
}

/** 从注入的账号读取器解析 AppID；读取失败一律按占位处理。 */
export function readMiniProgramAppId(
  readAccountInfo: () => { miniProgram: { appId: string } },
): string {
  try {
    return readAccountInfo().miniProgram.appId ?? "";
  } catch {
    return "";
  }
}
