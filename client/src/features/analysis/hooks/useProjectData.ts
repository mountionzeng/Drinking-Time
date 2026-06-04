import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { BackendReference } from '@/features/analysis/types';

const PROJECT_ID_STORAGE_KEY = 'dt:currentProjectId';

type ProjectIdentity = { id: number };

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

  const utils = trpc.useUtils();
  const uploadRefMut = trpc.reference.upload.useMutation();
  const updateRefMut = trpc.reference.update.useMutation();

  const defaultProjectQuery = trpc.project.getOrCreateDefault.useQuery();
  const projectListQuery = trpc.project.list.useQuery();
  const refsQuery = trpc.reference.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  const shotsQuery = trpc.shot.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );

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
