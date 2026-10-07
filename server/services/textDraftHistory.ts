import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getStoryById, listUserStorySummariesPage } from "../repositories/stories";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  readTextDraftHistory,
  textConversationDelta,
  textDraftContentSchema,
  textDraftMessageSchema,
  writingObservationSchema,
  type TextDraftHistory,
  type TextDraftVersion,
  type TextDraftRequest,
  type TextDraftContent,
} from "../../shared/textDraftHistory";
import {
  getPublishingContentError,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { loadStoryPromptAggregate } from "./promptLineageStore";
import { inheritedStoryReference } from "../../shared/storyContextShare";
import { runJsonAgent } from "./agentRuntime";
import { InferenceError } from "../_core/inferenceOrchestrator";
import {
  compileTextDraftPrompt,
  type WritingEvidence,
  type OriginalWritingEvidence,
} from "./textDraftPrompt";
import {
  WRITING_LIBRARY_VERSION,
  WRITING_PROMPT_VERSION,
  WRITING_TECHNIQUES,
} from "./writingTechniqueLibrary";
import { canonicalizePublishingDraftState } from "./publishingPersistence";
import { normalizeFinishedProductState } from "../../shared/finishedProductVersion";

type Owner = { storyId: number; userId: number };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
const conflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });
const bad = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });
const UNKNOWN_AFTER = 5 * 60_000;

async function owned(input: Owner) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  return story;
}

/** Uses the common Story CAS, including SQL mode. Model calls never occur inside retries. */
async function mutateHistory<T>(
  input: Owner,
  apply: (history: TextDraftHistory, body: Record<string, unknown>) => T,
  reserveBytes = 0
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const story = await owned(input);
    const body = structuredClone(record(story.body));
    const history = readTextDraftHistory(body.textDraftHistory);
    const value = apply(history, body);
    history.revision++;
    body.textDraftHistory = history;
    if (
      Buffer.byteLength(JSON.stringify(body), "utf8") >
      5_000_000 - reserveBytes
    )
      throw bad("文字历史已达到当前故事容量，请新建故事后继续；旧稿已保留");
    const prepared = prepareStoryBody(
      body,
      getStoryRevision(story.body) + 1,
      body
    );
    try {
      await persistPreparedStoryBody({
        ...input,
        expectedRevision: getStoryRevision(story.body),
        body: prepared,
      });
      return { history, value };
    } catch (error) {
      if (!(error instanceof StoryBodyRevisionConflictError) || attempt === 4)
        throw error;
    }
  }
  throw conflict("故事正在更新，请刷新后重试");
}

export async function getTextDraftHistory(input: Owner) {
  const story = await owned(input);
  const history = readTextDraftHistory(record(story.body).textDraftHistory);
  // Expired claims remain terminally uncertain: never auto-submit another model call.
  return {
    ...history,
    versions: history.versions.map(version =>
      version.status === "generating" &&
      Date.now() - version.createdAt > UNKNOWN_AFTER
        ? {
            ...version,
            status: "unknown" as const,
            error: "未收到生成结果，可能已计费；不会自动重新提交",
          }
        : version
    ),
  };
}

/** Bounded retrieval, owner-filtered at the repository and again for every read. */
async function writingEvidence(input: Owner, platform: string) {
  const page = await listUserStorySummariesPage(input.userId, 0, 100);
  const result: WritingEvidence[] = [];
  const originalSamples: OriginalWritingEvidence[] = [];
  const seen = new Set<string>();
  const originalSeen = new Set<string>();
  for (let offset = 0; offset < page.stories.length; offset += 4) {
    const batch = page.stories.slice(offset, offset + 4);
    const stories = await Promise.all(batch.map(item => getStoryById(item.id, input.userId)));
    // Process in the original recency order, regardless of read completion order.
    for (const story of stories) {
      if (!story) continue;
      const history = readTextDraftHistory(record(story.body).textDraftHistory);
      for (const version of [...history.versions].reverse()) {
        if (version.request.platform !== platform) continue;
        if (
          version.originalLearningEnabled !== false &&
          originalSamples.length < 6 &&
          (version.request.source === "own" || version.request.source === "liked")
        ) {
          const messages = version.request.messages.filter(
            message => message.role === "user"
          );
          const key = hash({
            source: version.request.source,
            messages: messages.map(m => m.content),
            instruction: version.request.instruction,
          });
          if (!originalSeen.has(key)) {
            originalSeen.add(key);
            originalSamples.push({
              storyId: story.id,
              versionId: version.id,
              source: version.request.source,
              messages,
              instruction: version.request.instruction,
            });
          }
        }
        if (
          !version.adoption?.learningEnabled ||
          version.request.platform !== platform
        )
          continue;
        const key = hash(version.adoption.content);
        if (seen.has(key)) continue;
        seen.add(key);
        if (result.length < 6)
          result.push({
            storyId: story.id,
            versionId: version.id,
            platform,
            generated: version.generated,
            adopted: version.adoption,
            observation: version.observation,
          });
        if (result.length >= 6 && originalSamples.length >= 6)
          return { adoptions: result, originalSamples };
      }
    }
  }
  return { adoptions: result, originalSamples };
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const message = record(raw);
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim()
    )
      return [];
    return [
      {
        id: String(message.clientMessageId ?? message.id ?? `legacy-${index}`),
        role: message.role as "user" | "assistant",
        content: message.content,
      },
    ];
  });
}

export async function generateTextDraft(
  input: TextDraftRequest & { userId: number }
) {
  const { userId, ...request } = input;
  const owner = { storyId: input.storyId, userId };
  const requestHash = hash(request);
  const story = await owned(owner);
  const body = record(story.body);
  const initial = readTextDraftHistory(body.textDraftHistory);
  const prior = initial.versions.find(
    version => version.id === request.operationToken
  );
  if (prior) {
    if (prior.requestHash !== requestHash)
      throw conflict("生成标识已用于另一份内容");
    return getTextDraftHistory(owner);
  }
  const parent = request.parentId
    ? initial.versions.find(version => version.id === request.parentId)
    : null;
  if (
    request.parentId &&
    (!parent ||
      parent.status !== "ready" ||
      parent.request.platform !== request.platform)
  )
    throw bad("来源文字版本不存在或平台不一致");
  // New/legacy stories may not have a migrated conversation yet. A missing
  // aggregate is normal; ownership and storage failures must still propagate.
  const durable = (await loadStoryPromptAggregate(owner))?.messages ?? [];
  const messages = new Map<
    string,
    ReturnType<typeof normalizeMessages>[number]
  >();
  for (const message of [
    ...normalizeMessages(body.messages),
    ...normalizeMessages(durable),
    ...request.messages,
  ])
    messages.set(message.id, message);
  const snapshot = [...messages.values()];
  if (!z.array(textDraftMessageSchema).safeParse(snapshot).success) {
    throw bad("历史对话中有过长或无效的消息，请整理材料后再生成；旧稿未改动");
  }
  const delta = textConversationDelta(
    parent?.conversationSnapshot ?? [],
    snapshot
  );
  if (
    !request.basis &&
    !snapshot.some(message => message.role === "user") &&
    !request.instruction.trim()
  )
    throw bad("先在聊天框说说想写的内容");
  if (snapshot.length > 300 || JSON.stringify(snapshot).length > 100_000)
    throw bad("本次对话太长，请整理材料后再生成；内容未被截断");
  const { adoptions: evidence, originalSamples } = await writingEvidence(
    owner,
    request.platform
  );
  const prompt = compileTextDraftPrompt(
    request,
    delta,
    evidence,
    originalSamples,
    inheritedStoryReference(body)
  );
  if (prompt.modelMessage.length > 160_000)
    throw bad("写作上下文过长，请缩短本次材料");
  let claimed: TextDraftVersion;
  try {
    const saved = await mutateHistory(
      owner,
      history => {
        if (
          history.versions.some(
            version => version.id === request.operationToken
          )
        )
          throw conflict("这次生成已经受理，请刷新查看");
        if (history.revision !== request.expectedRevision)
          throw conflict("文字历史已更新，请刷新后再生成");
        if (
          history.versions.some(
            version =>
              version.status === "generating" &&
              Date.now() - version.createdAt < UNKNOWN_AFTER
          )
        )
          throw conflict("已有文字正在生成，请等待完成");
        if (history.versions.length >= 100)
          throw bad("当前故事已保存100次生成记录，请新建故事继续");
        const next: TextDraftVersion = {
          id: request.operationToken,
          sequence: history.versions.length + 1,
          requestHash,
          status: "generating",
          createdAt: Date.now(),
          request,
          conversationSnapshot: snapshot,
          conversationDelta: delta,
          promptVersion: WRITING_PROMPT_VERSION,
          libraryVersion: WRITING_LIBRARY_VERSION,
          ...prompt,
        };
        history.versions.push(next);
        return next;
      },
      180_000
    );
    claimed = saved.value;
  } catch (error) {
    const latest = await getTextDraftHistory(owner);
    const duplicate = latest.versions.find(
      version => version.id === request.operationToken
    );
    if (duplicate?.requestHash === requestHash) return latest;
    throw error;
  }
  let output: {
    draft: TextDraftContent;
    observation: z.infer<typeof writingObservationSchema>;
  };
  let modelLabel: string;
  try {
    const result = await runJsonAgent<unknown>({
      systemPrompt: claimed.systemPrompt,
      message: claimed.modelMessage,
      history: [],
      maxTokens: 4500,
      responseFormat: { type: "json_object" },
      execution: { reasoningEffort: "low", deadlineMs: 90_000, replaySafe: false },
      fallback: () => null,
    });
    output = z
      .object({
        draft: textDraftContentSchema,
        observation: writingObservationSchema,
      })
      .parse(result.parsed);
    const ids = new Set<string>(WRITING_TECHNIQUES.map(item => item.id));
    if (
      output.observation.choices.some(item => !ids.has(item.id)) ||
      new Set(output.observation.choices.map(item => item.id)).size !==
        output.observation.choices.length
    )
      throw bad("模型返回了无效技巧，请查看本次失败记录");
    if (!evidence.length && output.observation.confidence === "supported")
      output.observation.confidence = "tentative";
    if (request.source === "unknown" || request.source === "reference") {
      if (!evidence.length) output.observation.confidence = "insufficient";
    }
    if (request.basis)
      output.draft = {
        ...output.draft,
        title: request.basis.title,
        tags: [...request.basis.tags],
      };
    if (request.platform === "x") output.draft.title = "";
    const contentError = getPublishingContentError(
      request.platform,
      output.draft
    );
    if (contentError) throw bad(contentError);
    modelLabel = result.modelLabel;
  } catch (error) {
    const inference = error instanceof InferenceError ? error : null;
    const definite =
      error instanceof z.ZodError ||
      (error instanceof TRPCError && error.code === "BAD_REQUEST") ||
      Boolean(inference?.attempts.length && inference.attempts.every(attempt =>
        !attempt.acceptanceUnknown && ["auth", "invalid_request", "rate_limit", "content_safety", "context_length"].includes(attempt.category)
      ));
    // Keep provider diagnostics without storing credentials, prompts or raw responses.
    const reason = inference
      ? ({ auth: "模型服务认证失败", invalid_request: "模型服务拒绝了请求参数", timeout: "模型服务超时", network: "模型服务连接中断", rate_limit: "模型服务繁忙", server_error: "模型服务暂时不可用", content_safety: "模型服务未接受此内容", context_length: "素材超出模型长度限制", aborted: "生成已中断", unknown: "未能确认生成结果" }[inference.category])
      : error instanceof z.ZodError || (error instanceof TRPCError && error.code === "BAD_REQUEST")
        ? "生成结果未通过校验"
        : "未能确认生成结果";
    console.warn("[textDrafts] generation failed", {
      storyId: owner.storyId, versionId: claimed.id,
      attempts: inference?.attempts,
      category: inference?.category ?? (definite ? "validation" : "unknown"),
    });
    await mutateHistory(owner, history => {
      const version = history.versions.find(item => item.id === claimed.id)!;
      version.status = definite ? "failed" : "unknown";
      version.error = `${reason}；${definite ? "旧稿已保留" : "可能已计费"}，未自动重试`;
      version.completedAt = Date.now();
    });
    return getTextDraftHistory(owner);
  }
  // Persistence retries reuse the result; they never repeat the model invocation.
  const completed = await mutateHistory(owner, history => {
    const version = history.versions.find(item => item.id === claimed.id)!;
    version.status = "ready";
    version.generated = output.draft;
    version.observation = output.observation;
    version.modelLabel = modelLabel;
    version.completedAt = Date.now();
    delete version.error;
  });
  return completed.history;
}

export async function adoptTextDraft(
  input: Owner & {
    versionId: string;
    expectedRevision: number;
    expectedPublishingRevision: number;
    content: TextDraftContent;
    feedback: string;
  }
) {
  const result = await mutateHistory(input, (history, body) => {
    const version = history.versions.find(item => item.id === input.versionId);
    if (!version?.generated || version.status !== "ready")
      throw bad("此文字版本尚未生成完成");
    if (version.adoption) {
      if (
        hash(version.adoption.content) !== hash(input.content) ||
        version.adoption.feedback !== input.feedback
      )
        throw conflict("这一版已经采用；继续修改请生成下一版");
      return normalizePublishingDraftState(body.publishing);
    }
    if (history.revision !== input.expectedRevision)
      throw conflict("文字历史已变化，请刷新后再采用");
    let publishing = normalizePublishingDraftState(body.publishing);
    if (publishing.revision !== input.expectedPublishingRevision)
      throw conflict("发布稿已变化，请刷新并检查最新文字后再采用");
    const content = textDraftContentSchema.parse(input.content);
    const existing = publishing.drafts[version.request.platform]?.content;
    // Preserve a manually saved publishing title, including changes during generation.
    if (existing?.title && existing.title !== content.title)
      throw conflict(
        "发布稿已有标题，请保留该标题后再采用；标题可在发布区单独修改"
      );
    const invalid = getPublishingContentError(
      version.request.platform,
      content
    );
    if (invalid) throw bad(invalid);
    // Finished combinations hold references to immutable text snapshots. Edit a
    // fresh publishing scope instead of changing the referenced snapshot in place.
    const referenced = normalizeFinishedProductState(
      body.finishedProduct
    ).versions.some(item => item.textVersionId === publishing.activeVersionId);
    if (referenced) {
      const active = publishing.versions?.find(
        item => item.versionId === publishing.activeVersionId
      );
      if (!active) throw conflict("成品引用的文字快照不存在，请先检查版本");
      const sequence =
        Math.max(...publishing.versions!.map(item => item.sequence)) + 1;
      const working = {
        ...structuredClone(active),
        versionId: `v${sequence}`,
        sequence,
        parentId: active.versionId,
        displayName: `文字工作稿 ${sequence}`,
        textOperations: {},
      };
      publishing = {
        ...publishing,
        activeVersionId: working.versionId,
        versions: [...publishing.versions!, working],
      };
    }
    // A first standalone draft needs a minimal core for existing publishing consumers.
    if (!publishing.core)
      publishing.core = {
        revision: 1,
        facts: [],
        thesis: content.body.slice(0, 2000),
        emotion: "",
        voiceTraits: [],
        visualConcept: "",
        updatedAt: Date.now(),
      };
    const next = canonicalizePublishingDraftState(
      upsertPublishingPlatformDraft(publishing, {
        platform: version.request.platform,
        content,
        activate: true,
        now: Date.now(),
      })
    );
    body.publishing = next;
    version.adoption = {
      content,
      feedback: input.feedback,
      adoptedAt: Date.now(),
      learningEnabled: true,
    };
    return next;
  });
  return { history: result.history, publishing: result.value };
}

export async function setTextDraftLearning(
  input: Owner & {
    versionId: string;
    enabled: boolean;
    expectedRevision: number;
  }
) {
  const saved = await mutateHistory(input, history => {
    if (history.revision !== input.expectedRevision)
      throw conflict("文字历史已变化，请刷新");
    const version = history.versions.find(item => item.id === input.versionId);
    if (!version) throw bad("文字版本不存在");
    version.originalLearningEnabled = input.enabled;
    if (version.adoption) version.adoption.learningEnabled = input.enabled;
  });
  return saved.history;
}
