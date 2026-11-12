import type { ImageAsset } from "@shared/imageAsset";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { ChatImageRevision } from "@shared/chatImageRevision";
import { displayShotCode } from "@shared/shotIdentity";
import { shotConversationImages } from "@/features/storyAgent/shotConversation";
import type { CreationEditorShot } from "./types";

export type WarehouseAudio = {
  id: number;
  displayName: string;
  mediaKind: string;
  durationFrames: number;
  createdAt: string | Date;
  audioUrl: string;
  stableShotId?: string | null;
};
export type WarehouseMedia = {
  key: string;
  id: number;
  kind: "image" | "video" | "audio";
  role: string;
  url: string | null;
  createdAt: number;
  version: string;
  durationSec?: number;
  originalName?: string;
  ready: boolean;
  renderState?: "rendering" | "failed" | "unknown";
};
export type WarehouseShotGroup = {
  id: string;
  shotCode?: string;
  subject?: string;
  items: WarehouseMedia[];
};
export const WHOLE_STORY_MEDIA = "warehouse:whole-story";
export const UNASSIGNED_MEDIA = "warehouse:unassigned";
const time = (value: string | number | Date | undefined) => {
  const result = value == null ? NaN : +new Date(value);
  return Number.isFinite(result) ? result : 0;
};
export function warehouseMediaOrder(a: WarehouseMedia, b: WarehouseMedia) {
  return (
    a.createdAt - b.createdAt || a.id - b.id || a.kind.localeCompare(b.kind)
  );
}
function imageRole(shot: CreationEditorShot, id: number) {
  try {
    const params = JSON.parse(shot.generationParams || "{}");
    const roles = params.storyboardFrameRoles ?? {};
    if ((roles.firstImageId ?? params.firstFrameImageId) === id) return "首帧";
    if ((roles.lastImageId ?? params.lastFrameImageId) === id) return "尾帧";
    if (
      (roles.referenceImageIds ?? params.referenceFrameImageIds ?? []).includes(
        id
      )
    )
      return "参考帧";
  } catch {
    /* Old assets may have no structured frame role. */
  }
  return "图片";
}

/** Explicit references survive legacy assets that predate stable shot ownership. */
export function shotExplicitImageIds(
  shot: Pick<
    CreationEditorShot,
    "publishingVideo" | "timelineItem" | "generationParams"
  >
): number[] {
  const ids = [...(shot.publishingVideo?.referenceImageIds ?? [])];
  for (const id of [
    shot.publishingVideo?.referenceImageId,
    shot.timelineItem?.referencedImageId,
  ])
    if (id) ids.push(id);
  ids.push(...(shot.timelineItem?.imageClips ?? []).map(clip => clip.imageId));
  try {
    const params = JSON.parse(shot.generationParams || "{}");
    const roles = params.storyboardFrameRoles ?? {};
    ids.push(
      ...[
        roles.firstImageId,
        roles.lastImageId,
        params.firstFrameImageId,
        params.lastFrameImageId,
        ...(Array.isArray(roles.referenceImageIds)
          ? roles.referenceImageIds
          : []),
        ...(Array.isArray(params.referenceFrameImageIds)
          ? params.referenceFrameImageIds
          : []),
      ]
    );
  } catch {
    /* Plain-text parameters carry no explicit references. */
  }
  return [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))];
}

/** A read-only archive projection. Grouping never adopts, renames or copies assets. */
export function buildWarehouseShotGroups(input: {
  storyId: number;
  shots: readonly CreationEditorShot[];
  materialState?: StoryMaterialState | null;
  revisions?: readonly ChatImageRevision[];
  audio?: readonly WarehouseAudio[];
}): WarehouseShotGroup[] {
  const state =
    input.materialState?.storyId === input.storyId ? input.materialState : null;
  const images = new Map<number, ImageAsset>();
  for (const image of [
    ...(state?.warehouseImages ?? state?.unassignedImages ?? []),
    ...(state?.shots.flatMap(s => [
      ...s.imageVersions,
      ...(s.relatedImages ?? []),
      ...(s.imageGenerationReferences ?? []),
      ...(s.imageGenerationReference ? [s.imageGenerationReference] : []),
    ]) ?? []),
  ])
    if (image.storyId === input.storyId) images.set(image.id, image);
  const groups: WarehouseShotGroup[] = [];
  const usedImages = new Set<number>();
  const usedTakes = new Set<number>();
  const asImage = (
    image: Pick<ImageAsset, "id" | "imageUrl"> & Partial<ImageAsset>,
    role: string,
    at?: number
  ): WarehouseMedia => ({
    key: `image:${image.id}`,
    id: image.id,
    kind: "image",
    role,
    url: image.imageUrl,
    createdAt: time(image.createdAt) || at || 0,
    version: "",
    ready: Boolean(image.imageUrl && image.availability !== "missing"),
  });
  const allTakes = new Map(
    [
      ...(state?.shots.flatMap(s => s.videoTakes) ?? []),
      ...(state?.unassignedVideoTakes ?? []),
      ...(state?.reusableVideoTakes ?? []),
    ]
      .filter(t => t.storyId === input.storyId)
      .map(t => [t.id, t])
  );
  const asVideo = (
    take: NonNullable<StoryMaterialState>["unassignedVideoTakes"][number]
  ): WarehouseMedia => ({
    key: `video:${take.id}`,
    id: take.id,
    kind: "video",
    role: "视频",
    url: take.videoUrl,
    createdAt: time(take.createdAt),
    version: "",
    durationSec: take.durationSec ?? undefined,
    renderState: ["submitted", "processing"].includes(take.status) ? "rendering" : take.status === "failed" ? "failed" : take.status === "timeout" ? "unknown" : undefined,
    ready: Boolean(
      take.videoUrl && ["available", "unfollowable"].includes(take.status)
    ),
  });
  for (const shot of input.shots) {
    const id = shot.stableShotId ?? shot.shotIdentity;
    if (!id) continue;
    const material = state?.shots.find(s => s.stableShotId === id);
    const revisions = (input.revisions ?? []).filter(
      r => r.stableShotId === id
    );
    const related = [
      ...(material?.imageVersions ?? []),
      ...(material?.relatedImages ?? []),
    ].map(i => i.id);
    related.push(...shotExplicitImageIds(shot));
    related.push(...revisions.flatMap(r => r.candidates.map(c => c.imageId)));
    const items = new Map<string, WarehouseMedia>();
    for (const image of shotConversationImages(
      [...images.values()],
      id,
      related
    )) {
      items.set(`image:${image.id}`, asImage(image, imageRole(shot, image.id)));
      usedImages.add(image.id);
    }
    for (const revision of revisions)
      for (const image of revision.candidates) {
        if (!items.has(`image:${image.imageId}`))
          items.set(
            `image:${image.imageId}`,
            asImage(
              { id: image.imageId, imageUrl: image.imageUrl },
              imageRole(shot, image.imageId),
              revision.createdAt
            )
          );
        usedImages.add(image.imageId);
      }
    for (const take of allTakes.values())
      if (take.stableShotId === id) {
        items.set(`video:${take.id}`, asVideo(take));
        usedTakes.add(take.id);
      }
    groups.push({
      id,
      shotCode: displayShotCode(shot),
      subject: shot.subject,
      items: [...items.values()],
    });
  }
  const whole: WarehouseShotGroup = { id: WHOLE_STORY_MEDIA, items: [] };
  const unassigned: WarehouseShotGroup = { id: UNASSIGNED_MEDIA, items: [] };
  for (const image of images.values())
    if (!usedImages.has(image.id))
      unassigned.items.push(asImage(image, "图片"));
  for (const take of allTakes.values())
    if (!usedTakes.has(take.id)) unassigned.items.push(asVideo(take));
  for (const asset of input.audio ?? []) {
    const group = asset.stableShotId
      ? (groups.find(g => g.id === asset.stableShotId) ?? unassigned)
      : whole;
    group.items.push({
      key: `audio:${asset.id}`,
      id: asset.id,
      kind: "audio",
      role:
        (
          {
            narration: "旁白",
            music: "音乐",
            sfx: "音效",
            ambience: "环境声",
          } as Record<string, string>
        )[asset.mediaKind] ?? "声音",
      url: asset.audioUrl,
      createdAt: time(asset.createdAt),
      version: "",
      originalName: asset.displayName,
      durationSec: asset.durationFrames / 30,
      ready: true,
    });
  }
  if (whole.items.length) groups.push(whole);
  if (unassigned.items.length) groups.push(unassigned);
  for (const group of groups) {
    // IDs, rather than adoption order, keep a version stable when the selected take changes.
    const versions = new Map<string, number>();
    for (const item of [...group.items].sort((a, b) => a.id - b.id)) {
      const kind = item.kind === "audio" ? item.role : item.kind;
      const n = (versions.get(kind) ?? 0) + 1;
      versions.set(kind, n);
      item.version = `V${String(n).padStart(2, "0")}`;
    }
    group.items.sort(warehouseMediaOrder);
  }
  return groups;
}

export const OPEN_SHOT_WAREHOUSE = "dt:open-shot-warehouse";
export function openShotWarehouse(storyId: number, groupId: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SHOT_WAREHOUSE, { detail: { storyId, groupId } })
  );
}
