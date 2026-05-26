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
import { X, Send, Loader2 } from "lucide-react";
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
        className="fixed inset-0 z-50 flex flex-col bg-black/90"
      >
        {/* 顶部关闭按钮 */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-white/70">
            {state === "inpainting" ? "修改中…" : "描述你想改的地方"}
          </span>
          <button
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 图片预览 */}
        <div className="flex flex-1 items-center justify-center px-4">
          <motion.img
            src={previewUrl || imageUrl}
            alt="编辑中的图片"
            className="max-h-full max-w-full rounded-xl object-contain"
            animate={
              state === "inpainting"
                ? { filter: "blur(4px)", opacity: 0.6 }
                : { filter: "blur(0px)", opacity: 1 }
            }
            transition={{ duration: 0.5 }}
          />
          {state === "inpainting" && (
            <div className="absolute flex items-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">正在修改…</span>
            </div>
          )}
        </div>

        {/* 底部输入框 */}
        <div
          className="border-t border-white/10 px-3 py-2"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              onKeyDown={handleKey}
              placeholder="比如：把树换成枯树、天空变成黄昏…"
              rows={1}
              disabled={state === "inpainting"}
              className="flex-1 resize-none rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm leading-relaxed text-white placeholder-white/40 outline-none transition-colors focus:border-amber-400/50 disabled:opacity-50"
              style={{ maxHeight: "100px" }}
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={!editPrompt.trim() || state === "inpainting"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white transition-opacity disabled:opacity-30"
            >
              {state === "inpainting" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
