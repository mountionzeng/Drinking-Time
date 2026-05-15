import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShotStage } from '@/components/ShotStageIllustration';
import { trpc } from '@/lib/trpc';
import { ANALYSIS_STAGE_SEQUENCE } from '@/features/analysis/config/stageCopy';

const INITIAL_PANEL_BOOT = [false, false, false] as const;

export function useAnalysisWorkspace() {
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [analysisActive, setAnalysisActive] = useState(false);
  const [panelsBooted, setPanelsBooted] = useState<boolean[]>([
    ...INITIAL_PANEL_BOOT,
  ]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState<ShotStage>('idea_pool');
  const [autoCycle, setAutoCycle] = useState(false);
  const [illustrationSize, setIllustrationSize] = useState(88);
  const [grain, setGrain] = useState(1);
  const [jitter, setJitter] = useState(0.8);

  const utils = trpc.useUtils();

  const projectListQuery = trpc.project.list.useQuery();
  const refsQuery = trpc.reference.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  const shotsQuery = trpc.shot.list.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );
  const analysisQuery = trpc.analysis.get.useQuery(
    { projectId: currentProjectId! },
    { enabled: currentProjectId !== null },
  );

  const createProjectMut = trpc.project.create.useMutation();
  const analysisRunMut = trpc.analysis.run.useMutation();

  useEffect(() => {
    if (projectListQuery.isLoading) return;

    const projects = projectListQuery.data ?? [];
    if (projects.length > 0) {
      setCurrentProjectId((prev) => {
        if (prev && projects.some((project) => project.id === prev)) {
          return prev;
        }
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

  useEffect(() => {
    setAnalysisActive(false);
  }, [currentProjectId]);

  useEffect(() => {
    if (analysisQuery.data || (shotsQuery.data?.length ?? 0) > 0) {
      setAnalysisActive(true);
    }
  }, [analysisQuery.data, shotsQuery.data]);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => {
        setPanelsBooted((prev) => {
          const next = [...prev];
          next[0] = true;
          return next;
        });
      }, 200),
      window.setTimeout(() => {
        setPanelsBooted((prev) => {
          const next = [...prev];
          next[1] = true;
          return next;
        });
      }, 400),
      window.setTimeout(() => {
        setPanelsBooted((prev) => {
          const next = [...prev];
          next[2] = true;
          return next;
        });
      }, 600),
    ];

    return () => timers.forEach(window.clearTimeout);
  }, []);

  useEffect(() => {
    if (!timelineOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTimelineOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [timelineOpen]);

  useEffect(() => {
    if (!autoCycle) return;

    const timer = window.setInterval(() => {
      setSelectedStage((previousStage) => {
        const currentIndex = ANALYSIS_STAGE_SEQUENCE.indexOf(previousStage);
        return ANALYSIS_STAGE_SEQUENCE[
          (currentIndex + 1) % ANALYSIS_STAGE_SEQUENCE.length
        ];
      });
    }, 3200);

    return () => window.clearInterval(timer);
  }, [autoCycle]);

  const shots = shotsQuery.data ?? [];
  const references = refsQuery.data ?? [];
  const projects = projectListQuery.data ?? [];

  const renderedLikeCount = useMemo(
    () =>
      shots.filter((shot) =>
        ['production_ready', 'queued', 'rendered'].includes(shot.status),
      ).length,
    [shots],
  );

  const onTimeRate = useMemo(() => {
    if (!shots.length) return 0;
    return Math.round((renderedLikeCount / shots.length) * 100);
  }, [renderedLikeCount, shots.length]);

  const handleAnalysisComplete = useCallback(() => {
    setAnalysisActive(true);

    if (!currentProjectId) return;

    utils.shot.list.invalidate({ projectId: currentProjectId });
    utils.analysis.get.invalidate({ projectId: currentProjectId });
  }, [currentProjectId, utils.analysis.get, utils.shot.list]);

  const handleRunAnalysis = useCallback(async () => {
    if (!currentProjectId) return;

    const result = await analysisRunMut.mutateAsync({
      projectId: currentProjectId,
    });

    if ('error' in result && result.error) {
      return;
    }

    handleAnalysisComplete();
  }, [analysisRunMut, currentProjectId, handleAnalysisComplete]);

  return {
    analysisActive,
    analysisQuery,
    analysisRunMut,
    autoCycle,
    currentProjectId,
    grain,
    handleAnalysisComplete,
    handleRunAnalysis,
    illustrationSize,
    jitter,
    onTimeRate,
    panelsBooted,
    profileOpen,
    projectListQuery,
    projects,
    references,
    refsQuery,
    selectedStage,
    setAutoCycle,
    setCurrentProjectId,
    setGrain,
    setIllustrationSize,
    setJitter,
    setProfileOpen,
    setSelectedStage,
    setTimelineOpen,
    shots,
    shotsQuery,
    timelineOpen,
  };
}
