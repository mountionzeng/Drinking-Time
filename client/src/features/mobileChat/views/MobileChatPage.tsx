/**
 * MobileChatPage — 手机端聊天页主组件。
 * 消息列表 + 输入框（支持照片附件） + 局部编辑弹层。从 MobileChatContext 读取状态。
 */
import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import { Send, ImagePlus, X } from "lucide-react";
import { useMobileChat } from "../MobileChatContext";
import MobileChatMessages from "./MobileChatMessages";
import MobileImageEdit from "./MobileImageEdit";

// 读取文件为 base64（去掉 data:...;base64, 前缀）
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1]; // 去掉 data URL 前缀
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function MobileChatPage() {
  const {
    messages,
    images,
    isReplying,
    isGenerating,
    remoteStoryId,
    sendMessage,
    confirmGenerate,
    swipeRight,
    swipeLeft,
  } = useMobileChat();
  const [input, setInput] = useState("");
  // 正在编辑的图片 id（null = 不在编辑模式）
  const [editingImageId, setEditingImageId] = useState<number | null>(null);
  // 用户选择的照片预览
  const [photoPreview, setPhotoPreview] = useState<string | null>(null); // data URL 用于预览
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);   // 纯 base64 用于上传
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 长按图片进入编辑模式
  const handleLongPress = useCallback((imageId: number) => {
    setEditingImageId(imageId);
  }, []);

  // 编辑完成回调
  const handleEditComplete = useCallback((_newUrl: string, _newId: number) => {
    setEditingImageId(null);
  }, []);

  // 选择照片
  const handlePhotoSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 限制文件大小（10MB）
    if (file.size > 10 * 1024 * 1024) {
      alert("照片太大了，请选择 10MB 以内的图片");
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setPhotoBase64(b64);
      // 生成预览 URL
      setPhotoPreview(URL.createObjectURL(file));
    } catch {
      console.error("[MobileChatPage] 读取照片失败");
    }
    // 清空 input 值，允许重复选择同一文件
    e.target.value = "";
  }, []);

  // 移除已选照片
  const clearPhoto = useCallback(() => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoBase64(null);
  }, [photoPreview]);

  const handleSubmit = async () => {
    const text = input.trim();
    if ((!text && !photoBase64) || isReplying) return;
    const msg = text || "帮我把这张照片变成电影画面";
    setInput("");
    const b64 = photoBase64;
    clearPhoto();
    await sendMessage(msg, b64 ?? undefined);
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题 */}
      <header className="flex items-center justify-center border-b bg-white/80 px-4 py-3 backdrop-blur-sm">
        <h1 className="text-sm font-medium text-gray-700">小酌</h1>
      </header>

      {/* 消息列表 */}
      <MobileChatMessages
        messages={messages}
        images={images}
        isReplying={isReplying}
        isGenerating={isGenerating}
        onConfirmGenerate={confirmGenerate}
        onSwipeRight={swipeRight}
        onSwipeLeft={swipeLeft}
        onLongPress={handleLongPress}
      />

      {/* 输入区域 */}
      <div
        className="border-t bg-white px-3 py-2"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        {/* 照片预览条 */}
        {photoPreview && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative">
              <img
                src={photoPreview}
                alt="已选照片"
                className="h-16 w-16 rounded-xl object-cover"
              />
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-600 text-white shadow"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <span className="text-xs text-gray-400">照片已添加，发送后小酌会基于它生成画面</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* 照片选择按钮 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReplying}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-amber-700 disabled:opacity-30"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          {/* 隐藏的文件选择器 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelect}
          />

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={photoBase64 ? "描述你想要的画面效果…" : "说点什么…"}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-amber-300 focus:bg-white"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={handleSubmit}
            disabled={(!input.trim() && !photoBase64) || isReplying}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-700 text-white transition-opacity disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* 局部编辑弹层 */}
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
