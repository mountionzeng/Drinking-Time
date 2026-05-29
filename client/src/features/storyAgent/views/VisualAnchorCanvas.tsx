import { useMemo, useRef, useState, type DragEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import type { VisualCanvasItem } from '@/features/storyAgent/types';

function chips(values: string[]) {
  return values.slice(0, 4).filter(Boolean);
}

function VisualTile({
  item,
  selected,
  onSelect,
}: {
  item: VisualCanvasItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { updateVisualCanvasItem } = useStoryAgent();

  return (
    <motion.button
      type="button"
      drag
      dragMomentum={false}
      whileDrag={{ scale: 1.04, zIndex: 20 }}
      onClick={onSelect}
      onDragEnd={(_, info) => {
        updateVisualCanvasItem(item.id, {
          x: Math.max(0, item.x + info.offset.x),
          y: Math.max(0, item.y + info.offset.y),
        });
      }}
      className="absolute group text-left rounded-xl overflow-hidden border shadow-sm bg-card"
      style={{
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        borderColor: selected ? 'var(--nayin-accent)' : 'var(--panel-border)',
        boxShadow: selected
          ? '0 18px 45px -22px var(--nayin-glow), 0 0 0 1px var(--nayin-accent)'
          : '0 12px 30px -24px rgba(0,0,0,.35)',
      }}
    >
      <img
        src={item.imageUrl}
        alt={item.title}
        draggable={false}
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/45 to-transparent p-2">
        <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          <Palette className="h-3 w-3" />
          visual anchor
        </div>
        <div className="mt-0.5 truncate text-[11px] font-semibold text-foreground">
          {item.title}
        </div>
      </div>
    </motion.button>
  );
}

export default function VisualAnchorCanvas() {
  const {
    visualCanvasItems,
    visualPreference,
    isArtWorking,
    addVisualReference,
    refineVisualItem,
    removeVisualCanvasItem,
  } = useStoryAgent();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const selected = useMemo(
    () => visualCanvasItems.find((item) => item.id === selectedId) ?? visualCanvasItems.at(-1) ?? null,
    [selectedId, visualCanvasItems],
  );

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files).find((entry) => entry.type.startsWith('image/'));
    if (!file) return;
    await addVisualReference(file, instruction || undefined);
    setInstruction('');
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      className="mt-3 rounded-xl border p-3"
      style={{
        borderColor: 'var(--panel-border)',
        background:
          'linear-gradient(135deg, var(--nayin-surface) 0%, var(--card) 62%, var(--nayin-surface-dim) 100%)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-nayin-bright" />
            视觉锚画布
          </div>
          <p className="mt-1 max-w-[17rem] text-[10px] leading-relaxed text-muted-foreground">
            拖进参考图，小酌会先读图，再 riff 一张新图。这里定下来的感觉会喂给下游镜头表。
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isArtWorking}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold transition disabled:opacity-50"
          style={{
            background: 'var(--nayin-accent)',
            color: 'var(--background)',
          }}
        >
          {isArtWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          喂图
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

      <div
        role="presentation"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className="relative mt-3 h-[260px] overflow-hidden rounded-xl border border-dashed"
        style={{
          borderColor: dragActive ? 'var(--nayin-accent)' : 'var(--panel-border)',
          background:
            'radial-gradient(circle at 20% 20%, var(--nayin-glow), transparent 32%), linear-gradient(135deg, var(--background), var(--panel-header))',
        }}
      >
        {visualCanvasItems.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: 'var(--nayin-glow)', color: 'var(--nayin-accent-bright)' }}
            >
              <Wand2 className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-foreground">把照片或参考图拖到这里</p>
            <p className="max-w-[15rem] text-[10px] leading-relaxed text-muted-foreground">
              画布不用摆整齐。它像桌面上的灵感纸片，先把视觉感觉摊开。
            </p>
          </div>
        ) : (
          visualCanvasItems.map((item) => (
            <VisualTile
              key={item.id}
              item={item}
              selected={selected?.id === item.id}
              onSelect={() => setSelectedId(item.id)}
            />
          ))
        )}
      </div>

      <div className="mt-3 grid gap-2">
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          placeholder="比如：再暖一点、更孤独一点、像雨后的旧电影、少一点甜……"
          className="resize-none rounded-lg border bg-background/70 px-3 py-2 text-[11px] outline-none transition placeholder:text-muted-foreground/60 focus:ring-2"
          style={{
            borderColor: 'var(--panel-border)',
            ['--tw-ring-color' as string]: 'var(--nayin-glow)',
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!selected || isArtWorking}
            onClick={() => selected && void refineVisualItem(selected.id, instruction)}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50"
            style={{
              background: 'var(--nayin-accent)',
              color: 'var(--background)',
            }}
          >
            {isArtWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            让美术 Agent 再 riff
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              removeVisualCanvasItem(selected.id);
              setSelectedId(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="删除视觉锚"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {selected ? (
        <div className="mt-3 rounded-lg border p-2.5 text-[10px] leading-relaxed" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="mb-1 flex flex-wrap gap-1">
            {chips([...selected.analysis.visualStyle, ...selected.analysis.mood]).map((chip) => (
              <span
                key={chip}
                className="rounded-full px-2 py-0.5 font-mono"
                style={{ background: 'var(--nayin-glow)', color: 'var(--nayin-accent-bright)' }}
              >
                {chip}
              </span>
            ))}
          </div>
          <p className="text-foreground/80">
            <span className="font-semibold">客观：</span>
            {selected.analysis.objective || '还没有客观分析'}
          </p>
          <p className="mt-1 text-muted-foreground">
            <span className="font-semibold text-foreground/70">美术/情绪：</span>
            {selected.analysis.aesthetic || '还没有情绪解读'}
          </p>
        </div>
      ) : null}

      {visualPreference ? (
        <p className="mt-2 line-clamp-3 text-[9px] leading-relaxed text-muted-foreground/75">
          项目内审美记忆：{visualPreference}
        </p>
      ) : null}
    </div>
  );
}
