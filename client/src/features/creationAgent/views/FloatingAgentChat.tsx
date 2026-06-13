/**
 * FloatingAgentChat — 悬浮头像 + 可展开横向对话框
 *
 * 平时收成一个小酌头像；点击展开为横向浮动面板。
 * 创作页专用，不含粘性开场（报到/回归问候只属于故事页）。
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, X, Check, Undo2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCreationAgent } from '../CreationAgentContext';
import { CREATION_GOALS, goalLabel, type CreationGoal } from '@shared/creationGoal';
import type { ShotContext } from '../types';

interface FloatingAgentChatProps {
  shots?: ShotContext[];
  cards?: Array<{ content: string; emotion?: string }>;
  currentScript?: string;
  projectId?: number | null;
  /** 用户确认应用小酌建议的 prompt 修改 */
  onApplyPromptUpdate?: (shotNo: string, promptDraft: string) => void;
}

export default function FloatingAgentChat({
  shots,
  cards,
  currentScript,
  projectId,
  onApplyPromptUpdate,
}: FloatingAgentChatProps) {
  const {
    messages,
    focusShotNo,
    isReplying,
    pendingPromptUpdate,
    clearPendingPromptUpdate,
    sendMessage,
    goal,
    setGoal,
  } = useCreationAgent();

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 展开时自动滚到底部
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // 展开时自动聚焦输入
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  useEffect(() => {
    const openChat = () => setIsOpen(true);
    window.addEventListener('dt:open-creation-chat', openChat);
    return () => window.removeEventListener('dt:open-creation-chat', openChat);
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isReplying) return;
    setInput('');
    await sendMessage(text, shots, cards, currentScript);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* 悬浮头像 */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 left-6 z-50 h-10 rounded-md bg-primary px-3 text-primary-foreground shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
            aria-label="展开小酌对话"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="text-sm font-medium">小酌</span>
            {isReplying && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 展开后的横向悬浮面板 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: -20, opacity: 0, scale: 0.95 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: -20, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 left-6 z-50 w-[420px] max-w-[calc(100vw-3rem)] max-h-[480px] rounded-2xl border bg-popover shadow-2xl flex flex-col overflow-hidden"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  酌
                </span>
                <span className="text-sm font-medium">小酌</span>
                {focusShotNo && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    焦点: {focusShotNo}
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="收起对话"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 消息区 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-1.5 text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {/* 生成图 */}
                    {msg.generatedImage && (
                      <div className="mt-1.5 rounded-lg overflow-hidden border">
                        <img
                          src={msg.generatedImage.imageUrl}
                          alt={`${msg.generatedImage.shotNo} 生成图`}
                          className="w-full max-h-40 object-cover"
                        />
                        <div className="px-2 py-0.5 text-[10px] text-muted-foreground bg-background">
                          {msg.generatedImage.shotNo} 生成图
                        </div>
                      </div>
                    )}
                    {/* 提示词修改建议 */}
                    {msg.promptUpdate && (
                      <div className="mt-1.5 p-2 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30">
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 mb-1">
                          建议修改 {msg.promptUpdate.shotNo} 的提示词：
                        </p>
                        <p className="text-[11px] text-foreground/80 line-clamp-3">
                          {msg.promptUpdate.promptDraft}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isReplying && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    思考中...
                  </div>
                </div>
              )}
            </div>

            {/* 待确认的提示词修改 */}
            {pendingPromptUpdate && (
              <div className="px-3 py-2 border-t bg-amber-50/50 dark:bg-amber-950/20 flex items-center gap-2">
                <span className="text-[11px] text-amber-700 dark:text-amber-300 flex-1">
                  小酌建议修改 {pendingPromptUpdate.shotNo} 的提示词
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1"
                  onClick={() => {
                    if (onApplyPromptUpdate) {
                      onApplyPromptUpdate(
                        pendingPromptUpdate.shotNo,
                        pendingPromptUpdate.promptDraft,
                      );
                    }
                    clearPendingPromptUpdate();
                  }}
                >
                  <Check className="w-3 h-3" />
                  采纳
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1"
                  onClick={clearPendingPromptUpdate}
                >
                  <Undo2 className="w-3 h-3" />
                  忽略
                </Button>
              </div>
            )}

            {/* 输入区 */}
            <div className="border-t p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>我在做</span>
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value as CreationGoal)}
                  disabled={isReplying}
                  aria-label="选择创作目标"
                  className="h-7 rounded-md border bg-background px-2 text-[11px] text-foreground outline-none transition disabled:opacity-50"
                >
                  {CREATION_GOALS.map((g) => (
                    <option key={g} value={g}>
                      {goalLabel(g)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1.5 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="分析画面，或直接说想怎么改..."
                  className="flex-1 resize-none rounded-lg border bg-background px-2.5 py-1.5 text-[13px] min-h-[36px] max-h-[80px] focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={1}
                  disabled={isReplying}
                />
                <Button
                  size="icon"
                  variant="default"
                  onClick={handleSend}
                  disabled={!input.trim() || isReplying}
                  className="shrink-0 h-8 w-8"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
