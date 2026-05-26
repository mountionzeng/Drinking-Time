/**
 * StoryboardScene — 故事版中的单个场景卡片。
 * 上半部分展示图片（或空白占位），下半部分展示台词（可编辑）。
 */
import { useState, useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Trash2, ImageIcon } from "lucide-react";
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
      className="select-none"
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 32px -8px rgba(0,0,0,0.15)", zIndex: 10 }}
    >
      <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        {/* 图片区域 */}
        {scene.imageUrl ? (
          <button
            type="button"
            className="w-full"
            onClick={() => scene.imageId && onImageClick?.(scene.imageId)}
          >
            <img
              src={scene.imageUrl}
              alt={`场景 ${index + 1}`}
              className="w-full aspect-video object-cover"
              draggable={false}
            />
          </button>
        ) : (
          // 空白占位
          <div className="w-full aspect-video bg-gray-100 flex flex-col items-center justify-center gap-2">
            <ImageIcon className="h-8 w-8 text-gray-300" />
            <span className="text-xs text-gray-400">和小酌聊聊这个场景</span>
          </div>
        )}

        {/* 底部信息区 */}
        <div className="px-3 py-2.5">
          <div className="flex items-start gap-2">
            {/* 拖拽手柄 */}
            <button
              type="button"
              onPointerDown={(e) => controls.start(e)}
              className="shrink-0 mt-1 cursor-grab active:cursor-grabbing opacity-30 hover:opacity-70 transition-opacity touch-none"
              aria-label="拖拽排序"
            >
              <GripVertical className="h-4 w-4 text-gray-400" />
            </button>

            {/* 序号 */}
            <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-semibold">
              {index + 1}
            </span>

            {/* 台词区域 */}
            <div className="flex-1 min-w-0">
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
                  className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-sm leading-relaxed text-gray-700 outline-none focus:border-amber-300"
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
                  <p className="text-sm leading-relaxed text-gray-700">
                    {scene.dialogue || "（点击编辑台词）"}
                  </p>
                  {scene.subject && (
                    <p className="mt-0.5 text-[11px] text-gray-400">{scene.subject}</p>
                  )}
                </button>
              )}
            </div>

            {/* 删除按钮 */}
            <button
              type="button"
              onClick={() => onDelete(scene.shotNo)}
              className="shrink-0 mt-1 rounded p-1 opacity-30 hover:opacity-70 hover:bg-red-50 transition-all"
              aria-label="删除场景"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </button>
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}
