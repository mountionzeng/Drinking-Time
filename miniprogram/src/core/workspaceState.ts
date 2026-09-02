import type { MiniProgramStorage } from "../services/storage";
import type { WorkspaceTransport } from "../services/transport";
import {
  applyConversationTurnEvent,
  createConversationTurn,
  findUnknownTurn,
  hasPendingTurn,
  mergeConversationProjection,
  normalizeConversationTurn,
  type ConversationRecoveryTurn,
  type ConversationViewMessage,
} from "./conversationState";
import {
  applyDocumentAuthority,
  applyDocumentSaveConflict,
  applyDocumentSaveFailure,
  applyDocumentSaveSuccess,
  beginDocumentSave,
  createLoadingDocumentState,
  discardLocalDraft,
  editDocumentBody,
  hydrateDocumentState,
  normalizeDocumentRecoveryRecord,
  type DocumentRecoveryRecord,
  type DocumentState,
} from "./documentState";
import {
  clearRecoveryForScope,
  pruneRecoveryStorage,
  readRecoveryRecords,
  reconcileRecoveryOwner,
  recoveryKey,
  writeRecoveryRecords,
} from "./recoveryState";
import type { RuntimeMode } from "./runtimeMode";
import type {
  BalanceSummary,
  ConversationServerMessage,
  RecoveryScope,
  StorySummary,
  WorkspaceView,
} from "./types";

/**
 * 工作区编排状态机。
 *
 * 页面（Page）只做两件事：把快照 setData 上去、把点击转成这里的动作。
 * 所有「哪一轮属于哪个 Story」「同一时刻只有一个 pending」「未知结果只查不跑」
 * 「onHide 不承诺网络保存」「onShow 不覆盖 dirty」的判断都在这里，
 * 因此可以脱离微信运行时测试。
 */

export type StoryPhase =
  | "loading"
  | "empty"
  | "selected"
  | "switching-dirty"
  | "error";

export type TransportStatus = "ready" | "failure";

export type WorkspaceSnapshot = {
  runtimeMode: RuntimeMode;
  transportKind: "mock" | "live";
  view: WorkspaceView;
  storyPhase: StoryPhase;
  stories: StorySummary[];
  activeStoryId: number | null;
  /** 脏草稿拦下的目标 Story，等用户裁决。 */
  pendingStoryId: number | null;
  storyError: string | null;
  messages: ConversationViewMessage[];
  turns: ConversationRecoveryTurn[];
  chatError: string | null;
  document: DocumentState;
  balance: BalanceSummary | null;
  /** 余额不足：只挡新的付费调用，不挡浏览和正文编辑。 */
  balanceBlocked: boolean;
  transportStatus: TransportStatus;
  transportError: string | null;
};

export type WorkspaceStoreOptions = {
  scope: RecoveryScope;
  runtimeMode: RuntimeMode;
  transport: WorkspaceTransport;
  storage: MiniProgramStorage;
  now?: () => number;
  idFactory?: () => string;
};

export type StorySwitchDecision = "cancel" | "discard";

export type WorkspaceStore = {
  getState(): WorkspaceSnapshot;
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  start(): Promise<void>;
  setView(view: WorkspaceView): void;
  selectStory(storyId: number): Promise<void>;
  resolveStorySwitch(decision: StorySwitchDecision): Promise<void>;
  sendMessage(text: string): Promise<void>;
  lookupUnknownTurn(): Promise<void>;
  retryTurn(): Promise<void>;
  retryTransport(): Promise<void>;
  editDocument(body: string): void;
  saveDocument(): Promise<void>;
  discardDraft(): void;
  onShow(): Promise<void>;
  onHide(): void;
  signOut(): void;
};

export function createWorkspaceStore(
  options: WorkspaceStoreOptions,
): WorkspaceStore {
  const { scope, transport, storage } = options;
  const now = options.now ?? (() => Date.now());
  const idFactory = options.idFactory;

  let serverMessages: ConversationServerMessage[] = [];
  let state: WorkspaceSnapshot = {
    runtimeMode: options.runtimeMode,
    transportKind: transport.kind,
    view: "chat",
    storyPhase: "loading",
    stories: [],
    activeStoryId: null,
    pendingStoryId: null,
    storyError: null,
    messages: [],
    turns: [],
    chatError: null,
    document: createLoadingDocumentState(scope, 0),
    balance: null,
    balanceBlocked: false,
    transportStatus: "ready",
    transportError: null,
  };

  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();

  function patch(next: Partial<WorkspaceSnapshot>): void {
    state = { ...state, ...next };
    listeners.forEach(listener => listener(state));
  }

  // --- 恢复存储 ------------------------------------------------------------

  function conversationKey(storyId: number): string {
    return recoveryKey("conversation", scope, storyId);
  }

  function documentKey(storyId: number): string {
    return recoveryKey("document", scope, storyId);
  }

  function loadTurns(storyId: number): ConversationRecoveryTurn[] {
    return readRecoveryRecords<ConversationRecoveryTurn>(
      storage,
      conversationKey(storyId),
      value => normalizeConversationTurn(value, scope, storyId),
      now(),
    );
  }

  function persistTurns(
    storyId: number,
    turns: readonly ConversationRecoveryTurn[],
  ): void {
    writeRecoveryRecords<ConversationRecoveryTurn>(
      storage,
      conversationKey(storyId),
      turns,
      value => normalizeConversationTurn(value, scope, storyId),
      now(),
    );
  }

  function loadDocumentRecovery(storyId: number): DocumentRecoveryRecord[] {
    return readRecoveryRecords<DocumentRecoveryRecord>(
      storage,
      documentKey(storyId),
      value => normalizeDocumentRecoveryRecord(value, scope, storyId),
      now(),
    );
  }

  function persistDocumentRecovery(document: DocumentState): void {
    const storyId = document.storyId;
    if (!storyId) return;
    writeRecoveryRecords<DocumentRecoveryRecord>(
      storage,
      documentKey(storyId),
      document.recovery ? [document.recovery] : [],
      value => normalizeDocumentRecoveryRecord(value, scope, storyId),
      now(),
    );
  }

  // --- 投影 ----------------------------------------------------------------

  function project(turns: readonly ConversationRecoveryTurn[]): {
    messages: ConversationViewMessage[];
    turns: ConversationRecoveryTurn[];
  } {
    const merged = mergeConversationProjection({
      serverMessages,
      recoveryTurns: turns,
    });
    return { messages: merged.messages, turns: merged.remainingRecoveryTurns };
  }

  function commitTurns(
    storyId: number,
    turns: readonly ConversationRecoveryTurn[],
    extra: Partial<WorkspaceSnapshot> = {},
  ): void {
    persistTurns(storyId, turns);
    const projected = project(turns);
    patch({ ...extra, turns: projected.turns, messages: projected.messages });
  }

  function commitDocument(
    document: DocumentState,
    extra: Partial<WorkspaceSnapshot> = {},
  ): void {
    persistDocumentRecovery(document);
    patch({ ...extra, document });
  }

  /** 迟到结果的唯一闸门：Story 已经切走就不许再写进当前视图。 */
  function isStillActive(storyId: number): boolean {
    return state.activeStoryId === storyId;
  }

  function hasUnsavedDocument(): boolean {
    return (
      state.document.recovery !== null &&
      state.document.status !== "clean" &&
      state.document.status !== "saved"
    );
  }

  // --- Story --------------------------------------------------------------

  async function openStory(storyId: number): Promise<void> {
    serverMessages = [];
    const restoredTurns = loadTurns(storyId);
    const projected = project(restoredTurns);
    patch({
      activeStoryId: storyId,
      pendingStoryId: null,
      storyPhase: "selected",
      storyError: null,
      chatError: null,
      turns: projected.turns,
      messages: projected.messages,
      document: createLoadingDocumentState(scope, storyId),
    });

    const result = await transport.openStory(storyId);
    if (!isStillActive(storyId)) return;
    if (!result.ok) {
      patch({
        transportStatus: "failure",
        transportError: result.error.message,
        storyError: result.error.message,
      });
      return;
    }
    serverMessages = result.data.messages;
    const document = hydrateDocumentState({
      scope,
      storyId,
      document: result.data.document,
      recoveryRecords: loadDocumentRecovery(storyId),
    });
    const projectedAfter = project(state.turns);
    patch({
      transportStatus: "ready",
      transportError: null,
      balance: result.data.balance,
      balanceBlocked: result.data.balance.availableCents <= 0,
      document,
      turns: projectedAfter.turns,
      messages: projectedAfter.messages,
    });
  }

  async function loadStories(): Promise<void> {
    patch({ storyPhase: "loading", storyError: null });
    const result = await transport.listStories();
    if (!result.ok) {
      patch({
        storyPhase: "error",
        storyError: result.error.message,
        transportStatus: "failure",
        transportError: result.error.message,
      });
      return;
    }
    const stories = result.data
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt);
    patch({
      stories,
      transportStatus: "ready",
      transportError: null,
    });
    if (stories.length === 0) {
      patch({ storyPhase: "empty", activeStoryId: null });
      return;
    }
    const first = stories[0];
    if (first) await openStory(first.id);
  }

  // --- 对外动作 ------------------------------------------------------------

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      // 先清理，再渲染：上一个作用域的任何草稿都不能出现在新身份下。
      reconcileRecoveryOwner(storage, scope);
      pruneRecoveryStorage(storage, scope, now());
      await loadStories();
    },

    setView(view) {
      patch({ view });
    },

    async selectStory(storyId) {
      if (storyId === state.activeStoryId) return;
      if (hasUnsavedDocument()) {
        patch({ pendingStoryId: storyId, storyPhase: "switching-dirty" });
        return;
      }
      await openStory(storyId);
    },

    async resolveStorySwitch(decision) {
      const target = state.pendingStoryId;
      if (target === null) return;
      if (decision === "cancel") {
        patch({
          pendingStoryId: null,
          storyPhase: state.activeStoryId === null ? "empty" : "selected",
        });
        return;
      }
      const cleared = discardLocalDraft(state.document);
      commitDocument(cleared, { pendingStoryId: null });
      await openStory(target);
    },

    async sendMessage(text) {
      const storyId = state.activeStoryId;
      if (storyId === null) return;
      const content = text.trim();
      if (!content) return;
      // 快速重复点击：已经有一轮在跑就直接返回，不产生第二个 turn。
      if (hasPendingTurn(state.turns)) return;
      if (findUnknownTurn(state.turns)) {
        patch({
          chatError: "上一轮结果还不确定，请先查询结果，不要重复生成。",
        });
        return;
      }
      if (state.balanceBlocked) {
        patch({
          chatError: "余额不足，无法发起新的付费调用；正文仍可继续编辑。",
        });
        return;
      }

      const turn = createConversationTurn({
        scope,
        storyId,
        userContent: content,
        idFactory,
        now: now(),
      });
      const optimistic = [...state.turns, turn];
      commitTurns(storyId, optimistic, { chatError: null });

      const result = await transport.submitTurn({
        storyId,
        clientTurnId: turn.clientTurnId,
        requestHash: turn.requestHash,
        userClientMessageId: turn.userClientMessageId,
        assistantClientMessageId: turn.assistantClientMessageId,
        userContent: turn.userContent,
      });
      applySubmitResult(storyId, turn.clientTurnId, result);
    },

    async lookupUnknownTurn() {
      const storyId = state.activeStoryId;
      const unknown = findUnknownTurn(state.turns);
      if (storyId === null || !unknown) return;
      const result = await transport.lookupTurn({
        storyId,
        clientTurnId: unknown.clientTurnId,
        requestHash: unknown.requestHash,
      });
      if (!isStillActive(storyId)) return;
      if (!result.ok) {
        patch({
          chatError: result.error.message,
          transportStatus: "failure",
          transportError: result.error.message,
        });
        return;
      }
      if (result.data.status === "synced" && result.data.assistantContent) {
        const completed = applyConversationTurnEvent(unknown, {
          type: "generation_completed",
          assistantContent: result.data.assistantContent,
          now: now(),
        });
        const synced = applyConversationTurnEvent(completed, {
          type: "synced",
          now: now(),
        });
        commitTurns(storyId, replaceTurn(state.turns, synced), {
          chatError: null,
          transportStatus: "ready",
          transportError: null,
          balance: result.data.balance ?? state.balance,
        });
        return;
      }
      const missing = applyConversationTurnEvent(unknown, {
        type: "generation_failed",
        error: "服务端没有这一轮记录，可以重新发送同一条消息。",
        now: now(),
      });
      commitTurns(storyId, replaceTurn(state.turns, missing), {
        chatError: null,
        transportStatus: "ready",
        transportError: null,
      });
    },

    /** 用**同一个** turn 重试：requestHash 不变，服务端据此判定幂等。 */
    async retryTurn() {
      const storyId = state.activeStoryId;
      if (storyId === null) return;
      const failed = state.turns.find(
        turn =>
          turn.status === "generation-failed" ||
          turn.status === "persistence-failed",
      );
      if (!failed) return;
      const retrying = applyConversationTurnEvent(failed, {
        type: "generation_started",
        now: now(),
      });
      commitTurns(storyId, replaceTurn(state.turns, retrying), {
        chatError: null,
      });
      const result = await transport.submitTurn({
        storyId,
        clientTurnId: failed.clientTurnId,
        requestHash: failed.requestHash,
        userClientMessageId: failed.userClientMessageId,
        assistantClientMessageId: failed.assistantClientMessageId,
        userContent: failed.userContent,
      });
      applySubmitResult(storyId, failed.clientTurnId, result);
    },

    async retryTransport() {
      if (state.storyPhase === "error" || state.stories.length === 0) {
        await loadStories();
        return;
      }
      if (state.activeStoryId !== null) await openStory(state.activeStoryId);
    },

    editDocument(body) {
      const next = editDocumentBody(state.document, body, now());
      commitDocument(next);
    },

    async saveDocument() {
      const storyId = state.activeStoryId;
      const before = state.document;
      if (storyId === null || !before.recovery) return;
      const saving = beginDocumentSave(before);
      if (saving.status !== "saving") return;
      const expectedScopeKey = saving.recovery?.scopeKey ?? "";
      const expectedBody = saving.body;
      patch({ document: saving });

      const result = await transport.saveDocumentBody({
        storyId,
        versionId: saving.recovery?.versionId ?? "",
        platform: saving.recovery?.platform ?? "xiaohongshu",
        baseBodyRevision: saving.recovery?.baseBodyRevision ?? 0,
        body: expectedBody,
      });
      if (!isStillActive(storyId)) return;

      if (result.ok) {
        commitDocument(
          applyDocumentSaveSuccess(state.document, {
            expectedScopeKey,
            expectedBody,
            document: result.data.document,
          }),
          { transportStatus: "ready", transportError: null },
        );
        return;
      }
      const error = result.error;
      if (error.kind === "conflict" || error.kind === "target-missing") {
        commitDocument(
          applyDocumentSaveConflict(state.document, {
            reason: error.kind === "conflict" ? "body_changed" : "target_missing",
            latestDocument: error.latestDocument ?? null,
          }),
        );
        return;
      }
      commitDocument(
        applyDocumentSaveFailure(state.document, {
          error: error.message,
          uncertain: error.resultUnknown,
        }),
        { transportStatus: "failure", transportError: error.message },
      );
    },

    discardDraft() {
      commitDocument(discardLocalDraft(state.document));
    },

    async onShow() {
      const storyId = state.activeStoryId;
      if (storyId === null) return;
      const result = await transport.openStory(storyId);
      if (!isStillActive(storyId) || !result.ok) {
        if (!result.ok) {
          patch({
            transportStatus: "failure",
            transportError: result.error.message,
          });
        }
        return;
      }
      serverMessages = result.data.messages;
      // applyDocumentAuthority 自己保证不覆盖 dirty 正文。
      const document = applyDocumentAuthority(state.document, result.data.document);
      const projected = project(state.turns);
      patch({
        transportStatus: "ready",
        transportError: null,
        balance: result.data.balance,
        balanceBlocked: result.data.balance.availableCents <= 0,
        document,
        turns: projected.turns,
        messages: projected.messages,
      });
    },

    /**
     * 同步返回，刻意不是 Promise：onHide 只把已有草稿写进本机存储，
     * **不承诺**任何网络保存。小程序被回收时网络请求本来就没有机会完成。
     */
    onHide() {
      const storyId = state.activeStoryId;
      if (storyId === null) return;
      persistTurns(storyId, state.turns);
      persistDocumentRecovery(state.document);
    },

    signOut() {
      clearRecoveryForScope(storage, scope);
      serverMessages = [];
      patch({
        storyPhase: "loading",
        stories: [],
        activeStoryId: null,
        pendingStoryId: null,
        storyError: null,
        messages: [],
        turns: [],
        chatError: null,
        document: createLoadingDocumentState(scope, 0),
        balance: null,
        balanceBlocked: false,
      });
    },
  };

  function replaceTurn(
    turns: readonly ConversationRecoveryTurn[],
    next: ConversationRecoveryTurn,
  ): ConversationRecoveryTurn[] {
    return turns.map(turn =>
      turn.clientTurnId === next.clientTurnId ? next : turn,
    );
  }

  function applySubmitResult(
    storyId: number,
    clientTurnId: string,
    result: Awaited<ReturnType<WorkspaceTransport["submitTurn"]>>,
  ): void {
    // Story 已经切走：结果只回写到它自己的恢复记录，绝不渲染到当前视图。
    const current = state.turns.find(turn => turn.clientTurnId === clientTurnId);
    if (!isStillActive(storyId) || !current) {
      persistLateResult(storyId, clientTurnId, result);
      return;
    }
    if (result.ok) {
      const completed = applyConversationTurnEvent(current, {
        type: "generation_completed",
        assistantContent: result.data.assistantContent,
        now: now(),
      });
      const settled = result.data.persisted
        ? applyConversationTurnEvent(completed, { type: "synced", now: now() })
        : completed;
      commitTurns(storyId, replaceTurn(state.turns, settled), {
        chatError: null,
        balance: result.data.balance,
        balanceBlocked: result.data.balance.availableCents <= 0,
        transportStatus: "ready",
        transportError: null,
      });
      return;
    }
    const error = result.error;
    const next = applyConversationTurnEvent(current, {
      type: error.resultUnknown ? "generation_unknown" : "generation_failed",
      error: error.message,
      now: now(),
    });
    commitTurns(storyId, replaceTurn(state.turns, next), {
      chatError: error.message,
      balanceBlocked:
        error.kind === "insufficient-balance" ? true : state.balanceBlocked,
      transportStatus: "failure",
      transportError: error.message,
    });
  }

  /** 迟到结果落到那个 Story 自己的恢复记录里，切回去时还看得到。 */
  function persistLateResult(
    storyId: number,
    clientTurnId: string,
    result: Awaited<ReturnType<WorkspaceTransport["submitTurn"]>>,
  ): void {
    const stored = loadTurns(storyId);
    const target = stored.find(turn => turn.clientTurnId === clientTurnId);
    if (!target) return;
    const next = result.ok
      ? applyConversationTurnEvent(
          applyConversationTurnEvent(target, {
            type: "generation_completed",
            assistantContent: result.data.assistantContent,
            now: now(),
          }),
          { type: "synced", now: now() },
        )
      : applyConversationTurnEvent(target, {
          type: result.error.resultUnknown
            ? "generation_unknown"
            : "generation_failed",
          error: result.error.message,
          now: now(),
        });
    persistTurns(
      storyId,
      stored.map(turn => (turn.clientTurnId === clientTurnId ? next : turn)),
    );
  }
}
