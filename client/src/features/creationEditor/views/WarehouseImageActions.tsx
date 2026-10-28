import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import { formatComputeQuote } from "@shared/computeMoney";
import {
  STUDIO_CREATE_EVENT,
  type StudioCreateRequest,
} from "@/features/publishingDraft/StudioCreateMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function requestWarehouseImage(
  storyId: number,
  imageId: number,
  role: "cover" | "illustration" | "background"
) {
  window.dispatchEvent(
    new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, {
      detail: {
        id: crypto.randomUUID(),
        storyId,
        kind: "layout",
        instruction: "",
        warehouseImage: { imageId, role },
      },
    })
  );
}

export function WarehouseImageActions({
  storyId,
  imageId,
  imageUrl,
  onDialogOpenChange,
}: {
  storyId: number;
  imageId: number;
  imageUrl: string;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { onDialogOpenChange?.(open); }, [open]);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<{ id: number; url: string } | null>(
    null
  );
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Generation belongs to the submitted story; it never switches another story's layout.
  const quote = estimateStoryboardMaskedEditCost();
  const button =
    "shrink-0 rounded-md border border-border px-2.5 py-2 text-xs hover:bg-muted disabled:opacity-50";
  return (
    <>
      <button
        className={button}
        onClick={() => requestWarehouseImage(storyId, imageId, "cover")}
      >
        设为封面
      </button>
      <button
        className={button}
        onClick={() => requestWarehouseImage(storyId, imageId, "illustration")}
      >
        作为插图
      </button>
      <button className={button} onClick={() => setOpen(true)}>
        参考生成底图
      </button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!generate.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>参考这张图生成底图</DialogTitle>
            <DialogDescription>
              沿用配色和材质，生成适合放文字的底图。原图保留，生成后由你选择是否使用。
            </DialogDescription>
          </DialogHeader>
          <img
            src={result?.url ?? imageUrl}
            alt={result ? "生成的底图" : "底图参考图"}
            className="max-h-64 w-full object-contain"
          />
          {result ? (
            <button
              className={button}
              onClick={() => {
                requestWarehouseImage(storyId, result.id, "background");
                setOpen(false);
              }}
            >
              使用这张底图
            </button>
          ) : (
            <>
              <textarea
                aria-label="底图要求（选填）"
                placeholder="补充要求（选填）"
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                maxLength={1000}
                disabled={generate.isPending}
                className="w-full rounded border p-2 text-sm"
              />
              <button
                className={button}
                disabled={generate.isPending}
                onClick={async () => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  try {
                    const generated = await generate.mutateAsync({
                      storyId,
                      warehouseTextureSourceId: imageId,
                      explicitInstruction: instruction.trim() || undefined,
                      costConfirmation: {
                        accepted: true,
                        estimatedCny: quote.estimatedCny,
                      },
                    });
                    if (
                      generated.status !== "ok" ||
                      !generated.imageId ||
                      !generated.imageUrl
                    )
                      throw new Error(
                        generated.status === "error"
                          ? generated.error
                          : "生成结果尚未就绪，请稍后查看仓库"
                      );
                    await utils.storyAgent.storyMaterialState.invalidate({
                      storyId,
                    });
                    if (alive.current)
                      setResult({
                        id: generated.imageId,
                        url: generated.imageUrl,
                      });
                    toast.success("底图已存入仓库，原图保留");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "生成失败"
                    );
                  } finally {
                    inFlight.current = false;
                  }
                }}
              >
                {generate.isPending
                  ? "正在生成…"
                  : `确认生成 1 张 · ${formatComputeQuote(quote.estimatedCny)}`}
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
