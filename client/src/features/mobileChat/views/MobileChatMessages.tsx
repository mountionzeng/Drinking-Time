/**
 * MobileChatMessages — 手机端消息列表。
 * props-in, UI-out。显示聊天气泡，assistant 消息可能带出图建议按钮。
 */
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { MobileChatMessage, GeneratedImageItem } from "../types";
import ImageCard from "./ImageCard";
import ResilientImg from "./ResilientImg";

interface Props {
  messages: MobileChatMessage[];
  images: GeneratedImageItem[];
  isReplying: boolean;
  onSwipeRight?: (imageId: number) => void;
  onSwipeLeft?: (imageId: number) => void;
  onLongPress?: (imageId: number) => void;
}

export default function MobileChatMessages({
  messages,
  images,
  isReplying,
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
    <div ref={scrollRef} className="dtm-message-stream">
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
              className={`dtm-bubble-wrap ${
                isUser ? "dtm-bubble-wrap--user" : "dtm-bubble-wrap--assistant"
              }`}
            >
              <div
                className={`dtm-bubble ${
                  isUser
                    ? "dtm-bubble--user"
                    : "dtm-bubble--assistant"
                }`}
              >
                {/* 用户附带的照片 */}
                {isUser && msg.photoUrl && (
                  <ResilientImg
                    src={msg.photoUrl}
                    alt="用户照片"
                    className="dtm-user-photo"
                  />
                )}

                {/* 消息文字 */}
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {/* 图片生成中 */}
                {isImageGenerating && (
                  <div className="dtm-generating-note">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    工坊里的火正烧着…
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
          className="dtm-bubble-wrap dtm-bubble-wrap--assistant"
        >
          <div className="dtm-bubble dtm-bubble--assistant">
            <div className="dtm-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
