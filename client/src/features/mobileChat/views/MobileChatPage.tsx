/**
 * MobileChatPage — 手机端聊天页主组件。
 * 消息列表 + 输入框（支持照片附件） + 局部编辑弹层。从 MobileChatContext 读取状态。
 */
import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import { ImagePlus, Loader2, Mic, Send, Sparkles, Square, X } from "lucide-react";
import { useNayin } from "@/features/nayin/NayinContext";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import { useVoiceInput } from "@/features/storyAgent/hooks/useVoiceInput";
import { useMobileChat } from "../MobileChatContext";
import MobileChatMessages from "./MobileChatMessages";
import MobileImageEdit from "./MobileImageEdit";
import { formatBytes, optimizeImageForUpload } from "@/lib/imageUpload";

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
  const { element, theme } = useNayin();
  const [input, setInput] = useState("");
  // 正在编辑的图片 id（null = 不在编辑模式）
  const [editingImageId, setEditingImageId] = useState<number | null>(null);
  // 用户选择的照片预览
  const [photoPreview, setPhotoPreview] = useState<string | null>(null); // data URL 用于预览
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);   // 纯 base64 用于上传
  const [photoMimeType, setPhotoMimeType] = useState<string>("image/jpeg");
  const [photoInfo, setPhotoInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput({
    onTranscribed: (text) => {
      setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

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
    // 先允许稍大的原图，本地压缩后再上传。
    if (file.size > 30 * 1024 * 1024) {
      alert("照片太大了，请选择 30MB 以内的图片");
      return;
    }
    try {
      const upload = await optimizeImageForUpload(file, { profile: "chat" });
      setPhotoBase64(upload.base64);
      setPhotoMimeType(upload.mimeType);
      setPhotoPreview(upload.dataUrl);
      setPhotoInfo(
        upload.wasOptimized
          ? `已压缩 ${formatBytes(upload.originalBytes)} → ${formatBytes(upload.optimizedBytes)}`
          : `已准备 ${formatBytes(upload.optimizedBytes)}`
      );
    } catch {
      console.error("[MobileChatPage] 读取照片失败");
    }
    // 清空 input 值，允许重复选择同一文件
    e.target.value = "";
  }, []);

  // 移除已选照片
  const clearPhoto = useCallback(() => {
    if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoBase64(null);
    setPhotoMimeType("image/jpeg");
    setPhotoInfo(null);
  }, [photoPreview]);

  const handleSubmit = async () => {
    const text = input.trim();
    if ((!text && !photoBase64) || isReplying || voice.isBusy) return;
    const msg = text || "帮我把这张照片变成电影画面";
    setInput("");
    const b64 = photoBase64;
    const mimeType = photoMimeType;
    clearPhoto();
    await sendMessage(msg, b64 ?? undefined, mimeType);
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const inputDisabled = isReplying || voice.isBusy;

  return (
    <div className="dtm-screen">
      {/* identity header */}
      <header className="dtm-header">
        <div className="dtm-header-icon">
          <WuxingDrinkIcon element={element} size={34} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="dtm-title-row">
            小酌
            <span className="dtm-kicker">· DRINKING&nbsp;TIME</span>
          </div>
          <div className="dtm-subline">
            <span className="dtm-dot" />
            今夜 · {theme.beverageCn} · {theme.elementCn}
          </div>
        </div>
        <button type="button" className="dtm-ghost-button" aria-label="灵感">
          <Sparkles size={18} />
        </button>
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

      {/* composer */}
      <div className="dtm-composer">
        {voice.isRecording && (
          <div className="dtm-rec-status dtm-rec-status--recording">
            <span className="dtm-rec-dot" />
            <span>RECORDING · 我在听</span>
            <div className="dtm-wave-bars" aria-hidden="true">
              {[3, 7, 5, 9, 6, 4, 8, 5, 3].map((height, index) => (
                <span
                  key={index}
                  style={{ height: height * 2, animationDelay: `${index * 0.08}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {voice.isTranscribing && (
          <div className="dtm-rec-status dtm-rec-status--transcribing">
            <span className="dtm-spinner" />
            <span>转写中…</span>
          </div>
        )}

        {/* 照片预览条 */}
        {photoPreview && (
          <div className="dtm-photo-strip">
            <div className="dtm-photo-thumb">
              <img
                src={photoPreview}
                alt="已选照片"
              />
              <button
                type="button"
                onClick={clearPhoto}
                className="dtm-photo-remove"
                aria-label="移除照片"
              >
                <X size={13} />
              </button>
            </div>
            <span className="text-[12px] leading-relaxed text-[var(--muted-foreground)]">
              {photoInfo ?? "照片已添加"}，发送后小酌会基于它生成画面
            </span>
          </div>
        )}

        <div className="dtm-composer-row">
          {/* 照片选择按钮 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={inputDisabled}
            className="dtm-ghost-button"
            aria-label="添加照片"
          >
            <ImagePlus size={20} />
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
            disabled={voice.isTranscribing}
            placeholder={
              voice.isRecording
                ? "……"
                : photoBase64
                  ? "描述你想要的画面效果…"
                  : "说一段，或者写两行…"
            }
            rows={1}
            className="dtm-textbox"
          />

          <button
            type="button"
            onClick={voice.toggleRecording}
            disabled={voice.isTranscribing || isReplying}
            className={`${
              voice.isRecording ? "dtm-accent-button dtm-rec-pulse" : "dtm-ghost-button"
            }`}
            aria-label={voice.isRecording ? "停止录音" : "语音输入"}
          >
            {voice.isTranscribing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : voice.isRecording ? (
              <Square size={18} className="fill-current" />
            ) : (
              <Mic size={22} />
            )}
          </button>

          <button
            onClick={handleSubmit}
            disabled={(!input.trim() && !photoBase64) || isReplying || voice.isBusy}
            className="dtm-accent-button"
            aria-label="发送"
          >
            <Send size={20} />
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
