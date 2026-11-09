import { TRPCError } from "@trpc/server";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import {
  currentManuscript,
  readBookWorkflow,
  textManuscriptSource,
  type CreationIntent,
  type VersionActor,
} from "../../shared/bookWorkflow";
import type { BookVideoRecord } from "../../shared/bookVideoCreation";
import {
  readVideoWorkflow,
  type VideoWorkVersion,
} from "../../shared/videoWorkflow";
import { getStoryById } from "../repositories/stories";
import { mutateBookWorkflow } from "../repositories/bookWorkflow";
import {
  getStoryMaterialState,
  projectStoryTimelineDocument,
} from "./storyMaterials";
import { updateStoryAndTimelineAtomic } from "../repositories/timelines";
import { generatedSubtitleSpans } from "../../shared/generatedSubtitles";
import { emptyAudioState } from "../../shared/timelineAudioModel";
import {
  emptySubtitleState,
  initializeSubtitleCues,
} from "../../shared/timelineSubtitleModel";
import { randomUUID } from "node:crypto";
import { getStoryRevision } from "./storySync";
import { exportStoryTimeline } from "./videoExport";
import { getBookWorkflow } from "./bookWorkflow";
import { projectLegacyTimelineMedia } from "./legacyTimelineMedia";
type Owner = { storyId: number; userId: number };
async function owned(input: Owner) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  return (story.body ?? {}) as Record<string, unknown>;
}
function activePlan(body: Record<string, unknown>) {
  const publishing = normalizePublishingDraftState(body.publishing);
  const confirmed = publishing.versions?.flatMap(version => {
    const item = version.videoStoryboard?.confirmed;
    return item?.groupId === publishing.activeVideoStoryboardGroupId
      ? [item]
      : [];
  })[0];
  const records = (
    Array.isArray(body.bookVideoRecords) ? body.bookVideoRecords : []
  ) as BookVideoRecord[];
  return records.find(
    record =>
      record.status === "adopted" &&
      record.preview?.previewId === confirmed?.previewId
  );
}
export async function getVideoWorkflow(input: Owner) {
  const body = await owned(input),
    state = readVideoWorkflow(body.videoWorkflow);
  const drafts = (await getBookWorkflow(input)).drafts;
  const book = readBookWorkflow(body.bookWorkflow),
    plan = activePlan(body);
  const latest = currentManuscript(book, "storyboard");
  const source = plan?.manuscriptSource;
  const sourceVersion = book.versions.find(v => v.id === source?.id);
  const text = currentManuscript(book, "text");
  const textSource = textManuscriptSource(book, sourceVersion);
  return {
    state,
    source,
    hasEditingContent: Array.isArray(body.shots) && body.shots.length > 0,
    intent: plan?.creationIntent,
    bookUpdated: Boolean(
      (drafts.text.count && drafts.text.dirty) ||
        (drafts.storyboard.count && drafts.storyboard.dirty) ||
        (latest && latest.id !== source?.id) ||
        (text && textSource && text.id !== textSource.id)
    ),
  };
}
type SnapshotInput = {
  id: string;
  actor: VersionActor;
  intent: CreationIntent;
  summary: string;
};
function appendVideoSnapshot(
  state: ReturnType<typeof readVideoWorkflow>,
  before: Record<string, unknown>,
  material: NonNullable<Awaited<ReturnType<typeof getStoryMaterialState>>>,
  input: SnapshotInput
) {
  const legacy = projectLegacyTimelineMedia(before);
  const snapshot = structuredClone(material);
  delete snapshot.warehouseImages;
  delete snapshot.visualAssets;
  snapshot.unassignedImages = [];
  snapshot.unassignedVideoTakes = [];
  if (snapshot.timeline.extensions) {
    delete snapshot.timeline.extensions.videoEditHistory;
  }
  snapshot.timeline.extensions = {
    ...snapshot.timeline.extensions,
    subtitleTracks:
      snapshot.timeline.extensions?.subtitleTracks ?? legacy.subtitleState,
    audioTracks: snapshot.timeline.extensions?.audioTracks ?? legacy.audioState,
  };
  if (state.versions.length >= 100)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "视频版本记录已达上限，旧版本仍保留",
    });
  const plan = activePlan(before),
    book = readBookWorkflow(before.bookWorkflow);
  const manuscript = book.versions.find(
    v => v.id === plan?.manuscriptSource?.id
  );
  const version: VideoWorkVersion = {
    id: input.id,
    number: Math.max(0, ...state.versions.map(v => v.number)) + 1,
    parentId: state.versions.at(-1)?.id,
    createdAt: Date.now(),
    name: input.intent.purpose.slice(0, 100),
    intent: input.intent,
    summary: input.summary,
    author: input.actor,
    confirmedBy: input.actor,
    manuscriptSource: plan?.manuscriptSource,
    textSource: textManuscriptSource(book, manuscript),
    legacyAudioSources:
      material.timeline.extensions?.audioTracks == null
        ? legacy.audioSources
        : undefined,
    planId: plan?.id,
    material: snapshot,
    shots: structuredClone(Array.isArray(before.shots) ? before.shots : []),
    exports: [],
  };
  state.versions.push(version);

  return version;
}
export class VideoSnapshotConflictError extends Error {}
/** Preserve old editing and replace the plan in the SAME story/timeline transaction. */
export async function preserveVideoWhileReplacing(
  input: Owner & {
    id: string;
    actor: VersionActor;
    before: Record<string, unknown>;
    nextBody: Record<string, unknown>;
    expectedRevision: number;
    resetEditing?: boolean;
  }
) {
  const material = await getStoryMaterialState(input.storyId, input.userId);
  if (!material)
    throw new TRPCError({ code: "NOT_FOUND", message: "视频素材不可读取" });
  try {
    if (input.resetEditing) {
      const story = await getStoryById(input.storyId, input.userId);
      if (!story || getStoryRevision(story.body) !== input.expectedRevision)
        throw new VideoSnapshotConflictError("确认期间视频已更新");
      const state = readVideoWorkflow(input.before.videoWorkflow);
      if (Array.isArray(input.before.shots) && input.before.shots.length)
        appendVideoSnapshot(state, input.before, material, {
          ...input,
          intent: activePlan(input.before)?.creationIntent ?? {
            purpose: "保留上一版视频",
            audience: "沿用原受众",
            platform: "未记录平台",
          },
          summary: "按当前分镜建立新视频前保留的剪辑与素材",
        });
      const next: Record<string, unknown> = { ...input.nextBody, videoWorkflow: state };
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > 4 * 1024 * 1024)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "作品版本记录已达容量上限，历史和当前稿均保留，请新建作品继续。",
        });
      const timeline = projectStoryTimelineDocument(
        { ...story, body: next },
        null
      );
      const shots = (next.shots ?? []) as Array<{
        stableShotId: string;
        dialogue?: string;
      }>;
      const subtitles = initializeSubtitleCues(emptySubtitleState(), {
        candidates: timeline.items.flatMap(item =>
          generatedSubtitleSpans(
            shots.find(shot => shot.stableShotId === item.stableShotId)
              ?.dialogue ?? "",
            item.timelineStartFrame ?? 0,
            item.durationFrames ?? 1
          ).map(span => ({
            ...span,
            id: randomUUID(),
            provenance: {
              kind: "shot-dialogue" as const,
              stableShotId: item.stableShotId,
            },
            sourceTextRevision: input.expectedRevision + 1,
          }))
        ),
      });
      if (subtitles.status !== "ok") throw new Error(subtitles.message);
      const saved = await updateStoryAndTimelineAtomic({
        ...input,
        expectedStoryRevision: input.expectedRevision,
        expectedTimelineVersion: material.timeline.version,
        nextStoryBody: next,
        recordVideoRevision: true,
        nextTimeline: {
          items: timeline.items,
          overlays: [],
          extensions: {
            subtitleTracks: subtitles.state,
            audioTracks: emptyAudioState(),
            bookMusicReuse: [],
          },
        },
      });
      return { body: saved.story.body };
    }
    return await mutateBookWorkflow(
      { ...input, expectedTimelineVersion: material.timeline.version },
      ({ body }) => {
        if (getStoryRevision(body) !== input.expectedRevision)
          throw new VideoSnapshotConflictError("确认期间视频已更新");
        const state = readVideoWorkflow(body.videoWorkflow);
        if (!state.versions.some(version => version.id === input.id))
          appendVideoSnapshot(state, input.before, material, {
            ...input,
            intent: activePlan(input.before)?.creationIntent ?? {
              purpose: "保留上一版视频",
              audience: "沿用原受众",
              platform: "未记录平台",
            },
            summary: "采用新分镜方案前保留的剪辑与素材",
          });
        const next = { ...input.nextBody, videoWorkflow: state };
        Object.assign(body, next, { _revision: input.expectedRevision });
        return { result: { body: next } };
      }
    );
  } catch (error) {
    if (
      (error instanceof TRPCError && error.code === "CONFLICT") ||
      (error instanceof Error &&
        /故事已经更新|时间轴已经更新/.test(error.message))
    )
      throw new VideoSnapshotConflictError(error.message);
    throw error;
  }
}
export async function saveVideoWorkVersion(
  input: Owner & {
    id: string;
    actor: VersionActor;
    intent: CreationIntent;
    summary: string;
  }
) {
  const before = await owned(input),
    previous = readVideoWorkflow(before.videoWorkflow).versions.find(
      v => v.id === input.id
    );
  if (previous) {
    if (
      JSON.stringify(previous.intent) !== JSON.stringify(input.intent) ||
      previous.summary !== input.summary
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "请求编号已用于其他视频版本",
      });
    return previous;
  }
  const material = await getStoryMaterialState(input.storyId, input.userId);
  if (!material || !material.timeline.items.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请先确认视频方案并添加画面或素材",
    });
  return mutateBookWorkflow(
    { ...input, expectedTimelineVersion: material.timeline.version },
    ({ body }) => {
      const state = readVideoWorkflow(body.videoWorkflow),
        existing = state.versions.find(v => v.id === input.id);
      if (existing) return { result: existing };
      if (getStoryRevision(body) !== getStoryRevision(before))
        throw new TRPCError({
          code: "CONFLICT",
          message: "保存期间视频已有修改，请重新核对后保存。",
        });
      const version = appendVideoSnapshot(state, before, material, input);
      body.videoWorkflow = state;
      return { result: version };
    }
  );
}
export async function exportVideoWorkVersion(
  input: Owner & {
    id: string;
    exportId: string;
    aspectRatio: "16:9" | "9:16" | "1:1";
    actor: VersionActor;
  }
) {
  let claimed = false;
  const version = await mutateBookWorkflow(input, ({ body }) => {
    const state = readVideoWorkflow(body.videoWorkflow),
      version = state.versions.find(v => v.id === input.id);
    if (!version)
      throw new TRPCError({ code: "NOT_FOUND", message: "视频版本不存在" });
    const existing = version.exports.find(e => e.id === input.exportId);
    if (existing) {
      if (existing.aspectRatio !== input.aspectRatio)
        throw new TRPCError({ code: "CONFLICT", message: "导出规格已变化" });
    } else {
      if (
        version.exports.some(
          e =>
            e.status === "rendering" &&
            Date.now() - e.createdAt < 30 * 60 * 1000
        )
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "此版本正在导出，请等待完成",
        });
      version.exports.push({
        id: input.exportId,
        createdAt: Date.now(),
        actor: input.actor,
        status: "rendering",
        aspectRatio: input.aspectRatio,
      });
      body.videoWorkflow = state;
      claimed = true;
    }
    return { result: version };
  });
  if (!claimed) return version.exports.find(e => e.id === input.exportId)!;
  let result: Awaited<ReturnType<typeof exportStoryTimeline>>;
  try {
    result = await exportStoryTimeline({
      ...input,
      targetAspectRatio: input.aspectRatio,
      frozenMaterial: version.material,
      frozenLegacyAudioSources: version.legacyAudioSources,
    });
  } catch {
    result = { status: "error", error: "导出未完成，视频版本与原素材保留" };
  }
  return mutateBookWorkflow(input, ({ body }) => {
    const state = readVideoWorkflow(body.videoWorkflow),
      version = state.versions.find(v => v.id === input.id)!;
    const record = version.exports.find(e => e.id === input.exportId)!;
    if (result.status === "ok") {
      record.status = "ready";
      record.videoUrl = result.videoUrl;
      record.durationSec = result.durationSec;
    } else {
      record.status = "failed";
      record.error = result.error;
    }
    body.videoWorkflow = state;
    return { result: record };
  });
}
