/**
 * MobileStoryboard — 手机端故事版页面。
 * 垂直滚动展示场景卡片（台词+图片），支持拖拽排序、编辑、删除。
 * 数据从 MobileChatContext 的 cards + images 组合而来。
 */
import { useMemo, useState, useCallback } from "react";
import { Reorder, AnimatePresence } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useMobileChat } from "../MobileChatContext";
import type { StoryboardScene as SceneType } from "../types";
import StoryboardSceneCard from "./StoryboardScene";
import MobileImageEdit from "./MobileImageEdit";

export default function MobileStoryboard() {
  const { cards, images, remoteStoryId } = useMobileChat();
  const [, setLocation] = useLocation();
  const [editingImageId, setEditingImageId] = useState<number | null>(null);

  // 从 cards + images 组合出场景列表
  const [scenes, setScenes] = useState<SceneType[]>([]);

  // 每次 cards/images 变化时重新计算场景（用 useMemo 做初始值）
  const computedScenes = useMemo(() => {
    return cards.map((card, idx) => {
      const shotNo = idx + 1;
      // 找到和这个 shotNo 关联的图片（取最新的 ready 图片）
      const linkedImage = images.find(
        (img) => img.shotNo === shotNo && img.status === "ready"
      );
      // 保留用户已编辑的台词
      const existing = scenes.find((s) => s.shotNo === shotNo);
      return {
        shotNo,
        dialogue: existing?.dialogue ?? card.content,
        subject: card.title,
        mood: card.emotion,
        imageUrl: linkedImage?.imageUrl,
        imageId: linkedImage?.id,
      } satisfies SceneType;
    });
  }, [cards, images]); // scenes 故意不在依赖中，避免循环

  // 同步 computedScenes 到 state（用于支持拖拽排序）
  const displayScenes = computedScenes.length > 0 ? computedScenes : scenes;

  // 拖拽排序
  const handleReorder = useCallback((newOrder: SceneType[]) => {
    setScenes(newOrder);
  }, []);

  // 更新台词
  const handleUpdateDialogue = useCallback((shotNo: number, dialogue: string) => {
    setScenes((prev) => {
      const exists = prev.find((s) => s.shotNo === shotNo);
      if (exists) {
        return prev.map((s) => (s.shotNo === shotNo ? { ...s, dialogue } : s));
      }
      // 如果 scenes state 为空，从 computedScenes 初始化
      return computedScenes.map((s) =>
        s.shotNo === shotNo ? { ...s, dialogue } : s
      );
    });
  }, [computedScenes]);

  // 删除场景
  const handleDelete = useCallback((shotNo: number) => {
    setScenes((prev) => prev.filter((s) => s.shotNo !== shotNo));
  }, []);

  // 点击图片进入编辑
  const handleImageClick = useCallback((imageId: number) => {
    setEditingImageId(imageId);
  }, []);

  // 编辑完成
  const handleEditComplete = useCallback((_newUrl: string, _newId: number) => {
    setEditingImageId(null);
  }, []);

  // 空状态
  if (displayScenes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-full bg-amber-50 p-4">
          <MessageCircle className="h-8 w-8 text-amber-300" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-600">还没有故事</p>
          <p className="mt-1 text-xs text-gray-400">
            先和小酌聊聊你的回忆，故事会慢慢浮现
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLocation("/m")}
          className="rounded-full bg-amber-700 px-5 py-2 text-sm text-white transition-opacity hover:opacity-90"
        >
          去聊天
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题 */}
      <header className="flex items-center justify-center border-b bg-white/80 px-4 py-3 backdrop-blur-sm">
        <h1 className="text-sm font-medium text-gray-700">故事版</h1>
      </header>

      {/* 场景列表（可排序） */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Reorder.Group
          axis="y"
          values={displayScenes}
          onReorder={handleReorder}
          className="space-y-3"
        >
          <AnimatePresence>
            {displayScenes.map((scene, idx) => (
              <StoryboardSceneCard
                key={scene.shotNo}
                scene={scene}
                index={idx}
                onUpdateDialogue={handleUpdateDialogue}
                onDelete={handleDelete}
                onImageClick={handleImageClick}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      </div>

      {/* 图片编辑弹层 */}
      {editingImageId !== null && (() => {
        const img = images.find((i) => i.id === editingImageId);
        if (!img || !remoteStoryId) return null;
        return (
          <MobileImageEdit
            imageUrl={img.imageUrl}
            imageId={img.id}
            storyId={remoteStoryId}
            shotNo={img.shotNo ?? undefined}
            onClose={() => setEditingImageId(null)}
            onEditComplete={handleEditComplete}
          />
        );
      })()}
    </div>
  );
}
