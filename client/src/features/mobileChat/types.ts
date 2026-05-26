/**
 * 手机端聊天出图体验的类型定义。
 * 复用 storyAgent 的基础类型，新增图片相关类型。
 */

// 聊天消息类型（扩展，支持图片）
export type MobileChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  // 用户附带的照片 URL（上传后的远程地址）
  photoUrl?: string;
  // 图片相关字段（assistant 消息才有）
  suggestImage?: boolean;           // 小酌是否建议出图
  imagePrompt?: string;             // 图片生成 prompt
  imageShotNo?: number;             // 对应的镜头编号
};

// 生成的图片
export type GeneratedImageItem = {
  id: number;
  imageUrl: string;
  prompt: string;
  shotNo?: number;
  storyId: number;
  status: "generating" | "ready" | "error";
  // 关联的聊天消息 id
  messageId?: string;
};

// 手机端 tab 类型
export type MobileTab = "chat" | "storyboard";

// 故事版场景（台词+图片）
export type StoryboardScene = {
  shotNo: number;
  dialogue: string;
  subject: string;
  mood: string;
  imageUrl?: string;
  imageId?: number;
};
