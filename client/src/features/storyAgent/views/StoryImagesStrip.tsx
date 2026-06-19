import { trpc } from '@/lib/trpc';
import { parseShotNo } from '@/features/mobileChat/types';
import type { GeneratedImageItem } from '@/features/mobileChat/types';
import { useStoryGeneratedImagesSlice } from '../spine/selectors';

function normalizeImageStatus(status: unknown): GeneratedImageItem['status'] {
  return status === 'ready' ||
    status === 'generating' ||
    status === 'draft' ||
    status === 'finalizing' ||
    status === 'error'
    ? status
    : 'ready';
}

export function useStoryGeneratedImages(): GeneratedImageItem[] {
  // 本地即时来源：context.storyImages（「把这一刻画出来」收下后立刻可见）。
  const { remoteStoryId, activeStoryId, storyImages } = useStoryGeneratedImagesSlice();
  const storyId = remoteStoryId ?? activeStoryId ?? undefined;

  // 服务端来源：跨端（手机另一端刚加的图）经 storyGet.body.mobileImages 拉回，与本地合并。
  const storyQuery = trpc.storyAgent.storyGet.useQuery(
    { id: storyId as number },
    { enabled: typeof storyId === 'number', refetchOnWindowFocus: true },
  );

  const body =
    storyQuery.data?.body && typeof storyQuery.data.body === 'object'
      ? (storyQuery.data.body as Record<string, unknown>)
      : {};
  const rawImages = Array.isArray(body.mobileImages)
    ? (body.mobileImages as unknown[])
    : [];

  const serverImages = rawImages.flatMap((raw): GeneratedImageItem[] => {
    if (!raw || typeof raw !== 'object') return [];
    const im = raw as Record<string, unknown>;
    const imageUrl = typeof im.imageUrl === 'string' ? im.imageUrl : '';
    if (!imageUrl || im.status === 'error') return [];
    const id = typeof im.id === 'number' ? im.id : -1;
    const imageStoryId =
      typeof im.storyId === 'number' ? im.storyId : storyId;
    if (id < 0 || typeof imageStoryId !== 'number') return [];
    return [
      {
        id,
        imageUrl,
        prompt: typeof im.prompt === 'string' ? im.prompt : '',
        shotNo: parseShotNo(im.shotNo),
        storyId: imageStoryId,
        status: normalizeImageStatus(im.status),
      },
    ];
  });

  // 本地优先，按 id 去重合并（本地刚收下的覆盖服务端旧值）。
  const byId = new Map<number, GeneratedImageItem>();
  for (const img of serverImages) byId.set(img.id, img);
  for (const img of storyImages) {
    if (!img.imageUrl || img.status === 'error') continue;
    byId.set(img.id, img);
  }
  return Array.from(byId.values());
}
