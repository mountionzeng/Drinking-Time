/**
 * StoryCardsBoard — Reorderable list of memory cards harvested from the
 * story-guide chat. The order matters: each ordering produces a different
 * generated script.
 *
 * Sits in the TEMPLATE DRAFT slot of the analysis page.
 */
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import {
  GripVertical,
  X,
  Sparkles,
  FlaskConical,
  Loader2,
  ScrollText,
  ImagePlus,
  Trash2,
} from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useNayin } from '@/features/nayin/NayinContext';
import type { StoryCard, VisualCanvasItem } from '@/features/storyAgent/types';
import type { NayinElement } from '@/features/nayin/nayin';
import StoryArtDirectionStudio from './StoryArtDirectionStudio';

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

function isRealEmotion(emotion?: string): emotion is string {
  const value = emotion?.trim();
  return Boolean(value && value !== '未标' && value !== '未标记');
}

function EmotionBridge({
  previousEmotion,
  currentEmotion,
}: {
  previousEmotion?: string;
  currentEmotion: string;
}) {
  if (!isRealEmotion(previousEmotion) || !isRealEmotion(currentEmotion) || previousEmotion === currentEmotion) {
    return null;
  }

  return (
    <div className="flex justify-center py-1.5" aria-label={`情绪流动：${previousEmotion} 到 ${currentEmotion}`}>
      <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
        <span className="h-3 w-px bg-[var(--panel-border)]" aria-hidden="true" />
        <span
          className="rounded-full border px-2 py-0.5 font-mono"
          style={{
            borderColor: 'var(--panel-border)',
            background: 'var(--panel-header)',
            color: 'var(--nayin-accent-bright)',
          }}
        >
          {previousEmotion} → {currentEmotion}
        </span>
      </div>
    </div>
  );
}

function CardReferenceDock({
  cardId,
  visualItems,
}: {
  cardId: string;
  visualItems: VisualCanvasItem[];
}) {
  const {
    isArtWorking,
    addVisualReference,
    removeVisualCanvasItem,
  } = useStoryAgent();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files).find((entry) => entry.type.startsWith('image/'));
    if (!file) return;
    await addVisualReference(file, undefined, cardId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      className="mt-3 rounded-md border p-2"
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        borderColor: dragActive ? 'var(--nayin-accent)' : 'var(--panel-border)',
        background: 'var(--background)',
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold text-muted-foreground">
          故事材料 {visualItems.length ? `· ${visualItems.length} 张` : ''}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isArtWorking}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          {isArtWorking ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ImagePlus className="h-3 w-3" />
          )}
          添加参考
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            if (event.currentTarget.files) void handleFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      {visualItems.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isArtWorking}
          className="mt-2 flex min-h-[50px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 text-center transition disabled:opacity-50"
          style={{
            borderColor: dragActive ? 'var(--nayin-accent)' : 'var(--panel-border)',
            background: dragActive ? 'var(--nayin-glow)' : 'transparent',
          }}
        >
          <ImagePlus className="h-3.5 w-3.5 text-nayin-bright" />
          <span className="text-[9px] font-medium text-muted-foreground">
            把与这一刻有关的照片拖进来
          </span>
        </button>
      ) : (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {visualItems.map(item => (
            <div
              key={item.id}
              className="group/reference relative h-14 w-14 shrink-0 overflow-hidden rounded-md border"
              style={{ borderColor: 'var(--panel-border)' }}
            >
              <img
                src={item.originalImageUrl || item.imageUrl}
                alt={item.title}
                className="h-full w-full object-cover"
                draggable={false}
              />
              <button
                type="button"
                onClick={() => removeVisualCanvasItem(item.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-muted-foreground opacity-0 transition group-hover/reference:opacity-100"
                aria-label={`移除 ${item.title}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CardItem({
  card,
  index,
  previousEmotion,
  visualItems,
  onRemove,
  onCommitContent,
}: {
  card: StoryCard;
  index: number;
  previousEmotion?: string;
  visualItems: VisualCanvasItem[];
  onRemove: () => void;
  onCommitContent: (content: string) => void;
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
      <EmotionBridge previousEmotion={previousEmotion} currentEmotion={card.emotion} />
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
            <p
              data-selection-source={`card:${card.id}`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="编辑卡片内容"
              tabIndex={0}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Enter commits & blurs; Shift+Enter keeps newline
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              onBlur={(e) => {
                const next = (e.currentTarget.innerText || '').trim();
                if (next && next !== card.content) onCommitContent(next);
                else e.currentTarget.innerText = card.content;
              }}
              className="text-[11px] text-muted-foreground leading-relaxed select-text cursor-text rounded-sm outline-none -mx-1 px-1 focus:bg-foreground/[0.04] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.02] transition-colors"
            >
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
            <CardReferenceDock cardId={card.id} visualItems={visualItems} />
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
    updateCardContent,
    generateScript,
    isGeneratingScript,
    latestScript,
    visualCanvasItems,
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

      <div className="monitor-panel-body flex-1 flex flex-col overflow-y-auto custom-scrollbar">
        {cards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-[180px] flex-col items-center justify-center text-center gap-3 px-4"
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
            <StoryArtDirectionStudio />
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
                    previousEmotion={cards[idx - 1]?.emotion}
                    visualItems={visualCanvasItems.filter((item) => item.cardId === card.id)}
                    onRemove={() => removeCard(card.id)}
                    onCommitContent={(text) => updateCardContent(card.id, text)}
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
