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
  save(input: {
    storyId: number;
    versionId: string;
    platform: MobilePublishingBodyDocument["platform"];
    baseBodyRevision: number;
    body: string;
  }): Promise<
    | { status: "saved"; document: MobilePublishingBodyDocument }
    | {
        status: "conflict";
        reason: MobileDocumentConflictReason;
        latestDocument: MobilePublishingBodyDocument | null;
      }
  >;
  read(input: { storyId: number }): Promise<MobilePublishingBodyDocument>;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
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
  try {
    const result = await input.api.save({
      storyId: state.storyId,
      versionId: state.recovery.versionId,
      platform: state.recovery.platform,
      baseBodyRevision: state.recovery.baseBodyRevision,
      body: expectedBody,
    });
    if (result.status === "conflict") {
      return applyMobileDocumentSaveConflict(state, result);
    }
    return applyMobileDocumentSaveSuccess(state, {
      expectedScopeKey,
      expectedBody,
      document: result.document,
    });
  } catch (error) {
    const uncertain = applyMobileDocumentSaveFailure(state, {
      error: errorMessage(error, "无法确认正文是否已保存"),
      uncertain: true,
    });
    try {
      return applyMobileDocumentAuthority(
        uncertain,
        await input.api.read({ storyId: state.storyId })
      );
    } catch {
      return uncertain;
    }
  }
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
    hasUnsavedChanges,
    canSave: state?.status === "dirty" || state?.status === "failed",
    isSaving: state?.status === "saving",
  };
}
