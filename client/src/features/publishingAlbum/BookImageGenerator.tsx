import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { estimateStoryboardImageCost } from "@shared/imageRenderCost";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatComputeQuote } from "@shared/computeMoney";
import type { ComponentProps } from "react";
import type { PublishingImagePackCanvas } from "./PublishingImagePack";

type Props = ComponentProps<typeof PublishingImagePackCanvas>;
const control =
  "rounded-lg border border-[var(--panel-border)] px-3 py-2 text-sm disabled:opacity-40";

/** A book-side entry into the existing generation callbacks; opening never generates. */
export function BookImageGenerator(props: Props) {
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"cover" | "illustration" | "background">(
    "cover"
  );
  const [instruction, setInstruction] = useState("");
  const [reference, setReference] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const referenceId = reference ?? props.adoptedCoverId;
  const references = props.assets.filter(asset => asset.id > 0);
  const callback =
    kind === "cover"
      ? props.onGenerateCover
      : kind === "illustration"
        ? props.onGenerateIllustration
        : props.onGenerateTexture;
  const cost = callback
    ? props.illustrationCost
    : estimateStoryboardImageCost().estimatedCny;
  const reason =
    props.generationBlockedReason ||
    ((props.coverBusy && Boolean(callback)) || submitting
      ? "图片正在生成，请稍候。"
      : !props.body.trim()
        ? "先写好并保存文案，再生成图片。"
        : callback &&
            kind !== "cover" &&
            !references.some(asset => asset.id === referenceId)
          ? "请选择一张参考图；还没有图片时，可以先生成封面。"
          : cost == null
            ? "正在获取生成费用。"
            : "");
  return (
    <>
      <button type="button" className={control} onClick={() => setOpen(true)}>
        生成图片
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>封面、插图和底图</DialogTitle>
            <DialogDescription>
              根据当前文章生成，结果保留在仓库，选好后再使用。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2" role="group" aria-label="图片用途">
            {(
              [
                ["cover", "封面"],
                ["illustration", "插图"],
                ["background", "底图"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={submitting}
                aria-pressed={kind === value}
                className={`${control} flex-1 ${kind === value ? "bg-primary text-primary-foreground" : ""}`}
                onClick={() => {
                  setKind(value);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {callback && kind !== "cover" && (
            <div
              className="flex gap-2 overflow-x-auto"
              role="group"
              aria-label="选择图片参考"
            >
              {references.map(asset => (
                <button
                  type="button"
                  key={asset.id}
                  aria-label={`参考：${asset.label}`}
                  aria-pressed={referenceId === asset.id}
                  onClick={() => setReference(asset.id)}
                  className={`w-16 shrink-0 rounded border-2 ${referenceId === asset.id ? "border-primary" : "border-transparent"}`}
                >
                  <img
                    src={asset.imageUrl}
                    alt={asset.label}
                    className="aspect-square w-full rounded object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          <textarea
            aria-label="图片生成要求"
            rows={3}
            maxLength={1000}
            placeholder="想要怎样的画面？留空则根据文章生成。"
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            className={control}
          />
          {(reason || error || props.generationError) && (
            <p role="status" className="text-xs text-muted-foreground">
              {error || props.generationError || reason}
            </p>
          )}
          <button
            type="button"
            className={control}
            disabled={Boolean(reason)}
            onClick={async () => {
              if (reason || submitting) return;
              setSubmitting(true);
              setError("");
              try {
                if (!callback) {
                  const purpose =
                    kind === "cover"
                      ? "书籍封面，竖版3:4，无文字"
                      : kind === "illustration"
                        ? "文章插图，无文字"
                        : "适合衬托文字的淡雅底图，竖版3:4，留白充足，无文字";
                  const result = await generate.mutateAsync({
                    storyId: props.storyId,
                    prompt: `${purpose}。根据文章：${props.body}。补充要求：${instruction}`,
                    mode: "final",
                    imageProvider: "midjourney",
                    autoSelect: false,
                    costConfirmation: { accepted: true, estimatedCny: cost! },
                  });
                  await utils.storyAgent.storyMaterialState.invalidate({
                    storyId: props.storyId,
                  });
                  if (result.status === "error") throw new Error(result.error);
                  toast.success(
                    result.status === "ok"
                      ? "图片已放入仓库"
                      : "图片正在处理，稍后可在仓库查看"
                  );
                } else if (kind === "cover")
                  await props.onGenerateCover?.(instruction, props.body);
                else if (kind === "illustration")
                  await props.onGenerateIllustration?.(
                    referenceId!,
                    instruction,
                    props.body
                  );
                else await props.onGenerateTexture?.(referenceId!, instruction);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "生成失败，请稍后重试"
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting
              ? "正在生成…"
              : `确认生成 4 张${cost != null ? ` · ${formatComputeQuote(cost)}` : ""}`}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
