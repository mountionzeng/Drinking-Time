/**
 * Paid narration workflow for formal Timeline subtitles (U5).
 *
 * Quote -> durable hold/attempt -> immutable managed candidate -> explicit
 * adopt. Merely editing, moving, previewing, exporting, or loading a Story
 * never imports this module's generation command and therefore cannot call a
 * provider or touch the compute ledger.
 */
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { StoryAudioAsset } from "../../drizzle/schema";
import type { VisualEditOperationRef } from "../../shared/visualEditReceipt";
import { fromYuan, toYuan } from "../../shared/computeMoney";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import { ENV } from "../_core/env";
import {
  loadOwnedStory,
  loadOwnedStoryTimelineEnvelope,
} from "../persistence/storyVisualPersistence";
import {
  recordOperationProviderAttempt,
  reserveForOperation,
  settleOperation,
} from "./computeLedger";
import {
  discardReadyStoryAudioAsset,
  listOwnedStoryAudioAssets,
  findReusableReadyStoryAudioAsset,
  loadReadyStoryAudioAsset,
} from "./storyAudioAssets";
import {
  materializeRemoteAudio,
  type MaterializeRemoteAudioInput,
} from "./storyAudioImport";
import {
  generateStoryVoice302,
  StoryVoice302Error,
  type StoryVoice302Result,
} from "./storyVoice302";
import {
  adoptNarrationCandidateForStory,
  type TimelineMediaCommandResult,
} from "./timelineAudioEditing";

const NARRATION_OPERATION_TYPE = "tts.narration";
const NARRATION_PRICE_VERSION = "tts-302-cny-v1";
const NARRATION_QUOTE_TTL_MS = 5 * 60 * 1_000;
const NARRATION_PRICE_PER_100_CHARS_MINOR = fromYuan(0.02);

type NarrationQuoteClaims = {
  version: 1;
  userId: number;
  storyId: number;
  subtitleCueId: string;
  textRevision: number;
  textHash: string;
  bindingId: string;
  provider: string;
  voice: string;
  maxCostMinor: number;
  priceVersion: string;
  requestedAt: number;
  expiresAt: number;
};

export type StoryNarrationQuote = {
  quoteToken: string;
  storyId: number;
  subtitleCueId: string;
  textRevision: number;
  provider: string;
  voice: string;
  currency: "CNY";
  estimatedCny: number;
  expiresAt: number;
};

type NarrationCandidateProvenance = {
  kind: "story-narration-candidate";
  operationId: string;
  storyId: number;
  subtitleCueId: string;
  textRevision: number;
  textHash: string;
  bindingId: string;
  provider: string;
  voice: string;
  priceVersion: string;
  requestedAt: number;
};

export type StoryNarrationCandidate = {
  assetId: number;
  subtitleCueId: string;
  textRevision: number;
  bindingId: string;
  provider: string;
  voice: string;
  durationFrames: number;
  audioUrl: string;
  requestedAt: number;
  adopted: boolean;
  adoptable: boolean;
  unavailableReason?: string;
};

export class StoryNarrationProviderError extends Error {
  readonly outcome:
    | "not_charged_failure"
    | "charged_failure"
    | "submission_unknown";

  constructor(
    outcome:
      | "not_charged_failure"
      | "charged_failure"
      | "submission_unknown",
    message: string
  ) {
    super(message);
    this.name = "StoryNarrationProviderError";
    this.outcome = outcome;
  }
}

type StoryNarrationDependencies = {
  now: () => number;
  generateVoice: (input: {
    text: string;
    provider: string;
    voice: string;
  }) => Promise<StoryVoice302Result>;
  materializeRemote: (
    input: MaterializeRemoteAudioInput
  ) => ReturnType<typeof materializeRemoteAudio>;
  reserve: typeof reserveForOperation;
  settle: typeof settleOperation;
  recordAttempt: typeof recordOperationProviderAttempt;
};

const defaultDependencies: StoryNarrationDependencies = {
  now: Date.now,
  generateVoice: generateStoryVoice302,
  materializeRemote: materializeRemoteAudio,
  reserve: reserveForOperation,
  settle: settleOperation,
  recordAttempt: recordOperationProviderAttempt,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function narrationTextHash(text: string): string {
  return sha256(text.trim());
}

/** Product-side maximum charge. Provider changes require a new price version. */
export function estimateStoryNarrationCostMinor(text: string): number {
  const characters = Array.from(text.trim()).length;
  return Math.max(
    NARRATION_PRICE_PER_100_CHARS_MINOR,
    Math.ceil(characters / 100) * NARRATION_PRICE_PER_100_CHARS_MINOR
  );
}

function quoteSigningKey(): string {
  const key = ENV.cookieSecret || ENV.api302Key;
  if (!key && ENV.isProduction) {
    throw new Error("服务器尚未配置旁白报价签名密钥");
  }
  return key || "local-story-narration-quote-key";
}

function encodeQuote(claims: NarrationQuoteClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", quoteSigningKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function decodeQuote(token: string): NarrationQuoteClaims | null {
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
    ) as NarrationQuoteClaims;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveCue(input: {
  storyId: number;
  userId: number;
  subtitleCueId: string;
}) {
  const [story, timeline] = await Promise.all([
    loadOwnedStory({ storyId: input.storyId, userId: input.userId }),
    loadOwnedStoryTimelineEnvelope({
      storyId: input.storyId,
      userId: input.userId,
    }),
  ]);
  if (!story || !timeline) throw new Error("故事或时间线不存在，无法生成旁白");
  const subtitleState = normalizeSubtitleState(
    timeline.extensions.subtitleTracks
  );
  const cue = subtitleState.tracks[0]?.cues.find(
    candidate => candidate.id === input.subtitleCueId
  );
  if (!cue) throw new Error("字幕块不存在或已经更新");
  if (!cue.text.trim()) throw new Error("字幕文字为空，不能生成旁白");
  return { cue, timeline };
}

function providerAndVoice(input: { provider?: string; voice?: string }) {
  const configuredProvider = ENV.tts302Provider.trim();
  const configuredVoice = ENV.tts302Voice.trim();
  const provider = (input.provider ?? configuredProvider).trim();
  const voice = (input.voice ?? configuredVoice).trim();
  if (provider !== configuredProvider || voice !== configuredVoice) {
    throw new Error("旁白服务商或音色不在当前白名单");
  }
  return { provider, voice };
}

export async function quoteStoryNarration(input: {
  storyId: number;
  userId: number;
  subtitleCueId: string;
  provider?: string;
  voice?: string;
  now?: () => number;
}): Promise<StoryNarrationQuote> {
  const { cue } = await resolveCue(input);
  const { provider, voice } = providerAndVoice(input);
  const requestedAt = (input.now ?? Date.now)();
  const claims: NarrationQuoteClaims = {
    version: 1,
    userId: input.userId,
    storyId: input.storyId,
    subtitleCueId: cue.id,
    textRevision: cue.textRevision,
    textHash: narrationTextHash(cue.text),
    bindingId: cue.speechBindingId ?? randomUUID(),
    provider,
    voice,
    maxCostMinor: estimateStoryNarrationCostMinor(cue.text),
    priceVersion: NARRATION_PRICE_VERSION,
    requestedAt,
    expiresAt: requestedAt + NARRATION_QUOTE_TTL_MS,
  };
  return {
    quoteToken: encodeQuote(claims),
    storyId: input.storyId,
    subtitleCueId: cue.id,
    textRevision: cue.textRevision,
    provider,
    voice,
    currency: "CNY",
    estimatedCny: toYuan(claims.maxCostMinor),
    expiresAt: claims.expiresAt,
  };
}

function narrationProvenance(value: unknown): NarrationCandidateProvenance | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NarrationCandidateProvenance>;
  if (
    record.kind !== "story-narration-candidate" ||
    typeof record.operationId !== "string" ||
    typeof record.storyId !== "number" ||
    typeof record.subtitleCueId !== "string" ||
    typeof record.textRevision !== "number" ||
    typeof record.textHash !== "string" ||
    typeof record.bindingId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.voice !== "string" ||
    typeof record.requestedAt !== "number"
  ) {
    return null;
  }
  return record as NarrationCandidateProvenance;
}

function candidateFromAsset(
  asset: StoryAudioAsset,
  provenance: NarrationCandidateProvenance,
  options: { adopted: boolean; adoptable: boolean; unavailableReason?: string }
): StoryNarrationCandidate {
  return {
    assetId: asset.id,
    subtitleCueId: provenance.subtitleCueId,
    textRevision: provenance.textRevision,
    bindingId: provenance.bindingId,
    provider: provenance.provider,
    voice: provenance.voice,
    durationFrames: Math.max(1, asset.durationFrames ?? 1),
    audioUrl: `/api/story-audio-asset/${asset.storyId}/${asset.id}`,
    requestedAt: provenance.requestedAt,
    adopted: options.adopted,
    adoptable: options.adoptable,
    ...(options.unavailableReason
      ? { unavailableReason: options.unavailableReason }
      : {}),
  };
}

export async function listStoryNarrationCandidates(input: {
  storyId: number;
  userId: number;
  subtitleCueId?: string;
}): Promise<StoryNarrationCandidate[]> {
  if (!(await loadOwnedStory({ storyId: input.storyId, userId: input.userId }))) {
    return [];
  }
  const [assets, envelope] = await Promise.all([
    listOwnedStoryAudioAssets({ storyId: input.storyId, userId: input.userId }),
    loadOwnedStoryTimelineEnvelope({
      storyId: input.storyId,
      userId: input.userId,
    }),
  ]);
  if (!envelope) return [];
  const subtitle = normalizeSubtitleState(envelope.extensions.subtitleTracks);
  const audio = normalizeAudioState(envelope.extensions.audioTracks);
  const refs = new Set(
    audio.tracks.flatMap(track => track.clips.map(clip => clip.assetId))
  );
  const ready = assets
    .flatMap(asset => {
      const provenance = narrationProvenance(asset.provenance);
      return asset.status === "ready" &&
        asset.sourceKind === "tts" &&
        provenance &&
        (!input.subtitleCueId || provenance.subtitleCueId === input.subtitleCueId)
        ? [{ asset, provenance }]
        : [];
    })
    .sort(
      (left, right) =>
        right.provenance.requestedAt - left.provenance.requestedAt ||
        right.asset.id - left.asset.id
    );
  const newestByCue = new Map<string, number>();
  for (const entry of ready) {
    if (!newestByCue.has(entry.provenance.subtitleCueId)) {
      newestByCue.set(
        entry.provenance.subtitleCueId,
        entry.provenance.requestedAt
      );
    }
  }
  return ready.map(({ asset, provenance }) => {
    const cue = subtitle.tracks[0]?.cues.find(
      candidate => candidate.id === provenance.subtitleCueId
    );
    let unavailableReason: string | undefined;
    if (!cue) unavailableReason = "字幕已经删除";
    else if (
      cue.textRevision !== provenance.textRevision ||
      narrationTextHash(cue.text) !== provenance.textHash
    ) {
      unavailableReason = "字幕文字已经更新";
    } else if (cue.speechBindingId && cue.speechBindingId !== provenance.bindingId) {
      unavailableReason = "字幕绑定已经更新";
    } else if (
      (newestByCue.get(provenance.subtitleCueId) ?? provenance.requestedAt) >
      provenance.requestedAt
    ) {
      unavailableReason = "已有更新的旁白候选";
    }
    return candidateFromAsset(asset, provenance, {
      adopted: refs.has(asset.id),
      adoptable: !unavailableReason,
      ...(unavailableReason ? { unavailableReason } : {}),
    });
  });
}

export type GenerateStoryNarrationResult =
  | { status: "candidate-ready"; candidate: StoryNarrationCandidate; replayed: boolean }
  | { status: "pending"; message: string }
  | { status: "submission-unknown"; message: string }
  | { status: "error"; message: string };

export async function generateStoryNarrationCandidate(input: {
  storyId: number;
  userId: number;
  subtitleCueId: string;
  operationId: string;
  quoteToken: string;
  dependencies?: Partial<StoryNarrationDependencies>;
}): Promise<GenerateStoryNarrationResult> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const claims = decodeQuote(input.quoteToken);
  if (!claims) return { status: "error", message: "旁白报价无效，请重新确认" };
  const now = dependencies.now();
  if (
    claims.userId !== input.userId ||
    claims.storyId !== input.storyId ||
    claims.subtitleCueId !== input.subtitleCueId ||
    claims.expiresAt <= now ||
    claims.priceVersion !== NARRATION_PRICE_VERSION
  ) {
    return { status: "error", message: "旁白报价已过期或作用域不匹配" };
  }

  let resolved;
  try {
    resolved = await resolveCue(input);
    providerAndVoice({ provider: claims.provider, voice: claims.voice });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "旁白目标不可用",
    };
  }
  const { cue } = resolved;
  if (
    cue.textRevision !== claims.textRevision ||
    narrationTextHash(cue.text) !== claims.textHash ||
    estimateStoryNarrationCostMinor(cue.text) !== claims.maxCostMinor ||
    (cue.speechBindingId != null && cue.speechBindingId !== claims.bindingId)
  ) {
    return { status: "error", message: "字幕文字或绑定已经更新，请重新生成旁白" };
  }

  const requestHash = sha256(
    JSON.stringify({
      operationType: NARRATION_OPERATION_TYPE,
      storyId: input.storyId,
      subtitleCueId: input.subtitleCueId,
      textRevision: claims.textRevision,
      textHash: claims.textHash,
      bindingId: claims.bindingId,
      provider: claims.provider,
      voice: claims.voice,
      maxCostMinor: claims.maxCostMinor,
      priceVersion: claims.priceVersion,
    })
  );
  const reservation = await dependencies.reserve({
    userId: input.userId,
    operationId: input.operationId,
    operationType: NARRATION_OPERATION_TYPE,
    requestHash,
    maxCostMinor: claims.maxCostMinor,
    storyId: input.storyId,
    quoteExpiresAt: new Date(claims.expiresAt),
    now: new Date(now),
  });
  if (reservation.outcome === "conflict") {
    return { status: "error", message: "这个生成操作已用于另一份旁白" };
  }
  if (reservation.outcome === "insufficient_balance") {
    return {
      status: "error",
      message: `算力余额不足，需要 ¥${toYuan(reservation.requiredMinor).toFixed(2)}`,
    };
  }
  if (reservation.outcome === "no_trusted_max_cost") {
    return { status: "error", message: "旁白费用上界不可用" };
  }
  if (reservation.outcome === "quote_expired") {
    return { status: "error", message: "旁白报价已过期，请重新确认" };
  }
  if (reservation.outcome === "replayed") {
    const asset = await findReusableReadyStoryAudioAsset({
      scope: { storyId: input.storyId, userId: input.userId },
      sourceKind: "tts",
      sourceKey: input.operationId,
    });
    const provenance = narrationProvenance(asset?.provenance);
    if (reservation.status === "settled" && asset && provenance) {
      const candidates = await listStoryNarrationCandidates({
        storyId: input.storyId,
        userId: input.userId,
        subtitleCueId: input.subtitleCueId,
      });
      const candidate = candidates.find(item => item.assetId === asset.id);
      if (candidate) {
        return { status: "candidate-ready", candidate, replayed: true };
      }
      return {
        status: "candidate-ready",
        candidate: candidateFromAsset(asset, provenance, {
          adopted: false,
          adoptable: false,
          unavailableReason: "字幕或候选已经更新",
        }),
        replayed: true,
      };
    }
    if (reservation.status === "submission_unknown") {
      return {
        status: "submission-unknown",
        message: "上一次请求结果未知，已保留预占且不会自动重试",
      };
    }
    if (reservation.status === "released" || reservation.status === "exception") {
      return { status: "error", message: "这次旁白生成已经结束，请重新发起" };
    }
    return { status: "pending", message: "这次旁白正在生成，请勿重复提交" };
  }

  const provenance: NarrationCandidateProvenance = {
    kind: "story-narration-candidate",
    operationId: input.operationId,
    storyId: input.storyId,
    subtitleCueId: input.subtitleCueId,
    textRevision: claims.textRevision,
    textHash: claims.textHash,
    bindingId: claims.bindingId,
    provider: claims.provider,
    voice: claims.voice,
    priceVersion: claims.priceVersion,
    requestedAt: claims.requestedAt,
  };
  await dependencies.recordAttempt({
    operationId: input.operationId,
    attemptIndex: 1,
    provider: claims.provider,
    model: claims.voice,
    status: "prepared",
    usage: provenance,
  });

  let voice: StoryVoice302Result;
  try {
    voice = await dependencies.generateVoice({
      text: cue.text,
      provider: claims.provider,
      voice: claims.voice,
    });
  } catch (error) {
    const providerError =
      error instanceof StoryNarrationProviderError ||
      error instanceof StoryVoice302Error
        ? error
        : new StoryNarrationProviderError(
            "submission_unknown",
            error instanceof Error ? error.message : "旁白请求结果未知"
          );
    await dependencies.recordAttempt({
      operationId: input.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.voice,
      status: providerError.outcome,
      usage: provenance,
      ...(providerError.outcome === "charged_failure"
        ? { costMinor: claims.maxCostMinor }
        : {}),
    });
    await dependencies.settle({
      operationId: input.operationId,
      outcome:
        providerError.outcome === "submission_unknown"
          ? { kind: "submission_unknown" }
          : providerError.outcome === "charged_failure"
            ? { kind: "charged_failure", verifiedCostMinor: claims.maxCostMinor }
            : { kind: "not_charged_failure" },
      reason: providerError.message,
    });
    return providerError.outcome === "submission_unknown"
      ? { status: "submission-unknown", message: providerError.message }
      : { status: "error", message: providerError.message };
  }

  const imported = await dependencies.materializeRemote({
    scope: { storyId: input.storyId, userId: input.userId },
    operationId: `tts-asset:${sha256(input.operationId).slice(0, 48)}`,
    sourceKind: "tts",
    url: voice.audioUrl,
    displayName: `旁白-${input.subtitleCueId}.mp3`,
    sourceKey: input.operationId,
    mediaKind: "narration",
    provenance,
  });
  if (imported.status !== "ready") {
    await dependencies.recordAttempt({
      operationId: input.operationId,
      attemptIndex: 1,
      provider: claims.provider,
      model: claims.voice,
      status: "charged_failure",
      costMinor: claims.maxCostMinor,
      usage: { ...provenance, assetFailureCode: imported.failureCode },
    });
    await dependencies.settle({
      operationId: input.operationId,
      outcome: { kind: "charged_failure", verifiedCostMinor: claims.maxCostMinor },
      reason: imported.reason,
    });
    return { status: "error", message: `旁白已生成，但受管音频导入失败：${imported.reason}` };
  }
  await dependencies.recordAttempt({
    operationId: input.operationId,
    attemptIndex: 1,
    provider: claims.provider,
    model: claims.voice,
    status: "succeeded",
    costMinor: claims.maxCostMinor,
    usage: provenance,
  });
  await dependencies.settle({
    operationId: input.operationId,
    outcome: { kind: "succeeded", verifiedCostMinor: claims.maxCostMinor },
  });
  return {
    status: "candidate-ready",
    candidate: candidateFromAsset(imported.asset, provenance, {
      adopted: false,
      adoptable: true,
    }),
    replayed: imported.reused,
  };
}

export async function adoptStoryNarrationCandidate(input: {
  storyId: number;
  userId: number;
  subtitleCueId: string;
  candidateAssetId: number;
  expectedTextRevision: number;
  operation: VisualEditOperationRef;
}): Promise<TimelineMediaCommandResult> {
  const asset = await loadReadyStoryAudioAsset({
    scope: { storyId: input.storyId, userId: input.userId },
    assetId: input.candidateAssetId,
  });
  const provenance = narrationProvenance(asset?.provenance);
  if (
    !asset ||
    asset.sourceKind !== "tts" ||
    !provenance ||
    provenance.storyId !== input.storyId ||
    provenance.subtitleCueId !== input.subtitleCueId
  ) {
    return {
      status: "error",
      error: "旁白候选不存在或不属于这条字幕",
      errorKind: "invalid",
    };
  }
  const candidates = await listStoryNarrationCandidates({
    storyId: input.storyId,
    userId: input.userId,
    subtitleCueId: input.subtitleCueId,
  });
  const candidate = candidates.find(item => item.assetId === asset.id);
  if (!candidate?.adoptable) {
    return {
      status: "error",
      error: candidate?.unavailableReason ?? "字幕或候选已经更新，请重新生成",
      errorKind: "invalid",
    };
  }
  if (provenance.textRevision !== input.expectedTextRevision) {
    return {
      status: "error",
      error: "字幕文字已经更新，请重新生成旁白",
      errorKind: "invalid",
    };
  }
  return adoptNarrationCandidateForStory({
    storyId: input.storyId,
    userId: input.userId,
    operation: input.operation,
    subtitleCueId: input.subtitleCueId,
    expectedTextRevision: input.expectedTextRevision,
    bindingId: provenance.bindingId,
    candidateAssetId: input.candidateAssetId,
  });
}

/** Delete candidate bytes only when no Timeline clip still references them. */
export async function discardStoryNarrationCandidate(input: {
  storyId: number;
  userId: number;
  candidateAssetId: number;
}): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const asset = await loadReadyStoryAudioAsset({
    scope: { storyId: input.storyId, userId: input.userId },
    assetId: input.candidateAssetId,
  });
  if (!asset || !narrationProvenance(asset.provenance)) {
    return { status: "error", message: "旁白候选不存在或无权删除" };
  }
  const envelope = await loadOwnedStoryTimelineEnvelope({
    storyId: input.storyId,
    userId: input.userId,
  });
  const audio = normalizeAudioState(envelope?.extensions.audioTracks);
  if (
    audio.tracks.some(track =>
      track.clips.some(clip => clip.assetId === input.candidateAssetId)
    )
  ) {
    return { status: "error", message: "这份声音正在时间线上使用，请先删除引用" };
  }
  const discarded = await discardReadyStoryAudioAsset({
    scope: { storyId: input.storyId, userId: input.userId },
    assetId: input.candidateAssetId,
    reason: "用户删除未采用的旁白候选",
  });
  return discarded
    ? { status: "ok" }
    : { status: "error", message: "旁白候选删除失败，请稍后重试" };
}
