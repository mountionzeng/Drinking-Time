import { shotConversationImages } from "../shotConversation";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { shotChangeHistory, type ShotChange } from "@shared/shotChangeHistory";
import { displayShotCode } from "@shared/shotIdentity";
import type { StoryboardFieldVersions } from "@shared/storyboardFieldVersions";
import type { ChatMessage } from "../types";
import type { VideoTakeAsset } from "@shared/videoAsset";

type Shot = {
  stableShotId?: string | null;
  shotIdentity?: string | null;
  shotNo: number;
  cueCode?: string | null;
  subject?: string | null;
  dialogue?: string | null;
  sound?: string | null;
  scriptText?: string | null;
  promptDraft?: string | null;
  videoPrompt?: string | null;
  videoTakes?: VideoTakeAsset[];
};

/** The existing composer is the edit box; this supplies its target and saved history. */
export function ShotChatInspector({
  storyId,
  shot,
  fields,
  videoHistory,
  messages,
  imageUrl,
  onSelectImage,
  selectedImageId,
  archiveImages = [],
  relatedImageIds = [],
}: {
  storyId: number;
  shot: Shot;
  fields: StoryboardFieldVersions;
  messages?: readonly ChatMessage[];
  videoHistory?: unknown;
  imageUrl?: string;
  archiveImages?: readonly {
    id: number;
    imageUrl: string;
    shotIdentity?: string | null;
    parentImageId?: number | null;
    assignment?: string;
  }[];
  relatedImageIds?: readonly number[];
  selectedImageId?: number | null;
  onSelectImage?: (image: {
    imageId: number;
    imageUrl: string;
    stableShotId: string;
    shotNo: number;
  }) => void;
}) {
  const ui = useUiText();
  const revisions = trpc.storyAgent.chatImageRevisions.useQuery(
    { storyId },
    { refetchInterval: 5000 }
  );
  const stableShotId = shot.stableShotId ?? shot.shotIdentity ?? "";
  const history = shotChangeHistory({
    storyId,
    stableShotId,
    fields,
    videoHistory,
    messages,
    images: revisions.data,
    takes: shot.videoTakes,
  });
  const label = displayShotCode(shot);
  const images = shotConversationImages(
    archiveImages,
    stableShotId,
    relatedImageIds
  );
  const allImages = new Map(
    images.map(image => [
      image.id,
      { imageId: image.id, imageUrl: image.imageUrl },
    ])
  );
  for (const revision of revisions.data ?? [])
    if (revision.stableShotId === stableShotId)
      for (const image of revision.candidates)
        allImages.set(image.imageId, image);
  const unassigned = archiveImages.filter(
    image => image.assignment === "unassigned" && !allImages.has(image.id)
  );
  const renderImage = (image: { imageId: number; imageUrl: string }) => (
    <figure key={image.imageId}>
      <button
        type="button"
        aria-pressed={selectedImageId === image.imageId}
        aria-label={ui("选择图片 #{0}", [image.imageId])}
        className="block w-full rounded focus-visible:outline focus-visible:outline-2 aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]"
        onClick={() =>
          onSelectImage?.({ ...image, stableShotId, shotNo: shot.shotNo })
        }
      >
        <img
          src={image.imageUrl}
          alt={ui("图片 #{0}", [image.imageId])}
          loading="lazy"
          className="h-28 w-full rounded object-contain"
        />
      </button>
      <figcaption className="text-[10px] text-muted-foreground">
        #{image.imageId}
      </figcaption>
    </figure>
  );
  const renderChange = (change: ShotChange) => (
    <details key={change.id} className="border-t border-border/50 py-1.5">
      <summary className="cursor-pointer text-[11px] leading-5">
        {ui(change.title)}
        {change.revision ? ` · V${change.revision}` : ""}
        {change.snapshot && <span> · {ui("剪辑快照")}</span>}
        <span className="ml-1 text-[9px] text-muted-foreground">
          {change.at ? new Date(change.at).toLocaleString() : ui("时间未记录")}
        </span>
      </summary>
      <div className="space-y-1.5 pt-1.5 text-[11px] leading-5 whitespace-pre-wrap break-words">
        <p className="text-[10px] text-muted-foreground">
          {change.editorUserId
            ? ui("编辑者：用户 #{0}", [change.editorUserId])
            : ui("此记录未保存编辑者")}
        </p>
        {change.instruction && <p>{change.instruction}</p>}
        {change.before !== undefined && (
          <div>
            <span className="text-muted-foreground">{ui("修改前")}</span>
            <p className="opacity-60">{change.before || ui("空内容")}</p>
          </div>
        )}
        {change.after !== undefined && (
          <div>
            <span className="text-muted-foreground">
              {ui(change.before === undefined ? "保留的内容" : "修改后")}
            </span>
            <p>{change.after || ui("空内容")}</p>
          </div>
        )}
        {change.images && (
          <div className="grid grid-cols-2 gap-2">
            {change.images.map(renderImage)}
          </div>
        )}
        {change.video && (
          <figure>
            <video
              src={change.video.url}
              controls
              preload="none"
              className="max-h-40 w-full rounded"
              aria-label={ui("视频 Take {0}", [change.video.takeId])}
            />
            <figcaption>
              {ui(
                change.video.selected
                  ? "视频 Take {0} · 当前已采用"
                  : "视频 Take {0} · 可回复“采用 Take {0}”放入本镜",
                [change.video.takeId]
              )}
            </figcaption>
          </figure>
        )}
      </div>
    </details>
  );
  return (
    <section
      aria-label={ui("第 {0} 镜 · 修改与历史", [label])}
      className="mt-2 rounded-md border-l-2 border-[var(--nayin-accent)] bg-[var(--nayin-glow)] px-2.5 py-2"
    >
      <div className="flex items-start gap-2">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={ui("当前镜头画面")}
            className="h-12 w-16 shrink-0 rounded object-contain"
          />
        )}
        <div className="min-w-0 flex-1">
          <strong className="text-xs">{ui("第 {0} 镜 · 记录", [label])}</strong>
          <p className="truncate text-[11px] text-muted-foreground">
            {shot.subject}
          </p>
        </div>
      </div>
      <details open className="mt-2">
        <summary className="cursor-pointer text-xs">
          {ui("本镜图片 · {0} 张", [allImages.size])}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[...allImages.values()].map(renderImage)}
        </div>
      </details>
      {unassigned.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {ui("未标记镜头的旧图片 · {0} 张", [unassigned.length])}
          </summary>
          <p className="my-1 text-[10px] text-muted-foreground">
            {ui("旧流程未保存这些图片的镜头归属，原图仍在这里。")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {unassigned.map(image =>
              renderImage({ imageId: image.id, imageUrl: image.imageUrl })
            )}
          </div>
        </details>
      )}
      <div className="mt-2">
        <details className="text-[11px]">
          <summary className="cursor-pointer py-1">
            {ui("当前镜头内容")}
          </summary>
          {(
            [
              ["剧本", shot.scriptText],
              ["图片要求", shot.promptDraft],
              ["视频要求", shot.videoPrompt],
              ["台词", shot.dialogue],
              ["声音", shot.sound],
            ] as const
          )
            .filter(([, text]) => text)
            .map(([title, text]) => (
              <div key={title} className="py-1">
                <span className="text-muted-foreground">{ui(title)}</span>
                <p className="whitespace-pre-wrap break-words leading-5">
                  {text}
                </p>
              </div>
            ))}
        </details>
        <p className="py-1 text-[10px] text-muted-foreground">
          {ui("修改历史 · {0} 条", [history.length])}
        </p>
        {history.slice(0, 3).map(renderChange)}
        {history.length > 3 && (
          <details>
            <summary className="cursor-pointer py-1 text-[11px]">
              {ui("更早的修改 · {0} 条", [history.length - 3])}
            </summary>
            {history.slice(3).map(renderChange)}
          </details>
        )}
        {!history.length && (
          <p className="text-[10px] text-muted-foreground">
            {ui("还没有这个镜头的修改记录。")}
          </p>
        )}
        {revisions.error && (
          <p role="status" className="text-[10px]">
            {ui("图片历史暂未读到，文字历史仍可查看。")}
          </p>
        )}
      </div>
    </section>
  );
}
