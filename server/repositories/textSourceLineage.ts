import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  normalizeTextSource,
  readTextSourceState,
  type KnownTextSource,
  type TextSourceImpactItem,
} from "../../shared/textSourceLineage";
import { readTextDraftHistory } from "../../shared/textDraftHistory";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { normalizeFinishedProductState } from "../../shared/finishedProductVersion";
import { getStoryById } from "./stories";
import { getStoryTimeline } from "./timelines";
import { getStoryRevision, prepareStoryBody } from "../services/storySync";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "../services/storyBodyPersistence";

export type CreationOwner = { storyId: number; userId: number };
export const creationRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const creationFingerprint = (value: unknown) =>
  createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
export async function ownedCreationStory(input: CreationOwner) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  return {
    story,
    body: creationRecord(story.body),
    revision: getStoryRevision(story.body),
  };
}
export function readyTextSource(
  body: Record<string, unknown>,
  draftId: string
): KnownTextSource {
  const draft = readTextDraftHistory(body.textDraftHistory).versions.find(
    v => v.id === draftId
  );
  if (!draft || draft.status !== "ready" || !draft.generated)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请指定已完成的文字版本",
    });
  return {
    textDraftId: draft.id,
    contentFingerprint: creationFingerprint(draft.generated),
  };
}
export async function setCurrentTextSource(
  input: CreationOwner & {
    draftId: string;
    expectedRevision: number;
    operationToken: string;
  }
) {
  const { body, revision } = await ownedCreationStory(input);
  const state = readTextSourceState(body.textSourceLineage);
  const requestHash = creationFingerprint({
    draftId: input.draftId,
    expectedRevision: input.expectedRevision,
  });
  const receipt = state.receipts[input.operationToken];
  if (receipt) {
    if (receipt.requestHash !== requestHash)
      throw new TRPCError({
        code: "CONFLICT",
        message: "操作标识已用于其他选择",
      });
    return { current: receipt.source, revision: receipt.revision };
  }
  if (revision !== input.expectedRevision)
    throw new TRPCError({
      code: "CONFLICT",
      message: "故事已变化，请重新查看文字版本",
    });
  const current = readyTextSource(body, input.draftId);
  state.current = current;
  state.receipts[input.operationToken] = {
    requestHash,
    source: current,
    revision: revision + 1,
  };
  if (Object.keys(state.receipts).length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前故事的来源选择记录已满",
    });
  const next = { ...body, textSourceLineage: state };
  try {
    await persistPreparedStoryBody({
      ...input,
      body: prepareStoryBody(next, revision + 1, next),
      expectedRevision: revision,
    });
  } catch (error) {
    if (error instanceof StoryBodyRevisionConflictError)
      throw new TRPCError({
        code: "CONFLICT",
        message: "故事已变化，请重新查看文字版本",
      });
    throw error;
  }
  return { current, revision: revision + 1 };
}
export async function getTextSourceImpact(input: CreationOwner) {
  const { body, revision } = await ownedCreationStory(input);
  const current = readTextSourceState(body.textSourceLineage).current;
  const items: TextSourceImpactItem[] = [];
  const add = (
    targetKind: TextSourceImpactItem["targetKind"],
    targetId: string,
    label: string,
    value: unknown,
    revision: number
  ) => {
    const source = normalizeTextSource(value);
    const group =
      "kind" in source
        ? "legacy_unknown"
        : current &&
            !("kind" in current) &&
            source.textDraftId === current.textDraftId &&
            source.contentFingerprint === current.contentFingerprint
          ? "current"
          : "stale";
    items.push({ targetKind, targetId, label, source, group, revision });
  };
  if (body.publishing)
    for (const version of normalizePublishingDraftState(body.publishing)
      .versions ?? [])
      add(
        "publishing",
        version.versionId,
        version.displayName,
        version.textSource,
        version.versionRevision
      );
  for (const version of normalizeFinishedProductState(body.finishedProduct)
    .versions)
    add(
      "finishedProduct",
      version.id,
      version.purpose,
      version.textSource,
      version.updatedAt
    );
  const timeline = await getStoryTimeline(input.storyId, input.userId);
  if (timeline)
    add(
      "timeline",
      `timeline:${input.storyId}`,
      "时间线",
      timeline.extensions?.textSource,
      timeline.version
    );
  if (Array.isArray(body.shots) && body.shots.length)
    add(
      "storyboard",
      `storyboard:${input.storyId}`,
      "分镜",
      body.storyboardTextSource,
      Number(body._storyboardRevision ?? 0)
    );
  return {
    current,
    revision,
    items,
    fingerprint: creationFingerprint({ current, revision, items }),
  };
}
