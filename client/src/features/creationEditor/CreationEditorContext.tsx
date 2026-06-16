import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { trpc } from '@/lib/trpc';
import type { StoryShot } from '@/features/storyAgent/types';
import { canonicalizeShotNo } from '@shared/imageAsset';
import { rerenderShotImage } from './rerender';
import { writePromptOverride, writeShotDuration } from './promptTable/persist';
import type { PromptOverride, PromptOverrides, PromptRow } from './promptTable/types';

export type CreationEditorStory = {
  id: number;
  title: string;
  logline?: string | null;
};

export type CreationEditorImage = {
  id: number;
  shotNo: number | null;
  imageUrl: string;
  prompt?: string | null;
};

export type CreationEditorShot = StoryShot & {
  shotKey: string;
  imageId?: number;
  imageUrl?: string;
  imagePrompt?: string | null;
  durationMs?: number;
  promptOverrides?: PromptOverrides;
};

export type CreationEditorError = {
  message: string;
};

type CreationEditorContextValue = {
  stories: CreationEditorStory[];
  activeStoryId: number | null;
  setActiveStoryId: (storyId: number | null) => void;
  activeStory: CreationEditorStory | null;
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  setSelectedShotNo: (shotNo: number | null) => void;
  selectedShot: CreationEditorShot | null;
  isLoading: boolean;
  error: CreationEditorError | null;
  isSaving: boolean;
  rerenderingShotNo: number | null;
  rerenderError: string | null;
  updateShotDuration: (shotNo: number, durationMs: number) => Promise<void>;
  updatePromptOverride: (
    shotNo: number,
    dimension: string,
    override: PromptOverride,
  ) => Promise<void>;
  rerenderShot: (shotNo: number, rows: PromptRow[]) => Promise<void>;
  refetch: () => void;
};

const CreationEditorContext = createContext<CreationEditorContextValue | null>(null);

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /(\d+)/.exec(value);
    if (match) return Number(match[1]);
  }
  return null;
}

function normalizePromptOverrides(raw: unknown): PromptOverrides | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const overrides: PromptOverrides = {};
  Object.entries(raw as Record<string, unknown>).forEach(([dimension, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const obj = value as Record<string, unknown>;
    const next = {
      value: typeof obj.value === 'string' ? obj.value : undefined,
      weight: typeof obj.weight === 'number' && Number.isFinite(obj.weight)
        ? obj.weight
        : undefined,
    };
    if (next.value !== undefined || next.weight !== undefined) {
      overrides[dimension] = next;
    }
  });
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function shotKey(shotNo: number) {
  return `SH${String(shotNo).padStart(2, '0')}`;
}

function normalizeShot(raw: unknown, index: number): CreationEditorShot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const shotNo = numberValue(obj.shotNo) ?? index + 1;
  if (!Number.isSafeInteger(shotNo) || shotNo < 1) return null;

  return {
    shotNo,
    shotKey: shotKey(shotNo),
    subject: stringValue(obj.subject),
    action: stringValue(obj.action),
    dialogue: stringValue(obj.dialogue),
    shotType: stringValue(obj.shotType),
    beat: stringValue(obj.beat),
    cameraAngle: stringValue(obj.cameraAngle),
    cameraMove: stringValue(obj.cameraMove),
    location: stringValue(obj.location),
    timeLight: stringValue(obj.timeLight),
    mood: stringValue(obj.mood),
    sound: stringValue(obj.sound),
    styleRef: stringValue(obj.styleRef),
    note: stringValue(obj.note),
    emotion: stringValue(obj.emotion),
    sourceCardContent: stringValue(obj.sourceCardContent),
    emotionCharge: stringValue(obj.emotionCharge) || undefined,
    emotionDelta: stringValue(obj.emotionDelta) || undefined,
    visualAnchorText: stringValue(obj.visualAnchorText) || undefined,
    promptDraft: stringValue(obj.promptDraft) || undefined,
    negativePrompt: stringValue(obj.negativePrompt) || undefined,
    durationMs:
      typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
        ? obj.durationMs
        : undefined,
    promptOverrides: normalizePromptOverrides(obj.promptOverrides),
    fragmentRefs: Array.isArray(obj.fragmentRefs)
      ? obj.fragmentRefs.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

export function normalizeStoryShots(body: unknown): CreationEditorShot[] {
  if (!body || typeof body !== 'object') return [];
  const shots = (body as { shots?: unknown }).shots;
  if (!Array.isArray(shots)) return [];
  return shots
    .map(normalizeShot)
    .filter((shot): shot is CreationEditorShot => Boolean(shot))
    .sort((left, right) => left.shotNo - right.shotNo);
}

export function normalizeStoryImages(rawImages: unknown): CreationEditorImage[] {
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .map((raw): CreationEditorImage | null => {
      if (!raw || typeof raw !== 'object') return null;
      const obj = raw as Record<string, unknown>;
      const imageUrl = stringValue(obj.imageUrl);
      if (!imageUrl) return null;
      const canonical = canonicalizeShotNo(obj.shotNo as string | number | null | undefined);
      const shotNo = canonical ? Number(canonical.slice(2)) : null;
      const id = numberValue(obj.id);
      return {
        id: id ?? 0,
        shotNo,
        imageUrl,
        prompt: stringValue(obj.prompt) || null,
      } satisfies CreationEditorImage;
    })
    .filter((image): image is CreationEditorImage => image != null);
}

export function mergeShotsWithImages(
  shots: readonly CreationEditorShot[],
  images: readonly CreationEditorImage[],
): CreationEditorShot[] {
  const latestByShotNo = new Map<number, CreationEditorImage>();
  for (const image of images) {
    if (image.shotNo == null) continue;
    const previous = latestByShotNo.get(image.shotNo);
    if (!previous || image.id >= previous.id) latestByShotNo.set(image.shotNo, image);
  }

  return shots.map((shot) => {
    const image = latestByShotNo.get(shot.shotNo);
    if (!image) return shot;
    return {
      ...shot,
      imageId: image.id,
      imageUrl: image.imageUrl,
      imagePrompt: image.prompt,
    };
  });
}

export function selectInitialShotNo(
  selectedShotNo: number | null,
  shots: readonly CreationEditorShot[],
): number | null {
  if (selectedShotNo != null && shots.some((shot) => shot.shotNo === selectedShotNo)) {
    return selectedShotNo;
  }
  return shots[0]?.shotNo ?? null;
}

export function CreationEditorProvider({ children }: PropsWithChildren) {
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [selectedShotNo, setSelectedShotNo] = useState<number | null>(null);
  const [rerenderingShotNo, setRerenderingShotNo] = useState<number | null>(null);
  const [rerenderError, setRerenderError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const generateForMobileMut = trpc.storyAgent.generateForMobile.useMutation();
  const activeId = activeStoryId ?? storyListQuery.data?.stories?.[0]?.id ?? null;
  const storyQuery = trpc.storyAgent.storyGet.useQuery(
    { id: activeId ?? 0 },
    {
      enabled: activeId != null,
      refetchOnWindowFocus: false,
    },
  );
  const storyImagesQuery = trpc.storyAgent.storyImages.useQuery(
    { storyId: activeId ?? 0 },
    {
      enabled: activeId != null,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (activeStoryId != null) return;
    const firstId = storyListQuery.data?.stories?.[0]?.id;
    if (typeof firstId === 'number') setActiveStoryId(firstId);
  }, [activeStoryId, storyListQuery.data?.stories]);

  const stories = useMemo<CreationEditorStory[]>(
    () =>
      (storyListQuery.data?.stories ?? []).map((story) => ({
        id: story.id,
        title: story.title || '未命名故事',
        logline: story.logline,
      })),
    [storyListQuery.data?.stories],
  );

  const activeStory = useMemo<CreationEditorStory | null>(() => {
    const row = storyQuery.data;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title || '未命名故事',
      logline: row.logline,
    };
  }, [storyQuery.data]);

  const shots = useMemo(() => {
    const body = storyQuery.data?.body;
    const storyShots = normalizeStoryShots(body);
    const images = normalizeStoryImages(storyImagesQuery.data);
    return mergeShotsWithImages(storyShots, images);
  }, [storyImagesQuery.data, storyQuery.data?.body]);

  useEffect(() => {
    setSelectedShotNo((current) => selectInitialShotNo(current, shots));
  }, [shots]);

  const selectedShot = useMemo(
    () => shots.find((shot) => shot.shotNo === selectedShotNo) ?? null,
    [selectedShotNo, shots],
  );

  const persistBody = async (body: Record<string, unknown>) => {
    const row = storyQuery.data;
    if (!row) throw new Error('故事尚未加载，无法保存');
    await storyUpsertMut.mutateAsync({
      id: row.id,
      title: row.title,
      logline: row.logline,
      theme: row.theme,
      arc: row.arc,
      summary: row.summary,
      projectId: row.projectId,
      body,
    });
    await utils.storyAgent.storyGet.invalidate({ id: row.id });
    await storyQuery.refetch();
  };

  const updateShotDuration = async (shotNo: number, durationMs: number) => {
    const body = writeShotDuration(storyQuery.data?.body, shotNo, durationMs);
    await persistBody(body);
  };

  const updatePromptOverride = async (
    shotNo: number,
    dimension: string,
    override: PromptOverride,
  ) => {
    const body = writePromptOverride(storyQuery.data?.body, shotNo, dimension, override);
    await persistBody(body);
  };

  const rerenderShot = async (shotNo: number, rows: PromptRow[]) => {
    if (activeId == null) throw new Error('故事尚未加载，无法重渲');
    const shot = shots.find((item) => item.shotNo === shotNo);
    if (!shot) throw new Error(`找不到镜头 ${shotNo}`);
    setRerenderError(null);
    setRerenderingShotNo(shotNo);
    try {
      await rerenderShotImage({
        storyId: activeId,
        shot,
        rows,
        generate: input => generateForMobileMut.mutateAsync(input),
      });
      await storyImagesQuery.refetch();
      await utils.storyAgent.storyImages.invalidate({ storyId: activeId });
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片生成失败';
      setRerenderError(message);
      throw error;
    } finally {
      setRerenderingShotNo(null);
    }
  };

  const rawError =
    storyListQuery.error ??
    storyQuery.error ??
    storyImagesQuery.error ??
    null;
  const error = rawError ? { message: rawError.message } : null;

  const value = useMemo<CreationEditorContextValue>(
    () => ({
      stories,
      activeStoryId: activeId,
      setActiveStoryId,
      activeStory,
      shots,
      selectedShotNo,
      setSelectedShotNo,
      selectedShot,
      isLoading:
        storyListQuery.isLoading ||
        storyQuery.isLoading ||
        storyImagesQuery.isLoading,
      error,
      isSaving: storyUpsertMut.isPending,
      rerenderingShotNo,
      rerenderError,
      updateShotDuration,
      updatePromptOverride,
      rerenderShot,
      refetch: () => {
        void storyListQuery.refetch();
        void storyQuery.refetch();
        void storyImagesQuery.refetch();
      },
    }),
    [
      activeId,
      activeStory,
      error,
      selectedShot,
      selectedShotNo,
      rerenderError,
      rerenderingShotNo,
      shots,
      stories,
      storyUpsertMut.isPending,
      storyImagesQuery,
      storyListQuery,
      storyQuery,
    ],
  );

  return (
    <CreationEditorContext.Provider value={value}>
      {children}
    </CreationEditorContext.Provider>
  );
}

export function useCreationEditor() {
  const ctx = useContext(CreationEditorContext);
  if (!ctx) throw new Error('useCreationEditor must be used within CreationEditorProvider');
  return ctx;
}
