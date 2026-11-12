import { parseCreationEmotionChat } from "../../shared/creationEmotionChat";
import { getStoryGeneratedImages } from "../repositories/images";
import { listStoryAudioAssetRows } from "../repositories/audioAssets";
import { readTextDraftHistory } from "../../shared/textDraftHistory";
import { emotionBasis, emotionFreshness } from "../../shared/creationEmotion";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import { scopeKey } from "../../shared/creationEmotion";
import { TRPCError } from "@trpc/server";
import { getStoryById } from "../repositories/stories";
import { listChapters } from "../repositories/chapters";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import {
  analyzeCreationEmotion,
  emotionIntentSchema,
  readCreationEmotion,
  resolveCreationEmotion,
  type CreationEmotionState,
  type EmotionScope,
} from "../../shared/creationEmotion";

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export function storyEmotion(
  body: unknown,
  target: { chapterId?: string; shotId?: string } = {}
) {
  return resolveCreationEmotion(
    readCreationEmotion(record(body).creationEmotion),
    target
  );
}
export async function getCreationEmotion(input: {
  storyId: number;
  userId: number;
}) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  return readCreationEmotion(record(story.body).creationEmotion);
}
export async function saveCreationEmotion(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  scope: EmotionScope;
  intent: {
    raw: string;
    mediumDirections?: { text?: string; art?: string; music?: string };
  } | null;
}): Promise<CreationEmotionState> {
  const intent =
    input.intent === null ? null : emotionIntentSchema.parse(input.intent);
  const reading = intent ? analyzeCreationEmotion(intent.raw) : null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story)
      throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
    const body = record(story.body);
    const state = readCreationEmotion(body.creationEmotion);
    if (state.revision !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "作品情绪已更新，请查看最新理解后再修改",
      });
    if (
      input.scope.kind === "shot" &&
      (!Array.isArray(body.shots) ||
        !body.shots.some(s => {
          const shot = record(s);
          return (
            shot.stableShotId === (input.scope as { id: string }).id ||
            shot.shotIdentity === (input.scope as { id: string }).id
          );
        }))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "镜头不存在，请重新选择",
      });
    if (input.scope.kind === "chapter") {
      const chapters = await listChapters(input.storyId, input.userId, "all");
      if (
        !chapters.some(c => String(c.id) === (input.scope as { id: string }).id)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "章节不属于当前故事",
        });
    }
    const latest = [...state.history]
      .reverse()
      .find(entry => scopeKey(entry.scope) === scopeKey(input.scope));
    if (
      latest &&
      canonicalJsonStringify(latest.intent) === canonicalJsonStringify(intent)
    )
      return state;
    if (state.history.length >= 500)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "作品情绪修订已达500条，旧记录保留",
      });
    const next: CreationEmotionState = {
      schemaVersion: 1,
      revision: state.revision + 1,
      history: [
        ...state.history,
        {
          revision: state.revision + 1,
          scope: input.scope,
          intent,
          reading,
          createdAt: new Date().toISOString(),
          userId: input.userId,
        },
      ],
    };
    const nextBody = { ...body, creationEmotion: next };
    try {
      await persistPreparedStoryBody({
        storyId: input.storyId,
        userId: input.userId,
        expectedRevision: getStoryRevision(body),
        body: prepareStoryBody(nextBody, getStoryRevision(body) + 1, nextBody),
      });
      return next;
    } catch (error) {
      if (!(error instanceof StoryBodyRevisionConflictError) || attempt === 3)
        throw error;
    }
  }
  throw new TRPCError({ code: "CONFLICT" });
}

/** Only an explicit work-scoped command commits. Personal feelings are never auto-applied. */
export async function handleCreationEmotionChat(input: {
  storyId: number;
  userId: number;
  message: string;
}) {
  const command = parseCreationEmotionChat(input.message);
  if (!command) return null;
  const show = command.action === "show";
  const state = await getCreationEmotion(input);
  let scope: EmotionScope = { kind: "story" };
  if (command.shotNo !== undefined) {
    const story = await getStoryById(input.storyId, input.userId);
    const shots = record(story?.body).shots;
    const shot = Array.isArray(shots)
      ? shots.map(record).find(s => Number(s.shotNo) === command.shotNo)
      : undefined;
    const id = shot?.stableShotId ?? shot?.shotIdentity;
    if (typeof id !== "string")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "没有找到这个镜头，请核对镜号",
      });
    scope = { kind: "shot", id };
  }
  const next =
    command.action === "set"
      ? await saveCreationEmotion({
          ...input,
          expectedRevision: state.revision,
          scope,
          intent: { raw: command.raw },
        })
      : state;
  const snapshot = resolveCreationEmotion(
    next,
    scope.kind === "shot" ? { shotId: scope.id } : {}
  );
  const latest = snapshot?.layers.at(-1);
  const usage = await getCreationEmotionUsage(input);
  const retained = usage.filter(
    item => item.status === "older-setting" || item.status === "untracked"
  );
  const retainedText = retained.length
    ? `\n保留原内容（旧设定或无情绪来源记录）：${retained
        .slice(0, 20)
        .map(
          x =>
            `${({ text: "文字", art: "图片", music: "音乐" } as Record<string, string>)[x.kind]} #${x.id}`
        )
        .join(
          "、"
        )}${retained.length > 20 ? ` 等${retained.length}项` : ""}。需要重做时请明确指定。`
    : "";
  const scopeLabel =
    scope.kind === "shot"
      ? `第${String(command.shotNo).padStart(2, "0")}镜情绪`
      : "作品情绪";
  const history = next.history.filter(
    entry => scope.kind === "story" || scopeKey(entry.scope) === scopeKey(scope)
  );
  const labelStory = show
    ? await getStoryById(input.storyId, input.userId)
    : null;
  const labelShots = record(labelStory?.body).shots;
  const chapters =
    show && history.some(entry => entry.scope.kind === "chapter")
      ? await listChapters(input.storyId, input.userId, "all")
      : [];
  const historyScopeLabel = (target: EmotionScope) => {
    if (target.kind === "story") return "作品";
    if (target.kind === "chapter")
      return (
        chapters.find(c => String(c.id) === target.id)?.title || "已移除章节"
      );
    const shot = Array.isArray(labelShots)
      ? labelShots
          .map(record)
          .find(
            s => s.stableShotId === target.id || s.shotIdentity === target.id
          )
      : undefined;
    return shot?.shotNo
      ? `第${String(shot.shotNo).padStart(2, "0")}镜`
      : "已移除镜头";
  };
  const historyText =
    show && history.length
      ? `\n修订记录：${history
          .slice(-12)
          .map(
            entry =>
              `E${entry.revision} · ${historyScopeLabel(entry.scope)} · ${entry.createdAt} · ${entry.intent?.raw ?? "恢复继承"}`
          )
          .join("\n")}`
      : "";
  const reply =
    (latest
      ? `${scopeLabel} E${latest.revision}：${latest.intent!.raw}\n文字、美术和音乐的新生成将共用这份意图，各自表达。已有内容保留原样，并未重新生成。可继续说“把${scope.kind === "shot" ? `第${String(command.shotNo).padStart(2, "0")}镜` : "作品"}情绪改为……”修正。`
      : `${scopeLabel}尚未设置。可以直接说“把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。”`) +
    historyText;

  return {
    reply: reply + retainedText,
    card: null,
    read: null,
    configured: true,
    modelLabel: "local-emotion-retrieval",
    toolCalls: [],
    suggestImage: false,
  };
}

export async function getCreationEmotionUsage(input: {
  storyId: number;
  userId: number;
}) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const body = record(story.body);
  const state = readCreationEmotion(body.creationEmotion);
  const [images, audio] = await Promise.all([
    getStoryGeneratedImages(input.storyId, input.userId),
    listStoryAudioAssetRows(input),
  ]);
  // Module candidates retain their chapter even when no chapter emotion existed
  // at generation time. Do not infer it from page ordinals or prose.
  const imageChapters = new Map<number, string>();
  if (Array.isArray(body.bookModuleImageTasks)) {
    for (const raw of body.bookModuleImageTasks) {
      const task = record(raw);
      if (typeof task.chapterId !== "number" || !Number.isSafeInteger(task.chapterId) || task.chapterId <= 0 || !Array.isArray(task.candidates)) continue;
      for (const rawCandidate of task.candidates) {
        const candidate = record(rawCandidate);
        if (typeof candidate.imageId === "number") imageChapters.set(candidate.imageId, String(task.chapterId));
      }
    }
  }
  function fromPrompt(
    prompt: string | null | undefined,
    shotId?: string,
    shotIds: string[] = [],
    sourceChapterId?: string
  ) {
    const recorded = new Set(
      [...(prompt?.matchAll(/【作品情绪依据 ([^】]+)】/gu) ?? [])].flatMap(m =>
        m[1].split(",")
      )
    );
    const targets = new Set(shotIds.concat(shotId ? [shotId] : []));
    let chapterId = sourceChapterId;
    for (const item of recorded) {
      let key: string;
      try {
        key = decodeURIComponent(item.split("@")[0]);
      } catch {
        continue;
      }
      if (key.startsWith("shot:")) targets.add(key.slice(5));
      if (!chapterId && key.startsWith("chapter:")) chapterId = key.slice(8);
    }
    const snapshots = targets.size
      ? [...targets].map(id =>
          resolveCreationEmotion(state, { shotId: id, chapterId })
        )
      : [resolveCreationEmotion(state, { chapterId })];
    const expected = new Set(
      snapshots.flatMap(s => (s ? emotionBasis(s).split(",") : []))
    );
    return !recorded.size
      ? expected.size
        ? "untracked"
        : "not-set"
      : recorded.size === expected.size &&
          [...recorded].every(value => expected.has(value))
        ? "current"
        : "older-setting";
  }
  return [
    ...readTextDraftHistory(body.textDraftHistory)
      .versions.filter(v => v.status === "ready")
      .map(v => ({
        kind: "text",
        id: v.id,
        status: emotionFreshness(
          v.creationEmotion,
          resolveCreationEmotion(state, {
            chapterId: v.request.emotionChapterId,
          })
        ),
      })),
    ...images.map(image => ({
      kind: "art",
      id: String(image.id),
      status: fromPrompt(image.prompt, image.shotIdentity ?? undefined, [], imageChapters.get(image.id)),
    })),
    ...audio
      .filter(a => a.mediaKind === "music")
      .map(a => {
        const p = record(a.provenance);
        return {
          kind: "music",
          id: String(a.id),
          status: fromPrompt(
            typeof p.prompt === "string" ? p.prompt : undefined,
            typeof p.stableShotId === "string" ? p.stableShotId : undefined,
            Array.isArray(p.emotionTargets)
              ? p.emotionTargets.filter(
                  (v): v is string => typeof v === "string"
                )
              : []
          ),
        };
      }),
  ];
}
