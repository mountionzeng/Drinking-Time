import { useEffect, useState } from 'react';
import type { ShotStage } from '../views/ShotStageIllustration';
import type { InputTab } from '../views/WorkspaceLayout';
import { ANALYSIS_STAGE_SEQUENCE } from '../config/stageCopy';
import type { StoryPanel } from '../storyPanels';

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function usePanelState() {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState<ShotStage>('idea_pool');
  const [activeInputTab, setActiveInputTab] = useState<InputTab>(
    () => readLocalStorage<InputTab>('dt:activeInputTab', 'material'),
  );
  const [visibleStoryPanels, setVisibleStoryPanels] = useState<StoryPanel[]>([]);
  const [workspaceStageSticky, setWorkspaceStageSticky] = useState(false);

  const toggleStoryPanel = (panelId: StoryPanel) => {
    setVisibleStoryPanels((current) =>
      current.includes(panelId)
        ? current.filter((id) => id !== panelId)
        : [...current, panelId],
    );
  };

  // Persist activeInputTab
  useEffect(() => {
    localStorage.setItem('dt:activeInputTab', JSON.stringify(activeInputTab));
  }, [activeInputTab]);

  // Escape key closes timeline
  useEffect(() => {
    if (!timelineOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTimelineOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [timelineOpen]);

  return {
    timelineOpen,
    setTimelineOpen,
    selectedStage,
    setSelectedStage,
    activeInputTab,
    setActiveInputTab,
    visibleStoryPanels,
    toggleStoryPanel,
    workspaceStageSticky,
    setWorkspaceStageSticky,
  };
}
