import { workspaceApp } from "../../app";
import {
  loadPrivacyConsent,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
  recordPrivacyDecision,
  type PrivacyConsentStatus,
  type PrivacyDecision,
} from "../../core/privacyConsentState";

Page({
  data: {
    sections: PRIVACY_NOTICE_SECTIONS,
    version: PRIVACY_NOTICE_VERSION,
    status: "unseen" as PrivacyConsentStatus,
    accepted: false,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const consent = loadPrivacyConsent(workspaceApp().globalData.storage);
    this.setData({
      status: consent.status,
      version: consent.currentVersion,
      accepted: consent.allowsIdentityFlow,
    });
  },

  decide(decision: PrivacyDecision) {
    recordPrivacyDecision(workspaceApp().globalData.storage, decision);
    this.refresh();
    wx.showToast({
      title:
        decision === "accepted"
          ? "已记录同意"
          : decision === "rejected"
            ? "已记录拒绝"
            : "已撤回同意",
      icon: "none",
    });
  },

  onAccept() {
    this.decide("accepted");
  },

  onReject() {
    this.decide("rejected");
  },

  onWithdraw() {
    this.decide("withdrawn");
  },
});

export {};
