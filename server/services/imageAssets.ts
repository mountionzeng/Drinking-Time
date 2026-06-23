import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedImage, ImageSignal } from "../../drizzle/schema";
import {
  canonicalizeShotNo,
  isStyleReferenceShotNo,
  type ImageAsset,
  type ImageAssetAvailability,
} from "../../shared/imageAsset";
import {
  ensureShotIdentities,
  normalizeShotIdentity,
  shotIdentityFromShot,
} from "../../shared/shotIdentity";
import { localImageDir } from "./imageGen";
import {
  getImageSignalsForImages,
  getProjectById,
  getProjectGeneratedImages,
  getProjectShots,
  getStoryById,
  getStoryGeneratedImages,
  getStoryShots,
} from "../db";

type AssetProjectionInput = {
  images: GeneratedImage[];
  signals: ImageSignal[];
  validShotNos: string[];
  validShotIdentities?: string[];
  shotIdentityByShotNo?: ReadonlyMap<string, string>;
  availabilityByImageId?: ReadonlyMap<number, ImageAssetAvailability>;
};

type SignalDecision = {
  action: ImageSignal["action"];
  createdAt: Date;
  id: number;
};

function latestSignalByImage(
  signals: ImageSignal[]
): Map<number, SignalDecision> {
  const latest = new Map<number, SignalDecision>();
  for (const signal of signals) {
    if (signal.imageId == null) continue;
    const previous = latest.get(signal.imageId);
    if (
      !previous ||
      signal.createdAt.getTime() > previous.createdAt.getTime() ||
      (signal.createdAt.getTime() === previous.createdAt.getTime() &&
        signal.id > previous.id)
    ) {
      latest.set(signal.imageId, {
        action: signal.action,
        createdAt: signal.createdAt,
        id: signal.id,
      });
    }
  }
  return latest;
}

function compareSelectedAssets(left: ImageAsset, right: ImageAsset): number {
  const leftTime = left.selectedAt ? Date.parse(left.selectedAt) : 0;
  const rightTime = right.selectedAt ? Date.parse(right.selectedAt) : 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return right.id - left.id;
}

function compareCreatedAssets(left: ImageAsset, right: ImageAsset): number {
  const timeDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return timeDiff || right.id - left.id;
}

function storyBodyShotRefs(story: { body: unknown }): Array<{
  shotNo: string;
  shotIdentity: string | null;
}> {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  return ensureShotIdentities(
    shots.filter((shot): shot is Record<string, unknown> =>
      Boolean(shot && typeof shot === "object")
    )
  )
    .map(shot => {
      const obj = shot as Record<string, unknown>;
      const shotNo = canonicalizeShotNo(
        (obj.shotNo ?? obj.shotKey) as string | number | null | undefined
      );
      if (!shotNo) return null;
      return {
        shotNo,
        shotIdentity: shotIdentityFromShot(obj),
      };
    })
    .filter((ref): ref is { shotNo: string; shotIdentity: string | null } =>
      Boolean(ref)
    );
}

export function projectImageAssets({
  images,
  signals,
  validShotNos,
  validShotIdentities = [],
  shotIdentityByShotNo = new Map(),
  availabilityByImageId = new Map(),
}: AssetProjectionInput): ImageAsset[] {
  const validShots = new Set(
    validShotNos
      .map(shotNo => canonicalizeShotNo(shotNo))
      .filter((shotNo): shotNo is string => Boolean(shotNo))
  );
  const latestSignals = latestSignalByImage(signals);
  const validIdentities = new Set(
    validShotIdentities
      .map(identity => normalizeShotIdentity(identity))
      .filter((identity): identity is string => Boolean(identity))
  );

  const assets = images.map((image): ImageAsset => {
    const signal = latestSignals.get(image.id);
    const kind = isStyleReferenceShotNo(image.shotNo)
      ? "style_reference"
      : "story_frame";
    const canonicalShotNo = canonicalizeShotNo(image.shotNo);
    const shotIdentity =
      normalizeShotIdentity(
        (image as { shotIdentity?: string | null }).shotIdentity
      ) ??
      (canonicalShotNo
        ? (shotIdentityByShotNo.get(canonicalShotNo) ?? null)
        : null);
    const isIdentityAssigned = Boolean(
      shotIdentity && validIdentities.has(shotIdentity)
    );
    const isLegacyShotAssigned = Boolean(
      (!shotIdentity || validIdentities.size === 0) &&
        canonicalShotNo &&
        validShots.has(canonicalShotNo)
    );
    const assignment =
      kind === "style_reference"
        ? "style_reference"
        : isIdentityAssigned || isLegacyShotAssigned
          ? "shot"
          : "unassigned";
    const status =
      signal?.action === "swipe_right"
        ? "selected"
        : signal?.action === "swipe_left"
          ? "rejected"
          : "pending";

    return {
      id: image.id,
      projectId: image.projectId,
      storyId: image.storyId,
      userId: image.userId,
      rawShotNo: image.shotNo,
      canonicalShotNo,
      shotIdentity,
      imageKey: image.imageKey,
      imageUrl: image.imageUrl,
      prompt: image.prompt,
      generationType: image.generationType,
      parentImageId: image.parentImageId,
      isCurrent: image.isCurrent,
      maskKey: image.maskKey,
      createdAt: image.createdAt.toISOString(),
      kind,
      status,
      assignment,
      availability: availabilityByImageId.get(image.id) ?? "unknown",
      isPrimary: false,
      selectionSource: signal?.action === "swipe_right" ? "explicit" : "none",
      selectedAt:
        signal?.action === "swipe_right"
          ? signal.createdAt.toISOString()
          : null,
    };
  });

  const shotGroups = new Map<string, ImageAsset[]>();
  for (const asset of assets) {
    if (asset.assignment !== "shot") continue;
    const groupKey = asset.shotIdentity ?? asset.canonicalShotNo;
    if (!groupKey) continue;
    const group = shotGroups.get(groupKey) ?? [];
    group.push(asset);
    shotGroups.set(groupKey, group);
  }

  for (const group of Array.from(shotGroups.values())) {
    const explicitlySelected = group
      .filter(asset => asset.status === "selected")
      .sort(compareSelectedAssets);
    const primary = explicitlySelected[0];
    if (primary) {
      primary.isPrimary = true;
      continue;
    }

    const hasAnySignal = group.some(asset => latestSignals.has(asset.id));
    if (hasAnySignal) continue;
    const legacyPrimary = group
      .filter(asset => asset.isCurrent)
      .sort(compareCreatedAssets)[0];
    if (legacyPrimary) {
      legacyPrimary.isPrimary = true;
      legacyPrimary.selectionSource = "legacy";
    }
  }

  return assets.sort(compareCreatedAssets);
}

function localFileName(imageUrl: string): string | null {
  const match = /^\/(?:api\/images|local-images)\/([^/?#]+)(?:[?#].*)?$/.exec(
    imageUrl
  );
  if (!match) return null;
  const fileName = decodeURIComponent(match[1]);
  return path.basename(fileName) === fileName ? fileName : null;
}

export function localImagePathForUrl(imageUrl: string): string | null {
  const fileName = localFileName(imageUrl);
  return fileName ? path.join(localImageDir(), fileName) : null;
}

export async function resolveImageAvailability(
  imageUrl: string
): Promise<ImageAssetAvailability> {
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return "available";
  }
  const localPath = localImagePathForUrl(imageUrl);
  if (!localPath) return "unknown";
  try {
    await access(localPath);
    return "available";
  } catch {
    return "missing";
  }
}

export async function materializeImageInput(imageUrl: string): Promise<string> {
  const localPath = localImagePathForUrl(imageUrl);
  if (!localPath) return imageUrl;
  const bytes = await readFile(localPath);
  const extension = path.extname(localPath).toLowerCase();
  const mimeType =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export async function resolveAssetAvailability(
  images: GeneratedImage[]
): Promise<Map<number, ImageAssetAvailability>> {
  const entries = await Promise.all(
    images.map(
      async image =>
        [image.id, await resolveImageAvailability(image.imageUrl)] as const
    )
  );
  return new Map(entries);
}

export async function getProjectImageAssets(
  projectId: number,
  userId: number
): Promise<ImageAsset[]> {
  const project = await getProjectById(projectId, userId);
  if (!project) return [];
  const [images, shots] = await Promise.all([
    getProjectGeneratedImages(projectId, userId),
    getProjectShots(projectId),
  ]);
  const [signals, availabilityByImageId] = await Promise.all([
    getImageSignalsForImages(images.map(image => image.id)),
    resolveAssetAvailability(images),
  ]);
  return projectImageAssets({
    images,
    signals,
    validShotNos: shots.map(shot => shot.shotNo),
    availabilityByImageId,
  });
}

// 按当前故事取图片资产（故事为唯一单位）：每个故事的图片独立，故事间不共享。
// 显示层（Creation 镜头图片工作区 / 小酌看到的图片）用这个；带 userId 验归属。
export async function getStoryImageAssets(
  storyId: number,
  userId: number
): Promise<ImageAsset[]> {
  const story = await getStoryById(storyId, userId);
  if (!story) return [];
  const [images, shots] = await Promise.all([
    getStoryGeneratedImages(storyId, userId),
    getStoryShots(storyId, userId),
  ]);
  const [signals, availabilityByImageId] = await Promise.all([
    getImageSignalsForImages(images.map(image => image.id)),
    resolveAssetAvailability(images),
  ]);
  const storyShotRefs = storyBodyShotRefs(story);
  const shotIdentityByShotNo = new Map(
    storyShotRefs
      .filter(ref => ref.shotIdentity)
      .map(ref => [ref.shotNo, ref.shotIdentity as string])
  );
  return projectImageAssets({
    images,
    signals,
    validShotNos: Array.from(
      new Set([
        ...shots.map(shot => shot.shotNo),
        ...storyShotRefs.map(ref => ref.shotNo),
      ])
    ),
    validShotIdentities: storyShotRefs
      .map(ref => ref.shotIdentity)
      .filter((identity): identity is string => Boolean(identity)),
    shotIdentityByShotNo,
    availabilityByImageId,
  });
}
