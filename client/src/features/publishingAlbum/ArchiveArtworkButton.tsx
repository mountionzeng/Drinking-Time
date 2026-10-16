import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { prepareArtworkShareImages } from "./artworkShareImages";
import type { ImagePackResult } from "./imagePackComposition";

export function ArchiveArtworkButton({
  storyId,
  title,
  loadPages,
  disabled,
  className,
}: {
  storyId: number;
  title: string;
  loadPages(): Promise<ImagePackResult[]>;
  disabled?: boolean;
  className?: string;
}) {
  const archive = trpc.artworkShare.archive.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={disabled || busy}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setMessage("");
          try {
            const pages = await loadPages();
            const input = await prepareArtworkShareImages(
              pages.map(page => page.blob)
            );
            await archive.mutateAsync({
              storyId,
              title: title.trim() || "排版成品",
              pages: input,
              token: crypto.randomUUID(),
            });
            setMessage("已存入素材仓库，旧成品保留");
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "保存失败，请重试"
            );
          } finally {
            inFlight.current = false;
            setBusy(false);
            void utils.storyAgent.storyMaterialState.invalidate({ storyId });
            void utils.storyAgent.storyImages.invalidate({ storyId });
          }
        }}
      >
        {busy ? "正在保存成品…" : "存入素材仓库"}
      </button>
      {message && (
        <span role="status" className="text-xs text-muted-foreground">
          {message}
        </span>
      )}
    </div>
  );
}
