import { useCallback, useEffect, useMemo } from 'react';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import type { useProjectData } from './useProjectData';

/**
 * 用途：编排分析的运行与完成，并在完成后只失效当前 Story 的镜头缓存。
 * 调用入口：client/src/features/analysis/views/AnalysisWorkspace.tsx，
 *   直接把 `useProjectData()` 的返回值整体传进来。
 * 下游调用：trpc `analysis.get` / `analysis.run`；
 *   `utils.shot.list.invalidate({ storyId })`、
 *   `utils.analysis.get.invalidate({ projectId })`。
 *
 * `activeStoryId` 必须取自 `useProjectData`（`shotsQuery` 就是用它做 query key
 * 的），不要改成从 spine store 直接读——那是另一份副本，会和查询 key 不同源，
 * 失效会静默落空。
 */
export function useAnalysisOrchestration(
  projectData: Pick<
    ReturnType<typeof useProjectData>,
    'currentProjectId' | 'activeStoryId' | 'shots' | 'utils'
  >,
) {
  const { currentProjectId, activeStoryId, shots, utils } = projectData;

  const [analysisActive, setAnalysisActive] = useState(false);

  const analysisQuery = trpc.analysis.get.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  const analysisRunMut = trpc.analysis.run.useMutation();

  // Reset on project change
  useEffect(() => {
    setAnalysisActive(false);
  }, [currentProjectId]);

  // Activate when data arrives
  useEffect(() => {
    if (analysisQuery.data || shots.length > 0) {
      setAnalysisActive(true);
    }
  }, [analysisQuery.data, shots.length]);

  const renderedLikeCount = useMemo(
    () => shots.filter((s) => ['production_ready', 'queued', 'rendered'].includes(s.status)).length,
    [shots],
  );

  const onTimeRate = useMemo(() => {
    if (!shots.length) return 0;
    return Math.round((renderedLikeCount / shots.length) * 100);
  }, [renderedLikeCount, shots.length]);

  const handleAnalysisComplete = useCallback(() => {
    setAnalysisActive(true);
    if (!currentProjectId) return;
    // 只失效当前 Story 的镜头缓存；不带参数会连别的 Story 一起清掉。
    if (activeStoryId !== null) {
      utils.shot.list.invalidate({ storyId: activeStoryId });
    }
    utils.analysis.get.invalidate({ projectId: currentProjectId });
  }, [currentProjectId, activeStoryId, utils.analysis.get, utils.shot.list]);

  const handleRunAnalysis = useCallback(async () => {
    if (!currentProjectId) return;
    const result = await analysisRunMut.mutateAsync({ projectId: currentProjectId });
    if ('error' in result && result.error) return;
    handleAnalysisComplete();
  }, [analysisRunMut, currentProjectId, handleAnalysisComplete]);

  return {
    analysisActive,
    analysisQuery,
    analysisRunMut,
    handleRunAnalysis,
    handleAnalysisComplete,
    onTimeRate,
  };
}
