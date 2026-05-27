/**
 * EmotionPicker — 两层情绪选择面板
 *
 * 点击卡片上的情绪标签时弹出，用户可以浏览 大类→子类 两层结构来修改情绪标注。
 * 第三层变体只在 hover 时做 tooltip 展示，不参与选择。
 */
import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import {
  EMOTION_CATEGORIES,
  MIXED_EMOTIONS,
  type EmotionCategory,
  type EmotionSubcategory,
  type MixedEmotion,
} from '../emotionTaxonomy';

interface EmotionPickerProps {
  /** 当前选中的情绪 key */
  currentEmotion: string;
  /** 用户选择新情绪后的回调 */
  onSelect: (key: string, label: string) => void;
  /** 关闭面板 */
  onClose: () => void;
}

export default function EmotionPicker({ currentEmotion, onSelect, onClose }: EmotionPickerProps) {
  // 当前展开的大类
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // 是否显示混合情绪
  const [showMixed, setShowMixed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSelectSub = (sub: EmotionSubcategory) => {
    onSelect(sub.key, sub.label);
    onClose();
  };

  const handleSelectMixed = (mixed: MixedEmotion) => {
    onSelect(mixed.key, mixed.label);
    onClose();
  };

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute z-50 top-full mt-1 left-0 w-[280px] max-h-[360px] rounded-lg border shadow-xl overflow-hidden flex flex-col"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--panel-border)',
        boxShadow: '0 8px 32px -8px rgba(0,0,0,0.3)',
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-header)' }}
      >
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {expandedCategory ? (
            <button
              type="button"
              onClick={() => setExpandedCategory(null)}
              className="hover:text-foreground transition-colors"
            >
              ← 返回大类
            </button>
          ) : (
            '选择情绪'
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-foreground/10 transition-colors"
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          {expandedCategory ? (
            /* 子类列表 */
            <SubcategoryList
              key={expandedCategory}
              category={EMOTION_CATEGORIES.find(c => c.key === expandedCategory)!}
              currentEmotion={currentEmotion}
              onSelect={handleSelectSub}
            />
          ) : (
            /* 大类列表 */
            <motion.div
              key="categories"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-1.5"
            >
              {EMOTION_CATEGORIES.map(cat => (
                <CategoryRow
                  key={cat.key}
                  category={cat}
                  currentEmotion={currentEmotion}
                  onClick={() => setExpandedCategory(cat.key)}
                />
              ))}

              {/* 混合情绪折叠区 */}
              <button
                type="button"
                onClick={() => setShowMixed(!showMixed)}
                className="w-full mt-1 px-2 py-1.5 rounded text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:bg-foreground/5 transition-colors flex items-center gap-1"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${showMixed ? 'rotate-90' : ''}`}
                />
                混合情绪 ({MIXED_EMOTIONS.length})
              </button>

              <AnimatePresence>
                {showMixed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    {MIXED_EMOTIONS.map(mixed => (
                      <MixedEmotionRow
                        key={mixed.key}
                        mixed={mixed}
                        currentEmotion={currentEmotion}
                        onClick={() => handleSelectMixed(mixed)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** 大类行 — 显示中文标签 + 子类数量 + 箭头 */
function CategoryRow({
  category,
  currentEmotion,
  onClick,
}: {
  category: EmotionCategory;
  currentEmotion: string;
  onClick: () => void;
}) {
  // 检查当前情绪是否在这个大类下
  const isActive = category.subcategories.some(s => s.key === currentEmotion);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2 py-2 rounded-md text-left flex items-center gap-2 transition-colors ${
        isActive ? 'bg-foreground/10' : 'hover:bg-foreground/5'
      }`}
    >
      {/* 大类标签 */}
      <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        {category.label}
      </span>
      <span className="text-[10px] text-muted-foreground font-mono">
        {category.key}
      </span>

      {/* 子类预览 */}
      <span className="flex-1 text-[10px] text-muted-foreground/60 truncate text-right">
        {category.subcategories.slice(0, 3).map(s => s.label).join(' · ')}
      </span>

      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

/** 子类列表 — 某个大类展开后显示所有子类 */
function SubcategoryList({
  category,
  currentEmotion,
  onSelect,
}: {
  category: EmotionCategory;
  currentEmotion: string;
  onSelect: (sub: EmotionSubcategory) => void;
}) {
  const [hoveredSub, setHoveredSub] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className="p-1.5"
    >
      {/* 大类标题 */}
      <div className="px-2 py-1 mb-1 text-xs font-semibold text-muted-foreground">
        {category.label}（{category.key}）
      </div>

      {category.subcategories.map(sub => {
        const isActive = sub.key === currentEmotion;
        const isHovered = hoveredSub === sub.key;

        return (
          <div key={sub.key} className="relative">
            <button
              type="button"
              onClick={() => onSelect(sub)}
              onMouseEnter={() => setHoveredSub(sub.key)}
              onMouseLeave={() => setHoveredSub(null)}
              className={`w-full px-2 py-1.5 rounded-md text-left flex flex-col gap-0.5 transition-colors ${
                isActive
                  ? 'bg-[var(--nayin-glow)] ring-1 ring-[var(--nayin-accent)]'
                  : 'hover:bg-foreground/5'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">{sub.label}</span>
                <span className="text-[9px] text-muted-foreground font-mono">{sub.key}</span>
                {/* 叙事位置标签 */}
                <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-foreground/5 text-muted-foreground/60 font-mono">
                  {sub.narrativeArc}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/70 leading-tight">
                {sub.description}
              </span>
            </button>

            {/* Hover 时显示第三层变体 */}
            <AnimatePresence>
              {isHovered && (
                <motion.div
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  className="absolute z-10 left-full top-0 ml-1 w-[200px] rounded-md border p-2 shadow-lg"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--panel-border)',
                  }}
                >
                  <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                    口语变体
                  </div>
                  <div className="space-y-1">
                    {sub.variants.map((v, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px]">
                        {/* 强度指示 */}
                        <span className="flex gap-[2px]">
                          {[1, 2, 3, 4].map(n => (
                            <span
                              key={n}
                              className="w-1 h-1 rounded-full"
                              style={{
                                background: n <= v.intensity
                                  ? 'var(--nayin-accent)'
                                  : 'var(--panel-border)',
                              }}
                            />
                          ))}
                        </span>
                        <span className="text-foreground/80">「{v.label}」</span>
                      </div>
                    ))}
                  </div>
                  {/* 影视转化提示 */}
                  <div className="mt-2 pt-1.5 border-t text-[9px] text-muted-foreground/60 leading-tight"
                       style={{ borderColor: 'var(--panel-border)' }}>
                    🎬 {sub.cinematicHint}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </motion.div>
  );
}

/** 混合情绪行 */
function MixedEmotionRow({
  mixed,
  currentEmotion,
  onClick,
}: {
  mixed: MixedEmotion;
  currentEmotion: string;
  onClick: () => void;
}) {
  const isActive = mixed.key === currentEmotion;
  // 找到组成成分的中文名
  const comp1 = EMOTION_CATEGORIES.find(c => c.key === mixed.components[0]);
  const comp2 = EMOTION_CATEGORIES.find(c => c.key === mixed.components[1]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2 py-1.5 rounded-md text-left flex flex-col gap-0.5 transition-colors ml-3 ${
        isActive
          ? 'bg-[var(--nayin-glow)] ring-1 ring-[var(--nayin-accent)]'
          : 'hover:bg-foreground/5'
      }`}
      style={{ width: 'calc(100% - 12px)' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground">{mixed.label}</span>
        <span className="text-[9px] text-muted-foreground font-mono">
          {comp1?.label}+{comp2?.label}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground/70 leading-tight">
        {mixed.description}
      </span>
    </button>
  );
}
