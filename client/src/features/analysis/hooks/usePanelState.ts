import { useEffect, useState } from 'react';
import type { ShotStage } from '../views/ShotStageIllustration';
import type { InputTab } from '../views/WorkspaceLayout';
import { ANALYSIS_STAGE_SEQUENCE } from '../config/stageCopy';

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
    () => readLocalStorage<InputTab>('dt:activeInputTab:v2', 'story'),
  );

  // Persist activeInputTab
  useEffect(() => {
    localStorage.setItem('dt:activeInputTab:v2', JSON.stringify(activeInputTab));
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
  };
}
