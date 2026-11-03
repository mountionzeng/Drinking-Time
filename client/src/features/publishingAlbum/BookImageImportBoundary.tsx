import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type DragEvent,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  bookImageSources,
  importBookImages,
  mightContainBookImages,
  type BookImageSource,
} from "./bookImageImport";
import {
  bookImageDropAnchor,
  captureBookImageAnchor,
  type BookImageAnchor,
} from "./bookImageInsert";
import type { WritingBlock } from "./chapterBlockTree";

type Props = {
  storyId: number;
  scope: string;
  disabled: boolean;
  blocks: WritingBlock[];
  activeId: string | null;
  onInsert(anchor: BookImageAnchor, urls: string[]): void;
  children: ReactNode;
};

/** A transparent event boundary: paste/drop imports into the existing story warehouse. */
export function BookImageImportBoundary(props: Props) {
  const _ui = useUiText();
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const lifetime = useRef<object | null>({});
  const pending = useRef(false);
  const [progress, setProgress] = useState("");
  const [marker, setMarker] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const upload = trpc.creationAgent.importStoryMaterial.useMutation();
  const utils = trpc.useUtils();
  useEffect(() => {
    lifetime.current = {};
    return () => {
      lifetime.current = null;
    };
  }, [props.storyId, props.scope]);

  async function insert(sources: BookImageSource[], anchor: BookImageAnchor) {
    if (props.disabled || !sources.length) return;
    if (pending.current) {
      toast.info(_ui("图片正在加入，请稍候。"));
      return;
    }
    pending.current = true;
    const owner = lifetime.current,
      storyId = props.storyId,
      scope = props.scope;
    const spine = storySpineStore.getState();
    const current = () =>
      lifetime.current === owner &&
      owner !== null &&
      latest.current.storyId === storyId &&
      latest.current.scope === scope &&
      !latest.current.disabled &&
      storySpineStore.getState().accountId === spine.accountId &&
      storySpineStore.getState().storyScopeEpoch === spine.storyScopeEpoch;
    try {
      const result = await importBookImages(
        sources,
        async image => {
          const result = await upload.mutateAsync({ ...image, storyId });
          if (result.status !== "ok") throw new Error(result.error);
          if (result.kind !== "image")
            throw new Error(_ui("请使用 PNG、JPG 或 WebP 图片。"));
          // Refresh the captured story, even if the editor has since closed.
          void Promise.allSettled([
            utils.storyAgent.storyMaterialState.invalidate({ storyId }),
            utils.storyAgent.storyImages.invalidate({ storyId }),
          ]);
          return result.imageUrl;
        },
        current,
        (done, total) =>
          setProgress(_ui("正在加入图片 {0}/{1}…", [done, total]))
      );
      if (!current()) {
        if (result.urls.length)
          toast.info(_ui("图片已保留在原故事的素材仓库。"));
        return;
      }
      if (result.urls.length) latest.current.onInsert(anchor, result.urls);
      if (result.errors.length)
        toast.error(_ui("部分图片未能加入：{0}", [result.errors.join("；")]));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? _ui(error.message)
          : _ui("图片导入失败，请稍后再试。")
      );
    } finally {
      pending.current = false;
      if (lifetime.current) setProgress("");
    }
  }

  function dropTarget(event: DragEvent) {
    const host = root.current;
    if (!host) return null;
    const boxes = Array.from(
      host.querySelectorAll<HTMLElement>("[data-book-block]")
    ).map(element => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.bookBlock!,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    });
    const anchor = bookImageDropAnchor(boxes, event.clientX, event.clientY);
    const box = boxes.find(box => box.id === anchor?.id);
    const bounds = host.getBoundingClientRect();
    return {
      anchor: anchor ?? captureBookImageAnchor(props.blocks),
      marker:
        box && anchor
          ? {
              left: box.left - bounds.left,
              width: box.right - box.left,
              top:
                (anchor.side === "before" ? box.top : box.bottom) - bounds.top,
            }
          : null,
    };
  }

  return (
    <div
      ref={root}
      className="relative"
      onPasteCapture={event => {
        if (root.current && !root.current.contains(event.target as Node))
          return;
        const sources = bookImageSources(event.clipboardData);
        if (!sources.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (props.disabled) return;
        const field =
          event.target instanceof HTMLTextAreaElement ? event.target : null;
        const anchor = captureBookImageAnchor(
          props.blocks,
          field?.dataset.bookTextId ?? props.activeId,
          field?.selectionStart
        );
        void insert(sources, anchor);
      }}
      onDragOver={event => {
        if (root.current && !root.current.contains(event.target as Node))
          return;
        if (!mightContainBookImages(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect =
          props.disabled || pending.current ? "none" : "copy";
        if (!props.disabled && !pending.current)
          setMarker(dropTarget(event)?.marker ?? null);
      }}
      onDragLeave={event => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setMarker(null);
      }}
      onDrop={event => {
        if (root.current && !root.current.contains(event.target as Node))
          return;
        if (!mightContainBookImages(event.dataTransfer)) return;
        const sources = bookImageSources(event.dataTransfer);
        setMarker(null);
        if (!sources.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (props.disabled) return;
        void insert(
          sources,
          dropTarget(event)?.anchor ?? captureBookImageAnchor(props.blocks)
        );
      }}
    >
      {props.children}
      {marker && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-40 h-0.5 bg-primary"
          style={marker}
        />
      )}
      {progress && (
        <p
          role="status"
          className="pointer-events-none sticky bottom-2 z-40 w-fit rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm"
        >
          {progress}
        </p>
      )}
    </div>
  );
}
