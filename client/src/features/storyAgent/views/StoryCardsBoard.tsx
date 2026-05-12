/**
 * StoryCardsBoard — Reorderable list of memory cards harvested from the
 * story-guide chat. The order matters: each ordering produces a different
 * generated script.
 *
 * Sits in the TEMPLATE DRAFT slot of the analysis page.
 */
import { useMemo, useRef } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { GripVertical, X, Sparkles, FlaskConical, Loader2, ScrollText } from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useNayin } from '@/features/nayin/NayinContext';
import type { StoryCard } from '@/features/storyAgent/types';
import type { NayinElement } from '@/features/nayin/nayin';

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: '先开瓶啤酒，跟小酌聊聊一句让你记住的话',
  wood: '泡上一壶龙井，慢慢回忆那个让你停下来的瞬间',
  water: '剥一颗椰子，把那个画面跟小酌讲讲',
  fire: '冲一泡大红袍，让小酌带你回到那一刻',
  earth: '研一杯咖啡，跟小酌聊一段你忘不掉的事',
};

function emotionAccent(emotion: string): string {
  // Hash-derived hue from the emotion string so similar emotions cluster.
  let h = 0;
  for (let i = 0; i < emotion.length; i++) h = (h * 31 + emotion.charCodeAt(i)) % 360;
  return `oklch(0.92 0.04 ${h})`;
}

function CardItem({
  card,
  index,
  onRemove,
}: {
  card: StoryCard;
  index: number;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const tint = emotionAccent(card.emotion);

  return (
    <Reorder.Item
      value={card}
      dragListener={false}
      dragControls={controls}
      className="select-none"
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 12px 40px -12px var(--nayin-glow)',
        zIndex: 10,
      }}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="rounded-lg border p-3 group relative"
        style={{
          background: `linear-gradient(135deg, ${tint} 0%, var(--card) 70%)`,
          borderColor: 'var(--panel-border)',
        }}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <button
            type="button"
            onPointerDown={(e) => controls.start(e)}
            className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-70 transition-opacity"
            aria-label="拖拽排序"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Index badge */}
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold mt-0.5"
            style={{
              background: 'var(--nayin-accent)',
              color: 'var(--background)',
            }}
          >
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-foreground truncate">
                {card.title}
              </h4>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                style={{
                  background: 'var(--nayin-glow)',
                  color: 'var(--nayin-accent-bright)',
                }}
              >
                {card.emotion}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {card.content}
            </p>
            {card.sensoryDetails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {card.sensoryDetails.map((d, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                    style={{
                      background: 'var(--panel-header)',
                      color: 'var(--muted-foreground)',
                    }}
                  >
                    · {d}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-foreground/5 transition-all"
            aria-label="删除卡片"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      </motion.div>
    </Reorder.Item>
  );
}

export default function StoryCardsBoard() {
  const {
    cards,
    reorderCards,
    removeCard,
    generateScript,
    isGeneratingScript,
    latestScript,
  } = useStoryAgent();
  const { element } = useNayin();
  const lastOrderRef = useRef<string>('');

  // Detect whether order changed since last script
  const orderChanged = useMemo(() => {
    if (!latestScript) return cards.length > 0;
    if (latestScript.cardOrder.length !== cards.length) return true;
    return cards.some((c, i) => latestScript.cardOrder[i] !== c.id);
  }, [cards, latestScript]);

  // Track the last order string for animation triggers (reserved for future use)
  const orderKey = cards.map((c) => c.id).join('|');
  if (orderKey !== lastOrderRef.current) lastOrderRef.current = orderKey;

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Story Cards</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] opacity-60 font-mono">
          {cards.length > 0 ? (
            <>
              <Sparkles className="w-3 h-3" />
              {cards.length} cards
            </>
          ) : (
            <span>EMPTY</span>
          )}
        </span>
      </div>

      <div className="monitor-panel-body flex-1 flex flex-col overflow-hidden">
        {cards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-4"
          >
            <FlaskConical className="w-7 h-7 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
              {EMPTY_HINT[element]}
            </p>
            <p className="text-[10px] text-muted-foreground/70 max-w-[16rem]">
              小酌会在你描述出 <span className="text-nayin-bright">具体场景 + 情感 + 感官细节</span> 时，自动把那一刻提炼成卡片，飞到这里来。
            </p>
          </motion.div>
        ) : (
          <>
            <Reorder.Group
              axis="y"
              values={cards}
              onReorder={reorderCards}
              className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1"
            >
              <AnimatePresence>
                {cards.map((card, idx) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    index={idx}
                    onRemove={() => removeCard(card.id)}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>

            <div
              className="border-t pt-2.5 mt-2 flex flex-col gap-2"
              style={{ borderColor: 'var(--panel-border)' }}
            >
              <button
                type="button"
                onClick={generateScript}
                disabled={isGeneratingScript || cards.length === 0}
                className="w-full text-xs py-2 rounded-md font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{
                  background: 'var(--nayin-accent)',
                  color: 'var(--background)',
                  boxShadow: '0 4px 16px -6px var(--nayin-glow)',
                }}
              >
                {isGeneratingScript ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在按这个顺序写剧本…
                  </>
                ) : (
                  <>
                    <ScrollText className="w-3.5 h-3.5" />
                    {latestScript && !orderChanged
                      ? '重新生成剧本'
                      : latestScript && orderChanged
                        ? '按新顺序生成剧本'
                        : '生成剧本'}
                  </>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground/70 text-center">
                拖动调整顺序 · 不同顺序 → 不同剧本
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
