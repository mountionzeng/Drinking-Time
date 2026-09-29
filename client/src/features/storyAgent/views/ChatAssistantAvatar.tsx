/**
 * ChatAssistantAvatar — 「聊聊」回复气泡左边的那个头像。
 *
 * 按主题分：
 * - 拾光家忆：小忆水彩小鸟（和浏览器页签、手机端同一个形象）。
 * - 纳音五行：复用 EmotiveWuxingIcon，跟着当天五行变色、随情绪做表情。
 *
 * 注意和 2026-09-15 那次「去掉重复的助手头像」不是一回事：当时去掉的是
 * **气泡内部**的头像 + 「聊聊」署名（面板抬头已经有了，画两遍吵）。
 * 这里是气泡**外侧**的对话头像，标准聊天布局，不进气泡。
 */
import React from "react";
import EmotiveWuxingIcon, {
  type WuxingMood,
} from "@/features/nayin/views/EmotiveWuxingIcon";
import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";

export const CHAT_AVATAR_SIZE = 28;

type ChatAssistantAvatarProps = {
  visualTheme: VisualThemeMode;
  element: NayinElement;
  /** 故事卡片的 emotion 文本，交给 EmotiveWuxingIcon 自己归类 */
  emotion?: string | null;
  /** 直接指定姿势（等回信时用 thinking），优先于 emotion */
  mood?: WuxingMood;
  animated?: boolean;
};

export default function ChatAssistantAvatar({
  visualTheme,
  element,
  emotion,
  mood,
  animated = false,
}: ChatAssistantAvatarProps) {
  return (
    <span
      className="chat-assistant-avatar"
      data-testid="chat-assistant-avatar"
      aria-hidden="true"
    >
      {visualTheme === "shiguang" ? (
        <img src="/shiguang/xiaoyi-avatar.png" alt="" />
      ) : (
        <EmotiveWuxingIcon
          element={element}
          size={CHAT_AVATAR_SIZE}
          mood={mood}
          emotion={emotion}
          animated={animated}
        />
      )}
    </span>
  );
}
