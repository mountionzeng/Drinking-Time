import { describe, expect, it } from "vitest";

import {
  loadPrivacyConsent,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
  recordPrivacyDecision,
  resolvePrivacyConsent,
} from "../src/core/privacyConsentState";
import {
  createFailingStorage,
  createMemoryStorage,
} from "../src/services/storage";

const NOW = 1_760_000_000_000;

describe("隐私同意状态", () => {
  it("没看过时是 unseen，且不允许进入身份流程", () => {
    const state = loadPrivacyConsent(createMemoryStorage());
    expect(state.status).toBe("unseen");
    expect(state.allowsIdentityFlow).toBe(false);
  });

  it("同意当前版本后才允许身份流程", () => {
    const storage = createMemoryStorage();
    const state = recordPrivacyDecision(storage, "accepted", { now: NOW });
    expect(state.status).toBe("accepted");
    expect(state.allowsIdentityFlow).toBe(true);
    expect(loadPrivacyConsent(storage).allowsIdentityFlow).toBe(true);
  });

  it("拒绝和撤回都不允许身份流程", () => {
    const storage = createMemoryStorage();
    expect(
      recordPrivacyDecision(storage, "rejected", { now: NOW }).allowsIdentityFlow,
    ).toBe(false);
    recordPrivacyDecision(storage, "accepted", { now: NOW });
    const withdrawn = recordPrivacyDecision(storage, "withdrawn", { now: NOW });
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.allowsIdentityFlow).toBe(false);
    expect(loadPrivacyConsent(storage).allowsIdentityFlow).toBe(false);
  });

  it("告知版本提升后，旧的同意失效并要求重新确认", () => {
    const storage = createMemoryStorage();
    recordPrivacyDecision(storage, "accepted", {
      version: "2026-01-01.1",
      now: NOW,
    });
    const state = loadPrivacyConsent(storage, "2026-09-02.2");
    expect(state.status).toBe("stale-version");
    expect(state.allowsIdentityFlow).toBe(false);
  });

  it("畸形存储不阻断启动，按未读处理", () => {
    const storage = createMemoryStorage({
      "dt:mp:privacy-consent:v1": "{这不是 JSON",
    });
    expect(loadPrivacyConsent(storage).status).toBe("unseen");

    const missingFields = createMemoryStorage({
      "dt:mp:privacy-consent:v1": JSON.stringify({ decision: "accepted" }),
    });
    expect(loadPrivacyConsent(missingFields).allowsIdentityFlow).toBe(false);
  });

  it("存储不可用时不假装用户同意过", () => {
    const storage = createFailingStorage();
    expect(loadPrivacyConsent(storage).status).toBe("unseen");
    const state = recordPrivacyDecision(storage, "accepted", { now: NOW });
    expect(state.allowsIdentityFlow).toBe(false);
  });

  it("resolvePrivacyConsent 对未知 decision 直接判为未读", () => {
    expect(resolvePrivacyConsent(null).status).toBe("unseen");
  });

  it("告知正文覆盖现在做什么、以后做什么、不做什么和如何撤回", () => {
    expect(PRIVACY_NOTICE_SECTIONS.length).toBeGreaterThanOrEqual(4);
    const all = PRIVACY_NOTICE_SECTIONS.map(s => `${s.title}${s.body}`).join("");
    expect(all).toContain("不会产生费用");
    expect(all).toContain("撤回");
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
