import { workspaceApp } from "../../app";
import {
  loadPrivacyConsent,
  PRIVACY_NOTICE_VERSION,
  type PrivacyConsentStatus,
} from "../../core/privacyConsentState";

const STATUS_LABEL: Record<PrivacyConsentStatus, string> = {
  unseen: "还没有看过隐私说明",
  accepted: "已同意当前版本的隐私说明",
  rejected: "已拒绝隐私说明",
  withdrawn: "已撤回同意",
  "stale-version": "隐私说明有更新，需要重新确认",
};

Page({
  data: {
    badge: "",
    detail: "",
    consentStatus: "unseen" as PrivacyConsentStatus,
    consentLabel: STATUS_LABEL.unseen,
    consentVersion: PRIVACY_NOTICE_VERSION,
    canEnterWorkspace: false,
  },

  onShow() {
    const app = workspaceApp();
    const consent = loadPrivacyConsent(app.globalData.storage);
    this.setData({
      badge: app.globalData.runtimeDescription.badge,
      detail: app.globalData.runtimeDescription.detail,
      consentStatus: consent.status,
      consentLabel: STATUS_LABEL[consent.status],
      consentVersion: consent.currentVersion,
      canEnterWorkspace: consent.allowsIdentityFlow,
    });
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/privacy/index" });
  },

  enterWorkspace() {
    if (!this.data.canEnterWorkspace) {
      wx.showToast({ title: "请先看完并同意隐私说明", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/workspace/index" });
  },
});

export {};
