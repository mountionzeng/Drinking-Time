import type { GameWorkspaceOperation } from "../../shared/minigameWorkspace";
import {
  hydrateMobileDocumentState,
  editMobileDocumentBody,
  beginMobileDocumentSave,
  applyMobileDocumentAuthority,
  loadMobileDocumentRecovery,
  saveMobileDocumentRecovery,
  type MobileDocumentState,
  type MobilePublishingBodyDocument,
  type MobileDocumentStorage,
} from "../../client/src/features/mobileWorkspace/mobileDocumentStore";
import {
  createMobileConversationRecoveryTurn,
  loadMobileConversationRecovery,
  saveMobileConversationRecovery,
  mergeMobileConversationProjection,
  type MobileConversationRecoveryTurn,
  type MobileConversationServerMessage,
} from "../../client/src/features/mobileWorkspace/mobileConversationStore";
// Reuse the exact Web save/recovery workflows; no React hooks run in the game.
import { runMobileDocumentSave } from "../../client/src/features/mobileWorkspace/useMobileDocument";
import {
  runMobileConversationTurn,
  type MobileConversationApi,
} from "../../client/src/features/mobileWorkspace/useMobileConversation";

export type WorkspaceCall = <T>(
  operation: GameWorkspaceOperation,
  input?: unknown
) => Promise<T>;
export type WorkspaceAccount = {
  id: number;
  name: string | null;
  email: string | null;
  recoveryScope: string;
};
export type WorkspaceState = {
  account: WorkspaceAccount | null;
  stories: Array<{ id: number; title: string }>;
  storyId: number | null;
  document: MobileDocumentState | null;
  documentError: string;
  messages: MobileConversationServerMessage[];
  turns: MobileConversationRecoveryTurn[];
  chatReady: boolean;
  chatDraft: string;
  busy: string;
  error: string;
};
const empty = (): WorkspaceState => ({
  account: null,
  stories: [],
  storyId: null,
  document: null,
  documentError: "",
  messages: [],
  turns: [],
  chatReady: false,
  chatDraft: "",
  busy: "",
  error: "",
});
export const workspaceError = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  return (
    (
      {
        session_expired: "登录已过期，请重新登录。",
        workspace_not_enabled: "工作区接口尚未开通。",
        invalid_input: "内容无法读取或格式不符，请刷新后重试。",
        not_found: "故事不存在或无权访问。",
        conflict: "另一端已更新，请保留本机修改后处理冲突。",
        rate_limited: "操作较频繁，请稍后重试。",
      } as Record<string, string>
    )[code] ?? "网络请求未完成，请重试；未确认的内容不会自动重复提交。"
  );
};

export function createWorkspaceClient(
  call: WorkspaceCall,
  storage: MobileDocumentStorage,
  changed: (state: WorkspaceState) => void
) {
  let state = empty(),
    epoch = 0;
  const emit = (patch: Partial<WorkspaceState>) => {
    state = { ...state, ...patch };
    changed(state);
  };
  const scopedStorage = (): MobileDocumentStorage => {
    const account = state.account;
    if (!account) throw new Error("session_expired");
    const key = (value: string) =>
      `dk:workspace:${account.recoveryScope}:${value.replace(`:${account.id}:`, ":")}`;
    return {
      getItem: k => storage.getItem(key(k)),
      setItem: (k, v) => storage.setItem(key(k), v),
      removeItem: k => storage.removeItem(key(k)),
    };
  };
  function persistDocument(document: MobileDocumentState) {
    const store = scopedStorage();
    let records = loadMobileDocumentRecovery(
      store,
      document.userId,
      document.storyId
    );
    const previous = state.document?.recovery?.scopeKey;
    records = records.filter(
      record =>
        record.scopeKey !== previous &&
        record.scopeKey !== document.recovery?.scopeKey
    );
    if (document.recovery) records.push(document.recovery);
    saveMobileDocumentRecovery(
      store,
      document.userId,
      document.storyId,
      records
    );
  }
  function commitDocument(document: MobileDocumentState) {
    try {
      persistDocument(document);
    } catch {
      emit({ document, error: "本机草稿存储失败，请复制保留内容后重试。" });
      throw new Error("storage_unavailable");
    }
    emit({ document });
  }
  function commitTurns(turns: MobileConversationRecoveryTurn[]) {
    if (!state.account || !state.storyId) return;
    try {
      saveMobileConversationRecovery(
        scopedStorage(),
        state.account.id,
        state.storyId,
        turns
      );
    } catch {
      emit({
        turns,
        error: "本机恢复记录存储失败，已暂停提交，请复制保留内容。",
      });
      throw new Error("storage_unavailable");
    }
    emit({ turns });
  }
  const dirty = () => Boolean(state.document?.recovery);
  async function history(expected: number, storyId: number) {
    const result = await call<{ messages: MobileConversationServerMessage[] }>(
      "chat.list",
      { storyId }
    );
    if (expected !== epoch || storyId !== state.storyId) return;
    const projection = mergeMobileConversationProjection({
      serverMessages: result.messages,
      recoveryTurns: state.turns,
    });
    commitTurns(projection.remainingRecoveryTurns);
    emit({ messages: result.messages, chatReady: true });
  }
  async function select(storyId: number) {
    if (dirty() || state.busy) return false;
    const expected = ++epoch,
      account = state.account;
    if (!account) return false;
    const turns = loadMobileConversationRecovery(
      scopedStorage(),
      account.id,
      storyId
    );
    emit({
      storyId,
      document: null,
      documentError: "",
      messages: [],
      turns,
      chatReady: false,
      chatDraft: "",
      busy: "正在打开故事…",
      error: "",
    });
    await Promise.all([
      call<MobilePublishingBodyDocument>("body.read", { storyId })
        .then(document => {
          if (expected === epoch)
            commitDocument(
              hydrateMobileDocumentState({
                userId: account.id,
                storyId,
                document,
                recoveryRecords: loadMobileDocumentRecovery(
                  scopedStorage(),
                  account.id,
                  storyId
                ),
              })
            );
        })
        .catch(error => {
          if (expected === epoch)
            emit({ documentError: workspaceError(error) });
        }),
      history(expected, storyId).catch(error => {
        if (expected === epoch) emit({ error: workspaceError(error) });
      }),
    ]);
    if (expected === epoch) emit({ busy: "" });
    return expected === epoch;
  }
  async function connect() {
    const expected = ++epoch;
    state = empty();
    emit({ busy: "正在读取账号…" });
    try {
      const account = await call<WorkspaceAccount>("account.read");
      const { stories } = await call<{ stories: WorkspaceState["stories"] }>(
        "stories.list"
      );
      if (expected !== epoch) return;
      emit({ account, stories, busy: "" });
      if (stories[0]) await select(stories[0].id);
    } catch (error) {
      if (expected === epoch) emit({ busy: "", error: workspaceError(error) });
    }
  }
  async function save() {
    if (!state.document || state.busy) return false;
    const expected = epoch,
      saving = beginMobileDocumentSave(state.document);
    if (saving.status !== "saving") return !dirty();
    commitDocument(saving);
    emit({ busy: "正在保存正文…", error: "" });
    try {
      const result = await runMobileDocumentSave({
        state: saving,
        api: {
          save: input => call("body.save", input),
          read: input => call("body.read", input),
        },
      });
      if (expected !== epoch) return false;
      commitDocument(result);
      return result.status === "saved" || result.status === "clean";
    } finally {
      if (expected === epoch) emit({ busy: "" });
    }
  }
  async function runTurn(turn: MobileConversationRecoveryTurn, retry = false) {
    if (state.busy || !state.chatReady) return;
    const expected = epoch,
      storyId = turn.storyId;
    emit({ busy: "正在回复…", error: "" });
    const scoped: WorkspaceCall = async (operation, input) => {
      if (expected !== epoch) throw new Error("stale");
      const result = await call(operation, input);
      if (expected !== epoch) throw new Error("stale");
      return result as never;
    };
    const api: MobileConversationApi = {
      generate: input => scoped("chat.generate", input),
      status: input => scoped("chat.status", input),
      append: input => scoped("chat.append", input),
    };
    try {
      await runMobileConversationTurn({
        turn,
        api,
        retryFailed: retry && turn.status === "generation-failed",
        recoverFirst: retry,
        onTurn: next => {
          if (expected === epoch)
            commitTurns([
              ...state.turns.filter(t => t.clientTurnId !== next.clientTurnId),
              next,
            ]);
        },
      });
      if (expected !== epoch) return;
      try {
        await history(expected, storyId);
      } catch (error) {
        if (expected === epoch) emit({ error: workspaceError(error) });
      }
    } finally {
      if (expected === epoch) emit({ busy: "" });
    }
  }
  return {
    getState: () => state,
    hasUnsavedChanges: dirty,
    connect,
    select,
    save,
    disconnect() {
      epoch++;
      state = empty();
      changed(state);
    },
    projection: () =>
      mergeMobileConversationProjection({
        serverMessages: state.messages,
        recoveryTurns: state.turns,
      }).messages,
    editBody(body: string) {
      if (state.document && !state.busy)
        commitDocument(editMobileDocumentBody(state.document, body));
    },
    discardBody() {
      const document =
        state.document?.conflict?.latestDocument ?? state.document?.document;
      if (!document || !state.account || !state.storyId) return;
      commitDocument(
        hydrateMobileDocumentState({
          userId: state.account.id,
          storyId: state.storyId,
          document,
          recoveryRecords: [],
        })
      );
    },
    setChatDraft(chatDraft: string) {
      emit({ chatDraft });
    },
    async send() {
      if (
        !state.account ||
        !state.storyId ||
        !state.chatDraft.trim() ||
        state.busy ||
        !state.chatReady
      )
        return;
      const turn = createMobileConversationRecoveryTurn({
        userId: state.account.id,
        storyId: state.storyId,
        userContent: state.chatDraft,
      });
      commitTurns([...state.turns, turn]);
      emit({ chatDraft: "" });
      await runTurn(turn);
    },
    retryTurn(id: string) {
      const turn = state.turns.find(t => t.clientTurnId === id);
      return turn ? runTurn(turn, true) : Promise.resolve();
    },
    discardTurn(id: string) {
      if (!state.busy)
        commitTurns(state.turns.filter(t => t.clientTurnId !== id));
    },
    async refreshChat() {
      if (!state.storyId || state.busy) return;
      const expected = epoch;
      emit({ busy: "正在读取聊天…", error: "" });
      try {
        await history(expected, state.storyId);
      } catch (error) {
        if (expected === epoch) emit({ error: workspaceError(error) });
      } finally {
        if (expected === epoch) emit({ busy: "" });
      }
    },
    async refresh() {
      if (state.busy || !state.storyId) return;
      const expected = epoch;
      emit({ busy: "正在刷新…", error: "" });
      try {
        const document = await call<MobilePublishingBodyDocument>("body.read", {
          storyId: state.storyId,
        });
        if (expected === epoch && state.document)
          commitDocument(
            applyMobileDocumentAuthority(state.document, document)
          );
        await history(expected, state.storyId!);
      } catch (error) {
        if (expected === epoch) emit({ error: workspaceError(error) });
      } finally {
        if (expected === epoch) emit({ busy: "" });
      }
    },
    async initializeBody() {
      if (!state.storyId || state.busy) return;
      const expected = epoch;
      emit({ busy: "正在创建正文…" });
      try {
        const document = await call<MobilePublishingBodyDocument>(
          "body.initialize",
          { storyId: state.storyId }
        );
        if (expected === epoch && state.account) {
          commitDocument(
            hydrateMobileDocumentState({
              userId: state.account.id,
              storyId: state.storyId!,
              document,
              recoveryRecords: [],
            })
          );
          emit({ documentError: "" });
        }
      } catch (error) {
        if (expected === epoch) emit({ error: workspaceError(error) });
      } finally {
        if (expected === epoch) emit({ busy: "" });
      }
    },
    async createStory() {
      if (dirty() || state.busy) return false;
      const expected = epoch;
      emit({ busy: "正在新建故事…", error: "" });
      try {
        const created = await call<{ id: number }>("stories.create");
        const { stories } = await call<{ stories: WorkspaceState["stories"] }>(
          "stories.list"
        );
        if (expected !== epoch) return false;
        emit({ stories, busy: "" });
        return select(created.id);
      } catch (error) {
        if (expected === epoch)
          emit({ busy: "", error: workspaceError(error) });
        return false;
      }
    },
  };
}
