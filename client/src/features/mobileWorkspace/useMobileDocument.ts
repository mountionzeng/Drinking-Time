import { useCallback, useEffect, useRef, useState } from "react";

import { trpc } from "@/lib/trpc";
import {
  applyMobileDocumentAuthority,
  applyMobileDocumentSaveConflict,
  applyMobileDocumentSaveFailure,
  applyMobileDocumentSaveSuccess,
  beginMobileDocumentSave,
  editMobileDocumentBody,
  hydrateMobileDocumentState,
  loadMobileDocumentRecovery,
  saveMobileDocumentRecovery,
  type MobileDocumentConflictReason,
  type MobileDocumentState,
  type MobileDocumentStorage,
  type MobilePublishingBodyDocument,
} from "./mobileDocumentStore";

export type MobileDocumentApi = {
  save(input: MobilePublishingBodySaveRequest): Promise<
    | { status: "saved"; document: MobilePublishingBodyDocument }
    | {
        status: "conflict";
        reason: MobileDocumentConflictReason;
        latestDocument: MobilePublishingBodyDocument | null;
      }
  >;
  read(input: { storyId: number }): Promise<MobilePublishingBodyDocument>;
};

export type MobilePublishingBodySaveRequest = {
  storyId: number;
  versionId: string;
  platform: MobilePublishingBodyDocument["platform"];
  baseBodyRevision: number;
  body: string;
};

export type MobilePublishingBodySaveOutcome =
  | { status: "saved"; document: MobilePublishingBodyDocument }
  | {
      status: "conflict";
      reason: MobileDocumentConflictReason;
      latestDocument: MobilePublishingBodyDocument | null;
    }
  | {
      status: "uncertain";
      error: string;
      latestDocument: MobilePublishingBodyDocument | null;
    };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function documentProvesSave(
  document: MobilePublishingBodyDocument | null,
  request: MobilePublishingBodySaveRequest
) {
  return Boolean(
    document &&
      document.storyId === request.storyId &&
      document.versionId === request.versionId &&
      document.platform === request.platform &&
      document.body === request.body &&
      document.bodyRevision > request.baseBodyRevision
  );
}

/**
 * 所有手机正文写入口共享的结果确认规则。响应丢失不等于保存失败：先读回
 * 权威正文，只有精确作用域和正文都相同才确认成功，避免用户重试追加两遍。
 */
export async function saveMobilePublishingBody(input: {
  api: MobileDocumentApi;
  request: MobilePublishingBodySaveRequest;
}): Promise<MobilePublishingBodySaveOutcome> {
  try {
    const result = await input.api.save(input.request);
    if (
      result.status === "conflict" &&
      documentProvesSave(result.latestDocument, input.request)
    ) {
      return { status: "saved", document: result.latestDocument! };
    }
    return result;
  } catch (error) {
    const message = errorMessage(error, "无法确认正文是否已保存");
    try {
      const latestDocument = await input.api.read({
        storyId: input.request.storyId,
      });
      return documentProvesSave(latestDocument, input.request)
        ? { status: "saved", document: latestDocument }
        : { status: "uncertain", error: message, latestDocument };
    } catch {
      return { status: "uncertain", error: message, latestDocument: null };
    }
  }
}

export async function runMobileDocumentSave(input: {
  state: MobileDocumentState;
  api: MobileDocumentApi;
}): Promise<MobileDocumentState> {
  const state =
    input.state.status === "saving"
      ? input.state
      : beginMobileDocumentSave(input.state);
  if (!state.document || !state.recovery || state.status !== "saving") {
    return state;
  }
  const expectedScopeKey = state.recovery.scopeKey;
  const expectedBody = state.body;
  const result = await saveMobilePublishingBody({
    api: input.api,
    request: {
      storyId: state.storyId,
      versionId: state.recovery.versionId,
      platform: state.recovery.platform,
      baseBodyRevision: state.recovery.baseBodyRevision,
      body: expectedBody,
    },
  });
  if (result.status === "conflict") {
    return applyMobileDocumentSaveConflict(state, result);
  }
  if (result.status === "saved") {
    return applyMobileDocumentSaveSuccess(state, {
      expectedScopeKey,
      expectedBody,
      document: result.document,
    });
  }
  const uncertain = applyMobileDocumentSaveFailure(state, {
    error: result.error,
    uncertain: true,
  });
  return result.latestDocument
    ? applyMobileDocumentAuthority(uncertain, result.latestDocument)
    : uncertain;
}

function browserStorage(): MobileDocumentStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function ownerStoryScope(userId: number, storyId: number): string {
  return `${userId}:${storyId}`;
}

function persistStateTransition(input: {
  storage: MobileDocumentStorage | null;
  previous: MobileDocumentState | null;
  next: MobileDocumentState;
}) {
  if (!input.storage) return;
  let records = loadMobileDocumentRecovery(
    input.storage,
    input.next.userId,
    input.next.storyId
  );
  const previousScope = input.previous?.recovery?.scopeKey;
  if (previousScope && previousScope !== input.next.recovery?.scopeKey) {
    records = records.filter(record => record.scopeKey !== previousScope);
  }
  if (input.next.recovery) {
    records = records.filter(
      record => record.scopeKey !== input.next.recovery!.scopeKey
    );
    records.push(input.next.recovery);
  } else if (input.next.document) {
    records = records.filter(
      record =>
        !(
          record.versionId === input.next.document!.versionId &&
          record.platform === input.next.document!.platform &&
          record.body === input.next.document!.body
        )
    );
  }
  saveMobileDocumentRecovery(
    input.storage,
    input.next.userId,
    input.next.storyId,
    records
  );
}

export function useMobileDocument(input: {
  userId: number;
  storyId: number;
  storage?: MobileDocumentStorage | null;
}) {
  const storage =
    input.storage === undefined ? browserStorage() : input.storage;
  const currentScope = ownerStoryScope(input.userId, input.storyId);
  const scopeRef = useRef(currentScope);
  scopeRef.current = currentScope;
  const [container, setContainer] = useState<{
    scope: string;
    state: MobileDocumentState | null;
  }>({ scope: currentScope, state: null });
  const stateRef = useRef<MobileDocumentState | null>(null);
  const query = trpc.publishingDraft.readBody.useQuery(
    { storyId: input.storyId },
    { enabled: input.storyId > 0, retry: false, refetchOnWindowFocus: false }
  );
  const saveMutation = trpc.publishingDraft.saveBody.useMutation();
  const initMutation = trpc.publishingDraft.initBody.useMutation();
  const utils = trpc.useUtils();

  const commit = useCallback(
    (
      scope: string,
      update: (state: MobileDocumentState | null) => MobileDocumentState | null
    ) => {
      setContainer(previous => {
        if (previous.scope !== scope || scopeRef.current !== scope) {
          return previous;
        }
        const next = update(previous.state);
        if (!next || next === previous.state) return previous;
        persistStateTransition({
          storage,
          previous: previous.state,
          next,
        });
        stateRef.current = next;
        return { scope, state: next };
      });
    },
    [storage]
  );

  useEffect(() => {
    setContainer(previous => {
      if (previous.scope === currentScope) return previous;
      stateRef.current = null;
      return { scope: currentScope, state: null };
    });
  }, [currentScope]);

  useEffect(() => {
    const document = query.data as MobilePublishingBodyDocument | undefined;
    if (!document || document.storyId !== input.storyId) return;
    commit(currentScope, current => {
      if (!current) {
        return hydrateMobileDocumentState({
          userId: input.userId,
          storyId: input.storyId,
          document,
          recoveryRecords: storage
            ? loadMobileDocumentRecovery(storage, input.userId, input.storyId)
            : [],
        });
      }
      return applyMobileDocumentAuthority(current, document);
    });
  }, [commit, currentScope, input.storyId, input.userId, query.data, storage]);

  const state = container.scope === currentScope ? container.state : null;
  stateRef.current = state;

  const editBody = useCallback(
    (body: string) => {
      commit(currentScope, current =>
        current ? editMobileDocumentBody(current, body) : current
      );
    },
    [commit, currentScope]
  );

  const apiRef = useRef<MobileDocumentApi | null>(null);
  apiRef.current = {
    save: value => saveMutation.mutateAsync(value),
    read: value => utils.publishingDraft.readBody.fetch(value),
  };

  const save = useCallback(async () => {
    const capturedScope = currentScope;
    const current = stateRef.current;
    if (
      !current ||
      (current.status !== "dirty" && current.status !== "failed")
    ) {
      return current;
    }
    const saving = beginMobileDocumentSave(current);
    const expectedScopeKey = saving.recovery?.scopeKey;
    const expectedBody = saving.body;
    commit(capturedScope, () => saving);
    const result = await runMobileDocumentSave({
      state: saving,
      api: apiRef.current!,
    });
    commit(capturedScope, latest => {
      if (!latest) return latest;
      if (
        latest.recovery?.scopeKey === expectedScopeKey &&
        latest.body === expectedBody
      ) {
        return result;
      }
      if (result.status === "saved" && result.document) {
        return applyMobileDocumentAuthority(latest, result.document);
      }
      if (result.status === "conflict" && result.conflict) {
        return applyMobileDocumentSaveConflict(latest, result.conflict);
      }
      return latest;
    });
    return result;
  }, [commit, currentScope]);

  const discard = useCallback(() => {
    commit(currentScope, current => {
      const latest = current?.conflict?.latestDocument ?? current?.document;
      if (!current || !latest) return current;
      return {
        ...current,
        status: "clean",
        document: latest,
        body: latest.body,
        recovery: null,
        conflict: null,
        error: null,
      };
    });
  }, [commit, currentScope]);

  const hasUnsavedChanges =
    state?.status === "dirty" ||
    state?.status === "saving" ||
    state?.status === "failed" ||
    state?.status === "uncertain" ||
    state?.status === "conflict";

  return {
    state,
    loadState: query.isError
      ? ("error" as const)
      : state
        ? ("ready" as const)
        : ("loading" as const),
    loadError: query.error ? errorMessage(query.error, "正文加载失败") : null,
    editBody,
    save,
    discard,
    retryLoad: query.refetch,
    /** 这个故事还没有正文时，建一份空的再开始写。服务端幂等，重复调不会覆盖已有内容。 */
    initBody: async () => {
      await initMutation.mutateAsync({ storyId: input.storyId });
      await query.refetch();
    },
    initializing: initMutation.isPending,
    hasUnsavedChanges,
    canSave: state?.status === "dirty" || state?.status === "failed",
    isSaving: state?.status === "saving",
  };
}
