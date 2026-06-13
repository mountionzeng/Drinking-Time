import { useCallback, useEffect, useMemo } from 'react';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import type { useProjectData } from './useProjectData';

export function useAnalysisOrchestration(
  projectData: Pick<ReturnType<typeof useProjectData>, 'currentProjectId' | 'shots' | 'utils'>,
) {
  const { currentProjectId, shots, utils } = projectData;

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
    utils.shot.list.invalidate(); // 镜头按 storyId 后无差别失效活跃查询（U5）
    utils.analysis.get.invalidate({ projectId: currentProjectId });
  }, [currentProjectId, utils.analysis.get, utils.shot.list]);

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
