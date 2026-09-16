import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StorySoundEvidenceReference,
  StorySoundPlanVersion,
  StorySoundPlanWorkspace,
} from "@shared/storySoundPlan";
import { trpc } from "@/lib/trpc";

export type StorySoundDirectorQuestion = {
  id: string;
  category: "global" | "dialogue" | "narration" | "music" | "ambience" | "sfx";
  sceneId?: string;
  prompt: string;
  why: string;
  evidence: StorySoundEvidenceReference[];
  sourceText: string;
  options: Array<{
    id: string;
    label: string;
    value: string;
    evidenceIds: string[];
  }>;
  freeTextAllowed: boolean;
};

type InterviewState = {
  questions: StorySoundDirectorQuestion[];
  currentStepIndex: number;
  reviewSuggestions: Array<{ stepId: string; value: string }>;
  evidenceChanged: boolean;
};

export type StorySoundDirectorSession = {
  workspace: StorySoundPlanWorkspace;
  interview: InterviewState | null;
  question: StorySoundDirectorQuestion | null;
  complete: boolean;
};

export type StartSoundDirectorDetail = { storyId?: number };

export function shouldRouteChatToSoundDirector(input: {
  active: boolean;
  hasQuestion: boolean;
  text: string;
}) {
  return input.active && input.hasQuestion && input.text.trim().length > 0;
}

export function isCurrentSoundDirectorStart(input: {
  requestId: number;
  currentRequestId: number;
  requestedStoryId: number;
  currentStoryId: number | null;
}) {
  return (
    input.requestId === input.currentRequestId &&
    input.requestedStoryId === input.currentStoryId
  );
}

export function useStorySoundDirector(storyId: number | null) {
  const utils = trpc.useUtils();
  const storyIdRef = useRef(storyId);
  const startRequestRef = useRef(0);
  storyIdRef.current = storyId;
  const [active, setActive] = useState(false);
  const [session, setSession] = useState<StorySoundDirectorSession | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const startMutation = trpc.storySoundDirector.start.useMutation();
  const answerMutation = trpc.storySoundDirector.answer.useMutation();
  const backMutation = trpc.storySoundDirector.goBack.useMutation();
  const editMutation = trpc.storySoundDirector.editRow.useMutation();
  const selectMutation = trpc.storySoundDirector.setRowSelected.useMutation();
  const confirmDraftMutation =
    trpc.storySoundDirector.confirmDraftText.useMutation();
  const saveVersionMutation = trpc.storySoundDirector.saveVersion.useMutation();
  const restoreMutation = trpc.storySoundDirector.restoreVersion.useMutation();
  const versionsQuery = trpc.storySoundDirector.versions.useQuery(
    { storyId: storyId ?? 1 },
    {
      enabled: active && storyId != null,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "声音方案操作失败");
  }, []);

  const start = useCallback(
    async (requestedStoryId = storyId) => {
      if (!requestedStoryId) {
        setError("请先打开一个故事");
        return;
      }
      setActive(true);
      setError(null);
      setConflictRevision(null);
      const requestId = ++startRequestRef.current;
      window.dispatchEvent(new Event("dt:open-creation-chat"));
      try {
        const result = await startMutation.mutateAsync({
          storyId: requestedStoryId,
        });
        if (
          !isCurrentSoundDirectorStart({
            requestId,
            currentRequestId: startRequestRef.current,
            requestedStoryId,
            currentStoryId: storyIdRef.current,
          })
        ) {
          return;
        }
        setSession(result as StorySoundDirectorSession);
      } catch (cause) {
        if (requestId !== startRequestRef.current) return;
        fail(cause);
      }
    },
    [fail, startMutation, storyId]
  );

  useEffect(() => {
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<StartSoundDirectorDetail>).detail;
      void start(detail?.storyId ?? storyId);
    };
    window.addEventListener("dt:start-sound-director", onStart);
    return () => window.removeEventListener("dt:start-sound-director", onStart);
  }, [start, storyId]);

  useEffect(() => {
    startRequestRef.current += 1;
    setActive(false);
    setSession(null);
    setError(null);
    setConflictRevision(null);
  }, [storyId]);

  const acceptSessionResult = useCallback(
    (
      result: {
        status: string;
        revision?: number;
      } & Partial<StorySoundDirectorSession>
    ) => {
      if (result.status === "conflict") {
        setConflictRevision(result.revision ?? null);
        return false;
      }
      if (result.workspace && "complete" in result) {
        setSession(result as StorySoundDirectorSession);
      }
      setError(null);
      return true;
    },
    []
  );

  const answer = useCallback(
    async (input: { optionId?: string; freeText?: string }) => {
      if (!storyId || !session?.question) return false;
      try {
        const result = await answerMutation.mutateAsync({
          storyId,
          expectedRevision: session.workspace.revision,
          stepId: session.question.id,
          ...input,
        });
        return acceptSessionResult(result);
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [acceptSessionResult, answerMutation, fail, session, storyId]
  );

  const goBack = useCallback(async () => {
    if (!storyId || !session) return;
    try {
      acceptSessionResult(
        await backMutation.mutateAsync({
          storyId,
          expectedRevision: session.workspace.revision,
        })
      );
    } catch (cause) {
      fail(cause);
    }
  }, [acceptSessionResult, backMutation, fail, session, storyId]);

  const mergeWorkspace = useCallback(
    (result: {
      status: string;
      revision?: number;
      workspace?: StorySoundPlanWorkspace;
    }) => {
      if (result.status === "conflict") {
        setConflictRevision(result.revision ?? null);
        return false;
      }
      if (result.workspace) {
        setSession(current =>
          current ? { ...current, workspace: result.workspace! } : current
        );
      }
      setError(null);
      return true;
    },
    []
  );

  const editRow = useCallback(
    async (
      rowId: string,
      patch: {
        text?: string;
        description?: string;
        startFrame?: number;
        durationFrames?: number;
        performance?: { style?: string };
      }
    ) => {
      if (!storyId || !session) return false;
      try {
        return mergeWorkspace(
          await editMutation.mutateAsync({
            storyId,
            expectedRevision: session.workspace.revision,
            rowId,
            ...patch,
          })
        );
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [editMutation, fail, mergeWorkspace, session, storyId]
  );

  const setRowSelected = useCallback(
    async (rowId: string, selected: boolean) => {
      if (!storyId || !session) return false;
      try {
        return mergeWorkspace(
          await selectMutation.mutateAsync({
            storyId,
            expectedRevision: session.workspace.revision,
            rowId,
            selected,
          })
        );
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [fail, mergeWorkspace, selectMutation, session, storyId]
  );

  const confirmDraftText = useCallback(
    async (rowId: string, confirmedText: string) => {
      if (!storyId || !session) return false;
      try {
        return mergeWorkspace(
          await confirmDraftMutation.mutateAsync({
            storyId,
            expectedRevision: session.workspace.revision,
            rowId,
            confirmedText,
          })
        );
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [confirmDraftMutation, fail, mergeWorkspace, session, storyId]
  );

  const saveVersion = useCallback(async () => {
    if (!storyId || !session) return;
    try {
      const result = await saveVersionMutation.mutateAsync({
        storyId,
        expectedRevision: session.workspace.revision,
      });
      if (result.status === "conflict") {
        setConflictRevision(result.revision);
      } else if (result.status === "evidence_changed") {
        setError("故事内容已经变化，请重新核对声音问题后再保存版本");
      } else {
        await versionsQuery.refetch();
        setError(null);
      }
    } catch (cause) {
      fail(cause);
    }
  }, [fail, saveVersionMutation, session, storyId, versionsQuery]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!storyId || !session) return false;
      try {
        const result = await restoreMutation.mutateAsync({
          storyId,
          expectedRevision: session.workspace.revision,
          versionId,
        });
        if (mergeWorkspace(result)) {
          setSession(current =>
            current
              ? { ...current, interview: null, question: null, complete: true }
              : current
          );
          return true;
        }
      } catch (cause) {
        fail(cause);
      }
      return false;
    },
    [fail, mergeWorkspace, restoreMutation, session, storyId]
  );

  const refreshAfterConflict = useCallback(async () => {
    if (!storyId) return;
    try {
      const fresh = await utils.storySoundDirector.resume.fetch({ storyId });
      if (fresh) setSession(fresh as StorySoundDirectorSession);
      setConflictRevision(null);
      setError(null);
    } catch (cause) {
      fail(cause);
    }
  }, [fail, storyId, utils.storySoundDirector.resume]);

  const pending =
    startMutation.isPending ||
    answerMutation.isPending ||
    backMutation.isPending ||
    editMutation.isPending ||
    selectMutation.isPending ||
    confirmDraftMutation.isPending ||
    saveVersionMutation.isPending ||
    restoreMutation.isPending;

  return useMemo(
    () => ({
      active,
      session,
      versions: (versionsQuery.data ?? []) as StorySoundPlanVersion[],
      pending,
      error,
      conflictRevision,
      start,
      answer,
      goBack,
      editRow,
      setRowSelected,
      confirmDraftText,
      saveVersion,
      restoreVersion,
      refreshAfterConflict,
      exit: () => {
        setActive(false);
        setError(null);
        setConflictRevision(null);
      },
    }),
    [
      active,
      answer,
      confirmDraftText,
      conflictRevision,
      editRow,
      error,
      goBack,
      pending,
      refreshAfterConflict,
      restoreVersion,
      saveVersion,
      session,
      setRowSelected,
      start,
      versionsQuery.data,
    ]
  );
}

export type StorySoundDirectorController = ReturnType<
  typeof useStorySoundDirector
>;
