import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { BackendReference } from '@/features/analysis/types';

const PROJECT_ID_STORAGE_KEY = 'dt:currentProjectId';
// 当前故事按 project 维度分槽持久化（U4）：dt:activeStoryId:{projectId}。
// 故事是唯一单位——shot.list / creation 聊天 / Shot Table 都跟随这个值。
const ACTIVE_STORY_KEY_PREFIX = 'dt:activeStoryId';

type ProjectIdentity = { id: number };

function activeStoryStorageKey(projectId: number): string {
  return `${ACTIVE_STORY_KEY_PREFIX}:${projectId}`;
}

function readCachedActiveStoryId(projectId: number | null): number | null {
  if (projectId === null || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(activeStoryStorageKey(projectId));
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function resolveActiveProjectId(
  previousProjectId: number | null,
  projects: ProjectIdentity[],
  serverDefaultProjectId: number | null,
): number | null {
  if (
    previousProjectId !== null &&
    projects.some((project) => project.id === previousProjectId)
  ) {
    return previousProjectId;
  }
  if (serverDefaultProjectId !== null) return serverDefaultProjectId;
  return projects[0]?.id ?? null;
}

function readCachedProjectId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROJECT_ID_STORAGE_KEY);
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function useProjectData() {
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  // 当前故事（单一真相源，U4）。Story 页与 Creation 页共享。
  const [activeStoryId, setActiveStoryIdState] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const uploadRefMut = trpc.reference.upload.useMutation();
  const updateRefMut = trpc.reference.update.useMutation();

  const defaultProjectQuery = trpc.project.getOrCreateDefault.useQuery();
  const projectListQuery = trpc.project.list.useQuery();
  const refsQuery = trpc.reference.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  // 镜头按当前故事取（U5）。enabled 要求 activeStoryId 非空——无当前故事时落空状态，不串故事。
  const shotsQuery = trpc.shot.list.useQuery(
    { storyId: activeStoryId! },
    { enabled: activeStoryId !== null },
  );

  // 设置当前故事并按 project 分槽持久化；切 project 时重新读取对应槽（避免串项目）。
  const setActiveStoryId = useCallback(
    (storyId: number | null) => {
      setActiveStoryIdState(storyId);
      if (currentProjectId === null || typeof window === 'undefined') return;
      try {
        const key = activeStoryStorageKey(currentProjectId);
        if (storyId === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(storyId));
      } catch {
        // ignore storage errors
      }
    },
    [currentProjectId],
  );

  // 切 project：从该 project 的分槽恢复 activeStoryId（无则 null）。
  useEffect(() => {
    setActiveStoryIdState(readCachedActiveStoryId(currentProjectId));
  }, [currentProjectId]);

  useEffect(() => {
    const projects = projectListQuery.data ?? [];
    const serverDefaultProjectId = defaultProjectQuery.data?.id ?? null;
    if (serverDefaultProjectId === null && projects.length === 0) return;

    setCurrentProjectId((prev) =>
      resolveActiveProjectId(prev, projects, serverDefaultProjectId),
    );

    if (
      serverDefaultProjectId !== null &&
      projectListQuery.data !== undefined &&
      !projects.some((project) => project.id === serverDefaultProjectId)
    ) {
      utils.project.list.invalidate();
    }
  }, [defaultProjectQuery.data?.id, projectListQuery.data, utils.project.list]);

  useEffect(() => {
    if (!defaultProjectQuery.isError || projectListQuery.isLoading) return;
    const projects = projectListQuery.data ?? [];
    const cachedProjectId = readCachedProjectId();
    setCurrentProjectId((prev) => {
      if (prev !== null && projects.some((project) => project.id === prev)) {
        return prev;
      }
      if (
        cachedProjectId !== null &&
        projects.some((project) => project.id === cachedProjectId)
      ) {
        return cachedProjectId;
      }
      return projects[0]?.id ?? null;
    });
  }, [defaultProjectQuery.isError, projectListQuery.data, projectListQuery.isLoading]);

  useEffect(() => {
    if (currentProjectId === null) return;
    try {
      window.localStorage.setItem(PROJECT_ID_STORAGE_KEY, String(currentProjectId));
    } catch {
      // ignore storage errors
    }
  }, [currentProjectId]);

  const shots = shotsQuery.data ?? [];
  const references = refsQuery.data ?? [];
  const projects = projectListQuery.data ?? [];

  const handleUploadFile = useCallback(
    async (data: {
      projectId: number;
      fileName: string;
      mimeType: string;
      fileBase64: string;
      sourceType: 'image' | 'video' | 'script' | 'storyboard' | 'brief' | 'note' | 'pdf';
    }) => {
      await uploadRefMut.mutateAsync(data);
    },
    [uploadRefMut],
  );

  const refreshRefs = useCallback(
    (projectId: number) => {
      utils.reference.list.invalidate({ projectId });
    },
    [utils.reference.list],
  );

  const handlePinRef = useCallback(
    async (ref: BackendReference) => {
      try {
        await updateRefMut.mutateAsync({ id: ref.id, pinned: !ref.pinned });
        if (currentProjectId) utils.reference.list.invalidate({ projectId: currentProjectId });
        toast.success(ref.pinned ? 'Unpinned' : 'Pinned');
      } catch {
        toast.error('操作失败');
      }
    },
    [updateRefMut, currentProjectId, utils.reference.list],
  );

  const handleExcludeRef = useCallback(
    async (ref: BackendReference) => {
      try {
        await updateRefMut.mutateAsync({ id: ref.id, excluded: true });
        if (currentProjectId) utils.reference.list.invalidate({ projectId: currentProjectId });
        toast.success('已排除');
      } catch {
        toast.error('操作失败');
      }
    },
    [updateRefMut, currentProjectId, utils.reference.list],
  );

  return {
    currentProjectId,
    setCurrentProjectId,
    activeStoryId,
    setActiveStoryId,
    projects,
    references,
    shots,
    refsQuery,
    shotsQuery,
    utils,
    handleUploadFile,
    refreshRefs,
    handlePinRef,
    handleExcludeRef,
  };
}
