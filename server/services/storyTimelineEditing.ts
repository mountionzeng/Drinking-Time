import {
  normalizeLegacyOverlay,
  type LegacyOverlayNormalizationInput,
} from "../../shared/legacyOverlayNormalization";
import type { VisualEditDocument } from "../../shared/visualClipModel";
import {
  loadOwnedStoryVisualAggregate,
  saveStoryVisualAggregateCas,
} from "../persistence/storyVisualPersistence";
import { projectStoryTimelineDocument } from "./storyMaterials";
import { getStoryRevision, prepareStoryBody } from "./storySync";

export type StoryTimelineCommandFacts = {
  storyBody: Record<string, unknown>;
  storyRevision: number;
  timelineVersion: number;
  document: VisualEditDocument;
};

export type StoryTimelineCommandContext = StoryTimelineCommandFacts;

export type StoryTimelineCommandPlan<T> =
  | {
      status: "ok";
      value: T;
      storyBody: Record<string, unknown>;
      document: VisualEditDocument;
      changed?: boolean;
    }
  | { status: "error"; message: string };

export type StoryTimelineCommandResult<T> =
  | {
      status: "ok";
      changed: boolean;
      normalizedLegacyOverlay: boolean;
      storyRevision: number;
      timelineVersion: number;
      value: T;
      /** Internal service facts for U5 receipt construction; never return directly from a route. */
      facts: {
        before: StoryTimelineCommandFacts;
        after: StoryTimelineCommandFacts;
      };
    }
  | {
      status: "error";
      error: string;
      errorKind: "invalid" | "conflict";
    };

export type LegacyOverlayCommandTarget = Pick<
  LegacyOverlayNormalizationInput,
  "overlayId" | "sourceStableShotId" | "expectedVideoUrl"
>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function storyShots(body: Record<string, unknown>) {
  return Array.isArray(body.shots)
    ? body.shots.filter((shot): shot is Record<string, unknown> =>
        Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
}

function cloneDocument(document: VisualEditDocument): VisualEditDocument {
  return structuredClone(document) as VisualEditDocument;
}

function cloneFacts(
  facts: StoryTimelineCommandFacts
): StoryTimelineCommandFacts {
  return {
    storyBody: structuredClone(facts.storyBody),
    storyRevision: facts.storyRevision,
    timelineVersion: facts.timelineVersion,
    document: cloneDocument(facts.document),
  };
}

function isVersionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:CAS|revision|version|故事已经更新|时间轴已经更新)/i.test(message);
}

/**
 * Aggregate Story + Timeline command envelope.
 *
 * A legacy overlay is normalized only in the in-memory working set. The user
 * planner runs on that set and the DB receives one complete aggregate CAS, so
 * planner failure, version conflict, or persistence failure cannot leave a
 * half-normalized overlay behind.
 */
export async function runStoryTimelineCommand<T>(
  input: {
    storyId: number;
    userId: number;
    failureMessage: string;
    legacyOverlay?: LegacyOverlayCommandTarget;
    legacyOverlays?: readonly LegacyOverlayCommandTarget[];
  },
  planner: (context: StoryTimelineCommandContext) => StoryTimelineCommandPlan<T>
): Promise<StoryTimelineCommandResult<T>> {
  try {
    const aggregate = await loadOwnedStoryVisualAggregate({
      storyId: input.storyId,
      userId: input.userId,
      includeVideoTakes:
        Boolean(input.legacyOverlay) || (input.legacyOverlays?.length ?? 0) > 0,
    });
    if (!aggregate) {
      return {
        status: "error",
        error: "故事不存在或无权访问",
        errorKind: "invalid",
      };
    }

    const story = aggregate.story;
    const storyBody = record(story.body);
    const timeline = projectStoryTimelineDocument(story, aggregate.timeline);
    const persistedDocument: VisualEditDocument = {
      items: timeline.items,
      overlays: timeline.overlays ?? [],
      ...(timeline.visualLayerState === undefined
        ? {}
        : { visualLayerState: timeline.visualLayerState }),
    };
    const before: StoryTimelineCommandFacts = {
      storyBody: structuredClone(storyBody),
      storyRevision: getStoryRevision(story.body),
      timelineVersion: timeline.version,
      document: cloneDocument(persistedDocument),
    };

    let workingDocument = cloneDocument(persistedDocument);
    let normalizedLegacyOverlay = false;
    for (const legacyOverlay of [
      ...(input.legacyOverlay ? [input.legacyOverlay] : []),
      ...(input.legacyOverlays ?? []),
    ]) {
      const normalized = normalizeLegacyOverlay({
        ...legacyOverlay,
        storyShots: storyShots(storyBody),
        document: workingDocument,
        takes: aggregate.videoTakes.map(take => ({
          id: take.id,
          stableShotId: take.stableShotId,
          videoUrl: take.videoUrl,
        })),
      });
      if (normalized.status === "error")
        return {
          status: "error",
          error: `历史覆盖视频绑定异常：${normalized.message}`,
          errorKind: "invalid",
        };
      workingDocument = normalized.document;
      normalizedLegacyOverlay ||= normalized.changed;
    }

    const plan = planner({
      storyBody: structuredClone(storyBody),
      storyRevision: before.storyRevision,
      timelineVersion: before.timelineVersion,
      document: workingDocument,
    });
    if (plan.status === "error") {
      return {
        status: "error",
        error: plan.message,
        errorKind: "invalid",
      };
    }

    const changed = normalizedLegacyOverlay || plan.changed !== false;
    if (!changed) {
      const facts = cloneFacts(before);
      return {
        status: "ok",
        changed: false,
        normalizedLegacyOverlay: false,
        storyRevision: before.storyRevision,
        timelineVersion: before.timelineVersion,
        value: plan.value,
        facts: { before: cloneFacts(before), after: facts },
      };
    }

    const nextStoryBody = prepareStoryBody(
      plan.storyBody,
      before.storyRevision + 1,
      story.body
    );
    const nextDocument = cloneDocument(plan.document);
    const saved = await saveStoryVisualAggregateCas({
      storyId: input.storyId,
      userId: input.userId,
      expectedStoryRevision: before.storyRevision,
      expectedTimelineVersion: before.timelineVersion,
      nextStoryBody,
      nextDocument: {
        items: nextDocument.items,
        ...(nextDocument.overlays === undefined
          ? {}
          : { overlays: nextDocument.overlays }),
        ...(nextDocument.visualLayerState === undefined
          ? {}
          : { visualLayerState: nextDocument.visualLayerState }),
      },
    });
    const after: StoryTimelineCommandFacts = {
      storyBody: structuredClone(record(saved.story.body)),
      storyRevision: getStoryRevision(saved.story.body),
      timelineVersion: saved.timeline.version,
      document: nextDocument,
    };
    return {
      status: "ok",
      changed: true,
      normalizedLegacyOverlay,
      storyRevision: after.storyRevision,
      timelineVersion: after.timelineVersion,
      value: plan.value,
      facts: { before: cloneFacts(before), after: cloneFacts(after) },
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : input.failureMessage,
      errorKind: isVersionConflict(error) ? "conflict" : "invalid",
    };
  }
}
