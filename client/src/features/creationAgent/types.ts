/**
 * Creation Agent types — shared between Context, Chat UI, and Shot Table.
 */

// 创作页开场：小酌同人格，但不含粘性开场（报到/回归问候只属于故事页）。
// 简洁邀请，不冒出「你好，我是小酌」「我还记得上次……」。
export const CREATION_GREETING =
  "选个镜头聊聊画面，或者直接告诉我你想从哪里开始。";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** Image generated as part of this message */
  generatedImage?: {
    imageUrl: string;
    imageKey: string;
    shotNo: string;
    imageId: number;
  } | null;
  /** 小酌建议的提示词修改 */
  promptUpdate?: {
    shotNo: string;
    promptDraft: string;
  } | null;
};

export type ShotImage = {
  id: number;
  projectId: number;
  shotNo: string;
  imageKey: string;
  imageUrl: string;
  prompt: string;
  parentImageId: number | null;
  isCurrent: boolean;
  generationType: "generate" | "inpaint";
  maskKey: string | null;
  createdAt: string | Date;
};

export type ShotContext = {
  shotNo: string;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  mood: string;
  promptDraft?: string;
};
