/**
 * 运行模式闸门。
 *
 * mock 是「显眼的开发状态」，不是隐藏的生产回退：只要缺少经确认的 AppID
 * 或缺少自家 HTTPS 后端，就必须留在 mock，并且任何真实身份交换都要失败关闭。
 */

export type RuntimeMode = "mock" | "live";

export type RuntimeModeInput = {
  appId: string | null | undefined;
  /** 自家 HTTPS 后端（U4 的 code2Session + 应用会话）是否已经就绪。 */
  liveBackendConfigured: boolean;
};

/**
 * U1–U3 恒为 false：仓库里还没有 liveTransport，也没有服务端会话。
 * U4 落地后才由那条线翻转，并且必须同时具备经确认的 AppID。
 */
export const LIVE_BACKEND_CONFIGURED = false;

/** 微信开发者工具的公开占位（游客）AppID。 */
export const PLACEHOLDER_APP_ID = "touristappid";

const REAL_APP_ID_PATTERN = /^wx[0-9a-f]{16}$/;

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
  if (!input.liveBackendConfigured) return "mock";
  if (!isRealAppId(input.appId)) return "mock";
  return "live";
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
  if (mode !== "live") {
    throw new Error(
      "测试壳层处于 mock 模式：不允许调用 wx.login、邮箱验证码或任何远端身份接口。",
    );
  }
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
