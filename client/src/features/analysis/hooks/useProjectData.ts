import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { BackendReference } from '@/features/analysis/types';

export function useProjectData() {
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const uploadRefMut = trpc.reference.upload.useMutation();
  const updateRefMut = trpc.reference.update.useMutation();

  const projectListQuery = trpc.project.list.useQuery();
  const refsQuery = trpc.reference.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  const shotsQuery = trpc.shot.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );

  const createProjectMut = trpc.project.create.useMutation();

  // Auto-select or auto-create project
  useEffect(() => {
    if (projectListQuery.isLoading) return;

    const projects = projectListQuery.data ?? [];
    if (projects.length > 0) {
      setCurrentProjectId((prev) => {
        if (prev && projects.some((p) => p.id === prev)) return prev;
        return projects[0].id;
      });
      return;
    }

    if (createProjectMut.isPending) return;

    createProjectMut.mutate(
      { name: 'New Analysis Project' },
      {
        onSuccess: (result) => {
          setCurrentProjectId(result.id);
          utils.project.list.invalidate();
        },
      },
    );
  }, [
    createProjectMut,
    projectListQuery.data,
    projectListQuery.isLoading,
    utils.project.list,
  ]);

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
