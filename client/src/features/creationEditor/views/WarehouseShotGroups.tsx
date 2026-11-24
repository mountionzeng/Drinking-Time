import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Music2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useUiLanguage, useUiText } from "@/features/uiLanguage/UiLanguage";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { WarehouseVideoThumbnail } from "./WarehouseVideoThumbnail";
import { WarehouseAssetCard } from "./WarehouseAssetCard";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { CreationEditorShot } from "../types";
import {
  buildWarehouseShotGroups,
  openShotWarehouse,
  warehouseMediaOrder,
  WHOLE_STORY_MEDIA,
  UNASSIGNED_MEDIA,
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
  const artDirection = useStorySpine(state => state.activeStoryId === storyId ? state.artDirection : undefined);
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
            artDirection,
          })
        : [],
    [enabled, storyId, shots, materialState, revisions.data, audio.data, artDirection]
  );
  return {
    groups,
    loading: revisions.isLoading || audio.isLoading,
    error: revisions.error || audio.error,
    refetch: () => { void revisions.refetch(); void audio.refetch(); },
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
  const choices = groups.filter(g => g.id !== UNASSIGNED_MEDIA);
  const group = choices.find(g => g.id === groupId);
  const unassignedCount = groups.find(g => g.id === UNASSIGNED_MEDIA)?.items.length ?? 0;
  const label = (g: WarehouseShotGroup) =>
    `${warehouseGroupName(g, ui)}${g.subject ? ` · ${g.subject}` : ""} · ${g.items.length}`;
  return (
    <><Select
      value={active ? group?.id ?? "" : ""}
      onValueChange={onGroupChange}
    >
      <SelectTrigger
        disabled={choices.length === 0}
        aria-label={ui("镜头素材组 / Shot group")}
        title={active && group ? label(group) : ui("按镜头归类 / By shot")}
        className={`data-[size=default]:h-7 min-w-24 max-w-[220px] shrink rounded-full border-0 px-2 py-0 text-xs font-medium shadow-none ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
      >
        <span className="truncate">
          {active && group ? label(group) : ui("按镜头归类 / By shot")}
        </span>
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[calc(100vw-24px)]">
        {choices.map(g => (
          <SelectItem key={g.id} value={g.id}>
            {label(g)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <button type="button" aria-pressed={active && groupId === UNASSIGNED_MEDIA}
      className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted aria-pressed:bg-primary/10 aria-pressed:text-primary"
      onClick={() => onGroupChange(UNASSIGNED_MEDIA)}>{ui("未归类")} {unassignedCount}</button></>
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
  storyId = 0,
  focusedKeys = [],
}: {
  groups: WarehouseShotGroup[];
  groupId: string | null;
  renderImage: (
    item: WarehouseMedia,
    group: WarehouseShotGroup,
    name: string
  ) => ReactNode;
  onSelectVideo: (id: number, sourceTimeSec?: number) => void;
  loading: boolean;
  error: unknown;
  leading?: ReactNode;
  storyId?: number;
  focusedKeys?: readonly string[];
}) {
  const ui = useUiText();
  const group = groups.find(g => g.id === groupId);
  const strip = useRef<HTMLDivElement>(null);
  const { language } = useUiLanguage();
  const focusSignature = focusedKeys.join("|");
  useEffect(() => {
    const root = strip.current;
    if (!root || !focusedKeys.length) return;
    const target = [...root.querySelectorAll<HTMLElement>("[data-warehouse-media-key]")]
      .find(node => node.dataset.warehouseMediaKey === focusedKeys[0]);
    if (target) root.scrollTo({ left: root.scrollLeft + target.getBoundingClientRect().left - root.getBoundingClientRect().left - (root.clientWidth - target.clientWidth) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [group?.id, focusSignature]);
  return (
    <section aria-label={ui("按镜头归类 / By shot")}>
      {groupId === UNASSIGNED_MEDIA && Boolean(group?.items.length) &&
        <p className="mb-1 text-xs text-muted-foreground">{ui("这些素材还没有关联到当前版本的镜头。")}</p>}
      {error ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {ui("部分素材暂未读到，正在重试。")}
        </p>
      ) : null}
      {focusedKeys.length > 0 && <p className="mb-1 text-[10px] text-muted-foreground">{language === "en" ? "From the conversation in view" : "正在查看的对话素材 / From viewed chat"}</p>}
      <div ref={strip}
        className="flex flex-nowrap items-start gap-1.5 overflow-x-auto overflow-y-hidden pb-1 custom-scrollbar"
        data-testid="warehouse-shot-strip"
        key={group?.id}
      >
        {leading}
        {group && [...group.items].sort(warehouseMediaOrder).map(item => {
          const name = warehouseMediaName(group, item, ui);
          return (
            <article
              key={item.key}
              data-warehouse-media-key={item.key}
              data-conversation-focus={focusedKeys.includes(item.key) || undefined}
              className={`relative flex ${item.kind === "image" ? "w-[84px]" : "w-[128px]"} shrink-0 flex-col overflow-hidden rounded-md bg-background ${focusedKeys.includes(item.key) ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:border-2 after:border-primary" : ""}`}
              title={item.originalName || name}
            >
              {item.kind === "image" ? renderImage(item, group, name) : item.kind === "asset" ? <WarehouseAssetCard item={item} name={name} storyId={storyId} /> : item.kind === "video" ? (
                <WarehouseVideoThumbnail url={item.url} ready={item.ready} state={item.renderState} durationSec={item.durationSec} aspectRatio={item.aspectRatio}
                  label={`${ui("编辑视频 / Edit video")} · ${name}`} onSelect={time => onSelectVideo(item.id, time)} />
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
              ) : item.kind === "audio" ? (
                <p className="line-clamp-2 py-1 text-[10px] leading-4">
                  {name}
                </p>
              ) : null}
            </article>
          );
        })}
        {!group?.items.length && !leading && (
          <p className="py-4 text-xs text-muted-foreground">
            {ui(
              loading
                ? "正在读取素材…"
                : groupId === UNASSIGNED_MEDIA ? "没有未归类的素材。"
                : !group ? "播放位置没有对应镜头。"
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
  compact = false,
}: {
  storyId: number;
  shots: readonly CreationEditorShot[];
  materialState?: StoryMaterialState | null;
  stableShotId?: string | null;
  onContentChange?: () => void;
  compact?: boolean;
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
    .sort((a, b) => warehouseMediaOrder(a.item, b.item))[0];
  useEffect(() => {
    if (latest) onContentChange?.();
  }, [latest?.item.key, latest?.group.id, onContentChange]);
  if (!latest) return null;
  return (
    <p
      role="status"
      className={compact ? "flex min-w-0 items-center gap-1 text-[11px] leading-5 text-muted-foreground" : "py-1 text-[11px] leading-5 text-muted-foreground"}
      aria-label={ui("素材完成通知")}
    >
      {compact ? <span className="truncate" aria-label={warehouseMediaName(latest.group, latest.item, ui)}>{ui("最新")} {ui(latest.item.role)} {latest.item.version} ·</span> : ui("最近素材：{0}，已保存到", [
        warehouseMediaName(latest.group, latest.item, ui),
      ])}
      <button
        type="button"
        className="shrink-0 text-primary underline underline-offset-2"
        aria-label={ui("仓库 / Warehouse")}
        onClick={() => openShotWarehouse(storyId, latest.group.id)}
      >
        {compact ? ui("仓库") : ui("仓库 / Warehouse")}
      </button>
      {!compact && "。"}
    </p>
  );
}
