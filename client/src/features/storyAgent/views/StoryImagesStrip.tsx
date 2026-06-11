import { useStoryAgent } from '../StoryAgentContext';
import { trpc } from '@/lib/trpc';
import type { GeneratedImageItem } from '@/features/mobileChat/types';

export function useStoryGeneratedImages(): GeneratedImageItem[] {
  const { remoteStoryId, activeStoryId } = useStoryAgent();
  const storyId = remoteStoryId ?? activeStoryId ?? undefined;

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

  return rawImages.flatMap((raw): GeneratedImageItem[] => {
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
        shotNo: typeof im.shotNo === 'number' ? im.shotNo : undefined,
        storyId: imageStoryId,
        status: 'ready',
      },
    ];
  });
}
