import { workspaceApp } from "../../app";
import {
  presentWorkspace,
  resolveSendIntent,
  type PresentedWorkspace,
} from "../../core/workspacePresentation";
import type { WorkspaceView } from "../../core/types";
import type { MockFailureMode } from "../../services/mockTransport";

type WorkspaceMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  turnStatus?: string;
};

const FAILURE_MODES: ReadonlyArray<{ value: MockFailureMode; label: string }> = [
  { value: "none", label: "正常" },
  { value: "list-stories", label: "读取 Story 列表失败" },
  { value: "open-story", label: "打开 Story 失败" },
  { value: "submit-turn-unknown", label: "聊天结果未知" },
  { value: "submit-turn-failed", label: "聊天明确失败" },
  { value: "save-conflict", label: "正文冲突" },
  { value: "insufficient-balance", label: "余额不足" },
];

Page({
  data: {
    ready: false,
    ui: null as PresentedWorkspace | null,
    messages: [] as WorkspaceMessage[],
    storyTitles: [] as string[],
    storyIndex: 0,
    draft: "",
    body: "",
    composing: false,
    failureModes: FAILURE_MODES,
    failureIndex: 0,
    scrollTarget: "",
  },

  unsubscribe: null as null | (() => void),

  onLoad() {
    const store = workspaceApp().globalData.store;
    this.unsubscribe = store.subscribe(() => this.render());
    void store.start().then(() => this.render());
  },

  onShow() {
    void workspaceApp().globalData.store.onShow();
  },

  onHide() {
    // 只把草稿写进本机存储，不承诺任何网络保存。
    workspaceApp().globalData.store.onHide();
  },

  onUnload() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  },

  render() {
    const snapshot = workspaceApp().globalData.store.getState();
    const ui = presentWorkspace(snapshot);
    const storyIndex = Math.max(
      0,
      snapshot.stories.findIndex(story => story.id === snapshot.activeStoryId),
    );
    const messages: WorkspaceMessage[] = snapshot.messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      turnStatus: message.turnStatus,
    }));
    const last = messages[messages.length - 1];
    const patch: Record<string, unknown> = {
      ready: true,
      ui,
      messages,
      storyTitles: snapshot.stories.map(story => story.title),
      storyIndex,
      scrollTarget: last ? `msg-${last.id}` : "",
    };
    // 正文输入框只在非编辑态跟随权威，避免打字时被 setData 打断。
    if (snapshot.document.status !== "dirty" && snapshot.document.status !== "saving") {
      patch.body = snapshot.document.body;
    }
    this.setData(patch);
  },

  switchView(event: { currentTarget: { dataset: { view: WorkspaceView } } }) {
    workspaceApp().globalData.store.setView(event.currentTarget.dataset.view);
  },

  onStoryChange(event: { detail: { value: string | number } }) {
    const snapshot = workspaceApp().globalData.store.getState();
    const story = snapshot.stories[Number(event.detail.value)];
    if (story) void workspaceApp().globalData.store.selectStory(story.id);
  },

  onDraftInput(event: { detail: { value: string } }) {
    this.setData({ draft: event.detail.value });
  },

  onCompositionStart() {
    this.setData({ composing: true });
  },

  onCompositionEnd() {
    this.setData({ composing: false });
  },

  onDraftConfirm() {
    this.trySend("enter");
  },

  onSendTap() {
    this.trySend("button");
  },

  trySend(source: "enter" | "button") {
    const ui = this.data.ui;
    const intent = resolveSendIntent({
      source,
      text: this.data.draft,
      composing: this.data.composing,
      canSend: ui?.chat.canSend ?? false,
    });
    if (!intent.send) {
      if (intent.reason === "blocked" && ui?.chat.blockedReason) {
        wx.showToast({ title: ui.chat.blockedReason, icon: "none" });
      }
      return;
    }
    this.setData({ draft: "" });
    void workspaceApp().globalData.store.sendMessage(intent.text);
  },

  onLookupUnknown() {
    void workspaceApp().globalData.store.lookupUnknownTurn();
  },

  onRetryTurn() {
    void workspaceApp().globalData.store.retryTurn();
  },

  onRetryTransport() {
    void workspaceApp().globalData.store.retryTransport();
  },

  onBodyInput(event: { detail: { value: string } }) {
    this.setData({ body: event.detail.value });
    workspaceApp().globalData.store.editDocument(event.detail.value);
  },

  onSaveBody() {
    void workspaceApp().globalData.store.saveDocument();
  },

  onCopyBoth() {
    const ui = this.data.ui;
    if (!ui) return;
    const merged = [
      "【本机这份】",
      ui.document.localBody,
      "",
      "【服务端那份】",
      ui.document.serverBody ?? "（服务端没有这份正文）",
    ].join("\n");
    wx.setClipboardData({ data: merged });
  },

  onDiscardDraft() {
    wx.showModal({
      title: "放弃本机这份正文？",
      content: "放弃后本机的修改会消失，只保留服务端那份。这一步不能撤销。",
      confirmText: "放弃",
      cancelText: "先不放弃",
      success: result => {
        if (result.confirm) workspaceApp().globalData.store.discardDraft();
      },
    });
  },

  onKeepCurrentStory() {
    void workspaceApp().globalData.store.resolveStorySwitch("cancel");
  },

  onDiscardAndSwitch() {
    void workspaceApp().globalData.store.resolveStorySwitch("discard");
  },

  onFailureModeChange(event: { detail: { value: string | number } }) {
    const index = Number(event.detail.value);
    const mode = FAILURE_MODES[index];
    if (!mode) return;
    this.setData({ failureIndex: index });
    workspaceApp().globalData.transport.setFailureMode(mode.value);
    wx.showToast({ title: `演示状态：${mode.label}`, icon: "none" });
  },
});

export {};
