/**
 * MobileStoryboard — 手机端故事版页面。
 * 垂直滚动展示场景卡片（台词+图片），支持拖拽排序、编辑、删除。
 * 数据从 MobileChatContext 的 cards + images 组合而来。
 */
import { useMemo, useState, useCallback } from "react";
import { Reorder, AnimatePresence } from "framer-motion";
import { MessageCircle, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useNayin } from "@/features/nayin/NayinContext";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import { useMobileChat } from "../MobileChatContext";
import {
  buildMobileStoryboardScenes,
  type StoryboardScene as SceneType,
} from "../types";
import StoryboardSceneCard from "./StoryboardScene";
import MobileImageEdit from "./MobileImageEdit";

export default function MobileStoryboard() {
  const { cards, images, remoteStoryId } = useMobileChat();
  const { element, theme } = useNayin();
  const [, setLocation] = useLocation();
  const [editingImageId, setEditingImageId] = useState<number | null>(null);

  // 从 cards + images 组合出场景列表
  const [scenes, setScenes] = useState<SceneType[]>([]);

  const computedScenes = useMemo(() => {
    return buildMobileStoryboardScenes(cards, images, scenes);
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
      <div className="dtm-screen">
        <header className="dtm-story-header">
          <div className="dtm-header-icon dtm-header-icon--small">
            <WuxingDrinkIcon element={element} size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[17px]">故事版</div>
            <div className="dtm-kicker mt-0.5">STORYBOARD · 0 BEATS · {theme.beverageCn}</div>
          </div>
          <span className="dtm-pill-badge">编辑中</span>
        </header>
        <div className="dtm-story-empty">
          <div className="dtm-header-icon">
            <MessageCircle className="h-8 w-8 text-[var(--nayin-accent)]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold">还没有故事</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
              先和小酌聊聊你的回忆，故事会慢慢浮现。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLocation("/m")}
            className="dtm-add-scene"
          >
            <Plus size={18} />
            去聊天
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dtm-screen">
      <header className="dtm-story-header">
        <div className="dtm-header-icon dtm-header-icon--small">
          <WuxingDrinkIcon element={element} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[17px]">
            {cards[0]?.title || "故事版"}
          </div>
          <div className="dtm-kicker mt-0.5">
            STORYBOARD · {displayScenes.length} BEATS · {theme.beverageCn}
          </div>
        </div>
        <span className="dtm-pill-badge">编辑中</span>
      </header>

      {/* 场景列表（可排序） */}
      <div className="dtm-story-list">
        <Reorder.Group
          axis="y"
          values={displayScenes}
          onReorder={handleReorder}
          className="flex flex-col gap-[22px]"
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
        <button type="button" className="dtm-add-scene">
          <Plus size={18} />
          加一个场景
        </button>
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
