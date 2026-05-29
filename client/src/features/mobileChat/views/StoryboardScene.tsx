/**
 * StoryboardScene — 故事版中的单个场景卡片。
 * 上半部分展示图片（或空白占位），下半部分展示台词（可编辑）。
 */
import { useState, useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, ImageIcon, Pencil, Trash2 } from "lucide-react";
import type { StoryboardScene as SceneType } from "../types";

interface Props {
  scene: SceneType;
  index: number;
  onUpdateDialogue: (shotNo: number, dialogue: string) => void;
  onDelete: (shotNo: number) => void;
  onImageClick?: (imageId: number) => void;
}

export default function StoryboardSceneCard({
  scene,
  index,
  onUpdateDialogue,
  onDelete,
  onImageClick,
}: Props) {
  const controls = useDragControls();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(scene.dialogue);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 保存编辑
  const handleSave = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== scene.dialogue) {
      onUpdateDialogue(scene.shotNo, trimmed);
    } else {
      setEditText(scene.dialogue); // 还原
    }
    setIsEditing(false);
  };

  return (
    <Reorder.Item
      value={scene}
      dragListener={false}
      dragControls={controls}
      className="dtm-scene"
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 32px -8px rgba(0,0,0,0.15)", zIndex: 10 }}
    >
      <div className="dtm-scene-topline">
        <span
          className="dtm-mono-label"
          style={{ color: index === 1 ? "var(--nayin-accent)" : "var(--muted-foreground)" }}
        >
          BEAT · {String(index + 1).padStart(2, "0")}
        </span>
        <span className="dtm-scene-divider" />
        <span className="dtm-mono-label">{scene.mood || "SCENE"}</span>
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="text-[var(--muted-foreground)]"
          aria-label="拖拽排序"
        >
          <GripVertical size={16} />
        </button>
      </div>

      <div className={`dtm-scene-line ${index === 1 ? "dtm-scene-line--accent" : ""}`}>
        {isEditing ? (
          <textarea
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
            }}
            className="w-full resize-none bg-transparent text-[15.5px] leading-relaxed outline-none"
            rows={2}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="w-full text-left"
            onClick={() => {
              setIsEditing(true);
              setEditText(scene.dialogue);
            }}
          >
            {scene.dialogue || "（点击编辑台词）"}
          </button>
        )}
      </div>

      <div className="dtm-scene-shot">
        {scene.imageUrl ? (
          <button
            type="button"
            className="w-full"
            onClick={() => scene.imageId && onImageClick?.(scene.imageId)}
          >
            <img
              src={scene.imageUrl}
              alt={`场景 ${index + 1}`}
              className="aspect-video"
              draggable={false}
            />
          </button>
        ) : (
          <div className="dtm-placeholder-art dtm-placeholder-art--muted flex flex-col items-center justify-center gap-2">
            <ImageIcon className="h-8 w-8 text-[var(--muted-foreground)] opacity-50" />
            <span className="text-xs text-[var(--muted-foreground)]">和小酌聊聊这个场景</span>
          </div>
        )}

        <div className="dtm-scene-shot-footer">
          <span className="text-[12.5px] text-[var(--muted-foreground)]">
            {scene.subject || `场景 ${index + 1}`}
          </span>
          <span className="flex-1" />
          <div className="dtm-scene-actions">
            <button
              type="button"
              className="dtm-icon-ghost-small"
              onClick={() => {
                setIsEditing(true);
                setEditText(scene.dialogue);
              }}
              aria-label="编辑台词"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(scene.shotNo)}
              className="dtm-icon-ghost-small"
              aria-label="删除场景"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}
