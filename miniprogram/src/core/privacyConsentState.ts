import type { MiniProgramStorage } from "../services/storage";

/**
 * 最小隐私告知与版本化同意状态。
 *
 * 这一层的目的不是「弹个窗」，而是把「同意先于任何真实身份动作」做成
 * **可测试的边界**：U1–U3 无论用户是否同意都不会真的调用 `wx.login`，
 * 但 `allowsIdentityFlow` 从现在起就是那道门，U4 接真实登录时直接复用。
 */

/** 告知版本。内容有实质变化就必须提升，老的同意随即失效。 */
export const PRIVACY_NOTICE_VERSION = "2026-09-02.1";

const CONSENT_KEY = "dt:mp:privacy-consent:v1";

export type PrivacyDecision = "accepted" | "rejected" | "withdrawn";

export type PrivacyConsentStatus =
  | "unseen"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "stale-version";

export type PrivacyConsentRecord = {
  version: string;
  decision: PrivacyDecision;
  decidedAt: number;
};

export type PrivacyConsentState = {
  currentVersion: string;
  status: PrivacyConsentStatus;
  record: PrivacyConsentRecord | null;
  /**
   * 是否允许进入真实身份流程（wx.login、邮箱验证码、Story 网络请求）。
   * 只有「对当前版本明确同意」才为 true。
   */
  allowsIdentityFlow: boolean;
};

function normalizeRecord(value: unknown): PrivacyConsentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<PrivacyConsentRecord>;
  if (
    typeof record.version !== "string" ||
    !record.version.trim() ||
    (record.decision !== "accepted" &&
      record.decision !== "rejected" &&
      record.decision !== "withdrawn") ||
    typeof record.decidedAt !== "number" ||
    !Number.isFinite(record.decidedAt)
  ) {
    return null;
  }
  return {
    version: record.version,
    decision: record.decision,
    decidedAt: record.decidedAt,
  };
}

export function resolvePrivacyConsent(
  record: PrivacyConsentRecord | null,
  currentVersion: string = PRIVACY_NOTICE_VERSION,
): PrivacyConsentState {
  if (!record) {
    return {
      currentVersion,
      status: "unseen",
      record: null,
      allowsIdentityFlow: false,
    };
  }
  if (record.version !== currentVersion) {
    // 告知升级后，旧的同意不再有效，必须重新确认。
    return {
      currentVersion,
      status: record.decision === "accepted" ? "stale-version" : record.decision,
      record,
      allowsIdentityFlow: false,
    };
  }
  return {
    currentVersion,
    status: record.decision,
    record,
    allowsIdentityFlow: record.decision === "accepted",
  };
}

export function loadPrivacyConsent(
  storage: MiniProgramStorage,
  currentVersion: string = PRIVACY_NOTICE_VERSION,
): PrivacyConsentState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CONSENT_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return resolvePrivacyConsent(null, currentVersion);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      storage.removeItem(CONSENT_KEY);
    } catch {
      // 清不掉时下次仍会当作未读，不影响判定。
    }
    return resolvePrivacyConsent(null, currentVersion);
  }
  return resolvePrivacyConsent(normalizeRecord(parsed), currentVersion);
}

export function recordPrivacyDecision(
  storage: MiniProgramStorage,
  decision: PrivacyDecision,
  options: { version?: string; now?: number } = {},
): PrivacyConsentState {
  const version = options.version ?? PRIVACY_NOTICE_VERSION;
  const record: PrivacyConsentRecord = {
    version,
    decision,
    decidedAt: options.now ?? Date.now(),
  };
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // 存不住同意状态时按未读处理：宁可再问一次，也不假装用户同意过。
    return resolvePrivacyConsent(null, version);
  }
  return resolvePrivacyConsent(record, version);
}

export const PRIVACY_NOTICE_SECTIONS: ReadonlyArray<{
  title: string;
  body: string;
}> = [
  {
    title: "现在这个版本会做什么",
    body: "只在你的手机本机演示界面。所有 Story、聊天、正文和余额都是写死的演示数据，不会上传、不会保存到服务器，也不会产生费用。",
  },
  {
    title: "以后接真实账号时会做什么",
    body: "会用微信登录换取一次性凭据，交给拾光自己的服务器；你还要用已验证的邮箱确认一次，才会把微信和你现有的账号绑在一起。绑定前会先告诉你用的是哪个账号、哪些内容和多少余额。",
  },
  {
    title: "不会做什么",
    body: "不会因为微信登录就新建一个平行账号或平行余额；不会把你的微信身份密钥放进小程序；不会在你没同意前发起任何身份请求。",
  },
  {
    title: "你可以随时撤回",
    body: "撤回后不再进入身份流程。告知内容有实质更新时，会请你重新确认一次。",
  },
];
