/**
 * MobileImageEdit — 手机端图片局部编辑。
 *
 * 简化版：用户长按图片进入编辑模式，输入描述修改意图，
 * 通过 Forge API 的 originalImages 参数做整体风格修改。
 * （SAM 2 分割能力不在 main 分支，后续版本再加区域选择）
 *
 * 状态机：idle → editing → inpainting → done
 */
import { useState, useRef, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, Loader2, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";

type EditState = "idle" | "editing" | "inpainting" | "done";

interface Props {
  imageUrl: string;
  imageId: number;
  storyId: number;
  shotNo?: number;
  onClose: () => void;
  onEditComplete: (newImageUrl: string, newImageId: number) => void;
}

export default function MobileImageEdit({
  imageUrl,
  imageId,
  storyId,
  shotNo,
  onClose,
  onEditComplete,
}: Props) {
  const [state, setState] = useState<EditState>("editing");
  const [editPrompt, setEditPrompt] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const inpaintMut = trpc.storyAgent.mobileInpaint.useMutation();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();

  const handleSubmit = async () => {
    const text = editPrompt.trim();
    if (!text || state === "inpainting") return;

    setState("inpainting");

    // 记录编辑开始信号
    try {
      await signalMut.mutateAsync({
        storyId,
        imageId,
        action: "edit_start",
        metadata: { editPrompt: text },
      });
    } catch {
      // 信号记录失败不影响编辑流程
    }

    try {
      const result = await inpaintMut.mutateAsync({
        prompt: text,
        originalImageUrl: imageUrl,
        storyId,
        shotNo,
        parentImageId: imageId,
      });

      if (result.status === "ok" && result.imageUrl) {
        setPreviewUrl(result.imageUrl);
        setState("done");

        // 记录编辑完成信号
        try {
          await signalMut.mutateAsync({
            storyId,
            imageId: result.imageId!,
            action: "edit_complete",
            metadata: { editPrompt: text, parentImageId: imageId },
          });
        } catch {
          // 信号记录失败不影响流程
        }

        onEditComplete(result.imageUrl, result.imageId!);
      } else {
        setState("editing");
      }
    } catch (err) {
      console.error("[MobileImageEdit] 编辑失败:", err);
      setState("editing");
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="dtm-edit-overlay"
      >
        {/* 顶部栏 */}
        <div className="dtm-edit-header">
          <button
            onClick={onClose}
            className="dtm-ghost-button !h-9 !w-9 !flex-none"
            aria-label="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 font-semibold">局部修改</div>
          <span className="dtm-pill-badge">
            SCENE · {String(shotNo ?? 1).padStart(2, "0")}
          </span>
        </div>

        {/* 图片预览 */}
        <div className={`dtm-edit-preview ${state === "inpainting" ? "dtm-edit-preview--busy" : ""}`}>
          <motion.img
            src={previewUrl || imageUrl}
            alt="编辑中的图片"
            animate={
              state === "inpainting"
                ? { filter: "blur(4px)", opacity: 0.6 }
                : { filter: "blur(0px)", opacity: 1 }
            }
            transition={{ duration: 0.5 }}
          />
          <div className="dtm-edit-mask" />
          <div className="dtm-edit-chip">
            <Pencil size={14} />
            已选 · 画面局部
          </div>
          {state === "inpainting" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">正在修改…</span>
            </div>
          )}
        </div>

        <div className="dtm-edit-help">
          <div className="text-[13px] text-[var(--muted-foreground)]">
            想把它改成什么样？说一句就好。
          </div>
          <div className="dtm-edit-chips">
            {["再暖一点", "换成蜡烛", "更柔", "光晕大一些"].map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => setEditPrompt(hint)}
                className="rounded-full"
                disabled={state === "inpainting"}
              >
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        {/* 底部输入框 */}
        <div className="dtm-composer">
          <div className="dtm-composer-row">
            <textarea
              ref={inputRef}
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              onKeyDown={handleKey}
              placeholder="灯再暖一点，像将熄的炭。"
              rows={1}
              disabled={state === "inpainting"}
              className="dtm-textbox"
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={!editPrompt.trim() || state === "inpainting"}
              className="dtm-accent-button"
              aria-label="确认修改"
            >
              {state === "inpainting" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
