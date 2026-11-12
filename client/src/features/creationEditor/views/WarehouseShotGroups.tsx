import { useEffect, useMemo, type ReactNode } from "react";
import { Music2, Loader2, Video } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { CreationEditorShot } from "../types";
import {
  buildWarehouseShotGroups,
  openShotWarehouse,
  warehouseMediaOrder,
  WHOLE_STORY_MEDIA,
  type WarehouseMedia,
  type WarehouseShotGroup,
} from "../warehouseShotMedia";

export function useWarehouseShotGroups(
  storyId: number | null | undefined,
  shots: readonly CreationEditorShot[],
  materialState?: StoryMaterialState | null,
  watch = false
) {
  const enabled = Boolean(storyId && storyId > 0);
  const revisions = trpc.storyAgent.chatImageRevisions.useQuery(
    { storyId: storyId ?? 0 },
    { enabled, refetchInterval: enabled && watch ? 5000 : false }
  );
  const audio = trpc.timelineMedia.audioAssetLibrary.useQuery(
    { storyId: storyId ?? 0 },
    { enabled, refetchInterval: enabled && watch ? 5000 : false }
  );
  const groups = useMemo(
    () =>
      enabled
        ? buildWarehouseShotGroups({
            storyId: storyId!,
            shots,
            materialState,
            revisions: revisions.data,
            audio: audio.data,
          })
        : [],
    [enabled, storyId, shots, materialState, revisions.data, audio.data]
  );
  return {
    groups,
    loading: revisions.isLoading || audio.isLoading,
    error: revisions.error || audio.error,
  };
}
export function warehouseGroupName(
  group: WarehouseShotGroup,
  ui: ReturnType<typeof useUiText>
) {
  return group.shotCode
    ? ui("第 {0} 镜", [group.shotCode])
    : ui(group.id === WHOLE_STORY_MEDIA ? "全片" : "未归类");
}
export function warehouseMediaName(
  group: WarehouseShotGroup,
  media: WarehouseMedia,
  ui: ReturnType<typeof useUiText>
) {
  return `${warehouseGroupName(group, ui)} · ${ui(media.role)} ${media.version}`;
}

export function WarehouseShotMenu({
  groups,
  groupId,
  active,
  onGroupChange,
}: {
  groups: WarehouseShotGroup[];
  groupId: string | null;
  active: boolean;
  onGroupChange: (id: string) => void;
}) {
  const ui = useUiText();
  const group = groups.find(g => g.id === groupId) ?? groups[0];
  const label = (g: WarehouseShotGroup) =>
    `${warehouseGroupName(g, ui)}${g.subject ? ` · ${g.subject}` : ""} · ${g.items.length}`;
  return (
    <Select
      value={group?.id}
      onValueChange={onGroupChange}
      onOpenChange={open => {
        if (open && group) onGroupChange(group.id);
      }}
    >
      <SelectTrigger
        disabled={!group}
        aria-label={ui("镜头素材组 / Shot group")}
        title={group ? label(group) : ui("镜头 / Shots")}
        className={`data-[size=default]:h-7 min-w-24 max-w-[220px] shrink rounded-full border-0 px-2 py-0 text-xs font-medium shadow-none ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
      >
        <span className="truncate">
          {group ? label(group) : ui("镜头 / Shots")}
        </span>
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[calc(100vw-24px)]">
        {groups.map(g => (
          <SelectItem key={g.id} value={g.id}>
            {label(g)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WarehouseShotGroups({
  groups,
  groupId,
  renderImage,
  onSelectVideo,
  loading,
  error,
  leading,
}: {
  groups: WarehouseShotGroup[];
  groupId: string | null;
  renderImage: (
    item: WarehouseMedia,
    group: WarehouseShotGroup,
    name: string
  ) => ReactNode;
  onSelectVideo: (id: number) => void;
  loading: boolean;
  error: unknown;
  leading?: ReactNode;
}) {
  const ui = useUiText();
  const group = groups.find(g => g.id === groupId) ?? groups[0];
  return (
    <section aria-label={ui("按镜头归类 / By shot")}>
      {error ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {ui("部分素材暂未读到，正在重试。")}
        </p>
      ) : null}
      <div
        className="flex flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden pb-1 custom-scrollbar"
        data-testid="warehouse-shot-strip"
        key={group?.id}
      >
        {leading}
        {group?.items.map(item => {
          const name = warehouseMediaName(group, item, ui);
          if (item.kind === "image") return renderImage(item, group, name);
          return (
            <article
              key={item.key}
              className="relative flex w-[128px] shrink-0 flex-col overflow-hidden rounded-md bg-background"
              title={item.originalName || name}
            >
              {item.kind === "video" ? (
                <div className="relative h-[84px] bg-muted/30">
                  {item.ready && item.url ? (
                    <video
                      src={item.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain"
                      aria-label={name}
                    />
                  ) : (
                    <div role="status" className="flex h-full flex-col items-center justify-center gap-2 text-[10px] text-muted-foreground">
                      {item.renderState === "rendering" ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none text-primary" /> : <Video className="size-5" />}
                      {ui(item.renderState === "rendering" ? "生成中 / Generating" : item.renderState === "failed" ? "生成失败 / Failed" : item.renderState === "unknown" ? "状态待确认 / Checking" : "尚未就绪")}
                    </div>
                  )}
                  {item.durationSec != null && (
                    <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/65 px-1 text-[10px] text-white">
                      {item.durationSec.toFixed(1)}s
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex h-[84px] flex-col items-center justify-center gap-1 bg-muted/30">
                  <Music2 className="size-5 text-muted-foreground" />
                  {item.durationSec != null && (
                    <span className="text-[10px]">
                      {item.durationSec.toFixed(1)}s
                    </span>
                  )}
                  <audio
                    src={item.url ?? undefined}
                    controls
                    preload="none"
                    className="h-7 w-full"
                    aria-label={name}
                  />
                </div>
              )}
              {item.kind === "video" ? (
                <button
                  className="line-clamp-2 py-1 text-left text-[10px] leading-4"
                  onClick={() => onSelectVideo(item.id)}
                >
                  {name}
                </button>
              ) : (
                <p className="line-clamp-2 py-1 text-[10px] leading-4">
                  {name}
                </p>
              )}
            </article>
          );
        })}
        {!group?.items.length && !leading && (
          <p className="py-4 text-xs text-muted-foreground">
            {ui(
              loading
                ? "正在读取素材…"
                : "这个镜头还没有素材。生成后会自动保存在这里。"
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** Saved-media receipt; old/imported media is never announced as a new render. */
export function WarehouseCompletionNotice({
  storyId,
  shots,
  materialState,
  stableShotId,
  onContentChange,
}: {
  storyId: number;
  shots: readonly CreationEditorShot[];
  materialState?: StoryMaterialState | null;
  stableShotId?: string | null;
  onContentChange?: () => void;
}) {
  const ui = useUiText();
  const { groups } = useWarehouseShotGroups(
    storyId,
    shots,
    materialState,
    true
  );
  const latest = groups
    .filter(g => !stableShotId || g.id === stableShotId)
    .flatMap(group =>
      group.items.filter(i => i.ready).map(item => ({ group, item }))
    )
    .sort((a, b) => warehouseMediaOrder(b.item, a.item))[0];
  useEffect(() => {
    if (latest) onContentChange?.();
  }, [latest?.item.key, latest?.group.id, onContentChange]);
  if (!latest) return null;
  return (
    <p
      role="status"
      className="py-1 text-[11px] leading-5 text-muted-foreground"
      aria-label={ui("素材完成通知")}
    >
      {ui("最近素材：{0}，已保存到", [
        warehouseMediaName(latest.group, latest.item, ui),
      ])}
      <button
        type="button"
        className="text-primary underline underline-offset-2"
        onClick={() => openShotWarehouse(storyId, latest.group.id)}
      >
        {ui("仓库 / Warehouse")}
      </button>
      。
    </p>
  );
}
