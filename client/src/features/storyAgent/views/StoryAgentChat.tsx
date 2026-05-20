/**
 * StoryAgentChat — Conversational guide that surfaces specific, sensory
 * memories and condenses them into story cards.
 *
 * Sits in the DROP ZONE slot of the analysis page.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, RefreshCcw, Loader2, ChevronLeft, X, Quote } from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useNayin } from '@/features/nayin/NayinContext';
import WuxingDrinkIcon from '@/features/nayin/views/WuxingDrinkIcon';

export default function StoryAgentChat() {
  const {
    messages, cards, isReplying, sendMessage, resetConversation, backToList,
    activeSelection, clearSelection, sendSelectionEdit,
  } = useStoryAgent();
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
    if (activeSelection) {
      await sendSelectionEdit(text);
    } else {
      await sendMessage(text);
    }
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
                {m.selectionQuote && (
                  <div
                    className="mb-1.5 rounded px-2 py-1 border-l-2 text-[10px] text-foreground/60"
                    style={{ borderLeftColor: 'var(--background)', background: 'rgba(255,255,255,0.1)' }}
                  >
                    <SelectionSourceLabel selection={m.selectionQuote} cards={cards} />
                    {' · '}
                    {m.selectionQuote.selectedText.length > 30
                      ? m.selectionQuote.selectedText.slice(0, 30) + '…'
                      : m.selectionQuote.selectedText}
                  </div>
                )}
                <p className="whitespace-pre-wrap" data-selection-source={`chat:${m.id}`}>{m.content}</p>
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
        className="border-t px-3 pb-3 flex flex-col gap-2"
        style={{ borderColor: 'var(--panel-border)' }}
      >
        {/* Quote block */}
        {activeSelection && (
          <div
            className="mt-2.5 flex items-start gap-2 rounded-lg px-2.5 py-2 border-l-2 text-[11px]"
            style={{
              borderLeftColor: 'var(--nayin-accent)',
              background: 'var(--nayin-glow)',
            }}
          >
            <Quote className="w-3 h-3 shrink-0 mt-0.5 text-nayin-bright" />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
                <SelectionSourceLabel selection={activeSelection} cards={cards} />
              </div>
              <p className="text-foreground/80 leading-relaxed truncate">
                {activeSelection.selectedText.length > 50
                  ? activeSelection.selectedText.slice(0, 50) + '…'
                  : activeSelection.selectedText}
              </p>
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center hover:bg-foreground/10 transition-colors"
              aria-label="取消选中"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        )}

        <div className={`flex items-end gap-2 ${!activeSelection ? 'pt-2.5' : ''}`}>
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
    </div>
  );
}

function SelectionSourceLabel({
  selection,
  cards,
}: {
  selection: { sourceType: string; sourceId: string };
  cards: Array<{ id: string }>;
}) {
  switch (selection.sourceType) {
    case 'card': {
      const idx = cards.findIndex((c) => c.id === selection.sourceId);
      return <>{idx >= 0 ? `卡片 ${idx + 1}` : '卡片'}</>;
    }
    case 'script-scene':
      return <>场景 {Number(selection.sourceId) + 1}</>;
    case 'script-meta': {
      const labels: Record<string, string> = { title: '标题', logline: 'Logline', arcSummary: '情感弧线' };
      return <>{labels[selection.sourceId] || '剧本'}</>;
    }
    case 'shot': {
      const parts = selection.sourceId.split(':');
      const fieldLabels: Record<string, string> = { subject: '主体', action: '动作', dialogue: '台词' };
      return <>镜头 {Number(parts[0]) + 1} · {fieldLabels[parts[1]] || parts[1]}</>;
    }
    case 'chat':
      return <>小酌回复</>;
    default:
      return <>选中</>;
  }
}
