import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { trpc } from "@/lib/trpc";
import {
  applyMobileConversationTurnEvent,
  createMobileConversationRecoveryTurn,
  loadMobileConversationRecovery,
  mergeMobileConversationProjection,
  saveMobileConversationRecovery,
  type MobileConversationRecoveryTurn,
  type MobileConversationStorage,
} from "./mobileConversationStore";

type MobileTurnApiResult = {
  status: "pending" | "completed" | "failed" | "unknown" | "missing";
  turn: {
    assistantContent?: string | null;
    appendStatus?: "pending" | "appended";
    failureMessage?: string | null;
  } | null;
};

export type MobileConversationApi = {
  generate(input: {
    storyId: number;
    clientTurnId: string;
    requestHash: string;
    userClientMessageId: string;
    assistantClientMessageId: string;
    userContent: string;
    retryFailed?: boolean;
  }): Promise<MobileTurnApiResult>;
  status(input: {
    storyId: number;
    clientTurnId: string;
    requestHash: string;
  }): Promise<MobileTurnApiResult>;
  append(input: {
    storyId: number;
    clientTurnId: string;
    requestHash: string;
  }): Promise<{ status: "appended" }>;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function turnLookupInput(turn: MobileConversationRecoveryTurn) {
  return {
    storyId: turn.storyId,
    clientTurnId: turn.clientTurnId,
    requestHash: turn.requestHash,
  };
}

function turnGenerationInput(
  turn: MobileConversationRecoveryTurn,
  retryFailed: boolean
) {
  return {
    ...turnLookupInput(turn),
    userClientMessageId: turn.userClientMessageId,
    assistantClientMessageId: turn.assistantClientMessageId,
    userContent: turn.userContent,
    ...(retryFailed ? { retryFailed: true } : {}),
  };
}

export async function runMobileConversationTurn(input: {
  turn: MobileConversationRecoveryTurn;
  api: MobileConversationApi;
  retryFailed?: boolean;
  recoverFirst?: boolean;
  now?: () => number;
  onTurn?: (turn: MobileConversationRecoveryTurn) => void;
}): Promise<MobileConversationRecoveryTurn> {
  const now = input.now ?? Date.now;
  let current = input.turn;
  const emit = (next: MobileConversationRecoveryTurn) => {
    current = next;
    input.onTurn?.(next);
    return next;
  };

  const markUnknown = (message: string) =>
    emit(
      applyMobileConversationTurnEvent(current, {
        type: "generation_unknown",
        error: message,
        now: now(),
      })
    );

  const appendCompleted = async (
    response: MobileTurnApiResult
  ): Promise<MobileConversationRecoveryTurn> => {
    if (response.turn?.appendStatus === "appended") {
      return emit(
        applyMobileConversationTurnEvent(current, {
          type: "synced",
          now: now(),
        })
      );
    }
    const assistantContent = response.turn?.assistantContent?.trim();
    if (!assistantContent) {
      return markUnknown("服务端已完成生成，但没有可恢复的回答");
    }
    emit(
      applyMobileConversationTurnEvent(current, {
        type: "generation_completed",
        assistantContent,
        now: now(),
      })
    );
    try {
      await input.api.append(turnLookupInput(current));
      return emit(
        applyMobileConversationTurnEvent(current, {
          type: "synced",
          now: now(),
        })
      );
    } catch (error) {
      try {
        const status = await input.api.status(turnLookupInput(current));
        if (
          status.status === "completed" &&
          status.turn?.appendStatus === "appended"
        ) {
          return emit(
            applyMobileConversationTurnEvent(current, {
              type: "synced",
              now: now(),
            })
          );
        }
      } catch {
        // Keep the complete local turn below; a later explicit retry is safe.
      }
      return emit(
        applyMobileConversationTurnEvent(current, {
          type: "append_failed",
          error: errorMessage(error, "回答保存失败"),
          now: now(),
        })
      );
    }
  };

  const handleGenerationResult = async (
    result: MobileTurnApiResult
  ): Promise<MobileConversationRecoveryTurn> => {
    if (result.status === "completed") return appendCompleted(result);
    if (result.status === "failed") {
      return emit(
        applyMobileConversationTurnEvent(current, {
          type: "generation_failed",
          error: result.turn?.failureMessage || "模型暂时没有回复",
          now: now(),
        })
      );
    }
    return markUnknown(
      result.status === "pending"
        ? "回答仍在生成，请稍后检查"
        : "无法确认本次回答结果，请复制内容后新建一轮"
    );
  };

  if (
    current.assistantContent &&
    (current.status === "persistence-failed" ||
      current.status === "persisting" ||
      current.status === "synced")
  ) {
    if (current.status === "synced") return current;
    emit(
      applyMobileConversationTurnEvent(current, {
        type: "append_started",
        now: now(),
      })
    );
    return appendCompleted({
      status: "completed",
      turn: {
        assistantContent: current.assistantContent,
        appendStatus: "pending",
      },
    });
  }

  if (input.recoverFirst) {
    try {
      const status = await input.api.status(turnLookupInput(current));
      if (status.status === "completed") return appendCompleted(status);
      if (status.status === "pending" || status.status === "unknown") {
        return handleGenerationResult(status);
      }
      if (status.status === "failed" && !input.retryFailed) {
        return handleGenerationResult(status);
      }
      // Missing proves the server has no durable turn; failed with an explicit
      // retry is also safe to invoke with the original identity.
    } catch (error) {
      return markUnknown(errorMessage(error, "无法确认本次回答结果"));
    }
  }

  if (current.status !== "replying") {
    emit(
      applyMobileConversationTurnEvent(current, {
        type: "generation_started",
        now: now(),
      })
    );
  }
  try {
    return handleGenerationResult(
      await input.api.generate(
        turnGenerationInput(current, input.retryFailed === true)
      )
    );
  } catch (error) {
    try {
      return handleGenerationResult(
        await input.api.status(turnLookupInput(current))
      );
    } catch {
      return markUnknown(errorMessage(error, "回答响应丢失"));
    }
  }
}

function browserStorage(): MobileConversationStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function scopeKey(userId: number, storyId: number): string {
  return `${userId}:${storyId}`;
}

export type MobileConversationHistoryState =
  | "loading"
  | "empty"
  | "loaded"
  | "error";

export function useMobileConversation(input: {
  userId: number;
  storyId: number;
  storage?: MobileConversationStorage | null;
}) {
  const storage =
    input.storage === undefined ? browserStorage() : input.storage;
  const currentScopeKey = scopeKey(input.userId, input.storyId);
  const scopeRef = useRef(currentScopeKey);
  scopeRef.current = currentScopeKey;
  const [recoveryState, setRecoveryState] = useState<{
    scopeKey: string;
    turns: MobileConversationRecoveryTurn[];
  }>({ scopeKey: "", turns: [] });
  const [inFlightVersion, setInFlightVersion] = useState(0);
  const inFlightScopes = useRef(new Set<string>());

  const query = trpc.storyConversation.list.useQuery(
    { storyId: input.storyId },
    { enabled: input.storyId > 0, retry: false, refetchOnWindowFocus: false }
  );
  const generateMutation =
    trpc.storyConversation.generateMobileTurn.useMutation();
  const appendMutation = trpc.storyConversation.appendMobileTurn.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    const turns = storage
      ? loadMobileConversationRecovery(storage, input.userId, input.storyId)
      : [];
    setRecoveryState({ scopeKey: currentScopeKey, turns });
  }, [currentScopeKey, input.storyId, input.userId, storage]);

  const currentRecoveryTurns =
    recoveryState.scopeKey === currentScopeKey ? recoveryState.turns : [];
  const projection = useMemo(
    () =>
      mergeMobileConversationProjection({
        serverMessages: query.data?.messages ?? [],
        recoveryTurns: currentRecoveryTurns,
      }),
    [currentRecoveryTurns, query.data?.messages]
  );

  useEffect(() => {
    if (!query.data || recoveryState.scopeKey !== currentScopeKey) return;
    if (
      projection.remainingRecoveryTurns.length === currentRecoveryTurns.length
    ) {
      return;
    }
    if (storage) {
      saveMobileConversationRecovery(
        storage,
        input.userId,
        input.storyId,
        projection.remainingRecoveryTurns
      );
    }
    setRecoveryState({
      scopeKey: currentScopeKey,
      turns: projection.remainingRecoveryTurns,
    });
  }, [
    currentRecoveryTurns.length,
    currentScopeKey,
    input.storyId,
    input.userId,
    projection.remainingRecoveryTurns,
    query.data,
    recoveryState.scopeKey,
    storage,
  ]);

  const persistTurn = useCallback(
    (turn: MobileConversationRecoveryTurn) => {
      const turnScope = scopeKey(turn.userId, turn.storyId);
      let turns: MobileConversationRecoveryTurn[] = [];
      if (storage) {
        turns = loadMobileConversationRecovery(
          storage,
          turn.userId,
          turn.storyId
        );
      } else if (turnScope === scopeRef.current) {
        turns = recoveryState.scopeKey === turnScope ? recoveryState.turns : [];
      }
      const existingIndex = turns.findIndex(
        candidate => candidate.clientTurnId === turn.clientTurnId
      );
      const next = [...turns];
      if (existingIndex >= 0) next[existingIndex] = turn;
      else next.push(turn);
      if (storage) {
        saveMobileConversationRecovery(
          storage,
          turn.userId,
          turn.storyId,
          next
        );
      }
      if (turnScope === scopeRef.current) {
        setRecoveryState({ scopeKey: turnScope, turns: next });
      }
    },
    [recoveryState.scopeKey, recoveryState.turns, storage]
  );

  const api = useMemo<MobileConversationApi>(
    () => ({
      generate: value => generateMutation.mutateAsync(value),
      append: value => appendMutation.mutateAsync(value),
      status: value => utils.storyConversation.mobileTurnStatus.fetch(value),
    }),
    [appendMutation, generateMutation, utils.storyConversation.mobileTurnStatus]
  );

  const run = useCallback(
    async (
      initial: MobileConversationRecoveryTurn,
      options: { retryFailed?: boolean; recoverFirst?: boolean } = {}
    ) => {
      const turnScope = scopeKey(initial.userId, initial.storyId);
      if (inFlightScopes.current.has(turnScope)) return initial;
      inFlightScopes.current.add(turnScope);
      if (turnScope === scopeRef.current)
        setInFlightVersion(value => value + 1);
      try {
        const result = await runMobileConversationTurn({
          turn: initial,
          api,
          ...options,
          onTurn: persistTurn,
        });
        persistTurn(result);
        if (result.status === "synced") {
          try {
            await query.refetch();
          } catch {
            // The append is authoritative; keep the synced recovery until a
            // later successful projection refetch removes it by message IDs.
          }
        }
        return result;
      } finally {
        inFlightScopes.current.delete(turnScope);
        if (turnScope === scopeRef.current) {
          setInFlightVersion(value => value + 1);
        }
      }
    },
    [api, persistTurn, query]
  );

  const submit = useCallback(
    async (content: string) => {
      if (
        !query.data ||
        query.isError ||
        inFlightScopes.current.has(currentScopeKey)
      ) {
        return null;
      }
      const turn = createMobileConversationRecoveryTurn({
        userId: input.userId,
        storyId: input.storyId,
        userContent: content,
      });
      persistTurn(turn);
      return run(turn);
    },
    [
      currentScopeKey,
      input.storyId,
      input.userId,
      persistTurn,
      query.data,
      query.isError,
      run,
    ]
  );

  const retryTurn = useCallback(
    (clientTurnId: string) => {
      const turn = currentRecoveryTurns.find(
        candidate => candidate.clientTurnId === clientTurnId
      );
      if (!turn) return Promise.resolve(null);
      return run(turn, {
        retryFailed: turn.status === "generation-failed",
        recoverFirst:
          turn.status === "generation-unknown" || turn.status === "replying",
      });
    },
    [currentRecoveryTurns, run]
  );

  const discardRecoveryTurn = useCallback(
    (clientTurnId: string) => {
      const next = currentRecoveryTurns.filter(
        turn => turn.clientTurnId !== clientTurnId
      );
      if (storage) {
        saveMobileConversationRecovery(
          storage,
          input.userId,
          input.storyId,
          next
        );
      }
      setRecoveryState({ scopeKey: currentScopeKey, turns: next });
    },
    [
      currentRecoveryTurns,
      currentScopeKey,
      input.storyId,
      input.userId,
      storage,
    ]
  );

  const historyState: MobileConversationHistoryState = query.isError
    ? "error"
    : !query.data
      ? "loading"
      : projection.messages.length === 0
        ? "empty"
        : "loaded";
  const isSubmitting = inFlightScopes.current.has(currentScopeKey);
  void inFlightVersion;

  return {
    historyState,
    historyError: query.error
      ? errorMessage(query.error, "聊天记录加载失败")
      : null,
    messages: projection.messages,
    recoveryTurns: currentRecoveryTurns,
    canSend:
      (historyState === "empty" || historyState === "loaded") && !isSubmitting,
    isSubmitting,
    submit,
    retryTurn,
    discardRecoveryTurn,
    reloadHistory: query.refetch,
  };
}
