/**
 * Paid scene-audio generation for music, ambience and sound effects.
 *
 * The browser supplies only a target frame, semantic kind and optional intent.
 * The server resolves the authoritative shot and derives its placement,
 * duration and emotional prompt before signing a short-lived quote. A paid
 * request can therefore never smuggle in price, ownership or an arbitrary
 * Timeline range.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { StoryAudioAsset } from "../../drizzle/schema";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import { fromYuan, toYuan } from "../../shared/computeMoney";
import {
  STORY_TIMELINE_FPS,
  type StoryTimelineItem,
} from "../../shared/storyMaterial";
import {
  buildTimelineLayout,
  resolveTimelineFrame,
} from "../../shared/timelineLayout";
import type { VisualEditOperationRef } from "../../shared/visualEditReceipt";
import { ENV } from "../_core/env";
import {
  loadOwnedStory,
  loadOwnedStoryTimelineEnvelope,
} from "../persistence/storyVisualPersistence";
import {
  listOperationProviderAttempts,
  recordOperationProviderAttempt,
  reserveForOperation,
  settleOperation,
} from "./computeLedger";
import { findReusableReadyStoryAudioAsset } from "./storyAudioAssets";
import {
  materializeRemoteAudio,
  type MaterializeRemoteAudioInput,
} from "./storyAudioImport";
import {
  generateStoryAudio302,
  StoryAudio302Error,
  type GeneratedStoryAudioKind,
  type StoryAudio302Result,
} from "./storyAudio302";
import {
  insertGeneratedAudioClipForStory,
  type TimelineMediaCommandResult,
} from "./timelineAudioEditing";
import { findDurableTimelineMediaOperation } from "./timelineMediaOperationLedger";

const OPERATION_TYPE = "audio.scene-generation";
const QUOTE_TTL_MS = 5 * 60 * 1_000;
const PREPARED_RECOVERY_GRACE_MS = 10 * 60 * 1_000;
const PRICE_VERSION = "scene-audio-302-cny-v1";
function maxCostMinor(
  kind: GeneratedStoryAudioKind,
  durationFrames: number
): number {
  if (kind !== "music") return fromYuan(0.06);
  const providerSeconds = Math.min(
    300,
    Math.max(10, Math.ceil(durationFrames / STORY_TIMELINE_FPS))
  );
  return fromYuan(providerSeconds * 0.01);
}

type StoryRecord = Record<string, unknown>;

export type StorySceneAudioContext = {
  stableShotId: string;
  shotNo: number;
  startFrame: number;
  durationFrames: number;
  emotionSummary: string;
  sceneSummary: string;
  actionSummary: string;
  soundSummary: string;
};

type SceneAudioQuoteClaims = {
  version: 1;
  userId: number;
  storyId: number;
  kind: GeneratedStoryAudioKind;
  targetFrame: number;
  intent: string;
  context: StorySceneAudioContext;
  promptHash: string;
  provider: string;
  model: string;
  maxCostMinor: number;
  priceVersion: string;
  requestedAt: number;
  expiresAt: number;
};

export type StorySceneAudioQuote = {
  quoteToken: string;
  kind: GeneratedStoryAudioKind;
  context: StorySceneAudioContext;
  prompt: string;
  provider: string;
  model: string;
  currency: "CNY";
  estimatedCny: number;
  expiresAt: number;
};

type SceneAudioProvenance = {
  kind: "story-scene-audio";
  operationId: string;
  storyId: number;
  stableShotId: string;
  audioKind: GeneratedStoryAudioKind;
  intent: string;
  prompt: string;
  startFrame: number;
  durationFrames: number;
  provider: string;
  model: string;
  priceVersion: string;
  requestedAt: number;
};

type StoryAudioGenerationDependencies = {
  now: () => number;
  generate: typeof generateStoryAudio302;
  importRemote: (
    input: MaterializeRemoteAudioInput
  ) => ReturnType<typeof materializeRemoteAudio>;
  reserve: typeof reserveForOperation;
  settle: typeof settleOperation;
  recordAttempt: typeof recordOperationProviderAttempt;
  listAttempts: typeof listOperationProviderAttempts;
  insert: typeof insertGeneratedAudioClipForStory;
};

const defaultDependencies: StoryAudioGenerationDependencies = {
  now: Date.now,
  generate: generateStoryAudio302,
  importRemote: materializeRemoteAudio,
  reserve: reserveForOperation,
  settle: settleOperation,
  recordAttempt: recordOperationProviderAttempt,
  listAttempts: listOperationProviderAttempts,
  insert: insertGeneratedAudioClipForStory,
};

function record(value: unknown): StoryRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StoryRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizedTimelineItems(value: unknown): StoryTimelineItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const item = record(raw);
    const stableShotId = text(item.stableShotId);
    if (!stableShotId) return [];
    const durationFrames = positiveInteger(item.durationFrames, 90);
    return [
      {
        ...(item as StoryTimelineItem),
        stableShotId,
        included: item.included !== false,
        position:
          typeof item.position === "number" && Number.isInteger(item.position)
            ? item.position
            : index,
        plannedDurationMs:
          typeof item.plannedDurationMs === "number" &&
          Number.isFinite(item.plannedDurationMs) &&
          item.plannedDurationMs > 0
            ? item.plannedDurationMs
            : Math.round((durationFrames * 1_000) / STORY_TIMELINE_FPS),
        durationFrames,
      },
    ];
  });
}

function joined(values: unknown[], fallback: string): string {
  const unique = Array.from(new Set(values.map(text).filter(Boolean)));
  return unique.join(" · ") || fallback;
}

export function resolveStorySceneAudioContext(input: {
  timelineItems: unknown;
  storyBody: unknown;
  targetFrame: number;
}): StorySceneAudioContext {
  const items = normalizedTimelineItems(input.timelineItems);
  const resolution = resolveTimelineFrame(
    buildTimelineLayout(items),
    Math.max(0, Math.floor(input.targetFrame))
  );
  if (resolution.kind !== "shot") {
    throw new Error("当前播放头没有命中镜头，请把播放头移到一个镜头内");
  }
  const body = record(input.storyBody);
  const shots = Array.isArray(body.shots) ? body.shots.map(record) : [];
  const shot =
    shots.find(
      candidate =>
        text(candidate.stableShotId) === resolution.row.item.stableShotId
    ) ??
    shots.find(
      candidate =>
        positiveInteger(candidate.shotNo, -1) ===
        resolution.row.item.position + 1
    ) ??
    {};
  return {
    stableShotId: resolution.row.item.stableShotId,
    shotNo: positiveInteger(
      shot.shotNo,
      Math.max(1, resolution.row.item.position + 1)
    ),
    startFrame: resolution.row.startFrame,
    durationFrames: resolution.row.durationFrames,
    emotionSummary: joined(
      [
        shot.emotion,
        shot.mood,
        shot.emotionCharge,
        shot.emotionDelta,
        shot.beat,
      ],
      "克制、贴合叙事"
    ),
    sceneSummary: joined(
      [shot.sceneTitle, shot.location, shot.timeLight, shot.lighting],
      "沿用当前镜头空间"
    ),
    actionSummary: joined(
      [shot.subject, shot.action, shot.performance],
      "跟随当前镜头动作"
    ),
    soundSummary: joined([shot.sound, shot.soundBridge], "无额外声音说明"),
  };
}

export function composeStorySceneAudioPrompt(input: {
  kind: GeneratedStoryAudioKind;
  context: StorySceneAudioContext;
  intent?: string;
}): string {
  const duration = Math.max(
    0.5,
    input.context.durationFrames / STORY_TIMELINE_FPS
  ).toFixed(1);
  const intent = text(input.intent) || "服从镜头情绪，不喧宾夺主";
  const facts = [
    `Duration: ${duration} seconds.`,
    `Emotional direction: ${input.context.emotionSummary}.`,
    `Creator request: ${intent}.`,
    `Scene: ${input.context.sceneSummary}.`,
    `On-screen action: ${input.context.actionSummary}.`,
    `Sound direction: ${input.context.soundSummary}.`,
  ].join(" ");
  if (input.kind === "music") {
    return `Instrumental cinematic underscore only; no vocals and no spoken words. ${facts} Support this exact shot without overpowering narration. Use a clean beginning and a natural ending suitable for editing.`;
  }
  if (input.kind === "ambience") {
    return `Seamless loopable environmental ambience only; no music and no speech. ${facts} Keep the perspective and acoustic space stable, with no abrupt foreground event.`;
  }
  return `One focused, production-ready synchronized sound effect; no music and no speech. ${facts} Keep the event clean, specific and easy to place in a mix, without unrelated background sounds.`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function quoteSigningKey(): string {
  const key = ENV.cookieSecret || ENV.api302Key;
  if (!key && ENV.isProduction) {
    throw new Error("服务器尚未配置声音报价签名密钥");
  }
  return key || "local-story-audio-generation-quote-key";
}

function encodeQuote(claims: SceneAudioQuoteClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", quoteSigningKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function decodeQuote(token: string): SceneAudioQuoteClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", quoteSigningKey())
    .update(payload)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as SceneAudioQuoteClaims;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function providerFor(kind: GeneratedStoryAudioKind) {
  return kind === "music"
    ? { provider: "302-elevenlabs", model: ENV.audio302MusicModel.trim() }
    : { provider: "302-elevenlabs", model: ENV.audio302SoundModel.trim() };
}

async function currentContext(input: {
  storyId: number;
  userId: number;
  targetFrame: number;
}) {
  const [story, timeline] = await Promise.all([
    loadOwnedStory({ storyId: input.storyId, userId: input.userId }),
    loadOwnedStoryTimelineEnvelope({
      storyId: input.storyId,
      userId: input.userId,
    }),
  ]);
  if (!story || !timeline) throw new Error("故事或时间线不存在，无法生成声音");
  return resolveStorySceneAudioContext({
    timelineItems: timeline.items,
    storyBody: story.body,
    targetFrame: input.targetFrame,
  });
}

type SceneAudioPlacement = {
  startFrame: number;
  durationFrames: number;
};

function placementFromUsage(value: unknown): SceneAudioPlacement | null {
  const placement = record(record(value).placement);
  return Number.isInteger(placement.startFrame) &&
    (placement.startFrame as number) >= 0 &&
    Number.isInteger(placement.durationFrames) &&
    (placement.durationFrames as number) > 0
    ? {
        startFrame: placement.startFrame as number,
        durationFrames: placement.durationFrames as number,
      }
    : null;
}

async function currentPlacement(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
}): Promise<SceneAudioPlacement | null> {
  const timeline = await loadOwnedStoryTimelineEnvelope({
    storyId: input.storyId,
    userId: input.userId,
  });
  if (!timeline) return null;
  const row = buildTimelineLayout(normalizedTimelineItems(timeline.items)).find(
    candidate =>
      candidate.item.included !== false &&
      candidate.item.stableShotId === input.stableShotId
  );
  return row
    ? { startFrame: row.startFrame, durationFrames: row.durationFrames }
    : null;
}

export async function quoteStorySceneAudio(input: {
  storyId: number;
  userId: number;
  kind: GeneratedStoryAudioKind;
  targetFrame: number;
  intent?: string;
  now?: () => number;
}): Promise<StorySceneAudioQuote> {
  const intent = text(input.intent).slice(0, 800);
  const context = await currentContext(input);
  const prompt = composeStorySceneAudioPrompt({
    kind: input.kind,
    context,
    intent,
  });
  const { provider, model } = providerFor(input.kind);
  if (!model || !/^[\w.-]+$/i.test(model)) {
    throw new Error("302 声音模型尚未配置或配置无效");
  }
  const requestedAt = (input.now ?? Date.now)();
  const claims: SceneAudioQuoteClaims = {
    version: 1,
    userId: input.userId,
    storyId: input.storyId,
    kind: input.kind,
    targetFrame: Math.max(0, Math.floor(input.targetFrame)),
    intent,
    context,
    promptHash: sha256(prompt),
    provider,
    model,
    maxCostMinor: maxCostMinor(input.kind, context.durationFrames),
    priceVersion: PRICE_VERSION,
    requestedAt,
    expiresAt: requestedAt + QUOTE_TTL_MS,
  };
  return {
    quoteToken: encodeQuote(claims),
    kind: input.kind,
    context,
    prompt,
    provider,
    model,
    currency: "CNY",
    estimatedCny: toYuan(claims.maxCostMinor),
    expiresAt: claims.expiresAt,
  };
}

export type GenerateStorySceneAudioResult =
  | {
      status: "ready";
      assetId: number;
      timeline: TimelineMediaCommandResult;
      replayed: boolean;
    }
  | { status: "pending" | "submission-unknown" | "error"; message: string };

function importOperationId(operationId: string): string {
  return `scene-audio-${sha256(operationId).slice(0, 48)}`;
}

async function insertGeneratedAsset(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  claims: SceneAudioQuoteClaims;
  placement: SceneAudioPlacement;
  asset: StoryAudioAsset;
  insert: typeof insertGeneratedAudioClipForStory;
}): Promise<TimelineMediaCommandResult> {
  return input.insert({
    storyId: input.storyId,
    userId: input.userId,
    operation: input.operation,
    kind: input.claims.kind,
    assetId: input.asset.id,
    timelineStartFrame: input.placement.startFrame,
    sourceInFrame: 0,
    sourceOutFrame: Math.min(
      input.placement.durationFrames,
      Math.max(1, input.asset.durationFrames ?? 1)
    ),
  });
}

export async function generateStorySceneAudio(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  quoteToken: string;
  dependencies?: Partial<StoryAudioGenerationDependencies>;
}): Promise<GenerateStorySceneAudioResult> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const claims = decodeQuote(input.quoteToken);
  if (!claims) return { status: "error", message: "声音报价无效，请重新确认" };
  const now = dependencies.now();
  if (
    claims.userId !== input.userId ||
    claims.storyId !== input.storyId ||
    claims.priceVersion !== PRICE_VERSION
  ) {
    return { status: "error", message: "声音报价已过期或作用域不匹配" };
  }

  const priorAttempts = await dependencies.listAttempts(
    input.operation.operationId
  );
  const recoveringAcceptedOperation = priorAttempts.length > 0;
  let context: StorySceneAudioContext;
  if (recoveringAcceptedOperation) {
    context = claims.context;
  } else {
    try {
      context = await currentContext({
        storyId: input.storyId,
        userId: input.userId,
        targetFrame: claims.targetFrame,
      });
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "镜头上下文不可用",
      };
    }
  }
  const prompt = composeStorySceneAudioPrompt({
    kind: claims.kind,
    context,
    intent: claims.intent,
  });
  const provider = recoveringAcceptedOperation
    ? { provider: claims.provider, model: claims.model }
    : providerFor(claims.kind);
  if (
    canonicalJsonStringify(context) !==
      canonicalJsonStringify(claims.context) ||
    sha256(prompt) !== claims.promptHash ||
    provider.provider !== claims.provider ||
    provider.model !== claims.model ||
    maxCostMinor(claims.kind, context.durationFrames) !== claims.maxCostMinor
  ) {
    return { status: "error", message: "镜头或声音方案已经更新，请重新确认" };
  }

  const requestHash = sha256(
    canonicalJsonStringify({
      operationType: OPERATION_TYPE,
      storyId: input.storyId,
      kind: claims.kind,
      context,
      promptHash: claims.promptHash,
      provider: claims.provider,
      model: claims.model,
      priceVersion: claims.priceVersion,
    })
  );
  const provenance: SceneAudioProvenance = {
    kind: "story-scene-audio",
    operationId: input.operation.operationId,
    storyId: input.storyId,
    stableShotId: context.stableShotId,
    audioKind: claims.kind,
    intent: claims.intent,
    prompt,
    startFrame: context.startFrame,
    durationFrames: context.durationFrames,
    provider: claims.provider,
    model: claims.model,
    priceVersion: claims.priceVersion,
    requestedAt: claims.requestedAt,
  };
  const reservation = await dependencies.reserve({
    userId: input.userId,
    operationId: input.operation.operationId,
    operationType: OPERATION_TYPE,
    requestHash,
    maxCostMinor: claims.maxCostMinor,
    storyId: input.storyId,
    quoteExpiresAt: new Date(claims.expiresAt),
    now: new Date(now),
  });
  if (reservation.outcome === "conflict") {
    return { status: "error", message: "这个生成操作已用于另一段声音" };
  }
  if (reservation.outcome === "insufficient_balance") {
    return {
      status: "error",
      message: `算力余额不足，需要 ¥${toYuan(reservation.requiredMinor).toFixed(2)}`,
    };
  }
  if (reservation.outcome === "no_trusted_max_cost") {
    return { status: "error", message: "声音费用上界不可用" };
  }
  if (reservation.outcome === "quote_expired") {
    return { status: "error", message: "声音报价已过期，请重新确认" };
  }

  if (reservation.outcome === "replayed") {
    const asset = await findReusableReadyStoryAudioAsset({
      scope: { storyId: input.storyId, userId: input.userId },
      sourceKind: "tts",
      sourceKey: input.operation.operationId,
    });
    const attempts = priorAttempts;
    if (asset) {
      const succeeded = [...attempts]
        .reverse()
        .find(attempt => attempt.status === "succeeded");
      const timelineEnvelope = await loadOwnedStoryTimelineEnvelope({
        storyId: input.storyId,
        userId: input.userId,
      });
      const insertionCommitted = Boolean(
        timelineEnvelope &&
          findDurableTimelineMediaOperation(
            timelineEnvelope.extensions,
            input.operation
          )
      );
      const placement = insertionCommitted
        ? placementFromUsage(succeeded?.usage)
        : await currentPlacement({
            storyId: input.storyId,
            userId: input.userId,
            stableShotId: claims.context.stableShotId,
          });
      if (!placement) {
        return {
          status: "error",
          message: "声音已经生成，但原镜头已被删除，未自动写入时间线",
        };
      }
      const timeline = await insertGeneratedAsset({
        storyId: input.storyId,
        userId: input.userId,
        operation: input.operation,
        claims,
        placement,
        asset,
        insert: dependencies.insert,
      });
      if (timeline.status === "error") {
        return { status: "error", message: timeline.error };
      }
      if (reservation.status !== "settled") {
        await dependencies.recordAttempt({
          operationId: input.operation.operationId,
          attemptIndex: 1,
          provider: claims.provider,
          model: claims.model,
          status: "succeeded",
          costMinor: claims.maxCostMinor,
          usage: { ...provenance, assetId: asset.id, placement },
        });
        await dependencies.settle({
          operationId: input.operation.operationId,
          outcome: {
            kind: "succeeded",
            verifiedCostMinor: claims.maxCostMinor,
          },
        });
      }
      return {
        status: "ready",
        assetId: asset.id,
        timeline,
        replayed: true,
      };
    }
    if (reservation.status === "submission_unknown") {
      return {
        status: "submission-unknown",
        message: "上一次声音请求结果未知，已保留预占且不会自动重试",
      };
    }
    if (
      reservation.status === "released" ||
      reservation.status === "exception"
    ) {
      return { status: "error", message: "这次声音生成已经结束，请重新发起" };
    }
    const submitted = [...attempts]
      .reverse()
      .find(attempt => attempt.status === "submitted");
    const usage = submitted?.usage as Record<string, unknown> | null;
    const providerAudioUrl =
      typeof usage?.providerAudioUrl === "string"
        ? usage.providerAudioUrl
        : null;
    if (providerAudioUrl) {
      return continueWithProviderResult({
        input,
        claims,
        provenance,
        providerResult: {
          provider: claims.provider as StoryAudio302Result["provider"],
          model: claims.model,
          source: { kind: "url", url: providerAudioUrl },
        },
        dependencies,
        replayed: true,
      });
    }
    const lastAttempt =
      submitted ??
      [...attempts].reverse().find(attempt => attempt.status === "prepared");
    const attemptedAt = lastAttempt
      ? new Date(lastAttempt.updatedAt ?? lastAttempt.createdAt).getTime()
      : Number.NaN;
    if (
      lastAttempt &&
      Number.isFinite(attemptedAt) &&
      now - attemptedAt >= PREPARED_RECOVERY_GRACE_MS
    ) {
      const message =
        "上一次声音请求可能已经提交，但结果未能确认；已冻结操作且不会自动重试";
      await dependencies.recordAttempt({
        operationId: input.operation.operationId,
        attemptIndex: 1,
        provider: claims.provider,
        model: claims.model,
        status: "submission_unknown",
        usage: provenance,
      });
      await dependencies.settle({
        operationId: input.operation.operationId,
        outcome: { kind: "submission_unknown" },
        reason: message,
      });
      return { status: "submission-unknown", message };
    }
    return { status: "pending", message: "这段声音正在生成，请勿重复提交" };
  }

  await dependencies.recordAttempt({
    operationId: input.operation.operationId,
    attemptIndex: 1,
    provider: claims.provider,
    model: claims.model,
    status: "prepared",
    usage: provenance,
  });
  let providerResult: StoryAudio302Result;
  try {
    providerResult = await dependencies.generate({
      kind: claims.kind,
      prompt,
      durationSeconds: context.durationFrames / STORY_TIMELINE_FPS,
    });
  } catch (error) {
    const providerError =
      error instanceof StoryAudio302Error
        ? error
        : new StoryAudio302Error(
            "submission_unknown",
            error instanceof Error ? error.message : "声音请求结果未知"
          );
    await dependencies.recordAttempt({
      operationId: input.operation.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.model,
      status: providerError.outcome,
      usage: provenance,
      ...(providerError.outcome === "charged_failure"
        ? { costMinor: claims.maxCostMinor }
        : {}),
    });
    await dependencies.settle({
      operationId: input.operation.operationId,
      outcome:
        providerError.outcome === "submission_unknown"
          ? { kind: "submission_unknown" }
          : providerError.outcome === "charged_failure"
            ? {
                kind: "charged_failure",
                verifiedCostMinor: claims.maxCostMinor,
              }
            : { kind: "not_charged_failure" },
      reason: providerError.message,
    });
    return providerError.outcome === "submission_unknown"
      ? { status: "submission-unknown", message: providerError.message }
      : { status: "error", message: providerError.message };
  }
  await dependencies.recordAttempt({
    operationId: input.operation.operationId,
    attemptIndex: 1,
    provider: claims.provider,
    model: claims.model,
    status: "submitted",
    usage: {
      ...provenance,
      providerAudioUrl: providerResult.source.url,
    },
  });
  return continueWithProviderResult({
    input,
    claims,
    provenance,
    providerResult,
    dependencies,
    replayed: false,
  });
}

async function continueWithProviderResult(input: {
  input: {
    storyId: number;
    userId: number;
    operation: VisualEditOperationRef;
  };
  claims: SceneAudioQuoteClaims;
  provenance: SceneAudioProvenance;
  providerResult: StoryAudio302Result;
  dependencies: StoryAudioGenerationDependencies;
  replayed: boolean;
}): Promise<GenerateStorySceneAudioResult> {
  const { claims, dependencies, providerResult, provenance } = input;
  const displayName = `${claims.kind}-SH${String(claims.context.shotNo).padStart(2, "0")}.mp3`;
  const common = {
    scope: { storyId: input.input.storyId, userId: input.input.userId },
    operationId: importOperationId(input.input.operation.operationId),
    sourceKind: "tts" as const,
    displayName,
    sourceKey: input.input.operation.operationId,
    mediaKind: claims.kind,
    provenance,
  };
  const imported = await dependencies.importRemote({
    ...common,
    url: providerResult.source.url,
  });
  if (imported.status !== "ready") {
    await dependencies.recordAttempt({
      operationId: input.input.operation.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.model,
      status: "charged_failure",
      costMinor: claims.maxCostMinor,
      usage: { ...provenance, importFailure: imported.failureCode },
    });
    await dependencies.settle({
      operationId: input.input.operation.operationId,
      outcome: {
        kind: "charged_failure",
        verifiedCostMinor: claims.maxCostMinor,
      },
      reason: imported.reason,
    });
    return { status: "error", message: imported.reason };
  }
  const placement = await currentPlacement({
    storyId: input.input.storyId,
    userId: input.input.userId,
    stableShotId: claims.context.stableShotId,
  });
  if (!placement) {
    const message = "声音已经生成，但原镜头已被删除，未自动写入时间线";
    await dependencies.recordAttempt({
      operationId: input.input.operation.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.model,
      status: "charged_failure",
      costMinor: claims.maxCostMinor,
      usage: { ...provenance, assetId: imported.asset.id },
    });
    await dependencies.settle({
      operationId: input.input.operation.operationId,
      outcome: {
        kind: "charged_failure",
        verifiedCostMinor: claims.maxCostMinor,
      },
      reason: message,
    });
    return { status: "error", message };
  }
  await dependencies.recordAttempt({
    operationId: input.input.operation.operationId,
    attemptIndex: 1,
    provider: claims.provider,
    model: claims.model,
    status: "succeeded",
    costMinor: claims.maxCostMinor,
    usage: { ...provenance, assetId: imported.asset.id, placement },
  });
  const timeline = await insertGeneratedAsset({
    storyId: input.input.storyId,
    userId: input.input.userId,
    operation: input.input.operation,
    claims,
    placement,
    asset: imported.asset,
    insert: dependencies.insert,
  });
  if (timeline.status === "error") {
    await dependencies.recordAttempt({
      operationId: input.input.operation.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.model,
      status: "charged_failure",
      costMinor: claims.maxCostMinor,
      usage: {
        ...provenance,
        assetId: imported.asset.id,
        placement,
        timelineFailure: timeline.error,
      },
    });
    await dependencies.settle({
      operationId: input.input.operation.operationId,
      outcome: {
        kind: "charged_failure",
        verifiedCostMinor: claims.maxCostMinor,
      },
      reason: timeline.error,
    });
    return { status: "error", message: timeline.error };
  }
  await dependencies.settle({
    operationId: input.input.operation.operationId,
    outcome: { kind: "succeeded", verifiedCostMinor: claims.maxCostMinor },
  });
  return {
    status: "ready",
    assetId: imported.asset.id,
    timeline,
    replayed: input.replayed,
  };
}
