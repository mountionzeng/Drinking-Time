/**
 * Creation Agent types — shared between Context, Chat UI, and Shot Table.
 */

export const CREATION_GREETING =
  "欢迎来到创作引擎！选择一个镜头，我们来讨论它的画面。或者直接告诉我你想从哪里开始。";

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
