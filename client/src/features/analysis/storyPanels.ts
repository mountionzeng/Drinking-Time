export type StoryPanel =
  | "materialWarehouse"
  | "storyCards"
  | "storyboard"
  | "animatic"
  | "promptTable";

export const STORY_PANELS: Array<{ id: StoryPanel; label: string }> = [
  { id: "materialWarehouse", label: "素材仓库" },
  { id: "storyboard", label: "故事版看板" },
  { id: "animatic", label: "动态分镜" },
  { id: "promptTable", label: "镜头设计表" },
  { id: "storyCards", label: "故事卡片" },
];
