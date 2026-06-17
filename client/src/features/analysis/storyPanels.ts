export type StoryPanel = 'storyCards' | 'script' | 'animatic' | 'promptTable';

export const STORY_PANELS: Array<{ id: StoryPanel; label: string }> = [
  { id: 'storyCards', label: 'Story Cards' },
  { id: 'script', label: 'Script' },
  { id: 'animatic', label: '动态分镜' },
  { id: 'promptTable', label: '提示词表' },
];
