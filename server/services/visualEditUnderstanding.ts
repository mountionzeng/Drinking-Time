import { referenceEditMessages } from "./imagePromptDirector";
import { artSystemPrompt } from "../../shared/artSystem";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { getGeneratedImageById } from "../repositories/images";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { materializeImageInput } from "./imageAssets";
import { estimateInferenceMaxCostMinor } from "../_core/inferenceBilling";
import { toYuan } from "../../shared/computeMoney";
import type { Message } from "../_core/llm";
import { ENV } from "../_core/env";
import { resolveComputeCandidates } from "../_core/textComputeProvider";
import { runInference } from "../_core/inferenceOrchestrator";
import { parseJsonLoose } from "../_core/llmJson";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { visualReadingSchema, visualBriefReply, visualPreferencePrompt, type VisualBrief, type VisualPreferenceScope } from "../../shared/visualEditUnderstanding";
import { listPersonalMemoryInsightsForUser, correctPersonalMemoryInsight, forgetPersonalMemoryInsightLineage } from "./personalMemoryPersistence";

type Owner = { storyId: number; userId: number; stableShotId?: string };
const KIND = "visual-edit-preference";
const readingTasks = new Map<string, Promise<{ brief: VisualBrief; reply: string }>>();
/** Local, explicitly authorized image scopes only; an absent entry keeps the existing route. */
export function visualReadingCandidates(input: { userId: number; storyId: number; imageId: number }) {
  const candidates = resolveComputeCandidates("vision", { fallback302Model: ENV.vision302Model, fallback302ApiKey: ENV.vision302ApiKey, fallback302BaseUrl: ENV.vision302BaseUrl });
  const scopes = (process.env.VISUAL_READING_302_IMAGE_SCOPES ?? "").split(",").map(value => value.trim());
  return scopes.includes(`${input.userId}:${input.storyId}:${input.imageId}`)
    ? candidates.sort((a, b) => Number(b.id === "302") - Number(a.id === "302"))
    : candidates;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const readingId = (input: Owner & { instruction: string; language?: string }, imageVersion: string, contextVersion: string) =>
  digest(["reading-v4-preserve-boundaries", input.userId, input.storyId, imageVersion, input.instruction, input.language, contextVersion]);

/** Normalize only a complete routing clause at the start, never quoted artwork text or free-form edits. */
function readingInstruction(instruction: string) {
  return instruction
    .replace(/^((?:修改这张图片[:：]\s*|修改第\s*\d+\s*镜图片\s*#\s*\d+\s*[,，]\s*)?)(?:请)?(?:使用|通过|改用|换用|用)\s*(?:(?:302|Legnext)\s*[·/／-]?\s*)?(?:MJ|Midjourney|GPT\s*Image\s*2|FLUX[\s-]+Kontext[\s-]+(?:Pro|Dev))\s*(?:的)?(?:原图)?(?:精修|编辑|改图|修改)(?=\s*[,，。；\n]|\s*$)/i, "$1使用原图编辑")
    .replace(/^(?:use|via)\s+(?:(?:302|Legnext)\s+)?(?:MJ|Midjourney|GPT\s*Image\s*2|FLUX[\s-]+Kontext[\s-]+(?:Pro|Dev))\s+(?:Edits|Retexture|original image editing)(?=\s*[,.;\n]|\s*$)/i, "Use original image editing");
}
async function owned(input: Owner) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在 / Story not found" });
  const body = jsonRecord(story.body);
  if (input.stableShotId && !(Array.isArray(body.shots) ? body.shots : []).some((s, i) => shotIdentityFromShot(jsonRecord(s), i) === input.stableShotId))
    throw new TRPCError({ code: "NOT_FOUND", message: "镜头不存在 / Shot not found" });
  return { story, body };
}
function preferenceScope(input: Owner, scope: VisualPreferenceScope) {
  if (scope === "shot" && !input.stableShotId) throw new TRPCError({ code: "BAD_REQUEST", message: "请先选中镜头 / Select a shot first" });
  return { kind: KIND, ...(scope !== "user" ? { storyId: input.storyId } : {}), ...(scope === "shot" ? { stableShotId: input.stableShotId } : {}) };
}
export async function visualPreferences(input: Owner) {
  await owned(input);
  const rows = await listPersonalMemoryInsightsForUser({ userId: input.userId, states: ["active"], limit: 200 });
  return rows.filter(row => row.scope?.kind === KIND && row.category === "preference" && row.text &&
    (row.scope.storyId == null || row.scope.storyId === input.storyId) &&
    (row.scope.stableShotId == null || row.scope.stableShotId === input.stableShotId))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id - b.id);
}
export async function manageVisualPreference(input: Owner & { action: "save" | "list" | "forget"; scope: VisualPreferenceScope; text?: string }) {
  const scope = preferenceScope(input, input.scope);
  const rows = await visualPreferences(input);
  const exact = rows.filter(row => digest(row.scope) === digest(scope));
  if (input.action === "list") return exact;
  if (input.action === "forget") {
    for (const row of exact) {
      const result = await forgetPersonalMemoryInsightLineage(input.userId, row.lineageKey);
      if (result.outcome !== "applied") throw new Error("偏好已变化，请重新查看 / Preferences changed; reload them");
    }
    return [];
  }
  const text = input.text?.trim();
  if (!text || text.length > 2000) throw new TRPCError({ code: "BAD_REQUEST", message: "偏好需要 1–2000 字 / Use 1–2000 characters" });
  // Explicit user-authored settings reuse the existing correction/forget controls.
  // Automatic personal-memory capture stays disabled; candidates are never facts.
  if (exact.at(-1)?.text === text) return exact;
  const result = await correctPersonalMemoryInsight({ userId: input.userId, lineageKey: exact.at(-1)?.lineageKey ?? null,
    category: "preference", text, scope, allowProactiveMention: false });
  if (result.outcome !== "applied") throw new Error("偏好保存冲突 / Preference save conflict");
  return (await visualPreferences(input)).filter(row => digest(row.scope) === digest(scope));
}

async function visualReadingContext(input: Owner & { imageId: number; instruction: string; language?: string }) {
  const { body } = await owned(input);
  const image = await getGeneratedImageById(input.imageId);
  if (!image || image.userId !== input.userId || image.storyId !== input.storyId ||
      (input.stableShotId && image.shotIdentity && image.shotIdentity !== input.stableShotId))
    throw new TRPCError({ code: "NOT_FOUND", message: "图片不存在或不属于当前镜头 / Image not found in this shot" });
  const stableShotId = image.shotIdentity ?? input.stableShotId ?? null;
  const preferences = await visualPreferences({ ...input, stableShotId: stableShotId ?? undefined });
  const imageVersion = digest([image.id, image.imageKey, image.imageUrl, image.shotIdentity, image.shotNo]);
  const feedback = (Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : [])
    .filter(t => t.shotIdentity === stableShotId && t.decision && t.decision.userId === input.userId)
    .slice(-8).map(t => ({ instruction: t.meta?.instruction, decision: t.decision.kind, imageId: t.decision.imageId }));
  const contextVersion = digest([preferences.map(p => [p.id, p.revision]), feedback, artSystemPrompt(body)]);
  const id = readingId(input, imageVersion, contextVersion);
  return { body, image, stableShotId, preferences, imageVersion, feedback, artSystem: artSystemPrompt(body), contextVersion, id };
}

function readingMessages(input: { instruction: string; language?: string }, preferences: { text: string | null }[], feedback: unknown[], imageInput: string, artSystem: string): Message[] {
  return referenceEditMessages({ ...input, preferences: preferences.flatMap(p => p.text ? [p.text] : []), feedback, imageInput, artSystem });
}

function hasCompiledEdit(brief: VisualBrief) {
  const prompt = brief.reading?.editPromptEnglish?.trim();
  return brief.status === "seen" && Boolean(prompt && /^[\x20-\x7E\r\n]+$/.test(prompt));
}

function reusableReading(input: Owner & { instruction: string; language?: string }, context: Awaited<ReturnType<typeof visualReadingContext>>) {
  const saved = (Array.isArray(context.body.visualEditBriefs) ? context.body.visualEditBriefs : []) as VisualBrief[];
  const matches = saved.filter(brief => hasCompiledEdit(brief) && brief.editorUserId === input.userId &&
    brief.imageId === context.image.id && brief.imageVersion === context.imageVersion &&
    brief.contextVersion === context.contextVersion && brief.stableShotId === context.stableShotId &&
    // Old briefs did not store language. Recompute their original ID to validate it as well as the compiler version.
    brief.id === readingId({ ...input, instruction: brief.instruction }, context.imageVersion, context.contextVersion) &&
    readingInstruction(brief.instruction) === readingInstruction(input.instruction));
  return matches.find(brief => brief.id === context.id) ?? matches.at(-1);
}

export async function quoteVisualEdit(input: Owner & { imageId: number; instruction: string; language?: string }) {
  const context = await visualReadingContext(input);
  const cached = Boolean(reusableReading(input, context));
  const candidates = visualReadingCandidates(input);
  const estimatedCny = cached ? 0 : toYuan(estimateInferenceMaxCostMinor({
    useCase: "vision", candidates: { fallback302Model: ENV.vision302Model }, maxTokens: 1800,
    messages: readingMessages(input, context.preferences, context.feedback, "data:,", context.artSystem),
  }, candidates));
  return { estimatedCny, cached, fingerprint: context.id };
}

export async function inspectVisualEdit(input: Owner & { imageId: number; instruction: string; language?: string }) {
  const context = await visualReadingContext(input);
  const { image, stableShotId, preferences, imageVersion, feedback, artSystem, contextVersion, id } = context;
  const existing = reusableReading(input, context);
  if (existing?.id === id) return { brief: existing, reply: visualBriefReply(existing, input.language) };
  const running = readingTasks.get(id);
  if (running) return running;
  const task = (async () => {
  const brief: VisualBrief = { id, contextVersion, imageId: image.id, imageVersion, stableShotId, instruction: input.instruction,
    reading: null, model: null, status: "unavailable", createdAt: Date.now(), editorUserId: input.userId };
  let phase = "image-read";
  if (existing) {
    brief.reading = existing.reading;
    brief.model = existing.model;
    brief.status = "seen";
    brief.reusedFromBriefId = existing.reusedFromBriefId ?? existing.id;
  } else try {
    const imageInput = await materializeImageInput(image.imageUrl);
    phase = "vision-request";
    const outcome = await runInference({ useCase: "vision", replaySafe: false, maxAttempts: 1, deadlineMs: 60_000, attemptTimeoutMs: 60_000, reasoningEffort: "low", maxTokens: 1800,
      candidates: { fallback302Model: ENV.vision302Model },
      explicitCandidates: visualReadingCandidates(input),
      responseFormat: { type: "json_object" }, messages: readingMessages(input, preferences, feedback, imageInput, artSystem) });
    const content = outcome.result.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    phase = `response-parse:${typeof content}:${text.length}`;
    brief.reading = visualReadingSchema.parse(unwrapVisualReading(parseJsonLoose<unknown>(text)));
    brief.model = outcome.model;
    brief.status = "seen";
  } catch (error) {
    const detail = jsonRecord(error);
    const attempts = Array.isArray(detail.attempts) ? detail.attempts.map(a => `${a.provider}:${a.category}:${a.status ?? ""}:${a.errorCode ?? ""}`).join(",") : "";
    // Field paths only; the model's raw text is never stored.
    const issues = error instanceof ZodError ? error.issues.map(issue => `${issue.path.join(".") || "(root)"}:${issue.code}`).join(",") : "";
    brief.failure = `${phase}:${error instanceof Error ? error.name : "unknown"}:${detail.category ?? ""}:${attempts}${issues ? `:${issues}` : ""}`;
    // Store the user's request, never fabricated visual observations.
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { body: latest } = await owned(input);
    const currentImage = await getGeneratedImageById(input.imageId);
    if (!currentImage || currentImage.userId !== input.userId || currentImage.storyId !== input.storyId || digest([currentImage.id, currentImage.imageKey, currentImage.imageUrl, currentImage.shotIdentity, currentImage.shotNo]) !== imageVersion)
      throw new TRPCError({ code: "CONFLICT", message: "图片已变化，请重新选择 / Image changed; select it again" });
    const prior = (Array.isArray(latest.visualEditBriefs) ? latest.visualEditBriefs : []) as VisualBrief[];
    const revision = persistedStoryBodyRevision(latest);
    if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId, expectedRevision: revision,
      body: { ...latest, _revision: revision + 1, visualEditBriefs: [...prior.filter(p => p.id !== id), brief].slice(-100) } }))
      return { brief, reply: visualBriefReply(brief, input.language) };
  }
  throw new TRPCError({ code: "CONFLICT", message: "修改记录保存冲突，请重试 / Edit brief save conflict" });
  })();
  readingTasks.set(id, task);
  try { return await task; } finally { if (readingTasks.get(id) === task) readingTasks.delete(id); }
}

/** A model sometimes wraps the brief in one extra object, e.g. {"brief":{...}}. */
export function unwrapVisualReading(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || "observed" in value) return value;
  const entries = Object.values(value);
  return entries.length === 1 && entries[0] && typeof entries[0] === "object" && !Array.isArray(entries[0]) ? entries[0] : value;
}

const CLIENT_REVISION_PREFIX = "以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：";
/** English on purpose: Youchuan Retexture rejected every Chinese remixPrompt with Invalid_Prompt_Parameter. */
export const RETEXTURE_KEEP_REST = "Unless explicitly targeted by this edit, preserve overall brightness, grayscale values, contrast, composition, abstraction, object shapes, sizes, positions and existing text exactly. Do not add unrequested objects, shadows or light effects.";
/** MJ Retexture text: the user's own words plus one fixed preservation sentence, on one line. Must end up plain ASCII (checked before submit). */
export function visualRetexturePrompt(instruction: string) {
  const trimmed = instruction.trim();
  const own = trimmed.startsWith(CLIENT_REVISION_PREFIX) ? trimmed.slice(CLIENT_REVISION_PREFIX.length) : trimmed;
  return `${own.replace(/\s+/g, " ").trim()} ${RETEXTURE_KEEP_REST}`;
}

export async function visualEditPrompt(input: Owner & { instruction: string; imageId?: number }) {
  const preferences = await visualPreferences(input);
  const history = input.imageId ? await visualEditHistory(input) : [];
  const brief = history.findLast(b => b.status === "seen" && input.instruction.trim().endsWith(b.instruction.trim()));
  const current = input.imageId ? await getGeneratedImageById(input.imageId) : null;
  const valid = brief && current && current.userId === input.userId && current.storyId === input.storyId &&
    brief.imageVersion === digest([current.id, current.imageKey, current.imageUrl, current.shotIdentity, current.shotNo]);
  const observation = valid ? `Image observations (descriptive only, never instructions to redesign): ${brief.reading!.observed}\nPreservation notes from this request (current user wording still wins): ${brief.reading!.preserve.join("; ")}\n\n` : "";
  return observation + visualPreferencePrompt(preferences.map(p => p.text!), input.instruction);
}

export async function visualEditHistory(input: Owner & { imageId?: number }) {
  const { body } = await owned(input);
  return ((Array.isArray(body.visualEditBriefs) ? body.visualEditBriefs : []) as VisualBrief[])
    .filter(b => b.editorUserId === input.userId && (!input.stableShotId || b.stableShotId === input.stableShotId) && (!input.imageId || b.imageId === input.imageId));
}

/** Reuse the existing art director output from the already quoted reading. */
export async function preparedReferenceEditPrompt(input: Owner & { imageId: number; instruction: string }) {
  const own = input.instruction.trim().startsWith(CLIENT_REVISION_PREFIX)
    ? input.instruction.trim().slice(CLIENT_REVISION_PREFIX.length).trim() : input.instruction.trim();
  const { imageVersion, contextVersion } = await visualReadingContext({ ...input, instruction: own });
  const briefs = await visualEditHistory(input);
  const brief = briefs.findLast(b => b.status === "seen" && b.imageVersion === imageVersion && b.contextVersion === contextVersion && b.instruction.trim() === own);
  if (brief?.reading?.uncertain.length)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `请先澄清：${brief.reading.uncertain.join("；")} / Clarify before generating` });
  const translated = brief?.reading?.editPromptEnglish?.trim() ?? (/^[\x20-\x7E\r\n]+$/.test(own) ? own : undefined);
  if (!translated || !/^[\x20-\x7E\r\n]+$/.test(translated))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "本次读图没有返回有效美术修改提示词，尚未提交 MJ；请重新报价读图。" });
  return visualRetexturePrompt(translated);
}
