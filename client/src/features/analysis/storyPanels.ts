export type StoryPanel = 'storyboard' | 'animatic' | 'promptTable';

export const STORY_PANELS: Array<{ id: StoryPanel; label: string }> = [
  { id: 'storyboard', label: '故事版看板' },
  { id: 'animatic', label: '动态分镜' },
  { id: 'promptTable', label: '镜头设计表' },
];
