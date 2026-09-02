import { describeRuntimeMode } from "./runtimeMode";
import type { WorkspaceSnapshot } from "./workspaceState";

/**
 * 快照 → 可见视图模型。
 *
 * 存在的理由：交接文档第五节要求「关键 UI 状态不能只存在测试或内部枚举里」。
 * 页面只负责 setData 和转发点击，所有对用户可见的文案与可用性都在这里定，
 * 因此可以脱离微信运行时逐条断言。
 */

export type ChatUiState = "idle" | "pending" | "unknown" | "synced" | "error";
export type DocumentUiState =
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "conflict"
  | "error";
export type TransportUiState =
  | "mock-ready"
  | "mock-failure"
  | "live-ready"
  | "live-failure";

export type PresentedWorkspace = {
  mockBadge: string;
  mockDetail: string;
  /** mock 模式下恒为 true：任何时候都不能让用户以为这是真账号。 */
  showsMockBanner: boolean;
  view: WorkspaceSnapshot["view"];
  story: {
    phase: WorkspaceSnapshot["storyPhase"];
    label: string;
    activeTitle: string | null;
    pendingTitle: string | null;
    showsEmptyHint: boolean;
    emptyHint: string;
    showsSwitchDialog: boolean;
  };
  chat: {
    state: ChatUiState;
    label: string;
    canSend: boolean;
    canLookupUnknown: boolean;
    canRetryTurn: boolean;
    blockedReason: string | null;
  };
  document: {
    state: DocumentUiState;
    label: string;
    canSave: boolean;
    canDiscard: boolean;
    canCopyBoth: boolean;
    localBody: string;
    serverBody: string | null;
    error: string | null;
  };
  transport: {
    state: TransportUiState;
    label: string;
    canRetry: boolean;
  };
  balance: {
    text: string;
    demo: boolean;
    blocked: boolean;
    blockedHint: string | null;
  };
};

const YUAN = (cents: number): string => (cents / 100).toFixed(2);

function chatUi(snapshot: WorkspaceSnapshot): PresentedWorkspace["chat"] {
  const pending = snapshot.turns.some(
    turn => turn.status === "replying" || turn.status === "persisting",
  );
  const unknown = snapshot.turns.some(
    turn => turn.status === "generation-unknown",
  );
  const failed = snapshot.turns.some(
    turn =>
      turn.status === "generation-failed" ||
      turn.status === "persistence-failed",
  );

  let state: ChatUiState = "idle";
  let label = "可以发消息";
  if (pending) {
    state = "pending";
    label = "正在回答，请稍候";
  } else if (unknown) {
    state = "unknown";
    label = "上一轮结果未知：请查询结果，不要重复发送";
  } else if (failed) {
    state = "error";
    label = "上一轮失败：可以用同一轮重试";
  } else if (snapshot.turns.length > 0 || snapshot.messages.length > 0) {
    state = "synced";
    label = "已同步";
  }

  let blockedReason: string | null = null;
  if (snapshot.activeStoryId === null) blockedReason = "先选一个 Story";
  else if (pending) blockedReason = "上一轮还在进行";
  else if (unknown) blockedReason = "上一轮结果未知，请先查询结果";
  else if (snapshot.balanceBlocked) blockedReason = "余额不足，无法发起新的调用";

  return {
    state,
    label,
    canSend: blockedReason === null,
    canLookupUnknown: unknown,
    canRetryTurn: failed,
    blockedReason,
  };
}

function documentUi(
  snapshot: WorkspaceSnapshot,
): PresentedWorkspace["document"] {
  const document = snapshot.document;
  const conflict = document.conflict;
  let state: DocumentUiState;
  let label: string;
  switch (document.status) {
    case "loading":
      state = "loading";
      label = "正在读取正文";
      break;
    case "dirty":
      state = "dirty";
      label = "有未保存的修改";
      break;
    case "saving":
      state = "saving";
      label = "正在保存";
      break;
    case "conflict":
      state = "conflict";
      label = "正文有冲突：两份文本都保留了，请你决定";
      break;
    case "failed":
    case "uncertain":
      state = "error";
      label =
        document.status === "uncertain"
          ? "保存结果不确定，文字仍在本机"
          : "保存失败，文字仍在本机";
      break;
    case "saved":
      state = "clean";
      label = "已保存";
      break;
    default:
      state = "clean";
      label = "与服务端一致";
  }
  return {
    state,
    label,
    canSave: document.status === "dirty" || document.status === "failed",
    canDiscard: document.recovery !== null || document.status === "conflict",
    canCopyBoth: document.status === "conflict",
    localBody: conflict?.localBody ?? document.body,
    serverBody: conflict?.latestDocument?.body ?? null,
    error: document.error,
  };
}

export function presentWorkspace(
  snapshot: WorkspaceSnapshot,
): PresentedWorkspace {
  const runtime = describeRuntimeMode(snapshot.runtimeMode);
  const isMock = snapshot.runtimeMode === "mock" || snapshot.transportKind === "mock";
  const activeStory =
    snapshot.stories.find(story => story.id === snapshot.activeStoryId) ?? null;
  const pendingStory =
    snapshot.stories.find(story => story.id === snapshot.pendingStoryId) ?? null;

  const storyLabel: Record<WorkspaceSnapshot["storyPhase"], string> = {
    loading: "正在读取 Story",
    empty: "还没有 Story",
    selected: activeStory ? activeStory.title : "已选择 Story",
    "switching-dirty": "有未保存的正文，先决定怎么处理",
    error: snapshot.storyError ?? "读取 Story 失败",
  };

  const transportFailed = snapshot.transportStatus === "failure";
  const transportState: TransportUiState = isMock
    ? transportFailed
      ? "mock-failure"
      : "mock-ready"
    : transportFailed
      ? "live-failure"
      : "live-ready";

  return {
    mockBadge: runtime.badge,
    mockDetail: runtime.detail,
    showsMockBanner: isMock,
    view: snapshot.view,
    story: {
      phase: snapshot.storyPhase,
      label: storyLabel[snapshot.storyPhase],
      activeTitle: activeStory?.title ?? null,
      pendingTitle: pendingStory?.title ?? null,
      showsEmptyHint: snapshot.storyPhase === "empty",
      emptyHint: "还没有 Story。请先到电脑上创建，这里只做已有 Story 的续写。",
      showsSwitchDialog: snapshot.storyPhase === "switching-dirty",
    },
    chat: chatUi(snapshot),
    document: documentUi(snapshot),
    transport: {
      state: transportState,
      label: transportFailed
        ? `演示 transport 失败：${snapshot.transportError ?? "未知原因"}`
        : isMock
          ? "演示 transport 正常（本机数据，无网络）"
          : "连接正常",
      canRetry: transportFailed,
    },
    balance: {
      text:
        snapshot.balance === null
          ? "余额未知"
          : `${snapshot.balance.demo ? "演示余额" : "可用余额"} ¥${YUAN(
              snapshot.balance.availableCents,
            )}${
              snapshot.balance.lastCostCents === null
                ? ""
                : `　上一次调用 ¥${YUAN(snapshot.balance.lastCostCents)}`
            }`,
      demo: snapshot.balance?.demo ?? true,
      blocked: snapshot.balanceBlocked,
      blockedHint: snapshot.balanceBlocked
        ? "余额不足只会挡住新的付费调用，浏览和正文编辑不受影响。需要续充请联系负责人。"
        : null,
    },
  };
}

export type SendIntentInput = {
  source: "enter" | "button";
  text: string;
  /** 中文输入法组合中。组合期间的回车永远不发送。 */
  composing: boolean;
  canSend: boolean;
};

export type SendIntent =
  | { send: true; text: string }
  | { send: false; reason: "composing" | "empty" | "blocked" };

/**
 * 发送闸门。
 *
 * 组合中的回车一律不发送 —— 这是中文输入法下最容易「打一半就发出去」的地方。
 * 微信 `<textarea bindconfirm>` 本身只在键盘的发送键上触发、不在候选词确认时触发，
 * 这里再加一道显式判断，两层都不依赖对方成立。
 */
export function resolveSendIntent(input: SendIntentInput): SendIntent {
  if (input.source === "enter" && input.composing) {
    return { send: false, reason: "composing" };
  }
  const text = input.text.trim();
  if (!text) return { send: false, reason: "empty" };
  if (!input.canSend) return { send: false, reason: "blocked" };
  return { send: true, text };
}
