/**
 * StoryAgentChat — Conversational guide that surfaces specific, sensory
 * memories and condenses them into story cards.
 *
 * Sits in the DROP ZONE slot of the analysis page.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, RefreshCcw, Loader2, ChevronLeft } from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useNayin } from '@/features/nayin/NayinContext';
import WuxingDrinkIcon from '@/features/nayin/views/WuxingDrinkIcon';

export default function StoryAgentChat() {
  const { messages, cards, isReplying, sendMessage, resetConversation, backToList } =
    useStoryAgent();
  const { element } = useNayin();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isReplying]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isReplying) return;
    setInput('');
    await sendMessage(text);
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <button
          type="button"
          onClick={backToList}
          className="flex items-center gap-0.5 text-[10px] opacity-60 hover:opacity-100 transition-opacity mr-1"
          title="返回列表"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="status-dot" />
        <span>Drop Zone Agent</span>
        <span className="ml-auto flex items-center gap-2">
          {cards.length > 0 && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={{
                background: 'var(--nayin-glow)',
                color: 'var(--nayin-accent-bright)',
              }}
            >
              {cards.length} 张卡片
            </span>
          )}
          <button
            type="button"
            onClick={resetConversation}
            className="text-[10px] opacity-50 hover:opacity-100 transition-opacity flex items-center gap-1"
            title="重新开始"
          >
            <RefreshCcw className="w-3 h-3" />
            重来
          </button>
        </span>
      </div>

      <div
        ref={scrollRef}
        className="monitor-panel-body flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1"
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-tr-sm'
                    : 'rounded-tl-sm border'
                }`}
                style={
                  m.role === 'user'
                    ? {
                        background: 'var(--nayin-accent)',
                        color: 'var(--background)',
                        boxShadow: '0 1px 8px -2px var(--nayin-glow)',
                      }
                    : {
                        background: 'var(--card)',
                        borderColor: 'var(--panel-border)',
                        color: 'var(--foreground)',
                      }
                }
              >
                {m.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-1 opacity-70">
                    <WuxingDrinkIcon element={element} size={18} />
                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      小酌
                    </span>
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.spawnedCardId && (
                  <div className="mt-2 pt-2 border-t flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider"
                       style={{ borderColor: 'var(--panel-border)' }}>
                    <Sparkles className="w-3 h-3 text-nayin-bright" />
                    <span className="text-nayin-bright">+ 1 张卡片入册</span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isReplying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div
              className="rounded-2xl rounded-tl-sm px-3 py-2 border flex items-center gap-2"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--panel-border)',
              }}
            >
              <WuxingDrinkIcon element={element} size={18} />
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse"
                  style={{ animationDelay: '0.15s' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse"
                  style={{ animationDelay: '0.3s' }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div
        className="border-t pt-2.5 px-3 pb-3 flex items-end gap-2"
        style={{ borderColor: 'var(--panel-border)' }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // auto-resize
            const ta = e.currentTarget;
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
          }}
          onKeyDown={handleKey}
          placeholder="慢慢说，越具体越好…"
          disabled={isReplying}
          className="flex-1 resize-none rounded-lg border px-3 py-2 text-xs leading-relaxed bg-transparent focus:outline-none focus:ring-2 transition-shadow disabled:opacity-60"
          style={{
            borderColor: 'var(--panel-border)',
            // @ts-expect-error custom prop for tailwind ring color via inline style
            '--tw-ring-color': 'var(--nayin-accent)',
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim() || isReplying}
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-nayin"
          style={{
            background: 'var(--nayin-accent)',
            color: 'var(--background)',
            boxShadow: '0 2px 12px -4px var(--nayin-glow)',
          }}
          aria-label="发送"
        >
          {isReplying ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
