import { trpc } from '@/lib/trpc';
import { parseShotNo } from '@/features/mobileChat/types';
import type { GeneratedImageItem } from '@/features/mobileChat/types';
import { useStoryGeneratedImagesSlice } from '../spine/selectors';

type StoryImageAssetProjection = {
  id?: unknown;
  imageUrl?: unknown;
  prompt?: unknown;
  shotNo?: unknown;
  shotIdentity?: unknown;
  storyId?: unknown;
  status?: unknown;
  generationType?: unknown;
};

function normalizeAssetStatus(
  status: unknown,
  generationType: unknown,
): GeneratedImageItem['status'] {
  if (status === 'selected') return 'ready';
  if (status === 'pending' && generationType === 'generate') return 'draft';
  if (status === 'pending') return 'ready';
  return 'ready';
}

export function projectStoryImageAssetsForDisplay(
  rawImages: readonly StoryImageAssetProjection[],
  fallbackStoryId: number | undefined,
): GeneratedImageItem[] {
  return rawImages.flatMap((im): GeneratedImageItem[] => {
    const imageUrl = typeof im.imageUrl === 'string' ? im.imageUrl : '';
    if (!imageUrl || im.status === 'rejected') return [];
    const id = typeof im.id === 'number' ? im.id : -1;
    const imageStoryId =
      typeof im.storyId === 'number' ? im.storyId : fallbackStoryId;
    if (id < 0 || typeof imageStoryId !== 'number') return [];
    return [
      {
        id,
        imageUrl,
        prompt: typeof im.prompt === 'string' ? im.prompt : '',
        shotNo: parseShotNo(im.shotNo),
        shotIdentity:
          typeof im.shotIdentity === 'string' ? im.shotIdentity : undefined,
        storyId: imageStoryId,
        status: normalizeAssetStatus(im.status, im.generationType),
      },
    ];
  });
}

export function mergeStoryImagesForDisplay(
  serverImages: readonly GeneratedImageItem[],
  localImages: readonly GeneratedImageItem[],
  activeStoryId?: number,
): GeneratedImageItem[] {
  const byId = new Map<number, GeneratedImageItem>();
  for (const img of serverImages) byId.set(img.id, img);
  for (const img of localImages) {
    if (activeStoryId != null && img.storyId !== activeStoryId) continue;
    if (!img.imageUrl || img.status === 'error' || byId.has(img.id)) continue;
    byId.set(img.id, img);
  }
  return Array.from(byId.values());
}

export function useStoryGeneratedImages(): GeneratedImageItem[] {
  // 本地即时来源：context.storyImages（刚出图/刚收下后立刻可见）。
  const { remoteStoryId, activeStoryId, storyImages } = useStoryGeneratedImagesSlice();
  const storyId = remoteStoryId ?? activeStoryId ?? undefined;

  // 服务端权威来源：generated_images 投影。不要再读 story body 的 mobileImages 旧副本；
  // 否则重新生成故事版后，内存里的 3 张草稿会被旧 body 短暂覆盖掉。
  const storyImagesQuery = trpc.storyAgent.storyImages.useQuery(
    { storyId: storyId as number },
    { enabled: typeof storyId === 'number', refetchOnWindowFocus: true },
  );

  const serverImages = projectStoryImageAssetsForDisplay(storyImagesQuery.data ?? [], storyId);

  return mergeStoryImagesForDisplay(serverImages, storyImages, storyId);
}
