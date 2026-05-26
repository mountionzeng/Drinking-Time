/**
 * MobileChatPage — 手机端聊天页主组件。
 * 消息列表 + 输入框。从 MobileChatContext 读取状态。
 */
import { useState, useRef, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { useMobileChat } from "../MobileChatContext";
import MobileChatMessages from "./MobileChatMessages";

export default function MobileChatPage() {
  const {
    messages,
    images,
    isReplying,
    isGenerating,
    sendMessage,
    confirmGenerate,
    swipeRight,
    swipeLeft,
  } = useMobileChat();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isReplying) return;
    setInput("");
    await sendMessage(text);
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题 */}
      <header className="flex items-center justify-center border-b bg-white/80 px-4 py-3 backdrop-blur-sm">
        <h1 className="text-sm font-medium text-gray-700">小酌</h1>
      </header>

      {/* 消息列表 */}
      <MobileChatMessages
        messages={messages}
        images={images}
        isReplying={isReplying}
        isGenerating={isGenerating}
        onConfirmGenerate={confirmGenerate}
        onSwipeRight={swipeRight}
        onSwipeLeft={swipeLeft}
      />

      {/* 输入区域 */}
      <div
        className="border-t bg-white px-3 py-2"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="说点什么…"
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-amber-300 focus:bg-white"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isReplying}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-700 text-white transition-opacity disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
