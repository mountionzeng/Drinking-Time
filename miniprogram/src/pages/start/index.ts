import { workspaceApp } from "../../app";
import { canEnterWorkspaceInRuntime } from "../../core/runtimeMode";
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

let pourResetTimer: ReturnType<typeof setTimeout> | null = null;

function clearPourTimer() {
  if (pourResetTimer) clearTimeout(pourResetTimer);
  pourResetTimer = null;
}

Page({
  data: {
    badge: "",
    detail: "",
    consentStatus: "unseen" as PrivacyConsentStatus,
    consentLabel: STATUS_LABEL.unseen,
    consentVersion: PRIVACY_NOTICE_VERSION,
    canEnterWorkspace: false,
    runtimeBlocked: false,
    isPouring: false,
    showEmailDemo: false,
    demoEmail: "",
    demoInviteCode: "",
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
      canEnterWorkspace: canEnterWorkspaceInRuntime(
        app.globalData.runtimeMode,
        consent.allowsIdentityFlow,
      ),
      runtimeBlocked: app.globalData.runtimeMode === "configuration-error",
    });
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/privacy/index" });
  },

  onWeChatLogin() {
    wx.showToast({
      title: "微信登录会在连接真实服务后启用",
      icon: "none",
    });
  },

  onEmailLogin() {
    this.setData({ showEmailDemo: true });
  },

  onCupTap() {
    if (this.data.isPouring) return;
    this.setData({ isPouring: true });
    // 只切换杯子的小图层；品牌、圆环和「倒一杯看看」始终是静态层。
    // 这避免微信运行时在 70ms 内反复解码整张 1040×780 图片。
    pourResetTimer = setTimeout(() => {
      this.setData({ isPouring: false });
      pourResetTimer = null;
    }, 820);
  },

  onUnload() {
    clearPourTimer();
  },

  onDemoEmailInput(event: { detail: { value: string } }) {
    this.setData({ demoEmail: event.detail.value });
  },

  onDemoInviteCodeInput(event: { detail: { value: string } }) {
    this.setData({ demoInviteCode: event.detail.value });
  },

  onCancelEmailDemo() {
    this.setData({ showEmailDemo: false, demoEmail: "", demoInviteCode: "" });
  },

  onSubmitEmailDemo() {
    const email = this.data.demoEmail.trim();
    const inviteCode = this.data.demoInviteCode.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !inviteCode) {
      wx.showToast({ title: "请填写邮箱和邀请码", icon: "none" });
      return;
    }
    if (this.data.runtimeBlocked) {
      wx.showToast({ title: "请先修复小程序运行配置", icon: "none" });
      return;
    }
    if (!this.data.canEnterWorkspace) {
      wx.showToast({ title: "请先阅读并同意隐私说明", icon: "none" });
      this.openPrivacy();
      return;
    }

    // U1–U3 不接服务端：绝不提交、验证或持久化这两个输入。
    // 清空后才跳转，工作区只会显示独立的 mock 数据。
    this.setData({ showEmailDemo: false, demoEmail: "", demoInviteCode: "" });
    wx.navigateTo({ url: "/pages/workspace/index" });
  },

  enterWorkspace() {
    if (this.data.runtimeBlocked) {
      wx.showToast({ title: "请先修复小程序运行配置", icon: "none" });
      return;
    }
    if (!this.data.canEnterWorkspace) {
      wx.showToast({ title: "请先看完并同意隐私说明", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/workspace/index" });
  },
});

export {};
