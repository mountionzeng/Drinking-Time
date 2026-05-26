/**
 * MobileChatMessages — 手机端消息列表。
 * props-in, UI-out。显示聊天气泡，assistant 消息可能带出图建议按钮。
 */
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { MobileChatMessage, GeneratedImageItem } from "../types";
import ImageCard from "./ImageCard";

interface Props {
  messages: MobileChatMessage[];
  images: GeneratedImageItem[];
  isReplying: boolean;
  isGenerating: boolean;
  onConfirmGenerate: (messageId: string) => void;
  onSwipeRight?: (imageId: number) => void;
  onSwipeLeft?: (imageId: number) => void;
  onLongPress?: (imageId: number) => void;
}

export default function MobileChatMessages({
  messages,
  images,
  isReplying,
  isGenerating,
  onConfirmGenerate,
  onSwipeRight,
  onSwipeLeft,
  onLongPress,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isReplying, images]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      <AnimatePresence initial={false}>
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          // 这条消息是否已经生成了图片
          const linkedImage = images.find(
            (img) => img.messageId === msg.id && img.status !== "error"
          );
          const isImageGenerating = images.some(
            (img) => img.messageId === msg.id && img.status === "generating"
          );

          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isUser
                    ? "bg-amber-700 text-white rounded-br-md"
                    : "bg-white text-gray-800 shadow-sm rounded-bl-md"
                }`}
              >
                {/* 消息文字 */}
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {/* 出图建议按钮（仅 assistant、有 imagePrompt、还没生成） */}
                {!isUser && msg.suggestImage && msg.imagePrompt && !linkedImage && !isImageGenerating && (
                  <button
                    onClick={() => onConfirmGenerate(msg.id)}
                    disabled={isGenerating}
                    className="mt-2 flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "🎨"
                    )}
                    好，帮我画
                  </button>
                )}

                {/* 图片生成中 */}
                {isImageGenerating && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    画面正在生成…
                  </div>
                )}

                {/* 已生成的图片：可滑动卡片 */}
                {linkedImage && linkedImage.status === "ready" && (
                  <div className="mt-2">
                    <ImageCard
                      image={linkedImage}
                      onSwipeRight={(id) => onSwipeRight?.(id)}
                      onSwipeLeft={(id) => onSwipeLeft?.(id)}
                      onLongPress={(id) => onLongPress?.(id)}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* 正在回复的打字指示器 */}
      {isReplying && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex justify-start"
        >
          <div className="rounded-2xl rounded-bl-md bg-white px-4 py-2.5 shadow-sm">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-300" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
